# Plan: analiza konkurenata kao usluga klijentu

Stanje 02.08.2026. Nije implementirano, ovo je priprema za rad. Odluke koje traze covjeka su
oznacene sa ODLUKA i moraju biti donesene prije nego kod krene.

Povod: vlasnici shopova cesto traze analizu konkurencije. Danas im klijentski bot na to ne moze
odgovoriti.

---

## 1. Zateceno stanje

### Radi

- `olx_competitor_report` i `olx_user_profile` racunaju presjek tudjeg shopa iz javnih podataka
- CLI `stats konkurent-snimi` pravi snimak sa svakim njihovim oglasom (`id`, naslov, cijena,
  je li izdvojen), a `stats konkurent-promjena` poredi dva zadnja snimka
- Podagent `olx-konkurent` sazima jednog konkurenta, koristi se u serijskom obilasku
- Nedjeljna AI runda obilazi konkurente i prijedlozi stignu klijentu kroz `olx_prijedlozi`

### Ne radi, a izgleda kao da radi

Ovo su tri stvarne rupe, sve tri nadjene provjerom koda 02.08.2026:

1. **Klijentski bot nema alat.** `olx_competitor_report` je u `SAMO_ADMIN` skupu u
   `src/mcp/server.ts`, pa se u profilu `klijent` uopste ne registruje. Vlasnik koji pita svog
   bota za konkurenta dobije da to ne moze.
2. **Nijedan automatski posao ne puni snimke.** `pracenjeKonkurenti()` postoji i vraca spisak
   pracenih, ali ga ne zove ni `posao sedmicni` ni ijedan launchd zadatak. Bez redovnog snimanja
   `konkurent-promjena` nema sta porediti, jer trazi bar dva snimka.
3. **AI runda cita sekciju koja ne postoji.** Recept `runtime/recepti/ai-runda.md` trazi
   usernameove iz "sekcije o konkurentima" u `KLIJENT.md`, a `KLIJENT.primjer.md` tu sekciju nema.
   Recept izricito kaze da tada konkurente preskoci **bez napomene**. Znaci: na klonovima gdje
   admin nije rucno dopisao sekciju, konkurencija tiho izostaje i niko to ne primijeti.

### Gdje bi konkurenti trebali zivjeti

Danas nemaju svoje mjesto. `olx_zapamti` ima fiksna polja (`ton`, `footer_opisa`, `kontakt`,
`radno_vrijeme`, `dostava`, `nacin_placanja`), konkurenti bi isli kao slobodna napomena koju nista
ne cita strukturno. `KLIJENT.md` je prompt fajl, mijenja ga admin, a mijenja se pri startu sesije.

**ODLUKA 1:** konkurenti dobijaju vlastito stanje, po uzoru na `izuzeca` i `ritam-obnova`:
`.olx-pik/konkurenti.json` sa spiskom usernameova, ko ga je dodao (klijent ili admin), datum i
kratka biljeska zasto. Time ih bot moze i sam upisati kad mu klijent kaze, ulaze u backup i ne
zavise od restarta sesije. AI runda tada cita taj fajl umjesto sekcije u `KLIJENT.md`.

---

## 2. Kako klijent dolazi do spiska konkurenata

Dva puta, oba potrebna.

### Put A: bot pita

Bot pita jednom, kad spisak nije zapisan, isto kao sto vec pita za ritam obnove. Pitanje ide u
onboarding razgovor, ne kao anketa nego kao jedna recenica: koga smatra konkurencijom, ime shopa
kako stoji na OLX-u.

Za svaki dobijeni naziv bot potvrdi da nalog postoji (`olx_user_profile` prima samo username,
numericki id ne radi) i vrati kratku potvrdu koga je zapisao. Ako naziv ne pogodi nalog, kaze to
odmah umjesto da zapise nesto sto ne postoji.

### Put B: mi predlozimo

Ovo je ono sto vlasnik zapravo hoce kad kaze "analiza konkurencije": da mu neko kaze **ko** mu je
konkurencija, ne samo da prati one koje je sam imenovao.

Jedini izvor koji to moze je `interno/pretraga-biznisa`. On iz snimka shopova utvrdjuje ko se
STVARNO bavi kojom djelatnoscu, jer naziv shopa cesto laze. Ali taj folder ima tvrdu zabranu da
dodje do klijenta u bilo kojem obliku: ne kao alat, ne kao skill, ne kao izlaz koji bot pomene.

**ODLUKA 2, i najvaznija u ovom dokumentu.** Predlazem srednji put koji zabranu ostavlja na snazi:

- Alat se NE izlaze klijentu i NE pokrece se iz klijentskog runtimea. Zabrana ostaje doslovno kako
  jeste.
- Admin ga pokrene na svojoj masini, pogleda rezultat i **rucno izabere** nekoliko shopova za tog
  klijenta.
- Taj izbor udje u klon kao obican podatak, u `.olx-pik/konkurenti.json`, sa oznakom da je
  prijedlog, ne potvrdjen.
- Bot ih pokaze klijentu i pita da potvrdi ili izbaci. Klijent vidi imena shopova, nikad ne vidi
  ni alat, ni snimak, ni metodologiju, ni ijedan drugi shop sa liste.

Razlika je sustinska: klijentu stize ljudski provjeren spisak imena, ne izlaz internog alata.
Ako ovaj put nije prihvatljiv, put B otpada i ostaje samo put A, pa to treba znati prije nego se
ista obeca na stranici.

### Sta ogranicava put B

- **Bazen shopova je statican.** Snimci su xlsx izvozi od 26.07.2026 (Gold i Platinum) i
  28.07.2026 (Bronze i Silver). Shop koji se otvorio poslije toga ne postoji u bazenu. Snimak
  treba obnavljati, i to je rucan posao.
- **Profil po djelatnosti se pise rucno.** Danas postoje samo `vozila` i `vozila-bronze-silver`.
  Svaka nova djelatnost trazi novi profil sa id-evima kategorija i pragovima. Racunaj na pola sata
  admin posla po djelatnosti, ne na automatiku.
- **Nema pretrage oglasa na platformi.** Zato bazen i mora doci iz izvoza. Ovo se ne moze zaobici.

---

## 3. Sta se gradi, po fazama

Faze su poredane tako da svaka sama po sebi ima vrijednost i moze se pustiti klijentima.

### Faza 1: otkljucati ono sto vec postoji

- Skinuti `olx_competitor_report` sa `SAMO_ADMIN` liste
- Provjeriti velicinu odgovora u klijentskom profilu; ako je prevelik, skratiti izlaz umjesto da
  se alat vrati na admin listu
- `olx_sponsor_effect` razmotriti isto, ali odvojeno; on je vezan za nase snapshote, ne za tudje

Rezultat: vlasnik pita bota za imenovani shop i dobije presjek. Najmanji posao u dokumentu.

### Faza 2: spisak konkurenata kao stanje klijenta

- `.olx-pik/konkurenti.json` plus modul u `src/core` po uzoru na `izuzeca.ts` i `ritam-obnova.ts`
- MCP alat `olx_konkurenti` za citanje, dodavanje i uklanjanje, uz provjeru da username postoji
- Bot pita jednom kad spisak nije zapisan
- Recept AI runde prebaciti da cita taj fajl umjesto sekcije u `KLIJENT.md`, i da javi kad je
  spisak prazan umjesto da tiho preskoci
- Fajl dodati na bijeli spisak za backup

Rezultat: rupa broj 3 iz sekcije 1 je zatvorena, konkurencija prestaje tiho izostajati.

### Faza 3: dnevno snimanje, javljanje na dogadjaj

Klijenti traze da budu u toku svakodnevno, ne jednom sedmicno. To je izvodljivo, ali se snimanje
i javljanje moraju razdvojiti.

**Snimanje je dnevno.** Uz postojeci nocni snapshot u 02:40, tiho, bez poruke. Kroz
`pracenjeKonkurenti()` i mehaniku `stats konkurent-snimi`.

**Javljanje ide na dogadjaj, ne kao dnevna rubrika.** Jutarnja poruka dobija red o konkurenciji
samo kad se nesto desilo: spustena cijena, nov oglas, nesto izdvojeno, nesto nestalo. Kad nema
promjene, nema ni reda.

**Ponedjeljni pregled ostaje zbirni**, kao rubrika, odsjecen na nekoliko stavki po konkurentu.

Zasto ne dnevna rubrika: konkurent vecinu dana ne uradi nista. Rubrika koja devet od deset dana
kaze "nema promjena" nauci klijenta da preskace jutarnju poruku, ukljucujuci i dio o kvoti i
alarmima. Ovo je direktna primjena pravila iz `granice.md`: jedan broj je bolji od tabele, a duga
lista se odsijeca.

Dobitak od dnevne serije, iako se ne javlja svaki dan:

- Alarm na spustenu cijenu stize isti dan umjesto sa zakasnjenjem do sedam dana
- Ponedjeljni pregled postaje precizniji, jer ima sedam tacaka umjesto dvije
- Klijent je stvarno u toku, a nije zatrpan

**Trosak, izmjeren iz koda 02.08.2026.** `statsKonkurent` po konkurentu salje: 1 poziv za profil,
plus 1 po svakih 20 njegovih aktivnih oglasa, plus 1 za zavrsene. Konkurent sa 300 oglasa je 17
poziva. Tri konkurenta dnevno je oko 50 poziva. Kredite ne trosi nijedan poziv, a ako posao ostane
cisti kod (kao `posao dnevni`), ne trosi ni model. Cijena nije prepreka za dnevni ritam.

**Politika cuvanja, rijesiti u istoj fazi.** Snimak nosi svaki njihov oglas, pa `.olx-pik/konkurenti/`
raste svaki dan i ulazi u backup. Prijedlog: dnevni snimci se cuvaju 30 dana, poslije toga ostaje
jedan sedmicno. Bez ovoga backup klijenta raste bez granice.

**Alarm kad snimak izostane.** Isti kvar vec postoji kod nocnog snapshota: ako stane, poredjenje
nestane bez ijedne poruke. Faza 3 ne smije izaci bez te provjere.

### Faza 4: alarm koji vlasnika natjera da reaguje

- Konkurent spustio cijenu na artiklu koji i mi imamo
- Spajanje po naslovu vec radi `match.ts` za vanjski katalog, ista mehanika radi i ovdje
- Ide u jutarnju poruku samo kad ima sta reci, nikad kao stalna rubrika

Rezultat: jedina stavka sa cijelog spiska koja mijenja ponasanje vlasnika isti dan.

### Faza 5: prijedlog konkurenata (zavisi od ODLUKE 2)

- Admin komanda koja iz izlaza `pretraga-biznisa` uzme shopove iste djelatnosti i kantona
- Admin izabere nekoliko, upisu se u `.olx-pik/konkurenti.json` kao prijedlog
- Bot ih ponudi klijentu na potvrdu

---

## 4. Rizici i slabe pretpostavke

- **Vlasnik ce ocekivati vise nego sto platforma daje.** On pod analizom konkurencije misli
  "gdje sam u odnosu na trziste". Nema pretrage oglasa, pa se to ne moze. Reci to na prvom
  razgovoru, ne pri prvoj reklamaciji.
- **Zavrsen oglas ne znaci prodan**, a cijena zavrsenog oglasa se ne vidi. Svaki zakljucak o
  njihovom prometu je procjena, i tako se mora i izgovoriti.
- **Serija se puni ili ne postoji.** Ako sedmicno snimanje padne, poredjenje nestane bez ijedne
  poruke. Isti kvar vec postoji kod nocnog snapshota. Faza 3 mora doci sa alarmom kad snimak
  izostane, inace se ponavlja greska koja je vec u sistemu.
- **Spisak konkurenata stari.** Klijent doda tri shopa i zaboravi. Poslije godinu dana prati
  nekog ko je odustao. Vrijedi da bot jednom u nekoliko mjeseci pita je li spisak jos tacan.
- **Pretpostavka koju nisam provjerio:** koliko je odgovor `olx_competitor_report` velik za shop
  sa nekoliko stotina oglasa. Zato je u fazi 1 mjerenje prije odluke, ne poslije.

---

## 5. Sta se smije obecati klijentu

Smije:

- Pratimo shopove koje imenujete svaki dan i javimo cim se nesto promijeni, isti dan
- Vidite njihov paket, ponudu, ocjene, koliko drze aktivnih oglasa i sta izdvajaju
- Javimo kad neko spusti cijenu na artiklu koji i vi imate
- Pri postavci predlozimo nekoliko shopova iz iste djelatnosti (samo ako prodje ODLUKA 2)

Ne smije, ni u kojoj formulaciji:

- Gdje ste u odnosu na cijelo trziste ili na kategoriju
- Na kojem ste mjestu u pretrazi za neku rijec
- Za koliko je konkurent nesto prodao
- Da je spisak konkurenata potpun

Trenutni tekst na stranici (`interno/landing-sadrzaj.md`, blok "Pogled na konkurenciju") kaze
"sta mijenjaju iz sedmice u sedmicu". To je tacno tek nakon faze 3. Do tada ta recenica stoji
oznacena kao uslovna.

---

## 6. Sta uraditi prvo

1. Donijeti ODLUKU 2, jer o njoj zavisi da li put B uopste postoji
2. Faza 1, jer je najmanja i odmah odgovara na pitanje koje vlasnici vec postavljaju
3. Faza 2, jer zatvara tihi kvar u AI rundi
4. Faza 3 zajedno sa alarmom na izostali snimak
