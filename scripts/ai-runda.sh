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

# Bijela lista umjesto crne: mcp__olx-pik vise nije dozvoljen kao cijeli server, nego se
# nabraja tacno onih par alata koje runda smije zvati. Crna lista je propustala upravo ono
# zbog cega je postojala: olx_opisi_sliku je bio zabranjen jer placa Anthropic API po pozivu,
# a olx_generiraj_sliku (skuplji i uz to pise na disk) NIJE bio na spisku, jer je dosao poslije
# i niko nije azurirao branu. Bijela lista taj rizik ne nosi: novi alat u MCP serveru je po
# defaultu NEDOSTUPAN dok se ovdje eksplicitno ne doda.
#
# Runda je strogo read-only nad OLX-om (vidi runtime/recepti/ai-runda.md), pa NIJEDAN alat koji
# mijenja stanje ili trosi kredite nije na ovom spisku: ni objave, ni obnove, ni izdvajanje, ni
# slike, ni cijene. olx_zabiljezi_saznanje je izuzetak jer ne dira OLX, samo pise lokalnu
# biljesku o odstupanju platforme (CLAUDE.md trazi da se to zabiljezi odmah).
#
# Spisak prati korake recepta runtime/recepti/ai-runda.md:
#   1. olx_whoami, olx_profile_stats
#   2. olx_account_alerts, olx_mrtvi_oglasi
#   3. olx_onboarding_report
#   4. olx_competitor_report i olx_user_profile (zove ih podagent olx-konkurent, koji u
#      .claude/agents/ ima tacno ta dva alata; olx-seo-pisac i olx-trijaza imaju samo Read)
DOZVOLJENI="mcp__olx-pik__olx_whoami,mcp__olx-pik__olx_profile_stats,mcp__olx-pik__olx_account_alerts,mcp__olx-pik__olx_mrtvi_oglasi,mcp__olx-pik__olx_onboarding_report,mcp__olx-pik__olx_competitor_report,mcp__olx-pik__olx_user_profile,mcp__olx-pik__olx_zabiljezi_saznanje,Read,Task,Write(.olx-pik/prijedlozi/**)"

# Pojas i tregere povrh bijele liste: bijela lista je vec dovoljna brana (alat koji nije na
# njoj se ne moze pozvati), ali ako model u sesiji nekim putem ipak zatrazi mutirajuci alat,
# ovo je druga, nezavisna prepreka. Za razliku od DOZVOLJENI ovo NIJE kompletan spisak svih
# alata ovog MCP servera nego samo onih koji mijenjaju stanje na OLX-u ili trose kredit; alati
# koji pisu samo lokalnu konfiguraciju klona (olx_zapamti, olx_ritam_obnova, olx_izuzeca,
# olx_limit_slika, olx_pozadina) namjerno nisu ovdje, jer ne diraju shop ni novac. Pri dodavanju
# NOVOG mutirajuceg ili placenog alata u MCP server, dodaj ga i ovdje.
ZABRANJENI="mcp__olx-pik__olx_update_listing,mcp__olx-pik__olx_create_listing,mcp__olx-pik__olx_publish_listing,mcp__olx-pik__olx_refresh_listing,mcp__olx-pik__olx_refresh_bulk,mcp__olx-pik__olx_sponsor_listing,mcp__olx-pik__olx_set_discount,mcp__olx-pik__olx_finish_discount,mcp__olx-pik__olx_finish_listing,mcp__olx-pik__olx_hide_listing,mcp__olx-pik__olx_unhide_listing,mcp__olx-pik__olx_skini_artikal,mcp__olx-pik__olx_vrati_artikal,mcp__olx-pik__olx_bulk_price,mcp__olx-pik__olx_bulk_sklanjanje,mcp__olx-pik__olx_upload_images,mcp__olx-pik__olx_delete_image,mcp__olx-pik__olx_set_main_image,mcp__olx-pik__olx_sponsor_plan,mcp__olx-pik__olx_opisi_sliku,mcp__olx-pik__olx_generiraj_sliku"

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
  if printf '%s' "$izlaz" | (cd "$klon" && bun dist/cli/index.js posao posalji --stdin >/dev/null); then
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
