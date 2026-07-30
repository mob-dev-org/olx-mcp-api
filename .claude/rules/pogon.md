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
- `azuriraj-ovaj-klon.mjs` i `provjeri-izdanje.mjs` su Node bez blizanaca, jer rade NA klonu
  klijenta: jedan fajl mora raditi na obje platforme. Ko doda platformski specifican poziv, radi
  ga kroz granu po `process.platform`, kako je vec radjeno za launchctl i schtasks.
- Nista se ne konfigurise globalno po masini (zshrc, globalni exporti): sva konfiguracija
  zivi u repou i `.env` klona.

## Ugovori koji se lako zaborave

- `scripts/cuvar-sesije.mjs` i `scripts/pokreni-klijenta.sh` ponavljaju iste argumente, isto AI
  mapiranje I sastavljanje prompta: izmjena jednog povlaci izmjenu drugog.
- Sistemski prompt sesije se SASTAVLJA (`scripts/sastavi-prompt.mjs`), ne predaje se direktno:
  `--append-system-prompt-file` nije aditivan, sa dva fajla vazi samo zadnji (izmjereno
  30.07.2026). Ko doda novi dio prompta, dodaje ga u sastavljac.
- Headless `claude -p` nema koga da klikne permission prompt: bez `--allowedTools` sesija
  visi. Mutirajuce alate uvijek stavi i u `--disallowedTools` (uzor: `ai-runda.sh`).
- `--strict-mcp-config` gasi i MCP server Telegram plugina: ne koristiti u sesijama koje drze
  Telegram kanal. Izolaciju tamo daje CLAUDE_CONFIG_DIR po runtime-u.
- launchd sabloni: `KLIJENT.*` instalira `instaliraj-cron.sh` po klonu, `ADMIN.*` se instalira
  rucno jednom na masini. Logovi uvijek u `.olx-pik/cron-<posao>.log`.
- Backup stanja pise VAN klona (`~/olx-stanje/<grana>`) i to nije stvar ukusa: `azuriraj-sve.sh`
  preskace svaki klon sa lokalnim izmjenama, pa bi radna kopija unutar klona trajno iskljucila
  tog klijenta iz azuriranja, bez ijedne greske. Brana je u `postavkeStanja`, ne uklanjati je.
- Novo stanje koje se pise u `.olx-pik/` treba i odluku ide li u backup: dodaj ga na bijeli ili
  crni spisak u `src/core/backup-spisak.ts`. Dok nije ni na jednom, posao ga svakodnevno
  prijavljuje adminu kao nepoznato.
- Poslovi koji rade bez modela (CLI `posao ...`) to i ostaju: u njih se model ne uvodi.
- Izdanja: kod do klijenta ide samo kroz tag, i to kroz `scripts/izdanje.mjs`, a u flotu kroz
  `scripts/pusti-u-flotu.mjs` (skill `olx-izdanje` vodi oba). Granica je namjerna: `izdanje.mjs`
  radi samo povratne stvari i nikad ne pusha, a nepovratni dio (prekidac `stabilno`, azuriranje
  flote) trazi eksplicitnu zastavicu `--pomjeri-stabilno`. Nova skripta koja dira flotu drzi isto
  pravilo: nepovratno iza zastavice, nikad kao default.
- Klon ne povlaci kod sam. `SessionStart` hook (`provjeri-izdanje.mjs --samo-zaostajanje`) samo
  JAVI da klon zaostaje i da komandu. Dva razloga: zamjena koda ispod zive sesije ostavlja MCP
  server na starom buildu, a automatsko povlacenje u 03:00 zaobilazi kapiju i moze ostaviti
  klijenta bez bota ako build padne. Hook je uz to TIH u klijentskoj bot sesiji
  (`CLAUDE_CONFIG_DIR` na `.claude-runtime`), jer bi mu izlaz usao u kontekst i bot bi verziju
  mogao spomenuti klijentu.
- Hook pri pokretanju sesije ne smije pasti ni visjeti: bez mreze, gita ili remotea izlazi tiho
  sa kodom 0, a mrezni poziv ima rok (`OLX_PROVJERA_IZDANJA_ROK_MS`). Pad hooka je pad pokretanja
  sesije, dakle klijent bez bota zbog kozmeticke provjere.

## Telegram botovi

- Klijentski bot: BotFather privacy ISKLJUCEN (mora vidjeti sve poruke grupe).
- Admin bot: privacy UKLJUCEN (u grupi prima samo mention i reply) + `requireMention: true`.
  Ne mijenjati jedno u drugo; to je razlog zasto se botovi u admin grupi ne mijesaju.
