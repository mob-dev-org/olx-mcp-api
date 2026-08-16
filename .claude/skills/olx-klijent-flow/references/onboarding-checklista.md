# Onboarding checklista (klijent je potpisao)

Redom, bez preskakanja. Svaki korak ima provjeru koja mora proci prije sljedeceg.

## 1. Token od klijenta

- Posalji poruku iz `token-poruka.md`. Kopiraj je u clipboard i javi korisniku da je kopirano.
- Cekaj onetimesecret link. Ako klijent posalje token obicnom porukom, primi ga ali reci mu da za
  budući put koristi link.
- Provjera: token je niz znakova, ne sadrzi lozinku, i nije prazan.

Tehnicka postavka klona (kloniranje, .env, Telegram runtime, cron, preflight) je skill
`olx-novi-klijent` i radi se PRIJE ovih koraka ili paralelno sa njima.

## 2. Upis tokena lokalno

- Ako ovaj klon repozitorija vec radi za drugog klijenta, prvo kloniraj repo za novog. Jedan klon
  je jedan klijent.
- U `.env` tog klona postavi `OLX_TOKEN=<token>`.
- Kopiraj `KLIJENT.primjer.md` u `KLIJENT.md` i popuni ga: firma, username, kategorije, ton,
  granice, kontakt. `KLIJENT.md` ide u KORIJEN klona, ne u `klijenti/` — pogon (AI runda,
  skillovi) ga cita samo iz korijena. Folder `klijenti/<ime>/` je za radne dokumente
  (baseline, zapisi poteza), ne za identitet klijenta.
- `.env` je u `.gitignore`. Token ne ide nigdje drugo: ne u chat, ne u dokument, ne u commit.
- Provjera: `olx_whoami` vraca klijentov nalog.

## 3. Potvrda naloga

- `olx_whoami` — potvrdi da je nalog stvarno klijentov (username, tip naloga) i reci korisniku
  na kojem si nalogu.
- Ako `olx_whoami` vrati 401 ili 403: token je pogresan, istekao ili shop nema odobren API
  pristup. Stani i rijesi to prije bilo cega (skill `olx-mcp-setup`).

## 4. Baseline izvjestaj (audit u 2 poziva)

Baseline se PISE U FAJL. U razgovor ide samo sazetak od 3 do 5 redova.

Snimi stanje na dan preuzimanja, da se kasnije moze dokazati sta se popravilo.

- `olx_profile_stats views=sample` — JEDAN poziv vraca gotov audit: paket i istek, krediti,
  kvota obnova, brojevi po svim stanjima, cijene, udio sponzorisanih, neobnovljeni oglasi,
  pregledi na uzorku oglasa.
- `olx_account_alerts` — sta je odmah opasno (paket pri isteku, krediti,
  kvota koja propada, istekli oglasi).
- Po potrebi jos: `olx_listing_limits` (limiti broja oglasa po grupama) i CLI `stats snapshot`
  (prvi dnevni snimak pregleda, temelj za kasnije mjerenje izdvajanja).

Zapisi u `klijenti/<ime>/baseline-<YYYY-MM-DD>.md`:

- brojevi po stanjima oglasa,
- paket i datum isteka, krediti, kvota obnova i koliko je iskorisceno,
- pregledi: top i dno oglasa po pregledima dnevno (iz profile_stats),
- 10 najproblematicnijih naslova (kratka SEO ocjena),
- sumnjive kategorije,
- sta je odmah opasno (iz account_alerts).

Folder `klijenti/` je u `.gitignore` jer sadrzi podatke klijenata.

## 5. Dogovor o granicama

Reci klijentu u jednoj poruci, pa to zapisi u baseline:

- Sta radimo bez pitanja: obnove unutar besplatne kvote.
- Sta ne radimo bez izricite potvrde: izdvajanje, akcijska cijena, svaka izmjena naslova ili
  cijene, sakrivanje ili zavrsavanje oglasa.
- Da bot ne brise oglase. Na "obrisi" ide predlog `finish`, jer oglas ostaje u historiji kao
  dokaz prodaje.

## Provjera na kraju

- **`bun scripts/provjeri-klon.mjs` prolazi bez ijedne FALI stavke.** To je jedina potpuna
  provjera spremnosti (konfiguracija, runtime, zakazani poslovi, most, snapshot) i dok ona
  ne prodje, sa klijentom se ne pocinje.
- `olx_whoami` vraca klijentov nalog.
- Baseline fajl postoji i ima datum.
- U `.env` je token, u gitu nije nista od klijentovih podataka (`git status` cist).
- `KLIJENT.md` je popunjen, a audit log (`.olx-pik/audit.jsonl`) biljezi sve sto se dalje radi.
