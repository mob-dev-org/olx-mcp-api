#!/usr/bin/env bash
#
# Povlaci tag `stabilno` u sve klijentske klonove, gradi, testira i restartuje njihove poslove.
#
# Zasto tag a ne grana main: los commit fizicki ne moze doci do klijenata dok ga ne propustis.
# Dva taga rade zajedno: `vX.Y.Z` je nepomican dokaz sta je izdanje, `stabilno` je prekidac koji
# kaze koje izdanje flota vozi. Procedura izdanja i vracanja: olx-dokumentacija/arhitektura.md
# sekcija 7. Vracanje je pomjeranje `stabilno` na prethodni `v` tag pa ponovo ova skripta.
#
# Fetch tagova IDE SA --force i to nije kozmetika: `git fetch --tags` bez toga odbija pomjeriti
# tag koji lokalno vec postoji ("would clobber existing tag"), pa bi klon ostao na starom
# commitu, a checkout, build i testovi bi prosli i skripta bi prijavila uspjeh. Tiho
# neazuriranje flote je najgori moguci ishod ove skripte (izmjereno 30.07.2026).
#
# Zasto se klon preskace umjesto da se popravlja: klijent na staroj radnoj verziji je bolji od
# klijenta na polovicno azuriranoj. Ako build ili testovi padnu, servisi tog klona se NE diraju.
#
# Popis klonova: ~/.olx-klijenti.txt, jedna putanja po liniji, prazne linije i # se ignorisu.

set -uo pipefail

POPIS="${OLX_KLIJENTI_POPIS:-$HOME/.olx-klijenti.txt}"
# Ime taga stoji na jednom mjestu, jer se inace ova skripta i njen Windows blizanac raziduju.
TAG="${OLX_TAG:-stabilno}"
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
# Izdanja na koja su klonovi stvarno dosli. Sluzi da admin poruka moze reci "sve na v0.4.0"
# umjesto samo broja, jer je razilazenje izdanja unutar flote znak da nesto nije proslo.
izdanja=()

# Ime izdanja klona: anotiran `v` tag ako HEAD stoji na njemu, inace kratki sha. `--always` je
# tu da funkcija nikad ne vrati prazno, jer plitak klon ili klon bez `v` tagova nije greska.
izdanje_klona() {
  git -C "$1" describe --tags --always 2>/dev/null || echo nepoznato
}

# Popis se cita kroz FD 3, ne kroz stdin: git/npm/node u tijelu petlje inace pojedu ostatak
# popisa i skripta tiho obradi samo prvi klon.
while IFS= read -r -u 3 klon; do
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
    trenutni="$(izdanje_klona "$klon")"
    echo "  proba: trenutno na $trenutni, ne diram nista"
    uspjeli+=("$klon (proba, $trenutni)")
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
  # --force: vidi napomenu u zaglavlju. Bez toga pomicni tag ostaje na starom commitu.
  git -C "$klon" fetch --tags --force --quiet origin || greska="fetch"
  [[ -z "$greska" ]] && { git -C "$klon" checkout --detach --quiet "$TAG" || greska="checkout tag $TAG"; }
  [[ -z "$greska" ]] && { (cd "$klon" && bun install --frozen-lockfile) || greska="bun install"; }
  [[ -z "$greska" ]] && { (cd "$klon" && bun run build) || greska="build"; }
  # `bun run test` (skript), NE goli `bun test`: bun test je Bunov vlastiti test runner koji
  # zaobilazi scripts/testovi.mjs i njegovo pojedinacno-po-fajlu pokretanje (vidi napomenu tamo).
  [[ -z "$greska" ]] && { (cd "$klon" && bun run test >/dev/null 2>&1) || greska="testovi"; }
  # Testovi pisu probni audit u radni folder; ne smije ostati u klijentovom .olx-pik.
  rm -f "$klon/.olx-pik/test-audit.jsonl" 2>/dev/null || true

  if [[ -n "$greska" ]]; then
    pali+=("$klon: $greska")
    echo "  PALO na koraku: $greska. Servisi ovog klona nisu dirani."
    continue
  fi

  # Tek sada, kad je sve proslo, osvjezi i DEFINICIJU posla, ne samo kod: komanda u plist
  # sablonu je presla sa cuvar-sesije.mjs na telegram-most.mjs, pa goli kickstart nad vec
  # instaliranom definicijom i dalje pokrece STARU komandu. instaliraj-cron.sh radi bootout pa
  # bootstrap za svaki posao iz sablona u repou, cime se definicija osvjezi, a sesija i
  # admin-bot se tim istim potezom i podignu sa novom komandom, pa poseban kickstart za njih
  # vise nije potreban. Kalendarski poslovi (snapshot/dnevno/sedmicno/backup) i ovim putem
  # ostaju NEIZVRSENI: njihovi sabloni imaju RunAtLoad false, pa bootstrap samo registruje
  # definiciju a ne pokrece je. kickstart -k bi ih (kad bi ih dirao) IZVRSIO odmah, pa bi
  # klijent dobio jutarnji izvjestaj usred dana i potrosila bi se dnevna runda obnova van reda.
  #
  # Pad instalatera ne obara azuriranje ostalih klonova u floti: uhvati se kao i ostali koraci,
  # pa se padne na STARO ponasanje (kickstart nad postojecom, neosvjezenom definicijom) kao
  # rezervu, barem da novi kod ude u memoriju sesije.
  ime="$(basename "$klon")"
  if (cd "$klon" && scripts/instaliraj-cron.sh "$ime"); then
    echo "  definicija posla osvjezena (instaliraj-cron.sh), sesija/admin-bot podignuti"
  else
    greska="instalacija poslova"
    echo "  PALO: definicija posla NIJE osvjezena. Rucno pokreni: (cd $klon && scripts/instaliraj-cron.sh $ime)"
    echo "  rezerva: kickstart nad starom definicijom, da barem novi kod ude u memoriju"
    for posao in sesija admin-bot; do
      oznaka="ba.codefactory.olx.$ime.$posao"
      if launchctl list | grep -q "$oznaka"; then
        launchctl kickstart -k "gui/$(id -u)/$oznaka" 2>/dev/null || true
        echo "  restartovan posao (stara definicija): $posao"
      fi
    done
    # Kod je usao, ali definicija posla nije: ovo mora u isti izvjestaj admin dobija na Telegram,
    # inace ga vidi samo ko gleda stdout skripte. Klon ostaje i u uspjeli (kod je azuriran).
    pali+=("$klon: $greska, rucno pokreni instaliraj-cron.sh")
  fi

  izdanje="$(izdanje_klona "$klon")"
  izdanja+=("$izdanje")
  uspjeli+=("$klon @ $izdanje")
  echo "  ok, $izdanje"
done 3< "$POPIS"

echo
echo "=== zbir ==="
echo "Proslo: ${#uspjeli[@]}"
# macOS bash 3.2 + set -u: prazan niz u "${niz[@]}" je unbound variable, zato guard.
if [[ ${#uspjeli[@]} -gt 0 ]]; then
  for u in "${uspjeli[@]}"; do echo "  $u"; done
fi
if [[ ${#pali[@]} -gt 0 ]]; then
  echo "Palo: ${#pali[@]}"
  for p in "${pali[@]}"; do echo "  $p"; done
fi

# Jedno izdanje za cijelu flotu je normalno stanje. Razilazenje znaci da je neki klon ostao na
# starom kodu, a to se lako previdi kad se gleda samo broj "proslo".
izdanja_sazeto=""
if [[ ${#izdanja[@]} -gt 0 ]]; then
  jedinstvena="$(printf '%s\n' "${izdanja[@]}" | sort -u)"
  if [[ "$(printf '%s\n' "$jedinstvena" | wc -l | xargs)" == "1" ]]; then
    izdanja_sazeto="flota na $jedinstvena"
  else
    izdanja_sazeto="PAZNJA: izdanja se razilaze: $(printf '%s' "$jedinstvena" | tr '\n' ' ')"
  fi
  echo "$izdanja_sazeto"
fi

# Izvjestaj administratoru. Klijenti ovo ne vide.
if [[ -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_ADMIN_CHAT_ID:-}" && $SAMO_PROBA -eq 0 ]]; then
  poruka="Azuriranje flote: proslo ${#uspjeli[@]}, palo ${#pali[@]}"
  [[ -n "$izdanja_sazeto" ]] && poruka+=$'\n'"$izdanja_sazeto"
  for p in "${pali[@]:-}"; do [[ -n "$p" ]] && poruka+=$'\n'"$p"; done
  curl -s -o /dev/null -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_ADMIN_CHAT_ID}" \
    --data-urlencode "text=${poruka}" || true
fi

[[ ${#pali[@]} -eq 0 ]]
