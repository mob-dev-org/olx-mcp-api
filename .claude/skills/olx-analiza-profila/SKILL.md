---
name: olx-analiza-profila
description: >-
  Analiza i savjetovanje za OLX.ba / PIK.ba shop preko olx-pik MCP-a: vlastiti profil, oglasi,
  pozicija u pretrazi, cijene i sta konkretno poboljsati. Koristi ovaj skill kad god korisnik
  pita zasto mu oglasi slabo idu, koje oglase obnoviti ili izdvojiti, kako popraviti naslove,
  da li je cijena dobra, koji artikli na stanju trebaju paznju, ili trazi pregled i analizu
  profila sa preporukama. Okidaci: "analiziraj moje oglase", "sta da izdvojim", "zasto nemam
  pozive", "optimizuj naslov", "pregled profila", "koje da obnovim", "isplati li se izdvajanje",
  "analiziraj konkurenta". Pokriva i analizu poznatog konkurenta po username-u
  (olx_competitor_report; vidi references/konkurencija-faza2.md). Za sam setup MCP-a
  koristi skill olx-mcp-setup.
---

# OLX/PIK analiza profila i savjetovanje

## PRVO PRAVILO, IZNAD SVIH OSTALIH: nijedan broj napamet

Ovaj savjetnik radi za bilo koju bransu. Nijedna referenca ne sadrzi cijenu koja vazi za
korisnikovu kategoriju.

Cijena izdvajanja je dinamicna: zavisi od kategorije, broja oglasa u njoj, broja vec izdvojenih
oglasa i trajanja. Izmjerena je razlika od tri i po puta izmedju dvije kategorije za istu uslugu.

- Prije bilo kakvog spominjanja cijene, troska ili broja artikala koje budzet pokriva, dohvati
  stvarnu cijenu za taj konkretan oglas. Dohvatanje ne trosi kredite.
- Prije bilo kakve racunice o obnovama, procitaj stvarnu kvotu sa naloga. Ne koristi ni 750 ni
  1.800; oba broja postoje u dokumentaciji i oba su nepouzdana kao opste pravilo.
- Ako pristup nalogu nije moguc, ne izgovaraj nijedan broj. Reci sta ce se izmjeriti i koliko traje.

Cijena se ne pamti nego racuna:
`cijena = dnevna_cijena x naplativi_dani x faktor_obnove`, gdje se samo `dnevna_cijena` dohvaca
(cijena za 7 dana bez obnove podijeljena sa 6). Detalji u
`.claude/skills/pik-olx-kreditni-savjetnik/references/cjenovnik-i-krediti.md`.

Resource `olx://pravila-brojeva` (`olx-dokumentacija/pravila-brojeva.md`) ima prednost nad svim
ostalim referencama i nad ovim skillom kad je u pitanju bilo koji broj.

Primjeri iz bilo koje konkretne branse sluze samo da pokazu oblik racunice. Ne prenose se na
korisnikovu kategoriju i ne izgovaraju se korisniku.

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
     brojevi po svim stanjima, cijene, udio sponzorisanih, neobnovljeni oglasi, neodgovorena
     pitanja. Sa `views: "snapshot"` dodaje preglede iz danasnjeg snapshota (0 dodatnih poziva);
     sa `views: "sample"` mjeri preglede na uzorku (10-ak sekundi).
   - `olx_account_alerts` — brzi alarmi (pitanja, paket, krediti, kvota koja propada, istekli).
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

## Dijagnostika u jednoj recenici

- Malo pregleda -> problem je vidljivost. Prvo naslov (kljucne rijeci) i tacna kategorija, pa tek onda obnova/izdvajanje.
- Mnogo pregleda, malo poruka -> problem je ponuda, ne pozicija. Cijena, slike, opis. Ne trosi kredite na izdvajanje.
- Zasicena kategorija (npr. auto) -> izdvajanje slabije i skuplje. Naglasak na precizan naslov, konkurentnu cijenu, premium + autoobnova.

## Granice i zastite

- Nikad ne predlazi trosak kredita kao prvo rjesenje. Izdvajanje ne spasava los naslov ni lozu cijenu.
- Prije bilo kakvog izdvajanja prikazi cijenu (`olx_sponsor_price`) i trazi izricitu potvrdu. Sam
  toolkit ima spend-guard (`confirm: true`), ali ti to objasni korisniku, ne pokrecaj naplatu tiho.
- Za artikle kojih nema na stanju preporuci hide/finish, nikad brisanje (gubi se historija i pregledi).
- Ne predlazi brisanje pa ponovno objavljivanje radi vrha; to je spam i krsi pravila. Koristi obnovu.
- Procitaj mjesecnu kvotu obnova sa naloga (`olx_refresh_limits`) i ne prelazi je; rasporedi
  obnove na najvaznije i najkonkurentnije oglase. Kvota NIJE fiksna.

## Format izvjestaja

Koristi ovu strukturu (detaljnija verzija je u references/analiza-recept.md):

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

## Konkurencija

Analiza POZNATOG konkurenta je podrzana od 27.07.2026.: `olx_competitor_report <username>`
vraca izracunato (paket, aktivnost, cijene min/median/max, udio sponzorisanih i akcija, kadenca
obnove), a `top_views: N` dodaje detaljne izvjestaje za N najskorije obnovljenih oglasa,
ukljucujuci PREGLEDE tudjih oglasa. Pojedinacni tudji oglas: `olx_listing_report <id>`.
Sto i dalje NE postoji: otkrivanje konkurenata po kategoriji ili kljucnoj rijeci (nema search
endpointa) — konkurenta zadaje korisnik po username-u, ili se uzima iz mjesecnih Excel snimaka
shopova. Detalji i granice u `references/konkurencija-faza2.md`.
