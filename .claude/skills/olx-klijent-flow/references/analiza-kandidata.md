# Recept: analiza kandidata (bez njegovog tokena)

Cilj je dokument sa 3 do 5 konkretnih propusta koje kandidat sam ne vidi, i procjenom sta se od
toga da popraviti. Sve iz javnih podataka; kandidat ne zna da ga gledamo i ne treba nam njegov
pristup. Nas token sluzi samo za autentikaciju prema API-ju.

## Koraci

1. `olx_user_profile <username>` — paket (Gold, Platinum), poslovni podaci, datum registracije,
   ocjene, medalje, prosjecno vrijeme odgovora, datum do kojeg paket vazi. Paket govori koliko
   kandidat mjesecno placa i koliko kredita dobija (cjenovnik je u `olx://knowledgebase`, 5.5).
2. `olx_list_listings state=active all=true user=<username>` — cijeli aktivni katalog:
   koliko oglasa, koje kategorije, raspon cijena, koliko ih je izdvojeno (`sponsored`), koliko
   ima svjez datum (`date`), da li je `refresh_available` iskoristen.
3. `olx_list_listings state=finished user=<username>` — promet. Broj zavrsenih oglasa i tempo
   pokazuju da li shop stvarno prodaje. Granica: zavrseni oglasi ne vracaju cijene, i "zavrsen"
   nije nuzno "prodan" (moze biti odustajanje ili istek). Ne tvrditi prihod iz ovoga.
4. `olx_list_listings state=hidden|expired user=<username>` kad je dostupno — pokazuje
   zanemarene oglase i neiskoristen katalog.
5. `olx_get_listing <id>` na uzorku od 10 do 15 oglasa: naslov, podnaslov, opis, broj slika,
   kategorija. Uzorak birati po najskupljim i najreprezentativnijim artiklima.
6. Mini SEO ocjena naslova iz uzorka po pravilima skilla `olx-seo-oglasa`
   (`references/seo-pravila.md`): nominativ, brend i model, prazne rijeci, duzina, prazan
   podnaslov.
7. Kategorije: za nekoliko naslova pozovi `olx_suggest_category` i uporedi sa kategorijom u
   kojoj oglas stoji. Pogresna kategorija je cest i skup propust.

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
5. Granice nalaza: sta se iz javnih podataka NE vidi (krediti, statistika pregleda, pojmovi
   pretrage, stvarna prodaja). To se dobija tek sa tokenom, i to je jedan od argumenata.

## Granice i posteno ponasanje

- Ne izmisljati brojeve. Ako se pregled ili prihod ne vidi, napisati da se ne vidi.
- Ne koristiti tudji nalog ni za jednu radnju upisa. Analiza je citanje javnih podataka.
- Ne kopirati tudje oglase, opise ni slike. Analiza sluzi da nasem klijentu bude bolje, ne da se
  preslika konkurent.
- Dokument je interni. Klijentu ide sazetak, bez sirovog popisa tudjih id-jeva ako to nije
  njegov shop.
