# Sta ovaj sistem moze

Ovaj fajl je GENERISAN iz koda, pravi ga `bun scripts/popis-mogucnosti.mjs`. Ne dira se rukom: rucna izmjena ovdje nestaje na sljedecem pokretanju generatora. Za objasnjenje obicnim jezikom procitaj `sta-sistem-radi.md` u istoj mapi.

## Sazetak

- MCP alata: 62, od toga klijentu dostupno: 46
- MCP resursa: 8
- CLI komandi: 63
- Zakazanih poslova: 12
- Postavki: 31
- Skillova: 11
- Podagenata: 6

## MCP alati

| Ime | Sta radi | Profil | Vrsta | Trazi potvrdu |
| --- | --- | --- | --- | --- |
| olx_account_alerts | Brza provjera naloga (4 API poziva): paket pri isteku, saldo kredita ispod praga, slabo iskoristena kvota obnova pred resetom, istekli oglasi za reaktivaciju, popunjenost limita objave po grupama kategorija. | oba | citanje |  |
| olx_arhiva | Lokalna arhiva artikala skinutih sa shopa (olx_skini_artikal). | oba | citanje |  |
| olx_bulk_price | Mijenja cijenu na vise oglasa odjednom. | oba | trosak ili nepovratno | da |
| olx_bulk_sklanjanje | Sklanja vise oglasa odjednom: radnja 'hide' kad se artikal vraca na stanje, 'finish' kad je prodan (ostaje u historiji profila). | oba | trosak ili nepovratno | da |
| olx_canton_cities | Gradovi u datom kantonu. | samo admin | citanje |  |
| olx_categories | Top-level kategorije. Za stabilan snapshot citaj resource olx://categories. | samo admin | citanje |  |
| olx_category | Jedna kategorija: listing_fee (krediti koje objava oglasa kosta u ovoj kategoriji; 0 = besplatna objava), base_listing_price (osnovna cijena oglasa u kreditima), brand_required, model_required, show_map, show_condition. | samo admin | citanje |  |
| olx_category_attributes | Atributi (forme) kategorije: id, naziv, opcije, da li je obavezno. Potrebno za validan create payload. | oba | citanje |  |
| olx_category_brands | Brendovi u kategoriji (za vozila i sl.). | samo admin | citanje |  |
| olx_category_children | Podkategorije date kategorije. | samo admin | citanje |  |
| olx_category_models | Modeli za dati brend u kategoriji. Daje model_id za create payload. | samo admin | citanje |  |
| olx_cities | Entiteti/regije (sadrze kantone). Za stabilan snapshot citaj resource olx://locations. | samo admin | citanje |  |
| olx_city | Detalji grada (lat, lon, zip, canton_id, state_id). Daje city_id za create payload. | samo admin | citanje |  |
| olx_competitor_report | Analiza tudjeg naloga iz javnih podataka u jednom pozivu: paket, aktivnost, ocjene, broj aktivnih i zavrsenih oglasa, cijene (min/median/max), udio sponzorisanih i akcija, kadenca obnove. | samo admin | citanje |  |
| olx_countries | Lista drzava (BiH = id 49). Za stabilan snapshot citaj resource olx://locations. | samo admin | citanje |  |
| olx_country_states | Entiteti/regije drzave sa kantonima (isti oblik kao olx_cities). Za stabilan snapshot citaj resource olx://locations. | samo admin | citanje |  |
| olx_create_listing | Kreira oglas kao DRAFT, nije vidljiv dok se ne objavi (olx_publish_listing). | oba | upis | da |
| olx_delete_image | Brise sliku sa oglasa po imageId. | oba | trosak ili nepovratno |  |
| olx_draft_check | Validira nacrt PRIJE olx_create_listing: naslov (max 65), obavezni atributi kategorije i dozvoljene vrijednosti, kvaliteta (podnaslov, opis, cijena) i naknada objave u kreditima. | oba | citanje |  |
| olx_find_category | Pronalazi kategoriju po imenu i vraca puni path. | samo admin | citanje |  |
| olx_find_my_listing | Pronalazi JEDAN poznat oglas po slobodnom opisu kad korisnik ne zna ID ("prodao sam crvene cipele"). | oba | citanje |  |
| olx_finish_discount | Zavrsava aktivnu akcijsku cijenu na oglasu. | oba | upis |  |
| olx_finish_listing | Oznacava oglas kao zavrsen/prodano (cuva historiju i statistiku). | oba | trosak ili nepovratno |  |
| olx_generiraj_sliku (uslovno) | Iz poslane fotografije ili slike sa objavljenog oglasa napravi novu sliku artikla: cist prostor i ravno svjetlo. | oba | upis | da |
| olx_get_listing | Dohvata pojedinacni oglas po ID-u (tudji oglas samo u admin profilu; nosi views i questions). | oba | citanje |  |
| olx_hide_listing | Sakriva oglas (preporuceno umjesto brisanja kad artikla nema na stanju). | oba | upis |  |
| olx_izuzeca | Spisak oglasa koje vlasnik ne zeli da se automatski obnavljaju i/ili izdvajaju. | oba | upis |  |
| olx_limit_slika | Dnevni plafon generisanja slika (inace iz OLX_SLIKA_MAX_DNEVNO ili fallback 10). | samo admin | upis |  |
| olx_list_listings | Lista oglasa po stanju, svojih ili tudjih. | oba | citanje |  |
| olx_listing_limits | Limiti broja oglasa po grupama kategorija (cars, real-estate, other). | oba | citanje |  |
| olx_listing_report | Izracunata analiza jednog oglasa (tudji samo u admin profilu): pregledi ukupno i dnevno, pitanja, starost, dana od zadnje obnove, broj slika i popunjenih atributa, duzina naslova i podnaslov, cijena i akcija, sponzorstvo (na nasem oglasu i placeni detalji). | oba | citanje |  |
| olx_mrtvi_oglasi | Oglasi koji nisu dobili nijedan NOV pregled u zadanom periodu, racunato iz razlike dnevnih snapshota. | oba | citanje |  |
| olx_onboarding_report | Prva analiza shopa u jednom pozivu: neiskoristene besplatne obnove i dnevni tempo do reseta kvote, oglasi sa nedostacima, svjezina, pregledi i upiti, rangirana lista prvih poteza. | oba | citanje |  |
| olx_opisi_sliku (uslovno) | Posalje sliku sa diska jeftinom vision modelu i vrati tekstualni opis proizvoda. | oba | citanje |  |
| olx_pozadina (uslovno) | Pozadina koju recept pozadina-klijenta koristi umjesto bijelog studija, da svi oglasi imaju isti prostor. | oba | upis |  |
| olx_prijedlozi | Cita prijedloge koje je napravila sedmicna analiza. | oba | citanje |  |
| olx_profile_stats | Pregled vlastitog naloga u jednom pozivu: paket i njegov istek (shop.ends_at), krediti, iskoristenost kvote obnova (bez roka reseta, za rok je olx_refresh_limits), oglasi po stanjima, cijene, udio sponzorisanih, neobnovljeni oglasi, te objava_limit: popunjenost limita broja oglasa po grupama kategorija (preostalo, procenat, status slobodno/blizu_limita/dostignut). | oba | citanje |  |
| olx_publish_listing | Objavljuje DRAFT oglas (postaje aktivan i vidljiv) i vraca `link` na objavljeni oglas, koji obavezno posalji korisniku. | oba | upis | da |
| olx_reaktiviraj_oglas | Vraca ZAVRSEN oglas u zivot objavom NOVOG oglasa sa istim podacima i originalnim slikama (API ne moze zavrsen oglas vratiti u aktivne; pregledi i pitanja se ne prenose). | oba | upis | da |
| olx_refresh_bulk | Obnavlja aktivne oglase kojima je obnova dostupna, uz postivanje mjesecnog limita. | oba | upis | da |
| olx_refresh_limits | Limiti besplatne obnove sa naloga (free_limit, free_count, listing_count). | oba | citanje |  |
| olx_refresh_listing | Obnavlja oglas (svjez datum, dize rang u kategoriji). | oba | upis |  |
| olx_ritam_obnova | Kojim ritmom se oglasi automatski obnavljaju. | oba | upis |  |
| olx_sablon_opisa | Cita opise vlastitih oglasa i javlja koji se zavrsni blokovi i fraze STVARNO ponavljaju, sa brojem pojava. | samo admin | citanje |  |
| olx_set_discount | Postavlja akcijsku cijenu (premium, TROSI KREDITE). confirm=true obavezno za izvrsenje. days: 3,7,30. | oba | trosak ili nepovratno | da |
| olx_set_main_image | Postavlja glavnu sliku oglasa po imageId (id slike iz odgovora uploada). | oba | upis |  |
| olx_skini_artikal | Kad artikla nema na stanju a vratice se: sacuva oglas i ORIGINALNE slike lokalno, pa sakrije oglas. | oba | upis |  |
| olx_sponsor_effect | Mjeri efekat izdvajanja oglasa iz dnevnih snapshota pregleda (.olx-pik/snapshots, pravi ih CLI 'stats snapshot'): pregledi dnevno prije, tokom i poslije perioda, plus faktor rasta. | samo admin | citanje |  |
| olx_sponsor_listing | Izdvaja oglas i TROSI KREDITE. | oba | trosak ili nepovratno | da |
| olx_sponsor_plan | Izracuna plan izdvajanja: kandidati (zadani ID-evi ili najstariji neizdvojeni aktivni), cijena svakog sa API-ja, raspored po danima do budzeta. | oba | upis |  |
| olx_sponsor_price | Dohvata cijenu izdvajanja u kreditima. NE trosi kredite. Uvijek pozovi ovo prije izdvajanja. | oba | citanje |  |
| olx_stock_slika (uslovno) | Za NOV, ZAPAKOVAN artikal poznatog modela (telefon, tehnika) nadje referentne fotografije na Wikimedia Commonsu i preuzme ih, da korisnik izabere jednu. | oba | upis | da |
| olx_suggest_category | Prijedlog kategorije po naslovu (keyword). Vraca i broj oglasa. | oba | citanje |  |
| olx_unhide_listing | Vraca skriveni oglas u pretragu. | oba | upis |  |
| olx_update_listing | Mijenja polja oglasa. | oba | upis | da |
| olx_upload_images | Dodaje slike na oglas (multipart, polje images[]; API ne prihvata image_url). | oba | upis |  |
| olx_user_profile | Javni profil tudjeg ili svog shopa po USERNAME-u: paket (Gold/Platinum), poslovni podaci, ocjene, medalje, vrijeme odgovora i datum registracije. | samo admin | citanje |  |
| olx_vrati_artikal | Vraca ranije skinut artikal (id = originalni broj, vidi olx_arhiva lista). | oba | upis | da |
| olx_whoami | Vraca trenutni nalog. Koristi za test pristupa API-ju. | oba | citanje |  |
| olx_zabiljezi_konkurenta | Interno zapisi username drugog prodavca kojeg je korisnik sam spomenuo. | samo klijent | upis |  |
| olx_zabiljezi_saznanje | Upisi jednu recenicu o neocekivanom ponasanju API-ja ili platforme (nesto radi drugacije od dokumentacije, nova greska, novo ogranicenje). | oba | upis |  |
| olx_zapamti | Trajno zapise sto klijent kaze o sebi i svojim navikama, da se poslije restarta ne izgubi. | oba | upis |  |

Uslovni alati (registruju se samo pod navedenim uslovom):
- **olx_generiraj_sliku**: samo kad je podesen kljuc za generisanje slika (OLX_SLIKA_API_KEY)
- **olx_opisi_sliku**: samo kad je podesen Gemini kljuc za vid (OLX_VID_API_KEY ili OLX_SLIKA_API_KEY)
- **olx_pozadina**: samo kad je podesen kljuc za generisanje slika (OLX_SLIKA_API_KEY)
- **olx_stock_slika**: samo kad je referentna slika sa interneta upaljena po klonu (OLX_STOCK_SLIKE)

## MCP resursi

- `olx://categories` (OLX/PIK stablo kategorija (puni JSON)): Detaljni snapshot cijelog stabla (olx-dokumentacija/categories.json), velik. Za obicnu pretragu kategorije koristi olx://categories-index (CSV). Ovaj puni JSON citaj samo kad trebas polja kojih nema u CSV-u.
- `olx://categories-index` (OLX/PIK index kategorija (CSV, samo gornji nivoi)): CSV sa SAMO gornjim nivoima stabla kategorija (kolone id, parent_id, level, path, name i zastavice brand_required, model_required, has_models, show_condition, listing_fee, base_listing_price); napomena na vrhu kaze koliko je redova prikazano od ukupno. Kategoriju po imenu nadji alatom olx_find_category, spusti se niz stablo alatom olx_category_children <id>, a obavezna polja forme procitaj alatom olx_category_attributes <id>.
- `olx://knowledgebase` (OLX/PIK AI Knowledgebase): Interni vodic: API referenca, pravila vidljivosti i dijagnostika. Procitaj prije savjetovanja.
- `olx://locations` (OLX/PIK lokacije (puni JSON)): Detaljni snapshot lokacija (olx-dokumentacija/locations.json): drzave, entiteti, gradovi sa lat/lon/zip/state. Za obican pronalazak country_id/city_id koristi olx://locations-index (CSV). Ovaj JSON citaj samo za dodatne detalje.
- `olx://locations-index` (OLX/PIK index lokacija (CSV)): Lagani CSV za PRONALAZAK lokacije: kolone type (country|city), id, name, code, canton_id. Koristi OVO da nadjes country_id (BiH = 49) i city_id po imenu. Puni JSON (olx://locations) citaj samo za detalje (lat/lon, zip, state).
- `olx://pomoc/{fajl}` (Zvanicni clanak pomoci): Jedan clanak zvanicne pomoci u markdownu. {fajl} je ime fajla iz kolone url/naslova u olx://pomoc-index, npr. cijena-izdvajanja-oglasa-promocije-360014561439.md
- `olx://pomoc-index` (Zvanicna PIK/OLX pomoc (index clanaka, CSV)): Index 52 clanka zvanicne podrske (pomoc.olx.ba): kolone kategorija, sekcija, naslov, azurirano, url. Koristi OVO da nadjes clanak, pa procitaj pojedinacni preko olx://pomoc/<ime-fajla>.md. Zvanicna pomoc je izvor za pravila platforme; gdje se razlikuje od izmjerenog stanja, vazi knowledgebase (olx://knowledgebase).
- `olx://pravila-brojeva` (OLX/PIK pravila brojeva (prednost nad svim referencama)): Razdvaja brojeve na tri razreda: fiksne na platformi, vezane za nalog (kvota obnova, krediti) i vezane za kategoriju (cijena izdvajanja). Kad je bilo koja druga referenca u sukobu sa ovim fajlom, vazi ovaj. Procitaj PRIJE nego izgovoris ijedan broj o trosku ili kvoti.

## CLI komande

### auth

- `auth`: Autentifikacija
- `auth login`: Login kredencijalima iz env, ispisuje token

### category

- `category`: Kategorije i atributi
- `category attributes <id>`: Atributi kategorije
- `category brands <id>`: Brendovi u kategoriji
- `category children <id>`: Podkategorije date kategorije
- `category dump`: Povlaci cijelo stablo kategorija i snima u JSON (jednokratni snapshot za repo/MCP) (2 opcija)
  - `--out <path>`: izlazni JSON fajl
  - `--depth <n>`: maksimalna dubina stabla
- `category find <name>`: Pronadji kategoriju po imenu (vraca puni path)
- `category get <id>`: Jedna kategorija (sadrzi listing_fee, base_listing_price, brand/model_required)
- `category index`: Generise lagani CSV index iz postojeceg categories.json (bez API poziva) (2 opcija)
  - `--from <path>`: ulazni JSON
  - `--out <path>`: izlazni CSV
- `category list`: Top-level kategorije
- `category models <id> <brandId>`: Modeli za brend u kategoriji
- `category suggest <keyword>`: Prijedlog kategorije po naslovu

### discount

- `discount`: Akcijska cijena (premium, trosi kredite)
- `discount finish <id>`: Zavrsava aktivnu akcijsku cijenu
- `discount set <id>`: Postavlja akcijsku cijenu (TROSI KREDITE; trazi --yes) (3 opcija)
  - `--price <price>`: nova cijena
  - `--days <3|7|30>`: trajanje
  - `--yes`: potvrda troska

### listings

- `listings`: Upravljanje oglasima
- `listings create`: Kreira oglas iz JSON fajla (ostaje DRAFT dok se ne objavi) (3 opcija)
  - `--file <path>`: JSON fajl sa poljima oglasa
  - `--publish`: objavi odmah nakon kreiranja
  - `--yes`: potvrda za naplatne kategorije (vozila, nekretnine, poslovi)
- `listings finish <id>`: Oznacava oglas kao zavrsen/prodano
- `listings get <id>`: Detalji oglasa
- `listings hide <id>`: Sakriva oglas (umjesto brisanja kad nema na stanju)
- `listings images`: Slike oglasa
- `listings images add <id>`: Dodaje slike na oglas (URL-ovi i/ili lokalni fajlovi) (2 opcija)
  - `--url <url...>`: jedan ili vise URL-ova slika
  - `--file <path...>`: jedan ili vise lokalnih fajlova (multipart; format NEPOTVRDJEN)
- `listings images main <id> <imageId>`: Postavlja glavnu sliku oglasa
- `listings images rm <id> <imageId>`: Brise sliku sa oglasa
- `listings limits`: Limiti broja oglasa po grupama kategorija (cars, real-estate, other)
- `listings ls`: Lista oglasa (4 opcija)
  - `--state <state>`: active|finished|inactive|expired|hidden
  - `--user <user>`: username ili id (default: ulogovani)
  - `--all`: prelistaj sve stranice (samo active)
  - `--page <n>`: broj stranice
- `listings publish <id>`: Objavljuje DRAFT oglas (1 opcija)
  - `--yes`: potvrda za naplatne kategorije (vozila, nekretnine, poslovi)
- `listings reaktiviraj <id>`: Vraca zavrsen oglas u zivot objavom NOVOG oglasa sa istim podacima i slikama (pregledi se ne prenose) (4 opcija)
  - `--cijena <n>`: cijena novog oglasa u KM (obavezna kad original nema citljivu cijenu)
  - `--yes`: potvrda eventualne cijene objave u naplatnoj kategoriji
  - `--potvrdi-robu`: potvrda da roba nije sporna, kad provjera pravila robe zaustavi objavu
  - `--mjeri-publish`: MJERENJE (samo admin, samo besplatna kategorija): pozovi publish nad zavrsenim oglasom i ispisi sta API vrati
- `listings rm <id>`: Brise oglas (nepovratno; radije koristi hide/finish) (1 opcija)
  - `--yes`: potvrda brisanja
- `listings unhide <id>`: Vraca skriveni oglas
- `listings update <id>`: Izmjena oglasa (5 opcija)
  - `--file <path>`: JSON sa poljima za izmjenu
  - `--title <title>`
  - `--price <price>`
  - `--description <description>`
  - `--yes`: potvrda kad izmjena prebacuje oglas u naplatnu kategoriju

### location

- `location`: Lokacije (drzave, gradovi, kantoni)
- `location canton-cities <id>`: Gradovi u kantonu
- `location cities`: Entiteti/regije
- `location city <id>`: Grad po ID (lat, lon, zip, canton_id, state_id)
- `location countries`: Drzave (BiH = id 49)
- `location dump`: Povlaci lokacije (drzave, entiteti, kantoni->gradovi) i snima u JSON (jednokratni snapshot) (2 opcija)
  - `--out <path>`: izlazni JSON fajl
  - `--no-cities`: preskoci obilazak kantona za listu gradova
- `location index`: Generise lagani CSV index lokacija iz postojeceg locations.json (bez API poziva) (2 opcija)
  - `--from <path>`: ulazni JSON
  - `--out <path>`: izlazni CSV
- `location states`: Entiteti (country-states)

### match

- `match`: Spaja PIK oglase sa vanjskim katalogom i njegovom zalihom (6 opcija)
  - `--katalog <fajl>`: JSON ili CSV katalog (kolone: sifra, naziv, zaliha, cijena)
  - `--overrides <fajl>`: JSON sa rucnim mapiranjem po PIK id-u
  - `--out <fajl>`: gdje snimiti izvjestaj
  - `--user <user>`: username (default: ulogovani)
  - `--with-sku`: dohvati SKU za svaki oglas (sporo: jedan zahtjev po oglasu)
  - `--min-score <n>`: prag za automatski match

### posao

- `posao`: Zakazani poslovi za cron (bez modela, bez troska kredita)
- `posao backup`: Posalji klijentsko stanje na daljinu (pamcenje, izuzeca, audit, snapshoti) (6 opcija)
  - `--suho`: ispisi sta bi islo i sta se preskace, bez ijednog upisa
  - `--nadzor`: samo javi kad je zadnji put stvarno poslano na daljinski
  - `--samo-provjeri`: uporedi klon sa onim sto je stvarno na daljinskom
  - `--vrati`: vrati stanje sa daljinskog u ovaj klon
  - `--potvrdi`: obavezno uz --vrati
  - `--pregazi`: uz --vrati: prepisi i fajlove koji vec postoje
- `posao dnevni`: Dnevna obnova unutar besplatne kvote i poruka klijentu na Telegram (2 opcija)
  - `--suho`: izracunaj i ispisi, ali ne obnavljaj i ne salji
  - `--bez-slanja`: izvrsi obnove ali ne salji Telegram poruku
- `posao posalji [tekst]...`: Posalji tekst na Telegram: klijentu u grupu, ili adminu uz --admin (2 opcija)
  - `--stdin`: procitaj tekst sa standardnog ulaza umjesto iz argumenta
  - `--admin`: posalji u admin DM umjesto u grupu klijenta
- `posao sedmicni`: Sedmicni pregled: prirast pregleda, sta raste, sta miruje i prijedlozi (2 opcija)
  - `--suho`: ispisi ali ne salji
  - `--dana <n>`: raspon poredjenja u danima

### refresh

- `refresh`: Obnova oglasa (svjezina)
- `refresh all`: Bulk obnova aktivnih oglasa kojima je obnova dostupna (3 opcija)
  - `--user <user>`: username ili id (default: ulogovani)
  - `--limit <n>`: maksimalan broj obnova u ovom pokretanju
  - `--yes`: potvrda za izvrsenje
- `refresh limits`: Mjesecni limiti obnove
- `refresh one <id>`: Obnavlja jedan oglas

### sponsor

- `sponsor`: Izdvajanje (trosi kredite)
- `sponsor apply <id>`: Izdvaja oglas (TROSI KREDITE; trazi --yes) (6 opcija)
  - `--type <0|1|2>`: 0 bez, 1 klasicno, 2 premium
  - `--days <n>`: dana izdvajanja: 1,2,3,5,7,14,21,30
  - `--refresh-every <h>`: autoobnova u satima: 0,3,6,8,24
  - `--homepage`: ukljuci naslovnicu
  - `--locations <loc...>`: dodatne lokacije izdvajanja (dokumentovana je samo "homepage")
  - `--yes`: potvrda troska
- `sponsor plan`: Raspored izdvajanja kroz dane (plan fajl, izvrsenje uz --yes)
- `sponsor plan izvrsi`: Izvrsava termine dospjele do danas (TROSI KREDITE; bez --yes je probni prikaz) (3 opcija)
  - `--file <putanja>`: putanja plana
  - `--datum <YYYY-MM-DD>`: racunaj kao da je taj datum (za provjeru)
  - `--yes`: potvrda troska
- `sponsor plan napravi`: Pravi predlog plana: dohvata cijene (ne trosi) i rasporedjuje ih u budzet (10 opcija)
  - `--budzet <n>`: koliko kredita ukupno smije otici na ovaj plan
  - `--dana <n>`: kroz koliko dana se raspored siri
  - `--type <0|1|2>`: 0 bez, 1 klasicno, 2 premium
  - `--trajanje <n>`: koliko dana traje jedno izdvajanje: 1,2,3,5,7,14,21,30
  - `--refresh-every <h>`: autoobnova u satima: 0,3,6,8,24
  - `--homepage`: ukljuci naslovnicu
  - `--broj-oglasa <n>`: koliko oglasa najvise razmatrati
  - `--oglasi <ids>`: izricit spisak ID-jeva, odvojen zapezom (preskace izbor po svjezini)
  - `--user <user>`: username (default: ulogovani)
  - `--file <putanja>`: gdje se snima plan
- `sponsor plan prikazi`: Ispisuje trenutni plan i sta je od njega izvrseno (1 opcija)
  - `--file <putanja>`: putanja plana
- `sponsor price <id>`: Cijena izdvajanja (ne trosi kredite) (5 opcija)
  - `--type <0|1|2>`: 0 bez, 1 klasicno, 2 premium
  - `--days <n>`: dana izdvajanja: 1,2,3,5,7,14,21,30
  - `--refresh-every <h>`: autoobnova u satima: 0,3,6,8,24
  - `--homepage`: ukljuci naslovnicu
  - `--locations <loc...>`: dodatne lokacije izdvajanja (dokumentovana je samo "homepage")

### stats

- `stats`: Statistika, analize i snapshoti (ne trosi kredite)
- `stats alarmi`: Brza provjera naloga: paket, krediti, kvota, istekli (2 opcija)
  - `--krediti-min <n>`: prag salda kredita
  - `--paket-dana <n>`: alarm kad paket istice za manje od N dana
- `stats efekat <id>`: Efekat izdvajanja iz dnevnih snapshota: pregledi dnevno prije/tokom/poslije (2 opcija)
  - `--od <ts>`: pocetak perioda (unix sekunde); default iz aktivnog izdvajanja
  - `--do <ts>`: kraj perioda (unix sekunde)
- `stats konkurent <username>`: Izvjestaj o tudjem nalogu iz javnih podataka (1 opcija)
  - `--top-views <n>`: broj top oglasa za detaljni pregled
- `stats konkurent-promjena <username>`: Razlika izmedju dva zadnja snimka konkurenta
- `stats konkurent-snimi <username>`: Snimi stanje konkurenta u .olx-pik/konkurenti (za sedmicno poredjenje)
- `stats konkurent-telefon <username>`: Telefon kandidata iz javnog teksta (opis shopa i oglasa); API ga ne vraca kao polje (1 opcija)
  - `--broj-oglasa <n>`: koliko najskorijih aktivnih oglasa provjeriti uz opis shopa
- `stats oglas <id>`: Izracunata analiza jednog oglasa (naseg ili tudjeg)
- `stats onboarding`: Prva analiza za klijenta: neiskoristene obnove, higijena oglasa, ucinak i prvi potezi (3 opcija)
  - `--md`: markdown za slanje klijentu umjesto JSON-a
  - `--telegram`: kratka verzija za jednu Telegram poruku
  - `--bez-snapshota`: ne koristi dnevni snapshot (bez higijene i ucinka)
- `stats profil`: Kompaktna statistika vlastitog profila (2 opcija)
  - `--views <mode>`: none|sample|snapshot
  - `--sample-size <n>`: velicina uzorka za sample
- `stats snapshot`: Dnevni snimak pregleda SVIH aktivnih oglasa u .olx-pik/snapshots (sporo: jedan zahtjev po oglasu; za cron, budzet po pokretanju, nastavlja se preko vise pokretanja dok se katalog ne obidje cio)

### telegram

- `telegram`: Grupe u kojima bot radi (ne trosi kredite)
- `telegram grupe`: Grupe kojima idu izvjestaji
- `telegram grupe dodaj <chatId>`: Dodaj grupu u access.json (idempotentno) (3 opcija)
  - `--admin`: radi nad .claude-runtime-admin umjesto klijentskog runtimea
  - `--trazi-mention`: bot reaguje samo kad ga se oznaci
  - `--allow <ids>`: ko smije pisati botu u toj grupi (zarezom); podrazumijevano isti kao ostale grupe
- `telegram grupe lista`: Ko sve dobija dnevni i sedmicni izvjestaj, i odakle taj id dolazi
- `telegram grupe provjeri`: Je li bot jos u svakoj grupi sa spiska (getChat, ne trosi kredite) (1 opcija)
  - `--javi`: posalji nalaz administratoru
- `telegram grupe ukloni <chatId>`: Ukloni grupu iz access.json (idempotentno) (1 opcija)
  - `--admin`: radi nad .claude-runtime-admin umjesto klijentskog runtimea

### users

- `users`: Javni podaci o korisnicima i shopovima
- `users profile <username>`: Javni profil shopa: paket, poslovni podaci, ocjene, vrijeme odgovora (samo username)

### whoami

- `whoami`: Prikazuje trenutni nalog (test pristupa)

## Zakazani poslovi

| Posao | Strana | Termin | Komanda | Windows blizanac |
| --- | --- | --- | --- | --- |
| ai-runda | ADMIN | nedjeljom 21:00 | `scripts/ai-runda.sh` | nema (namjerno) |
| backup-nadzor | ADMIN | ponedjeljkom 09:00 | `scripts/backup-nadzor.sh` | nema (namjerno) |
| nadzor-flote | ADMIN | svaki dan 06:30 | `bun scripts/nadzor-flote.mjs` | nema (namjerno) |
| onboarding-puller | ADMIN | svakih 3 minuta | `bun scripts/onboarding-puller.mjs` | nema (namjerno) |
| saznanja | ADMIN | svaki dan 08:00 | `scripts/saznanja-pokupi.sh` | nema (namjerno) |
| spomenuti | ADMIN | svaki dan 08:15 | `bun scripts/spomenuti-pokupi.mjs` | nema (namjerno) |
| admin-bot | KLIJENT | stalno, dize se pri prijavi | `bun scripts/telegram-most.mjs admin-bot` | da |
| backup | KLIJENT | svaki dan 08:10 | `bun dist/cli/index.js posao backup` | da |
| dnevno | KLIJENT | svaki dan 07:20 | `bun dist/cli/index.js posao dnevni` | da |
| sedmicno | KLIJENT | ponedjeljkom 07:40 | `bun dist/cli/index.js posao sedmicni` | da |
| sesija | KLIJENT | stalno, dize se pri prijavi | `bun scripts/telegram-most.mjs` | da |
| snapshot | KLIJENT | svaki dan 02:40 | `bun dist/cli/index.js stats snapshot` | da |

ADMIN poslovi nemaju Windows blizanca namjerno: admin masina na Windowsu nije upotrebljiva, pa za te poslove blizanac ni ne postoji.

## Postavke

| Varijabla | Polje | Podrazumijevano | Opis |
| --- | --- | --- | --- |
| CLAUDE_CONFIG_DIR | mcpProfil | admin | Koje alate MCP server registruje. |
| OLX_AUDIT_FILE | auditFile | .olx-pik/audit.jsonl | Putanja audit loga (upisi i troskovi). Van gita, po klonu. |
| OLX_AUDIT_READS | auditReads | ne | Da li se u audit log pisu i citanja (GET). Default ne, da log ostane pregledan. |
| OLX_BASE_URL | baseUrl | https://api.olx.ba |  |
| OLX_BUDZET_LISTE_GRUPNI_MS | budzetListeGrupniMs | 120000 | Budzet vremena za grupne radnje koje se rade uz izricitu potvrdu, gdje je potpunost liste preduslov ispravnosti. |
| OLX_BUDZET_LISTE_KONKURENT_MS | budzetListeKonkurentMs | 20000 | Budzet vremena za obilazak TUDJEG shopa (konkurenta) u serijskom prolazu kroz cijeli Excel spisak kandidata. Vlastiti kljuc namjerno, odvojen od `budzetListeMs`: red kandidata ceka svaki konkurent redom, pa dizanje razgovornog budzeta ne smije usporiti citav obilazak. |
| OLX_BUDZET_LISTE_MS | budzetListeMs | 75000 | Budzet vremena za prelistavanje u alatima koje covjek zove u razgovoru i ceka odgovor. Budzet vremena a ne broj stranica: broj stranica je los posrednik za trajanje, jer ne zna za retry, ne zna da je throttle podesen i ne zna da je API te veceri spor. Racunica: 1 stranica je 20 oglasa i oko 0,57 s (350 ms throttle plus oko 220 ms mreze), pa 75 s budzeta znaci oko 131 stranicu odnosno oko 2620 oglasa. Krov prekoracaja je jedna stranica u letu (20 s timeout puta 5 pokusaja plus backoff), oko 107 s, sto ostaje ispod MCP zida od 300 s (polje `timeout` u .mcp.json). |
| OLX_BUDZET_SNAPSHOT_MS | budzetSnapshotMs | 900000 | Budzet vremena PO POKRETANJU za `stats snapshot` (CLI, cron): koliko dugo smije obilaziti oglase (jedan `getListing` po oglasu) prije nego uredno stane i ostavi nastavak za sljedece pokretanje, upisan u radni fajl (`snapshoti.ts`). Odvojen od `budzetListeMs` jer taj budzet vrijedi za PRELISTAVANJE (paginaciju), a ovaj za sam OBILAZAK vec procitanog spiska ID-eva; MCP zid od 300 s ovdje ne vrijedi, jer `stats snapshot` nije MCP alat nego cron posao bez ikoga da ceka odgovor, pa budzet moze biti izdasniji. Racunica: throttle 350 ms plus mreza daje oko 0,57 s po oglasu, pa 15 minuta (900 000 ms) znaci oko 1580 oglasa po pokretanju. |
| OLX_CLIENT_ID | clientId |  |  |
| OLX_CLIENT_TOKEN | clientToken |  |  |
| OLX_DAN_CIKLUSA_KVOTE | danCiklusaKvote |  | Dan u mjesecu kad se obnavlja kvota besplatnih obnova, 1 do 31. Rezerva za nalog bez shopa: inace se dan cita iz `shop.ends_at` i ovo ostaje prazno. Postavljena vrijednost ima prednost nad izmjerenim danom iz kvota dnevnika, isto kao ciklus (olx://pravila-brojeva). |
| OLX_DEFAULT_CITY_ID | defaultCityId |  |  |
| OLX_DEFAULT_COUNTRY_ID | defaultCountryId |  | Podrazumijevana lokacija za objavu, da model ne mora pretrazivati gradove. |
| OLX_DEVICE_NAME | deviceName | izvodi se iz pokrenutog procesa |  |
| OLX_MAX_OGLASA_U_ODGOVORU | maxOglasaUOdgovoru | 500 | Najveci broj oglasa koji `olx_list_listings` u grani `all` smije staviti u JEDAN odgovor. Iznad toga se katalog isporucuje u komadima (parametar `komad`), umjesto da se tiho sijece ili da se odgovor odbije (deepseek-nalazi.md, tabela oko linije 110). Izmjereno: 120 oglasa u kompaktnom obliku je 6.135 tokena, a CSV je oko 60% jeftiniji, dakle otprilike 20 tokena po oglasu. 500 oglasa je time oko 10.000 tokena, cetvrtina do trecina cijelog prefiksa jedne sesije (danas oko 34.000 do 40.000 tokena) za JEDAN odgovor jednog alata. |
| OLX_MAX_RETRIES | maxRetries | 4 |  |
| OLX_MAX_SPEND_PER_DAY | maxSpendPerDay | 0 | Tvrdi dnevni plafon potrosnje u kreditima. 0 znaci bez plafona. |
| OLX_MAX_STAVKI_U_ODGOVORU | maxStavkiUOdgovoru | 200 | Prag reza za spiskove u odgovoru grupnih alata (olx_bulk_price, olx_bulk_sklanjanje, olx_refresh_bulk): koliko stavki kandidata/gresaka/neaktivnih smije stati u JEDAN odgovor. Odvojen od `maxOglasaUOdgovoru`, jer taj prag nosi racunicu za PUN oglas u kompaktnom CSV obliku (olx_list_listings), a ovdje su stavke laksi objekti ({id, title} ili {id, greska}). Nije izlozen kao parametar seme alata (za razliku od operativnih `limit` polja koja biraju KOLIKO oglasa se stvarno mijenja): ovo je tehnicki osigurac protiv velikog JSON odgovora, ne poslovna odluka koju poziva bira po pozivu, pa ostaje plafon u okruzenju. Rez je uvijek vidljiv: uz odsjecenu listu ide broj koliko je stvarno bilo (src/core/obuhvat.ts). |
| OLX_MAX_STRANICA_LISTE | maxStranicaListe | 5000 | OSIGURAC, ne podesavanje brzine: jedini zadatak mu je da pokvaren `last_page` sa API-ja ne vrti prelistavanje beskonacno. 5000 stranica je 100 000 oglasa, iznad svakog realnog kataloga, pa se u normalnom radu nikad ne pali. |
| OLX_MAX_TRAJANJE_SNAPSHOT_PROLAZA_MS | maxTrajanjeSnapshotProlazaMs | 172800000 | Tvrda granica (ms) koliko NAJDUZE smije trajati jedan PROLAZ `stats snapshot` kroz cijeli katalog, mjereno od pocetka prolaza upisanog u radni fajl (ne od pocetka jednog pokretanja). Prolaz obuhvata spisak ID-eva zamrznut na pocetku (da snapshot ostane koherentan snimak jednog trenutka), pa predug prolaz unosi gresku ogranicenu upravo ovom granicom. Kad je granica premasena, radni fajl se ODBACUJE (ne dovrsava se) i prolaz krece iznova. Konzervativna vrijednost, ZNATNO ispod 14 dana: `mrtviOglasi` (stats.ts) i CLI `stats alarmi` prijavljuju mrtve oglase tek nad periodom od najmanje 14 dana, pa razmazan prolaz do 48 sati ostaje mali dio tog prozora i ne kvari racun vidljivo. |
| OLX_MCP_PROFILE | mcpProfil | admin | Koje alate MCP server registruje. |
| OLX_MIN_REQUEST_INTERVAL_MS | minRequestIntervalMs | 350 |  |
| OLX_PASSWORD | password |  |  |
| OLX_POSAO_429_POKUSAJA | posao429Pokusaja | 6 | Koliko PROSIRENIH pokusaja (povrh `maxRetries`) smije potrositi ZAKAZAN POSAO (`stats snapshot`, `posao dnevni`) na 429, kroz `withStrpljenje429` (strpljenje.ts). Vazi SAMO za te cron tokove gdje niko ne ceka odgovor uzivo: MCP alat ni Telegram bot nikad ne ulaze u taj scope, jer klijent u zivom razgovoru ne smije cekati minutama. |
| OLX_POSAO_429_UKUPNO_MS | posao429UkupnoMs | 600000 | Kumulativni plafon (ms) koliko NAJDUZE zakazan posao smije cekati na 429 unutar JEDNOG pokretanja, povrh globalnog backoffa. Mora ostati ISPOD `budzetSnapshotMs` (900000 ms), da svakom pokretanju ostane vremena da posao stvarno makne s mjesta i upise radni fajl, umjesto da cijeli budzet pokretanja ode na cekanje jednog upornog 429. |
| OLX_SESIJA_TIP | mcpProfil | admin | Koje alate MCP server registruje. |
| OLX_SNAPSHOT_PROREDJIVANJE_GUSTINA_DANA | snapshotProredjivanjeGustinaDana | 7 | Iznad praga starosti se cuva samo prvi (najstariji) snapshot u svakom bloku od ovoliko dana (npr. 7 = priblizno sedmicno). Vidi `proredjiStareSnapshote` (snapshoti.ts) za tacno pravilo. |
| OLX_SNAPSHOT_PROREDJIVANJE_PRAG_DANA | snapshotProredjivanjePragDana | 90 | Iznad ove starosti (dana) se dnevni snapshoti pregleda (`views-YYYY-MM-DD.json`) vise ne cuvaju za svaki dan, nego prorjeduju na `snapshotProredjivanjeGustinaDana` (funkcija `proredjiStareSnapshote`, snapshoti.ts). Iznad ove granice dnevna preciznost vec izgubi smisao za postojecu analizu (`mrtviOglasi` trazi 14 dana, efekat izdvajanja do ~30), a fajl po danu na velikom katalogu je krupan i sve ih nosi backup stanja (`src/core/backup-spisak.ts`). |
| OLX_TIMEOUT_MS | timeoutMs | 20000 |  |
| OLX_TOKEN | token |  |  |
| OLX_USERNAME | username |  |  |

## Varijable okruzenja u cijelom repou

Ukupno 113 varijabli okruzenja pominje se u kodu ili u `.env.example`, od toga 104 cini konfiguraciju klona.

Ostale dolaze iz okoline (harness sesije, plugin loader, proxy) i u `.env.example` namjerno ne stoje: klijent ih ne postavlja rukom. Zato se prazna kolona kod njih ne racuna kao propust.

Varijable koje kod cita a kojih nema u `.env.example` (moguc propust u primjeru, klijent ne vidi da postoje):

- OLX_PODSJETNIK_RESURSI_ROK_MS
- OLX_SESIJA_
- OLX_SNAPSHOT_U_TOKU_FILE
- OLX_TEST_IMGLY

Varijable koje su u `.env.example` a kod ih nigdje ne cita (moguc visak ili zastarjela varijabla):

Nema takvih.

| Varijabla | Odakle | Broj fajlova | Fajlovi | U .env.example |
| --- | --- | --- | --- | --- |
| ANTHROPIC_API_KEY | daje okolina | 4 | scripts/claude-ds.mjs, scripts/deepseek-proba.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs |  |
| ANTHROPIC_AUTH_TOKEN | daje okolina | 4 | scripts/claude-ds.mjs, scripts/deepseek-proba.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs |  |
| ANTHROPIC_BASE_URL | daje okolina | 4 | scripts/claude-ds.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs, scripts/proba-kanala.mjs |  |
| ANTHROPIC_CUSTOM_MODEL_OPTION | daje okolina | 1 | scripts/lib/sesija.mjs |  |
| ANTHROPIC_DEFAULT_HAIKU_MODEL | daje okolina | 3 | scripts/claude-ds.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs |  |
| ANTHROPIC_MODEL | daje okolina | 4 | scripts/claude-ds.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs, scripts/proba-kanala.mjs |  |
| CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC | daje okolina | 1 | scripts/provjeri-klon.mjs |  |
| CLAUDE_CONFIG_DIR | daje okolina | 6 | deploy/windows/instaliraj-zadatke.ps1, scripts/claude-olx.sh, scripts/kontekst-izvjestaj.mjs, scripts/lib/mcp-profil.test.mjs, scripts/lib/popis-kod.mjs, scripts/lib/popis-okruzenje.mjs | da |
| CLAUDE_PLUGIN_ROOT | daje okolina | 2 | scripts/claude-olx.sh, scripts/lib/sesija.mjs |  |
| DEEPSEEK_ENV_FILE | konfiguracija klona | 1 | scripts/deepseek-proba.mjs | da |
| OLX_AI_USAGE_FILE | konfiguracija klona | 5 | scripts/ai-cijene.mjs, src/core/ai-dnevnik.ts, src/core/backup-spisak.ts, src/core/slika.test.ts, src/core/vid.test.ts | da |
| OLX_ARHIVA_DIR | konfiguracija klona | 3 | src/core/arhiva.test.ts, src/core/arhiva.ts, src/core/client.test.ts | da |
| OLX_AUDIT_FILE | konfiguracija klona | 6 | src/core/audit.test.ts, src/core/audit.ts, src/core/backup-spisak.test.ts, src/core/backup-spisak.ts, src/core/client.test.ts, src/core/config.ts | da |
| OLX_AUDIT_READS | konfiguracija klona | 2 | src/core/client.test.ts, src/core/config.ts | da |
| OLX_BACKUP_PRAG_DANA | konfiguracija klona | 1 | scripts/backup-nadzor.sh | da |
| OLX_BASE_URL | konfiguracija klona | 6 | scripts/lib/mock-olx-server.mjs, scripts/lib/pokreni-cli.mjs, src/core/client.test.ts, src/core/config.test.ts, src/core/config.ts, src/core/link.ts | da |
| OLX_BUDZET_LISTE_GRUPNI_MS | konfiguracija klona | 1 | src/core/config.ts | da |
| OLX_BUDZET_LISTE_KONKURENT_MS | konfiguracija klona | 1 | src/core/config.ts | da |
| OLX_BUDZET_LISTE_MS | konfiguracija klona | 1 | src/core/config.ts | da |
| OLX_BUDZET_SNAPSHOT_MS | konfiguracija klona | 3 | scripts/lib/stats-snapshot.test.mjs, src/core/config.ts, src/core/snapshoti.ts | da |
| OLX_CLIENT_ID | konfiguracija klona | 2 | src/core/config.ts, src/core/index.ts | da |
| OLX_CLIENT_TOKEN | konfiguracija klona | 2 | src/core/config.ts, src/core/index.ts | da |
| OLX_DAN_CIKLUSA_KVOTE | konfiguracija klona | 4 | src/cli/index.ts, src/core/client.test.ts, src/core/config.ts, src/core/stats.ts | da |
| OLX_DEEPSEEK_AUTH_TOKEN | konfiguracija klona | 6 | scripts/claude-ds.mjs, scripts/deepseek-proba.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs, scripts/pripremi-runtime.mjs, scripts/provjeri-klon.mjs | da |
| OLX_DEEPSEEK_BASE_URL | konfiguracija klona | 5 | scripts/claude-ds.mjs, scripts/deepseek-proba.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs, scripts/provjeri-klon.mjs | da |
| OLX_DEEPSEEK_HAIKU_MODEL | konfiguracija klona | 3 | scripts/claude-ds.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs | da |
| OLX_DEEPSEEK_MODEL | konfiguracija klona | 3 | scripts/claude-ds.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs | da |
| OLX_DEEPSEEK_TIMEOUT_MS | konfiguracija klona | 3 | scripts/claude-ds.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs | da |
| OLX_DEFAULT_CITY_ID | konfiguracija klona | 1 | src/core/config.ts | da |
| OLX_DEFAULT_COUNTRY_ID | konfiguracija klona | 1 | src/core/config.ts | da |
| OLX_DEVICE_NAME | konfiguracija klona | 1 | src/core/config.ts | da |
| OLX_GEMINI_BASE_URL | konfiguracija klona | 1 | src/core/gemini.ts | da |
| OLX_IZUZECA_FILE | konfiguracija klona | 2 | src/core/backup-spisak.ts, src/core/izuzeca.ts | da |
| OLX_KLIJENT | konfiguracija klona | 3 | scripts/provjeri-klon.mjs, src/core/git-stanje.test.ts, src/core/git-stanje.ts | da |
| OLX_KLIJENTI_POPIS | konfiguracija klona | 6 | deploy/launchd/ba.codefactory.olx.ADMIN.nadzor-flote.plist, deploy/windows/azuriraj.ps1, scripts/ai-runda.sh, scripts/azuriraj-sve.sh, scripts/backup-nadzor.sh, scripts/lib/klonovi.mjs | da |
| OLX_KLIJENTI_ROOT | konfiguracija klona | 4 | deploy/launchd/ba.codefactory.olx.ADMIN.nadzor-flote.plist, scripts/lib/klonovi.mjs, scripts/lib/klonovi.test.mjs, scripts/nadzor-flote.mjs | da |
| OLX_KLIJENT_AI | konfiguracija klona | 6 | deploy/windows/instaliraj-zadatke.ps1, scripts/ai-runda.sh, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs, scripts/pokreni-klijenta.mjs, scripts/pripremi-runtime.mjs | da |
| OLX_KVOTA_DNEVNIK_FILE | konfiguracija klona | 1 | src/core/kvota-dnevnik.ts | da |
| OLX_MASINA_ALARM_FAJL | konfiguracija klona | 2 | scripts/lib/pritisak-masine.mjs, scripts/lib/pritisak-masine.test.mjs | da |
| OLX_MAX_OGLASA_U_ODGOVORU | konfiguracija klona | 1 | src/core/config.ts | da |
| OLX_MAX_RETRIES | konfiguracija klona | 3 | scripts/lib/pokreni-cli.mjs, src/core/client.test.ts, src/core/config.ts | da |
| OLX_MAX_SPEND_PER_DAY | konfiguracija klona | 4 | scripts/pripremi-runtime.mjs, scripts/provjeri-klon.mjs, src/core/audit.ts, src/core/config.ts | da |
| OLX_MAX_STAVKI_U_ODGOVORU | konfiguracija klona | 1 | src/core/config.ts | da |
| OLX_MAX_STRANICA_LISTE | konfiguracija klona | 2 | scripts/lib/stats-snapshot.test.mjs, src/core/config.ts | da |
| OLX_MAX_TRAJANJE_SNAPSHOT_PROLAZA_MS | konfiguracija klona | 2 | scripts/lib/stats-snapshot.test.mjs, src/core/config.ts | da |
| OLX_MCP_PROFILE | konfiguracija klona | 6 | scripts/kontekst-izvjestaj.mjs, scripts/lib/mcp-profil.test.mjs, scripts/lib/popis-kod.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs, scripts/pripremi-admin-runtime.mjs | da |
| OLX_MIN_REQUEST_INTERVAL_MS | konfiguracija klona | 3 | scripts/lib/pokreni-cli.mjs, src/core/client.test.ts, src/core/config.ts | da |
| OLX_MOST_ADMIN_IDLE_MIN | konfiguracija klona | 2 | scripts/lib/resursi.mjs, scripts/telegram-most.mjs | da |
| OLX_MOST_ADMIN_TG_ID | konfiguracija klona | 6 | deploy/windows/azuriraj.ps1, deploy/windows/instaliraj-zadatke.ps1, scripts/azuriraj-ovaj-klon.mjs, scripts/azuriraj-sve.sh, scripts/instaliraj-cron.sh, scripts/lib/analiza-flote.mjs | da |
| OLX_MOST_IDLE_MIN | konfiguracija klona | 6 | deploy/launchd/ba.codefactory.olx.KLIJENT.sesija.plist, scripts/lib/analiza-flote.mjs, scripts/lib/analiza-flote.test.mjs, scripts/lib/resursi.mjs, scripts/lib/resursi.test.mjs, scripts/telegram-most.mjs | da |
| OLX_MOST_POTEZ_TIMEOUT_MS | konfiguracija klona | 1 | scripts/telegram-most.mjs | da |
| OLX_MOST_RESTART_SAT | konfiguracija klona | 2 | deploy/launchd/ba.codefactory.olx.KLIJENT.sesija.plist, scripts/telegram-most.mjs | da |
| OLX_NADZOR_DIR | konfiguracija klona | 2 | deploy/launchd/ba.codefactory.olx.ADMIN.nadzor-flote.plist, scripts/nadzor-flote.mjs | da |
| OLX_PAMCENJE_FILE | konfiguracija klona | 3 | src/core/backup-spisak.test.ts, src/core/backup-spisak.ts, src/core/pamcenje.ts | da |
| OLX_PASSWORD | konfiguracija klona | 4 | scripts/provjeri-klon.mjs, scripts/provjeri-prompt.sh, src/core/config.ts, src/core/index.ts | da |
| OLX_PODSJETNIK_RESURSI_ROK_MS | konfiguracija klona | 1 | scripts/podsjetnik-resursi.mjs |  |
| OLX_POSAO_429_POKUSAJA | konfiguracija klona | 1 | src/core/config.ts | da |
| OLX_POSAO_429_UKUPNO_MS | konfiguracija klona | 1 | src/core/config.ts | da |
| OLX_POSAO_STANJE_FILE | konfiguracija klona | 2 | src/core/backup-spisak.test.ts, src/core/posao-stanje.ts | da |
| OLX_POZADINA_DIR | konfiguracija klona | 2 | src/core/pozadina.test.ts, src/core/pozadina.ts | da |
| OLX_PRIJEDLOZI_DIR | konfiguracija klona | 2 | src/core/backup-spisak.ts, src/core/prijedlozi.ts | da |
| OLX_PROVJERA_IZDANJA_ROK_MS | konfiguracija klona | 1 | scripts/provjeri-izdanje.mjs | da |
| OLX_PUBLIC_URL | konfiguracija klona | 2 | src/core/link.test.ts, src/core/link.ts | da |
| OLX_RESURSI_DIR | konfiguracija klona | 5 | scripts/lib/resursi.mjs, scripts/lib/resursi.test.mjs, scripts/nadzor-flote.mjs, scripts/resursi.mjs, scripts/telegram-most.mjs | da |
| OLX_RESURSI_INTERVAL_MIN | konfiguracija klona | 1 | scripts/telegram-most.mjs | da |
| OLX_RESURSI_INTERVAL_STRAZA_MIN | konfiguracija klona | 1 | scripts/telegram-most.mjs | da |
| OLX_RESURSI_PRAG_ALARM_SATI | konfiguracija klona | 1 | scripts/telegram-most.mjs | da |
| OLX_RESURSI_PRAG_SLOBODNO_MB | konfiguracija klona | 1 | scripts/telegram-most.mjs | da |
| OLX_RESURSI_PRAG_SWAP_OMJER | konfiguracija klona | 1 | scripts/telegram-most.mjs | da |
| OLX_RITAM_FILE | konfiguracija klona | 1 | src/core/ritam-obnova.ts | da |
| OLX_SESIJA_ | konfiguracija klona | 1 | scripts/telegram-most.mjs |  |
| OLX_SESIJA_BEZ_PTY | konfiguracija klona | 1 | scripts/lib/sesija.mjs | da |
| OLX_SESIJA_INBOX_DANA | konfiguracija klona | 2 | scripts/telegram-most.mjs, src/core/slike-ciscenje.ts | da |
| OLX_SESIJA_TIP | konfiguracija klona | 6 | scripts/kontekst-izvjestaj.mjs, scripts/lib/mcp-profil.test.mjs, scripts/lib/popis-kod.mjs, scripts/lib/popis-okruzenje.mjs, scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs |  |
| OLX_SLIKA_API_KEY | konfiguracija klona | 6 | scripts/lib/popis-kod.mjs, src/core/slika.test.ts, src/core/slika.ts, src/core/vid.test.ts, src/core/vid.ts, src/mcp/server.ts | da |
| OLX_SLIKA_BASE_URL | konfiguracija klona | 1 | src/core/slika.ts | da |
| OLX_SLIKA_DIR | konfiguracija klona | 5 | scripts/telegram-most.mjs, src/core/slika.ts, src/core/slike-ciscenje.test.ts, src/core/slike-ciscenje.ts, src/mcp/server.ts | da |
| OLX_SLIKA_LIMIT_FILE | konfiguracija klona | 2 | src/core/slika-limit.test.ts, src/core/slika-limit.ts | da |
| OLX_SLIKA_MAX_DNEVNO | konfiguracija klona | 5 | src/core/slika-limit.test.ts, src/core/slika-limit.ts, src/core/slika.test.ts, src/core/slika.ts, src/mcp/server.ts | da |
| OLX_SLIKA_MODEL | konfiguracija klona | 2 | src/core/gemini.ts, src/core/slika.ts | da |
| OLX_SLIKE_ODGODA_MIN | konfiguracija klona | 2 | src/core/slike-ciscenje.test.ts, src/core/slike-ciscenje.ts | da |
| OLX_SLIKE_POTROSENE_FILE | konfiguracija klona | 2 | src/core/slike-ciscenje.test.ts, src/core/slike-ciscenje.ts | da |
| OLX_SLIKE_TRAG_FILE | konfiguracija klona | 1 | src/core/slike-trag.ts | da |
| OLX_SNAPSHOT_PROREDJIVANJE_GUSTINA_DANA | konfiguracija klona | 3 | scripts/lib/stats-snapshot.test.mjs, src/core/config.ts, src/core/snapshoti.ts | da |
| OLX_SNAPSHOT_PROREDJIVANJE_PRAG_DANA | konfiguracija klona | 3 | scripts/lib/stats-snapshot.test.mjs, src/core/config.ts, src/core/snapshoti.ts | da |
| OLX_SNAPSHOT_U_TOKU_FILE | konfiguracija klona | 2 | src/core/snapshoti.test.ts, src/core/snapshoti.ts |  |
| OLX_SPOMENUTI_KONKURENTI_FILE | konfiguracija klona | 1 | src/core/spomenuti-konkurenti.ts | da |
| OLX_STANJE_RADNA | konfiguracija klona | 2 | src/core/git-stanje.test.ts, src/core/git-stanje.ts | da |
| OLX_STANJE_REPO | konfiguracija klona | 6 | deploy/windows/instaliraj-zadatke.ps1, scripts/backup-nadzor.sh, scripts/instaliraj-cron.sh, scripts/lib/analiza-flote.mjs, scripts/nadzor-flote.mjs, scripts/provjeri-klon.mjs | da |
| OLX_STANJE_TOKEN | konfiguracija klona | 1 | src/core/git-stanje.ts | da |
| OLX_STANJE_TOKEN_ISTICE | konfiguracija klona | 1 | src/core/git-stanje.ts | da |
| OLX_STOCK_HOSTOVI | konfiguracija klona | 2 | src/core/stock-slika.test.ts, src/core/stock-slika.ts | da |
| OLX_STOCK_SLIKE | konfiguracija klona | 2 | scripts/lib/popis-kod.mjs, src/mcp/server.ts | da |
| OLX_TAG | konfiguracija klona | 5 | deploy/windows/azuriraj.ps1, scripts/azuriraj-ovaj-klon.mjs, scripts/azuriraj-sve.sh, scripts/provjeri-izdanje.mjs, scripts/pusti-u-flotu.mjs | da |
| OLX_TELEFON_API_KEY | konfiguracija klona | 2 | src/core/telefon-ekstrakcija.test.ts, src/core/telefon-ekstrakcija.ts | da |
| OLX_TELEFON_MODEL | konfiguracija klona | 2 | src/core/telefon-ekstrakcija.test.ts, src/core/telefon-ekstrakcija.ts | da |
| OLX_TELEGRAM_ACCESS_FILE | konfiguracija klona | 2 | src/core/telegram-grupe.test.ts, src/core/telegram-grupe.ts | da |
| OLX_TELEGRAM_ACCESS_FILE_ADMIN | konfiguracija klona | 1 | src/core/telegram-grupe.ts | da |
| OLX_TEST_IMGLY | konfiguracija klona | 1 | src/core/slaganje.test.ts |  |
| OLX_TIMEOUT_MS | konfiguracija klona | 2 | src/core/client.test.ts, src/core/config.ts | da |
| OLX_TOKEN | konfiguracija klona | 6 | deploy/windows/instaliraj-zadatke.ps1, scripts/ai-runda.sh, scripts/lib/envfajl.mjs, scripts/lib/mcp-profil.test.mjs, scripts/lib/pokreni-cli.mjs, scripts/lib/sesija.mjs | da |
| OLX_USERNAME | konfiguracija klona | 3 | scripts/provjeri-klon.mjs, src/core/config.ts, src/core/index.ts | da |
| OLX_VID_API_KEY | konfiguracija klona | 6 | scripts/lib/popis-kod.mjs, src/core/telefon-ekstrakcija.test.ts, src/core/telefon-ekstrakcija.ts, src/core/vid.test.ts, src/core/vid.ts, src/mcp/server.ts | da |
| OLX_VID_MAX_DNEVNO | konfiguracija klona | 2 | src/core/vid.test.ts, src/core/vid.ts | da |
| OLX_VID_MODEL | konfiguracija klona | 3 | src/core/gemini.ts, src/core/vid.test.ts, src/core/vid.ts | da |
| PIKGPT_DIR | konfiguracija klona | 1 | scripts/lib/podesavanja.mjs | da |
| PIKGPT_ONBOARDING_KEY | konfiguracija klona | 2 | scripts/lib/podesavanja.mjs, scripts/onboarding-kljuc.mjs | da |
| PIKGPT_PULL_SECRET | konfiguracija klona | 1 | scripts/lib/podesavanja.mjs | da |
| PIKGPT_WORKER_BASE | konfiguracija klona | 2 | scripts/lib/podesavanja.mjs, scripts/onboarding-uzivo.mjs | da |
| TELEGRAM_ADMIN_CHAT_ID | konfiguracija klona | 6 | deploy/windows/azuriraj.ps1, scripts/ai-runda.sh, scripts/azuriraj-sve.sh, scripts/backup-nadzor.sh, scripts/nadzor-flote.mjs, scripts/onboarding-puller.mjs | da |
| TELEGRAM_BOT_TOKEN | konfiguracija klona | 6 | deploy/windows/azuriraj.ps1, deploy/windows/instaliraj-zadatke.ps1, scripts/ai-runda.sh, scripts/azuriraj-sve.sh, scripts/backup-nadzor.sh, scripts/instaliraj-cron.sh | da |
| TELEGRAM_CHAT_ID | konfiguracija klona | 5 | scripts/onboarding-puller.mjs, scripts/provjeri-klon.mjs, src/cli/index.ts, src/core/telegram.test.ts, src/core/telegram.ts | da |
| TELEGRAM_STATE_DIR | konfiguracija klona | 4 | scripts/lib/sesija.mjs, scripts/lib/sesija.test.mjs, scripts/pripremi-runtime.mjs, scripts/proba-kanala.mjs | da |

## Skillovi

| Ime | Cemu sluzi | Okidaci | Samo admin |
| --- | --- | --- | --- |
| olx-analiza-profila | Analiza vlastitog OLX/PIK shopa i savjet sta popraviti: oglasi, cijene, svjezina, sta obnoviti ili izdvojiti. | analiziraj moje oglase, zasto nemam pozive, pregled profila i jos 1 |  |
| olx-cron-obnove | Dnevna obnova oglasa uz ravnomjerno trosenje kvote obnova. | obnovi oglase, dnevna obnova, koliko obnova danas i jos 2 |  |
| olx-izdanje | Zatvaranje posla i puštanje koda klijentima: testovi, CHANGELOG, verzija, tag, prekidač stabilno, ažuriranje flote, evidencija. | završi posao, zatvori ovo, napravi izdanje i jos 6 | da |
| olx-klijent-flow | Zivotni ciklus klijenta CodeFactory usluge: analiza kandidata iz javnih podataka, onboarding sa tokenom, prvi potezi po isplativosti. | analiziraj kandidata, potencijalni klijent, onboarding klijenta i jos 2 |  |
| olx-mcp-setup | Postavljanje OLX/PIK toolkita: token, build, registracija MCP servera, 403 i AUTH problemi, snapshoti kategorija i lokacija. | kako da pokrenem olx, ne radi mi token, olx vraca 403 i jos 1 |  |
| olx-novi-klijent | Kompletna tehnicka postavka novog klijentskog klona, od kloniranja do zivog bota: .env, KLIJENT.md, Telegram runtime za oba bota, cron poslovi, preflight. | novi klijent, postavi klijenta, postavi sistem za i jos 4 |  |
| olx-objava-artikla | Vodjena objava novog oglasa, od slike do objavljenog oglasa: kategorija, obavezni atributi, naslov i opis, cijena, potvrda. | objavi ovo, dodaj artikal, novi oglas i jos 1 |  |
| olx-seo-oglasa | Naslov, podnaslov i format opisa za pretragu. | optimizuj naslove, kljucne rijeci, zasto me nema u pretrazi i jos 2 |  |
| olx-serijski-posao | Posao koji ide kroz mnogo oglasa odjednom: SEO prolaz, ciscenje kataloga, duga lista za objavu kroz vise dana. | prodji kroz sve oglase, sredi cijeli katalog, ocisti katalog i jos 2 | da |
| olx-shopovi-snimci | Obrada Excel snimaka PIK/OLX shopova: razdvajanje po kantonima, poredjenje dva snimka i dopisivanje telefona kandidata. | razdvoji shopove, excel po kantonima, uporedi sa proslim mjesecom i jos 3 |  |
| pik-olx-kreditni-savjetnik | Raspored kredita i izdvajanje oglasa na PIK/OLX: koje artikle, koji period, autoobnova, koliko kosta. | izdvajanje, koliko kredita, koliko da izdvojim i jos 2 |  |

## Podagenti

| Ime | Cemu sluzi | Koje alate smije zvati |
| --- | --- | --- |
| olx-dijagnostika | Dijagnostika zivog pogona ovog klona; simptomi tipa bot ne odgovara, nije stigao jutarnji izvjestaj, trosak skocio, snapshoti stali. | Bash, Read, Grep, Glob |
| olx-konkurent | Samo admin. | mcp__olx-pik__olx_competitor_report, mcp__olx-pik__olx_user_profile |
| olx-korpus | Read-only pretraga dokumentacionog korpusa (PIK pomoc, knowledgebase, API inventar, CSV snapshoti kategorija i lokacija). | Read, Grep, Glob |
| olx-prodaja | Prodajna argumentacija za admina iz dokumentacije repoa; prigovor prospekta, tema pitcha ili poredjenje sa rucnim vodjenjem shopa. | Read, Grep, Glob |
| olx-seo-pisac | Pise prijedlog naslova, podnaslova i opisa za JEDAN oglas. Koristi u serijskom SEO prolazu, jedan poziv po oglasu. | Read |
| olx-trijaza | Odlucuje sta sa jednim slabim oglasom: popraviti, sakriti ili zavrsiti. Koristi u serijskom ciscenju kataloga. | Read |
