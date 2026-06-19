---
name: olx-mcp-setup
description: >-
  Postavljanje i koristenje OLX.ba / PIK.ba toolkita (MCP server i CLI) iz repozitorija
  olx-mcp-api. Koristi ovaj skill kad god korisnik hoce da konfigurise OLX/PIK pristup,
  postavi token, registruje MCP server u Claude Code, pokrene build, rijesi 403/AUTH probleme,
  generise snapshot kategorija i lokacija, ili pita stvari poput "kako da pokrenem olx",
  "kako dodati olx mcp", "ne radi mi olx token", "olx vraca 403". Takodjer kad treba brzi
  podsjetnik koja CLI komanda ili koji MCP alat radi sta. Ne koristi za samu analizu oglasa
  (za to postoji skill olx-analiza-profila).
---

# OLX/PIK toolkit: setup i koristenje

Ovaj skill ti pomaze da postavis i koristis interni toolkit za OLX.ba / PIK.ba shopove.
Toolkit ima jedno jezgro i dva lica: CLI (`dist/cli/index.js`) i MCP server
(`dist/mcp/server.js`). Sve putanje su relativne na korijen repoa. Detalji su u `README.md` i `PLAN.md`.

Cilj: dovesti korisnika do stanja gdje `whoami` vraca nalog, a MCP alati rade u Claude Code.

## Preduslovi

- Node.js 18+ (toolkit koristi ugradjeni `fetch`).
- Odobren API pristup za shop. API vrlo vjerovatno trazi poslovni Shop (Gold/Platinum) i
  odobrenje OLX/PIK podrske. Bez toga pozivi vracaju 403. Ovo se ne aktivira samoposluzno.

## Redoslijed koraka (uvijek isti)

1. Build (jednom, i poslije svake izmjene koda; iz korijena repoa):
   ```bash
   npm install
   npm run build
   ```
2. Token. Preporuceno je vec dobijen Bearer token (po korisniku). Postavi ga na jedan od nacina:
   - U `.env` (u korijenu): `OLX_TOKEN=...` (CLI ga cita preko `--env-file=.env`).
   - Ili u shell okruzenje: `export OLX_TOKEN=...` (MCP `.mcp.json` ga preuzima preko `${OLX_TOKEN}`).
   - Alternativa: `OLX_USERNAME` + `OLX_PASSWORD` (toolkit sam radi login), ili stari
     `OLX_CLIENT_ID` + `OLX_CLIENT_TOKEN`.
3. Test pristupa (blocker, uradi prvo):
   ```bash
   node --env-file=.env dist/cli/index.js whoami
   ```
   - Vrati nalog: pristup radi, nastavi.
   - Vrati AUTH/403: shop nema odobren API. Posalji zahtjev OLX/PIK podrsci za aktivaciju i ponovi.
4. MCP u Claude Code. Repo ima `.mcp.json` u korijenu, pa Claude Code sam ponudi server `olx-pik`.
   Odobri ga, pa provjeri sa `/mcp`. Alternativa po korisniku (token lokalno):
   ```bash
   claude mcp add olx-pik -s user \
     -e OLX_TOKEN=tvoj_token \
     -e OLX_BASE_URL=https://api.olx.ba \
     -- node "$(pwd)/dist/mcp/server.js"
   ```

## Token nikad u git

Token je tajna. Ide kroz env varijablu ili `claude mcp add -s user`, nikad u `.mcp.json` koji se
commita ni u `.env` koji se commita. `.env` i `*.json` snapshoti tokena su u `.gitignore`. Ako
korisnik zalijepi token u chat, ne upisuj ga u fajl koji ide na GitHub.

## Vise klijenata (profili)

Za vise OLX naloga koristi profile (token nikad u git):
- Fajl `.olx-profiles.json` (kopija iz `.olx-profiles.example.json`) sa `default` i mapom `profiles` (ime -> token, opciono base_url).
- Ili env `OLX_TOKEN_<IME>`. Aktivni profil bira `OLX_PROFILE` ili CLI `--profile <ime>`.

CLI: `node dist/cli/index.js --profile klijent_a listings ls --all`. Lista profila: `olx auth profiles`.
MCP: jedan server = jedan nalog (da se ne mijesaju). Za vise klijenata registruj vise servera u
`.mcp.json`, svaki sa svojim `OLX_PROFILE`. Alat `olx_list_accounts` pokazuje aktivni nalog. Detalji u README.

## Snapshot kategorija i lokacija

Kategorije i lokacije se rijetko mijenjaju, pa se jednom povuku u fajl i koriste kao staticki MCP
resource bez stalnog dohvatanja. Pokreni jednom kad token radi:
```bash
node --env-file=.env dist/cli/index.js category dump      # -> categories.json + categories.csv (lagani index)
node --env-file=.env dist/cli/index.js location dump      # -> locations.json + locations.csv (lagani index)
```
`category dump` i `location dump` prave i puni JSON i lagani CSV. CSV se moze regenerisati iz JSON-a
bez API poziva: `category index` i `location index`. Commitaj sve fajlove.

## MCP resursi (citaj prije nego pozoves API)

- `olx://categories-index` (CSV, lagano) — koristi PRVO za pronalazak kategorije po imenu/path i id.
  Sadrzi i zastavice brand_required, model_required, has_models, show_condition, listing_fee.
- `olx://categories` (puni JSON, velik) — samo kad trebas polja kojih nema u CSV indexu.
- `olx://locations-index` (CSV, lagano) — koristi PRVO za `country_id` (BiH = 49) i `city_id` po imenu.
- `olx://locations` (puni JSON) — samo za detalje (lat/lon, zip, state).
- `olx://knowledgebase` — API referenca, pravila vidljivosti, dijagnostika (strategija).

Vazno: forme i opcije pojedine kategorije NISU u snapshotima. Za njih pozovi live alat
`olx_category_attributes <id>`. Tok: nadji kategoriju u CSV indexu -> uzmi opcije preko atributa.

## Brzi izbor alata (sta za sta)

Sigurno (citanje, bez troska):
- `whoami` / `olx_whoami` — test pristupa i ko je ulogovan.
- `listings ls` / `olx_list_listings` — oglasi po stanju (active, finished, inactive, expired, hidden).
- `listings get` / `olx_get_listing` — detalji jednog oglasa.
- `category suggest|find|list|children|get|brands|models|attributes` / `olx_suggest_category`,
  `olx_find_category`, `olx_categories`, `olx_category`, `olx_category_brands`, `olx_category_models`,
  `olx_category_attributes` — kategorije, brendovi/modeli i forme/opcije. Za samo pronalazak kategorije
  radije citaj resource `olx://categories-index` nego da listas preko API-ja.
- `location countries|cities|city` / `olx_countries`, `olx_cities`, `olx_city` — `country_id` i `city_id` za create.
- Nalozi: `auth profiles` / `olx_list_accounts`, prebacivanje naloga `olx_switch_account` (jedan server).
- `refresh limits` / `olx_refresh_limits` i `listings limits` / `olx_listing_limits` — limiti.
- `sponsor price` / `olx_sponsor_price` — cijena izdvajanja u kreditima (ne trosi).

Upis (mijenja stanje, trazi potvrdu):
- create, publish, update, refresh (one/all), hide, unhide, finish, slike (images add/main/rm).
- Tok kreiranja: kreiraj (DRAFT) -> dodaj slike -> postavi glavnu -> publish. Bez publish oglas nije vidljiv.

Trosak kredita (dupla potvrda, prvo cijena):
- sponsor apply / `olx_sponsor_listing` i discount set / `olx_set_discount`. CLI trazi `--yes`,
  MCP trazi `confirm: true`. Bez toga vracaju samo cijenu.

## Troubleshooting

- 403 / AUTH na svaki poziv: shop nema odobren API pristup. Nije problem koda; treba aktivacija kod podrske.
- MCP server se ne pojavi: provjeri da `dist/` postoji (build), da je `.mcp.json` u korijenu repoa,
  i da je `OLX_TOKEN` izvezen u okruzenju iz kojeg je pokrenut `claude` (ako koristis GUI launcher,
  env iz `~/.zshrc` mozda ne stigne; tad koristi `claude mcp add -s user` sa tokenom).
- MCP kasni na prvom startu: povecaj `MCP_TIMEOUT` (ms).
- Stdout mora ostati cist JSON-RPC. Server poruke pise na stderr, to ne diraj.
- TypeScript greske pri buildu: popravi ih bez mijenjanja ponasanja, bez `any`, zadrzi strict mode.

Strateske odluke (kad obnoviti, izdvojiti, kako naslov) nisu ovdje. Za to koristi skill
`olx-analiza-profila` i MCP resurse `olx://knowledgebase`.
