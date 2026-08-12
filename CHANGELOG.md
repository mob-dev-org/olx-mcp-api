# Zapis izdanja

Cemu sluzi: kad klijent kaze "od jucer ne radi", ovdje stoji sta je uslo izmedju dva izdanja.
Nije zapis svakog commita, nego samo onoga sto se vidi u radu ili moze pokvariti postojece.

Kako se cita broj verzije: `node dist/cli/index.js --version`, polje `version` u
`.olx-pik/audit.jsonl`, ili `node scripts/provjeri-klon.mjs`. Na kojem izdanju klon stoji:
`git describe --tags`. Procedura izdanja i vracanja: `olx-dokumentacija/arhitektura.md`,
sekcija 7.

## Nije izdano

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
