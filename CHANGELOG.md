# Zapis izdanja

Cemu sluzi: kad klijent kaze "od jucer ne radi", ovdje stoji sta je uslo izmedju dva izdanja.
Nije zapis svakog commita, nego samo onoga sto se vidi u radu ili moze pokvariti postojece.

Kako se cita broj verzije: `bun dist/cli/index.js --version`, polje `version` u
`.olx-pik/audit.jsonl`, ili `bun scripts/provjeri-klon.mjs`. Na kojem izdanju klon stoji:
`git describe --tags`. Procedura izdanja i vracanja: `olx-dokumentacija/arhitektura.md`,
sekcija 7.

## 0.17.0 — 2026-08-16

**Artikal se vise ne crta na izmisljenu pozadinu, nego se IZREZUJE i lijepi na pravu.** Recept
`pozadina-klijenta` do sada je pozadinu generisao iznova svaki put, pa je ispadala slicna a nikad
ista, a tekst i logo na njoj iskrivljeni. Sada segmentacija (`@imgly/background-removal-node`)
izrezuje artikal sa fotografije, a kompozicija ide u kodu (`sharp`) na PRAVU sliku klijentove
pozadine: njeni pikseli, ukljucujuci logo, ostaju netaknuti. Format je uvijek 4:3. Poslije
slaganja Gemini se opciono zove SAMO za doradu svjetla i kontaktne sjenke, i klijent dobije obje
verzije da bira, jer dorada ne garantuje da ce logo ostati citljiv. Geometrija je cista i
testirana odvojeno od piksela (`src/core/slaganje.ts`).

**Vise stvarnih artikala sa iste fotografije se slaze zajedno.** Kad na jednoj poslanoj fotografiji
stvarno stoji vise artikala, svi se prepoznaju i slazu na istu pozadinu, najvise 4. Sadrzaj je pri
tom sav stvaran i prisutan na fotografiji koju je klijent poslao, pa ovo nije u sukobu sa pravilom
da generisana slika prikazuje samo artikal koji se oglasava. imgly ne radi instance segmentaciju
(jedan poziv vraca jednu masku sa svim objektima), pa razdvajanje ide u kodu, connected components
nad alpha kanalom; segmentacija time ostaje JEDAN poziv po fotografiji, bez visestrukog troska.
Raspored je jedan red po dnu sa zajednickom donjom linijom, sirina se dijeli proporcionalno
korijenu povrsine, a gornja margina koja cuva logo na pozadini ostaje netaknuta. Artikli koji se
na fotografiji DODIRUJU prepoznaju se kao jedan i budu izrezani kao blok; to se u kodu ne moze
popraviti, pa se kaze i u opisu alata i klijentu. Brana koja za ovaj recept dozvoljava samo jednu
ulaznu fotografiju ostaje.

**Referentna (stock) slika za nov, zapakovan artikal.** Novi alat `olx_stock_slika` nadje i
preuzme referentne fotografije poznatog modela (telefon, tehnika), da korisnik izabere jednu, kad
nema sta da slika osim kutije. Ovo je jedini tok u kojem u oglas ulazi tudja fotografija, pa je
vlasnicka odluka i stoji iza prekidaca `OLX_STOCK_SLIKE` koji je po defaultu UGASEN: na klonu gdje
ga niko nije upalio alata nema ni u kontekstu. Izvor je Wikimedia Commons, i to je glavna zastita
a ne slucajan izbor: svaka slika tamo nosi eksplicitnu slobodnu licencu, koja se sa imenom autora
vraca uz svakog kandidata i mora se pokazati korisniku, jer je atribucija uslov koristenja. Sve
ostale brane su u jezgru i testirane: polovan artikal se odbija (referentna slika prikazuje model,
ne bas taj primjerak), nepoznato stanje trazi izricitu tvrdnju i potvrdu umjesto da tiho prodje,
preuzima se samo sa hostova sa spiska (dopuna samo rukom u `.env`), preusmjerenja se ne prate,
sadrzaj se provjerava po magic bajtovima a ne po ekstenziji, i vazi granica velicine. Trag sa
izvornim URL-om, licencom i autorom ide u `.olx-pik/slike-zahtjevi.jsonl`, i kad je zahtjev
odbijen. Za tu sliku se AI ne zove i dnevni plafon generisanja se ne trosi. Odgovornost za pravo
koristenja slike u oglasu nosi oglasivac, ne bot, i to mu se kaze prije nego sliku dobije.
Pokrivenost je ogranicena na poznate modele; kad nema pogotka, odgovor je da nema.

**Deterministicko slaganje ne trosi dnevni plafon dorade.** `OLX_SLIKA_MAX_DNEVNO` se trosi samo
kad se Gemini stvarno pozove. Kad je plafon dostignut, slaganje i dalje vrati slozenu sliku, a
dorada se preskoci uz jasan razlog umjesto da cijela radnja padne.

**Pro modeli Gemini-ja se odbijaju u kodu, bez izuzetka.** Nenamjeran pro model kostao je 1.68 USD
u jednom danu (izmjereno 04.08.2026), pa se izbor modela vise ne oslanja na konfiguraciju: brana
stoji u `src/core/gemini.ts` i vraca na flash default.

- Zavisnosti pod Bunom: `sharp` i `@imgly/background-removal-node` su nove i teske (oko 355 MB u
  `node_modules`). `bun install` je na njima padao, jer imgly pinuje `sharp@0.32` koji binarni dio
  jos vuce install skriptom. Rjesenje su dvije stavke u `package.json`: `overrides.sharp` (imgly
  koristi korijenski sharp 0.34 sa gotovim `@img/*` binarima, platformski neutralno) i prazan
  `trustedDependencies` (nijedna postinstall skripta se ne pokrece). Postojece komande se ne
  mijenjaju, `bun install --frozen-lockfile` na floti prolazi kao i prije.
- **`bun install` ce pri tom ispisati `install script from "sharp" exited with 1`. To NIJE greska
  i nista se ne prekida** (izlazni kod ostaje 0, provjereno na svjezem klonu): to je sharp koji
  pokusa build from source, a binarni dio mu ionako dolazi gotov kroz `@img/*` pakete. Poslije
  toga i sharp i imgly rade. Ako se ta poruka ikad pretvori u stvaran pad, prvo pogledaj jesu li
  `overrides.sharp` i `trustedDependencies` jos u `package.json`.
- `bun scripts/provjeri-klon.mjs` sada javlja kad te dvije zavisnosti fale. Stavka je PAZNJA, ne
  FALI: klon bez njih radi sve osim recepta sa stalnom pozadinom.
- **Audit log sad pamti i sirovi razlog greske, ne samo status.** Na neuspjesnom pozivu (4xx/5xx)
  `AuditEntry` dobija opciono polje `error_body` sa tijelom odgovora API-ja (npr. koje polje na
  422 nije validno), skraceno na 2000 znakova. Do sada je taj odgovor postojao samo u zivom
  razgovoru u trenutku greske i gubio se poslije restarta sesije, pa "zasto je ovo puklo" nije
  imalo trag. Prije upisa se tijelo provjerava istim obrascima kao u `backup-spisak.ts` (Telegram
  token, `sk-`, JWT i slicno); ako izgleda kao tajna, `error_body` se izostavlja.

## 0.16.0 — 2026-08-16

**Zavrsen oglas se moze vratiti u prodaju.** Novi MCP alat `olx_reaktiviraj_oglas` i CLI komanda
`olx listings reaktiviraj <id>` objave NOV oglas sa istim tekstom i ORIGINALNIM slikama zavrsenog
oglasa. Platforma zavrsen oglas ne moze ozivjeti (za `hide` postoji `unhide`, za `finish` nema
para, a opciju ponovne objave zavrsenih je ukinula), pa je ponovna objava jedini put i to je
jedini izuzetak od pravila "na vrh se ide obnovom, ne ponovnom objavom" (`granice.md`). Preglede
i pitanja stari oglas ne prenosi i to se korisniku kaze prije objave. Alat namjerno ODBIJA sve
sto ima jeftiniji put: aktivan oglas salje na obnovu ili izdvajanje, istekao na obnovu, nacrt na
`olx_publish_listing`, skriven na otkrivanje, a oglas sa nepoznatim ili praznim statusom
zaustavlja umjesto da nagadja. Zavrsen oglas zna vratiti cijenu 0 ili "na upit", pa alat u tom
slucaju stane i trazi cijenu; nula i "ne znam" nisu isto.

**Tok objave iz arhive je sada jedan.** `OlxClient.objaviIzArhive` (create, slike, glavna slika,
publish, prenos izuzeca, oznaka u arhivi, brana duple objave) dijele `olx_vrati_artikal`, nova
reaktivacija i CLI, umjesto da svaki ima svoju kopiju. Brane troska ostaju gdje su i bile, u
`createListing` i `publishListing`.

- Da li POST `/listings/:id/publish` nad zavrsenim oglasom ista radi i dalje NIJE izmjereno.
  Grana za to stoji u kodu i ugasena je; mjeri se sa `olx listings reaktiviraj <id> --mjeri-publish`,
  ali samo na admin nalogu i samo nad namjenskim oglasom u besplatnoj kategoriji, jer trenutak
  naplate (create ili publish) nije izmjeren pa se nepoznata cijena tretira kao naplatna.

## 0.15.0 — 2026-08-16

**`--channels` u headless (launchd) rezimu vise ne pada na TTY provjeri, i telegram-most.mjs
postaje ispravan pogon za klijentske botove.** Interaktivni rezim zahtijeva `process.stdout.isTTY`;
bez njega je odmah padao na startu ispod launchd-a. Popravljeno omotacem preko `script -q /dev/null`
(`trebaPty`/`pokreniClaude` u `scripts/lib/sesija.mjs`, rollback prekidac `OLX_SESIJA_BEZ_PTY`).
Usput otkriveno i zabiljezeno (`deepseek-nalazi.md`): ta ista kombinacija (`--channels` kroz
`script` omotac) odbija ispravnu, potvrdjenu prijavu ("Not logged in", bez stvarnog API poziva),
samo u toj kombinaciji; uzrok nije dalje istrazivan. Zbog toga se `telegram-most.mjs` (headless
most bez plugina, direktan Telegram `sendMessage`) potvrdjuje kao ispravan put za klijentske
botove umjesto `--channels`, i u ovom izdanju dobija pun paritet sa starim cuvarom: mapiranje
AI pogona (DeepSeek/pretplata) koje mu je dosad potpuno nedostajalo, gasenje zive sesije poslije
mirovanja uz `--resume` (potvrdjeno rucnom probom da kontekst prezivi SIGTERM, `OLX_MOST_IDLE_MIN`,
default 30 min), nocni rez konteksta (`OLX_MOST_RESTART_SAT`, default 3h), PID brava
(`.olx-pik/most.pid`), telemetrija resursa, ciscenje inboxa i logova, i preuzimanje markera za
osvjezavanje `.env` poslije novog OLX tokena. Stari `cuvar-sesije.mjs` (`--channels`) ostaje za
sada dostupan dok se migracija ne potvrdi na prvom klonu u praksi.

**Pogon prelazi sa Node-a na Bun.** CLI, MCP server, cuvar sesije, Telegram most i sve pomocne
skripte sad se pokrecu preko `bun`, ne preko `node`: `package.json` skripte, shebang linije,
launchd sabloni (`deploy/launchd/*.plist`) i Windows Task Scheduler blizanci
(`deploy/windows/*.ps1`) su promijenjeni na `bun`. Provjereno izvrsavanjem: `bun install` (104
paketa, nula upozorenja, nema native/kompajliranih zavisnosti), `bun run build` daje identican
`dist/` kao `npm run build`, i `bun run test` prolazi svih 831 test istim rezultatom kao Node.
`scripts/testovi.mjs` je prepravljen da pod Bunom pokrece svaki test-fajl u SVOM pozivu `bun test
<fajl>`, jer batch poziv sa vise fajlova odjednom tiho ispusti vecinu testova bez ijedne greske
(izmjereno 15.08.2026, iskoristeno u `.olx-pik/`). `process.loadEnvFile` (koristio se u pet ulaznih
skripti za globalno ucitavanje `.env`) ne postoji u Bunu; zamijenjen dijeljenim
`ucitajEnvGlobalno` (`scripts/lib/envfajl.mjs`) koji je pod Bunom no-op (Bun sam ucita `.env` iz
cwd prije nego skripta i krene), a `scripts/claude-ds.mjs` je uz to imao stvarni bug: catch blok je
tvrdio da `.env` fali i kad je fajl bio ispravan, samo zato sto funkcija ne postoji pod Bunom, sad
se to provjerava odvojeno (`existsSync`). `bun pm version` zamjenjuje `npm version` u
`scripts/izdanje.mjs`, provjereno da isto postuje `preversion`/`version`/`postversion` hookove.
Node ostaje instaliran na masini SAMO kao zavisnost za `scripts/onboarding-uzivo.mjs` (jednokratni
admin alat za onboarding klijenta preko lokalnog Cloudflare Workera): `wrangler` sam zahtijeva
Node >=22 nezavisno od Buna, i ta skripta sad sama nadje odgovarajucu nvm verziju za taj jedan
spawn, bez diranja globalnog `nvm alias default`. Klijentska flota i dalje vozi Node dok se
migracija ne potvrdi u praksi na prvom klonu; ovo izdanje samo priprema pogon.

**Ime prodavca koje klijent sam spomene se tiho zapise, i jednom dnevno skupi sa cijele flote.**
Klijentu konkurencija nije u paketu i odgovor mu ostaje isti, ali ime koje je on sam naveo je bolji
trag o tome koga stvarno gleda nego bilo koje nase pogadjanje. Bot ga upise u
`.olx-pik/spomenuti-konkurenti.jsonl` svog klona i o tome ne kaze nista; ako ga covjek izricito
pita pamti li, ne laze. Alat postoji SAMO u klijentskom profilu (novi `SAMO_KLIJENT`, obrnuto od
`SAMO_ADMIN`), jer u admin sesiji nema sagovornika koji bi nekog spomenuo. Zapis nosi samo username
i kratku napomenu, nikad preprican razgovor: ime se svodi na prvu rijec i na 60 znakova. U
klijentskom razgovoru se odatle NIKAD nista ne cita, server uvozi samo funkciju upisa. Fajl ide u
backup stanja, jer se ne moze rekonstruisati ni iz cega. `scripts/spomenuti-pokupi.mjs` (novi ADMIN
posao, 08:15) obidje klonove iz `~/.olx-klijenti.txt` i slozi pregled objedinjen po prodavcu, sa
brojem klijenata i brojem spominjanja; ime koje je palo kod vise klijenata stoji prvo. Za razliku
od `saznanja-pokupi.sh` nema markera dokle je pokupljeno, jer je ovdje vrijedna slika stanja a ne
dnevnik, pa se izlaz prepisuje.

**Podsjetnik potrosnje resursa pri pokretanju sesije.** Telemetriju o RSS-u sesije, cuvara i masine
`cuvar-sesije.mjs` vec skuplja sam, ali je niko nije citao. Novi `SessionStart` hook
(`scripts/podsjetnik-resursi.mjs`) na startu ispise kratak pregled i komandu za punu istoriju. Tih
je u klijentskoj bot sesiji, iz istog razloga kao provjera izdanja: izlaz hooka ulazi u kontekst, a
klijent te brojeve ne treba vidjeti niti moze nesto po njima uraditi. Nikad ne pada i nikad ne visi;
pad hooka bio bi pad pokretanja sesije.

**Konkurencija vise nije dostupna klijentu; adminu ostaje sve.** Klijentski bot na svako pitanje o
tudjim shopovima, poredjenju sa drugim prodavcima i njihovim cijenama odgovara da to nije dio
njegovog paketa i upucuje na programere, bez obecanja da ce biti dostupno i bez rijeci o cijeni.
Brana stoji na dva mjesta, jer prompt sam nije brana: `olx_user_profile` izlazi iz klijentskog
profila (uz `olx_competitor_report`, koji je vec bio vani), a `olx_list_listings` i
`olx_refresh_bulk` u klijentskom profilu odbijaju poziv cim je zadan `user`, uz uputu da ga
izostavi. Bez toga druge dvije brane ne bi vrijedile nista: preko `user` se mogao povuci cijeli
tudji katalog sa cijenama. Klijent za svoj nalog nista ne gubi, jer paket, istek, kredite i kvotu
vec daje `olx_profile_stats`. Opisi skillova i podagenata ulaze u kontekst SVAKE sesije, pa je iz
njih izbacena ponuda analize konkurenta; tijela skillova, reference, podagent `olx-konkurent` i AI
runda ostaju netaknuti i rade iz admin sesije kao i dosad. Klijentski profil time ima jedan alat
manje.

Uz to je zatvorena i treca zaobilaznica, koja je bila najtisa: `GET /listings/:id` ne provjerava
vlasnistvo, pa su `olx_get_listing` i `olx_listing_report` citali bilo ciji oglas kad im se da ID, a
tudji ID stize najobicnijim putem, linkom koji covjek nalijepi u poruku. Oba u klijentskom profilu
od sada odbijaju oglas koji nije sa tog naloga. Provjera ne kosta nijedan dodatni poziv za sam oglas
(vlasnik stize u istom odgovoru), a vlastiti nalog se cita jednom po pokretanju sesije. Kad vlasnik
u odgovoru nije citljiv, poziv se takodje odbija, ali se to razdvaja od tudjeg oglasa i javlja
ADMINU jednom po sesiji, jer to znaci promjenu na API-ju a ne pogresan oglas.

**Goli `claude` u klonu daje pun alat, a musterijin bot ostaje suzen bez obzira na `.env`.** Dosad
je profil zavisio iskljucivo od `OLX_MCP_PROFILE`, pa je vlasnik u terminalu klijentskog klona
dobijao suzenu listu. Podrazumijevana vrijednost se okrece na `admin`, ali TEK uz tvrdu branu koja
ne zavisi od `.env`: MCP server sam prepoznaje klijentsku bot sesiju (po `OLX_SESIJA_TIP`, koji
postavlja `scripts/lib/sesija.mjs`, odnosno po runtime mapi `.claude-runtime`) i tada uzima
klijentski profil i kad `.env` kaze `admin`. Oznaka smije samo SUZITI, nikad prosiriti, pa
`OLX_MCP_PROFILE=klijent` i dalje suzava svakoga. Bez te brane se okretanje defaulta ne bi smjelo
uraditi, jer bi propust umjesto "klijent vidi manje nego smije" znacio "klijent vidi sve admin
alate". Admin bot runtime (`.claude-runtime-admin`) namjerno ostaje na admin profilu.

Uz to: alati koji MJERE profil (`npm run kontekst`, generator popisa, `provjeri-prompt.sh`) od sada
oznake zadaju sami umjesto da ih naslijede iz ljuske. Bez toga bi pokretanje iz ljuske u kojoj je
ostao `CLAUDE_CONFIG_DIR` nekog klona tiho izmjerilo suzenu listu i upisalo taj broj u izvjestaj.
`provjeri-klon.mjs` vise ne cita `OLX_MCP_PROFILE` nego MJERI da klijentski put stvarno daje suzen
profil.

**Prekinuta serija snapshota se sada javlja administratoru, umjesto da samo utihne.** Izvjestaj o
mrtvim oglasima trazi dvije tacke unutar perioda koji racuna. Dosad je, kad ih nije bilo, poredjenje
tiho posezalo za najstarijim ucitanim snimkom, pa je klijent mogao dobiti "bez pregleda vec 60 dana"
na osnovu poredjenja sa tackom od prije 120 dana, i to u alarmu koji ga navodi da zavrsi ili sakrije
oglas. Sada se u tom slucaju ne tvrdi nista. Posto uslov za to znaci da posao snapshot ne radi vec
skoro dva mjeseca, dnevni posao o tome javi ADMINISTRATORU, ne klijentu: pokvaren pogon je nas
posao, a klijenta se time ne opterecuje. Nov klon, gdje serija tek pocinje, ne javlja nista.

**`olx_opisi_sliku` (vision proxy) dobio dnevni plafon, i `olx_arhiva` lista rez.** Vid je do sad
mogao biti pozvan neograniceno iz sesije i svaki poziv je placao vanjski Gemini racun bez ikakve
brane. Nova env varijabla `OLX_VID_MAX_DNEVNO` (fallback 150, `src/core/vid.ts`) uvodi ZASEBAN
dnevni plafon, ne dijeljen sa `OLX_SLIKA_MAX_DNEVNO` generisanja slike (fallback 10): vision poziv
je red velicine jeftiniji, a `olx_opisi_sliku` sjedi na putu objave artikla iz fotografije za
sesiju bez vida, pa bi dijeljeni plafon blokirao normalan rad vec posle par artikala dnevno.
Provjera se radi PRIJE poziva Gemini modela i baca jasnu gresku sa uputom na `.env`. `confirm` na
alat namjerno NIJE dodan (odluka vlasnika: alat je readOnly i stoji na putu objave iz slike).
Usput, `olx_arhiva` u rezimu `lista` je dosad rasla linearno sa brojem skinutih artikala bez ikakvog
reza; sad dobija `limit` (podrazumijevano 20, isti obrazac kao `olx_mrtvi_oglasi`), a `ukupno` u
odgovoru ostaje pun broj bez obzira na rez.

**Stari dnevni snapshoti pregleda se sad mogu prorjediti.** `.olx-pik/snapshots/views-YYYY-MM-DD.json`
se pisao svaki dan i nikad nije brisan, a `posao backup` te fajlove gura u backup stanja
(`src/core/backup-spisak.ts`), pa je repo stanja rastao bez kraja. Nova funkcija
`proredjiStareSnapshote` (`src/core/snapshoti.ts`) brise stare fajlove po deterministickom
pravilu: snapshoti noviji od `OLX_SNAPSHOT_PROREDJIVANJE_PRAG_DANA` (podrazumijevano 90 dana) se
cuvaju svi, a iznad tog praga ostaje samo prvi (najstariji) snapshot u svakom bloku od
`OLX_SNAPSHOT_PROREDJIVANJE_GUSTINA_DANA` dana (podrazumijevano 7, priblizno sedmicno). Datum se
cita iskljucivo iz imena fajla, nijedan fajl se ne otvara da bi se odlucilo o brisanju; radni fajl
`.snapshot-u-toku.json` i bilo koje drugo ime ostaju netaknuti. Funkcija nikad ne baca: nepostojeci
direktorij vraca nule bez greske, a jedan fajl koji se ne da obrisati ne prekida ciscenje ostalih.
Poziva iz CLI-ja ili croma jos nema, ovo je samo funkcija spremna za spajanje.

**`stats snapshot` dobio budzet po pokretanju i nastavak preko vise dana.** Na velikom katalogu
posao (jedan `getListing` po oglasu, serijski) nije stizao obici sav do sljedeceg termina i padao je
svaki dan. Sad ima tvrd budzet vremena (`OLX_BUDZET_SNAPSHOT_MS`, podrazumijevano 15 minuta): kad
istekne usred obilaska, posao STAJE UREDNO (izlazni kod 0, bez javljanja adminu) i upisuje napredak
u radni fajl (`.olx-pik/snapshots/.snapshot-u-toku.json`), a sljedece pokretanje nastavlja TACNO od
zapamcenog spiska ID-eva (ucitanog jednom, na pocetku prolaza) umjesto da cita katalog iznova.
Djelimican snapshot se i dalje NIKAD ne pise (brana na nepotpunu listu ostaje netaknuta): tek kad je
cio zapamceni spisak obidjen, snapshot ide na disk i radni fajl se brise. Prolaz koji traje duze od
`OLX_MAX_TRAJANJE_SNAPSHOT_PROLAZA_MS` (podrazumijevano 48h, znatno ispod 14-dnevnog prozora za
mrtve oglase) se odbacuje i krece iznova, uz javljanje administratoru; isto vazi za radni fajl koji
pripada drugom nalogu (podmetnut ili zaostao sa drugog klona). Snapshot je uz to dosao do verzije 3:
svaki oglas sad nosi i `procitano_ts`, trenutak kad je TAJ oglas procitan (koristan tek kad se
prolaz razvuce na vise dana). Polje se NAMJERNO jos ne koristi ni u jednom racunu (`promjenaPregleda`,
`mrtviOglasi` i ostatak `stats.ts` su netaknuti): skuplja se od sada za buducu upotrebu, a stari
snapshoti (verzija 1 i 2) se i dalje citaju normalno.

**Audit log rotira po mjesecu i vise se ne cita cijeli u memoriju.** Dnevni plafon
(`OLX_MAX_SPEND_PER_DAY`) cita audit log na SVAKOJ radnji koja trosi kredite, a log je rastao bez
kraja. Na dovoljno velikom logu `readFileSync` baca gresku, a posto plafon namjerno pada zatvoreno,
to bi odbilo svaku naplatnu radnju. Novi zapisi idu u `audit-YYYY-MM.jsonl` pored zatecene putanje,
citanje ide u komadima umjesto cijelog fajla odjednom, a racun i dalje obuhvata i zateceni
`audit.jsonl`, pa se danasnja potrosnja na postojecim klonovima racuna tacno i poslije nadogradnje.
Ponasanje brane nije mijenjano: nedostupan log i dalje zaustavlja radnju.

**Kad se potrosnja ne moze procitati, jutarnja poruka to kaze umjesto da prikaze nulu.** Dosad je
greska citanja audit loga u dnevnom poslu tiho postajala "potroseno 0", sto je klijentu pokazivalo
suprotno od stvarnog stanja. Sada se pise da se podatak nije mogao procitati i javlja se
administratoru, a posao se nastavlja: dopuna poruke ne smije oboriti jutarnji posao.

**Odgovori grupnih alata vise ne rastu sa brojem oglasa.** `olx_bulk_price`, `olx_bulk_sklanjanje` i
`olx_refresh_bulk` su vracali pune spiskove neuspjelih, izabranih i izuzetih oglasa, do vise hiljada
redova u jednom odgovoru. Spiskovi se sada rezu na prag (`OLX_MAX_STAVKI_U_ODGOVORU`), uz obavezno
polje sa punim brojem kad je rez nastupio, da odgovor nikad ne izgleda potpun kad nije. Radnja se i
dalje izvrsava nad punim spiskom; rez dira samo prikaz. `olx_bulk_sklanjanje` je uz to dobio gornju
granicu na broj ulaznih `ids`, koje ranije nije imao.

**Citanje snapshota placa samo ono sto stvarno treba.** `zadnjiSnapshot()` je parsirao do 120 dnevnih
fajlova da bi vratio jedan, a sada cita od najnovijeg unazad i stane na prvom ispravnom.
`ucitajSnapshote()` je dobio opcioni prozor u danima, pa pozivalac koji gleda kratku seriju ne placa
punu. Ponasanje bez zadanog prozora je nepromijenjeno.

**AI runda ide na bijelu listu alata.** Runda je bila zasticena crnom listom, pa je svaki novi alat
bio dozvoljen dok se ne doda na nju. To je vec propustilo `olx_generiraj_sliku`, koji je skuplji od
alata zbog kojeg je crna lista i pisana. Sada se nabraja tacno ono sto runda smije, izvedeno iz
koraka recepta, pa je nov alat po defaultu nedostupan. Korak koji je povlacio kompaktnu listu svih
aktivnih oglasa prebacen je na agregirani izvjestaj, cija velicina ne raste sa katalogom.

**Popis mogucnosti se od sada generise iz koda, ne pise rukom.** Povod je mjerenje: kod je citao
86 varijabli okruzenja a `.env.example` ih je opisivao 66, uz pet tvrdnji u dokumentaciji koje su
bile netacne. Rucni popis je vec bio zaostao, i to tiho, pa je popravka rucnog popisa lijecila
simptom. `node scripts/popis-mogucnosti.mjs` cita stvarno stanje repoa (registracije alata i
resursa, stablo CLI komandi, `loadConfig`, sablone zakazanih poslova, skillove i podagente) i
upisuje `olx-dokumentacija/mogucnosti.md` i `mogucnosti.html`. Ta dva fajla se ne uredjuju rukom.

Uz njih stoji `olx-dokumentacija/sta-sistem-radi.md`, jedini rucno pisan dio: kratke recenice
obicnim jezikom, bez ijednog imena alata, za razgovor sa klijentom. Svaka tema nosi skriven spisak
sposobnosti koje pokriva.

**Srz posla nije popis nego test.** `scripts/lib/popis.test.mjs` sastavi popis iz koda i uporedi
ga sa onim na disku, pa pada kad se razidju. Isti test trazi da svaka sposobnost iz koda pripada
tacno jednoj temi rucne liste, pa nov alat kosta jedno ime u spisku, a stvarno nova sposobnost
jednu recenicu. Test cita samo fajlove repoa i `dist/`, jer `npm test` visi i na azuriranju
klijentskog klona.

Uz to se provjerava parnost zakazanih poslova: svaki `KLIJENT` posao mora imati zadatak istog
imena u Windows instalaciji. To je prvi put da se pravilo iz `.claude/rules/pogon.md` uopste
provjerava. `ADMIN` poslovi su izuzeti jer blizance nemaju i admin masina na Windowsu nije
podrzana; popis to izricito pise umjesto da se otkriva.

**MCP server i CLI se vise ne pokrecu samim uvozom modula**, nego samo kad su ulazna tacka
procesa (poredjenje `import.meta.url` sa `process.argv[1]`). Bez toga bi generator morao pokretati
server i pricati sa njim preko stdio da bi dosao do spiska alata, sto je krhko. Usput je
popravljeno i to da `scripts/kontekst-izvjestaj.mjs` na prekoracen rok baca gresku umjesto da vrati
praznu listu: tiha nula tamo znaci da rast konteksta prodje neopazeno.

Uklonjen tihi rez na 1000 oglasa u prelistavanju kataloga (`listAllByState`/`listAllActive`):
umjesto goleg niza koji tiho staje na 50 stranica, sada vracaju `SviOglasi { oglasi, potpuno,
ukupno, procitanoStranica, stranicaUkupno, razlog }`. Dva nezavisna ogranicenja umjesto jednog
broja stranica: `maxStranicaListe` je osigurac protiv pokvarenog `last_page` (default 5000
stranica), `budzetListeMs`/`budzetListeGrupniMs` su budzeti vremena po pozivaocu (75 s / 120 s).
Kad lista nije potpuna, `olx_bulk_price` i `olx_bulk_sklanjanje` ODBIJAJU rad umjesto da tiho
preskoce oglase; `olx_refresh_bulk` i dnevni posao rade dalje jer je obnova besplatna;
`olx_find_my_listing` odbija umjesto da javi lazno "nema pogodaka"; `stats snapshot` ne pise
snimak nepotpunog kataloga. `olx_list_listings` sa `all` iznad `OLX_MAX_OGLASA_U_ODGOVORU`
(500 oglasa) isporucuje katalog u komadima kroz nov parametar `komad`, umjesto da ga tiho
sijece. Detalji: `olx-dokumentacija/arhitektura.md` sekcija 10.

**Sta je popravljeno prije izdanja, poslije revizije gornjeg posla.** Sve navedeno postoji zato
sto bi inace radnja koja je radila na 0.14.0 poslije azuriranja radila losije:

- Razgovorni budzet liste podignut sa 20 s na 75 s (`OLX_BUDZET_LISTE_MS`). Na 20 s je efektivni
  plafon bio oko 700 oglasa, dakle NIZI od tihog reza od 1000 oglasa koji je vazio ranije, pa je
  klijent sa 800 oglasa gubio ono sto je prije dobijao. Cijena te odluke: u najgorem slucaju bot
  cuti do 75 s prije odgovora na alat koji cita cijeli katalog. To je losije po dozivljaju, ali
  bolje nego nepotpun ili odbijen odgovor, i desava se samo na velikim katalozima.
- `olx_competitor_report` dobija vlastiti kljuc `OLX_BUDZET_LISTE_KONKURENT_MS` (20 s), da
  serijski obilazak kandidata ne naslijedi duzi razgovorni budzet.
- `olx_sponsor_plan` trazi NAJSTARIJE oglase, a budzet odsijeca zadnje stranice, dakle bas njih:
  prijedlog iz nepotpune liste nije bio nepotpun nego sistemski pogresan. Sada cita katalog od
  kraja uz provjeru poretka, a kad to ne prodje, cita cijeli katalog i radije odbije nego da
  predlozi pogresne kandidate.
- `olx_bulk_price` i `olx_bulk_sklanjanje` sa zadatim `ids` (do 60) vise ne citaju katalog nego
  idu `getListing` po ID-u. Razlog `katalog_se_mijenjao` dobija jedan automatski ponovni pokusaj
  umjesto odbijanja. Poruka odbijanja vise ne savjetuje suzavanje kroz `category_id`, jer taj
  savjet nije mogao pomoci, nego navodjenje `ids` ili CLI.
- `olx_profile_stats` i `olx_onboarding_report` iz MCP-a dobijaju budzet, jer su ranije citali do
  osiguraca i mogli probiti MCP zid od 300 s, poslije cega korisnik ne dobije nista.
- `olx_sablon_opisa` vise ne cita cijeli katalog da bi zadrzao najvise 60 oglasa.
- `olx_find_my_listing` u odbijanju sada kaze i da korisnik moze dati broj oglasa direktno.
- Idle prag cuvara sesije vracen na stari (klijent 2 h, admin 1 h) kad `OLX_SESIJA_STRAZAR` NIJE
  ukljucen: bez straze istek praga sesiju samo restartuje, pa kratak prag ne stedi memoriju nego
  samo lomi kontinuitet razgovora. Uz strazu prag ostaje kratak (klijent 1 h, admin 30 min).
- `.env.example` je usklasen sa kodom: prazna vrijednost znaci nula, ne default, pa je nov klon iz
  tog fajla dobijao telemetriju iskljucenu. Sada su `OLX_RESURSI_INTERVAL_MIN` i
  `OLX_RESURSI_INTERVAL_STRAZA_MIN` upisani izricito.

**Izricito: `.mcp.json` dobija `"timeout": 300000` za server `olx-pik`.** Ova promjena stize u
SVAKI klon pri sljedecem azuriranju, jer je `.mcp.json` u gitu i azuriranje ga povlaci sa ostatkom
koda.

**Napomena uz grupne alate sa `ids`:** kad se ide `getListing` po ID-u, stanje oglasa se ne moze
pouzdano procitati iz punog odgovora, pa se u toj grani ne tvrdi da je oglas aktivan; odgovor
tada nosi `stanje_provjereno: false`. Radnja se svejedno izvrsava, jer trazeni oglas postoji.

Iza prekidaca `OLX_SESIJA_STRAZAR` (default iskljuceno, opt in po klonu): cuvar sesije moze
GASITI sesiju na prag mirovanja i na nocni termin umjesto da je restartuje, i sam preuzeti
Telegram strazu dok sesija spava.

- Bez `OLX_SESIJA_STRAZAR` u `.env` ponasanje ostaje bajt za bajt danasnje: nocni restart
  (`OLX_SESIJA_RESTART_SAT`) i idle restart (`OLX_SESIJA_IDLE_SATI`) samo ciste kontekst, sesija
  ostaje dignuta.
- Kad je ukljucen (za oba tipa sesije, ili samo `admin`, ili samo `klijent`): na isti prag i isti
  termin cuvar sesiju ugasi, pa sam polluje `getUpdates` (bez potvrde offseta) dok je sesija
  mrtva, i digne je na prvu poruku.
- Dobitak: klon u mirovanju pada sa ~200 do 500 MB na ~10 do 20 MB.
- Placa se hladnim startom: prva poruka poslije mirovanja ceka da sesija (claude + MCP + plugin)
  ustane, procjena 5 do 15 s.
- Jutarnja cron poruka (07:20) ide kroz `src/core/telegram.ts` mimo sesije, pa je nocno gasenje ne
  dira i ne budi sesiju zbog nje.
- Detalji i preporuceni redoslijed uvodjenja: `.env.example`, sekcija CUVAR SESIJE.

Novi ADMIN flotni posao `scripts/nadzor-flote.mjs` (deploy sablon
`deploy/launchd/ba.codefactory.olx.ADMIN.nadzor-flote.plist`, instalira se rucno jednom, kao
ostala tri ADMIN posla): svaki dan obidje sve klonove flote, sken diska po klonu, i upise dnevni
uzorak stanja masine (CPU, PSI, memorija, load). Svaka 3 dana agregira dnevne redove u nalaze i
salje sazetak adminu na Telegram.

- CPU% klona (`SHEMA_VERZIJA 2`, polje `cpu_klona_pct`) racuna se iz DELTE kumulativnog CPU
  vremena stabla procesa izmedju dva mjerenja, nikad iz trenutnog `%cpu`: sesija koja satima
  miruje pa naglo pocne raditi bi sa trenutnim `%cpu` i dalje pokazivala nisko zauzece satima
  poslije budjenja, razvuceno na sve satove mirovanja.
- Novi nalaz: detekcija ugnijezdene kopije klona (klon kloniran unutar drugog klona), sto trosi
  disk i zbunjuje skenove.
- Pragovi u `scripts/lib/analiza-flote.mjs` (`PRAGOVI_DEFAULT`) su pocetna procjena, ne izvedena
  iz stvarne serije mjerenja: treba ih ponovo pogledati kad se skupi par sedmica stvarnih
  podataka.

Default prag mirovanja (`OLX_SESIJA_IDLE_SATI`) prepolovljen: klijentska sesija sa 2 h na 1 h,
admin bot sa 1 h na 0.5 h (30 min). Klon koji zeli staro ponasanje postavi vrijednost u `.env`.

Telemetrija resursa pogona (`OLX_RESURSI_INTERVAL_MIN`, default 5 minuta dok sesija zivi;
`OLX_RESURSI_INTERVAL_STRAZA_MIN`, default 30 minuta dok cuvar strazari; prva prazna ili 0 gasi
telemetriju u cjelini): cuvar sesije (isti proces koji vec strazari, bez novog zakazanog posla)
periodicno upisuje u `.olx-pik/resursi/resursi-YYYY-MM.jsonl` RSS cuvara i cijelog stabla sesije
(sesija + MCP + bun poller, jednim `ps`/`Get-CimInstance` pozivom po uzorku), slobodnu memoriju i
swap masine, i dogadjaje starta, pada i budjenja iz straze (sa trajanjem hladnog starta).

- Na ulasku u strazu se uzima pun uzorak PRIJE gasenja sesije, jedini trenutak koji pokazuje
  trosak neposredno prije spavanja.
- Vrijeme provedeno u strazi se racuna prvenstveno iz parova gasenje-straze/budjenje (tacno), uz
  periodicne uzorke kao fallback kad par nije zatvoren.
- `node scripts/resursi.mjs pregled`, `izvjestaj [--dana N]` (i `--svi <root>` za vise klonova) i
  `dijagnostika` daju vlasniku flote uvid u trosak resursa i sta poboljsati.
- Nikad ne ide u backup stanja (crni spisak).

## 0.14.0 — 2026-08-14

Minor: admin moze danas povecati dnevni limit generisanja slika bez diranja .env.

- **Jednodnevni override dnevnog limita slika.** Novi alat `olx_limit_slika` (SAMO_ADMIN) upise
  povisen limit koji vazi ISKLJUCIVO za danasnji dan; sutra se automatski vraca na
  `OLX_SLIKA_MAX_DNEVNO`/fallback 10, bez rucnog ciscenja. Postoji jer admin bot sesija namjerno
  nema Write/Edit/Bash ni Read na `.env*` fajlove (zastita tokena), pa do sada nije bilo naina da
  se plafon podigne "za danas" bez rucne izmjene fajla na masini.
- Poruka greske kad se plafon dostigne sad kaze tacno kako se limit mijenja: `olx_limit_slika`
  za danasnji bump, `OLX_SLIKA_MAX_DNEVNO` u `.env` za trajnu promjenu.

## 0.13.0 — 2026-08-13

Minor: kvota za nove objave se racuna automatski, alarm za istek paketa eskalira, i novi opseg
`objava` daje klijentu nacin da odluci prioritet kad katalog udari u limit kategorije. Uz to,
jutarnji posao (`posao dnevni`, `stats snapshot`) prvi put ima integracione testove. Prate ga
`docs/stories/1.1.*` i `docs/stories/1.2.*`.

- **Integracioni testovi za jutarnji posao**: `posao dnevni` i `stats snapshot` orkestracija u
  `src/cli/index.ts` (1912 linija, do sada bez ijednog testa) dobila je pokrivenost preko
  subprocess testova (`scripts/lib/posao-dnevni.test.mjs`, `stats-snapshot.test.mjs`) i round-trip
  test za `src/core/snapshoti.ts`. Racunski sloj (`stats.ts`, `izvjestaj.ts`) je vec bio testiran
  i ostaje netaknut.
- **Kvota objave, eskalacija alarma, prioritet objave za velike kataloge**: `olx_profile_stats`
  sada racuna `objava_limit` (koliko NOVIH artikala jos staje po grupi kategorija, analogno
  kvoti obnova) i `objava_kandidati_predlog` kad je grupa blizu/na limitu. Alarm za istek paketa
  eskalira na tri nivoa (info/upozorenje/hitno, 30/14/3 dana) umjesto jednog praga, uz novi alarm
  `objava_limit`. `olx_izuzeca` dobija treci opseg `objava` (uz `obnova`/`izdvajanje`) da klijent
  oznaci prioritet kad katalog udari u limit — namjerno izolovan od dnevne obnove, nikad ne
  blokira obnovu tiho. `olx_list_listings` dobija filtere `category_id`/`price_min`/`price_max`
  za selekciju vise oglasa bez rucnog pregleda stotina artikala. Cijena: MCP seme +413 tokena
  (+4.2%), mjereno `npm run kontekst`.

## 0.12.2 — 2026-08-04

Patch: put slike ide iskljucivo na Gemini, najjeftiniji modeli su default svugdje.

- **Vid (opis slike za pogon bez vida) je iskljucivo Gemini**: Anthropic varijanta i
  `OLX_VID_PROVAJDER` su uklonjeni. Alat se registruje cim postoji `OLX_SLIKA_API_KEY`, pa je
  postavka slika za klijenta jedan Gemini kljuc za sve (opis `gemini-3.1-flash-lite`,
  generisanje `gemini-3.1-flash-lite-image`).
- Ekstrakcija telefona vise ne pada na `OLX_VID_API_KEY` (tamo sada stoji Gemini kljuc koji
  Anthropic poziv odbija): Haiku prolaz radi samo uz izricit `OLX_TELEFON_API_KEY`, bez njega
  ostaje besplatni regex.
- Uz flash default iz 0.12.1 time svaki AI poziv ide na najjeftiniji model svog provajdera.

## 0.12.1 — 2026-08-04

Patch: default DeepSeek modela je flash, uvijek.

- `.env.example` za nove klonove ide na `deepseek-v4-flash`, a kod dobija isti fallback i kad
  varijable nema (endpoint bi Claude ime inace mapirao na pro, pa je prazan `.env` tiho znacio
  skuplji model). `deepseek-v4-pro` ostaje izbor po klijentu kroz `OLX_DEEPSEEK_MODEL`; razlog
  i mjerenje u `deepseek-nalazi.md`. Postojeci klonovi sa eksplicitnim pro u `.env` se ne
  mijenjaju sami: linija se mijenja rucno.

## 0.12.0 — 2026-08-04

Minor: artikal se moze skinuti sa shopa i kasnije vratiti identican; automatske obnove krecu tek kad klijent izabere ritam.

- **Skini artikal, vrati kad stigne.** Na "skini / preuzmi / spremi ovaj artikal" bot sacuva
  kompletan oglas sa originalnim slikama lokalno (`.olx-pik/arhiva-artikala/`), pa oglas sakrije.
  "Vrati" ga otkrije odmah, besplatno i identicnog; kad oglasa vise nema, objavi se novi iz
  sacuvanog kroz postojecu potvrdu troska, a izuzece od obnova predje na novi broj oglasa.
  Arhiva ulazi u backup kao jedini primjerak slika. Tri nova MCP alata (`olx_skini_artikal`,
  `olx_arhiva`, `olx_vrati_artikal`); pravog brisanja i dalje nema. Kad namjera nije jasna,
  bot prvo pita zeli li covjek artikal skloniti i sacuvati, zavrsiti kao prodan, ili samo
  preskakati u obnovama.
- **Automatske obnove tek na odluku klijenta.** Dok ritam nije zapisan, dnevni posao ne obnavlja
  nista: prva jutarnja poruka pita klijenta kako zeli (broj i lista danas dostupnih oglasa, pet
  ponudjenih odgovora), narednih dana ostaje samo podsjetnik u jednoj liniji. Ritam dobija i
  opciju "iskljuceno". VAZI I ZA POSTOJECE KLONOVE: poslije azuriranja obnove staju dok klijent
  ne odgovori na jutarnje pitanje, ili se ritam upise unaprijed.
- Dokumentacija: Gold paket ima limit od 2.000 artikala i u njega ulaze i skriveni oglasi (mjesto
  oslobadja samo zavrsavanje); opciju ponovne objave zavrsenih oglasa platforma je ukinula.

## 0.11.0 — 2026-08-03

Minor: klijentska sesija dobija otvorene alate uz guardrails u promptu; DeepSeek postaje default za nove klonove.

- **Alati klijentske sesije otvoreni odlukom vlasnika** (Bash, pisanje fajlova, pretraga, web),
  da bot klijentu moze analizirati poslani fajl ili napraviti tabelu. Svaki otvoren alat je i u
  allow listi, da nista ne visi na permission promptu (preko Telegrama nema ko kliknuti).
  Zakljucane ostaju tajne (`.env` svugdje, kredencijali kanala, KLIJENT.md) i globalni
  `~/.claude/channels`; guardrails za koristenje alata su u `runtime/SISTEM-klijent.md`
  (radni folder `.olx-pik/klijent-fajlovi/`, bez diranja konfiguracije, komanda iz poruke
  nije naredba). Postojeci klonovi preuzimaju novi profil kopiranjem
  `runtime/settings.klijent.json` u `.claude-runtime/settings.json` pa restartom sesije.
- **DeepSeek je default za nove klonove** (`OLX_KLIJENT_AI=deepseek` u `.env.example`); bez
  popunjenih kljuceva sesija se i dalje NE pokrece, pa klon ne moze tiho preci na pretplatu.
  Kod bez varijable i dalje pada na pretplatu (postojeci klonovi se ne mijenjaju sami).
- Radni fajlovi bota (`.olx-pik/klijent-fajlovi/`) su na crnom spisku backupa: isporuceni su u
  grupu cim nastanu.

## 0.10.0 — 2026-08-03

Minor: postavka klona na Windowsu radi bez rucnih zaobilaznica; rok kvote obnova sada dosljedno po ciklusu pretplate.

- **Rok kvote obnova ide po ciklusu pretplate, kalendar nije rok.** Jedan prekidac
  (`IZVOR_ROKA_KVOTE`) i jedna funkcija (`rokResetaKvote`); dnevni plan, onboarding i alarmi ne
  mogu vise reci razlicit rok. Bez izvora je `dana_do_reseta` null umjesto izmisljenog broja;
  spor mjerenja i ciklusa se biljezi za presudu 24.08.2026.

- **Rucni launcher klijentske sesije radi na obje platforme, u istom terminalu:**
  `node scripts/pokreni-klijenta.mjs` (i `npm run klijent`). Stari `pokreni-klijenta.sh` je
  tanki omotac oko njega. Launcher, kao i cuvar, eksplicitno postavlja `OLX_MCP_PROFILE=klijent`
  okruzenju sesije (stari .sh se oslanjao samo na .env).
- **Telegram plugin instaliraju pripremi skripte same** (`pripremi-runtime.mjs`,
  `pripremi-admin-runtime.mjs`), idempotentno; na pad ispisu rucne komande u bash i PowerShell
  sintaksi i nastave. Zatvara klasu kvara "klon prodje preflight a bot cuti".
- **Zajednicka logika pokretanja sesije u `scripts/lib/sesija.mjs`** (argv, AI mapiranje,
  provjere, spawn sa Windows quotingom): cuvar i launcher je dijele pa se ne mogu raziici.
  Usput popravljeno: `OLX_KLIJENT_AI=DeepSeek` velikim slovom je kroz bash launcher tiho padao
  na pretplatu.
- **Preflight (`provjeri-klon.mjs`)**: komande za popravku upotrebljive i u PowerShellu, nova
  PAZNJA stavka za `claude login` po runtime folderu na Windowsu (pretplata), izvrsiva uputa
  kad fali telegram .env/access.json.
- **Dokumentacioni prolaz za postavku na novom racunaru**: README (Node 20.12 minimum, bun,
  launcher, spisak skillova, PowerShell sintakse), skill `olx-novi-klijent` (okidac "postavi
  sve", prva proba launcherom prije instalacije poslova, login prije poslova), `oporavak.md`,
  `arhitektura.md`, `olx-mcp-setup`, `instaliraj-zadatke.ps1` (bun provjera, login upozorenje),
  `SISTEM-admin-bot.md` (dozvoljene preporuke komandi), `olx-dijagnostika` (plugin provjera bez
  Basha).

## 0.9.2 — 2026-08-03

Patch: popravka testa, bez promjene ponasanja bota.

- **Test simbolickog linka se na Windowsu bez Developer Mode ili admin prava vise ne racuna kao
  pad.** Pravljenje direktorijumskog simlinka na takvim Windows masinama baca EPERM prije nego
  test stigne provjeriti sta zeli; test to sada prepozna i preskoci umjesto da rusi testnu kapiju.
  Na macOS/Linux se test i dalje izvrsava nepromijenjen.

## 0.9.1 — 2026-08-02

Patch: sporan rok kvote se klijentu ne izgovara.

- **Kad se izmjereni dan reseta i dan ciklusa pretplate razilaze, rok je sporan i poruka ga ne
  tvrdi** (`rok_izvor: "sporno"`, `rok_poznat: false`). Mjerenje od 01.08. pokazuje kalendar, a
  administrator kvotu vezuje za istek paketa; dok jedan izvor ne potvrdi (presuda 24.08.),
  nijedan broj se ne tvrdi. Racun tempa ide po mjerenju. Vazi za dnevnu poruku, alarme i
  onboarding izvjestaj (olx://pravila-brojeva).

## 0.9.0 — 2026-08-02

Minor: mijenja se ponasanje dnevne poruke i racun roka kvote, i dodan je alat za pozadinu slika.
Postojeci klonovi ne trebaju rucnu intervenciju.

- **Rok obnove kvote ide po prioritetu izvora: izmjereno > ciklus > kalendar.** Prvo zivo
  mjerenje (01.08.2026: `free_count` pao 318 na 59 bas 1. u mjesecu) ide u prilog kalendaru,
  suprotno hipotezi ciklusa iz 0.8.0. Umjesto nove pretpostavke, rok sada uzima IZMJERENI dan
  reseta iz `.olx-pik/kvota-dnevnik.jsonl` kad postoji (`izmjereniDanReseta`), i sam se ispravi
  na svakom sljedecem resetu. Vazi isto za dnevni plan, alarme i onboarding izvjestaj; izvor
  roka stoji u novom polju `rok_izvor`. Presuda kalendar/ciklus pada 24.08.
  (olx://pravila-brojeva).
- **Dnevna poruka javlja i trosak, plan izdvajanja i slijepe tacke kataloga.** Novo: potroseni
  krediti danas (iz audit loga), dospjeli a neizvrseni termini plana izdvajanja, oglasi bez
  ijednog novog pregleda (nad serijom od bar 14 dana), preskoceni po listi izuzetaka i broj onih
  koji miruju. Poruku okidaju samo trosak i dospjeli termini; ostalo je sadrzaj za poruku koja
  se ionako salje, da klijent ne dobija prazan izvjestaj svaki dan.
- **Preostale obnove u poruci racunaju i obnove iz istog prolaza.** Prijavljeno 01.08.2026:
  poruka je u istom dahu tvrdila "obnovljeno 59" i "preostalo 1800 od 1800", jer se plan racuna
  prije slanja obnova.
- **Izvjestaji idu u sve grupe iz `access.json`.** Spisak grupa je jedan izvor za oba smjera:
  po njemu bot prima poruke i po njemu izvjestaji odlaze. `TELEGRAM_CHAT_ID` ostaje samo dopuna.
  Nova CLI komanda `telegram grupe` (i `dodaj`/`ukloni`) upravlja spiskom bez diranja runtimea.
- **Slike: proporcije artikla se cuvaju, original se cita i iz Telegram fajla, nov alat
  `olx_pozadina`.** Generisanje vise ne razvlaci artikal (isti faktor na obje ose), fotografija
  poslana kao fajl vise ne prolazi Telegram rekompresiju, uploadovane slike se ciste nakon
  odgode, a klijent moze zadati stalnu pozadinu koja se crta iznova za svaki oglas (slicna,
  nikad identicna; kaze se unaprijed).

## 0.8.0 — 2026-07-31

Minor, a ne patch: dva nova alata, nov nacin onboardinga i promijenjeno ponasanje dnevne obnove.
Nijedan postojeci klon ne treba rucnu intervenciju, sve nove varijable imaju podrazumijevane
vrijednosti i novo stanje se pravi samo.

- **Web onboarding klijenta, iz jedne komande.** `scripts/onboarding-uzivo.mjs`: klijent dobije
  link, prijavi se, token i sve ostalo ostane na admin kompjuteru. Bez Cloudflare naloga i bez
  deploya (`wrangler dev --local` plus brzi tunel), pa OLX login ide sa admin IP adrese. Token u
  prolazu je sifrovan admin javnim kljucem, lozinka se nikad ne cuva.
- **Nov OLX token se preuzima bez restarta sesije.** Na 401 se `.env` procita ponovo i, ako je
  token zamijenjen, poziv se ponovi jednom. Rjesava rotaciju tokena uopste, ne samo onboarding.
  Restart sesije jos treba samo kad se mijenja `KLIJENT-javno.md`, jer on ulazi u prompt pri
  startu; za to puller ostavi `.olx-pik/restart-sesije`, a cuvar ga procita i restartuje sesiju.
- **CLI `stats konkurent-telefon <username>`**: telefon kandidata iz javnog teksta shopa i oglasa,
  jer API ga za tudje naloge ne vraca kao polje. Regex prvo, Haiku samo kad regex nije siguran.



Kvota obnova se racuna po ciklusu pretplate i po ostvarivom, ne po kalendaru i sirovoj kvoti.
Prijavljeno iz prakse 31.07.2026: klijent je u jutarnjoj poruci dobio "Do kraja mjeseca 1 dana",
a njegov ciklus je istjecao 24.08., dakle 24 dana.

- **Rok kvote ide iz `shop.ends_at`**, novi `danaDoResetaKvote` i `danCiklusaIzIsteka`. Uzima se
  DAN u mjesecu, ne broj dana do isteka: paket na sest mjeseci ima `ends_at` daleko u buducnosti,
  a mjesecnica je i dalje isti dan. Kratki mjeseci se stezu (dan 31 u februaru je 28), a kad je
  reset bas danas vazi sljedeci ciklus. Bez `ends_at` se pada na kalendar, ali se tada rok
  korisniku NE izgovara (polje `rok_poznat`), jer je to pretpostavka.
- **Tempo se racuna na OSTVARIVO.** `dnevniPlanObnova` je krsio pravilo koje repo vec ima
  zapisano (`pravila-brojeva.md`: "poredjenja i alarmi idu na ostvarivo, ne na sirovu kvotu"):
  dijelio je preostalu kvotu na dane i dobijao tempo koji nijedan katalog ne moze ispuniti.
  Izmjereno na MixBoxu: cilj 121 dnevno na shopu gdje je odrzivo oko 17, jer se isti oglas
  besplatno obnavlja tek svakih 7 dana. Sada `cilj_danas` izlazi 16, a `ostvarivo` je u izlazu.
  Ovo mijenja i PONASANJE, ne samo tekst: `posao dnevni` izvrsava `plan.za_obnovu`.
- **Dva razlicita racuna dana su svedena na jedan.** `alarmiNaloga` je dane racunao rucno i BEZ
  danasnjeg dana, pa je ista cron poruka mogla reci "1 dana" iz jednog izvora i "0 dana" iz
  drugog. Alarm sada gleda reset kvote, ne kraj kalendara.
- **`ostvarivihObnova` zna za PRO** (prag 21 dan). Ranije je svaki nalog bez shopa dobijao 30 i
  time potcijenjeno ostvarivo. Prag je izdvojen u `pragObnove`.
- **Sklonjene su dvije tvrdnje bez izvora**: "Neiskoristena kvota se ne prenosi u sljedeci
  mjesec" i skillovo "zadnjeg dana mjeseca potrosi sve preostalo". Da se kvota ne prenosi nije
  potvrdjeno nicim, a rafal pred pogresnim rokom bi ostavio shop bez obnova na pocetku ciklusa.
- **Poruka navodi pravi razlog.** Umjesto "jer nemate toliko oglasa" (klijent ima 121) sada kaze
  da se isti oglas besplatno obnavlja tek nakon nekoliko dana i da je to granica platforme.
  Broj dana se sklanja, "1 dana" vise ne postoji.
- **Ritam obnavljanja je odluka trgovca.** Novi `olx_ritam_obnova` i `.olx-pik/ritam-obnova.json`
  po uzoru na izuzeca: `ravnomjerno` (podrazumijevano), `sve-dostupno`, `interval` sa brojem dana.
  Kraci interval od praga platforme se podize i to se javi, da se ne obeca ritam koji se ne moze
  izvrsiti. Bot pita jednom kad ritam nije zapisan. Krediti kroz ovo ne prolaze nijednom linijom.
- **Novi `.olx-pik/kvota-dnevnik.jsonl`**: jedan red dnevno sa stanjem kvote, jer API ne vraca
  datum reseta i bez serije se dan reseta ne moze prepoznati. `daniResetaKvote` ga cita. Time se
  zatvara otvoreno pitanje iz `pravila-brojeva.md`, koje je imalo zakazan test za 01.08.2026.
- **Prvi testovi nad TEKSTOM poruke.** `izvjestaj.test.ts` je do sada pokrivao samo kapiju za
  slanje, pa je greska prosla bez ijednog crvenog testa. Testovi u `stats.test.ts` koji su staru
  semantiku drzali kao ispravnu su prepisani, ne zaobidjeni.


Granice upotrebe klijentskog bota. Do sada je bot bio ogranicen po SPOSOBNOSTIMA (koje alate
ima), a nikako po NAMJENI: nista ga nije vezalo za posao oko shopa, a generator slika je primao
proizvoljan tekst i radio i bez ijedne fotografije.

- **Generator slika u klijentskom profilu prima samo recept sa spiska.** Sema alata
  `olx_generiraj_sliku` se sada razlikuje po profilu: klijent bira izmedju gotovih recepata i
  ne vidi slobodan tekst kao mogucnost, pa odbijanje pada na validaciji i ne kosta nijedan token
  kod Geminija. Admin zadrzava slobodan tekst, jer tako i nastaju novi recepti.
- **Uz recept za artikal mora ici prava fotografija**, a kratka dopuna scene ("pozadina svijetlo
  siva") prolazi kroz filter. Posljedica: tekst koji je napisao klijent moze uci u prompt samo
  zajedno sa fotografijom koju je klijent prilozio. Naslovna slika shopa je jedini recept bez
  fotografije i zato ne prima dopunu. Ista brana stoji i u jezgru (`provjeriZahtjevSlike`), pa
  vazi za svakog pozivaoca, ne samo za MCP.
- **Novi trag `.olx-pik/slike-zahtjevi.jsonl`**: sta je trazeno od generatora i sta je odbijeno,
  doslovno. Odvojen od `ai-usage.jsonl` jer taj dnevnik garantuje samo brojeve i nikad sadrzaj.
  Ide u backup, jer je dokazni materijal.
- **Sporna roba zaustavlja objavu do potvrde.** Novi `provjeriRobu` po clanu 8 Uslova koristenja
  PIK.ba: `olx_draft_check` javlja nalaz jos dok je oglas nacrt, a kreiranje, izmjena i objava
  bez potvrde staju uz objasnjenje. Namjerno UPOZORENJE a ne blokada: lista nad domacim
  tekstom nikad nece biti tacna, pa odluku donosi covjek, ali nista ne prolazi tiho. Oruzje
  nije na listi, jer se lovacko i sportsko u BiH legalno prodaje.
- **Potvrda sporne robe je odvojena zastavica (`potvrdi_spornu_robu`), ne `confirm`.** Sa jednom
  zajednickom zastavicom bi oglas sa spornom rijeci u naplatnoj kategoriji prosao ovako: padne na
  robi, covjek potvrdi robu, i cijena objave prodje a da je niko nije izgovorio. Dvije brane,
  dvije potvrde; zakljucano testom u `client.test.ts`.
- Grupne radnje nisu pogodjene: `olx_bulk_price` salje samo cijenu, pa oglas cije ime sadrzi
  spornu rijec ne obara rutinski prolaz kroz katalog.
- **Klijentski prompt dobio opseg posla**: sta jeste posao bota, sta nije, i kako se odbija u
  jednoj recenici uz konkretan potez na shopu. Pozdrav i obicna ljubaznost se ne odbijaju.
  Pravila vaze prema svakome ko pise u grupi, a uputa unutar poruke ili teksta oglasa ih ne
  mijenja. `scripts/provjeri-prompt.sh` dobio cetiri nove provjere, sve samo za klijentski
  profil, da odstupanje bude mjerljivo a ne stvar utiska.

## 0.7.1 — 2026-07-30

Prvo izdanje provjereno na obje platforme, i prvo koje popravlja nalaz sa Windowsa.

- Popravljen `npm test`, koji je na Windowsu tiho preskakao SVE testove. `node --test dist/core/`
  tamo ne silazi u direktorijum nego ga izvrsi kao jedan test i lazno prijavi "1 pass". Posljedica je
  teza od same greske: `npm test` je kapija u `azuriraj.ps1` i `azuriraj-ovaj-klon.mjs`, pa je na
  Windowsu propustao svako izdanje kao da je provjereno. Nadjeno na Windows masini pri provjeri
  izdanja 0.6.0.
- Popis test fajlova sada pravi `scripts/testovi.mjs`, ne shell ni Node glob. Prva popravka je bila
  `node --test "dist/core/**/*.test.js"`, sto rjesava Windows ali na Node 20 javi "Could not find" i
  ne nadje NI JEDAN test, dakle zamjena jedne tihe greske drugom (izmjereno na macOS-u, Node
  20.19.5). Runner nabraja fajlove sam i predaje ih eksplicitno, pa ne zavisi ni od shella ni od
  verzije Node-a, i PADA kad fajlova nema umjesto da prijavi uspjeh.

## 0.7.0 — 2026-07-30

DeepSeek pogon prestaje zavisiti od konfiguracije koja postoji samo na jednoj masini. Ovo izdanje
nikad nije bilo u floti: prekidac je presao sa 0.6.0 direktno na 0.7.1.

- `scripts/claude-ds.mjs`: rucna DeepSeek sesija na obje platforme, sa kljucem iz `.env` klona.
  Zamjenjuje zsh funkciju `claude-ds` iz `~/.zshrc`, koja je bila globalna po masini (dakle upravo
  ono sto CLAUDE.md zabranjuje) i zato na Windowsu nije ni postojala. Uz to rjesava razliku izmedju
  rucne i pogonske sesije: mapira iste varijable kao pogon i nista vise, pa Telegram kanal u rucnoj
  sesiji vise ne gasi varijabla iz starog `deepseek.env`.
- `npm run deepseek:proba` cita kljuc i endpoint iz `.env` klona, sa istog mjesta odakle ih cita
  pogon. Prije je citala `~/.claude/deepseek.env`, pa je proba mogla proci a sesija ne raditi.

## 0.6.0 — 2026-07-30

Zatvaranje posla je sada jedan tok koji ide do kraja, umjesto niza komandi koje se pamte.

- `scripts/pusti-u-flotu.mjs`: zadnji dio izdanja u jednom potezu. Bez zastavice radi samo povratno
  (push commita i tagova) i stane; `--pomjeri-stabilno` pomjeri prekidac i sam azurira flotu.
  Provjerava i da je izdanje anotiran tag, jer lightweight `v` tag pokvari `git describe` na
  klonovima. Vracanje na staro izdanje je isti potez sa `--izdanje`.
- Skill `olx-izdanje` prepisan u izvrsni tok od "posao je gotov" do "flota vozi novo": testovi,
  changelog iz git loga, broj po sadrzaju izmjena, izdanje, pustanje, provjera da je proslo, pa
  evidencija u clipboard. Ima dva rezima: povratni (do taga) i do kraja.

## 0.5.1 — 2026-07-30

- `npm version` sada na kraju gradi (`postversion` hook). Bez toga je `dist` ostajao na starom
  broju odmah poslije izdanja, pa je `olx --version` govorio jedno a `package.json` drugo. Preflight
  je to hvatao kao "src noviji od dist", ali izdanje ne treba ostavljati posao za preflight.

## 0.5.0 — 2026-07-30

Upravljanje izdanjima prestaje biti popis koraka u dokumentu i postaje alat koji ne moze zaboraviti
redoslijed.

- `scripts/izdanje.mjs` i skill `olx-izdanje`: izdanje se odbija ako bi bilo polovicno (pogresna
  grana, prljava radna kopija, klon iza remotea, zauzet tag, nedostajuca sekcija u ovom fajlu).
- Klon sam javi da zaostaje: `SessionStart` hook zove `scripts/provjeri-izdanje.mjs`, poredi klon sa
  daljinskim prekidacem i da komandu. Ne povlaci nista sam, i tih je u klijentskoj bot sesiji da
  verzija ne dodje u kontekst bota.
- `scripts/azuriraj-ovaj-klon.mjs`: azuriranje jednog klona iz njega samog, na obje platforme. Pri
  padu builda ili testova VRACA klon na prethodno izdanje i ponovo ga izgradi, pa nema stanja sa
  novim `src` i starim `dist`.
- Agent `olx-dijagnostika` gleda izdanje rano, jer simptom "od jucer" na klonu koji zaostaje cesto
  ima popravku koja postoji ali nije dosla.

## 0.4.0 — 2026-07-30

Prvo oznaceno izdanje. Sve prije ovoga se u audit logu i u `--version` prijavljuje kao `0.1.0`,
jer broj verzije do sada nije bio vezan ni za jedno stvarno stanje koda.

- Verzioniranje sistema: `src/core/verzija.ts` je jedini izvor broja, `npm version` ga podize i
  tagira, a verzija se vidi u CLI-ju, MCP handshakeu, audit zapisu i provjeri klona.
- Popravljeno tiho neazuriranje flote: `git fetch --tags` bez `--force` je odbijao pomjeriti tag
  koji lokalno postoji, pa je klon mogao ostati na starom kodu dok skripta prijavljuje uspjeh.
  Oba azuriranja (macOS i Windows) sada prijavljuju i ime izdanja na kojem je flota.
- Test koji cuva granicu slojeva: `src/core` ne smije uvoziti iz `src/mcp` ni `src/cli`.
- Atomican upis snapshota pregleda i snimaka konkurenata.
- Backup klijentskog stanja u odvojen repo, grana po klijentu, sa bijelim spiskom fajlova.

## 0.3.0 — 2026-07-30

Stanje koje je nosio tag `stabilno` prije uvodjenja verzioniranja. Kod ovog izdanja sam sebe
prijavljuje kao `0.1.0`; to je i razlog zasto verzioniranje postoji.

- Telegram most bez kanala, Gemini za opis i generisanje slika, brana za tisinu bota.
- Pravilo o grupnim radnjama umjesto petlje pojedinacnih poziva, izmjereno na stvarnoj sesiji.
- Izuzeci od obnove i izdvajanja, i u dnevnom poslu, plus CSV za cijeli katalog.
- Brana troska i na objavi i na promjeni kategorije, prazan opis zaustavlja objavu.
- Link na oglas u odgovorima, jer ga API ne vraca a korisnik ga trazi odmah.
- Profil klijenta u promptu i pamcenje koje bot sam pise, pa sesija posle nocnog restarta zna ton
  i navike bez ijednog poziva alata.
- Prijedlozi AI runde kroz alat, i sablon opisa koji se cita iz kataloga umjesto da se izmislja.

## Prije verzioniranja

Bez tagova, jer nijedno od ovih stanja nije bilo propusteno kao izdanje. Popis je tu da se zna
kada je sta nastalo; tacne granice se citaju iz `git log`.

- **29.07.2026.** Preflight provjera klona (`provjeri-klon.mjs`), skill `olx-novi-klijent`, vision
  proxy `olx_opisi_sliku`, kanal saznanja iz prakse, Windows spremnost pogona, tajne nedostupne
  klijentskoj sesiji, i pravilo da se o pitanjima kupaca ne tvrdi nista.
- **28.07.2026.** Pogon klijenta: cuvari sesija, admin bot, AI runda i cron za obje platforme.
  Alat `olx_sponsor_plan`, pravila po slojevima, podagenti, dokumentovana arhitektura.
- **27.07.2026.** Agregacioni `stats` sloj i kompaktni izlazi alata.
- **25 i 26.07.2026.** Jedan nalog po klonu, audit log, planer izdvajanja, spajanje kataloga sa
  vanjskim sistemom, pravila brojeva, korpus zvanicne PIK pomoci, DeepSeek profil i mjerenje
  potrosnje, testovi spend-guarda, skillovi za SEO, klijent flow i dnevnu obnovu.
- **Jun 2026.** Jezgro (`OlxClient` sa throttleom, retryem i spend-guardom), CLI, MCP server,
  upload slika kroz multipart, CSV indeksi kategorija i lokacija, knowledgebase.
