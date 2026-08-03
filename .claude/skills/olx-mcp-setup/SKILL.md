---
name: olx-mcp-setup
description: >-
  Postavljanje OLX/PIK toolkita: token, build, registracija MCP servera, 403 i AUTH problemi,
  snapshoti kategorija i lokacija. Okidaci: "kako da pokrenem olx", "ne radi mi token", "olx vraca
  403", "dodaj olx mcp".
---

# OLX/PIK toolkit: setup i koristenje

Ovaj skill ti pomaze da postavis i koristis interni toolkit za OLX.ba / PIK.ba shopove.
Toolkit ima jedno jezgro i dva lica: CLI (`dist/cli/index.js`) i MCP server
(`dist/mcp/server.js`). Sve putanje su relativne na korijen repoa. Detalji su u `README.md` i
`olx-dokumentacija/arhitektura.md`.

Cilj: dovesti korisnika do stanja gdje `whoami` vraca nalog, a MCP alati rade u Claude Code.
Za KOMPLETNU postavku klijentskog klona (Telegram botovi, cron poslovi, preflight) ovo nije
dovoljno: to vodi skill `olx-novi-klijent`.

## Preduslovi

- Node.js 20.12+ (ispod toga se `.env` tiho preskace jer `loadEnvFile` ne postoji; preflight
  to obara). Preporuka: 22 LTS.
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
   - Ili u shell okruzenje: `export OLX_TOKEN=...` (PowerShell: `$env:OLX_TOKEN="..."` za
     sesiju, `setx OLX_TOKEN "..."` trajno); MCP `.mcp.json` ga preuzima preko `${OLX_TOKEN}`.
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
   PowerShell (jedan red, bez `\` nastavaka):
   ```powershell
   claude mcp add olx-pik -s user -e OLX_TOKEN=tvoj_token -e OLX_BASE_URL=https://api.olx.ba -- node "$PWD/dist/mcp/server.js"
   ```

## Token nikad u git

Token je tajna. Ide kroz env varijablu ili `claude mcp add -s user`, nikad u `.mcp.json` koji se
commita ni u `.env` koji se commita. `.env` i `*.json` snapshoti tokena su u `.gitignore`. Ako
korisnik zalijepi token u chat, ne upisuj ga u fajl koji ide na GitHub.

## Jedan klon, jedan klijent

Ovaj repozitorij radi za JEDAN nalog: token je `OLX_TOKEN` u `.env` ovog klona. Za drugog klijenta
se klonira repo i u njemu postavi njegov token. Nema profila, nema alata koji mijenja nalog, pa
radnja ne moze zavrsiti na pogresnom klijentu.

Ko je klijent ovog klona pise u `KLIJENT.md` (kopija `KLIJENT.primjer.md`, gitignore-ovan). Ako
`KLIJENT.md` ne postoji, reci to korisniku i predlozi da ga popuni, umjesto da nagadjas ton i
granice.

Ako su postavljeni `OLX_USERNAME` i `OLX_PASSWORD`, token se obnavlja sam na prvi 401. Radnje koje
trose kredite se posle obnove ne ponavljaju automatski.

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
- `olx://pomoc-index` (CSV) — index 52 clanka zvanicne pomoci; nadji clanak pa ga procitaj
  preko `olx://pomoc/<ime-fajla>.md`. Ne citaj cijeli korpus odjednom.

Vazno: forme i opcije pojedine kategorije NISU u snapshotima. Za njih pozovi live alat
`olx_category_attributes <id>`. Tok: nadji kategoriju u CSV indexu -> uzmi opcije preko atributa.

## Popis alata

Nije ovdje, jer zastarijeva svaki put kad se doda alat. Puni popis sa parametrima je u
`olx-dokumentacija/API-INVENTAR.md`. Broj alata zavisi od `OLX_MCP_PROFILE` i cita se sa
servera, ne pamti se.

## Troubleshooting

- 403 / AUTH na svaki poziv: shop nema odobren API pristup. Nije problem koda; treba aktivacija kod podrske.
- MCP server se ne pojavi: provjeri da `dist/` postoji (build), da je `.mcp.json` u korijenu repoa,
  i da je `OLX_TOKEN` izvezen u okruzenju iz kojeg je pokrenut `claude` (macOS GUI launcher: env iz
  `~/.zshrc` mozda ne stigne; Windows: varijabla postavljena sa `$env:` vazi samo u toj sesiji, za
  trajno treba `setx` pa NOV terminal; u oba slucaja pomaze `claude mcp add -s user` sa tokenom).
- MCP kasni na prvom startu: povecaj `MCP_TIMEOUT` (ms).
- Stdout mora ostati cist JSON-RPC. Server poruke pise na stderr, to ne diraj.
- TypeScript greske pri buildu: popravi ih bez mijenjanja ponasanja, bez `any`, zadrzi strict mode.

Strateske odluke (kad obnoviti, izdvojiti, kako naslov) nisu ovdje. Za to koristi skill
`olx-analiza-profila` i MCP resurse `olx://knowledgebase`.
