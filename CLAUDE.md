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

## Saznanja iz prakse

Kad se API ili platforma ponasa suprotno dokumentaciji ili ocekivanju (polje se ignorise,
neocekivana greska, novo ogranicenje), zabiljezi to ODMAH jednom recenicom kroz
`olx_zabiljezi_saznanje`, pa nastavi posao. Sa admin masine zapise kupi
`scripts/saznanja-pokupi.sh` i iz njih nastaju popravke dokumentacije.

## Jezik

Latinica, bosanski. U kodu i commitima bez emojija.
