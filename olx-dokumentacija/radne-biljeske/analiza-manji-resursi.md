# Analiza: manji otisak resursa pogona

Datum: 12.08.2026. Grana: `arhitektura-manji-resursi`. Nalazi iz tri nezavisna pregleda:
mjerenje procesa na admin masini, mapa pogona u produkciji, i mjerenje sprege modula kroz
import graf i istoriju commita.

## 1. Sta stvarno trosi resurse

Mjerenje na admin masini i citanje pogona daju istu sliku: **sam OLX kod je zanemariv
potrosac, trosi Claude Code sesija koja zivi stalno.**

Po klijentskom klonu u produkciji (stablo procesa):

| Proces | RSS | Udio |
| --- | --- | --- |
| `claude` sesija (stalna, KeepAlive) | 130 do 416 MB | ~95 % |
| `bun server.ts` (grammy poller Telegram plugina) | ~42 MB | |
| `node dist/mcp/server.js` (olx-pik) | 3 do 30 MB | |
| `node cuvar-sesije.mjs` | 3 do 10 MB | |

* Bazna linija po klonu: ~200 do 250 MB u mirovanju, do ~500 MB pod radom.
* Sa admin botom (drugi cuvar, druga sesija, drugi poller, drugi MCP): 400 do 900 MB.
* CPU u mirovanju blizu nule: long poll ceka na socketu, cuvar se budi svakih 60 s,
  poller svakih 5 s.
* Kalendarski poslovi (snapshot, dnevno, sedmicno, backup) su jednokratni Node procesi
  bez modela, peak 50 do 80 MB na sekunde do minute. Njih ne treba dirati.
* MCP server ne ucitava nista pri startu, veliki JSON-ovi se citaju lijeno po zahtjevu.

Kljucni detalj postojece mehanike: cuvar VEC ima idle logiku (2 h klijent, 1 h admin bot,
`OLX_SESIJA_IDLE_SATI`), ali ona sesiju RESTARTUJE i odmah je digne ponovo
(`cuvar-sesije.mjs`, exit handler dize dijete za 3 s). Cilj joj je cistoca konteksta,
ne memorija. Memorija se nikad ne vraca.

Uz to dvije slabosti nadjene usput:

* Prazna sesija koja nikad nije dobila poruku se nikad idle ne restartuje
  (uslov `aktivnost > startTs` u `cuvar-sesije.mjs:555`); dotakne je samo nocni restart.
* `node_modules` nosi ~286 MB paketa kojih NEMA ni u `package.json` ni u lockfileu
  (`@imgly` 137 MB, `onnxruntime-node` 133 MB, `@img` 16 MB), ostatak napustenog
  eksperimenta sa uklanjanjem pozadine. Cist `npm ci` daje ~50 MB umjesto 367 MB.

## 2. Ocjena tri hipoteze

### Hipoteza 1: API i MCP u poseban repo. ODBACITI (za cilj "manji resursi")

Cijepanje repoa ne oslobadja nijedan bajt RAM-a ni sekundu CPU-a: u produkciji rade isti
procesi bez obzira na to iz koliko repoa je kod stigao. Jedina "tezina" koju bi podjela
naizgled rijesila je disk, a tu je pravi krivac 286 MB orphan paketa (tacka 1).

Kod je vec uzorno raslojen (`src/core` ne uvozi nista van sebe, brana
`src/core/slojevi.test.ts` to cuva; `mcp` i `cli` uvoze samo iz core, nikad jedan drugog),
pa podjela ne donosi ni arhitektonsku cistocu koje vec nema. A kosta:

* `src/mcp/server.ts:58-64` tvrdo kodira putanje do `olx-dokumentacija/` za svih 8 MCP
  resursa; `category dump` i `location dump` pisu u isti folder.
* Tag `stabilno` je JEDAN pointer koji atomicno opisuje cijelo stanje flote. Dva repoa
  znace dvije matrice kompatibilnosti i prepravku sest skripti izdanja i azuriranja.
* 44 % od zadnjih 138 commita dira i kod i znanje u istom potezu.

### Hipoteza 2: skillovi i znanje u poseban Claude Code repo. ODBACITI, jeftinija alternativa postoji

Isti argument troska dostave kao gore, plus dva tvrda loma prvog dana:

* Klijentska sesija trazi skillove iz projektnog foldera klona (`.claude/skills`).
  Klon bez tog foldera je bot bez skillova, treba novi mehanizam dostave.
* Skill u ovom sistemu nije dokumentacija nego interfejs prema kodu: `olx-izdanje`,
  `olx-novi-klijent`, `olx-dijagnostika` i pravila referenciraju skripte i buildove na
  vise od 40 mjesta, a `dodaj-telefone.py` eksplicitno trazi `dist/cli/index.js`.

Ako je stvarni motiv "klijent ne treba vidjeti admin materijal": `interno/` (54 MB) i
`shopovi-snimci/` su vec van gita, a podjela admin i klijentskih skillova se rjesava
oznakom ili podfolderom po profilu (obrazac vec postoji: `OLX_MCP_PROFILE`), ne repoom.

### Hipoteza 3: sesija se pokrece po poruci i gasi poslije mirovanja. PRIHVATITI, ovo je jedina prava poluga

Tacna dijagnoza: klijenti ne pisu po cijeli dan, a sesija od 130 do 416 MB stoji za
svaki klon non stop. Arhitektura je vec spremna za ovo vise nego sto izgleda:

* Prompt se SASTAVLJA pri svakom pokretanju (`sastavi-prompt.mjs`), pamcenje se ponovo
  ubaci, pa sesija poslije gasenja ustaje ravnopravna onoj poslije nocnog restarta.
  Nema stanja koje bi se gasenjem gubilo.
* Kalendarski poslovi ne idu kroz sesiju (jutarnja poruka salje CLI direktno), pa
  gasenje sesije ne dira nijedan automatski posao.
* Cuvar vec ima cijelu mehaniku ubijanja, dizanja, brojanja padova i idle praga.

Jedna korekcija u odnosu na ideju: ne treba NOVI Bun proces koji slusa Telegram.
Poller vec zivi unutar sesije (grammy u bun procesu Telegram plugina) i dva pollera na
istom bot tokenu se sudaraju (409 Conflict). Najjeftinija izvedba je prosiriti POSTOJECI
cuvar (Node) rezimom strazara:

1. Poslije idle praga cuvar sesiju UGASI (postojeci kill put) umjesto da je restartuje.
2. Cuvar tada sam radi `getUpdates` long poll na bot token, ali NIKAD ne potvrdjuje
   offset. Tako poruku vidi a ne pojede: kad sesija ustane, plugin poller povuce istu
   poruku ponovo i obradi je normalno. Straza radi iskljucivo dok je sesija mrtva, pa
   sudara nema.
3. Na prvu vidjenu poruku: prekini strazu, digni sesiju (postojeci start put), opciono
   posalji `sendChatAction typing` da klijent vidi da se nesto desava dok sesija ustaje.
4. Nocni restart u 03:00 postaje nocno gasenje: sesija ustane tek na sljedecu poruku.
5. Usput se zatvara i rupa sa praznom sesijom: ona vise ne postoji, strazar je pokriva.

Dobitak po klonu u mirovanju: sa ~200 do 500 MB na ~10 do 20 MB (cuvar strazar).
Sa admin botom dobitak je dupli; admin bot je i prvi kandidat jer se koristi najrjedje.

Cijena i rizici, otvoreno:

* Prva poruka poslije mirovanja ceka hladni start (claude + MCP + plugin), procjena
  5 do 15 s. Za Telegram razgovor prihvatljivo, `typing` indikator to omeksa.
* Prelazni rezim straza/sesija mora biti cist: straza smije poll samo dok je dijete
  mrtvo, a plugin ionako ima retry sa backoffom pa kratko preklapanje prezivi.
* Telegram cuva nepotvrdjene update 24 h; strazar reaguje odmah pa to nije granica.
* Gluha sesija (ziv proces, mrtav poller) se i dalje mora detektovati; postojeci
  mehanizam od 10 min ostaje.
* Mjeriti na klijentskoj masini prije i poslije; brojevi ovdje su sa admin masine.

## 3. Dobici mimo hipoteza, poredano po odnosu efekta i truda

1. **Ocistiti orphan pakete iz `node_modules`** (`rm -rf node_modules && npm ci` po
   klonu, ili samo tri foldera): ~286 MB diska po klonu, nula rizika, nula koda.
2. **Strazar rezim cuvara** (hipoteza 3): 200 do 500 MB RAM-a po klonu u mirovanju.
   Jedina izmjena koja trazi pravi razvoj i test.
3. **Admin bot na strazi agresivnije** (idle prag krace, npr. 15 min): koristi se
   rijetko, a nosi punu drugu sesiju.
4. **Higijena admin masine** (nije pogon, ali su izmjerene): zaostale CLI sesije
   drze 366 MB i stalan CPU; `chrome-devtools-mcp` 117 MB po sesiji; transkripti u
   `~/.claude/projects` 751 MB diska; Claude Desktop sa flotom MCP servera ~590 MB.
5. **Sitno**: Stop hook cita cijeli transkript na svaki potez (raste s razgovorom,
   nocni restart ga drzi u granicama); cuvar svakih 60 s rekurzivno stat-uje transkript
   folder; `.olx-pik/test-audit.jsonl` (820 KB) je testni otpad.

## 4. Preporuceni redoslijed

1. Ciscenje orphan paketa (odmah, bez izdanja).
2. Strazar rezim u `cuvar-sesije.mjs` iza env prekidaca (npr. `OLX_SESIJA_STRAZAR=1`),
   prvo na admin botu jednog klona, pa mjerenje, pa klijentska sesija, pa flota.
3. Repoe ne cijepati. Ako ikad zatreba granica prema klijentu, rjesenje je profil i
   podfolder, ne drugi repo.

## 5. Naknadna ideja: zajednicki API+MCP servis za sve klijente (12.08.2026)

Prijedlog vlasnika poslije prihvatanja strazara: API i MCP u poseban repo kao servis koji
je STALNO pokrenut za sve klijente, svaki klijent svoj Bun za Telegram, svaki klijent svoja
sesija; ukupno mozda tri repozitorija. Presuda: ODBACITI za danasnju flotu klonova.

* MCP proces nije trosak vrijedan dijeljenja: 3 do 30 MB, zivi samo dok zivi sesija
  (dijete sesije kroz stdio). U strazar rezimu legne zajedno sa sesijom, pa je klon u
  mirovanju na 10 do 20 MB. Zajednicki servis je budan 24/7 i na jednoj masini sa par
  klonova je neto GUBITAK memorije, ne dobitak.
* Nas MCP je namjerno jednoklijentski: OLX_TOKEN iz .env klona, stanje u `.olx-pik/`
  klona, audit klona. Zajednicki servis trazi multi tenant prepravku (centralno skladiste
  svih tokena, rutiranje po klijentu, audit po tenantu, HTTP transport umjesto stdio),
  a centralizacija tokena je i sigurnosni korak unazad.
* Blast radius: bug zajednickog servisa rusi sve klijente odjednom; danas lose izdanje
  pogadja samo klonove koji su ga povukli, kroz kapiju taga `stabilno`.
* Poseban Bun po klijentu ne moze pored plugina (dva getUpdates konzumera na istom
  tokenu = 409), a potrebu "neko slusa dok sesija spava" vec pokriva straza u cuvaru.
* Troskovi cijepanja repoa ostaju isti kao u tacki 2 (hardkodirane putanje resursa,
  skillovi iz projektnog foldera, atomski tag `stabilno`, 44 % commita preko granice).

Kad bi imalo smisla: pivot na centralni server proizvod, gdje klijenti nemaju vlastite
masine ni klonove. Tada zajednicki HTTP MCP postaje legitimna arhitektura (stateless MCP
revizija 2026-07-28 je pravljena bas za to), ali to je novi proizvod i poslovna odluka,
ne optimizacija resursa: sesija po klijentu i tada ostaje najskuplji dio.

Zelja iz istog razgovora "stalno budan mali proces koji dize Claude Code na poruku i gasi
ga poslije mirovanja" je vec IZVEDENA: to je strazar rezim (tacka 2 preporuka). Jedina
razlika prema zamisli je da strazu drzi postojeci cuvar (Node, 3 do 10 MB), ne novi Bun,
jer cuvar poruku gleda bez potvrde offseta pa je plugin poslije normalno obradi.
