# Onboarding checklista (klijent je potpisao)

Redom, bez preskakanja. Svaki korak ima provjeru koja mora proci prije sljedeceg.

## 1. Token od klijenta

- Posalji poruku iz `token-poruka.md`. Kopiraj je u clipboard i javi korisniku da je kopirano.
- Cekaj onetimesecret link. Ako klijent posalje token obicnom porukom, primi ga ali reci mu da za
  budući put koristi link.
- Provjera: token je niz znakova, ne sadrzi lozinku, i nije prazan.

## 2. Upis tokena lokalno

- Ako ovaj klon repozitorija vec radi za drugog klijenta, prvo kloniraj repo za novog. Jedan klon
  je jedan klijent.
- U `.env` tog klona postavi `OLX_TOKEN=<token>`.
- Kopiraj `KLIJENT.primjer.md` u `KLIJENT.md` i popuni ga: firma, username, kategorije, ton,
  granice, kontakt.
- `.env` je u `.gitignore`. Token ne ide nigdje drugo: ne u chat, ne u dokument, ne u commit.
- Provjera: `olx_whoami` vraca klijentov nalog.

## 3. Potvrda naloga

- `olx_whoami` — potvrdi da je nalog stvarno klijentov (username, tip naloga) i reci korisniku
  na kojem si nalogu.
- Ako `olx_whoami` vrati 401 ili 403: token je pogresan, istekao ili shop nema odobren API
  pristup. Stani i rijesi to prije bilo cega (skill `olx-mcp-setup`).

## 4. Baseline izvjestaj

Snimi stanje na dan preuzimanja, da se kasnije moze dokazati sta se popravilo.

- `olx_list_listings` po stanjima: `active` (sa `all: true`), `hidden`, `expired`, `finished`.
- `olx_refresh_limits` — `free_limit`, `free_count`, dakle koliko obnova je ostalo ovaj mjesec.
- `olx_listing_limits` — limiti broja oglasa po grupama kategorija.
- `olx_user_profile <username>` — paket i do kad vazi, ocjene, vrijeme odgovora.
- Krediti: procitaj ih sa naloga, ne pretpostavljaj po paketu.

Zapisi u `klijenti/<ime>/baseline-<YYYY-MM-DD>.md`:

- brojevi po stanjima oglasa,
- paket i datum isteka, krediti, kvota obnova i koliko je iskorisceno,
- 10 najproblematicnijih naslova (kratka SEO ocjena),
- sumnjive kategorije,
- sta je odmah opasno (npr. istekao paket za par dana).

Folder `klijenti/` je u `.gitignore` jer sadrzi podatke klijenata.

## 5. Dogovor o granicama

Reci klijentu u jednoj poruci, pa to zapisi u baseline:

- Sta radimo bez pitanja: obnove unutar besplatne kvote.
- Sta ne radimo bez izricite potvrde: izdvajanje, akcijska cijena, svaka izmjena naslova ili
  cijene, sakrivanje ili zavrsavanje oglasa.
- Da bot ne brise oglase. Na "obrisi" ide predlog `finish`, jer oglas ostaje u historiji kao
  dokaz prodaje.

## Provjera na kraju

- `olx_whoami` vraca klijentov nalog.
- Baseline fajl postoji i ima datum.
- U `.env` je token, u gitu nije nista od klijentovih podataka (`git status` cist).
- `KLIJENT.md` je popunjen, a audit log (`.olx-pik/audit.jsonl`) biljezi sve sto se dalje radi.
