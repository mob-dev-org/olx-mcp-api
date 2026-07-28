#!/usr/bin/env bash
#
# AI runda: sedmicna batch analiza svih klonova kroz vlasnikovu Claude Code pretplatu.
#
# Granica koristenja pretplate: ova runda je vlasnikov vlastiti batch rad nad vlastitim
# repoima; klijent dobija samo gotov rezultat. Klijentski interaktivni bot bira pogon kroz
# OLX_KLIJENT_AI u .env klona (pretplata je svjesni default za fazu testiranja prvih
# klijenata, poslije DeepSeek API po klijentu) — vidi .env.example i arhitektura.md.
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
# Napomena odrzavanja: ovo je crna lista, pa je svaki NOVI mutirajuci alat po defaultu
# dozvoljen dok se ovdje ne doda. Pri dodavanju alata u MCP server provjeri i ovu listu.
# olx_sponsor_plan je tu jer pise plan-izdvajanja.json i zauzima lock (runda je read-only);
# olx_opisi_sliku jer placa Anthropic API po pozivu, a runda ne radi sa slikama.
ZABRANJENI="mcp__olx-pik__olx_update_listing,mcp__olx-pik__olx_create_listing,mcp__olx-pik__olx_publish_listing,mcp__olx-pik__olx_refresh_listing,mcp__olx-pik__olx_refresh_bulk,mcp__olx-pik__olx_sponsor_listing,mcp__olx-pik__olx_set_discount,mcp__olx-pik__olx_finish_discount,mcp__olx-pik__olx_finish_listing,mcp__olx-pik__olx_hide_listing,mcp__olx-pik__olx_unhide_listing,mcp__olx-pik__olx_bulk_price,mcp__olx-pik__olx_bulk_sklanjanje,mcp__olx-pik__olx_upload_images,mcp__olx-pik__olx_delete_image,mcp__olx-pik__olx_set_main_image,mcp__olx-pik__olx_sponsor_plan,mcp__olx-pik__olx_opisi_sliku"

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
  # Klijentu smije otici SAMO stdout (zavrsni tekst sesije). stderr ide u fajl greske:
  # tamo zavrsavaju upozorenja iz koda ("snapshot nije citljiv", "plafon se ne moze
  # provjeriti") koja bi inace stigla klijentu u grupu. < /dev/null je obavezan: bez njega
  # claude -p pojede ostatak popisa klonova iz while-read petlje i runda tiho stane.
  greske="$(mktemp)"
  izlaz=""
  status=0
  izlaz=$(cd "$klon" && claude -p "$(cat runtime/recepti/ai-runda.md)" \
      --strict-mcp-config --mcp-config .mcp.json \
      --append-system-prompt-file runtime/SISTEM-admin.md \
      --setting-sources project \
      --allowedTools "$DOZVOLJENI" \
      --disallowedTools "$ZABRANJENI" 2>"$greske" < /dev/null) || status=$?

  # Poruka o limitu moze biti i na stdout i na stderr, provjeri oba.
  if { printf '%s\n' "$izlaz"; cat "$greske"; } | grep -qiE "usage limit|rate limit|out of.*(credit|quota)|limit reached"; then
    echo "Limit pretplate dostignut kod klona $ime, prekidam rundu." >&2
    javi_adminu "AI runda prekinuta na klonu $ime: limit pretplate. Proslo do tada: $proslo."
    rm -f "$greske"
    exit 1
  fi

  if [[ $status -ne 0 ]]; then
    pali+=("$ime: sesija pala")
    tail -n 5 "$greske" | sed 's/^/  | /'
    rm -f "$greske"
    continue
  fi
  rm -f "$greske"

  if [[ -z "$(echo "$izlaz" | xargs 2>/dev/null || true)" ]]; then
    pali+=("$ime: prazan izlaz sesije")
    continue
  fi

  # Zadnja brana prije klijenta: tehnicki ostaci ne idu u grupu.
  if printf '%s' "$izlaz" | grep -qiE "^(API Error|Error:|TypeError|Traceback)|ANTHROPIC_|OLX_TOKEN"; then
    pali+=("$ime: izlaz lici na tehnicku gresku, nije poslano")
    printf '%s' "$izlaz" | head -n 5 | sed 's/^/  | /'
    continue
  fi

  # Ovdje NEMA < /dev/null: stdin ovog poziva je pipe sa analizom, ne popis klonova.
  if printf '%s' "$izlaz" | (cd "$klon" && node dist/cli/index.js posao posalji --stdin >/dev/null); then
    proslo=$((proslo + 1))
    echo "$ime: analiza poslana klijentu"
  else
    pali+=("$ime: slanje na Telegram nije proslo")
  fi
done < "$POPIS"

echo
echo "AI runda: proslo $proslo, palo ${#pali[@]}"
# macOS bash 3.2 + set -u: "${pali[@]}" na praznom nizu je unbound variable, zato guard.
if [[ ${#pali[@]} -gt 0 ]]; then
  for p in "${pali[@]}"; do echo "  - $p"; done
fi

if [[ $SUHO -eq 0 ]]; then
  if [[ ${#pali[@]} -gt 0 ]]; then
    javi_adminu "AI runda: proslo $proslo, palo ${#pali[@]}: $(printf '%s; ' "${pali[@]}")"
  else
    javi_adminu "AI runda: proslo $proslo, sve uredu."
  fi
fi

[[ ${#pali[@]} -eq 0 ]]
