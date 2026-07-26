# Korištenje olx-pik MCP alata i sigurno izvršenje

Ako je `olx-pik` MCP server dostupan, koristi ga da provjeriš stvarno stanje naloga umjesto da
nagađaš (koji su oglasi aktivni, šta je već izdvojeno, cijene). Alati se učitavaju preko
pretrage alata; nazivi su na engleskom i počinju sa `olx_` (npr. `olx_list_listings`).

## Redoslijed rada (uvijek isti)

1. **Provjeri aktivni nalog prije svega.** Pozovi `olx_whoami` (i `olx_list_accounts` za spisak
   profila) da potvrdiš na kom si nalogu. Server radi na jednom aktivnom nalogu.
2. **Po potrebi promijeni nalog** sa `olx_switch_account` i obavezno potvrdi korisniku na koji si
   nalog prešao PRIJE bilo kakvog upisa ili troška, da se radnja ne izvrši na pogrešnom klijentu.
3. **Čitaj stanje** (bezopasno): `olx_list_listings` (po stanju: active, finished, inactive,
   expired, hidden), `olx_get_listing` za pojedinačni oglas, `olx_category` za pravila i cijene
   kategorije.
4. **Provjeri šta je već izdvojeno** prije nego predložiš nova izdvajanja, da se ne duplira.
5. **Izvrši samo uz potvrdu** (vidi niže).

## Glavni alati

Puni popis svih 35 alata sa parametrima, oznakom troška i nepovratnosti je u
`olx-dokumentacija/API-INVENTAR.md` — to je jedini izvor istine za alate, ne dupliraj ga ovdje.

Za ovaj skill je bitna samo podjela po posljedicama:

- **Troše kredite** (nikad bez potvrde, imaju spend-guard `confirm`): `olx_sponsor_listing`,
  `olx_set_discount`.
- **Nepovratno**: brisanje oglasa kroz bota ne postoji. `olx_delete_listing` je uklonjen iz
  MCP-a; kad korisnik traži brisanje, predloži `olx_finish_listing` (oglas ostaje u historiji
  profila kao dokaz prodaje) ili `olx_hide_listing`.
- **Troše kvotu obnova** (besplatno do `free_limit`): `olx_refresh_listing`, `olx_refresh_bulk`.
- **Sve ostalo je čitanje** i bezopasno je.

## Sigurno izvršenje (obavezno)

- **Akcije koje troše kredite** (`olx_sponsor_listing`, `olx_set_discount`) NIKAD ne pokreći bez
  izričite potvrde korisnika. Prvo pripremi
  plan sa ID-evima, periodom, tipom obnove i ukupnim troškom, pa sačekaj jasno "izvrši".
- **Prije izdvajanja provjeri stvarnu cijenu** preko `olx_sponsor_price`, jer je cijena
  dinamična; ne oslanjaj se samo na statički cjenovnik.
- **Za dolazak na vrh koristi obnovu, ne brisanje.** Kad nema na stanju, koristi sakrivanje ili
  završavanje, da se sačuva historija i dojmovi.
- **Ako server ne odgovara** (timeout), reci to korisniku i predloži restart lokalnih MCP
  servera, pa nastavi sa savjetom na osnovu dostupnih podataka umjesto da blokiraš.

## Tipičan zadatak: "pripremi N artikala za izdvajanje da se ne dupliraju"

1. `olx_list_listings` (active) i izdvoji koji su već promovisani (ako odgovor nosi tu oznaku),
   ili provjeri pojedinačno `olx_get_listing` za sumnjive.
2. Spoji sa metodom izbora iz `strategija.md` (pojmovi u pretrazi × najgledaniji).
3. Predloži artikle koji nisu već izdvojeni, sa ID-evima i obrazloženjem.
4. Pokaži trošak iz `cjenovnik-i-krediti.md` (ili `olx_sponsor_price`).
5. Sačekaj potvrdu prije `olx_sponsor_listing`.

## API referenca (za alat: CLI/MCP) i parametri izdvajanja

Ako alat radi direktno preko API-ja, baza je `https://api.olx.ba` (drži kao konfigurabilnu
varijablu, jer uz rebrand može doći `api.pik.ba`; nepotvrđeno kada). Svi pozivi preko HTTPS, uz
`Authorization: Bearer {token}`. Login: `POST /auth/login` (username/email, password,
device_name), pa `GET /me` za provjeru pristupa (403 znači da treba odobrenje shop podrške).

### Ključni endpointi

- Oglasi: `GET /listings/:id`, `POST /listings` (kreira DRAFT), `PUT /listings/:id`,
  `POST /listings/:id/publish`, `DELETE /listings/:id`.
- Obnova: `GET /listing/refresh/limits` (vraća `free_limit`, `free_count`, `paid_count`; `free_limit`
  NIJE fiksno 750, na Gold shopu izmjereno 1.800, a `free_count` je ISKORISTENO a ne preostalo),
  `PUT /listings/:id/refresh`.
- Slike: `POST /listings/:id/image-upload`, `image-delete`, `image-main`.
- Status: `POST /listings/:id/finish`, `hide`, `unhide`.
- Katalog korisnika (paginirano, `per_page` 20, svaka stavka ima `refresh_available`, `sponsored`,
  `status`, `visible`): `GET /users/:username/listings?page=N` i varijante finished/inactive/
  expired/hidden.
- Kategorije: `GET /categories`, `GET /category/:id` (ima `listing_fee`, `base_listing_price`,
  `brand_required`, `model_required`, `show_map`, `show_condition`), `GET /categories/:id/
  attributes`, `.../brands`, `.../brands/:brand_id/models`, `GET /categories/suggest?keyword=`,
  `GET /categories/find?name=`.
- Lokacije: `GET /countries` (BiH = 49, code BA), `GET /cities`, `GET /cities/:id`.
- Izdvajanje: `GET /listings/:id/sponsore/price` (vrati PRVO; odgovor `{search, refresh, locations,
  extras, total}`), `POST /listings/:id/sponsore` (troši kredite). Akcijska cijena:
  `POST /listings/:id/discount` (`{price, days}`, days 3/7/30), `.../discount/finish`.

### Parametri izdvajanja (sponsore)

- `type`: 0 bez izdvajanja, 1 klasično, 2 premium.
- `days`: 1, 2, 3, 5, 7, 14, 21, 30. Provjereno na živom API-ju: 15 vraća 422
  `"Broj dana nije validan"`, a 14 i 21 rade normalno.
- `refresh_every`: 0, 3, 6, 8, 24 (sati). Provjereno: interval od 6 sati RADI, a 12 vraća 422
  `"Razmak obnavljanja nije validan"`.
- **`refresh_every` je OBAVEZAN.** Bez njega svaki poziv na `sponsore/price` vraća 422
  `"Polje obnavljanje svakih je obavezno."` Za izdvajanje bez autoobnove pošalji 0.
- `locations`: `["homepage"]` za prikaz i na naslovnici.

### Izmjereni cjenovnik (MixBox, 25.07.2026, type 1)

Cijena je dinamična i razlikuje se po kategoriji, pa je ovo samo polazna tačka. Za oglas
`70073750` (kategorija 1918) i `77556842` (kategorija 1920):

| Kategorija | 7 dana bez obnove | 7 dana + 24h | 14 dana + 24h | 30 dana bez obnove | 30 dana + 24h |
|---|---|---|---|---|---|
| Pernice (2045) | 12 | 18 | | 42 | 63 |
| Zaštita tijela (1918) | 36 | 54 | 99 | 126 | 189 |
| Party (754) | 36 | 54 | | 126 | 189 |
| Zaštita nogu (1920) | 42 | 63 | | 147 | 220 |

Obnova na 24h dodaje pola osnovne cijene, obnova na 8h dodaje 150 posto. Duži period je
jeftiniji po danu: 30 dana izlazi 4,2 kredita dnevno naprema 5,14 za 7 dana. Premium (type 2)
je oko 2,7 puta skuplji od klasičnog.

### Izdvajanje na oglas koji je VEC izdvojen (bitno za planiranje)

Provjereno na MixBox nalogu 25.07.2026: ako oglas ima aktivno izdvajanje, novi poziv
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

### Polja koja se lako pogrešno protumače

- **`available` NE znači zalihu.** Na PIK-u stoji `false` na oglasima čiji artikli imaju
  stotine komada u Shopify-u, a i tuđi oglasi po platformi masovno imaju `false`. Zvanična
  dokumentacija ga ne definiše. Ne koristi ga kao signal o stanju robe.
- **`free_count` je iskorišteno, ne preostalo.** Provjereno: nakon jedne obnove otišlo je sa
  300 na 301. Preostalo se računa kao `free_limit - free_count`.
- **Obnova isteklog oglasa ne vraća vidljivost.** Status pređe sa `expired` na `active` i
  datum se osvježi, ali `visible` ostaje `false` i oglas se ne pojavi u katalogu.
- **`sku_number` postoji samo na pojedinačnom oglasu** (`GET /listings/:id`), nijedna lista ga
  ne vraća. Na MixBox nalogu ga ima manjina oglasa, u tri oblika: `H6412`, `B0714`,
  `CA-B0537-BWA`.
- **Aktivni katalog je `/users/:username/listings` bez sufiksa.** Varijanta sa `/active` vraća
  prazan niz, a `/users/:id/listings` sa numeričkim id-em vraća 404. Za ostala stanja
  (finished, inactive, expired, hidden) prolaze i username i id.

### Životni ciklus oglasa (DRAFT zamka)

Kreiraj (`POST /listings` daje DRAFT, nevidljiv) → upload slika → postavi glavnu sliku →
`publish`. Ako se preskoči publish, oglas ostaje nevidljiv. Uvijek provjeri da je oglas objavljen.

### Zaštite u alatu (obavezno)

- Prije `sponsore` i `discount` uvijek dohvati cijenu (`sponsore/price`) i traži potvrdu.
- Prije bulk obnove provjeri `refresh/limits` i ne prelazi `free_limit - free_count` koje taj
  nalog stvarno vraća (ne pretpostavljaj broj).
- Ne briši radi re-rankinga; koristi refresh ili hide.
- Tokeni u env varijablama ili keychainu, po korisniku, nikad u kodu ili gitu.
- Ne logiraj lične podatke kupaca; ne izvozi cijene kredita ni marže u materijale za klijente.
