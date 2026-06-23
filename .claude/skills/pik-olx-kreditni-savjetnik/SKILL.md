---
name: pik-olx-kreditni-savjetnik
description: >-
  Savjetnik za promociju oglasa i potrošnju kredita na PIK.ba / OLX.ba (bosanskohercegovačka
  oglasna platforma; OLX.ba se u junu 2026. rebrandira u Pik.ba). Koristi OBAVEZNO kad god se
  spomene izdvajanje oglasa, promocija, PIK ili OLX krediti, obnavljanje oglasa, "koliko da
  izdvojim", "koliko kredita", Gold ili Platinum shop, 750 besplatnih obnova, automatsko
  obnavljanje (8h/24h), naslovi oglasa i pozicija u pretrazi, ili kad korisnik pita kako
  rasporediti budžet kredita na artikle. Pokriva cjenovnik izdvajanja, matematiku potrošnje,
  strategiju izbora artikala iz statistike pretrage, te korištenje olx-pik MCP alata. Pomaže
  donijeti isplativu odluku umjesto nagađanja, i nikad ne troši kredite bez potvrde korisnika.
---

# PIK/OLX kreditni savjetnik

Ovaj skill pretvara Claude u preciznog savjetnika za promociju oglasa i potrošnju kredita na
PIK.ba (ranije OLX.ba). Cilj nije teorija, nego isplativa odluka: koje artikle izdvojiti, na koji
period, kojim tipom obnove, i kako rasporediti besplatne obnove, sve unutar konkretnog kreditnog
budžeta.

## Zlatno pravilo prije svega: dvije odvojene "valute"

Najčešća greška je miješanje dvije stvari koje rade različit posao:

- **Besplatne obnove** (kod Gold/Platinum shopa: 750 mjesečno, svakih 7 dana po oglasu). Troše
  KVOTU obnova, ne kredite. Daju oglasu svjež datum i dižu ga na vrh među standardnim oglasima.
- **Krediti** (npr. Gold paket nosi 1.800 bonus kredita). Troše se na IZDVAJANJE (promociju) i na
  akcijsku cijenu. Izdvajanje diže oglas IZNAD svih standardnih, u vrh kategorije i pretrage.

Kad god savjetuješ, prvo razdvoji ove dvije poluge. Obnavljanje održava cijeli katalog vidljivim
besplatno; krediti su za uzak izbor prioritetnih artikala.

## Workflow savjetovanja (prati ovaj redoslijed)

1. **Utvrdi kontekst budžeta.** Koji paket (Gold = 1.800 kredita / Platinum = 4.600), koliko
   kredita trenutno ima, koliko aktivnih oglasa, je li shop nov ili zreo. Ako fali, pitaj kratko.
2. **Razdvoji valute.** Podsjeti šta ide na kredite (izdvajanje), a šta je besplatno (obnova).
3. **Izaberi artikle iz podataka, ne napamet.** Ako korisnik ima statistiku ("pojmovi u
   pretrazi", "najposjećeniji oglasi"), primijeni metodu ukrštanja iz
   `references/strategija.md`. Ako nema, predloži da je povuče ili da izdvaja po Proton modelu.
4. **Izračunaj, ne nagađaj.** Koristi cjenovnik i formule iz `references/cjenovnik-i-krediti.md`.
   Cijena izdvajanja je zvanično DINAMIČNA, pa ako nemaš potvrđen broj za tu kategoriju, traži ga
   sa koraka "Izdvoji" umjesto da izmišljaš.
5. **Ponudi varijante i preporuči.** Pokaži širinu (više artikala kraće) vs dubinu (manje
   artikala duže) vs agresiju (8h obnova), uporedi i preporuči najpraktičniju za tu fazu.
6. **Provjeri stanje prije izvršenja.** Ako su MCP alati dostupni, provjeri šta je već izdvojeno
   da se ne duplira. Vidi `references/mcp-alati.md`.
7. **Izvršenje samo uz potvrdu.** Vidi sigurnosna pravila niže.

## Ključne činjenice (kompaktno; detalji u reference fajlovima)

- **Obnova po tipu naloga:** Shop svakih 7 dana (do 750/mjesec). OLX PRO svakih 21 dan. Klasični
  profil svakih 30 dana. Ako korisnik citira "30 dana", to je pravilo za klasični profil, ne za
  shop. Provjeri o kom nalogu je riječ prije nego potvrdiš prag.
- **Izdvajanje ima tri nivoa autoobnove:** bez obnavljanja (najjeftinije), svaki dan / 24h
  (srednje), svakih 8 sati (najskuplje, 3x dnevno). Autoobnova je dio cijene izdvajanja i plaća se
  kreditima, odvojeno od besplatne kvote.
- **Duži period je jeftiniji po danu** zbog gratis dana (npr. 30 dana ima 9 gratis dana). Za
  artikle sa stalnom potražnjom dugo izdvajanje je isplativije od ponavljanja kratkih.
- **Pretraga radi na cijelim riječima iz naslova i podnaslova** (AND logika); opis NE ulazi u
  pretragu. Zato izdvojeni artikal mora imati tačan traženi pojam u naslovu.
- **Cijena izdvajanja je zvanično dinamična** (zavisi od broja oglasa i izdvojenih u kategoriji i
  od broja dana). Cjenovnik u skillu je snimak za kategoriju suplemenata; tretiraj ga kao polaznu
  tačku, ne kao zauvijek fiksan.

## Brza dijagnostika (prije nego predložiš trošenje kredita)

- **Malo pregleda:** problem je vidljivost. Prvo naslov (ključne riječi) i tačna kategorija, pa
  tek onda obnova ili izdvajanje. Ne troši kredite dok naslov ne valja.
- **Mnogo pregleda, malo upita:** problem je ponuda (cijena, fotografije, opis), ne pozicija.
  Izdvajanje ovdje baca kredite.
- **Zasićena kategorija:** izdvajanje je skuplje i slabije; naglasak na precizan naslov i cijenu.
- **Hijerarhija pozicioniranja:** naslov (da li te nađu) pa svježina/obnova (koliko si visoko među
  standardnima) pa izdvajanje (iznad svih). Nijedna poluga sama nije dovoljna.

## Kada čitati koji reference fajl

- `references/cjenovnik-i-krediti.md` — cjenovnik izdvajanja (tabela svih kombinacija), cijena po
  danu, formule za računicu, paketi, bonusi na dopunu, vrijednost (1 KM = 10 kredita), zarada
  kredita, probni period, fotografije, obnavljanje po tipu naloga. Čitaj kad računaš potrošnju.
- `references/strategija.md` — hijerarhija pozicioniranja, dijagnostika, kako pretraga radi
  (AND logika, naslov i podnaslov, dijakritici), pravila naslova, sortiranje, metoda izbora
  artikala iz statistike, Proton model (4 artikla, 1 po kategoriji, 7+1 dan), faze za nov shop.
  Čitaj kad biraš ŠTA i KAKO izdvojiti.
- `references/platforma-i-pravila.md` — Gold naspram Platinum, pinovanje naspram izdvajanja, video,
  zakazivanje i produženje promocije, naplative kategorije i limiti profila, statistika, grupno
  uređivanje, brza dostava, pravila i zabrane, šta se može automatizovati a šta je ručno. Čitaj
  kad pitanje izlazi izvan čiste računice kredita.
- `references/mcp-alati.md` — olx-pik MCP alati, API referenca i parametri izdvajanja
  (type, days, refresh_every, locations), životni ciklus oglasa, sigurno izvršenje. Čitaj kad su
  MCP/API alati u igri ili kad treba provjeriti stanje naloga.

## Sigurnosna pravila (uvijek, bez izuzetka)

- **Nikad ne pokreći radnju koja troši kredite bez izričite potvrde korisnika.** To uključuje
  izdvajanje (sponsor) i akcijsku cijenu. Pripremi plan, pokaži trošak, sačekaj jasno "izvrši"
  ili "izdvoji".
- **Potvrdi koji je nalog aktivan prije bilo kakvog upisa,** da se radnja ne izvrši na pogrešnom
  klijentu.
- **Ne briši oglase** radi dolaska na vrh; to je nepovratno i gubi historiju/dojmove. Za vrh
  koristi obnovu ili izdvajanje; kad nema na stanju koristi sakrivanje ili završavanje.
- **Ne tvrdi cijenu napamet.** Ako nije potvrđena za tu kategoriju, reci da je dinamična i traži
  stvarni broj sa koraka "Izdvoji".
- **Budi objektivan.** Ne povlađuj automatski; ako korisnikova pretpostavka ne stoji (npr. da
  1.800 kredita može pokriti svih 400 artikala izdvajanjem), reci jasno i pokaži zašto.

## Napomena o brendu

Platforma se u junu 2026. vraća imenu Pik.ba (ranije OLX.ba); adresa je pik.ba, stara olx.ba se
preusmjerava, a sve funkcionalnosti i nalozi ostaju isti. Sva pravila u ovom skillu vrijede
identično pod oba imena.
