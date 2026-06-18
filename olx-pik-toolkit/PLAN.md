# Plan: repozitorij, build i MCP/CLI (handoff za Claude Code)

Ovaj dokument je vodic da se projekat dovrsi lokalno u Claude Code. Kod je vec napisan; lokalno nema sandbox ogranicenja koja su ovdje kocila `npm install`.

## 1. Struktura repozitorija

```
olx-pik-toolkit/
├── package.json            # zavisnosti, bin: olx, skripte build/mcp
├── tsconfig.json           # strict, NodeNext ESM
├── .env.example            # konfiguracija (kopiraj u .env)
├── .gitignore              # node_modules, dist, .env
├── README.md               # brzi start
├── PLAN.md                 # ovaj dokument
├── kb/
│   └── OLX_PIK_AI_Knowledgebase.md   # AI referenca (API + strategija)
└── src/
    ├── core/
    │   ├── config.ts       # citanje env varijabli
    │   ├── types.ts        # tipovi API modela
    │   └── index.ts        # OlxClient: svi endpointi, throttle, retry, spend-guard
    ├── cli/
    │   └── index.ts        # commander CLI
    └── mcp/
        └── server.ts       # MCP server (stdio), alati u 3 nivoa + KB resource
```

## 2. Build lokalno

```bash
cd olx-pik-toolkit
npm install
npm run build
```

Ako `npm run build` prijavi tipske greske (moguce su sitne, build ovdje nije verifikovan), zalijepi u Claude Code:

> Pokreni `npm run build`, procitaj greske i popravi ih bez mijenjanja ponasanja. Ne uvodi tip `any`. Zadrzi strict mode. Kad prodje, pokreni `node dist/cli/index.js --help`.

## 3. Konfiguracija i prvi test (Faza 0, blocker)

```bash
cp .env.example .env
# Popuni OLX_TOKEN (preporuceno) ili OLX_USERNAME + OLX_PASSWORD
node dist/cli/index.js whoami
```

- Ako `whoami` vrati nalog: API pristup postoji, nastavi.
- Ako vrati AUTH 403: shop nema odobren API. Posalji zahtjev OLX/PIK podrsci za aktivaciju i ponovi.

## 4. Faze (mapirano na ono sto je vec u kodu)

- Faza 1 i 2 (citanje, sigurno): vec implementirano. Validiraj: `listings ls`, `category suggest`, `refresh limits`, `sponsor price`.
- Faza 3 (upis, uz zastite): vec implementirano. Testiraj na jednom probnom artiklu: `listings create --file item.json`, pa `listings publish <id>`, pa `listings hide <id>`. Tek onda bulk obnova.
- Faza 4 (MCP): registruj server u Claude Code (sekcija 5). Testiraj kroz `/mcp` i jedan upit.
- Faza 5 (rollout tima): tokeni po korisniku, cron auto-obnova, planer izdvajanja, audit log.

Primjer `item.json` za test kreiranja:

```json
{
  "title": "Test artikal nemoj kupovati",
  "short_description": "Test",
  "description": "Interni test, ne objavljivati javno.",
  "price": 1,
  "listing_type": "sell",
  "state": "used",
  "country_id": 49,
  "city_id": 1,
  "available": true
}
```

## 5. MCP integracija u Claude Code

Stdio server, lokalni proces. Po korisniku (token ostaje lokalno, ne ide u git):

```bash
claude mcp add olx-pik -s user \
  -e OLX_TOKEN=tvoj_token \
  -e OLX_BASE_URL=https://api.olx.ba \
  -- node /apsolutna/putanja/olx-pik-toolkit/dist/mcp/server.js
```

Za dijeljenje konfiguracije timu (bez tokena) moze i `.mcp.json` u korijenu repoa (`-s project`), pa svako doda svoj token kroz okruzenje:

```json
{
  "mcpServers": {
    "olx-pik": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "env": { "OLX_BASE_URL": "https://api.olx.ba" }
    }
  }
}
```

Napomene:
- Provjeri u sesiji sa `/mcp`. Ako server kasni na prvom startu, povecaj `MCP_TIMEOUT` (ms).
- Stdout mora ostati cist (samo JSON-RPC). Server vec pise poruke na stderr, ne diraj to.
- Ne commitati pravi token u `.mcp.json`. Token ide kroz `-e` po korisniku ili kroz lokalni env.

## 6. Automatizacija (CLI + cron)

Noćna obnova kroz besplatnih 750 mjesecno, npr. svaki dan u 03:00:

```
0 3 * * * cd /putanja/olx-pik-toolkit && OLX_TOKEN=... node dist/cli/index.js refresh all --limit 200 --yes >> /var/log/olx-refresh.log 2>&1
```

## 7. Git

```bash
git init
git add .
git commit -m "Inicijalni olx-pik-toolkit: core, CLI, MCP, knowledgebase"
```

- `.gitignore` vec iskljucuje `node_modules`, `dist`, `.env`. Nikad ne commitati `.env` ni tokene.
- Grane: `main` stabilno, feature grane po fazi.

## 8. Zastite (vec u kodu) i sta jos provjeriti

- Spend-guard: `sponsore` i `discount` ne troše kredite bez potvrde (CLI `--yes`, MCP `confirm: true`); prvo prikazu cijenu.
- Bulk obnova: dry-run dok se ne doda potvrda; postuje `refresh/limits`.
- Brisanje: trazi eksplicitnu potvrdu; preporuka je hide/finish umjesto delete.
- Provjeriti uzivo: tacan format `image-upload` (URL naspram multipart), realne rate limite, da li API domen prelazi na `api.pik.ba`.

## 9. Otvorena pitanja prije produkcije

- Odobren API pristup za shop (potvrda kroz `whoami`).
- Rate limiti i eventualni dnevni limiti na pisanje.
- Tacan format uploada slika.
- Prelazak domena olx.ba na pik.ba (vec je konfigurabilno preko `OLX_BASE_URL`).

## 10. Korisni promptovi za Claude Code

- "Pokreni build, popravi tsc greske bez mijenjanja ponasanja, bez `any`."
- "Napisi test koji preko `whoami` i `listings ls` provjeri pristup, bez trosenja kredita."
- "Dodaj `image-upload` preko multipart/form-data kao alternativu URL uploadu, iza flega, i dokumentuj u README."
- "Dodaj jednostavan audit log (JSONL) za sve operacije upisa i trosenja kredita."
