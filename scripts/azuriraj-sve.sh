#!/usr/bin/env bash
#
# Povlaci tag `stabilno` u sve klijentske klonove, gradi, testira i restartuje njihove poslove.
#
# Zasto tag a ne grana main: los commit fizicki ne moze doci do klijenata dok ga ne propustis.
# Radis na main, testiras na svom klonu, pa pomjeris tag:
#   git tag -f stabilno && git push -f origin stabilno
#
# Zasto se klon preskace umjesto da se popravlja: klijent na staroj radnoj verziji je bolji od
# klijenta na polovicno azuriranoj. Ako build ili testovi padnu, servisi tog klona se NE diraju.
#
# Popis klonova: ~/.olx-klijenti.txt, jedna putanja po liniji, prazne linije i # se ignorisu.

set -uo pipefail

POPIS="${OLX_KLIJENTI_POPIS:-$HOME/.olx-klijenti.txt}"
SAMO_PROBA=0
[[ "${1:-}" == "--suho" ]] && SAMO_PROBA=1

if [[ ! -f "$POPIS" ]]; then
  echo "Nema popisa klonova: $POPIS" >&2
  echo "Napravi ga, jedna putanja po liniji. Primjer:" >&2
  echo "  echo ~/olx-klijenti/mixbox >> $POPIS" >&2
  exit 1
fi

uspjeli=()
pali=()

while IFS= read -r klon; do
  klon="${klon%%#*}"
  klon="$(echo "$klon" | xargs)"
  [[ -z "$klon" ]] && continue

  echo "=== $klon ==="

  if [[ ! -d "$klon/.git" ]]; then
    pali+=("$klon: nije git klon")
    echo "  nije git klon, preskacem"
    continue
  fi

  if [[ $SAMO_PROBA -eq 1 ]]; then
    trenutni="$(git -C "$klon" rev-parse --short HEAD 2>/dev/null || echo nepoznat)"
    echo "  proba: trenutno na $trenutni, ne diram nista"
    uspjeli+=("$klon (proba)")
    continue
  fi

  # Lokalne izmjene u klijentskom klonu su znak da je neko rucno petljao. Bolje stati nego
  # pregaziti to sto je neko namjerno promijenio.
  if [[ -n "$(git -C "$klon" status --porcelain --untracked-files=no)" ]]; then
    pali+=("$klon: ima lokalne izmjene, ne diram")
    echo "  ima lokalne izmjene, preskacem"
    continue
  fi

  greska=""
  git -C "$klon" fetch --tags --quiet origin || greska="fetch"
  [[ -z "$greska" ]] && { git -C "$klon" checkout --detach --quiet stabilno || greska="checkout tag stabilno"; }
  [[ -z "$greska" ]] && { (cd "$klon" && npm ci --silent) || greska="npm ci"; }
  [[ -z "$greska" ]] && { (cd "$klon" && npm run build --silent) || greska="build"; }
  [[ -z "$greska" ]] && { (cd "$klon" && npm test --silent >/dev/null 2>&1) || greska="testovi"; }

  if [[ -n "$greska" ]]; then
    pali+=("$klon: $greska")
    echo "  PALO na koraku: $greska. Servisi ovog klona nisu dirani."
    continue
  fi

  # Tek sada, kad je sve proslo, restart poslova. Ime posla prati ime foldera klona.
  ime="$(basename "$klon")"
  for posao in dnevno sedmicno; do
    oznaka="ba.codefactory.olx.$ime.$posao"
    if launchctl list | grep -q "$oznaka"; then
      launchctl kickstart -k "gui/$(id -u)/$oznaka" 2>/dev/null || true
    fi
  done

  uspjeli+=("$klon @ $(git -C "$klon" rev-parse --short HEAD)")
  echo "  ok"
done < "$POPIS"

echo
echo "=== zbir ==="
echo "Proslo: ${#uspjeli[@]}"
for u in "${uspjeli[@]}"; do echo "  $u"; done
if [[ ${#pali[@]} -gt 0 ]]; then
  echo "Palo: ${#pali[@]}"
  for p in "${pali[@]}"; do echo "  $p"; done
fi

# Izvjestaj administratoru. Klijenti ovo ne vide.
if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_ADMIN_CHAT_ID:-}" && $SAMO_PROBA -eq 0 ]]; then
  poruka="Azuriranje flote: proslo ${#uspjeli[@]}, palo ${#pali[@]}"
  for p in "${pali[@]:-}"; do [[ -n "$p" ]] && poruka+=$'\n'"$p"; done
  curl -s -o /dev/null -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_ADMIN_CHAT_ID}" \
    --data-urlencode "text=${poruka}" || true
fi

[[ ${#pali[@]} -eq 0 ]]
