# OLX/PIK toolkit — zajednicki prompt

Toolkit za upravljanje OLX.ba / PIK.ba shopovima klijenata: jedno jezgro (`src/core`), dva lica
(CLI `src/cli`, MCP server `src/mcp`). Cilj bota: maksimalno iskoristiti platformu (vidljivost,
obnove, izdvajanje) uz minimalan i kontrolisan trosak kredita.

**Ovaj fajl vrijedi za OBA runtimea.** Claude Code ga ucitava automatski iz korijena klona, i to
je jedino mjesto gdje `@` import pouzdano radi (`--append-system-prompt-file` cita fajl doslovno,
bez razrjesavanja importa). Zato tvrde granice stoje ovdje, a ne u prompt fajlovima profila.

Sta se dodaje povrh ovoga:

- `runtime/SISTEM-admin.md` — razvojni tok, dodaje ga `scripts/claude-olx.sh`.
- `runtime/SISTEM-klijent.md` — pravila razgovora sa musterijom, dodaje ga
  `scripts/pokreni-klijenta.sh`.

@olx-dokumentacija/granice.md

## Profili

`OLX_MCP_PROFILE` odlucuje koliko alata MCP server izlaze:

- `admin` (default) — puna lista, ukljucujuci sirove dumpove kategorija i lokacija.
- `klijent` — suzena lista, bez kataloga i lokacija.

Tacan broj alata po profilu procitaj sa servera, ne pamti ga.

## Redoslijed citanja podataka

- Za statistiku, analizu i alarme PRVO agregirani alati (`olx_profile_stats`,
  `olx_competitor_report`, `olx_listing_report`, `olx_account_alerts`, `olx_sponsor_effect`,
  `olx_onboarding_report`): racunaju u kodu i vracaju kompaktan rezultat umjesto sirovih
  payloada. Dnevni snapshot pregleda pravi CLI `stats snapshot` (`.olx-pik/snapshots/`), bez
  njega se efekat izdvajanja ne moze mjeriti.
- `olx_list_listings` i `olx_get_listing` po defaultu vracaju kompaktan oblik; `full: true`
  samo kad treba polje koje kompakt nema. Kombinacija `all` i `full` je zabranjena.
- Kategoriju trazi u `olx://categories-index` (CSV); puni JSON tek kad CSV nije dovoljan.
- Forme i obavezna polja kategorije: `olx_category_attributes <id>`. Prije kreiranja oglasa
  obavezno `olx_draft_check`, jer API vraca 422 tek nakon slanja.
- Lokacije: `olx://locations-index` (BiH je country_id 49).

## Jedan izvor istine

Odgovori i skillovi ne kopiraju brojeve ni pravila, nego pokazuju na:

- `olx-dokumentacija/arhitektura.md` — mapa sistema sa dijagramima: slojevi, tok poruke,
  raspored automatskih poslova, AI runda, sta je automatski a sta rucno. Procitaj je prije
  rada na pogonu ili skriptama.

- `CHANGELOG.md` — sta je uslo u koje izdanje. Na pitanje "od kad je ovo tako" ili "sta se
  promijenilo" odgovor se cita odavde, ne iz pamcenja. Verzija klona: prva stavka
  `provjeri-klon.mjs`, ili polje `version` u audit zapisu.

- `olx-dokumentacija/pravila-brojeva.md` — **ima prednost nad svim ostalim izvorima kad je u
  pitanju bilo koji broj.** Resource `olx://pravila-brojeva`.
- `olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md` — pravila platforme, paketi, kvote, izdvajanje,
  kako radi pretraga. Resource `olx://knowledgebase`.
- `olx-dokumentacija/API-INVENTAR.md` — svi MCP alati, parametri, rupe u API-ju i preporuke.
- `olx-dokumentacija/analiza-api-dokumentacije.md` — endpointi sa zvanicnog
  api-documentation.olx.ba i razilazenja dokumentacije i zivog ponasanja.
- `olx-dokumentacija/PIK-pomoc-korpus/` — zvanicni clanci podrske; pregled u `index.csv`,
  resource `olx://pomoc-index`.
- SEO naslova i podnaslova: `.claude/skills/olx-seo-oglasa/references/seo-pravila.md`.

## Spremnost klona

Prije bilo kakvog rada PREMA KLIJENTU na klonu (pokretanje sesije, poslova, onboarding,
probne poruke) pokreni `node scripts/provjeri-klon.mjs` i prikazi rezultat: ona kaze sta
fali i tacnu komandu za popravku. Dok ijedna stavka FALI, ne krece se sa klijentom, prvo se
sredi klon. Vrijedi za terminalske sesije (gdje Bash postoji); Telegram sesije to ne rade,
za njih je klon vec pripremljen.

## Sve o klijentu zivi u klonu

Jedan klon = jedan klijent, pa i SVA njegova konfiguracija: bot tokeni, allowlist i grupe u
`.claude-runtime*/channels/telegram/` (pisu se kroz `pripremi-runtime.mjs` i
`pripremi-admin-runtime.mjs`), OLX token u `.env`, kontekst u `KLIJENT.md`, stanje u
`.olx-pik/`. Globalni `~/.claude/channels/` se NE dira (deny u projektnim settings): vazi za
cijelu masinu, nas pogon ga ne cita, i mijesao bi klijente. `/telegram:configure` se u ovom
repou ne koristi ni u jednom runtimeu.

Razgovor nije skladiste: sto je covjek poslao u poruci, poslije restarta sesije ne postoji.
Svaki podatak za postavku (OLX token, bot token, ID, odluka) upisi u njegovo konacno mjesto
ISTOG TRENA kad stigne, pa tek onda odgovori: OLX token u `.env` (`OLX_TOKEN=`, fajl napravi
iz `.env.example` ako ne postoji), bot tokene kroz pripremi skripte, kontekst o klijentu u
`KLIJENT.md`. Ako konacno mjesto jos ne moze da se popuni (fale drugi argumenti), privremeno
u `.olx-pik/onboarding-stanje.md` i pocisti kad postavka zavrsi.

## Saznanja iz prakse

Kad se API ili platforma ponasa suprotno dokumentaciji ili ocekivanju (polje se ignorise,
neocekivana greska, novo ogranicenje), zabiljezi to ODMAH jednom recenicom kroz
`olx_zabiljezi_saznanje`, pa nastavi posao. Sa admin masine zapise kupi
`scripts/saznanja-pokupi.sh` i iz njih nastaju popravke dokumentacije.

## Jezik

Latinica, bosanski. U kodu i commitima bez emojija.
