# Cjenovnik, krediti i obnavljanje (računica)

Ovaj fajl sadrži sve brojke i formule za izračun potrošnje. Cijene izdvajanja su zvanično
DINAMIČNE; tabela ispod je potvrđeni snimak za kategoriju suplemenata (juni 2026.) i poklopila se
sa stvarnim računom na nalogu. Za drugu kategoriju ili kasniji period, zatraži stvarnu cijenu sa
koraka "Izdvoji".

## Cjenovnik izdvajanja (PIK krediti)

Tri kolone su tip automatskog obnavljanja uz izdvajanje: svakih 8 sati (3x dnevno), svaki dan
(24h), ili bez obnavljanja.

| Period | 8 sati | Svaki dan (24h) | Bez obnavljanja |
|---|---|---|---|
| 1 dan | 20 | 12 | 8 |
| 2 dana | 30 | 18 | 12 |
| 3 dana | 45 | 27 | 18 |
| 5 dana | 75 | 45 | 30 |
| 7 dana (1 dan gratis) | 90 | 54 | 36 |
| 14 dana (3 dana gratis) | 165 | 99 | 66 |
| 21 dan (5 dana gratis) | 240 | 144 | 96 |
| 30 dana (9 dana gratis) | 315 | 189 | 126 |

### Kako čitati cjenovnik

- Račun na nalogu prikazuje izdvajanje i autoobnovu kao DVIJE stavke. Primjer: 21 dan + 8 sati =
  96 (izdvajanje) + 144 (automatsko obnavljanje) = 240 ukupno.
- Osnovna cijena po danu (od 2 dana naviše): oko 6 kredita bez obnove, 9 uz 24h, 15 uz 8h. Period
  od 1 dan je relativno skuplji po danu (minimalna cijena).
- Gratis dani snižavaju efektivnu cijenu po danu na dužim periodima. Kod "svaki dan": 7 dana je
  oko 7,7 kr/dan, a 30 dana oko 6,3 kr/dan.

## Formule za potrošnju

- **Oglas-dana koje budžet pokriva:** krediti / (cijena po danu za odabrani tip).
- **Koliko artikala stalno izdvojeno cijeli mjesec:** (krediti / cijena_po_danu) / 30.
- **Ponavljanje kratkog vs jedno dugo izdvajanje:** uporedi 4 × (cijena 7 dana) naspram (cijena
  30 dana). Primjer 24h: 4 × 54 = 216 naspram 189. Za stalnu potražnju dugo je isplativije.
- **Pokrivenost besplatnim obnovama:** `free_limit` / (broj obnova po oglasu mjesečno), gdje
  `free_limit` UVIJEK pročitaš sa `olx_refresh_limits` (izmjereno 1.800 na Gold nalozima).
  Primjeri sa 1.800:
  - Ciklus ~7-8 dana: oko 4 obnove mjesečno po oglasu, pa 1.800 / 4 je oko 450 oglasa.
  - Ciklus ~15 dana: 2 obnove mjesečno po oglasu, pa 1.800 / 2 je oko 900 oglasa.
  - Za katalog od ~400 oglasa ravnomjerno: 1.800 / 400 je 4,5 obnove, dakle ciklus ~7 dana,
    tj. cijeli katalog moze ici na minimalnom pragu od 7 dana.

### Primjeri (24h obnova, period 7 dana, cijena 54 po artiklu)

- 3 artikla: 3 × 54 = 162 kredita
- 4 artikla: 4 × 54 = 216 kredita

### Primjeri (24h obnova, period 30 dana, cijena 189 po artiklu)

- 3 artikla: 3 × 189 = 567 kredita
- 9 artikala: 9 × 189 = 1.701 kredita (blizu cijelog Gold budžeta od 1.800)

## Paketi shopova (bonus krediti i popusti)

Provjereno na zvaničnoj stranici olx.ba/shopovi/paketi, 26.07.2026.

| Paket | Cijena/mjesec (sa PDV-om) | Bonus krediti/mjesec | Vrijednost kredita | Popust na dopunu |
|---|---|---|---|---|
| Bronze | 59 KM | 750 | 75 KM | do 33% |
| Silver | 79 KM | 1.100 | 110 KM | do 44% |
| Gold | 119 KM | 1.800 | 180 KM | do 56% |
| Platinum | 299 KM | 4.600 | 460 KM | do 60% |

- Krediti su mjesečni iznos uključen u pretplatu, ne jednokratni bonus.
- Kod Silvera i Golda krediti vrijede više od same pretplate (110 naspram 79 KM, 180 naspram
  119 KM). Kod Platinuma je obrnuto (460 naspram 299 KM u korist kredita, ali skok cijene je
  2,5x), a kod Bronzea krediti vrijede više od pretplate (75 naspram 59 KM).
- Paket se može mijenjati u bilo kojem trenutku, bez dugoročnog ugovora. Uplata za duži period
  nosi popust do 30%.
- Shop nema ograničenje na broj oglasa ni u jednoj kategoriji.
- Shop ostvaruje popust do 30% na objavu oglasa u komercijalnim kategorijama (Vozila,
  Nekretnine i sl.).
- Pri otvaranju shopa: 30 dana probno + 500 kredita dobrodošlice.
- Zvanična statistika sa iste stranice (26.07.2026.): oko 4.500 PIK shopova, 71 milion
  objavljenih oglasa, 4 miliona korisnika.

## Bonusi na dopunu kredita (kartično)

| Iznos dopune | Bonus |
|---|---|
| manje od 10 KM | bez bonusa |
| 10 – 49 KM | 20% |
| 50 – 149 KM | 25% |
| 150 – 199 KM | 30% |
| 200 KM i više | 40% |

SMS dopunom je maksimalni bonus oko 20%, pa je za veće iznose kartično plaćanje isplativije.

## Vrijednost kredita

- **1 KM = 10 kredita** (potvrđeno na zvaničnom izvoru i odnosom 500 kredita = 50 KM u probnom
  periodu). Koristi ovaj odnos kad pretvaraš kredite u KM za korisnika.

## Zarada kredita (bez dopune)

- 3 kredita za prvu prihvaćenu prijavu zloupotrebe oglasa; 1 kredit za naknadnu prihvaćenu prijavu.
- 2 kredita za uspješnu prijavu nedozvoljenog naslova (npr. više modela u jednom oglasu).
- Brza dostava: za svaku uspješnu dostavu gdje prodavac snosi trošak dostave 30 kredita; gdje kupac
  snosi trošak, prodavac dobija 10 a kupac 20 kredita.
- Napomena: zarada kredita dijeljenjem oglasa na Facebook više ne postoji (ukinuta).

## Probni period

- 30 dana besplatno pri prvoj aktivaciji shopa, uz 500 kredita (= 50 KM) bez obzira na paket.
- Prelaskom na shop nalog se NE može vratiti na PRO ili klasični profil (nepovratno).

## Fotografije

- Besplatno po oglasu: klasični profil 7, PRO 15, Shop 20. Maksimum 25 po oglasu; svaka iznad
  besplatnog limita košta 1 kredit.

## Obnavljanje po tipu naloga

- **Shop:** besplatna ručna obnova svakih 7 dana. Mjesečna kvota zavisi od naloga, vidi niže.
- **OLX PRO:** obnova svakih 21 dan.
- **Klasični profil:** obnova svakih 30 dana.

### Mjesečna kvota obnova: 750 naspram 1.800

Ovdje postoji protivrječnost koju treba znati prije nego se korisniku kaže broj.

- Zvanična stranica olx.ba/shopovi/paketi (provjereno 26.07.2026.) tvrdi **750 besplatnih obnova
  mjesečno**, i to jednako za sva četiri paketa, bez razlike.
- Izmjereno preko API-ja na stvarnom **Gold** shopu: `GET /listing/refresh/limits` vraća
  `free_limit: 1800`. Dakle 750 nije tačno za Gold.
- Razmak između dvije obnove istog oglasa je izmjeren i na **Platinum** shopu i iznosi 7 dana,
  isto kao Gold. Paket ne skraćuje razmak.

### Izmjereno na dva Gold naloga (26.07.2026.)

| Nalog | Paket | Krediti | free_limit | free_count | listing_count | Član od |
|---|---|---|---|---|---|---|
| Proton_Ilidza | Gold | 1.488 | 1.800 | 611 | 331 | 06/2026 |
| MixBox | Gold | 21.575 | 1.800 | 301 | 0 | 01/2019 |

Šta ovo dokazuje:

- **Kvota obnova je potpuno odvojena od salda kredita.** MixBox ima 21.575 kredita, četrnaest puta
  više od Protona, a `free_limit` je identičan, 1.800. Krediti ne kupuju obnove i obnove ne troše
  kredite.
- **Kvota ne zavisi ni od broja oglasa.** Proton ima 331 oglas, MixBox nula, a kvota je ista.
- **Kvota ne zavisi od starosti naloga.** MixBox je od 2019., Proton od juna 2026.

Šta ostaje otvoreno: dva Gold naloga ne mogu razlučiti dvije mogućnosti.

1. Kvota prati paket, i slučajno je jednaka broju kredita paketa (Bronze 750, Silver 1.100,
   Gold 1.800, Platinum 4.600).
2. Kvota je ravnih 1.800 za svaki shop paket, a 750 na zvaničnoj stranici je jednostavno
   zastarjelo.

Kako razlučiti: pokrenuti `olx_refresh_limits` na nalogu koji NIJE Gold. Jedan Bronze, Silver ili
Platinum token rješava pitanje u jednom pozivu.

Pravilo do tada: **ne citiraj kvotu napamet, pročitaj je sa `olx_refresh_limits` za taj nalog.**
- Oglas NE mora isteći da bi se obnovio; obnavlja se aktivan oglas da dobije svjež datum, čim
  prođe prag za taj tip naloga.
- Obnovu treba uraditi bar jednom u 6 mjeseci da oglas ne pređe u istekle.

## Otvorena pitanja koja vrijedi provjeriti u nalogu

- Da li se automatsko obnavljanje uz izdvajanje broji u besplatnu kvotu (`free_limit`) ili je odvojeno.
- Cijena samostalnog plaćenog obnavljanja preko besplatne kvote (nije u cjenovniku izdvajanja; `paid_count` u API odgovoru sugeriše da postoji).
