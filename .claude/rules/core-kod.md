---
paths:
  - "src/**"
---

# Pravila za rad na jezgru (src/)

Ucitava se samo kad se dira kod. Klijentska i admin bot sesija ovo nikad ne vide.

## Slojevi i granice medju njima

- `src/core` je jedini sloj koji prica sa OLX API-jem. CLI i MCP su tanka lica nad njim i ne
  smiju zvati `fetch` direktno ni obilaziti `OlxClient`.
- Smjer zavisnosti je jednosmjeran: `src/core` NE uvozi iz `src/mcp` ni `src/cli`, ni tip. To
  cuva `src/core/slojevi.test.ts` (cita `src/`, ne `dist/`, jer `tsc` brise uvoze tipova). Kad
  test padne, popravlja se uvoz, ne test: ono sto dijele ide u `core`.
- Racunanje ide u ciste funkcije (`stats.ts`, `izvjestaj.ts`) sa testovima; disk diraju samo
  `audit.ts` i `snapshoti.ts`. Nova logika prati tu podjelu.
- Sve sto mijenja stanje ili trosi kredite prolazi kroz postojece brane u `core`: `confirm`
  parametar, `provjeriDnevniPlafon`, audit zapis. Nikad ne dodavati alat koji ih zaobilazi.
- Alat za brisanje oglasa se ne dodaje u MCP ni pod kojim imenom (granice.md).

## MCP server

- Stdout MCP servera je JSON-RPC: `console.log` je zabranjen u putanji servera, dijagnostika
  ide na stderr (`console.error`).
- Novi alat: registracija ide kroz postojeci wrapper (audit kontekst + filter profila). Odmah
  odluci ide li u `SAMO_ADMIN`. Opis alata je dio konteksta svakog zahtjeva, pisi ga skrto;
  poslije izmjene sema pokreni `npm run kontekst` i uporedi prije/poslije.
- Alati vracaju kompaktan oblik po defaultu; puni payload samo iza eksplicitnog `full` ili
  slicnog prekidaca. Kombinacija `all` + `full` ostaje zabranjena.

## Okruzenje i konfiguracija

- Sve nove env varijable nose `OLX_` prefiks i ulaze u `.env.example` sa komentarom. Gole
  `ANTHROPIC_*` varijable ne idu u `.env` (loadEnvFile bi ih dao svim procesima).
- `process.loadEnvFile` NE gazi vec postavljen env: eksplicitni env procesa uvijek pobjedjuje
  `.env`. Na to se oslanja cuvar sesija (OLX_MCP_PROFILE po tipu sesije) — ne mijenjati.
- Citanje konfiguracije samo kroz `loadConfig` u `config.ts`, ne `process.env` po kodu.

## Verzija

- Broj verzije se NE mijenja usred obicnog rada. Mijenja ga samo izdanje, kroz
  `npm version <broj>`, koji podigne `package.json` i kroz hook prepise `src/core/verzija.ts`.
  Parnost tih dvaju cuva `src/core/verzija.test.ts`, kao i postojanje sekcije u `CHANGELOG.md`.
- `VERZIJA` iz `src/core/verzija.js` je jedini izvor za CLI `--version`, MCP handshake i polje
  `version` u audit zapisu. Novi potrosac verzije uvozi konstantu, ne prepisuje broj.
- Polje `version` u `AuditEntry` je obavezno namjerno: novo mjesto gradnje audit zapisa ne prolazi
  kroz `tsc` bez njega.

## Provjera

`npm test` i `npm run typecheck` prije svakog zavrsetka posla. Nova cista funkcija dobija test
u istom potezu, ne kasnije.
