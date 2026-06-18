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
```

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
cd olx-pik-toolkit
npm install
npm run build
cd ..

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
  -- node "$(pwd)/olx-pik-toolkit/dist/mcp/server.js"
```

Napomene:
- Bez postavljenog `OLX_TOKEN` server se podigne, ali API pozivi vraćaju 401/403. Provjeri pristup sa `node --env-file=.env dist/cli/index.js whoami` ili kroz MCP alat `olx_whoami`.
- Token nikad ne commitati. `.env` i pravi tokeni su u `.gitignore`.

Detaljan plan za repo, build, MCP integraciju u Claude Code i rollout tima je u `PLAN.md`.
Strateska i API referenca za AI je u `kb/OLX_PIK_AI_Knowledgebase.md`.
