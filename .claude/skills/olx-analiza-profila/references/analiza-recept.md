# Recept za punu analizu profila

Ovo je detaljni vodic koji dopunjava SKILL.md. Procitaj ga kad radis kompletnu analizu, ne za brzo pitanje.

## 1. Prikupljanje (read-only, bez troska)

- `olx_profile_stats` -> PRVI poziv, umjesto rucnog prelistavanja: paket, krediti, kvota obnova
  (budzet obnova = preostalo), brojevi po svim stanjima, cijene, udio sponzorisanih,
  neobnovljeni oglasi, nova pitanja. `views: "snapshot"` dodaje preglede iz danasnjeg
  snapshota bez dodatnih poziva; `views: "sample"` ih mjeri na uzorku.
- `olx_list_listings` state=active, all=true -> spisak naslova za SEO prolaz (kompaktan default
  je dovoljan: id, naslov, cijena, sponsored, date, refresh_available).
- Za svaki oglas koji detaljnije gledas `olx_listing_report <id>` -> izracunato: pregledi
  ukupno i DNEVNO, pitanja, dana od obnove, broj slika, popunjeni atributi, duzina naslova.
  `olx_get_listing` (kompaktan) tek kad treba sam sadrzaj naslova/podnaslova/opisa.

Pregledi po oglasu POSTOJE (polje `views`); "pojmovi na pretrazi" i dalje ne postoje kroz API,
pa za kljucne rijeci radi na osnovu naslova/kategorije i to jasno reci.

## 2. Citanje naslova (najveci poluga vidljivosti)

Trazilica spaja cijele rijeci iz naslova i podnaslova po AND logici; opis NE ulazi u pretragu. Provjeri:

- Ima li naslov rijeci koje kupac stvarno kuca (brend, model, varijanta, lokacija)? Test: "Da li bi kupac ovo ukucao?"
- Je li u nominativu ("Stan Sip", ne "Stan na Sipu")? Padezi su bitni, mnozina/jednina se ne pogadjaju.
- Je li jedan artikal po oglasu? Nabrajanje vise modela skodi i nije dozvoljeno.
- Je li podnaslov iskoristen za dodatne kljucne rijeci koje ne stanu u naslov?

Za svaki slab naslov predlozi konkretno prepravljen naslov, ne uopsten savjet.

## 3. Cijena

- Konkretna cijena, ne "Po dogovoru". Oglasi sa "Po dogovoru" ispadaju iz cjenovnih filtera i sortiranja.
- Ako je cijena vidljivo van trzista (a imas referencu), oznaci to kao problem ponude.

## 4. Svjezina i raspored obnova

- Obnova daje svjez datum i dize oglas na vrh kategorije medju standardnim oglasima.
- Rasporedi preostale besplatne obnove na najvaznije i najkonkurentnije oglase, ne nasumicno.
- Za stalno prisustvo na vrhu kombinuj izdvajanje + autoobnova (3, 8 ili 24 sata).

## 5. Kad (i kad ne) izdvajati

- Izdvajaj selektivno: artikle vece vrijednosti ili one koji stoje, gdje organsko nije dovoljno.
- Uvijek prvo `olx_sponsor_price`, predoci cijenu u kreditima i trazi potvrdu prije naplate.
- U prezasicenim kategorijama izdvajanje je slabije i skuplje; tu vise vrijedi precizan naslov + cijena + autoobnova.

## 6. Sablon izvjestaja (prosirena verzija)

Ovaj dokument se PISE U FAJL. U razgovor ide samo sazetak od 3 do 5 redova i pitanje hoce
li korisnik puni izvjestaj.

```
# Analiza profila: <username>
Datum: <YYYY-MM-DD>  |  Aktivnih oglasa: <n>  |  Preostalo besplatnih obnova: <m>

## Sazetak
<stanje kataloga, glavni problem, najveca prilika, u 2-4 recenice>

## Nalazi po oglasima
### <id> — <naslov>
- Dijagnoza: <vidljivost | ponuda | kategorija | svjezina>
- Dokaz: <sta tacno (npr. naslov bez modela, "Po dogovoru", pogresna kategorija)>
- Prijedlog: <konkretno; za naslov daj prepravljenu verziju>

## Prioritetne akcije (redom isplativosti)
1. Besplatno odmah: <prepravke naslova/kategorija, obnova u okviru limita>
2. Ponuda: <cijena, slike, opis>
3. Placeno selektivno: <koje izdvojiti, procijenjeni efekat, uz cijenu i potvrdu>

## Sta NE raditi
<gdje ne trositi kredite, sta izbjegavati (brisanje radi vrha, izdvajanje losih naslova)>
```

Cilj izvjestaja: korisnik treba moci da krene od tacke 1 i radi redom, bez pogadjanja.
