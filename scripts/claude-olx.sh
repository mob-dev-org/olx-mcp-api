#!/usr/bin/env bash
#
# Pokretanje Claude Code u ovom repou sa SAMO olx-pik MCP serverom.
#
# Zasto postoji: globalni MCP serveri (serena, excalidraw, mermaid-mcp, pencil) su registrovani
# u ~/.claude.json i projektni settings ih ne moze ugasiti. Jedina poluga je --strict-mcp-config,
# a to je zastavica pri pokretanju, ne postavka. Plugine gasi .claude/settings.json ovog repoa
# (kljuc enabledPlugins), pa se time ovdje ne bavimo.
#
# Namjena je RAZVOJNI rad na ovom repou. Za klijentski runtime se ne koristi ova skripta, nego
# CLAUDE_CONFIG_DIR po klonu (vidi scripts/pripremi-runtime.sh): tamo globalnih servera nema pa
# strict rezim nije ni potreban. Bitno je da se to ne mijesa, jer --strict-mcp-config gasi i MCP
# server Telegram plugina, a njegov .mcp.json koristi ${CLAUDE_PLUGIN_ROOT} koji se izvan plugin
# loadera ne zamjenjuje.

set -euo pipefail

KORIJEN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KORIJEN"

if [[ ! -f .mcp.json ]]; then
  echo "Nema .mcp.json u $KORIJEN. Pokreni iz klona olx-mcp-api." >&2
  exit 1
fi

# CLAUDE.md se ucitava sam i nosi tvrde granice. Ovdje se dodaje samo razvojni dio, da klijentski
# runtime ne bi dobijao npm i git upute.
exec claude \
  --strict-mcp-config \
  --mcp-config .mcp.json \
  --setting-sources project,local \
  --append-system-prompt-file runtime/SISTEM-admin.md \
  "$@"
