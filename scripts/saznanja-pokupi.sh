#!/usr/bin/env bash
#
# Pokupi saznanja iz prakse iz svih klonova u glavni repo.
#
# Svaka sesija (klijentska, admin bot, AI runda) biljezi neocekivano ponasanje API-ja kroz
# MCP alat olx_zabiljezi_saznanje u .olx-pik/saznanja.jsonl SVOG klona. Ova skripta, sa admin
# masine, obidje klonove iz popisa, uzme NOVE redove od zadnjeg kupljenja i slozi ih u
# olx-dokumentacija/saznanja-ulaz/ glavnog repoa (folder je u .gitignore: sirovi ulaz sa
# klijentskim kontekstom ne ide u git; u git idu tek destilovane popravke dokumentacije).
#
# Sta je "novo": marker fajl .olx-pik/saznanja.pokupljeno u SVAKOM klonu pamti broj vec
# pokupljenih redova. Bez modela, bez tokena: cisto citanje fajlova.
#
# Obrada pokupljenog je RUCNA ili kroz admin Claude sesiju u glavnom repou: "procitaj
# olx-dokumentacija/saznanja-ulaz/ i predlozi popravke dokumentacije". Moze i periodicno
# kroz /loop u admin sesiji; skripta samo garantuje da materijal ceka na jednom mjestu.
#
# Pokretanje: scripts/saznanja-pokupi.sh
# Zakazivanje: deploy/launchd/ba.codefactory.olx.ADMIN.saznanja.plist (svako jutro 08:00,
# instalira se rucno jednom, kao i ai-runda).

set -uo pipefail

GLAVNI="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POPIS="${OLX_KLIJENTI_POPIS:-$HOME/.olx-klijenti.txt}"
ULAZ="$GLAVNI/olx-dokumentacija/saznanja-ulaz"
DANAS="$(date +%F)"
IZLAZ="$ULAZ/saznanja-$DANAS.md"

if [[ ! -f "$POPIS" ]]; then
  echo "Nema popisa klonova: $POPIS" >&2
  exit 1
fi

mkdir -p "$ULAZ"
ukupno=0
klonova=0

while IFS= read -r -u 3 klon; do
  klon="${klon%%#*}"
  klon="$(echo "$klon" | xargs)"
  [[ -z "$klon" ]] && continue
  ime="$(basename "$klon")"
  fajl="$klon/.olx-pik/saznanja.jsonl"
  marker="$klon/.olx-pik/saznanja.pokupljeno"
  [[ -f "$fajl" ]] || continue

  vec=0
  [[ -f "$marker" ]] && vec="$(cat "$marker" 2>/dev/null || echo 0)"
  [[ "$vec" =~ ^[0-9]+$ ]] || vec=0

  svih="$(grep -c "" "$fajl" 2>/dev/null || echo 0)"
  if (( svih <= vec )); then
    continue
  fi

  novi="$(tail -n +"$((vec + 1))" "$fajl")"
  {
    echo ""
    echo "## $ime ($DANAS)"
    echo ""
    echo "$novi" | sed 's/^/    /'
  } >> "$IZLAZ"

  echo "$svih" > "$marker"
  broj=$((svih - vec))
  ukupno=$((ukupno + broj))
  klonova=$((klonova + 1))
  echo "$ime: $broj novih saznanja"
done 3< "$POPIS"

echo "Pokupljeno: $ukupno saznanja iz $klonova klonova."

if (( ukupno > 0 )); then
  echo "Ulaz: $IZLAZ"
  # Best-effort obavijest adminu, isti obrazac kao ai-runda.sh.
  if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_ADMIN_CHAT_ID:-}" ]]; then
    curl -s -o /dev/null -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_ADMIN_CHAT_ID}" \
      --data-urlencode "text=Saznanja iz prakse: ${ukupno} novih iz ${klonova} klonova. Fajl: olx-dokumentacija/saznanja-ulaz/saznanja-${DANAS}.md" || true
  fi
fi
