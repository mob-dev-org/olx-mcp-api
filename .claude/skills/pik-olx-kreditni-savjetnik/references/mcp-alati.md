# Korištenje olx-pik MCP alata za izdvajanje

Ovdje je samo ono što je specifično za planiranje izdvajanja. Ostalo ne prepisujemo:

- popis alata i parametara: `olx-dokumentacija/API-INVENTAR.md`
- pravila o trošku, potvrdi i brisanju: `olx-dokumentacija/granice.md` (već u kontekstu)
- koji broj se smije izgovoriti a koji se čita s API-ja: `olx://pravila-brojeva`
- životni ciklus oglasa draft pa slike pa publish: skill `olx-objava-artikla`

Ako je `olx-pik` MCP server dostupan, koristi ga da provjeriš stvarno stanje naloga umjesto da
nagađaš (koji su oglasi aktivni, šta je već izdvojeno, cijene). Alati se učitavaju preko
pretrage alata; svi nazivi počinju sa `olx_`.

## Redoslijed rada (uvijek isti)

1. **Provjeri nalog prije svega.** Pozovi `olx_whoami` i reci korisniku na kojem si nalogu. Jedan
   klon repozitorija radi za jedan nalog; promjena naloga kroz bota nije moguća.
2. **Čitaj stanje** (bezopasno): `olx_list_listings` (po stanju: active, finished, inactive,
   expired, hidden), `olx_get_listing` za pojedinačni oglas, `olx_category` za pravila i cijene
   kategorije.
3. **Provjeri šta je već izdvojeno** prije nego predložiš nova izdvajanja, da se ne duplira.
4. **Izvrši samo uz potvrdu** (vidi niže).

## Tipičan zadatak: "pripremi N artikala za izdvajanje da se ne dupliraju"

1. `olx_list_listings` (active) i izdvoji koji su već promovisani (kompaktan odgovor nosi
   `sponsored` 0/1/2), ili provjeri pojedinačno `olx_listing_report` za sumnjive.
1a. Prije preporuke KOJE artikle izdvojiti, pogledaj im preglede dnevno kroz
   `olx_listing_report`: artikal koji već ima dobre preglede dnevno rjeđe treba izdvajanje;
   artikal sa dobrim proizvodom a slabim pregledima je bolji kandidat (prvo provjeri naslov).
   Poslije izdvajanja efekat se MJERI, ne pretpostavlja: `olx_sponsor_effect <id>` (treba
   dnevne snapshote, CLI `stats snapshot`, vidi skill olx-cron-obnove).
2. Spoji sa metodom izbora iz `strategija.md` (pojmovi u pretrazi × najgledaniji).
3. Predloži artikle koji nisu već izdvojeni, sa ID-evima i obrazloženjem.
4. Cijeli plan (kandidati, cijene, raspored po danima, budžet) računa `olx_sponsor_plan`,
   NE ti: proslijedi budžet i opcije (i ID-eve iz koraka 3 ako ih imaš), pa rezultat objasni.
   Nikad ne sklapaj plan ručnim množenjem cijena. `sacuvaj: true` tek kad korisnik prihvati
   plan, da ga prate sedmični izvještaj i izvršenje.
5. Pojedinačnu cijenu za brzo pitanje daje `olx_sponsor_price`.
6. Sačekaj potvrdu prije `olx_sponsor_listing` (plan NIJE potvrda; svaki termin se potvrđuje).

### Izdvajanje na oglas koji je VEC izdvojen (bitno za planiranje)

Provjereno na Gold nalogu 25.07.2026: ako oglas ima aktivno izdvajanje, novi poziv
`POST /listings/:id/sponsore` NE zamjenjuje i NE prekida trenutno, nego ga **zakazuje** da
pocne kad trenutno istekne.

- odgovor je `"Oglas je snimljen u listu za izdvajanje"` (a ne `"Oglas je uspjesno izdvojen"`)
- **krediti se u tom trenutku NE naplacuju**; stanje ostaje isto, naplata ide kad zakazano pocne
- pojavljuje se polje `sponsor_scheduled` sa `{id, is_active, start_date, criterias}`, gdje je
  `start_date` tacno jednak `sponsored_until` iz `sponsor_active`
- `sponsor_active` ostaje nepromijenjen, dakle ne gubi se ni jedan plaćeni dan

Ako oglas ima I aktivno I zakazano izdvajanje, svaki dalji poziv se ODBIJA sa
`400 "Oglas je vec u listi za izdvajanje"`. Nista se ne naplacuje i nista se ne mijenja.
Slot za zakazano je jedan, pa se zakazana konfiguracija ne moze zamijeniti preko API-ja.

Dakle postoje tri stanja i tri razlicita ishoda:

| Stanje oglasa | Ishod poziva sponsore | Naplata |
|---|---|---|
| bez izdvajanja | izdvaja se ODMAH | da, odmah |
| aktivno izdvajanje | ZAKAZUJE se za kraj tekuceg | ne, kad pocne |
| aktivno + zakazano | ODBIJA se, 400 | ne |

Posljedica za nadogradnju: premium ili naslovnica se NE mogu dodati na oglas koji je vec
izdvojen i ima zakazano. Ne postoji ni endpoint za otkazivanje (`sponsore/finish` i
`sponsore/cancel` vracaju 404), pa se zakazano moze otkazati samo rucno kroz web (Moj OLX).
Zato konfiguraciju (type, naslovnica, refresh_every) treba izabrati PRIJE prvog zakazivanja.

Prakticne posljedice:

- Nema potrebe cekati da izdvajanje istekne da bi se postavilo sljedece. Moze se zakazati
  unaprijed, i tako se izbjegne prekid vidljivosti izmedju dva ciklusa.
- Rotacija se moze pripremiti unaprijed: zakazi sljedeci ciklus dok tekuci traje.
- Kod planiranja budzeta racunaj da zakazano izdvajanje jos NIJE placeno, pa kredita mora
  biti dovoljno u momentu kad zakazano pocne, ne sada.
- Ako ti treba drukcija konfiguracija SADA (npr. dodati autoobnovu odmah), zakazivanje to ne
  rjesava, jer novi parametri stupaju na snagu tek kad tekuci period istekne.

- Ne logiraj lične podatke kupaca; ne izvozi cijene kredita ni marže u materijale za klijente.
