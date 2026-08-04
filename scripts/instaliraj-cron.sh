#!/usr/bin/env bash
#
# Instalira launchd poslove za ovaj klon: nocni snapshot, jutarnja poruka, sedmicni pregled,
# dnevno snimanje konkurenata (15:00, tiho izadje dok je spisak prazan) i cuvar klijentske
# sesije (KeepAlive, vidi scripts/cuvar-sesije.mjs).
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
POSLOVI=(snapshot dnevno sedmicno konkurenti)

# Sesijski poslovi se instaliraju SAMO kad je njihov runtime pripremljen: cuvar bez
# .claude-runtime odmah izlazi, pa bi KeepAlive vrtio pad svakih 30 sekundi u nedogled.
if [[ -d .claude-runtime ]]; then
  POSLOVI+=(sesija)
else
  echo "PRESKACEM posao sesija: nema .claude-runtime (node scripts/pripremi-runtime.mjs). Bez njega nema klijentskog bota." >&2
fi

# Admin bot je opcion po klonu (node scripts/pripremi-admin-runtime.mjs).
if [[ -d .claude-runtime-admin ]]; then
  POSLOVI+=(admin-bot)
fi

# Backup stanja se instalira samo kad je repo stanja podesen. Bez toga bi posao svako jutro pao
# i slao alarm adminu, a klijent bi imao jedan pokvaren zadatak vise.
if [[ -f .env ]] && grep -qE '^OLX_STANJE_REPO=.+' .env; then
  POSLOVI+=(backup)
else
  echo "PRESKACEM posao backup: OLX_STANJE_REPO nije podesen u .env. Klijentsko stanje ostaje samo na ovom disku." >&2
fi

if [[ ! -f dist/cli/index.js ]]; then
  echo "Nema dist/. Pokrecem build." >&2
  npm run build
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
