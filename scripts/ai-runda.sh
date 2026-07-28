#!/usr/bin/env bash
#
# AI runda: sedmicna batch analiza svih klonova kroz vlasnikovu Claude Code pretplatu.
#
# Granica koristenja pretplate, da se ne zaboravi: interaktivni klijentski bot NIKAD ne ide
# preko pretplate (to bi bilo dijeljenje naloga), on ostaje na API naplati. Ova runda je
# vlasnikov vlastiti batch rad nad vlastitim repoima; klijent dobija samo gotov rezultat.
#
# Sta radi po klonu: headless `claude -p` sa admin profilom izvrsi recept
# runtime/recepti/ai-runda.md (analiza profila, SEO prijedlozi, trijaza mrtvih, konkurenti;
# sve read-only, prijedlozi idu u .olx-pik/prijedlozi/), a zavrsni tekst sesije se posalje
# klijentu u grupu kroz `posao posalji` tog klona.
#
# Sekvencijalno namjerno: rate limiti pretplate. Ako izlaz lici na poruku o limitu, runda se
# prekida odmah, da ostali klonovi ne bi dobili polovicne analize.
#
# Ogranicenje: runda vidi samo klonove sa ove masine (~/.olx-klijenti.txt). Klon koji zivi na
# klijentovom racunaru ova runda ne pokriva.
#
# Pokretanje:
#   scripts/ai-runda.sh [--suho]
# Zakazivanje: deploy/launchd/ba.codefactory.olx.ADMIN.ai-runda.plist (nedjelja 21:00).

set -euo pipefail

POPIS="${OLX_KLIJENTI_POPIS:-$HOME/.olx-klijenti.txt}"
SUHO=0
[[ "${1:-}" == "--suho" ]] && SUHO=1

if [[ ! -f "$POPIS" ]]; then
  echo "Nema popisa klonova: $POPIS" >&2
  echo "Napravi ga, jedna putanja klona po liniji, npr: echo ~/olx-klijenti/mixbox >> $POPIS" >&2
  exit 1
fi

# Dvostruka brana povrh recepta: i da model u sesiji zaluta, mutirajuci alati su iskljuceni.
ZABRANJENI="mcp__olx-pik__olx_update_listing,mcp__olx-pik__olx_create_listing,mcp__olx-pik__olx_publish_listing,mcp__olx-pik__olx_refresh_listing,mcp__olx-pik__olx_refresh_bulk,mcp__olx-pik__olx_sponsor_listing,mcp__olx-pik__olx_set_discount,mcp__olx-pik__olx_finish_discount,mcp__olx-pik__olx_finish_listing,mcp__olx-pik__olx_hide_listing,mcp__olx-pik__olx_unhide_listing,mcp__olx-pik__olx_bulk_price,mcp__olx-pik__olx_bulk_sklanjanje,mcp__olx-pik__olx_upload_images,mcp__olx-pik__olx_delete_image,mcp__olx-pik__olx_set_main_image"

# U print modu nema koga da klikne na permission prompt, pa se sve sto sesija smije mora
# dozvoliti unaprijed. Write je suzen na folder prijedloga.
DOZVOLJENI="mcp__olx-pik,Read,Task,Write(.olx-pik/prijedlozi/**)"

javi_adminu() {
  # Isti best-effort obrazac kao u azuriraj-sve.sh: bez tokena u okruzenju se samo preskoci.
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_ADMIN_CHAT_ID:-}" ]]; then
    curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
      -d chat_id="$TELEGRAM_ADMIN_CHAT_ID" --data-urlencode text="$1" >/dev/null || true
  fi
}

pali=()
proslo=0

while IFS= read -r klon; do
  klon="${klon%%#*}"
  klon="$(echo "$klon" | xargs)"
  [[ -z "$klon" ]] && continue
  ime="$(basename "$klon")"

  if [[ ! -f "$klon/runtime/recepti/ai-runda.md" || ! -f "$klon/.env" || ! -f "$klon/dist/cli/index.js" ]]; then
    pali+=("$ime: nedostaje recept, .env ili dist")
    continue
  fi

  if [[ $SUHO -eq 1 ]]; then
    echo "[suho] $ime: runda bi se pokrenula, poruka bi isla u grupu klijenta"
    continue
  fi

  echo "== $ime =="
  izlaz=""
  if ! izlaz=$(cd "$klon" && claude -p "$(cat runtime/recepti/ai-runda.md)" \
      --strict-mcp-config --mcp-config .mcp.json \
      --append-system-prompt-file runtime/SISTEM-admin.md \
      --setting-sources project \
      --allowedTools "$DOZVOLJENI" \
      --disallowedTools "$ZABRANJENI" 2>&1); then
    if echo "$izlaz" | grep -qiE "usage limit|rate limit|out of.*(credit|quota)|limit reached"; then
      echo "Limit pretplate dostignut kod klona $ime, prekidam rundu." >&2
      javi_adminu "AI runda prekinuta na klonu $ime: limit pretplate. Proslo do tada: $proslo."
      exit 1
    fi
    pali+=("$ime: sesija pala")
    echo "$izlaz" | tail -n 5 | sed 's/^/  | /'
    continue
  fi

  if [[ -z "$(echo "$izlaz" | xargs 2>/dev/null || true)" ]]; then
    pali+=("$ime: prazan izlaz sesije")
    continue
  fi

  if printf '%s' "$izlaz" | (cd "$klon" && node dist/cli/index.js posao posalji --stdin >/dev/null); then
    proslo=$((proslo + 1))
    echo "$ime: analiza poslana klijentu"
  else
    pali+=("$ime: slanje na Telegram nije proslo")
  fi
done < "$POPIS"

echo
echo "AI runda: proslo $proslo, palo ${#pali[@]}"
for p in "${pali[@]}"; do echo "  - $p"; done

if [[ $SUHO -eq 0 ]]; then
  if [[ ${#pali[@]} -gt 0 ]]; then
    javi_adminu "AI runda: proslo $proslo, palo ${#pali[@]}: $(printf '%s; ' "${pali[@]}")"
  else
    javi_adminu "AI runda: proslo $proslo, sve uredu."
  fi
fi

[[ ${#pali[@]} -eq 0 ]]
