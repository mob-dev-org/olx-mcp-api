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

## Kako pretraga radi (zašto je naslov presudan)

- Pretraga spaja cijele riječi iz naslova po AND logici: na pojam "Golf 7" izlaze oglasi koji u
  naslovu imaju i "Golf" i "7". Redoslijed nije bitan, ali riječi se moraju potpuno podudarati
  (padeži se broje).
- U pretragu ulaze NASLOV i PODNASLOV. Detaljni opis NE ulazi u pretragu (bitan je za Google i za
  povjerenje kupca, ali ne za internu pretragu).
- Dijakritici se tretiraju jednako kao slova bez njih ("kuća" i "kuca" daju iste rezultate), ali
  se preporučuje ispravno pisanje.
- Posljedica: artikal koji izdvajaš mora imati tačan traženi pojam u naslovu, inače izdvajanje
  troši kredite na poziciju u pretrazi na kojoj se oglas i ne pojavljuje.

## Sortiranje rezultata

- Korisnik bira poredak: relevantnost, datum objave (najnoviji/najstariji), cijena
  (najniža/najviša), lokacija. Podrazumijevani poredak među standardnim oglasima je svježina
  (radna pretpostavka; nije doslovno dokumentovano, ali proizlazi iz toga što obnova mijenja
  poziciju).
- Oglasi sa cijenom "Po dogovoru" ISPADAJU iz sortiranja po cijeni i iz cjenovnih filtera, jer
  nemaju broj. Zato uvijek unositi konkretnu cijenu.

## Pravila naslova

- Pisati u nominativu, sa ključnim riječima, redoslijedom brend pa model pa ključna specifikacija.
  Test je jedna rečenica: da li bi kupac tačno ovo ukucao. Prodajno obraćanje u naslovu (prodajem,
  povoljno, hitno, kao nov) troši znakove a ne donosi nijedan pogodak, jer to kupci ne kucaju.
- Jedan artikal po oglasu; ne nabrajati više modela u jednom naslovu.
- Pokriti jezičke varijante koje kupci kucaju. Domaći i strani naziv istog artikla su dva odvojena
  pojma u pretrazi i oglas izlazi samo na onaj koji je zaista u naslovu. Isto važi za skraćenice,
  oznake modela sa razmakom i bez njega, te za lokalne nazive. Ako artikal treba izaći na dvije
  varijante, obje moraju stajati u naslovu ili podnaslovu.
- Dodatne ključne riječi koje ne stanu u naslov staviti u podnaslov (i podnaslov ulazi u pretragu).
- **Naslov je ograničen na 65 znakova.** Duži naslov API odbija sa 422
  `"naslov ne može biti duži od 65 karaktera."` Podnaslov je u praksi prošao do 72 znaka.
- **Padež je odvojen pojam, i to je najčešća skrivena greška.** Naslov "Radna jakna i hlače" NE
  izlazi na upit "radne hlače", jer riječ "radne" nije prisutna. Prije izdvajanja provjeri da
  naslov sadrži oblik koji kupac zaista kuca, u množini i padežu iz upita.
- Provjera koja se isplati: sastavi spisak upita za koje želiš da oglas izlazi, pa za svaki
  provjeri da su SVE riječi iz upita prisutne u naslovu ili podnaslovu. Ako nisu, izdvajanje
  plaća poziciju na pretrazi u kojoj se oglas ne pojavljuje.

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

## Model uskog izbora (provjeren pristup iskusnog operatera)

- **Jedan artikal po skupini potražnje.** Skupina potražnje je grupa artikala koji se takmiče za
  isti upit kupca. Dva artikla iz iste skupine se međusobno guše i cijepaju budžet na isti rezultat.
  Bilo da su to dva slična modela, dvije veličine istog artikla ili dva stana u istoj ulici, izdvaja
  se jedan.
- **Skupine se prepoznaju iz upita, ne iz police.** Ako kupci kucaju isti pojam da bi došli do dva
  različita artikla iz ponude, to je jedna skupina, makar bili u različitim odjeljcima.
- **Broj skupina određuje broj izdvajanja.** Ne kreće se od budžeta pa naniže, nego od broja stvarno
  različitih skupina potražnje pa naviše, dokle budžet stigne.
- **Period sedam dana na početku**, jer nosi jedan gratis dan i dovoljno je kratak da se vidi
  djeluje li. Kad se pokaže šta radi, ide se na duži period koji je jeftiniji po danu.
- **Izbor artikla unutar skupine nije presudan,** osim kad se svjesno gura roba koja stoji na
  zalihama.
- **Obnavljanje prije izdvajanja.** Besplatna svježina se troši prva jer ne košta ništa. Krediti idu
  samo na ono što svježina ne može podići. Ne trošiti cijeli kreditni budžet na izdvajanje.
- **Na početku ne žuriti.** Nekoliko skupina, pa mjerenje, pa širenje.
- **Prioritet obnove:** ono što je na stanju i što se traži ide na najkraći dozvoljeni ciklus,
  ostatak kataloga na duži, koliko stvarna kvota pokrije. Kvota se čita sa naloga.

## Faze za nov shop

- **Prvih nekoliko dana:** katalog je prirodno svjež (rangira se po datumu objave), pa obnova još
  nije potrebna. Pusti dan-dva da se skupi statistika prije velikih izdvajanja.
- **Početno izdvajanje:** mali, ciljani izbor (npr. tri do četiri skupine potražnje, po modelu uskog izbora) na 7+1 dan, da
  se vidi diže li izdvajanje preglede ("broj pregleda tokom promocije" u statistici).
- **Od 7. dana:** pokreni ciklus besplatne obnove na prioritetnim artiklima; artikle koji su se
  pokazali u izdvajanju prebaci na duži period, slabije zamijeni drugima.
- **Zrela faza:** krediti drže uzak izbor bestselera iznad svih, besplatna obnova drži sljedeći
  krug svježim, ostatak živi od datuma objave i povremene obnove.
