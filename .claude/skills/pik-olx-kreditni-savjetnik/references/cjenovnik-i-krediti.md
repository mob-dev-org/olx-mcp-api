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
- **Pokrivenost besplatnim obnovama:** 750 / (broj obnova po oglasu mjesečno).
  - Ciklus ~7-8 dana: oko 4 obnove mjesečno po oglasu, pa 750 / 4 je oko 187 oglasa.
  - Ciklus ~15 dana: 2 obnove mjesečno po oglasu, pa 750 / 2 je oko 375 oglasa.
  - Za katalog od ~400 oglasa ravnomjerno: 750 / 400 je oko 1,9 obnova, dakle ciklus ~16 dana.

### Primjeri (24h obnova, period 7 dana, cijena 54 po artiklu)

- 3 artikla: 3 × 54 = 162 kredita
- 4 artikla: 4 × 54 = 216 kredita

### Primjeri (24h obnova, period 30 dana, cijena 189 po artiklu)

- 3 artikla: 3 × 189 = 567 kredita
- 9 artikala: 9 × 189 = 1.701 kredita (blizu cijelog Gold budžeta od 1.800)

## Paketi shopova (bonus krediti i popusti)

| Paket | Bonus krediti/mjesec | Popust na dopunu dodatnih kredita |
|---|---|---|
| Bronze | 750 | do 33% |
| Silver | 1.100 | do 44% |
| Gold | 1.800 | do 56% |
| Platinum | 4.600 | do 60% |

- Gold pretplata je oko 119 KM mjesečno (sa PDV-om); 1.800 kredita je mjesečni iznos uključen u
  pretplatu, ne jednokratni bonus.
- Pri otvaranju shopa: 30 dana probno + 500 kredita dobrodošlice.

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

- **Shop (Gold/Platinum):** besplatna ručna obnova svakih 7 dana, do 750 obnova mjesečno.
- **OLX PRO:** obnova svakih 21 dan.
- **Klasični profil:** obnova svakih 30 dana.
- Oglas NE mora isteći da bi se obnovio; obnavlja se aktivan oglas da dobije svjež datum, čim
  prođe prag za taj tip naloga.
- Obnovu treba uraditi bar jednom u 6 mjeseci da oglas ne pređe u istekle.

## Otvorena pitanja koja vrijedi provjeriti u nalogu

- Da li se automatsko obnavljanje uz izdvajanje broji u kvotu od 750 ili je odvojeno.
- Cijena samostalnog plaćenog obnavljanja preko 750 besplatnih (nije u cjenovniku izdvajanja).
