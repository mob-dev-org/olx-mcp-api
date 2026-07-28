# OLX/PIK toolkit — sistemski prompt (admin)

Toolkit za upravljanje OLX.ba / PIK.ba shopovima klijenata: jedno jezgro (`src/core`), dva lica
(CLI `src/cli`, MCP server `src/mcp`). Cilj bota: maksimalno iskoristiti platformu (vidljivost,
obnove, izdvajanje) uz minimalan i kontrolisan trosak kredita.

Ovaj fajl je prompt za **tvoj** rad na repou. Klijent ga nikad ne vidi: njegov runtime ucitava
`runtime/SISTEM-klijent.md` i nema `CLAUDE.md` u dohvatu. Vidi sekciju Profili.

## Tok rada

- `npm run build` prije svakog pokretanja (`dist/` nije u gitu). `npm test`, `npm run typecheck`.
- `npm run chat` pokrece Claude Code u ovom repou sa samo `olx-pik` MCP serverom
  (`scripts/claude-olx.sh`). Plugine gasi `.claude/settings.json`, kljuc `enabledPlugins`.
- `npm run kontekst` mjeri sta ide modelu u svakom potezu; sa `-- --sa-globalnim` mjeri i
  globalne MCP servere. Pokrenuti prije i poslije svake izmjene koja dira MCP seme.
- MCP server `olx-pik` se registruje kroz `.mcp.json`; token dolazi iz `OLX_TOKEN` u `.env` ovog
  klona. Jedan klon repozitorija radi za jedan nalog; za drugog klijenta se klonira repo.
- Stdout MCP servera je JSON-RPC: nikad ne dodavati `console.log` u server kod.

## Klijentski pogon

- `scripts/pripremi-runtime.sh <bot_token> <id_grupe> <telegram_id>` pravi `.claude-runtime/`:
  vlastiti `CLAUDE_CONFIG_DIR` i `TELEGRAM_STATE_DIR`, pa svaki klon ima svoj bot i nijedan
  globalni MCP server. U BotFatheru obavezno `/setprivacy` pa `Disable`.
- `scripts/pokreni-klijenta.sh` pokrece klijentsku sesiju sa `runtime/SISTEM-klijent.md`.
- `scripts/instaliraj-cron.sh` instalira launchd poslove: snapshot 02:40, dnevna poruka 07:20,
  sedmicna ponedjeljkom 07:40. Poslove vrti CLI `posao dnevni` i `posao sedmicni`, bez modela.
- `scripts/azuriraj-sve.sh` povlaci tag `stabilno` u sve klonove iz `~/.olx-klijenti.txt`. Klon
  kod kojeg build ili test padne se preskace i njegovi servisi se ne restartuju.

## Profili

`OLX_MCP_PROFILE` odlucuje koliko alata MCP server izlaze:

- `admin` (default) — svih 41, ukljucujuci sirove dumpove kategorija i lokacija. Za tvoj rad.
- `klijent` — 30 alata, bez kataloga i lokacija, uz tvrde granice na velicinu odgovora.
  Klijentski runtime dodatno ucitava `runtime/SISTEM-klijent.md` kao sistemski prompt.

@olx-dokumentacija/granice.md

## Interni alati (van MCP/CLI toolkita)

- `interno/pretraga-biznisa/` — samostalan alat za klasifikaciju shopova iz xlsx snimka po
  stvarnoj djelatnosti (ne po nazivu, koji cesto laze). Nastao za razdvajanje pravih auto
  salona od prodavaca dijelova, napravljen generickim za bilo koju djelatnost. **Samo za nasu
  internu analizu, nikad kod klijenta** (ne MCP, ne skill, ne klijentski runtime). Vidi
  `interno/pretraga-biznisa/CLAUDE.md`.

## Jedan izvor istine

Skillovi i odgovori ne kopiraju brojeve, nego pokazuju na:

- `olx-dokumentacija/pravila-brojeva.md` — **ima prednost nad svim ostalim izvorima kad je u
  pitanju bilo koji broj.** Razdvaja brojeve na fiksne na platformi, vezane za nalog i vezane za
  kategoriju. Izlozen kao MCP resource `olx://pravila-brojeva`.
- `olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md` — pravila platforme, paketi, kvote, izdvajanje,
  kako radi pretraga. Izlozen i kao MCP resource `olx://knowledgebase`.
- `olx-dokumentacija/API-INVENTAR.md` — svi MCP alati, parametri, rupe u API-ju i preporuke.
- `olx-dokumentacija/analiza-api-dokumentacije.md` — kompletan popis endpointa sa zvanicnog
  api-documentation.olx.ba, razilazenja dokumentacije i zivog ponasanja, prijedlozi
  produktizacije, recept za osvjezavanje.
- `olx-dokumentacija/PIK-pomoc-korpus/` — 52 zvanicna clanka podrske (pomoc.olx.ba); pregled u
  `index.csv`, pojedinacni clanci u `clanci/`, osvjezavanje po receptu u
  `NALAZI-i-osvjezavanje.md`.
- Poznata protivrjecnost: zvanicna pomoc tvrdi 750 obnova mjesecno, izmjereno je 1.800 na dva
  Gold naloga. Vazi izmjereno; detalji u KB.

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

## Jezik

Latinica, bosanski. U kodu i commitima bez emojija.
