---
paths:
  - "scripts/**"
  - "deploy/**"
---

# Pravila za pogon (scripts/ i deploy/)

Ucitava se samo kad se diraju skripte ili deploy. Mapa cijelog pogona:
`olx-dokumentacija/arhitektura.md` — procitaj je prije vece izmjene.

## Prenosivost je zahtjev, ne zelja

- Sve sto radi NA KLONU KLIJENTA pise se u Node-u (`.mjs`), jer isti fajl mora raditi na
  macOS-u i Windowsu. Bash je dozvoljen samo za poslove koji zive iskljucivo na admin
  masini (`azuriraj-sve.sh`, `ai-runda.sh`, `provjeri-prompt.sh`).
- Svaki posao postoji na obje platforme: launchd sablon u `deploy/launchd/` I zadatak u
  `deploy/windows/instaliraj-zadatke.ps1`. Ko doda jedno bez drugog, nije zavrsio posao.
- Isto vazi i za rucne admin komande koje diraju klonove: `azuriraj-sve.sh` ima blizanca
  `deploy/windows/azuriraj.ps1`. Skripta se pokrece na masini gdje klonovi zive, jer restartuje
  njihove poslove; klonovi na Windowsu se ne mogu azurirati sa macOS-a.
- Nista se ne konfigurise globalno po masini (zshrc, globalni exporti): sva konfiguracija
  zivi u repou i `.env` klona.

## Ugovori koji se lako zaborave

- `scripts/cuvar-sesije.mjs` i `scripts/pokreni-klijenta.sh` ponavljaju iste argumente i isto
  AI mapiranje: izmjena jednog povlaci izmjenu drugog.
- Headless `claude -p` nema koga da klikne permission prompt: bez `--allowedTools` sesija
  visi. Mutirajuce alate uvijek stavi i u `--disallowedTools` (uzor: `ai-runda.sh`).
- `--strict-mcp-config` gasi i MCP server Telegram plugina: ne koristiti u sesijama koje drze
  Telegram kanal. Izolaciju tamo daje CLAUDE_CONFIG_DIR po runtime-u.
- launchd sabloni: `KLIJENT.*` instalira `instaliraj-cron.sh` po klonu, `ADMIN.*` se instalira
  rucno jednom na masini. Logovi uvijek u `.olx-pik/cron-<posao>.log`.
- Poslovi koji rade bez modela (CLI `posao ...`) to i ostaju: u njih se model ne uvodi.

## Telegram botovi

- Klijentski bot: BotFather privacy ISKLJUCEN (mora vidjeti sve poruke grupe).
- Admin bot: privacy UKLJUCEN (u grupi prima samo mention i reply) + `requireMention: true`.
  Ne mijenjati jedno u drugo; to je razlog zasto se botovi u admin grupi ne mijesaju.
