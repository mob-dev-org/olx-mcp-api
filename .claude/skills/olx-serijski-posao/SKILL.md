---
name: olx-serijski-posao
description: >-
  Posao koji ide kroz mnogo oglasa odjednom: SEO prolaz, ciscenje kataloga, duga lista za objavu
  kroz vise dana. Okidaci: "prodji kroz sve oglase", "sredi cijeli katalog", "ocisti katalog",
  "objavi cijelu listu", "export sa shopa". Samo za admin sesiju, ne za razgovor sa klijentom.
---

# Serijski posao kroz mnogo oglasa

Za posao koji dira desetine ili stotine oglasa. Ne pokrece se u klijentskom razgovoru: tamo je
`Task` zabranjen, a klijent ne treba cekati tim agenata da odgovori na jedno pitanje.

## Zasto ovako a ne u jednom razgovoru

Nije zbog kraceg prompta, nego zbog **izolacije konteksta**. Podagent procita jedan oglas i vrati
pet redova. Bez toga do stotog oglasa vuces sto punih payloada u istom razgovoru, pa i kvalitet
odgovora pada, ne samo cijena.

## Obrazac: kod bira, model prosudjuje

Determinizam ostaje u kodu. Model se poziva samo za dio koji trazi prosudbu.

1. **Izbor kandidata radi agregat, ne model.** Ne prelistavaj katalog rucno:
   - SEO prolaz: `olx_onboarding_report` pa uzmi nalaze `naslov_kratak` i `bez_podnaslova`.
   - Ciscenje: `olx_mrtvi_oglasi`.
   - Konkurenti: popis usernameova iz `KLIJENT.md`.
2. **Odsijeci na razuman broj.** Prvi prolaz najvise 20 stavki. Bolje dvije ture koje korisnik
   pregleda nego jedna koju preskoci.
3. **Fan out preko podagenata**, jedan poziv po stavci, svi u jednoj poruci da idu uporedo:
   - `olx-seo-pisac` za tekst oglasa
   - `olx-trijaza` za odluku popraviti, sakriti ili zavrsiti
   - `olx-konkurent` za jednog konkurenta
   Nijedan od njih ne moze potrositi kredit ni promijeniti oglas; oni samo vracaju prijedlog.
4. **Sakupi u jednu tabelu**, najvise 15 redova po poruci uz broj preostalih.
5. **Primjena tek nakon potvrde**, i to grupnim alatom:
   - cijene: `olx_bulk_price` (prvo bez `confirm`, pa sa)
   - sklanjanje: `olx_bulk_sklanjanje` (prvo bez `confirm`, pa sa)
   - tekst: `olx_update_listing` jedan po jedan, jer nema grupnog alata za tekst
6. **Javi ishod u jednom redu**: koliko primijenjeno, koliko palo, sta ostaje za sljedecu turu.

## Duga lista za objavu kroz vise dana

Klijent zna donijeti spisak artikala (export sa shopa, Excel ili CSV) i traziti da se sve objavi.
Kad redova ima vise nego sto se objavi u jednom danu, to nije obicna objava nego serijski posao
kroz dane.

**Ovo danas ne postoji u kodu.** Nema alata za masovnu objavu ni reda cekanja koji pamti dokle se
stiglo. Sesija koja naidje na ovakvu listu NE improvizuje petlju pojedinacnih objava kroz cijeli
spisak. Umjesto toga: javi vlasniku da je ovo poseban posao, a za manju listu radi rucno,
artikal po artikal, kroz `olx-objava-artikla`.

Dnevni limit koliko se novih oglasa smije objaviti u danu nije poznat ni iz zvanicne
dokumentacije ni iz mjerenja, i ne pretpostavlja se nikakav broj. Kad se u praksi na njega
naleti, odmah `olx_zabiljezi_saznanje` sa punim tekstom greske sa API-ja.

Ne mijesati dvije razlicite stvari koje izgledaju kao ista greska: dnevni limit novih oglasa
(nepoznat, znaci "stani, nastavi sutra") i limit broja istovremeno aktivnih oglasa po grupi
kategorija (cita se preko `olx_listing_limits` i `olx_profile_stats` polja `objava_limit`, znaci
"grupa je puna, nastavak nema smisla dok se nesto ne zavrsi").

Kategorija se razrjesava PRIJE objave, najpreciznijim putem, jer je kategorija objavljenog oglasa
nepovratna a bot ne brise oglase (oba pravila su vec u granicama):

- artikli se grupisu po kategoriji iz shopa, to je deterministicki korak
- na uzorku naslova iz svake grupe pusti `olx_suggest_category`; stopa slaganja uzorka je mjera
  pouzdanosti mapiranja, kad se uzorak razleti po vise kategorija grupa nije homogena i ide
  artikal po artikal
- vlasnik potvrdjuje mapu uz prikazanu stopu slaganja, nikad naslijepo, a potvrdjena mapa se
  pamti da isti export sljedeci put ne trazi potvrdu ponovo
- `olx_draft_check` prije svake pojedinacne objave ostaje konacna istina o obaveznim atributima i
  naknadi

Priprema i izvrsenje se razdvajaju: sve sto trazi rasudjivanje (kategorija, dopuna podataka) ide
unaprijed uz potvrdu vlasnika, jer cron poslovi u ovom repou ne smiju zvati model. Samo izvrsenje
ostaje mehanicko.

Nastavak kroz dane prati obrazac koji vec postoji kod rasporeda izdvajanja (`sponsor plan`):
stanje po stavci na disku, sta je danas dospjelo, sta je zaglavljeno. Status stavke se upisuje na
disk PRIJE mreznog poziva, a ishod POSLIJE svake pojedinacne objave, jer prekid usred posla ne
smije ostaviti nejasno stanje niti napraviti duplikat koji se ne moze obrisati.

Pravila koja vlasnik trazi za ovaj posao:

- artikal u naplatnoj kategoriji se preskace i prijavljuje, ne objavljuje
- neispravan red se preskace i upisuje, a posao ide dalje: duga lista ne smije stati zbog par
  losih redova
- oglas kojem padnu sve slike se ne objavljuje, nego se pokusava ponovo narednih dana; oglas bez
  slike zauzima mjesto u limitu paketa a ne prodaje
- slike u listi dolaze kao URL; API ne prima URL nego se slika prvo preuzme pa posalje

Excel se u ovom toolkitu ne cita u jezgru, samo Python skriptama u skillu `olx-shopovi-snimci`.
Za novu listu trazi CSV izvoz, to je jeftinije nego uvoditi novu zavisnost.

## Kad NE koristiti podagente

- Manje od pet stavki. Rezije vise nego koristi.
- Kad je posao cisto racunski (koliko obnova danas, koliko kredita). To radi agregat sam.
- U klijentskom razgovoru. Nikad.
