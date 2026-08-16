---
name: olx-novi-klijent
description: >-
  Kompletna tehnicka postavka novog klijentskog klona, od kloniranja do zivog bota: .env,
  KLIJENT.md, Telegram runtime za oba bota, cron poslovi, preflight. Okidaci: "novi klijent",
  "postavi klijenta", "postavi sistem za", "onboarding klona", "kloniraj za klijenta",
  "postavi sve", "postavi sistem na novom racunaru".
---

# Postavka novog klijenta, od nule do zivog bota

Vodis covjeka (admina ili kolegu) kroz postavku i SAM izvrsavas sve sto se moze izvrsiti;
od covjeka trazis samo ono sto masina ne zna (tokeni, ID-evi, odluke). Jedno pitanje
odjednom. Nista se ne preskace: redoslijed je ovakav jer svaki korak zavisi od prethodnog.

Ovo je TEHNICKA postavka. Poslovni dio (kako od klijenta traziti token, baseline analiza,
dogovor o granicama) je u skillu `olx-klijent-flow` i radi se poslije ovoga.

Kad se klijent podize na NOVOJ masini a vec ima backup stanja (selidba, pokvaren disk), redoslijed
je drugaciji i pise u `references/oporavak.md`: vracanje stanja mora doci poslije pripreme
Telegram runtimea, jer se dio stanja upisuje preko onoga sto pripremna skripta sama generise.

## Upis odmah, ne u glavi (pravilo cijelog skilla)

Razgovor NIJE skladiste: restart ili kompaktovanje sesije brise sve sto je covjek poslao,
a onboarding zna trajati i preko vise sesija. Zato:

- Na samom pocetku napravi `.olx-pik/onboarding-stanje.md` (folder je van gita) i u njega
  upisi checklistu koraka. SVAKI podatak koji covjek posalje (token, ID, odluka) upisi u
  taj fajl ISTOG TRENA kad stigne, prije nego odgovoris. Tek onda nastavi razgovor.
- Cim je podatku poznato konacno mjesto, odmah ga i tamo upisi (OLX token u `.env`,
  bot tokeni kroz pripremi skripte cim su svi argumenti poznati), pa u stanje fajlu
  vrijednost tokena zamijeni sa "upisano u <mjesto>". Na kraju postavke fajl obrisi.
- Nova sesija koja zatekne `.olx-pik/onboarding-stanje.md` PRVO ga procita i nastavlja
  od prvog nezavrsenog koraka, ne ispocetka.
- Bot tokeni idu ISKLJUCIVO kroz `pripremi-runtime.mjs` / `pripremi-admin-runtime.mjs`.
  NIKAD `/telegram:configure`: on pise u globalni `~/.claude/channels/telegram/`, koji
  ovaj sistem ne cita (svaki bot zivi u svom `.claude-runtime*/channels/telegram/`), pa
  token zavrsi na pogresnom mjestu i curi van klona.

## 0. Sta treba prikupiti prije pocetka

Trazi od covjeka redom, objasni gdje se sta dobija:

1. **Kratko ime klijenta** — malim slovima, bez razmaka (npr. `mixbox`). Postaje ime
   foldera i ime zakazanih poslova.
2. **OLX token klijenta** — kako se trazi od klijenta objasnjava
   `olx-klijent-flow` (poruka za klijenta je u references tog skilla).
3. **Dva Telegram bota iz BotFathera** (`@BotFather`, komanda `/newbot`, jedan pa drugi):
   - KLIJENTOV bot: u BotFatheru `/setprivacy` -> **Disable** (mora vidjeti sve poruke grupe).
   - ADMIN bot: privacy se NE dira (ostaje Enable; u grupi prima samo mention i reply).
   Od oba treba bot token.
4. **ID klijentske grupe** (negativan broj) i **Telegram ID-evi** klijenta i njegovih ljudi
   koji smiju pisati botu. Najlakse: covjek posalje poruku botu `@userinfobot` (za svoj ID),
   a ID grupe se vidi kad se bot doda u grupu (ili kroz `@getidsbot`).
5. **Adminov Telegram ID** (za alarme i admin bota) i, opciono, ID admin grupe.
6. **Dnevni plafon kredita** (`OLX_MAX_SPEND_PER_DAY`) — odluka admina, ne ostavljati 0.
7. **Pogon klijentske sesije**: pretplata (faza testiranja) ili DeepSeek (tada treba i
   DeepSeek API kljuc).

## 1. Kloniranje (NIKAD se ne preskace)

Postavka se NE radi u glavnom/razvojnom repou, ni kad klijentovi podaci (KLIJENT.md, token
u .env) vec stoje u njemu od testiranja: razvoj i klijentski pogon se ne miješaju, jer
azuriranje preskace klonove sa lokalnim izmjenama, a klijentski state (audit, snapshoti)
zagadi dev okruzenje. Ako se skill pokrene u glavnom repou: kloniraj u novi folder,
prekopiraj `.env` i `KLIJENT.md` (i `.olx-pik/` ako vec ima istorije za tog klijenta,
ukljucujuci `onboarding-stanje.md`) u
novi klon, pa SVE dalje korake radi TAMO. Kloniranje radi i sa lokalne putanje:

```
git clone <url-repoa-ili-lokalna-putanja-glavnog-repoa> ~/olx-klijenti/<ime>
cd ~/olx-klijenti/<ime>
git checkout --detach stabilno
```

- Tag `stabilno` je jedina verzija koja ide klijentima; grana main je radionica. `stabilno` je
  prekidac koji pokazuje na oznaceno izdanje (`vX.Y.Z`), pa `git describe --tags` u klonu kaze
  tacno koje. Isto ispisuje i `provjeri-klon.mjs` kao prvu stavku.
- Pristup repou sa tudje masine: deploy key sa read pravima, NIKAD licni SSH kljuc admina.
- Jedan klon = jedan klijent. Za drugog klijenta novi klon, uvijek.

## 2. Konfiguracija klona

```
cp .env.example .env     # Windows: copy .env.example .env
cp KLIJENT.primjer.md KLIJENT.md
```

U `.env` popuni: `OLX_TOKEN`, `OLX_MCP_PROFILE=klijent`, `OLX_MAX_SPEND_PER_DAY`,
`TELEGRAM_BOT_TOKEN` (klijentov bot), `TELEGRAM_ADMIN_CHAT_ID`. `TELEGRAM_CHAT_ID` NE mora:
grupe dolaze iz `access.json` koji pravi sljedeci korak.
Za DeepSeek pogon jos `OLX_KLIJENT_AI=deepseek` i `OLX_DEEPSEEK_*` (vidi komentare u
`.env.example`). `KLIJENT.md` popuni sa adminom: ostaje u KORIJENU klona.

Popuni i `OLX_KLIJENT` (kratko ime, postaje grana stanja) i `OLX_STANJE_REPO` (privatan repo za
backup). Bez njih se posao `backup` ne instalira, pa pamcenje, izuzeca i snapshoti tog klijenta
postoje samo na disku ove masine, a snapshoti se retroaktivno ne mogu vratiti.

## 3. Build

Tri komande u tri poteza (PowerShell 5.1 nema `&&`):

```
bun install
bun run build
bun run test
```

## 4. Telegram runtime, oba bota

```
bun scripts/pripremi-runtime.mjs <klijentov_bot_token> <id_grupe> <id1,id2,...>
bun scripts/pripremi-admin-runtime.mjs <admin_bot_token> <admin_telegram_id> [id_admin_grupe]
```

- Prva komanda pravi `.claude-runtime/` (klijentska sesija), druga `.claude-runtime-admin/`
  (adminova sesija). Token svakog bota zivi u SVOM runtime folderu i sesije se ne mogu
  pomijesati: most (`telegram-most.mjs`) svakoj kaze njen folder kroz CLAUDE_CONFIG_DIR.
- Windows: kredencijali pretplate zive u config diru, pa jednom po runtime-u u PowerShellu
  `claude login`, i to PRIJE instalacije poslova (korak 5), jer instalater sesije startuje
  odmah. Prvo obavezni klijentski runtime AKO sesija ide na pretplatu
  (`$env:CLAUDE_CONFIG_DIR=".claude-runtime"` pa `claude login`); na DeepSeeku ne treba
  (auth ide kroz `OLX_DEEPSEEK_AUTH_TOKEN` iz `.env`). Zatim isto sa
  `.claude-runtime-admin` ako se postavlja admin bot (on je uvijek na pretplati).
  macOS to ne treba, Keychain.
- **Telegram plugin se instalira PO RUNTIME-u, ne globalno.** Plugin cache stoji u
  `$CLAUDE_CONFIG_DIR/plugins/`, pa instalacija u `~/.claude` klijentskoj sesiji ne znaci nista.
  Bez njega bot ne odgovara na poruke, a jutarnji izvjestaji svejedno stizu (njih salje cron
  mimo sesije), pa kvar lako prodje neopazeno. Pripremi skripte ga instaliraju SAME na kraju
  pripreme; provjeri njihov izlaz. Ako je instalacija pala (nema GitHub SSH kljuca za kloniranje
  marketplacea, nema mreze), rucno:

  ```
  CLAUDE_CONFIG_DIR=.claude-runtime claude plugin marketplace add anthropics/claude-plugins-official
  CLAUDE_CONFIG_DIR=.claude-runtime claude plugin install telegram@claude-plugins-official
  ```

  PowerShell: `$env:CLAUDE_CONFIG_DIR=".claude-runtime"; claude plugin marketplace add ...` pa
  `claude plugin install ...`. Isto ponovi sa `.claude-runtime-admin` ako se postavlja i admin
  bot. Zauzima oko 38 MB po runtime-u.
- **`bun` mora biti u PATH-u.** Plugin dize svoj MCP server sa `bun run`; bez njega bot cuti bez
  ijedne greske na vidljivom mjestu. Instalacija: https://bun.sh
- Dodaj oba bota u odgovarajuce grupe na Telegramu.
- **Druga i svaka sljedeca klijentova grupa NE ide ponovnim pokretanjem `pripremi-runtime.mjs`**:
  ta skripta odbija rad na postojecem runtime-u, pa bi je covjek prosao tek nakon brisanja
  runtimea, sto gubi sva uparivanja. Umjesto toga:

  ```
  bun dist/cli/index.js telegram grupe dodaj <id_grupe>
  bun dist/cli/index.js telegram grupe
  ```

  Id grupe se ocita iz `@getidsbot`. Prva komanda je idempotentna, druga pokazuje kome tacno idu
  izvjestaji. Izvjestaji krecu odmah; da bot POCNE odgovarati u novoj grupi, restartuj klijentsku
  sesiju (plugin cita `access.json` pri startu).

## 4c. Prva proba sesije, u istom terminalu

```
bun scripts/pokreni-klijenta.mjs
```

Radi na obje platforme i greska se vidi ODMAH u prvom planu (pogresan login, plugin, bun,
token), umjesto da se trazi po logu mosta. Kad bot odgovori na "zdravo" u grupi, ugasi
sesiju sa Ctrl+C pa tek onda instaliraj poslove. Redoslijed je bitan: posao `sesija`
(telegram-most.mjs) iz koraka 5 odmah digne svoju sesiju, a dvije sesije na istom bot tokenu
se sudaraju na Telegramu (dupli odgovori, 409).

## 5. Zakazani poslovi (snapshot, jutarnja poruka, sedmicni pregled, obje sesije)

```
scripts/instaliraj-cron.sh
```

Windows: `powershell -ExecutionPolicy Bypass -File deploy/windows/instaliraj-zadatke.ps1`

## 6. Preflight, kapija bez izuzetka

```
bun scripts/provjeri-klon.mjs
```

Dok ijedna stavka pise FALI, sa klijentom se NE pocinje: svaka stavka nosi tacnu komandu za
popravku, radi ih redom pa pokreni provjeru ponovo.

## 7. Probe uzivo

- U klijentskoj grupi covjek napise "zdravo": bot mora odgovoriti.
- U admin grupi (ako postoji) mention admin bota: mora odgovoriti; poruka BEZ mentiona ne
  smije dobiti odgovor.
- Posalji sliku u klijentsku grupu i trazi objavu: prolazi kroz skill objave do potvrde.

## 8. Upis u flotu

Dodaj putanju klona u `~/.olx-klijenti.txt` (jedna putanja po liniji) NA MASINI GDJE KLON ZIVI.
Bez toga klon ne dobija azuriranja, sedmicnu AI rundu ni jutarnje kupljenje saznanja.

Azuriranje se pokrece tamo gdje su klonovi, jer restartuje njihove poslove: `azuriraj-sve.sh`
na macOS-u i Linuxu, `deploy\windows\azuriraj.ps1` na Windowsu. Klon na Windowsu se ne moze
azurirati sa macOS-a. Tok od commita do klijenta je opisan u `olx-dokumentacija/arhitektura.md`,
sekcija 7.

## 9. Dalje

Poslovni onboarding: skill `olx-klijent-flow` (baseline analiza, dogovor o granicama,
evidencija). Mapa cijelog sistema: `olx-dokumentacija/arhitektura.md`.

Ako klijent uz postavku donese i vec gotovu listu artikala za objavu, to nije dio ove tehnicke
postavke: kad je lista duza od onoga sto se objavi u jednom danu, ide u `olx-serijski-posao`.
