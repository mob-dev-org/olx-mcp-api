# Strategija: pretraga, naslovi i izbor artikala za izdvajanje

Ovaj fajl pokriva ŠTA izdvojiti i KAKO, na osnovu toga kako pretraga radi i kako se artikli biraju
iz podataka. Cilj je da svaki uloženi kredit ide na artikal koji ljudi stvarno traže.

## Hijerarhija pozicioniranja (redoslijed po važnosti)

1. **Ključne riječi u naslovu** odlučuju DA LI ćeš uopšte biti pronađen u pretrazi.
2. **Svježina (obnova)** odlučuje KOLIKO si visoko među standardnim (besplatnim) oglasima.
3. **Izdvajanje** (klasično, pa premium) preskače standardni poredak i ide iznad svih, uz opciju
   naslovnice.

Sve tri poluge rade zajedno; nijedna sama nije dovoljna. Izdvajanje ne spašava loš naslov. Ovo je
okvir za svaki savjet: prvo naslov, pa svježina, pa tek onda plaćeno izdvajanje.

## Dijagnostika (primijeni kad korisnik pita zašto oglas slabo ide)

- **Malo pregleda:** problem je vidljivost. Prvo provjeri naslov (ključne riječi) i tačnost
  kategorije, pa tek onda obnovu ili izdvajanje. Ne troši kredite dok naslov ne valja.
- **Mnogo pregleda, malo upita:** problem je ponuda, ne pozicija. Provjeri cijenu, fotografije i
  opis. Izdvajanje ovdje ne pomaže i baca kredite.
- **Zasićena kategorija:** izdvajanje daje slabiji relativni efekat i skuplje je. Naglasak na
  precizan naslov, konkurentnu cijenu, te premium izdvajanje uz autoobnovu ako se ide na to.

## Naslov prije izdvajanja

Izdvajanje plaća poziciju u pretrazi u kojoj se oglas možda uopšte ne pojavljuje. Prije nego
potrošiš kredit, provjeri da naslov i podnaslov sadrže tačne riječi koje kupac kuca.

Pravila naslova i podnaslova nisu ovdje nego u
`.claude/skills/olx-seo-oglasa/references/seo-pravila.md`.

## Metoda izbora artikala iz statistike (ključni alat savjetnika)

Kad korisnik ima statistiku oglasa, izdvajaj na osnovu ukrštanja dva spiska:

1. **Pojmovi u pretrazi** = potražnja (šta kupci kucaju i koliko puta).
2. **Najposjećeniji oglasi** = dokazan interes (šta već skuplja preglede).

Pravila:

- **Izdvajaj tamo gdje se poklapaju** visoka potražnja i postojeći interes. Tu izdvajanje hvata
  postojeći talas umjesto da ga stvara.
- **Ne izdvajaj ono što već radi organski** (artikal koji se gleda, ali se NE pojavljuje među
  traženim pojmovima). Takav promet vjerovatno dolazi iz pregledanja shopa i niske konkurencije,
  pa bi izdvajanje bilo trošenje kredita na ono što ionako dobijaš besplatno.
- **Provjeri naslov** prije izdvajanja: sadrži li tačan traženi pojam.
- **Klasično izdvajanje je obično dovoljno.** Kad najveći dio prometa dolazi iz pretrage (često
  oko dvije trećine), cilj je vrh rezultata pretrage u kategoriji; naslovnica i premium nisu
  prioritet i skuplji su.

### Kako se metoda primjenjuje

Napravi dva spiska iz statistike korisnika. Prvi su pojmovi koje kupci najviše kucaju. Drugi su
oglasi koji skupljaju najviše pregleda. Presjek ta dva spiska je lista kandidata za izdvajanje, jer
tu izdvajanje hvata postojeći talas umjesto da ga stvara.

Artikal koji ima preglede ali se ne pojavljuje među traženim pojmovima već dobija promet besplatno,
najčešće kroz pregledanje shopa ili nisku konkurenciju. Njega ne treba plaćati.

Artikal koji se traži a nema pregleda je znak problema sa naslovom ili kategorijom, ne kandidat za
izdvajanje. Prvo se popravi naslov, pa se mjeri ponovo.

Ovo vrijedi jednako za dijelove, odjeću, vozila, nekretnine ili usluge. Metoda ne zavisi od robe.

## Model uskog izbora

Jedan artikal po skupini potraznje umjesto cijelog kataloga. Obrazloženje i brojevi su u
`olx://pravila-brojeva`.

## Faze za nov shop

- **Prvih nekoliko dana:** katalog je prirodno svjež (rangira se po datumu objave), pa obnova još
  nije potrebna. Pusti dan-dva da se skupi statistika prije velikih izdvajanja.
- **Početno izdvajanje:** mali, ciljani izbor (npr. tri do četiri skupine potražnje, po modelu uskog izbora) na 7+1 dan, da
  se vidi diže li izdvajanje preglede ("broj pregleda tokom promocije" u statistici).
- **Od 7. dana:** pokreni ciklus besplatne obnove na prioritetnim artiklima; artikle koji su se
  pokazali u izdvajanju prebaci na duži period, slabije zamijeni drugima.
- **Zrela faza:** krediti drže uzak izbor bestselera iznad svih, besplatna obnova drži sljedeći
  krug svježim, ostatak živi od datuma objave i povremene obnove.
