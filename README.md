# olx-pik-toolkit

Interni CLI i MCP server za upravljanje OLX.ba / PIK.ba shopovima. Jedno jezgro (`src/core`), dva lica: CLI (`src/cli`) i MCP server (`src/mcp`).

## Zahtjevi

- Node.js 18 ili noviji (koristi se ugradjeni `fetch`).
- Odobren API pristup za shop (Gold ili Platinum + odobrenje OLX/PIK podrske). Provjeri sa `olx whoami`.

## Brzi start

```bash
npm install
npm run build
cp .env.example .env     # popuni OLX_TOKEN ili OLX_USERNAME/OLX_PASSWORD
node dist/cli/index.js whoami
```

## CLI primjeri

```bash
# Sigurno (citanje)
node dist/cli/index.js listings ls --state active --all
node dist/cli/index.js refresh limits
node dist/cli/index.js category suggest "golf 7"
node dist/cli/index.js sponsor price 12345 --type 2 --days 7 --refresh-every 8

# Obnova
node dist/cli/index.js refresh one 12345
node dist/cli/index.js refresh all --limit 200            # dry-run
node dist/cli/index.js refresh all --limit 200 --yes      # izvrsi

# Trosak kredita (uvijek trazi --yes)
node dist/cli/index.js sponsor apply 12345 --type 2 --days 7 --refresh-every 8 --yes

# Slike (URL-ovi i/ili lokalni fajlovi)
node dist/cli/index.js listings images add 12345 --url https://primjer.com/1.jpg https://primjer.com/2.jpg
node dist/cli/index.js listings images add 12345 --file ./slika1.jpg ./slika2.jpg
node dist/cli/index.js listings images main 12345 67890     # postavi glavnu sliku po imageId
node dist/cli/index.js listings images rm 12345 67890        # obrisi sliku
```

Napomena o slikama: upload preko `--url` koristi dokumentovani `images` niz. Upload lokalnih fajlova (`--file`) ide preko `multipart/form-data`; tacan naziv polja nije zvanicno dokumentovan (vidi `uploadImageFiles` u `src/core/index.ts`) i treba ga potvrditi uzivo kad token proradi.

## Snapshot kategorija i lokacija (statički, bez stalnog dohvatanja)

Kategorije i lokacije se rijetko mijenjaju, pa se jednom povuku u JSON i koriste kao statički MCP resource (`olx://categories`, `olx://locations`). Pokreni jednom kad token proradi:

```bash
node --env-file=.env dist/cli/index.js category dump      # -> olx-dokumentacija/categories.json
node --env-file=.env dist/cli/index.js location dump      # -> olx-dokumentacija/locations.json
```

Zatim commitaj ta dva fajla. Poslije toga AI/MCP čita kategorije i lokacije iz resursa bez ijednog API poziva. Pojedinačni live upiti su i dalje dostupni (`category list/children/get/brands/models`, `location countries/cities/city`).

## Vise klijenata (profili, vise tokena)

Za vise OLX naloga (razliciti klijenti) koristi profile. Token nikad ne ide u git.

Konfiguracija (bilo koji od tri nacina):

- Fajl `.olx-profiles.json` u korijenu (kopiraj iz `.olx-profiles.example.json`):
  ```json
  {
    "default": "klijent_a",
    "profiles": {
      "klijent_a": { "token": "...", "base_url": "https://api.olx.ba" },
      "klijent_b": { "token": "..." }
    }
  }
  ```
- Ili env varijable `OLX_TOKEN_<IME>` (npr. `OLX_TOKEN_KLIJENTA=...`).
- Ili `OLX_PROFILES_FILE` za drugu putanju do fajla.

CLI: biraj profil po pozivu sa `--profile`:
```bash
node dist/cli/index.js --profile klijent_a listings ls --all
node dist/cli/index.js --profile klijent_b refresh all --limit 200 --yes
node dist/cli/index.js auth profiles            # lista konfigurisanih profila
```
Bez `--profile` koristi se `OLX_PROFILE`, pa `default` iz fajla, pa obican `OLX_TOKEN`.

MCP: jedan server radi na jednom nalogu (radi sigurnosti, da se nalozi ne mijesaju). Za vise
klijenata registruj vise servera u `.mcp.json`, svaki sa svojim `OLX_PROFILE`:
```json
{
  "mcpServers": {
    "olx-klijent-a": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "env": { "OLX_PROFILE": "klijent_a", "OLX_PROFILES_FILE": ".olx-profiles.json" }
    },
    "olx-klijent-b": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/mcp/server.js"],
      "env": { "OLX_PROFILE": "klijent_b", "OLX_PROFILES_FILE": ".olx-profiles.json" }
    }
  }
}
```
Alat `olx_list_accounts` pokazuje aktivni nalog i sve profile.

## MCP server

```bash
npm run build
node dist/mcp/server.js   # radi preko stdio
```

## Za kolege: kloniranje i dodavanje MCP-a u Claude Code

Repozitorij ima `.mcp.json` u korijenu, pa Claude Code automatski ponudi `olx-pik` MCP server kad otvoriš projekat. Token se NE čuva u repou; svako postavlja svoj kroz env varijablu `OLX_TOKEN`.

Koraci poslije kloniranja:

```bash
# 1. Build (dist/ je u .gitignore, pa se mora lokalno izgraditi)
npm install
npm run build

# 2. Postavi svoj token u okruzenje (zamijeni vrijednost svojim tokenom)
export OLX_TOKEN=tvoj_token        # zsh/bash; trajno dodaj u ~/.zshrc ili ~/.bashrc

# 3. Otvori Claude Code u korijenu repozitorija
claude
```

Pri prvom otvaranju Claude Code pita da odobriš projektni MCP server `olx-pik`. Potvrdi, pa provjeri sa `/mcp`. Server preuzima `OLX_TOKEN` iz tvog okruzenja preko `${OLX_TOKEN}` u `.mcp.json`.

Alternativa bez `.mcp.json` (registracija samo za tebe, token ostaje lokalno):

```bash
claude mcp add olx-pik -s user \
  -e OLX_TOKEN=tvoj_token \
  -e OLX_BASE_URL=https://api.olx.ba \
  -- node "$(pwd)/dist/mcp/server.js"
```

Napomene:
- Bez postavljenog `OLX_TOKEN` server se podigne, ali API pozivi vraćaju 401/403. Provjeri pristup sa `node --env-file=.env dist/cli/index.js whoami` ili kroz MCP alat `olx_whoami`.
- Token nikad ne commitati. `.env` i pravi tokeni su u `.gitignore`.

## Claude Code skillovi

Repozitorij nosi i dva skilla u `.claude/skills/` (folder je skriven u file browserima jer pocinje tackom, ali je u gitu):

- `olx-mcp-setup`: postavljanje i koristenje toolkita (token, MCP, CLI, troubleshooting).
- `olx-analiza-profila`: analiza vlastitog profila i oglasa uz strategiju iz KB resursa.

Dolaze automatski sa kloniranjem; nista se ne instalira posebno.

Detaljan plan za repo, build, MCP integraciju u Claude Code i rollout tima je u `PLAN.md`.
Strateska i API referenca za AI je u `olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md`.
