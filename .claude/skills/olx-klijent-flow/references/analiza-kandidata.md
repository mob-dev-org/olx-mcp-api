# Recept: analiza kandidata (bez njegovog tokena)

Cilj je dokument sa 3 do 5 konkretnih propusta koje kandidat sam ne vidi, i procjenom sta se od
toga da popraviti. Sve iz javnih podataka; kandidat ne zna da ga gledamo i ne treba nam njegov
pristup. Nas token sluzi samo za autentikaciju prema API-ju.

## Koraci

1. `olx_competitor_report <username> top_views=5` — PRVI poziv, zamjenjuje raniji rucni tok od
   desetina poziva. Vraca izracunato: paket, kad je zadnji put bio aktivan, godine na platformi,
   ocjene, vrijeme odgovora, broj aktivnih i zavrsenih, cijene (min/median/max, "na upit"),
   udio sponzorisanih i akcija, kadencu obnove, plus detaljne izvjestaje (sa PREGLEDIMA) za 5
   najskorije obnovljenih oglasa.
2. `olx_listing_report <id>` na jos 2-3 reprezentativna oglasa (najskuplji artikli): pregledi
   dnevno, broj slika, popunjeni atributi, duzina naslova, podnaslov.
3. `olx_user_profile <username>` samo kad treba sirovo polje koje report ne nosi (poslovni
   podaci, web, opis shopa). `shop.ends_at` i `created_at` su unix timestampi u sekundama,
   pretvori ih u datum prije prikaza. Cjenovnik paketa je u `olx://knowledgebase`, 5.5.
4. Za sadrzaj naslova/podnaslova/opisa uzorka: `olx_get_listing <id>` (kompaktan default je
   dovoljan). Mini SEO ocjena po pravilima skilla `olx-seo-oglasa`
   (`references/seo-pravila.md`): nominativ, brend i model, prazne rijeci, duzina, prazan
   podnaslov.
5. Kategorije: za nekoliko naslova pozovi `olx_suggest_category` i uporedi sa kategorijom u
   kojoj oglas stoji. Pogresna kategorija je cest i skup propust.
6. Granica za finished: zavrseni oglasi ne vracaju cijene, i "zavrsen" nije nuzno "prodan".
   Ne tvrditi prihod iz broja zavrsenih.

## Sta se trazi (obrazac propusta)

- Plati paket a ne koristi ga: Platinum ili Gold bez ijednog izdvojenog oglasa, ili sa kreditima
  koji stoje neiskorisceni (krediti tudjeg naloga se ne vide, ali odsustvo izdvajanja se vidi).
- Neiskoristene obnove: oglasi sa datumima od nekoliko sedmica, dok je obnova besplatna do kvote.
- Naslovi bez kljucnih rijeci: "Prodajem povoljno", genitiv, bez modela. Znaci da ih pretraga ne
  nalazi ni kad kupac kuca tacan pojam.
- Prazni podnaslovi: propustena pretraga, jer podnaslov ulazi u tražilicu.
- Pogresna kategorija: oglas ne postoji za kupca koji pretrazuje kroz kategoriju.
- Malo slika ili loše slike, dok shop ima do 20 besplatno.
- Cijena "po dogovoru": oglas ispada iz cjenovnih filtera i sortiranja.
- Sporo odgovaranje (`avg_response_time`) uz dobru ponudu: gubi upite koje je vec platio.

## Format dokumenta za internu upotrebu

1. Ko je kandidat: username, paket, do kad vazi, koliko aktivnih oglasa, koje kategorije.
2. Sta radi dobro (dvije ili tri stvari, iskreno). Bez ovoga pitch zvuci kao napad.
3. Propusti, poredani po tome koliko brzo se popravljaju i koliko donose:
   | propust | dokaz (id oglasa ili broj) | sta se dobija ispravkom | koliko traje |
4. Sta CodeFactory konkretno radi u prvih 30 dana (vezati na faze iz SKILL.md).
5. Granice nalaza: sta se iz javnih podataka NE vidi (krediti, koliko placa izdvajanja,
   pojmovi pretrage, neodgovorena pitanja, stvarna prodaja). Pregledi po oglasu SE vide javno.
   Ostalo se dobija tek sa tokenom, i to je jedan od argumenata.

## Granice i posteno ponasanje

- Ne izmisljati brojeve. Ako se pregled ili prihod ne vidi, napisati da se ne vidi.
- Ne koristiti tudji nalog ni za jednu radnju upisa. Analiza je citanje javnih podataka.
- Ne kopirati tudje oglase, opise ni slike. Analiza sluzi da nasem klijentu bude bolje, ne da se
  preslika konkurent.
- Dokument je interni. Klijentu ide sazetak, bez sirovog popisa tudjih id-jeva ako to nije
  njegov shop.
