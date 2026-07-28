#!/usr/bin/env bash
#
# Pokrece klijentsku Claude Code sesiju za ovaj klon.
#
# Razlika naspram scripts/claude-olx.sh (koji je za tvoj razvojni rad):
#   - CLAUDE_CONFIG_DIR pokazuje na .claude-runtime ovog klona, pa globalnih MCP servera nema
#     i ne treba --strict-mcp-config. To je bitno, jer bi strict rezim ugasio i MCP server
#     Telegram plugina (njegov .mcp.json koristi ${CLAUDE_PLUGIN_ROOT} koji se izvan plugin
#     loadera ne zamjenjuje).
#   - Sistemski prompt je runtime/SISTEM-klijent.md, ne CLAUDE.md.
#   - Kanal je Telegram, pa sesija mora ostati u prvom planu i biti interaktivna.

set -euo pipefail

KORIJEN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KORIJEN"

RUNTIME="$KORIJEN/.claude-runtime"

if [[ ! -d "$RUNTIME" ]]; then
  echo "Nema $RUNTIME. Pokreni prvo: scripts/pripremi-runtime.sh <bot_token> <id_grupe> <telegram_id>" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Nema .env u $KORIJEN. Kopiraj .env.example i postavi OLX_TOKEN." >&2
  exit 1
fi

if ! grep -q '^OLX_MCP_PROFILE=klijent' .env; then
  echo "Upozorenje: OLX_MCP_PROFILE nije klijent u .env. Klijent ce vidjeti i admin alate." >&2
fi

if [[ ! -f dist/mcp/server.js ]]; then
  echo "Nema dist/. Pokrecem build." >&2
  npm run build
fi

# AI pogon klijentske sesije, iz .env klona (OLX_KLIJENT_AI). Isto mapiranje radi i
# scripts/cuvar-sesije.mjs; kad se mijenja jedno, mijenja se i drugo.
vrijednost() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
IZBOR="$(vrijednost OLX_KLIJENT_AI)"
if [[ "${IZBOR:-pretplata}" == "deepseek" ]]; then
  export ANTHROPIC_BASE_URL="$(vrijednost OLX_DEEPSEEK_BASE_URL)"
  export ANTHROPIC_AUTH_TOKEN="$(vrijednost OLX_DEEPSEEK_AUTH_TOKEN)"
  if [[ -z "$ANTHROPIC_BASE_URL" || -z "$ANTHROPIC_AUTH_TOKEN" ]]; then
    echo "OLX_KLIJENT_AI=deepseek, a OLX_DEEPSEEK_BASE_URL ili OLX_DEEPSEEK_AUTH_TOKEN nije popunjen u .env." >&2
    exit 1
  fi
  M="$(vrijednost OLX_DEEPSEEK_MODEL)";        [[ -n "$M" ]] && export ANTHROPIC_MODEL="$M"
  H="$(vrijednost OLX_DEEPSEEK_HAIKU_MODEL)";  [[ -n "$H" ]] && export ANTHROPIC_DEFAULT_HAIKU_MODEL="$H"
  T="$(vrijednost OLX_DEEPSEEK_TIMEOUT_MS)";   [[ -n "$T" ]] && export API_TIMEOUT_MS="$T"
  # API odbija zahtjev kad su AUTH_TOKEN i API_KEY postavljeni istovremeno.
  unset ANTHROPIC_API_KEY
  echo "Klijentska sesija ide na DeepSeek." >&2
else
  echo "Klijentska sesija ide na pretplatu (OLX_KLIJENT_AI nije deepseek)." >&2
fi

export CLAUDE_CONFIG_DIR="$RUNTIME"
export TELEGRAM_STATE_DIR="$RUNTIME/channels/telegram"

# setting-sources mora ukljucivati user: pod CLAUDE_CONFIG_DIR to je .claude-runtime/settings.json,
# gdje su permissions.deny i ugaseni plugini za klijenta. Bez toga bi ta pravila bila preskocena.
exec claude \
  --channels plugin:telegram@claude-plugins-official \
  --append-system-prompt-file runtime/SISTEM-klijent.md \
  --setting-sources user,project \
  "$@"
