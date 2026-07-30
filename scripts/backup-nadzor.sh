#!/usr/bin/env bash
#
# Pita SVAKI klon kad je zadnji put stvarno poslao stanje na daljinski, i javi adminu sve sto
# kasni. Zivi na admin masini, kao azuriraj-sve.sh.
#
# Zasto postoji: najveci rizik backupa nije greska nego TISINA. Posao koji nije instaliran,
# masina koja je bila ugasena i istekao token izgledaju isto, a `javiAdminu` je best effort i ne
# baca, pa alarm moze i sam pasti. Zato se pita sa druge strane, sa daljinskog repoa.
#
# Popis klonova: ~/.olx-klijenti.txt, jedna putanja po liniji.

set -uo pipefail

POPIS="${OLX_KLIJENTI_POPIS:-$HOME/.olx-klijenti.txt}"
PRAG_DANA="${OLX_BACKUP_PRAG_DANA:-3}"

if [[ ! -f "$POPIS" ]]; then
  echo "Nema popisa klonova: $POPIS" >&2
  exit 1
fi

kasne=()
uredni=()

while IFS= read -r -u 3 klon; do
  klon="${klon%%#*}"
  klon="$(echo "$klon" | xargs)"
  [[ -z "$klon" ]] && continue

  ime="$(basename "$klon")"

  if [[ ! -f "$klon/dist/cli/index.js" ]]; then
    kasne+=("$ime: klon nije izgradjen, backup se ne moze ni provjeriti")
    continue
  fi

  if ! grep -qE '^OLX_STANJE_REPO=.+' "$klon/.env" 2>/dev/null; then
    kasne+=("$ime: backup NIJE podesen, stanje postoji samo na disku te masine")
    continue
  fi

  izlaz="$(cd "$klon" && node dist/cli/index.js posao backup --nadzor 2>&1)" || {
    kasne+=("$ime: provjera nije prosla ($(echo "$izlaz" | tail -1))")
    continue
  }

  dana="$(echo "$izlaz" | grep -o '"dana": *[0-9-]*' | grep -o '[0-9-]*$')"
  if [[ -z "$dana" ]]; then
    kasne+=("$ime: nijedan upis na daljinskom")
  elif (( dana > PRAG_DANA )); then
    kasne+=("$ime: zadnji backup prije $dana dana")
  else
    uredni+=("$ime ($dana d)")
  fi
done 3< "$POPIS"

echo "=== backup nadzor ==="
echo "Uredni: ${#uredni[@]}"
if [[ ${#uredni[@]} -gt 0 ]]; then
  for u in "${uredni[@]}"; do echo "  $u"; done
fi
if [[ ${#kasne[@]} -gt 0 ]]; then
  echo "Kasne: ${#kasne[@]}"
  for k in "${kasne[@]}"; do echo "  $k"; done
fi

# Poruka ide samo kad nesto kasni: sedmicni "sve je u redu" bi se prestao citati.
if [[ ${#kasne[@]} -gt 0 && -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_ADMIN_CHAT_ID:-}" ]]; then
  poruka="Backup stanja kasni na ${#kasne[@]} klonova:"
  for k in "${kasne[@]}"; do poruka+=$'\n'"$k"; done
  curl -s -o /dev/null -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_ADMIN_CHAT_ID}" \
    --data-urlencode "text=${poruka}" || true
fi

[[ ${#kasne[@]} -eq 0 ]]
