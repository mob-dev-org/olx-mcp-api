# Zapis izdanja

Cemu sluzi: kad klijent kaze "od jucer ne radi", ovdje stoji sta je uslo izmedju dva izdanja.
Nije zapis svakog commita, nego samo onoga sto se vidi u radu ili moze pokvariti postojece.

Kako se cita broj verzije: `node dist/cli/index.js --version`, polje `version` u
`.olx-pik/audit.jsonl`, ili `node scripts/provjeri-klon.mjs`. Na kojem izdanju klon stoji:
`git describe --tags`. Procedura izdanja i vracanja: `olx-dokumentacija/arhitektura.md`,
sekcija 7.

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
