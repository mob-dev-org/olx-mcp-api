---
name: olx-analiza-profila
description: >-
  Analiza vlastitog OLX/PIK shopa i savjet sta popraviti: oglasi, cijene, svjezina, sta obnoviti
  ili izdvojiti. Pokriva i analizu konkurenta po username-u. Okidaci: "analiziraj moje oglase",
  "zasto nemam pozive", "pregled profila", "sta da izdvojim", "analiziraj konkurenta".
---

# OLX/PIK analiza profila i savjetovanje

## Prvo pravilo: nijedan broj napamet

Cijena izdvajanja je dinamicna i razlikuje se po kategoriji; izmjerena je razlika od tri i po
puta za istu uslugu. Kvota obnova zavisi od naloga. Zato se prije svakog spominjanja cijene ili
kvote dohvata stvarni broj; dohvatanje ne trosi kredite.

Detalji i podjela brojeva na razrede su u `olx://pravila-brojeva`, koji ima prednost nad ovim
skillom. Model cijene je u
`.claude/skills/pik-olx-kreditni-savjetnik/references/cjenovnik-i-krediti.md`.

## Drugo pravilo: prilagodi se bransi, ne pretpostavljaj je

Prije savjetovanja utvrdi sta korisnik prodaje i koliko donosi jedna prosjecna prodaja, koliko ima
oglasa, i koji paket ima uz stanje kredita i obnova. Ta tri podatka mijenjaju svaki dalji savjet.
Ako neki fali, pitaj kratko prije nego pocnes racunati.

Ovaj skill te vodi da od sirovih podataka shopa napravis korisnu, konkretnu analizu sa
prioritetnim koracima. Strategija (kako radi pretraga, svjezina, izdvajanje) NIJE prepisana
ovdje, nego zivi u MCP resursima. Tvoj posao je da je primijenis na stvarne oglase korisnika.

## Prvo procitaj strategiju iz resursa

Prije savjetovanja procitaj MCP resurse (preko olx-pik servera):
- `olx://pravila-brojeva` — koji brojevi se smiju koristiti bez provjere, a koji se citaju. Ima
  prednost nad svim ostalim izvorima kad je u pitanju broj.
- `olx://knowledgebase` — API referenca, pravila vidljivosti, dijagnostika.
- Vodic o rangiranju/pretrazi/sortiranju (`olx-dokumentacija/OLX_PIK_Rangiranje_Pretraga_Sortiranje.md`).

Tamo je kljucna hijerarhija: kljucne rijeci u naslovu odlucuju DA LI te nadju, svjezina (obnova)
i izdvajanje odlucuju KOLIKO si visoko. Bez toga savjeti su nagadjanje.

## Tok rada

1. Provjeri pristup: `olx_whoami`. Ako vrati 403, stani i uputi korisnika na skill olx-mcp-setup.
2. Prikupi podatke (sve su sigurni, read-only alati, ne trose kredite). PRVI IZBOR je
   agregirani alat, ne rucno prelistavanje:
   - `olx_profile_stats` — JEDAN poziv vraca izracunato: paket i istek, krediti, kvota obnova,
     brojevi po svim stanjima, cijene, udio sponzorisanih, neobnovljeni oglasi.
     Sa `views: "snapshot"` dodaje preglede iz danasnjeg snapshota (0 dodatnih poziva);
     sa `views: "sample"` mjeri preglede na uzorku (10-ak sekundi).
   - `olx_account_alerts` — brzi alarmi (paket, krediti, kvota koja propada, istekli).
   - `olx_listing_report <id>` — izracunata analiza jednog oglasa: pregledi dnevno, pitanja,
     dana od obnove, slike, atributi, naslov. Koristi za svaki oglas koji detaljnije gledas.
   - `olx_list_listings` (kompaktan default) tek kad treba cijeli spisak naslova, npr. za SEO
     prolaz kroz sve naslove; `full: true` samo kad zatreba polje koje kompakt nema.
   - `olx_sponsor_price` SAMO ako razmatras izdvajanje (vraca cijenu, ne trosi).
   - Efekat proslog izdvajanja: `olx_sponsor_effect <id>` (treba dnevne snapshote, vidi
     olx-cron-obnove).
3. Dijagnostikuj svaki problematican oglas po pravilima iz `olx://knowledgebase` (sekcija dijagnostika).
4. Za sumnju na pogresnu kategoriju provjeri kroz resource `olx://categories-index` (CSV: path, id, zastavice);
   za obavezne forme tacne kategorije pozovi `olx_category_attributes <id>`. Ne ucitavaj cijeli categories JSON.
5. Napravi izvjestaj po sablonu nize i predlozi konkretne, prioritetne akcije.

Detaljan recept (kako citati naslove, cijene, kako rasporediti obnove, sablon izvjestaja) je u
`references/analiza-recept.md`. Procitaj ga kad radis punu analizu profila.

## Dijagnostika

Tri obrasca i sta znace su u
`.claude/skills/pik-olx-kreditni-savjetnik/references/strategija.md`.

## Granice

Vrijede tvrde granice iz `olx-dokumentacija/granice.md`, vec su u kontekstu. Specificno ovdje:
izdvajanje nije prvo rjesenje i ne spasava los naslov ni losu cijenu.

## Format izvjestaja

**Prvo sazetak od 3 do 5 redova, i stani.** Puni izvjestaj se pise tek kad ga korisnik zatrazi,
ili kad se snima u fajl. U sekciji "Nalazi po oglasima" najvise 10 oglasa uz broj preostalih.
Puna lista ide u fajl, ne u razgovor.

Kad zatrazi puni izvjestaj, koristi ovu strukturu (detaljnija verzija je u
references/analiza-recept.md):

```
# Analiza profila: <username>
## Sazetak
<2-4 recenice: stanje kataloga, glavni problem, najveca prilika>
## Nalazi po oglasima
<za svaki problematican oglas: id, naslov, dijagnoza, konkretan prijedlog>
## Prioritetne akcije (redom)
1. Besplatno odmah (naslovi, kategorije, obnova u okviru limita)
2. Ponuda (cijena, slike, opis)
3. Placeno selektivno (izdvajanje gdje se isplati, uz cijenu i potvrdu)
## Sta NE raditi
<gdje ne trositi kredite i zasto>
```

## Prijedlozi iz sedmicne AI runde

Sedmicna runda (pokrece je administrator, ne ovaj razgovor) ostavlja prijedloge u
`.olx-pik/prijedlozi/`, jedan fajl po rundi (`runda-YYYY-MM-DD.md`). Kad korisnik trazi da se
"primijene prijedlozi" ili spomene sedmicnu poruku:

1. Procitaj najnoviji fajl iz tog foldera. Ako ga nema, reci da trenutno nema prijedloga na
   cekanju i ponudi svjezu analizu.
2. Pobroj stavke obicnim jezikom, grupisano kako su grupisane u fajlu, najvise 10 uz broj
   preostalih.
3. Potvrdu trazi po grupi, ne po stavci. Primjenjuj postojecim alatima: tekst kroz
   `olx_update_listing` jedan po jedan, sakrivanje i zavrsavanje kroz `olx_bulk_sklanjanje`
   (prvo bez confirm da se vidi obuhvat, pa sa confirm).
4. Pravila troska se ne mijenjaju: sve sto kosta kredite i dalje ide kroz cijenu pa jasnu
   potvrdu. Prijedlog iz fajla NIJE potvrda.

## Konkurencija

Analiza POZNATOG konkurenta je podrzana od 27.07.2026.: `olx_competitor_report <username>`
vraca izracunato (paket, aktivnost, cijene min/median/max, udio sponzorisanih i akcija, kadenca
obnove), a `top_views: N` dodaje detaljne izvjestaje za N najskorije obnovljenih oglasa,
ukljucujuci PREGLEDE tudjih oglasa. Pojedinacni tudji oglas: `olx_listing_report <id>`.
Sto i dalje NE postoji: otkrivanje konkurenata po kategoriji ili kljucnoj rijeci (nema search
endpointa) — konkurenta zadaje korisnik po username-u, ili se uzima iz mjesecnih Excel snimaka
shopova. Detalji i granice u `references/konkurencija-faza2.md`.
