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

- Staze, provjere, AI mapiranje i sastavljanje prompta sesije zive SAMO u
  `scripts/lib/sesija.mjs` (`stazeSesije`, `provjeriPreduslove`, `aiPogon`, `sastaviPrompt`,
  `okruzenjeSesije`); `scripts/pokreni-klijenta.mjs` i `scripts/telegram-most.mjs` ih importuju.
  Argv je razlika: `pokreni-klijenta.mjs` ide preko `claudeArgv` (interaktivni `--channels` put),
  a `telegram-most.mjs` sastavlja svoj headless `-p`/`stream-json` argv u `scripts/lib/most.mjs`
  (`argviSesije`), jer most sa sesijom razgovara kroz stdin/stdout i treba drugaciji spawn
  (stdio pipe, ne pty). Oba pokretaca ipak dijele isti `sesija.mjs` za sve sto NIJE argv, pa se
  ne mogu raziici u tome kako biraju runtime, AI pogon ili prompt.
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
- Ime prekidaca `stabilno` je konfigurabilno preko `OLX_TAG` (default "stabilno"), samo na admin
  masini: cita ga `scripts/pusti-u-flotu.mjs`, `scripts/azuriraj-ovaj-klon.mjs`,
  `scripts/provjeri-izdanje.mjs`, `scripts/azuriraj-sve.sh` i `deploy/windows/azuriraj.ps1`.
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

- Telegram plugin i njegov `bun` su ZAVISNOSTI POGONA, ne opcija. Plugin cache stoji u
  `$CLAUDE_CONFIG_DIR/plugins/`, dakle instalira se posebno za svaki runtime
  (`.claude-runtime`, `.claude-runtime-admin`); globalna instalacija u `~/.claude` klijentskoj
  sesiji ne vrijedi nista. `.claude-runtime-admin` treba u OBA rezima jednobotnom i dvobotnom
  (nosi `CLAUDE_CONFIG_DIR` admin sesije, settings, prompt, MCP profil admin), pa plugin ide i u
  njega bez obzira ima li taj runtime svoj bot token ili je pripremljen sa `--bez-bota`. Pripremi
  skripte ga instaliraju same (idempotentno, kroz `scripts/lib/telegram-plugin.mjs`), ali
  instalacija moze pasti (SSH, mreza, bun), pa preflight u `provjeri-klon.mjs` ostaje kapija.
- Kvar plugina se ne vidi na jutarnjoj poruci: nju salje cron kroz `src/core/telegram.ts`, cist
  fetch mimo sesije i plugina. Bot moze mjesecima cutati na poruke dok izvjestaji uredno stizu.
  Zato preflight provjerava plugin i `bun` odvojeno od svega ostalog.
- **Dvobotni rezim (default, `OLX_MOST_ADMIN_TG_ID` prazan u `.env`):** dva bota, dva tokena, dva
  procesa mosta. Klijentski bot: BotFather privacy ISKLJUCEN (mora vidjeti sve poruke grupe).
  Admin bot: privacy UKLJUCEN (u grupi prima samo mention i reply) + `requireMention: true`. Ne
  mijenjati jedno u drugo; to je razlog zasto se botovi u admin grupi ne mijesaju.
- **Jednobotni rezim (opcion, `OLX_MOST_ADMIN_TG_ID` popunjen u `.env`):** JEDAN bot, JEDAN token,
  JEDAN proces mosta koji vozi obje sesije. Privacy tog bota MORA biti ISKLJUCEN, jer isti token
  nosi i klijentsku grupu; `requireMention` iz BotFathera tu ne postoji i ne moze zamijeniti
  razdvajanje. Admin smjer se ovdje ne razdvaja postavkom bota nego RUTIRANJEM PO PORUCI u
  `scripts/telegram-most.mjs`: privatna poruka tacno sa `OLX_MOST_ADMIN_TG_ID` ide na admin
  sesiju, svaka poruka u GRUPI (ukljucujuci vlasnikovu) i svaka privatna poruka drugog ID-a ide na
  klijentsku sesiju. Zato u ovom rezimu taj bot NE SMIJE biti dodat u zajednicku admin grupu:
  cijeli promet te grupe bi usao u klijentsku sesiju. Vlasnik sa ovim klonom razgovara SAMO
  privatno. Tacna pravila i primjer su komentarisani u `.env.example` uz `OLX_MOST_ADMIN_TG_ID`,
  ne prepisuju se ovdje.
- `access.json` je jedan izvor za oba smjera: po njemu bot PRIMA poruke i po njemu izvjestaji
  ODLAZE. `TELEGRAM_CHAT_ID` je samo dopuna. Grupa se dodaje sa `telegram grupe dodaj <id>`, jer
  `pripremi-runtime.mjs` odbija rad na postojecem runtime-u.
- Otkrivanje grupa preko `getUpdates` se NE pokusava. Zivu sesiju drzi Telegram plugin i on je
  jedini konzumer pollinga; drugi bi joj krao poruke. Zato ni `my_chat_member` nije dostupan i
  id nove grupe se ocita rucno.
- **Telegram most (`scripts/telegram-most.mjs`) je legitimni direktni konzument Telegram API-ja,
  ne izuzetak od zabrane iznad.** Zabrana "ne pokusavati otkrivanje preko `getUpdates`" vazi za
  DODATNE konzumere pored zive sesije (npr. rucna proba `pokreni-klijenta.mjs` dok most radi);
  most je JEDINI konzument u produkciji, jer plugina i njegovog pollera vise nema. Zato se most i
  rucna proba ne smiju voditi istovremeno na istom bot tokenu: dva `getUpdates` konzumera daju 409
  Conflict, pa se posao `sesija` (most) gasi PRIJE `pokreni-klijenta.mjs`, ne obrnuto.
  U jednobotnom rezimu (`OLX_MOST_ADMIN_TG_ID` popunjen) ovo pravilo je jos vaznije, jer JEDAN
  token nosi oba smjera: odvojen admin proces mosta u tom rezimu NE POSTOJI, most ima tvrde brane
  koje odbijaju start ako se pokusa dici klijentska i admin uloga kao dva odvojena procesa na
  istom tokenu, i posao `admin-bot` se u tom rezimu NE INSTALIRA. Admin i klijent tu dijele isti
  proces i istog globalnog radnika (round robin, nikad paralelno), ne dva `getUpdates` konzumera.
- Most zove `getUpdates`, `sendChatAction`, `sendMessage`, `sendPhoto` i `getFile`; nikad
  `deleteWebhook`, `setWebhook` ni `setMyCommands`.
- Most pomjera `offset` SAMO nakon sto je poruka upisana u red na disku (fsync kroz rename), ne
  ranije: to je i jedini nacin da nijedna poruka ne bude potvrdjena a nikad obradjena. Isto pravilo
  vazi na izlazu iz reda: stavka se brise SAMO nakon sto je odgovor poslan na Telegram. Pad izmedju
  ta dva trenutka znaci ponovnu obradu (isporuka najmanje jednom), nikad gubljenje poruke.
- Most salje `allowed_updates: ["message"]` eksplicitno pri svakom `getUpdates` pozivu (za razliku
  od stare straze, koja ga NIJE smjela slati dok je pored nje postojao plugin sa svojom
  postavkom): most je danas jedini konzument, pa nema tudju postavku koju bi mogao pregaziti.
- Prelazak grupe u supergrupu MIJENJA `chat_id`. Zato `telegram grupe provjeri` mrtvu grupu samo
  javi adminu i nikad je ne uklanja sam: isti unos je i dozvola za dolazne poruke, pa bi ga jedna
  HTTP greska utisala u oba smjera.
