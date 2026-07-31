#!/usr/bin/env bash
#
# Onboarding analiza za JEDAN klon. Pokrece je puller (scripts/onboarding-puller.mjs) odmah nakon
# sto je token upisan i whoami prosao. Headless admin sesija na vlasnikovoj pretplati (isto kao
# ai-runda.sh), pa se klijentski DeepSeek racun ne trosi na ovu analizu.
#
# Sesija po receptu runtime/recepti/onboarding-analiza.md popuni KLIJENT-javno.md i cinjenicni
# dio KLIJENT.md. Read-only nad OLX-om (mutirajuci alati iskljuceni crnom listom, kao u rundi).
# Ne salje nista na Telegram: javljanja radi puller.
#
# Pokretanje:
#   scripts/onboarding-analiza.sh <putanja-klona>

set -euo pipefail

KLON="${1:-}"
if [[ -z "$KLON" || ! -d "$KLON" ]]; then
  echo "Upotreba: scripts/onboarding-analiza.sh <putanja-klona>" >&2
  exit 2
fi

if [[ ! -f "$KLON/.mcp.json" ]]; then
  echo "U $KLON nema .mcp.json, ne lici na klon." >&2
  exit 2
fi
if [[ ! -f "$KLON/dist/mcp/server.js" ]]; then
  echo "U $KLON nema dist/. Pokreni build u klonu prije analize." >&2
  exit 2
fi

# Ista crna lista kao ai-runda.sh: i da sesija zaluta, nista mutirajuce ne prolazi. Pri dodavanju
# novog mutirajuceg alata u MCP server, dodaj ga i ovdje (crna lista, ne bijela).
ZABRANJENI="mcp__olx-pik__olx_update_listing,mcp__olx-pik__olx_create_listing,mcp__olx-pik__olx_publish_listing,mcp__olx-pik__olx_refresh_listing,mcp__olx-pik__olx_refresh_bulk,mcp__olx-pik__olx_sponsor_listing,mcp__olx-pik__olx_set_discount,mcp__olx-pik__olx_finish_discount,mcp__olx-pik__olx_finish_listing,mcp__olx-pik__olx_hide_listing,mcp__olx-pik__olx_unhide_listing,mcp__olx-pik__olx_bulk_price,mcp__olx-pik__olx_bulk_sklanjanje,mcp__olx-pik__olx_upload_images,mcp__olx-pik__olx_delete_image,mcp__olx-pik__olx_set_main_image,mcp__olx-pik__olx_sponsor_plan,mcp__olx-pik__olx_opisi_sliku"

# Sesija smije citati OLX i pisati SAMO dva klijentska fajla. Write je suzen namjerno.
DOZVOLJENI="mcp__olx-pik,Read,Write(KLIJENT.md),Write(KLIJENT-javno.md)"

greske="$(mktemp)"
trap 'rm -f "$greske"' EXIT

izlaz=$(cd "$KLON" && claude -p "$(cat runtime/recepti/onboarding-analiza.md)" \
    --strict-mcp-config --mcp-config .mcp.json \
    --append-system-prompt-file runtime/SISTEM-admin.md \
    --setting-sources project \
    --allowedTools "$DOZVOLJENI" \
    --disallowedTools "$ZABRANJENI" 2>"$greske" < /dev/null) || status=$?
status=${status:-0}

# Limit pretplate: isti obrazac kao runda, prekid uz jasnu poruku (puller ce javiti adminu).
if { printf '%s\n' "$izlaz"; cat "$greske"; } | grep -qiE "usage limit|rate limit|out of.*(credit|quota)|limit reached"; then
  echo "Limit pretplate dostignut tokom onboarding analize za $KLON." >&2
  exit 3
fi

if [[ $status -ne 0 ]]; then
  echo "Onboarding analiza pala za $KLON:" >&2
  tail -n 8 "$greske" | sed 's/^/  | /' >&2
  exit 1
fi

# Sazetak sesije ide na stdout (puller ga vidi u svom logu, ne salje klijentu).
printf '%s\n' "$izlaz"
