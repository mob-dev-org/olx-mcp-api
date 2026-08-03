# Cijena izdvajanja, krediti i obnavljanje

Zamjenjuje raniju verziju koja je sadržavala tabelu cijena. Tabela je uklonjena jer je važila samo
za jedan cjenovni razred, a čitala se kao opšti cjenovnik. Umjesto nje stoji model koji radi za
bilo koju kategoriju uz jedan dohvaćen broj.

Pravila o tome koji brojevi se smiju koristiti bez provjere su u `pravila-brojeva.md` i taj fajl
ima prednost nad ovim.

---

## Model cijene izdvajanja

Cijena se ne pamti. Računa se iz jednog broja koji se dohvati za kategoriju.

```
cijena = dnevna_cijena × naplativi_dani × faktor_obnove
```

### Dnevna cijena

Jedini podatak koji se mora dohvatiti. Dobija se iz cijene za sedam dana bez obnove:

```
dnevna_cijena = cijena_7_dana_bez_obnove / 6
```

Sedam dana se naplaćuje kao šest, jer je jedan dan gratis. Zato dijeljenje sa šest, ne sa sedam.

### Naplativi dani

Duži periodi nose gratis dane. Naplaćuje se razlika.

| Odabrani period | Gratis dana | Naplativi dani |
|---|---|---|
| 1 dan | 0 | 1,33 (minimalna naplata) |
| 2 dana | 0 | 2 |
| 3 dana | 0 | 3 |
| 5 dana | 0 | 5 |
| 7 dana | 1 | 6 |
| 14 dana | 3 | 11 |
| 21 dan | 5 | 16 |
| 30 dana | 9 | 21 |

### Faktor obnove

| Automatska obnova | Faktor |
|---|---|
| bez obnove | 1,0 |
| svaka 24 sata | 1,5 |
| svakih 8 sati | 2,5 |

Premium izdvajanje je oko 2,7 puta skuplje od klasičnog. Taj odnos je izmjeren jednom i nije
provjeren kroz više kategorija, pa se za premium cijena uvijek dohvaća posebno.

### Pouzdanost modela

Model je provjeren na 24 polja jednog cjenovnika i na četiri kategorije čije se dnevne cijene
razlikuju tri i po puta, od 2 do 7 kredita dnevno. Pogađa svako polje, uz odstupanje do jednog
kredita zbog zaokruživanja.

**Faktori su strukturni i drže kroz kategorije. Dnevna cijena nije i mora se dohvatiti.**
Ako se ikad naiđe na kategoriju gdje model promaši za više od jednog kredita, prestani ga koristiti
za tu kategoriju i dohvaćaj svaku kombinaciju posebno.

---

## Kako se dnevna cijena dohvaća

Jedan poziv za cijenu izdvajanja na bilo koji oglas iz te kategorije, sa periodom sedam dana i bez
automatske obnove. Dohvatanje ne troši kredite.

Napomena o parametrima: polje za razmak obnavljanja je obavezno i za izdvajanje bez obnove, tada
se šalje nula. Bez njega poziv pada.

Za katalog sa više kategorija dohvati po jedan oglas iz svake kategorije. Broj poziva je jednak
broju kategorija, ne broju oglasa.

**Nepotvrđeno i vrijedi provjeriti:** pretpostavka je da je dnevna cijena ista za sve oglase unutar
jedne kategorije. Provjera traje minutu, uporedi dva oglasa iste kategorije sa različitom cijenom
artikla i različitom starošću. Dok se to ne provjeri, ponašaj se kao da pretpostavka ne drži i
dohvaćaj po oglasu za uži izbor koji se stvarno razmatra.

---

## Računice koje se izvode iz dohvaćene cijene

Sve što slijedi traži da dnevna cijena već bude poznata.

- **Koliko artikala stalno izdvojeno cijeli mjesec:** raspoloživi krediti podijeljeni sa cijenom za
  30 dana po jednom artiklu.
- **Kratko ponavljano naprema jednom dugom:** četiri puta cijena za sedam dana naprema jednoj
  cijeni za trideset dana. Uz gratis dane duži period je uvijek jeftiniji, razlika je oko 12 posto
  bez obzira na kategoriju, jer proizlazi iz odnosa naplativih dana (4 puta 6 je 24 naprema 21).
- **Isplati li se obnova na 24 sata:** poređenje između istog perioda sa faktorom 1,0 i 1,5.
  Razlika je uvijek pola osnovne cijene, pa je pitanje samo vrijedi li ti biti na vrhu svaki dan
  umjesto jednom.
- **Prag isplativosti po artiklu:** procijenjena zarada od jedne dodatne prodaje naspram cijene
  izdvajanja tog artikla na trideset dana. Oba broja se dohvaćaju ili traže od korisnika, ne
  procjenjuju se napamet.

---

## Vrijednost kredita

1 KM je 10 kredita. Ovo je platformsko i smije se koristiti bez provjere.

---

## Krediti u paketima

Iz dokumentacije, provjeriti na nalogu prije nego uđe u računicu jer se paketi mijenjaju.

| Paket | Krediti mjesečno | Popust na dopunu |
|---|---|---|
| Bronze | 750 | do 33% |
| Silver | 1.100 | do 44% |
| Gold | 1.800 | do 56% |
| Platinum | 4.600 | do 60% |

Pri prvom otvaranju shopa: 30 dana probno i 500 kredita.

---

## Bonusi na dopunu kredita karticom

Platformsko, važi bez obzira na kategoriju.

| Iznos dopune | Bonus |
|---|---|
| ispod 10 KM | bez bonusa |
| 10 do 49 KM | 20% |
| 50 do 149 KM | 25% |
| 150 do 199 KM | 30% |
| 200 KM i više | 40% |

Dopunom preko SMS poruke maksimalan bonus je oko 20 posto, pa je za veće iznose kartica
isplativija. Jedna veća dopuna nosi više kredita nego više manjih za isti ukupan novac.

---

## Obnavljanje

- Prag ručne obnove: shop svakih 7 dana, PRO svakih 21 dan, klasični profil svakih 30 dana.
  Platformsko, smije se koristiti bez provjere.
- Oglas se obnavlja i kad je aktivan, ne mora isteći. Obnova daje svjež datum.
- Bar jednom u šest mjeseci, inače oglas prelazi u istekle.
- **Kvota besplatnih obnova se MORA pročitati sa naloga.** Zvanična pomoć navodi 750, izmjereno je
  1.800 na Gold nalogu. Nijedan broj se ne koristi kao pretpostavka. Kvota se obnavlja svakog
  ciklusa pretplate (dan iz `shop.ends_at`), ne prvog u kalendarskom mjesecu.
- Polje sa iskorištenim obnovama pokazuje POTROŠENO, ne preostalo.

### Pokrivenost kataloga obnovama

```
maksimalno obnova po oglasu u 30 dana = 30 / prag u danima
broj oglasa koji staje u kvotu = kvota / obnova po oglasu
```

Za shop na sedmodnevnom pragu to je oko četiri obnove po oglasu u 30 dana. Ako je katalog veći od
kvote podijeljene sa četiri, sedmični ciklus nije moguć za cijeli katalog i obnove se moraju
rasporediti po prioritetu.

---

## Fotografije

Besplatno po oglasu: klasični profil 7, PRO 15, shop 20. Maksimum 25, svaka preko besplatnog
limita košta 1 kredit. Platformsko.

---

## Zarada kredita bez dopune

- 3 kredita za prvu prihvaćenu prijavu zloupotrebe, 1 za naknadnu prihvaćenu.
- 2 kredita za prijavu nedozvoljenog naslova.
- Brza dostava: 30 kredita kad prodavac snosi trošak dostave, 10 kredita prodavcu i 20 kupcu kad
  kupac snosi trošak.
- Prijava koja nije dobro obrazložena se odbija, pa je zarada kroz prijave nepouzdan izvor kredita
  (postotak odbijenih nije nigdje objavljen, ne navodi ga)
  kao izvor.

---

## Otvorena pitanja

- Da li se automatsko obnavljanje uz izdvajanje broji u kvotu besplatnih obnova ili je odvojeno.
- Cijena plaćene obnove preko besplatne kvote.
- Da li je dnevna cijena stvarno ista za sve oglase unutar kategorije.
- Da li faktor premium izdvajanja od oko 2,7 drži kroz kategorije.
