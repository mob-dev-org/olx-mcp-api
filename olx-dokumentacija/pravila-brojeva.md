# Pravila brojeva: šta se zna, šta se čita, šta se nikad ne pretpostavlja

Ovaj fajl ima prednost nad svim ostalim referencama kad je u pitanju bilo koji broj.
Ako je neki drugi fajl u sukobu sa ovim, važi ovaj.

Razlog postojanja: raniji cjenovnik je bio snimak jedne kategorije. Savjeti izvedeni iz njega
djelovali su precizno, a bili su tačni samo za tu kategoriju. To je gore od nepostojanja podatka,
jer korisnik dobije broj u koji vjeruje.

---

## Tri razreda brojeva

### Razred A: fiksno na platformi, smije se koristiti bez provjere

- 1 KM je 10 kredita.
- Prag ručne obnove: shop svakih 7 dana, PRO svakih 21 dan, klasični profil svakih 30 dana.
- Oglas mora biti obnovljen bar jednom u 6 mjeseci da ne pređe u istekle.
- Besplatne fotografije po oglasu: klasični 7, PRO 15, shop 20. Maksimum 25, svaka preko
  besplatnog limita košta 1 kredit.
- Grupno uređivanje ide do 50 oglasa odjednom.
- Bonus na dopunu kredita karticom: ispod 10 KM nema bonusa, 10 do 49 KM je 20 posto,
  50 do 149 KM je 25 posto, 150 do 199 KM je 30 posto, 200 KM i više je 40 posto.
- Probni period pri prvom otvaranju shopa: 30 dana i 500 kredita.
- Broj aktivnih oglasa u besplatnim kategorijama: klasični od 20 do 60, PRO 200, shop bez limita.
- Zarada kredita kroz prijave: 3 kredita za prvu prihvaćenu prijavu, 1 za naknadnu, 2 za prijavu
  nedozvoljenog naslova.

### Razred B: vezano za nalog, MORA se pročitati sa naloga

- Kvota besplatnih obnova. Zvanična pomoć navodi 750, izmjereno je 1.800 na Gold nalogu. Nijedan
  od ta dva broja se ne smije citirati. Pročitaj stvarni limit.
- Koliko je obnova već potrošeno ovaj mjesec. Pažnja: polje sa iskorištenim obnovama pokazuje
  POTROŠENO, ne preostalo. Preostalo je limit minus potrošeno.
- **Kada se kvota obnova resetuje NIJE potvrđeno, ali se više ne pretpostavlja kalendar.** API
  ne vraća datum reseta (`/listing/refresh/limits` daje samo `free_limit`, `free_count`,
  `paid_count`, `listing_count`), a zvanična pomoć ne precizira. Kod od 31.07.2026. rok izvodi iz
  **ciklusa pretplate**: dan u mjesecu iz `shop.ends_at`. Osnov: shop se plaća po broju mjeseci od
  datuma plaćanja, a zvanična pomoć za PRO kaže "narednih mjesec dana" od aktivacije.
  Kalendarski mjesec je ostao samo kao rezerva kad `ends_at` nije čitljiv, i tada se rok
  korisniku NE izgovara (polje `rok_poznat`).
  Zašto je to bilo bitno: na MixBoxu je 31.07.2026. javljen rok od 1 dana, a ciklus je istjecao
  24.08., dakle 24 dana. Isti broj ulazi i u ponašanje, ne samo u tekst.
  **Mjerenje u toku:** dnevni posao od 31.07.2026. upisuje stanje kvote u
  `.olx-pik/kvota-dnevnik.jsonl`. Dan kad `free_count` padne je dan reseta (`daniResetaKvote`).
  Na MixBoxu ciklus pada na 24., daleko od 1., pa se dva objašnjenja ne mogu pomiješati: padne li
  1. augusta, važi kalendar; padne li 24. augusta, važi ciklus paketa. Do nalaza se o "kvota
  propada" ne govori uopšte, jer ni to nema izvor.
- Većina naloga kvotu NE MOŽE potrošiti do kraja: ručna obnova istog oglasa ide tek nakon
  praga (red iznad), pa je ostvarivi maksimum broj oglasa puta broj obnova po oglasu u
  periodu. Poređenja i alarmi idu na ostvarivo, ne na sirovu kvotu (`ostvarivihObnova` u
  `src/core/stats.ts`).
- Trenutno stanje kredita.
- Broj aktivnih, skrivenih, isteklih i završenih oglasa.
- Koji su oglasi već izdvojeni.
- Mjesečni bonus kredita po paketu. Gold 1.800 i Platinum 4.600 su iz naše dokumentacije, ali
  paketi se mijenjaju. Provjeri na nalogu prije nego postane dio računice.

### Razred C: vezano za kategoriju i za dan, NIKAD se ne pretpostavlja

- **Cijena izdvajanja.** Zvanično je dinamična i zavisi od broja objavljenih oglasa u kategoriji i
  broja već izdvojenih oglasa u toj istoj kategoriji. Mjereno je 12 kredita za sedam dana bez
  obnove u jednoj kategoriji i 42 u drugoj, dakle razlika od tri i po puta za identičnu uslugu.
- **Cijena aktivacije oglasa u naplativoj kategoriji.** Varira po kategoriji i po trajanju.
- **Cijena akcijske cijene i ostalih plaćenih dodataka.**

Za sve iz razreda C postoji samo jedan ispravan postupak: dohvati stvarnu cijenu za taj konkretan
oglas prije nego se izgovori bilo kakav broj. Dohvatanje cijene ne troši kredite.

---

## Obavezni redoslijed prije bilo kakve preporuke o trošenju

1. Utvrdi na kojem si nalogu i koji je paket.
2. Pročitaj kvotu obnova i stanje kredita.
3. Odaberi kandidate za izdvajanje po sadržaju, ne po cijeni.
4. **Za svakog kandidata dohvati stvarnu cijenu izdvajanja.** Tek sada postoji broj.
5. Uporedi varijante trajanja i tipa obnove na osnovu dohvaćenih cijena, ne na osnovu tabele.
6. Prikaži trošak u kreditima i u markama, pa traži potvrdu.

Ako korak 4 nije moguć, na primjer nema pristupa nalogu, onda se ne daje nikakav broj. Umjesto
broja se kaže šta će se izmjeriti i koliko to traje.

---

## Šta raditi kad je katalog prevelik za pojedinačno dohvatanje

Kod kataloga od hiljadu i više oglasa nije praktično dohvatati cijenu za svaki oglas.

Radna pretpostavka: cijena zavisi od kategorije, ne od pojedinačnog oglasa. Ako to stoji, dovoljno
je dohvatiti cijenu za jedan reprezentativan oglas po kategoriji i primijeniti je unutar te
kategorije.

**Ova pretpostavka nije potvrđena i mora se provjeriti prije oslanjanja.** Provjera traje minutu:
uzmi dva oglasa u istoj kategoriji, sa različitom cijenom artikla i različitom starošću, i uporedi
dohvaćene cijene izdvajanja. Ako su iste, pretpostavka drži. Ako nisu, cijena se mora dohvatati po
oglasu i tada se izdvajanje planira samo za uži izbor.

Dok provjera nije urađena, ponašaj se kao da pretpostavka ne drži.

---

## Šta ostaje od stare tabele

Stara tabela cijena za jednu kategoriju se zadržava kao **primjer oblika, ne kao cjenovnik**.
Iz nje se smiju izvući samo strukturni zaključci, a i oni se označavaju kao nepotvrđeni izvan te
kategorije:

- Postoje tri nivoa automatskog obnavljanja uz izdvajanje: bez obnove, na 24 sata, na 8 sati.
- Duži period nosi gratis dane, pa je jeftiniji po danu od ponavljanja kratkih perioda.
- Račun prikazuje izdvajanje i automatsko obnavljanje kao dvije odvojene stavke.
- U toj jednoj kategoriji je obnova na 24 sata dodavala oko pola osnovne cijene, a na 8 sati oko
  jedan i po put osnovne. **Da li isti odnos važi u drugim kategorijama nije provjereno.**

Nikada ne citirati brojeve iz te tabele klijentu. Ni kao primjer, jer klijent pamti broj a
zaboravi ogradu.

---

## Model izbora artikala, bez vezivanja za bilo koju branšu

Raniji model je bio opisan kroz suplemente, pa je zvučao kao pravilo o proteinima. Pravilo nema
veze sa robom. Evo ga u opštem obliku.

- **Jedan artikal po skupini potražnje.** Skupina potražnje je grupa artikala koji se takmiče za
  isti upit kupca. Dva artikla iz iste skupine se međusobno guše i cijepaju budžet. Bilo da je to
  dvoje istih cipela, dva slična automobila ili dva stana u istoj ulici, ide jedan.
- **Skupine se prepoznaju iz upita, ne iz police.** Ako kupci kucaju isti pojam da bi došli do dva
  vaša artikla, to je jedna skupina, makar bili u različitim policama.
- **Izdvajaj tamo gdje se poklapaju dokazana potražnja i postojeći interes.** Artikal koji se
  traži u pretrazi i već skuplja preglede je kandidat. Artikal koji ima preglede ali ga niko ne
  traži po imenu već dobija promet besplatno, pa ga ne treba plaćati.
- **Obnavljanje prije izdvajanja.** Besplatna svježina se troši prva, jer ne košta. Krediti idu na
  ono što svježina ne može podići.
- **Ne trošiti cijeli budžet u prvom potezu.** Ostaviti rezervu i vidjeti šta je pomjerilo
  preglede, pa preusmjeriti.

## Prilagodba po vrijednosti artikla, a ne po broju artikala

Odluka koliko agresivno trošiti ne zavisi od toga koliko oglasa neko ima, nego koliko donosi jedna
prodaja.

- **Visoka vrijednost po komadu**, na primjer vozila, nekretnine, mašine, oprema. Jedna prodaja
  pokriva mjesečni trošak promocije više puta. Ovdje se isplati držati veći dio ponude stalno
  vidljivim, i ovdje duži period izdvajanja ima najviše smisla.
- **Niska vrijednost po komadu**, na primjer sitna roba široke potrošnje. Promocija se mora vratiti
  kroz količinu, pa se izdvaja uzak izbor i pažljivo mjeri.
- **Prag za odluku:** procijenjena zarada od jedne dodatne prodaje naspram cijene izdvajanja tog
  artikla na mjesec dana. Oba broja se dohvaćaju, ne procjenjuju napamet. Ako je zarada od jedne
  prodaje veća od cijene mjesečnog izdvajanja, izdvajanje se brani samim sobom.

---

## Šta se govori klijentu umjesto broja

Loše: "Za vaš budžet možete držati dvadeset osam artikala na vrhu."
Dobro: "Cijena mjesta na vrhu se razlikuje po kategoriji i po danu. Otvorim vaš oglas, pročitam
stvarnu cijenu i onda vam tačno kažem koliko artikala vaš budžet pokriva. To ne košta ništa i
traje par minuta."

Druga rečenica prodaje bolje, jer je provjerljiva na licu mjesta i ne može se pobiti.
