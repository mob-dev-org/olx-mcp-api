# Rad na repou (admin profil)

Dodaje se povrh `CLAUDE.md` kroz `scripts/claude-olx.sh`. Klijentski runtime ovo nikad ne vidi.

## Tok rada

- `npm run build` prije svakog pokretanja (`dist/` nije u gitu). `npm test`, `npm run typecheck`.
- `npm run chat` pokrece Claude Code sa samo `olx-pik` MCP serverom. Plugine gasi
  `.claude/settings.json`, kljuc `enabledPlugins`.
- `npm run kontekst` mjeri sta ide modelu u svakom potezu; sa `-- --sa-globalnim` mjeri i
  globalne MCP servere. Pokrenuti prije i poslije svake izmjene koja dira MCP seme ili promptove.
- `scripts/provjeri-prompt.sh` dokazuje da tvrde granice stvarno stizu u kontekst u oba profila.
  Pokrenuti prije brisanja bilo kojeg pravila iz skillova.
- Token dolazi iz `OLX_TOKEN` u `.env` ovog klona. Jedan klon radi za jedan nalog.
- Stdout MCP servera je JSON-RPC: nikad ne dodavati `console.log` u server kod.

## Klijentski pogon

- `node scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>` pravi `.claude-runtime/`:
  vlastiti `CLAUDE_CONFIG_DIR` i `TELEGRAM_STATE_DIR`, pa svaki klon ima svoj bot i nijedan
  globalni MCP server. U BotFatheru obavezno `/setprivacy` pa `Disable`.
- `scripts/pokreni-klijenta.sh` pokrece klijentsku sesiju rucno (prvi test pri onboardingu).
- U pogonu sesije drzi `scripts/cuvar-sesije.mjs [klijent|admin-bot]`: restart na pad, nocni
  restart u 03h (tada cisti i Telegram inbox) i restart poslije neaktivnosti (klijent 2h,
  admin-bot 1h), da kontekst ne raste kroz dan. Ponavlja argumente iz `pokreni-klijenta.sh`;
  kad se mijenja jedno, mijenja se i drugo.
- AI pogon klijentske sesije bira `OLX_KLIJENT_AI` u `.env` klona: `pretplata` (default, faza
  testiranja) ili `deepseek` (OLX_DEEPSEEK_* varijable; bez njih se sesija ne pokrece). Nista
  se ne konfigurise u zshrc-u ni globalno po masini.
- Admin bot po klonu (opcion): `node scripts/pripremi-admin-runtime.mjs <bot_token>
  <admin_id> [id_grupe]` pravi `.claude-runtime-admin/`, pa `instaliraj-cron.sh` sam doda
  posao `admin-bot`. Vlasnikov privatni kanal, admin MCP profil, uvijek pretplata, bez Bash-a.
  BotFather privacy za admin bota OSTAJE UKLJUCEN: u grupi prima samo mention i reply, pa se
  botovi vise klonova ne mijesaju u zajednickoj admin grupi.
- `scripts/instaliraj-cron.sh` instalira launchd poslove: snapshot 02:40, dnevna poruka 07:20,
  sedmicna ponedjeljkom 07:40, cuvar sesije (KeepAlive). Poslove vrti CLI `posao dnevni` i
  `posao sedmicni`, bez modela. Windows ekvivalent svih poslova:
  `deploy/windows/instaliraj-zadatke.ps1` (Task Scheduler).
- `scripts/azuriraj-sve.sh` povlaci tag `stabilno` u sve klonove iz `~/.olx-klijenti.txt`. Klon
  kod kojeg build ili test padne se preskace i njegovi servisi se ne restartuju. Windows
  ekvivalent: `deploy/windows/azuriraj.ps1` (isti popis, Task Scheduler umjesto launchd).
  Skripta se pokrece na masini gdje klonovi ZIVE, pa klonovi na Windowsu ne mogu biti azurirani
  sa macOS-a i obrnuto. Oba imaju `--suho` / `-Suho` za prikaz bez ikakve izmjene.
- `scripts/ai-runda.sh` (launchd sablon `ADMIN.ai-runda`, nedjelja 21h, instalira se rucno i
  jednom): sedmicna AI analiza svih klonova kroz vlasnikovu Claude pretplatu, headless i strogo
  read-only. Rezultat ide klijentu u grupu, prijedlozi u `.olx-pik/prijedlozi/` klona, a
  primjenjuje ih klijentski bot uz potvrdu (vidi skill olx-analiza-profila). Pogon
  interaktivnog klijentskog razgovora bira `OLX_KLIJENT_AI` u `.env` klona: pretplata je
  svjesni default za fazu testiranja prvih klijenata, cilj je DeepSeek API po klijentu.

## Pravila po slojevima

Detaljna pravila za kod, pogon i promptove su u `.claude/rules/` i ucitavaju se sama kad se
dotakne odgovarajuci fajl (`paths` frontmatter). Ne prepisuju se ovdje ni u skillove. Za
pitanja o platformi i API-ju koristi podagenta `olx-korpus` umjesto ucitavanja velikih
fajlova dokumentacije u razgovor.

Prije rada prema klijentu na klonu prvo `node scripts/provjeri-klon.mjs`: dok ijedna stavka
FALI, klijent se ne dira (detalji u CLAUDE.md, sekcija "Spremnost klona").

Jos dva podagenta za admina (rade i kroz admin bota, klijentska sesija ih ne vidi):

- `olx-prodaja` — argumentacija za prospekta iz dokumentacije, sa granicama kao anti-izvorom
  (nikad ne obecava ono sto platforma ne moze). Koristi kad treba uvjeriti ili odgovoriti na
  prigovor.
- `olx-dijagnostika` — simptom zivog pogona ("bot ne odgovara", "nema jutarnje poruke") u
  nalaz + dokaz + komandu za popravku. Nista ne mijenja sam; kroz admin bota radi bez Bash-a.

## Serijski poslovi

Za posao koji ide kroz mnogo oglasa koristi podagente iz `.claude/agents/`, ne jedan dugacak
razgovor. Razlog je izolacija konteksta: podagent vrati par redova umjesto punog payloada.
Determinizam ostaje u kodu, model se poziva samo za dio koji trazi prosudbu. Obrazac je u skillu
`olx-serijski-posao`.

## Interni alati (van MCP/CLI toolkita)

- `interno/pretraga-biznisa/` — klasifikacija shopova iz xlsx snimka po stvarnoj djelatnosti, ne
  po nazivu koji cesto laze. **Samo za internu analizu, nikad kod klijenta.** Vidi
  `interno/pretraga-biznisa/CLAUDE.md`.

## Izlaz u admin sesiji

Granice iz `granice.md` vrijede i ovdje, uz jednu razliku: tabela i duzi izvjestaj su dozvoljeni
kad ih trazi analiza, ali i dalje bez rekapitulacije procitanog i bez prepisivanja sirovih
podataka koje je alat vec vratio.
