# OLX.ba / PIK.ba — AI Knowledgebase za MCP i CLI

> Namjena: jedinstveni izvor istine za alat (MCP server i CLI) kojim tim upravlja OLX/PIK shopovima.
> Ovaj fajl je istovremeno: (1) fajl u Claude projektu, (2) resource koji MCP server izlaže AI-ju, (3) dokumentacija u repou.
> Sve u ovom fajlu je interno za tim. Ne ubacuj cijene kredita, marže ni lične podatke kupaca u materijale namijenjene klijentima.

Izvori i pouzdanost:
- Zvanična API referenca: `api-documentation.olx.ba` (provjereno, juni 2026).
- Zvanični članci podrške: `PIK-pomoc-korpus/` u ovom folderu (52 članka sa pomoc.olx.ba, scrape 26.07.2026.). Pregled u `index.csv`, pojedinačni članci u `clanci/`, recept za osvježavanje u `NALAZI-i-osvjezavanje.md`. Izloženo i kao MCP resursi `olx://pomoc-index` i `olx://pomoc/{fajl}`.
- Pravila brojeva: `pravila-brojeva.md` (MCP resource `olx://pravila-brojeva`) ima prednost nad ovim fajlom kad je u pitanju bilo koji broj.
- Interni vodič o rangiranju i pretrazi (AND-podudaranje naslova, svježina, izdvajanje).
- Interni vodič za vlasnike shopova (paketi, krediti, izdvajanje, video, pravila).
- Gdje je nešto pretpostavka a ne doslovno dokumentovano, jasno je označeno sa "NEPOTVRĐENO".

---

## 1. Platforma i osnova

- OLX.ba i PIK.ba su ista platforma. U junu 2026. brend se vraća na Pik.ba; stara adresa se automatski preusmjerava, svi nalozi, oglasi i funkcionalnosti ostaju isti. Sva pravila ovdje važe pod oba imena.
- API base URL: `https://api.olx.ba`. Drži ga kao konfigurabilnu varijablu (`OLX_BASE_URL`), jer se uz rebrand može pojaviti `api.pik.ba`. NEPOTVRĐENO da li i kada se API domen mijenja.
- Svi pozivi idu preko HTTPS. Pozivi bez tokena ili sa nedovoljnim permisijama vraćaju 404 ili 403.

## 2. Pristupni preduslovi (provjeriti PRIJE svega)

- API integracija je navedena kao pogodnost Shop paketa (uvoz artikala sa vlastitog webshopa). Realno, pristup vrlo vjerovatno traži poslovni Shop (Gold ili Platinum) i odobrenje permisija od OLX/PIK podrške. NEPOTVRĐENO da se aktivira samoposlužno.
- Provjera u jednom koraku: pokušaj `POST /auth/login`, pa `GET /me`. Ako prolazi, pristup postoji. Ako vraća 403, treba poslati zahtjev podršci za aktivaciju.

## 3. Autentifikacija

- `POST /auth/login`
  - Tijelo: `username` (može biti username ili email), `password`, `device_name` (npr. `api_integration`).
  - Odgovor: `{ "token": "...", "user": { "id", "type", "email", "username", ... } }`.
- Zaglavlje za sve ostale pozive: `Authorization: Bearer {token}`.
- Alternativa (stari tokeni, bez pristupa lozinki): zaglavlja `OLX-CLIENT-ID` i `OLX-CLIENT-TOKEN`.
- Sigurnost tokena: čuvaj u env varijablama ili OS keychainu, nikad u kodu ni u gitu. Za tim koristi token po korisniku, a ne jedan dijeljeni u plain textu.

## 4. API referenca (provjereno)

### 4.1 Listings (oglasi)

| Operacija | Metod i putanja | Napomena |
|---|---|---|
| Dohvati oglas | `GET /listings/:id` | Pojedinačni oglas. |
| Kreiraj oglas | `POST /listings` | Kreira se u statusu DRAFT (nije vidljiv u pretrazi). |
| Izmijeni oglas | `PUT /listings/:id` | npr. title, description, price. |
| Objavi oglas | `POST /listings/:id/publish` | DRAFT postaje active. Bez ovog koraka oglas ostaje nevidljiv. |
| Obriši oglas | `DELETE /listings/:id` | Vidi pravila niže (ne briši radi re-rankinga). |
| Limit obnova | `GET /listing/refresh/limits` | `{ free_limit, free_count, paid_count, listing_count }`. OBAVEZNO procitati sa naloga; `free_limit` NIJE fiksan (zvanicno se navodi 750, izmjereno 1.800 na Gold shopu), a `free_count` je ISKORISTENO a ne preostalo. |
| Limiti oglasa | `GET /listing-limits` | Limiti po grupama kategorija (cars, real-estate, other). |
| Obnovi oglas | `PUT /listings/:id/refresh` | Daje svjež datum i diže rang. |
| Upload slike | `POST /listings/:id/image-upload` | `images` array. |
| Obriši sliku | `POST /listings/:id/image-delete` | `{ imageId }`. |
| Glavna slika | `POST /listings/:id/image-main` | `{ imageId }`. |
| Završi oglas | `POST /listings/:id/finish` | Označava prodano/završeno. |
| Sakrij oglas | `POST /listings/:id/hide` | Nestaje iz pretrage, ostaje na profilu pod "skriveni". |
| Otkrij oglas | `POST /listings/:id/unhide` | Vraća iz skrivenih. |

Polja kod kreiranja (`POST /listings`):
- Obavezno: `title`.
- Opcionalno: `short_description`, `description`, `country_id`, `city_id`, `price`, `available`, `listing_type` (`sell`, `buy`, `rent`), `state` (`new`, `used`), `brand_id`, `model_id`, `sku_number`, `attributes`.
- `attributes` je niz objekata `{ "id": <attribute_id>, "value": "<vrijednost>" }`. ID-eve i dozvoljene vrijednosti dohvati iz `GET /categories/:id/attributes`.

Životni ciklus (kritično): kreiraj (DRAFT) → upload slika → postavi glavnu sliku → publish. Ako preskočiš publish, oglas ostaje nevidljiv.

### 4.2 Users (enumeracija vlastitog kataloga)

Paginirano, `per_page` 20, `meta` sadrži `total`, `last_page`, `current_page`. Svaka stavka ima `refresh_available`, `sponsored`, `status`, `visible`.

| Skup | Putanja |
|---|---|
| Aktivni | `GET /users/:username/listings?page=N` |
| Završeni | `GET /users/:id/listings/finished?page=N` |
| Neaktivni | `GET /users/:id/listings/inactive?page=N` |
| Istekli | `GET /users/:id/listings/expired?page=N` |
| Skriveni | `GET /users/:id/listings/hidden?page=N` |

Ovo je osnova za bulk operacije: prelistaj sve stranice aktivnih, filtriraj `refresh_available: true`, pa pozovi refresh poštujući mjesečni limit.

### 4.3 Categories

| Operacija | Putanja | Napomena |
|---|---|---|
| Sve kategorije | `GET /categories` | top-level. |
| Podkategorije | `GET /categories/:id` | djeca kategorije. |
| Jedna kategorija | `GET /category/:id` | sadrži `listing_fee`, `base_listing_price`, `brand_required`, `model_required`, `show_map`, `show_condition`. |
| Atributi | `GET /categories/:id/attributes` | `id`, `name`, `input_type`, `options`, `required`. |
| Brendovi | `GET /categories/:id/brands` | |
| Modeli | `GET /categories/:id/brands/:brand_id/models` | |
| Prijedlog kategorije | `GET /categories/suggest?keyword=` | po naslovu, vraća i `count`. |
| Pronađi kategoriju | `GET /categories/find?name=` | vraća puni `path`. |

Koristi `suggest` i `find` za auto-kategorizaciju pri uvozu iz webshopa.

### 4.4 Locations

| Operacija | Putanja |
|---|---|
| Entiteti/regije | `GET /cities` |
| Države | `GET /countries` (Bosna i Hercegovina = id 49, code BA) |
| Grad po ID | `GET /cities/:id` (vraća lat, lon, zip, canton_id, state_id) |
| Entiteti | `GET /country-states` |
| Gradovi kantona | `GET /cantons/:id/cities` |

Za kreiranje oglasa trebaš `country_id` i `city_id`. Lokacija na mapi povećava pronalaženje kroz filtere.

### 4.5 Sponsored (izdvajanje, trošenje kredita)

| Operacija | Putanja | Napomena |
|---|---|---|
| Cijena izdvajanja | `GET /listings/:id/sponsore/price` | Vrati prvo, prije plaćanja. Odgovor: `{ search, refresh, locations, extras, total }`. |
| Izdvoji | `POST /listings/:id/sponsore` | Troši kredite. |
| Postavi akcijsku cijenu | `POST /listings/:id/discount` | Premium, troši kredite. `{ price, days }`, days 3/7/30. |
| Završi akcijsku cijenu | `POST /listings/:id/discount/finish` | |

Parametri izdvajanja:
- `type`: 0 bez izdvajanja, 1 klasično, 2 premium.
- `days`: 1, 2, 3, 5, 7, 14, 21, 30.
- `refresh_every`: 0, 3, 6, 8, 24 (automatska obnova svakih X sati). Napomena: API prima i 6, a
  zvanična pomoć navodi samo 3, 8 i 24 (`clanci/izdvajanje-oglasa-promocija-209206805.md`).
- `locations`: `["homepage"]` za prikaz i na naslovnici.

Pravilo alata: nikad ne pozivaj `sponsore` ni `discount` bez da si prvo dohvatio cijenu i dobio eksplicitnu potvrdu korisnika.

---

## 5. Strateški mozak: kako se gradi vidljivost

Ovo je znanje koje AI mora primijeniti kad savjetuje, ne samo da poziva endpointe.

### 5.1 Hijerarhija pozicioniranja (redoslijed po važnosti)

1. Ključne riječi u naslovu odlučuju DA LI ćeš uopšte biti pronađen u pretrazi.
2. Svježina (obnova) odlučuje KOLIKO si visoko među standardnim (besplatnim) oglasima.
3. Izdvajanje (klasično, pa premium) preskače standardni poredak i ide iznad svih, uz opciju naslovnice.

Sve tri poluge rade zajedno. Nijedna sama nije dovoljna. Izdvajanje ne spašava loš naslov.

### 5.2 Kako radi pretraga

- Tražilica spaja riječi iz naslova po AND logici. Pretraga "Golf 7" vraća oglase koji u naslovu imaju i "Golf" i "7", bez obzira na redoslijed.
- Riječi se moraju potpuno podudarati, padeži igraju ulogu. Množina i jednina se ne pogađaju automatski ("tastatura" ne hvata "tastature").
- Dijakritici se tretiraju jednako kao slova bez njih, ali se preporučuje pravilno pisanje.
- Podnaslov ULAZI u pretragu. Detaljni opis NE ulazi. Ono što nije u naslovu ili podnaslovu praktično je nevidljivo tražilici.
- Kategorija, lokacija na mapi i atributi rade kao filteri, ne kao tekstualna pretraga slobodnim unosom.

### 5.3 Pravila dobrog naslova

- Pisati u nominativu ("Stan Šip", ne "Stan na Šipu").
- Jedan artikal po oglasu. Nabrajanje više modela je nedozvoljeno i smeta pretrazi.
- Precizan brend, model i varijanta ("Volkswagen Golf 7 dizel TDI 110kw").
- Podnaslov iskoristi za dodatne ključne riječi koje ne stanu u naslov.
- Konkretna cijena. Oglasi sa "Po dogovoru" ispadaju iz cjenovnih filtera i sortiranja.

### 5.4 Svježina i obnova

- Obnova daje oglasu svjež datum i diže ga na vrh kategorije.
- Shop: mjesečna kvota besplatnih obnova se čita sa naloga (zvanično se navodi 750, izmjereno 1.800 na Gold shopu, pa se nijedan broj ne pretpostavlja), ručna besplatna obnova svakih 7 dana, grupne radnje do 50 artikala odjednom.
- Za stalno prisustvo na vrhu: kombinovana opcija, izdvajanje plus automatska obnova na 3, 8 ili 24 sata.

### 5.5 Krediti i izdvajanje (interno)

- Kredit je virtuelna valuta za servise vidljivosti (objava u naplativim kategorijama, izdvajanje, akcijska cijena).
- Cijena izdvajanja je dinamična. Raste sa konkurencijom u kategoriji i brojem dana. U manjem broju kategorija je fiksna. Tačan iznos se vidi tek na koraku izdvajanja, zato uvijek prvo dohvati cijenu preko API-ja.
- Kartična dopuna nosi veće bonuse od SMS-a (veći iznosi, veći bonus). Za veće budžete kartično je isplativije.
- Paketi (interno, ne dijeliti klijentima). Cijene sa PDV-om sa stranice paketa, provjereno 26.07.2026.: Bronze 59 KM, Silver 79 KM, Gold 119 KM, Platinum 299 KM. Mjesečni bonus kredita po paketu (Bronze 750, Silver 1.100, Gold 1.800, Platinum 4.600) je iz iste provjere, ali se PROČITA sa naloga prije nego uđe u računicu, jer se paketi mijenjaju (vidi `pravila-brojeva.md`, razred B). Gold nosi logo na naslovnici, Platinum ekskluzivnu poziciju. Shop nema limit na broj oglasa. Paket se mijenja bilo kad, bez ugovora. Probni period nosi 500 kredita kroz 30 dana.

### 5.6 Video (Video Stories)

NAPOMENA: cijela ova sekcija nema potvrdu u zvaničnoj pomoći (PIK-pomoc-korpus je ne sadrži);
izvor je interni vodič. Tretirati kao NEPOTVRĐENO dok se ne nađe zvanični izvor.

- Besplatan alat, ne troši kredite. Dodaje se samo preko Android i iOS aplikacije, ne preko weba.
- Aktivan u dijelu kategorija (Vozila, Nekretnine, Mobiteli, Tablet PCs, Elektronske cigarete), uz najavu širenja.
- Video NE diže poziciju u pretrazi. Pomaže samo konverziji i angažmanu. Za poziciju i dalje trebaš izdvajanje i obnovu.

### 5.7 Pravila i česte greške

- Zabranjeno brisati pa ponovo dodavati isti artikal isti dan radi dolaska na vrh. To je spam i moderatori uklanjaju takve oglase. Umjesto toga koristi obnovu ili produženje promocije.
- Kad artikla nema na stanju, ne briši (gubiš historiju i preglede). Koristi "Sakrij" ili završi oglas.
- Naslovi moraju biti u skladu s pravilima (za auto: proizvođač plus model, bez nabrajanja).

---

### 5.8 Nalazi iz zvanične pomoći (PIK-pomoc-korpus, scrape 26.07.2026.)

Uz svaki nalaz stoji izvorni članak u `PIK-pomoc-korpus/clanci/`:

- Shop može imati neograničen broj istovremeno izdvojenih oglasa, može sakriti historiju cijene na oglasu, ima do 20 fotografija besplatno i može izdvajati na samo 1 dan (`otvaranje-olx-shopa-209206465.md`).
- Zakazano izdvajanje se može otkazati kroz web prije nego se izvrši, a termini se biraju u intervalima od pola sata (`zakazivanje-promocije-oglasa-29643561166226.md`). API to zakazivanje ne nudi, zato planer izdvajanja radi lokalno.
- Oglas u naplativoj kategoriji ima status "neaktivan" dok se ne aktivira; aktivacija je kreditima ili čekanjem (`kako-objaviti-i-aktivirati-automobil-4417214741778.md` i srodni članci za nekretnine, posao, servise).
- Besplatna vremenska aktivacija u naplativim kategorijama: novoobjavljeni oglas dobija timer do 5 dana nakon kojeg se aktivira besplatno; aktivacija kreditima prije isteka je uz popust koji zavisi od preostalog vremena. Nudi se samo korisnicima bez aktivnih oglasa u toj naplativoj kategoriji (`besplatna-objava-oglasa-25093952692242.md`).
- Zarada kredita prijavama zloupotrebe ima mjesečni bonus za najbolje prijavitelje, ali isti korisnik ne može osvojiti bonus dva mjeseca zaredom (`zarada-pik-kredita-209206705.md`).
- Zvanični članak o shopu navodi "750 obnavljanja mjesečno" (`otvaranje-olx-shopa-209206465.md`), što je u sukobu sa izmjerenih 1.800 na Gold nalogu. Zato se nijedan od ta dva broja ne citira, nego se kvota čita s naloga (`pravila-brojeva.md`, razred B).

---

## 6. Pravila odlučivanja za AI (dijagnostika)

Kad korisnik pita za vidljivost ili rezultate oglasa, primijeni ovaj redoslijed:

- Malo pregleda: problem je vidljivost. Prvo provjeri naslov (ključne riječi) i tačnost kategorije, pa tek onda obnovu ili izdvajanje.
- Mnogo pregleda, malo upita: problem je ponuda, ne pozicija. Provjeri cijenu, fotografije i opis. Ne troši kredite na izdvajanje.
- Zasićena kategorija (npr. automobili): izdvajanje daje slabiji relativni efekat i skuplje je. Naglasak na precizan naslov, konkurentnu cijenu i premium izdvajanje plus autoobnovu.
- Prije svakog trošenja kredita: dohvati cijenu, predoči je, traži potvrdu.

---

## 7. Mapiranje na alate (ciljani dizajn CLI i MCP)

Isto jezgro, dva lica. Imena su prijedlog za implementaciju.

| Namjera | CLI komanda | MCP alat | Kategorija |
|---|---|---|---|
| Login i test pristupa | `olx auth login` | `olx_whoami` | sigurno |
| Listaj svoje oglase | `olx listings ls --state active` | `olx_list_listings` | sigurno |
| Detalji oglasa | `olx listings get <id>` | `olx_get_listing` | sigurno |
| Prijedlog kategorije | `olx category suggest "<naslov>"` | `olx_suggest_category` | sigurno |
| Provjeri limite obnove | `olx refresh limits` | `olx_refresh_limits` | sigurno |
| Cijena izdvajanja | `olx sponsor price <id> --type 2 --days 7` | `olx_sponsor_price` | sigurno |
| Obnovi oglas | `olx refresh <id>` | `olx_refresh_listing` | obnova |
| Bulk obnova | `olx refresh all --limit 200` | `olx_refresh_bulk` | obnova, traži potvrdu |
| Kreiraj oglas | `olx listings create --file item.json` | `olx_create_listing` | upis, traži potvrdu |
| Objavi oglas | `olx listings publish <id>` | `olx_publish_listing` | upis, traži potvrdu |
| Izmijeni oglas | `olx listings update <id> ...` | `olx_update_listing` | upis, traži potvrdu |
| Sakrij/otkrij | `olx listings hide/unhide <id>` | `olx_hide_listing` | upis, traži potvrdu |
| Obriši oglas | `olx listings rm <id>` | `olx_delete_listing` | opasno, dupla potvrda |
| Izdvoji oglas | `olx sponsor apply <id> ...` | `olx_sponsor_listing` | trošak kredita, dupla potvrda |
| Akcijska cijena | `olx discount set <id> ...` | `olx_set_discount` | trošak kredita, dupla potvrda |

Klasifikacija alata u MCP:
- Sigurno: čitanje i provjere, mogu se izvršavati bez dodatne potvrde.
- Upis i obnova: mijenjaju stanje, traže eksplicitnu potvrdu korisnika.
- Trošak kredita i brisanje: prvo prikaži posljedicu (cijena u kreditima ili nepovratno brisanje), traži jasnu potvrdu, nikad ne izvršavaj automatski.

---

## 8. Zaštite i ograničenja (obavezno u implementaciji)

- DRAFT zamka: poslije kreiranja oglasa uvijek slijedi publish, inače oglas nije vidljiv.
- Trošak kredita: `sponsore` i `discount` uvijek prvo prikaži cijenu i traži potvrdu.
- Ne briši radi re-rankinga: koristi refresh ili hide.
- Mjesečni limit obnova: prije bulk obnove OBAVEZNO provjeri `GET /listing/refresh/limits` i ne prelazi pročitani `free_limit`. Ne koristiti nijedan zapamćen broj.
- Rate limiti API-ja: NEPOTVRĐENO koliki su. Implementiraj konzervativni throttling i retry sa backoff-om.
- Tokeni: env ili keychain, po korisniku, nikad u repou.
- Zaštita podataka: ne logiraj lične podatke kupaca; ne izvozi interne cijene kredita ni marže u materijale za klijente.

---

## 9. Otvorena pitanja (potvrditi prije produkcije)

- Da li tvaš Shop ima odobren API pristup (test preko login plus `/me`), ili treba zahtjev podršci.
- Tačan podrazumijevani poredak standardnih oglasa (radna pretpostavka: svježina; nije doslovno dokumentovano).
- Da li i kada API domen prelazi na `api.pik.ba`.
- Tačni rate limiti i eventualni dnevni limiti na pisanje.

---

Verzija: v1, juni 2026. Mijenja se kako se potvrđuju otvorena pitanja.
