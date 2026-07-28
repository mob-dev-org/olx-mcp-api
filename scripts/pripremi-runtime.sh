#!/usr/bin/env bash
#
# Priprema klijentski runtime u ovom klonu: .claude-runtime/
#
# Zasto odvojen config dir: CLAUDE_CONFIG_DIR daje klijentskoj sesiji vlastiti ~/.claude. Jednim
# potezom rjesava dvije stvari koje bi inace bile dva problema:
#   1. globalni MCP serveri (serena, excalidraw, pencil, mermaid) se ne ucitavaju uopste,
#   2. TELEGRAM_STATE_DIR ide unutra, pa svaki klijent ima svoj bot i svoj allowlist. Bez toga
#      bi svi klijenti dijelili ~/.claude/channels/telegram i jedan bi citao tudje poruke.
#
# Pokretanje iz korijena klona:
#   scripts/pripremi-runtime.sh <bot_token> <id_grupe> <telegram_id_korisnika>[,<jos_jedan>...]
#
# Prije ovoga u BotFatheru za tog bota OBAVEZNO: /setprivacy -> Disable.
# Bez toga bot u grupi vidi samo poruke u kojima je izricito spomenut i nista nece raditi.

set -euo pipefail

KORIJEN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KORIJEN"

if [[ $# -lt 3 ]]; then
  echo "Upotreba: scripts/pripremi-runtime.sh <bot_token> <id_grupe> <telegram_id>[,<telegram_id>...]" >&2
  echo "Primjer:  scripts/pripremi-runtime.sh 123:AAH... -5270659685 7061697037,7061697038" >&2
  exit 1
fi

BOT_TOKEN="$1"
ID_GRUPE="$2"
IFS=',' read -ra KORISNICI <<< "$3"

RUNTIME="$KORIJEN/.claude-runtime"
TELEGRAM_DIR="$RUNTIME/channels/telegram"

if [[ -e "$RUNTIME" ]]; then
  echo "Vec postoji $RUNTIME." >&2
  echo "Obrisi ga rucno ako hoces ispocetka; skripta ne prepisuje postojeci runtime da ne pobrise uparivanja." >&2
  exit 1
fi

mkdir -p "$TELEGRAM_DIR/inbox" "$TELEGRAM_DIR/approved"

# Prazan .claude.json: nijedan globalni MCP server. Servere donosi projektni .mcp.json.
printf '{\n  "mcpServers": {}\n}\n' > "$RUNTIME/.claude.json"

cp runtime/settings.klijent.json "$RUNTIME/settings.json"

printf 'TELEGRAM_BOT_TOKEN=%s\n' "$BOT_TOKEN" > "$TELEGRAM_DIR/.env"
chmod 600 "$TELEGRAM_DIR/.env"

# allowlist umjesto pairing rezima: stranac ne dobija ni pairing kod.
{
  printf '{\n  "dmPolicy": "allowlist",\n  "allowFrom": ['
  for i in "${!KORISNICI[@]}"; do
    [[ $i -gt 0 ]] && printf ', '
    printf '"%s"' "${KORISNICI[$i]}"
  done
  printf '],\n  "groups": {\n    "%s": {\n      "requireMention": false,\n      "allowFrom": [' "$ID_GRUPE"
  for i in "${!KORISNICI[@]}"; do
    [[ $i -gt 0 ]] && printf ', '
    printf '"%s"' "${KORISNICI[$i]}"
  done
  printf ']\n    }\n  },\n  "pending": {}\n}\n'
} > "$TELEGRAM_DIR/access.json"
chmod 600 "$TELEGRAM_DIR/access.json"

echo "Runtime pripremljen: $RUNTIME"
echo
echo "Sljedeci koraci:"
echo "  1. U .env ovog klona postavi OLX_TOKEN, OLX_MCP_PROFILE=klijent i OLX_MAX_SPEND_PER_DAY."
echo "  2. U BotFatheru za ovog bota: /setprivacy -> Disable (inace bot ne vidi poruke u grupi)."
echo "  3. Pokreni klijentsku sesiju: scripts/pokreni-klijenta.sh"
