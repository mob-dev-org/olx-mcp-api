#!/usr/bin/env bash
#
# Instalira launchd poslove za ovaj klon: nocni snapshot, jutarnja poruka, sedmicni pregled i
# posao sesija koji vozi klijentski Telegram most (scripts/telegram-most.mjs).
# Windows ekvivalent svega ovoga: deploy/windows/instaliraj-zadatke.ps1 (Task Scheduler).
#
# Zasto launchd a ne crontab: crontab na macOS-u ne dobija korisnicki PATH ni pristup do keychaina
# na isti nacin, a launchd ima StartCalendarInterval koji preskoceni termin izvrsi kad se racunar
# probudi. Za posao koji mora raditi svaki dan to je bitna razlika.
#
# Pokretanje iz korijena klona:
#   scripts/instaliraj-cron.sh [ime_klijenta]
# Bez argumenta se uzima ime foldera klona. Isto ime koristi scripts/azuriraj-sve.sh za restart.

set -euo pipefail

KORIJEN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KORIJEN"

IME="${1:-$(basename "$KORIJEN")}"
CILJ="$HOME/Library/LaunchAgents"
POSLOVI=(snapshot dnevno sedmicno)

# Sesijski posao se instalira SAMO kad je runtime pripremljen I token dostupan: most bez
# .claude-runtime (nema access.json) ili bez ijednog bot tokena odmah izlazi kodom 2, pa bi
# KeepAlive vrtio pad svakih 30 sekundi u nedogled.
#
# Token se prihvata iz OBA izvora, tacno onim redom kojim ga most i trazi: prvo `.env` klona,
# pa `.claude-runtime/channels/telegram/.env`. Samo `.env` ovdje NIJE dovoljan uslov, jer ga
# pripremi-runtime.mjs uopste ne pise: on token upisuje samo u runtime. Klon koji zivi na
# runtime tokenu bi sa provjerom nad samim `.env` tiho ostao bez posla `sesija`.
TOKEN_RUNTIME=".claude-runtime/channels/telegram/.env"
if [[ -d .claude-runtime ]] &&
  { { [[ -f .env ]] && grep -qE '^TELEGRAM_BOT_TOKEN=.+' .env; } ||
    { [[ -f "$TOKEN_RUNTIME" ]] && grep -qE '^TELEGRAM_BOT_TOKEN=.+' "$TOKEN_RUNTIME"; }; }; then
  POSLOVI+=(sesija)
else
  echo "PRESKACEM posao sesija: nema .claude-runtime ili TELEGRAM_BOT_TOKEN nije popunjen ni u .env ni u $TOKEN_RUNTIME. Popravka: bun scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>. Bez njega nema klijentskog bota." >&2
  # Preskocen posao NE smije ostaviti staru definiciju bootstrap-ovanu: ona i dalje pokrece
  # komandu iz vremena kad je instalirana (do 0.18 to je bio cuvar-sesije.mjs, koji vise ne
  # postoji), pa bi klon vrtio pad u nedogled umjesto da tiho nema bota. Bootout je bez efekta
  # kad posao nikad nije ni instaliran.
  launchctl bootout "gui/$(id -u)/ba.codefactory.olx.$IME.sesija" 2>/dev/null || true
fi

# Admin bot je opcion po klonu (bun scripts/pripremi-admin-runtime.mjs). Posao vozi most u
# admin ulozi (scripts/telegram-most.mjs admin-bot). Admin token zivi u
# .claude-runtime-admin/channels/telegram/.env, ne u .env, pa se ovdje ne provjerava .env.
if [[ -d .claude-runtime-admin ]]; then
  POSLOVI+=(admin-bot)
else
  # Isti razlog kao kod posla sesija: preskakanje ne smije ostaviti staru definiciju ziva.
  launchctl bootout "gui/$(id -u)/ba.codefactory.olx.$IME.admin-bot" 2>/dev/null || true
fi

# Backup stanja se instalira samo kad je repo stanja podesen. Bez toga bi posao svako jutro pao
# i slao alarm adminu, a klijent bi imao jedan pokvaren zadatak vise.
if [[ -f .env ]] && grep -qE '^OLX_STANJE_REPO=.+' .env; then
  POSLOVI+=(backup)
else
  echo "PRESKACEM posao backup: OLX_STANJE_REPO nije podesen u .env. Klijentsko stanje ostaje samo na ovom disku." >&2
fi

if ! command -v bun &>/dev/null; then
  echo "bun nije u PATH-u. Instalacija: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

if [[ ! -f dist/cli/index.js ]]; then
  echo "Nema dist/. Pokrecem build." >&2
  bun run build
fi

if [[ ! -f .env ]]; then
  echo "Nema .env u $KORIJEN. Poslovi bi se pokretali bez tokena." >&2
  exit 1
fi

mkdir -p "$CILJ" .olx-pik

for posao in "${POSLOVI[@]}"; do
  sablon="deploy/launchd/ba.codefactory.olx.KLIJENT.$posao.plist"
  oznaka="ba.codefactory.olx.$IME.$posao"
  odrediste="$CILJ/$oznaka.plist"

  # sed sa | kao razdjelnikom, jer KORIJEN sadrzi kose crte.
  sed -e "s|KORIJEN|$KORIJEN|g" -e "s|KLIJENT|$IME|g" "$sablon" > "$odrediste"

  # bootout prije bootstrap: ponovna instalacija ne smije pasti na "Load failed: Already loaded".
  launchctl bootout "gui/$(id -u)/$oznaka" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$odrediste"
  echo "Instaliran: $oznaka"
done

echo
echo "Provjera:  launchctl list | grep codefactory.olx.$IME"
echo "Rucno:     launchctl kickstart -k gui/$(id -u)/ba.codefactory.olx.$IME.dnevno"
echo "Logovi:    $KORIJEN/.olx-pik/cron-*.log"
echo "Uklanjanje: for p in ${POSLOVI[*]}; do launchctl bootout gui/$(id -u)/ba.codefactory.olx.$IME.\$p; done"
