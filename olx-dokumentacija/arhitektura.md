# Arhitektura sistema

Mapa cijelog sistema na jednom mjestu: sta postoji, ko s kim prica, sta radi samo a sta se
pokrece rucno. Dijagrami su mermaid, render ih GitHub, Claude i vecina editora.

Kljucna ideja sistema u jednoj recenici: **sve sto se moze izracunati radi kod bez AI-ja i
kosta nula tokena; AI se poziva samo tamo gdje treba razumijevanje ili prosudba.**

## 1. Velika slika

Jedan klon repoa po klijentu, sve na admin masini. Po klonu DVIJE stalne sesije (klijentska i
admin bot), plus cron poslovi bez modela i sedmicna AI runda. Sesije su uvijek dvije, ali broj
botova i procesa ZAVISI OD REZIMA: dvobotni rezim (default) drzi dva bota, dva tokena i dva
procesa mosta, a jednobotni rezim (opcion, ukljucuje se sa `OLX_MOST_ADMIN_TG_ID` u `.env`) drzi
JEDAN bot, JEDAN token i JEDAN proces mosta koji vozi obje sesije, rutirajuci po poruci.

```mermaid
flowchart LR
    vlasnik["Vlasnik shopa"] <-->|"poruke i slike"| tg["Telegram grupa klijenta"]
    admin["Administrator"] <-->|"dvobotni: mention ili reply u grupi<br/>jednobotni: samo privatna poruka"| atg["Admin Telegram grupa ili DM<br/>dvobotni: botovi vise klonova, privacy ukljucen<br/>jednobotni: DM sa istim bot tokenom kao klijent"]

    subgraph klon["Klon repoa za JEDNOG klijenta"]
        sesija["Klijentska Claude sesija<br/>SISTEM-klijent.md, profil klijent<br/>pogon: OLX_KLIJENT_AI iz .env<br/>(pretplata dok se testira, kasnije DeepSeek)"]
        asesija["Admin bot sesija (opcion)<br/>SISTEM-admin-bot.md, profil admin<br/>uvijek pretplata, bez Bash-a"]
        mcp["MCP server<br/>klijent 32 / admin 45 alata<br/>zastite u kodu: potvrda troska,<br/>dnevni plafon, nema brisanja"]
        cron["Cron poslovi BEZ modela<br/>CLI: snapshot, dnevni, sedmicni<br/>nula tokena"]
        disk[("Disk klona<br/>.olx-pik: audit, snapshoti, prijedlozi<br/>.claude-runtime i .claude-runtime-admin<br/>(admin runtime treba u OBA rezima)")]
    end

    most["Telegram most<br/>telegram-most.mjs<br/>dvobotni: dva procesa, po jedan token svaki<br/>jednobotni: JEDAN proces, JEDAN token, rutira po poruci"] -.->|"digne na prvu poruku, gasi na<br/>idle prag OLX_MOST_IDLE_MIN (default 30min,<br/>admin OLX_MOST_ADMIN_IDLE_MIN) ili<br/>nocni rez OLX_MOST_RESTART_SAT (default 3h)"| sesija
    most -.-> asesija

    tg <--> sesija
    atg <--> asesija
    sesija --> mcp
    asesija --> mcp
    cron -->|"jutarnja 07:20 i<br/>sedmicna poruka pon 07:40"| tg
    cron --> disk
    mcp --> olx["OLX / PIK API"]
    cron --> olx

    runda["AI runda, nedjelja 21h<br/>admin Claude pretplata<br/>STROGO read-only"] -->|"analiza u grupu,<br/>prijedlozi na disk"| tg
    runda --> disk
    runda --> mcp
```

Napomena o rezimima (radi citljivosti dijagrama nije sve u njemu): u **dvobotnom** rezimu (default)
klijentski i admin bot su dva odvojena Telegram bota, svaki sa svojim tokenom, i most ih vozi kao
dva odvojena procesa. U **jednobotnom** rezimu (opcion, ukljucuje se sa `OLX_MOST_ADMIN_TG_ID` u
`.env` klona) postoji samo JEDAN bot token i JEDAN proces mosta; `sesija` i `asesija` su i dalje
dvije odvojene zive Claude sesije sa odvojenim kontekstom i alatima, ali ih vozi isti proces, koji
rutira svaku dolaznu poruku na jednu od njih po posiljaocu (vlasnikova privatna poruka ide na
admin sesiju, sve ostalo na klijentsku). Detalji rutiranja su u sekciji 2.

Prompt sesije se SASTAVLJA pri svakom pokretanju (`scripts/sastavi-prompt.mjs`): pravila
razgovora, pa javni profil klijenta (`KLIJENT-javno.md`), pa pamcenje koje je bot sam zapisao
(`.olx-pik/pamcenje.json`, alat `olx_zapamti`). Razlog je tehnicki:
`--append-system-prompt-file` nije aditivan, sa dva fajla vazi samo zadnji. Posljedica je da
sistem raste uz klijenta: sesija se resetuje svaku noc, a pamcenje se tada ponovo ubaci u prompt,
pa bot od prve poruke zna ton, footer i navike bez ijednog poziva alata. `KLIJENT.md` u tome NE
ucestvuje: on nosi tokene i komercijalni dogovor i ostaje zabranjen klijentskoj sesiji.

Skidanje artikala: kad artikla nema na stanju, bot ga na zahtjev arhivira
(`.olx-pik/arhiva-artikala/<id>/`, opis oglasa + originalne slike kao bajtovi) pa sakrije
(`olx_skini_artikal`). Povratak (`olx_vrati_artikal`) skriven oglas samo otkrije; kad oglasa
vise nema, objavi novi iz arhive sa originalnim slikama i prenese izuzece na novi broj. Arhiva
ide u backup (jedini primjerak slika kad oglas nestane) i raste samo eksplicitnom odlukom
klijenta.

Granice pogona:

- Klijentsku sesiju pogoni ono sto kaze `OLX_KLIJENT_AI` u `.env` klona: `pretplata` dok prvih
  klijenata testira, kasnije `deepseek` (bez popunjenih OLX_DEEPSEEK_* varijabli sesija se ne
  pokrece). Nista se ne konfigurise globalno po masini, sve je u repou i `.env`.
- Admin bot i AI runda su iskljucivo vlasnikov kanal i uvijek idu na pretplatu. Klijent sa
  pretplatom nikad ne razgovara direktno.
- Admin botovi vise klonova zive u jednoj admin grupi: privacy u BotFatheru im OSTAJE ukljucen,
  pa svaki prima samo poruke u kojima je oznacen i odgovore na svoje poruke. Kontekst botova se
  ne mijesa, a reply radi kao obracanje.

## 2. Sta se desava kad klijent posalje poruku

```mermaid
sequenceDiagram
    participant V as Vlasnik shopa
    participant T as Telegram bot
    participant S as Claude sesija
    participant M as MCP server
    participant O as OLX API

    V->>T: "Stavi Golfa na 14.900"
    T->>S: poruka (slika ide na disk, u inbox)
    S->>M: nadji moj oglas "Golf"
    M->>O: citanje oglasa
    O-->>M: podaci
    M-->>S: kompaktan rezultat
    Note over S: besplatna izmjena: radi odmah.<br/>Trosak kredita: prvo cijena, pa pitanje.
    S->>M: izmjena cijene
    M->>O: upis
    M->>M: zapis u audit log
    S-->>T: "Golf je sada na 14.900 KM."
    T-->>V: odgovor
```

Za trosak kredita (izdvajanje, akcija, naplatna objava) alat u kodu ODBIJA izvrsenje bez
`confirm`; prompt trazi da se klijentu prvo kaze cijena. Dvije nezavisne brane.

Ovaj tok vazi za "T" (Telegram bot) kao klijentski bot, u oba rezima. U jednobotnom rezimu, PRIJE
nego poruka udje u ovaj tok, most odlucuje KOJA sesija je prima: privatna poruka tacno sa
`OLX_MOST_ADMIN_TG_ID` ide na admin sesiju (ne na ovaj dijagram, nego na admin ekvivalent, MCP
profil admin), svaka poruka u grupi i svaka privatna poruka drugog ID-a ide na sesiju iznad. To
rutiranje je jedina razlika prema dvobotnom rezimu; sve od "S" nadalje je isto.

## 3. Automatski poslovi: ko, kad i sta

Nista od ovoga ne poziva model osim AI runde. Termini su razmaknuti namjerno.

```mermaid
flowchart TB
    subgraph dan["Svaki dan"]
        s1["02:40 snapshot<br/>snimi preglede svih oglasa u fajl<br/>bez ovoga nema trendova"]
        s2["03:00 nocni rez konteksta<br/>gasi zivu sesiju i BRISE kljuc, ciscenje inboxa<br/>radi telegram-most.mjs (OLX_MOST_RESTART_SAT)<br/>sljedeca poruka digne sesiju bez --resume"]
        s3["07:20 dnevni posao<br/>obnove unutar besplatne kvote<br/>TEK kad klijent izabere ritam<br/>pa jutarnja poruka u SVE grupe"]
        s8["08:10 backup stanja<br/>pamcenje, izuzeca, audit, snapshoti<br/>na privatnu granu klijenta"]
    end
    subgraph danAdmin["Svaki dan, ADMIN masina"]
        s10["06:30 nadzor flote<br/>disk+CPU+PSI+memorija svih klonova<br/>svaka 3 dana i analiza na Telegram"]
    end
    subgraph sedmica["Sedmicno"]
        s4["ponedjeljak 07:40<br/>sedmicni pregled u grupu:<br/>sta raste, sta miruje"]
        s9["ponedjeljak 09:00 nadzor backupa<br/>pita daljinski repo za svaki klon<br/>javi samo sto kasni"]
        s5["nedjelja 21:00 AI runda<br/>analiza + prijedlozi po klijentu<br/>admin pretplata, read-only"]
    end
    subgraph stalno["Stalno"]
        s6["Telegram most, klijent<br/>jedan proces, drzi getUpdates i red na disku<br/>digne sesiju na poruku, gasi na idle 30min<br/>(OLX_MOST_IDLE_MIN) ili nocni rez 03h<br/>uzorak resursa svakih 5min aktivno / 30min mirno"]
        s7["Telegram most, admin-bot (opcion)<br/>SAMO u dvobotnom rezimu, odvojen proces<br/>ista mehanika, isti fajl, druga uloga<br/>OLX_MOST_ADMIN_IDLE_MIN override po potrebi<br/>u jednobotnom rezimu ovog posla NEMA,<br/>admin uloga zivi u istom procesu kao s6"]
    end

    s1 --> s3
    s3 --> s8
    s1 --> s4
    s1 --> s5
    s8 --> s9
```

Zakazivanje: macOS launchd (instalira `scripts/instaliraj-cron.sh`, po klonu), Windows Task
Scheduler (`deploy/windows/instaliraj-zadatke.ps1`). Tri posla su izuzetak i zive globalno na
admin masini, jer sami obilaze sve klonove iz `~/.olx-klijenti.txt`: AI runda
(`ADMIN.ai-runda.plist`), nadzor backupa (`ADMIN.backup-nadzor.plist`) i nadzor flote
(`ADMIN.nadzor-flote.plist`, jedini od ova tri koji se pokrece SVAKI DAN, ne sedmicno, jer dnevna
kolekcija CPU/disk/PSI mora ostati gusta), sva tri se instaliraju rucno jednom.

Backup je jedini posao koji je uslovan: instalira se samo kad je `OLX_STANJE_REPO` popunjen u
`.env`. Bez toga bi svako jutro pao i slao alarm, a klon bi imao jedan pokvaren zadatak vise.

Automatske obnove NISU ukljucene same od sebe (odluka vlasnika 04.08.2026): dok klijent ne kaze
svoj ritam, dnevni posao ne obnavlja nista, a prva jutarnja poruka ga pita kako zeli (sa brojem i
listom danas dostupnih oglasa, narednih dana samo podsjetnik u jednoj liniji). Njegov odgovor bot
zapise kao ritam (`.olx-pik/ritam-obnova.json`, ukljucujuci i "iskljuceno"), a pojedinacne
artikle sklanja lista izuzetaka (`.olx-pik/izuzeca.json`).

Admin i pad, i oporavak: svaki zakazani posao na padu javlja adminu preko `posaoFail`
(`.olx-pik/posao-stanje.json`, `src/core/posao-stanje.ts` pamti ishod ZADNJEG pokretanja po
imenu posla). Do sada je to bila jedina poruka; nocni `stats snapshot` i `posao dnevni` sada
javljaju adminu i na OPORAVAK, ali samo na prelazu pad prema uspjehu, ne na svako uspjesno
pokretanje: uspjeh poslije uspjeha ne salje nista, jer bi svakodnevna poruka o tome da je sve u
redu postala sum koji se ignorise. Djelimican prolaz snapshota (nastavak preko vise pokretanja
zbog budzeta) racuna se kao uspjeh i takodjer gasi zabiljezeni pad, a poruka je iskrena o tome
sta je zavrseno: kaze da se prolaz nastavlja i koliko je oglasa dosad obidjeno. U dnevnom poslu
isti tekst (jedan izvor, `porukaOOporavkuPosla`) kaze koliko je oglasa obnovljeno, ili da nije
bilo nista novo za javiti. Rezim `--suho` dnevnog posla ne dira zabiljezeno stanje i ne salje
obavijest (rucna dijagnostika ne obnavlja nista), a `--bez-slanja` upisuje uspjeh ali ne salje
poruku, jer je korisnik izricito trazio da se ne salje. Obrazac je namjerno prosiriv na
`sedmicni` i `backup` (svaki novi posao samo dodaje svoj kljuc u isti fajl), ali oni jos nisu
povezani na obavijest o oporavku.

Kome idu izvjestaji: svakoj grupi pod `groups` u `.claude-runtime/channels/telegram/access.json`,
plus `TELEGRAM_CHAT_ID` iz `.env` kao dopuni, dedupirano. Isti fajl odlucuje i od koga bot PRIMA
poruke, pa se spisak ne vodi dvaput. Bot API nema poziv koji vraca u kojim je bot grupama, a
`my_chat_member` je nedostupan jer polling drzi Telegram plugin ziva sesija, pa se id nove grupe
ocita rucno jednom. Sedmicni posao usput radi `getChat` nad svakim odredistem i javi ADMINU kad
je bot iz neke grupe izbacen; sam ne uklanja nista, jer prelazak grupe u supergrupu mijenja id.

## 4. AI runda i primjena prijedloga

```mermaid
sequenceDiagram
    participant L as launchd nedjelja 21h
    participant R as ai-runda.sh
    participant H as headless Claude sesija
    participant D as disk klona
    participant T as Telegram grupa
    participant V as Vlasnik shopa
    participant B as klijentski bot

    L->>R: pokreni rundu
    loop za svaki klon iz ~/.olx-klijenti.txt
        R->>H: claude -p sa receptom ai-runda.md<br/>mutirajuci alati ISKLJUCENI
        H->>H: analiza profila, SEO, trijaza,<br/>konkurenti (podagenti)
        H->>D: prijedlozi u .olx-pik/prijedlozi/
        H-->>R: gotova poruka za klijenta
        R->>T: posalji kroz bot tog klona
    end
    R->>R: zbir adminu u DM
    V->>B: "primijeni prijedloge"
    B->>D: procitaj najnoviji fajl prijedloga
    B->>V: pobroji stavke, trazi potvrdu po grupi
    V->>B: "moze"
    B->>B: primijeni postojecim alatima,<br/>trosak i dalje trazi cijenu pa potvrdu
```

Ako runda naleti na limit pretplate, prekida se odmah i javlja adminu, da ostali klijenti ne
dobiju polovicne analize.

## 5. Sta je automatski, a sta rucno

| Automatski, ne diras | Rucno, admin |
| --- | --- |
| dnevne obnove i jutarnja poruka | onboarding novog klijenta (lista ispod) |
| nocni snapshot pregleda | `azuriraj-sve.sh` / `deploy\windows\azuriraj.ps1` kad izadje nova verzija |
| sedmicni pregled ponedjeljkom | `ai-runda.sh` dok se ne instalira plist |
| most drzi obje sesije: dizanje, idle/nocni rez, red na disku | `provjeri-prompt.sh` poslije izmjene promptova |
| AI runda kad se plist instalira | serijski poslovi po zelji (SEO prolaz, ciscenje) |
| audit log svake izmjene i troska (nosi i verziju) | pravo brisanje oglasa (`listings rm`) |
| prijava da klon zaostaje za izdanjem (hook pri startu sesije) | izdanje i pustanje u flotu (`izdanje.mjs`, skill `olx-izdanje`) |
| admin bot: nadzor i rad preko Telegrama | priprema admin runtime-a (jednom po klonu) |
| most drzi sesiju zivom (digne na poruku, idle i nocni rez konteksta) | rucna proba sesije u prvom planu: `bun scripts/pokreni-klijenta.mjs` (prije nje ugasiti posao `sesija`, dva konzumera na istom bot tokenu daju 409) |
| biljezenje tokena u transkriptima sesija | `bun run tokeni -- --upisi` sedmicno (trajni dnevnik) |

## 6. Onboarding novog klijenta (rucni koraci, redom)

**Izvrsna verzija ove liste je skill `olx-novi-klijent`**: otvori Claude Code i reci
"postavi novog klijenta", sesija vodi kroz sve korake i sama izvrsava sto moze. Lista ispod
je referenca istog redoslijeda. Na kraju UVIJEK `bun scripts/provjeri-klon.mjs`: dok ijedna
stavka FALI, sa klijentom se ne pocinje.

1. Kloniraj repo u novi folder (jedan klon = jedan nalog), pa `git checkout --detach stabilno`.
2. `.env`: `OLX_TOKEN`, `OLX_MCP_PROFILE=klijent`, `OLX_MAX_SPEND_PER_DAY`, Telegram varijable,
   pa `OLX_KLIJENT` i `OLX_STANJE_REPO` za backup stanja (bez njih klijentovo pamcenje, izuzeca i
   snapshoti postoje samo na disku te masine).
3. Build: `bun install`, pa `bun run build`, pa `bun run test` (tri poteza; PowerShell 5.1 nema `&&`).
4. BotFather: novi bot, pa `/setprivacy` na Disable.
5. `bun scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>` — pravi izolovani
   runtime (svoj bot, svoj allowlist, bez globalnih servera). Ta skripta radi SAMO jednom, na
   praznom klonu: svaku sljedecu grupu dodaje `telegram grupe dodaj <id>`, jer bi brisanje
   runtimea radi ponovne pripreme pobrisalo sva uparivanja.
5b. Telegram plugin U TAJ runtime, jer plugin cache ide po `CLAUDE_CONFIG_DIR`. Pripremi
   skripta ga instalira SAMA na kraju pripreme; provjeri njen izlaz. Ako je instalacija pala
   (SSH kljuc, mreza), rucno:
   `CLAUDE_CONFIG_DIR=.claude-runtime claude plugin marketplace add anthropics/claude-plugins-official`
   pa `... claude plugin install telegram@claude-plugins-official` (PowerShell:
   `$env:CLAUDE_CONFIG_DIR=".claude-runtime"; claude plugin marketplace add ...; claude plugin install ...`).
   Uz to `bun` u PATH-u, jer plugin njime dize svoj MCP server. Bez oba bot ne odgovara na
   poruke, ali izvjestaji stizu, pa se kvar previdi.
5c. Windows, sesija na pretplati: jednom po runtime-u `$env:CLAUDE_CONFIG_DIR=".claude-runtime"`
   pa `claude login`, i to PRIJE instalacije poslova (kredencijali zive u config diru; na
   DeepSeeku ne treba, na macOS-u je pretplata u Keychainu).
6. Prva proba sesije: `bun scripts/pokreni-klijenta.mjs` u istom terminalu, na obje platforme.
   Greska (login, plugin, bun, token) se vidi odmah u prvom planu. Ugasi sa Ctrl+C prije
   sljedeceg koraka: posao `sesija` (telegram-most.mjs) odmah digne svoju sesiju, a dvije sesije
   na istom bot tokenu se sudaraju na Telegramu.
7. `scripts/instaliraj-cron.sh` (macOS) ili
   `powershell -ExecutionPolicy Bypass -File deploy/windows/instaliraj-zadatke.ps1` (Windows):
   instalira poslove, ukljucujuci most (`telegram-most.mjs`) koji odmah digne sesiju, i backup
   kad je podesen.
8. Dodaj putanju klona u `~/.olx-klijenti.txt` NA MASINI GDJE KLON ZIVI (azuriranja i AI runda).
9. Test iz grupe: pitanje, objava sa slikom, i jedan trosak da se vidi tok potvrde.
10. Opcion, admin sesija, dva rezima (izbor se pravi na pocetku postavke):
    - **Dvobotni** (dva bota, admin grupa moguca): novi bot u BotFatheru (privacy NE dirati,
      ostaje ukljucen), pa `bun scripts/pripremi-admin-runtime.mjs <bot_token> <tvoj_id>
      [id_admin_grupe]`, pa ponovo instalater poslova iz koraka 7.
    - **Jednobotni** (jedan bot, samo privatni razgovor): `bun scripts/pripremi-admin-runtime.mjs
      --bez-bota <tvoj_id>` (drugog bota nema, ne pise token), pa u `.env` klona
      `OLX_MOST_ADMIN_TG_ID=<tvoj_id>`, pa ponovo instalater poslova iz koraka 7 (posao `admin-bot`
      se u ovom rezimu ne instalira, admin uloga ide kroz isti posao `sesija`).
    Windows login korak OSTAJE isti u OBA rezima: jedan `claude login` sa
   `$env:CLAUDE_CONFIG_DIR=".claude-runtime-admin"` (na macOS-u ne treba, pretplata je u
   Keychainu), jer `.claude-runtime-admin` treba u oba rezima bez obzira nosi li svoj bot token.

## 7. Kako nova verzija dolazi do klijenata

Klijentski klonovi NE prate granu. Oni stoje na tagu `stabilno`, u detached stanju. To je
kapija: los commit fizicki ne moze doci do klijenta dok ga administrator ne propusti.

Dva taga rade zajedno i imaju razlicite poslove:

- **`vX.Y.Z`** je nepomican dokaz sta je izdanje. Anotiran tag, nikad se ne pomjera. Bez njega
  vracanje na prethodnu verziju nema cilj, jer pomjeren `stabilno` vise nigdje ne postoji.
- **`stabilno`** je prekidac koji kaze koje izdanje flota vozi. Lightweight tag, pomjera se.

```
rad na main  ->  test na svom klonu  ->  bun pm version  ->  tag vX.Y.Z  ->  stabilno  ->  azuriraj
```

1. Rad ide na `main`. Feature grana se spoji u `main` kad je gotova.
2. Na svom klonu: `bun run test`, `bun run typecheck`, `scripts/provjeri-prompt.sh`. Tag se ne
   pomjera na neprovjereno stanje.
3. `bun pm version <broj>`: hook `preversion` sam vrti `bun run test`, pa se broj podigne u
   `package.json` i `package-lock.json`, hook `version` prepise `src/core/verzija.ts` kroz
   `scripts/upisi-verziju.mjs`, i npm napravi commit i anotiran tag `vX.Y.Z`. Prije toga upisi
   sekciju u `CHANGELOG.md`: test pada ako izdanje nema zapis.
4. `bun scripts/pusti-u-flotu.mjs` gura commit i tagove na remote i tu STANE. Do ove tacke je sve
   povratno.
5. Nepovratni dio, iza eksplicitne zastavice: `bun scripts/pusti-u-flotu.mjs --pomjeri-stabilno`
   pomjeri prekidac na izdanje i sam pokrene azuriranje flote. Prekidac ide zadnji namjerno:
   `stabilno` je jedini ref koji flota prati, pa se pomjera samo kad je sve ostalo vec na remoteu.
   **Pokrece se na masini gdje klonovi zive**, jer restartuje njihove poslove: klonovi na Windowsu
   se ne mogu azurirati sa macOS-a ni obrnuto.

Cijeli tok od "posao je gotov" do "flota vozi novo", ukljucujuci changelog i evidenciju, vodi skill
`olx-izdanje`. Rucne komande ispod su ono sto on izvrsava, ne alternativa njemu.

| Masina | Komanda | Prikaz bez izmjene |
| --- | --- | --- |
| macOS, Linux | `scripts/azuriraj-sve.sh` | `scripts/azuriraj-sve.sh --suho` |
| Windows | `powershell -ExecutionPolicy Bypass -File deploy\windows\azuriraj.ps1` | isto uz `-Suho` |
| jedan klon, iz njega samog | `bun scripts/azuriraj-ovaj-klon.mjs [--restart]` | isto uz `--suho` |

Verzija ne mora biti napravljena rucno: `bun scripts/izdanje.mjs <broj>` odbija izdanje koje bi
bilo polovicno (pogresna grana, prljava kopija, klon iza remotea, zauzet tag, nedostajuca sekcija u
`CHANGELOG.md`), pa pusti `bun pm version` da vrti testove i tagira. Skill: `olx-izdanje`.

Klon ne prati nista sam, pa ne zna kad se prekidac pomjeri. To rjesava `SessionStart` hook
(`provjeri-izdanje.mjs --samo-zaostajanje`): pri pokretanju sesije javi da klon zaostaje i da
komandu, ali NIKAD ne povlaci sam. Dva razloga: zamjena koda ispod zive sesije ostavlja MCP server
na starom buildu, a automatsko povlacenje u 03:00 zaobilazi kapiju i moze ostaviti klijenta bez
bota. U klijentskoj bot sesiji je hook tih, jer bi mu izlaz usao u kontekst bota.

`azuriraj-ovaj-klon.mjs` ima jednu razliku prema flotnim skriptama koja je namjerna: kad build ili
testovi padnu, klon se VRACA na izdanje sa kojeg je krenuo i ponovo se izgradi. Flotne skripte tu
ostavljaju checkout, pa klon zavrsi sa novim `src` i starim `dist`. Vrijedi ih na to poravnati kad
se budu dirale.

Oba rade isto, po klonu iz `~/.olx-klijenti.txt`: fetch tagova **sa `--force`**, checkout
`stabilno`, `bun install`, build, testovi, pa restart samo DUGOZIVIH poslova (`sesija`,
`admin-bot` u dvobotnom rezimu; u jednobotnom rezimu postoji samo `sesija`, jer admin uloga zivi u
istom procesu).
Na kraju prijavljuju i na kojem je izdanju flota (`git describe --tags`), pa razilazenje izdanja
medju klonovima ne moze proci neopazeno.

`--force` nije kozmetika: `git fetch --tags` bez njega ODBIJA pomjeriti tag koji lokalno vec
postoji ("would clobber existing tag"), pa je klon ostajao na starom commitu dok checkout, build i
testovi prodju i skripta prijavi uspjeh. Tiho neazuriranje flote je najgori ishod te skripte
(izmjereno 30.07.2026, popravljeno u 0.4.0).

Tri pravila koja su u obje skripte i nisu slucajna:

- **Klon sa lokalnim izmjenama se preskace.** Neko je rucno nesto mijenjao; pregaziti to je gore
  od neazuriranog klona.
- **Kad build ili testovi padnu, zadaci tog klona se NE diraju.** Klijent na staroj radnoj
  verziji je bolji od klijenta na polovicno azuriranoj.
- **Kalendarski poslovi (snapshot, dnevno, sedmicno) se ne restartuju.** Njihov "restart" bi ih
  IZVRSIO odmah, pa bi klijent dobio jutarnji izvjestaj usred dana i potrosila bi se dnevna
  runda obnova van reda. Oni novi kod uzmu sami na sljedecem terminu, jer su jednokratni node
  procesi. Restart treba samo sesijama, jer one jedine drze stari kod i stari prompt u memoriji.

Vracanje na prethodnu verziju je pomjeranje prekidaca na prethodno izdanje pa ponovo azuriranje, i
to je jedan potez:

```
bun scripts/pusti-u-flotu.mjs --izdanje v0.3.0 --pomjeri-stabilno
```

Samo pomjeranje taga ne mijenja nista ni na jednoj masini, jer nema posla koji automatski povlaci.
Sta je bilo prethodno izdanje procitaj iz `CHANGELOG.md` ili `git tag -l "v*"`.

Jedan rub koji vrijedi znati: azuriranje preskace klon sa lokalnim izmjenama, pa i vracanje moze
tiho ostaviti jedan klon na losoj verziji. Na kojem je izdanju koji klon vidi se u zbiru
azuriranja i u `bun scripts/provjeri-klon.mjs` (prva stavka).

## 8. Gdje zivi klijentsko stanje i kako se spasava

Kod i stanje se NIKAD ne mijesaju. To su dva odvojena repoa i dva odvojena toka:

```
kod:     mob-dev-org/olx-mcp-api   tag stabilno -> vX.Y.Z   ->  svi klonovi, ista verzija
stanje:  <org>/olx-stanje          grana po klijentu  <-  svaki klon salje svoje
```

**Zasto stanje ne moze u repo koda**, iako grana po klijentu na prvi pogled zvuci uredno:

- `azuriraj-sve.sh` preskace klon koji ima lokalne izmjene. Svaki upis pamcenja bio bi lokalna
  izmjena, pa se nijedan klon vise nikad ne bi azurirao.
- Azuriranje radi `git checkout --detach stabilno`. Fajlovi koji postoje na klijentskoj grani a
  ne u tagu bi se pri tome obrisali iz radnog foldera, dakle pamcenje bi nestajalo pri svakom
  azuriranju.
- Danas svi klijenti rade bit za bit isti kod, pa jedan prolaz testova pokriva flotu. Grana po
  klijentu u repou koda bi to ukinula.

**Zasto grana po klijentu u repou stanja jeste ispravna:** na jedan ref pise samo jedna masina,
pa je push uvijek fast forward i spajanja nema. Folder po klijentu na jednoj grani bi znacio da
svaki klon svaki dan pise na isti ref, dakle pull i rebase petlja u automatskom poslu.

Tri pravila koja backup nikad ne krsi:

- **Bijeli spisak, ne crni.** Salje se samo ono sto je izricito navedeno. Crni spisak bi tiho
  objavio svaki novi fajl koji neko kasnije doda. Sto nije ni na jednom spisku, prijavi se adminu
  kao nepoznato, pa spisak ne moze ostati ustajao a da se to ne primijeti.
- **Nikad force, nikad merge, nikad rebase.** Na razilazenje stanje ide na granu
  `<grana>-sudar-<masina>-<datum>` i javi se adminu. Prije toga se dvije masine na istoj grani
  zaustave preko `MASINA.json`, jos prije ijednog commita.
- **Nijedan token ne izlazi.** Uz bijeli spisak radi i provjera sadrzaja: fajl u kojem se nadje
  oblik tokena se ne salje nego se prijavi. Bijeli spisak stiti od novih fajlova, ali ne od
  sadrzaja, a `saznanja.jsonl` i prijedloge pise model.

Backup nikad ne brise iz kopije ono cega vise nema u klonu. Nestanak fajla je ili uredno ciscenje
ili nesreca, a backup koji prati nesrecu nije backup.

Oporavak na novoj masini: `.claude/skills/olx-novi-klijent/references/oporavak.md`. Vazno je da
backup vraca PODATKE, ne radni klon: tokeni se unose rucno, i to je namjerno.

## 9. Otisak resursa: most i njegova sesija

Pogon Telegram botova vozi `scripts/telegram-most.mjs`: jedan dugoziv proces koji sam radi
`getUpdates` i sam salje `sendMessage`, bez Telegram plugina. Isti fajl vozi obje uloge
(`bun scripts/telegram-most.mjs` za klijenta, `bun scripts/telegram-most.mjs admin-bot` za
vlasnika), razlike su parametrizovane kroz `ulogaMosta` u `scripts/lib/most.mjs`. Sve ostalo iz
sekcija 1 do 8 ostaje netaknuto: isti klon po klijentu, isti MCP, isti cron poslovi, isti backup.

U **dvobotnom** rezimu (default) to su dva odvojena procesa, svaki na svom bot tokenu, kao gore.
U **jednobotnom** rezimu (opcion, `OLX_MOST_ADMIN_TG_ID` popunjen) JEDAN proces vozi OBJE uloge
kao dvije odvojene zive sesije (svoj kontekst, svoji alati, svoj MCP profil), rutirajuci svaku
dolaznu poruku po posiljaocu. Stanje ostaje po ulozi, u istim fajlovima kao do sada
(`.olx-pik/most-stanje.json` za klijenta, `.olx-pik/most-admin-stanje.json` za admina), samo sto
oba fajla sada odrzava jedan proces umjesto dva. Poteze vodi JEDAN globalni radnik, round robin po
jednoj stavci: kad admin i klijent obojica cekaju, admin ceka najvise jedan klijentski potez, ali
dva poteza NIKAD ne rade paralelno. Razlog nije samo jednostavnost koda: `slikeNovijeOd` vezuje
prispjele slike za odgovor po VREMENU nastanka iz jedne dijeljene mape na disku, pa bi dva poteza
u letu istovremeno mogla svaki pokupiti sliku koja pripada onom drugom razgovoru i poslati je u
pogresnu sesiju. Serijalizacija poteza je zato namjerna odluka o ispravnosti, ne mjesto za
optimizaciju paralelizmom.

Iscrtana verzija starijih dijagrama ovog otiska (cuvar i strazar rezim), sa trakovima potrosnje i
vremenskom trakom dana: <https://claude.ai/code/artifact/741fa916-9b97-4308-956d-eb5309bdf112>.
Ta stranica je HISTORIJSKA (prikazuje penzionisani pogon, vidi pasus na kraju ove sekcije), izvor
joj je u repou (`olx-dokumentacija/radne-biljeske/strazar-telemetrija-stranica.html`) i moze se
ponovo objaviti ako link istekne, ali za vazece stanje vrijede dijagrami ispod.

### 9.1 Otisak u mirovanju i u radu

Most je jedini proces koji zivi cijeli dan. Sesija (`claude -p`, stream-json) i MCP server postoje
SAMO dok se aktivno radi: most ih digne na prvu poruku i gasi na idle prag ili nocni rez. Bun
poller koji je Telegram plugin ranije drzao za `getUpdates` VISE NE POSTOJI, jer poll radi most
sam.

Crveno trosi memoriju samo dok se radi, zeleno (most) je jeftino i zivi stalno.

```mermaid
flowchart LR
    tg["Telegram grupa"] <-->|"poruke i slike"| most

    subgraph klon["Klon klijenta"]
        most["<b>Telegram most</b><br/>jedan dugoziv proces<br/>drzi getUpdates i red na disku<br/>bun poller iz plugina VISE NE POSTOJI"]
        subgraph rad["Postoje SAMO dok se radi"]
            sesija["<b>Claude sesija (-p, stream-json)</b><br/><b>130 do 416 MB</b>"]
            mcp["<b>MCP server</b><br/><b>3 do 30 MB</b>"]
        end
    end

    most -.->|"digne na prvu poruku (nova ili --resume)<br/>gasi na idle prag ili nocni rez"| sesija
    sesija --> mcp
    mcp --> olx["OLX / PIK API"]
    most -->|"sendMessage"| tg

    zbir["Otisak dok se radi: most + sesija + MCP<br/>otisak u mirovanju: samo most<br/>tacan broj mjeri telemetrija (bun scripts/resursi.mjs pregled)"]

    classDef skupo fill:#f6cfc2,stroke:#a33c19,stroke-width:2px,color:#3b1305
    classDef jeftino fill:#c9e6da,stroke:#1f6b52,stroke-width:2px,color:#0b2b20
    classDef vanjsko fill:#eceada,stroke:#6b675c,stroke-width:1px,color:#26241d
    class sesija,mcp,zbir skupo
    class most jeftino
    class tg,olx vanjsko
```

Posljedica za flotu: deset klijenata na jednoj masini znaci deset mirnih mostova stalno, a sesija
i MCP se dizu samo za klijenta koji trenutno pise.

### 9.2 Zasto poruka ne moze propasti

Nijedna poruka se ne gubi, i to nosi red na disku, ne transport: offset se pomjera SAMO nakon sto
je poruka zapisana u red, a stavka izlazi iz reda SAMO nakon sto je odgovor poslan na Telegram.
Pad izmedju ta dva trenutka ostavlja poruku u redu, pa se obradi ponovo. Isporuka je dakle
NAJMANJE JEDNOM: dupli odgovor je neugodan, propusten je izgubljen klijent, pa je taj izbor
namjeran.

```mermaid
sequenceDiagram
    autonumber
    participant K as Klijent
    participant T as Telegram
    participant M as Most
    participant D as Red na disku
    participant S as Sesija (dize se po potrebi)

    K->>T: poruka
    M->>T: getUpdates (offset stari)
    T-->>M: novi update
    M->>D: upisi stavku u red (fsync/rename)
    M->>T: pomjeri offset (potvrda)
    Note over M,D: pad ovdje: poruka je vec u redu, obradi se ponovo
    M->>S: digni sesiju ako je nema (nova ili --resume)
    S-->>M: odgovor
    M->>T: sendMessage
    M->>D: izbaci stavku iz reda
    Note over M,D: pad ovdje: odgovor je vec poslan, ponovni pokusaj bi dupliro
```

Zivotni ciklus sesije koju most drzi, isti crtez kao stanje u kodu:

```mermaid
stateDiagram-v2
    [*] --> NemaSesije: most pokrenut
    NemaSesije --> ZivaSesija: prva poruka<br/>nova ili --resume ako kljuc postoji
    ZivaSesija --> ZivaSesija: poruka resetuje sat mirovanja
    ZivaSesija --> NemaSesije: idle prag OLX_MOST_IDLE_MIN<br/>gasi, kontekst OSTAJE (kljuc sesije se cuva)
    ZivaSesija --> NemaSesije: nocni rez OLX_MOST_RESTART_SAT<br/>gasi I BRISE kljuc, sljedeca poruka BEZ --resume
    NemaSesije --> [*]: SIGINT / SIGTERM
    ZivaSesija --> [*]: SIGINT / SIGTERM

    classDef budno fill:#f6cfc2,stroke:#a33c19,stroke-width:3px,color:#3b1305
    classDef mirno fill:#c9e6da,stroke:#1f6b52,stroke-width:3px,color:#0b2b20
    class ZivaSesija budno
    class NemaSesije mirno
```

Idle prag (`OLX_MOST_IDLE_MIN`, default 30 min, admin override `OLX_MOST_ADMIN_IDLE_MIN`) i nocni
rez (`OLX_MOST_RESTART_SAT`, default 3h) rade RAZLICITE stvari: idle CUVA kontekst (sljedeca
poruka nastavlja kroz `--resume`), nocni rez ga BRISE (sljedeca poruka krece od nule). Nocni rez
usput cisti i inbox slika (`OLX_SESIJA_INBOX_DANA`, default 7 dana) i skracuje cron logove.

### 9.3 Telemetrija resursa

Mjeri MOST, jer se ionako budi svakih 60 s preko minutnog tika i jedini zna PID sesije koju je
sam pokrenuo. Nema novog zakazanog posla ni novog deploy fajla. Uzorkovanje je gusce dok sesija
zivi, rjedje dok je ne postoji, jer mirno stanje ne mijenja gotovo nista izmedju uzoraka.

```mermaid
flowchart TB
    most["Telegram most<br/>uzorak: OLX_RESURSI_INTERVAL_MIN dok sesija zivi (default 5 min)<br/>OLX_RESURSI_INTERVAL_STRAZA_MIN dok sesije nema (default 30 min)<br/>pomak po klonu iz hasha putanje"]
    ps["Jedan poziv po uzorku:<br/>ps na macOS i Linux,<br/>Get-CimInstance na Windows"]
    stablo["Zbir RSS-a stabla:<br/>sesija + MCP server"]
    masina["Stanje masine:<br/>MemAvailable / vm_stat / freemem,<br/>swap, load"]
    jsonl[(".olx-pik/resursi/resursi-YYYY-MM.jsonl<br/>fajl po mjesecu, cuva se 12 mjeseci<br/>CRNI spisak backupa")]
    cli["bun scripts/resursi.mjs<br/>pregled | izvjestaj | dijagnostika"]
    covjek["Vlasnik flote"]

    most --> ps --> stablo --> jsonl
    most --> masina --> jsonl
    most -->|"dogadjaji: cuvar-start, cuvar-gasenje (ime ostalo isto namjerno, flotna analiza ga vec cita),<br/>start, pad,<br/>budjenje (hladni start),<br/>gasenje-idle (pun uzorak PRIJE gasenja sesije)"| jsonl
    jsonl --> cli --> covjek
```

Dvije stvari koje se pri citanju brojeva lako promase:

- **Vrijeme u mirovanju (bez zive sesije) se racuna iz parova dogadjaja `gasenje-idle` i
  `budjenje`**, ne iz udjela uzoraka. Kad interval nije konstantan (5 min dok sesija zivi, 30 min
  dok je ne postoji), udio uzoraka daje sistematski pogresan broj, a to je bas broj zbog kojeg se
  telemetrija i gleda. Udio uzoraka ostaje samo rezerva kad par nije zatvoren.
- **Zbir RSS-a je gornja granica**, jer duplo broji dijeljene biblioteke. Da li je masini tesko kazu
  slobodna memorija i swap, pa savjeti u izvjestaju ne prijavljuju curenje na osnovu samog rasta
  RSS-a.

Detalji odluka i stanje rada (HISTORIJSKI, pisani dok je pogon bio cuvar/strazar):
`olx-dokumentacija/radne-biljeske/telemetrija-resursa.md` i
`olx-dokumentacija/radne-biljeske/strazar-rezim-razrada.md`.

### 9.4 CPU po klonu i flotni nadzor

`SHEMA_VERZIJA 2` u `scripts/lib/resursi.mjs` dodaje `cpu_klona_pct`: CPU% stabla procesa jednog
klona (sesija + MCP), racunat preko `scripts/lib/cpu.mjs`. Isto obrazlozenje kao za 9.3: racuna se
iz DELTE kumulativnog CPU vremena izmedju dva mjerenja, nikad iz trenutnog `%cpu` iz `ps`, jer bi
sesija koja satima miruje pa naglo pocne raditi sa trenutnim `%cpu` i dalje pokazivala nisko
zauzece satima poslije budjenja (razvuceno na sve satove mirovanja) umjesto odgovora na pitanje
"ko jede procesor UPRAVO SADA". Stariji redovi (sema 1) nemaju ovo polje; tretira se kao `null`
("klon jos nije nadogradjen"), nikad kao `0`.

Flotni posao `scripts/nadzor-flote.mjs` (deploy sablon
`deploy/launchd/ba.codefactory.olx.ADMIN.nadzor-flote.plist`, instalira se rucno jednom kao AI
runda i nadzor backupa, vidi sekciju 3) obilazi sve klonove svaki dan:

- Korak A (svaki put): sken diska po klonu, detekcija ugnijezdenih kopija klona
  (`pronadjiUgnijezdeneKopije` u `scripts/lib/klonovi.mjs`), dnevni uzorak stanja masine
  (CPU/PSI/memorija/load) u `<nadzorDir>/masina-YYYY-MM.jsonl`.
- Korak B (samo kad je proslo >= 3 dana od zadnje analize): agregira dnevne redove preko
  `analizirajFlotu()` (`scripts/lib/analiza-flote.mjs`), upisuje nalaze u
  `<nadzorDir>/analiza-YYYY-MM-DD.md` i salje sazetak adminu na Telegram.

`<nadzorDir>` (gdje zivi stanje: `masina-YYYY-MM.jsonl`, `cpu-stanje.json`,
`zadnja-analiza.json`, `analiza-YYYY-MM-DD.md`) se razrjesava ovim redoslijedom: env override
`OLX_NADZOR_DIR` > `<izvorPutanja>/nadzor` kad spisak klonova dolazi iz folder-skena (`--svi` ili
`OLX_KLIJENTI_ROOT`) > `~/olx-nadzor` kao fallback kad izvor spiska nije root (popis-fajl
`~/.olx-klijenti.txt` / `OLX_KLIJENTI_POPIS`).

Pragovi u `PRAGOVI_DEFAULT` (`scripts/lib/analiza-flote.mjs`) su pocetna procjena, ne izvedena iz
stvarne serije mjerenja: cekaju par sedmica stvarnih podataka prije podesavanja. Pragovi telemetrije
resursa iz 9.3 (`OLX_RESURSI_PRAG_SLOBODNO_MB`, `OLX_RESURSI_PRAG_SWAP_OMJER`,
`OLX_RESURSI_PRAG_ALARM_SATI`) su odvojen mehanizam, po klonu, dokumentovani u `.env.example`.

Detalji odluka: `olx-dokumentacija/radne-biljeske/nadzor-flote-cpu.md`.

**Sta je bilo prije:** do izdanja 0.18 pogon Telegram botova bio je `cuvar-sesije.mjs`, koji je
drzao INTERAKTIVNU sesiju sa Telegram pluginom (vlastiti `bun` poller proces za `getUpdates`), uz
opcion strazar rezim (`OLX_SESIJA_STRAZAR`) u kojem je cuvar sam preuzimao strazu nad Telegram
tokenom kad sesija spava. Sve to je zamijenio `telegram-most.mjs`. Pomen ostaje jer se stariji
klonovi i stara telemetrija jos mogu sresti.

## 10. Citanje kataloga: osigurac naspram budzeta vremena

`listAllByState` i `listAllActive` (`src/core/index.ts`) prelistavaju sve stranice jednog stanja
oglasa. Prije ovog posla su tiho stajali na 50 stranica (1000 oglasa) i vracali goli niz kao da je
katalog potpun; poziv sa vise oglasa je bio tiho odsjecen, bez ijedne poruke o tome. Rezultat je
sada `SviOglasi { oglasi, potpuno, ukupno, procitanoStranica, stranicaUkupno, razlog }`, gdje
`potpuno: false` nosi i `razlog` (`budzet` / `osigurac` / `katalog_se_mijenjao`).

Dva NEZAVISNA mehanizma ograničavaju prelistavanje, namjerno odvojena umjesto jednog broja
stranica:

- **Osigurac** (`OLX_MAX_STRANICA_LISTE`) brani od pokvarenog `last_page` sa API-ja: broj
  stranica koji bi inace petlju vrtio beskonacno. Ne mjeri brzinu niti pokusava predvidjeti
  velicinu kataloga, samo postavlja plafon namjerno iznad svakog realnog kataloga, da se u
  normalnom radu nikad ne aktivira.
- **Budzet vremena** (`OLX_BUDZET_LISTE_MS`, `OLX_BUDZET_LISTE_GRUPNI_MS`,
  `OLX_BUDZET_LISTE_KONKURENT_MS`) staje kad prelistavanje potrosi previse VREMENA, bez obzira
  koliko je stranica procitano. Razlog zasto ovo ne moze biti isti broj kao osigurac: broj
  stranica ne zna nista o retry pokusajima, o throttleu izmedju zahtjeva, ni o tome da je API tog
  dana spor. Vrijeme je jedina mjera koja sve to hvata. `OLX_BUDZET_LISTE_KONKURENT_MS` ima
  namjerno kraci budzet od razgovornog: obilazak tudjeg shopa (`statsKonkurent`) cita kandidate
  serijski, jednog po jednog, kroz cijeli Excel spisak, pa dugo prelistavanje po jednom kandidatu
  zaustavlja sve iza njega u redu. Bolje je posteno reci da je uzorak nepotpun nego drzati ostale
  kandidate da cekaju.

Trece, i namjerno odvojeno od gornja dva: **strpljenje na 429** (`src/core/strpljenje.ts`) brani od
preranog odustajanja kad API vrati 429 usred prelistavanja. Osigurac brani od beskonacne petlje,
budzet vremena od predugog pokretanja, a strpljenje na 429 od toga da posao pukne bas na
ogranicenju brzine, iako bi kratko cekanje bilo dovoljno da API stigne. Kad globalni `maxRetries`
(centralni `request()`) potrosi svoj budzet retryja, prosirena grana dodaje jos pokusaja: 5s, 10s,
20s, 40s, pa plafon od 45000 ms po pokusaju (`BACKOFF_MAX_MS`), do `OLX_POSAO_429_POKUSAJA`
(default 6) pokusaja i `OLX_POSAO_429_UKUPNO_MS` (default 600000) kumulativnog cekanja unutar
jednog pokretanja. Kumulativni plafon se drzi ISPOD budzeta pokretanja
(`OLX_BUDZET_SNAPSHOT_MS`, default 900000), da uporan 429 ne pojede cijelo pokretanje, nego poslu
ostane vremena da stvarno makne s mjesta i upise radni fajl. Ovi zakazani poslovi prelistavaju bez
razgovornog budzeta (`OLX_BUDZET_LISTE_MS` vrijedi za pozive gdje neko ceka odgovor), pa mu ta
granica ovdje nije mjerilo.

Povod: 18.08.2026. je isti 429 pao i poslu `posao dnevni` na klijentu sa oko 2000 artikala (`GET
/users/.../listings` usred obnove), dok je manji klijent prosao neokrznut. To je potvrdilo obrazac
vec vidjen na snapshotu: rizik raste sa brojem stranica liste, ne sa vrstom posla, pa je isto
strpljenje ukablirano i u `posao dnevni`.

Granica je vezana za TOK, ne za klijenta: politika se postavlja preko `withStrpljenje429`
(AsyncLocalStorage scope, isti obrazac kao `withAuditContext` u `audit.ts`) na ulazu u CLI komande
`stats snapshot` i `posao dnevni`, a `trenutnoStrpljenje()` je citac koji `request()` provjerava na
svakom 429. MCP alati i klijentski Telegram bot taj scope NIKAD ne otvaraju, pa je
`trenutnoStrpljenje()` tamo uvijek `null` i ponasanje ostaje bit za bit staro: klijent u zivom
razgovoru ne smije cekati minutama na odgovor, pa se globalni `maxRetries` namjerno nije dizao za
sve pozivaoce, nego je prosireno strpljenje dodato SAMO tamo gdje dugo cekanje nikog ne blokira
uzivo. Da je politika umjesto scope-a bila parametar kroz `request()` / `listAllByState` /
`getListing`, svako novo mjesto poziva bi je moralo eksplicitno proslijediti, a tiho zaboravljanje
je najvjerovatniji nacin da pravilo pukne. I strpljenje je strogo ograniceno na 429: kod 5xx se ne
zna da li je server radnju vec izvrsio, pa produzeno ponavljanje tamo nosi rizik duplirane radnje,
a ne samo cekanja.

Konkretne vrijednosti (`5000` / `75000` / `120000` / `20000` / `500`) i njihovo objasnjenje zive u
`.env.example`, sekcija "CITANJE KATALOGA: OSIGURAC I BUDZETI" — jedan izvor istine, ovdje se ne
ponavljaju.

Gornja granica budzeta za grupne alate nije nagadjanje, nego izmjereni tehnicki zid: citanjem
stringova iz binara Claude Code verzije 2.1.232 (14.08.2026.) utvrdjeno je da je podrazumijevani
timeout jednog MCP tool poziva 60000 ms, i to je ujedno DONJI prag jer se manje zadane vrijednosti
dizu na 60000. Polje `timeout` po serveru u `.mcp.json` ga nadjacava (ovdje postavljeno na 300000
ms za server `olx-pik`). Progress notifikacije taj rok NE produzavaju: to je tvrd wall-clock limit
po pozivu. Budzeti u `.env.example` su zato postavljeni tako da alat UVIJEK sam vrati odgovor prije
tog zida, umjesto da poziv presece MCP klijent.

Pravilo koje se provlaci kroz cijeli ovaj posao: **odbijanje sa uputom nije laz, tihi rez jeste.**
Kad alat ne moze pouzdano zavrsiti posao nad cijelim katalogom, kaze to eksplicitno i objasni sta
nedostaje, umjesto da vrati djelimican rezultat kao da je potpun.

Ponasanje pozivalaca kad je lista nepotpuna nije jedinstveno, nego zavisi od toga da li tiha
praznina pravi pogresno stanje:

| Pozivalac | Kad je lista nepotpuna |
| --- | --- |
| `olx_bulk_price`, `olx_bulk_sklanjanje` | ODBIJAJU rad (i u `dry_run`): izmjena cijene ili sklanjanje bi tiho preskocili dio oglasa |
| `olx_refresh_bulk`, CLI `refresh all`, `posao dnevni` | RADE, jer je obnova besplatna i ne pravi pogresno stanje; obuhvat ide u odgovor i adminu |
| `olx_find_my_listing` | ODBIJA umjesto da kaze "nema pogodaka" — negativan zakljucak iz nepotpunog skupa je ista greska kao lazan "nisu aktivni" spisak |
| `stats snapshot` (CLI) | NE PISE snimak, jer bi sutrasnji `olx_mrtvi_oglasi` prijavio zive oglase kao mrtve |
| `posao dnevni` (tempo obnova) | koristi `meta.total` kao imenilac (tacan i kad lista nije potpuna); `zapisiKvotu` preskace samo kad ni `meta.total` nema |
| `olx_list_listings` sa `all` | Iznad `OLX_MAX_OGLASA_U_ODGOVORU` isporucuje katalog U KOMADIMA (parametar `komad`), umjesto da ga tiho sijece ili odbije odgovor |
| `olx_sablon_opisa` | RADI nad nepotpunom listom (bira uzorak, ne mijenja stanje), obuhvat se prijavljuje u odgovoru |
| `olx_sponsor_plan` | Trazi NAJSTARIJE aktivne oglase, a to je bas dio kataloga koji budzet vremena inace odsijeca prvi; zato prvo cita od kraja uz provjeru poretka (`listNajstarijiAktivni`), a kad poredak nije pouzdan ili kandidata ostane premalo, pada na puno citanje. Ako ni to nije potpuno, ODBIJA (isto kao `olx_bulk_price`/`olx_bulk_sklanjanje`): odabir iz pogresnog dijela kataloga bi predlozio kandidate koji uopste nisu najstariji, sto je gore od odbijanja. |
