# Analiza zvanicne API dokumentacije (api-documentation.olx.ba)

Sav sadrzaj sajta preuzet i analiziran 27.07.2026. Sajt je Next.js staticka stranica sa sedam
sekcija: Introduction, Authentication, Partners, Listings, Users, Categories, Locations,
Sponsored. Bazni URL API-ja: `https://api.olx.ba`.

Glavni zakljucak: nas toolkit vec poziva SVE endpointe koje zvanicna dokumentacija navodi.
Dokumentacija ne sadrzi nijedan endpoint koji ne koristimo; obrnuto vazi, kod na dva mjesta zna
vise od dokumentacije (vidi Razilazenja). Za brojeve i dalje vazi `pravila-brojeva.md`.

## 1. Kompletan popis dokumentovanih endpointa

### Authentication

| Endpoint | Napomena |
|---|---|
| POST `/auth/login` | username ili email + password + device_name; vraca Bearer token i user objekat |
| GET `/me` | provjera identiteta |
| headeri `OLX-CLIENT-ID` + `OLX-CLIENT-TOKEN` | stari tokeni, kad nema pristupa lozinci |

Bez tokena ili sa nedovoljnim pravima API vraca 404 ili 403. Samo HTTPS.

### Listings

| Endpoint | Napomena |
|---|---|
| GET `/listings/:id` | jedan oglas |
| POST `/listings` | novi oglas ide u DRAFT; obavezan `title`; opcioni: short_description, description, country_id, city_id, price, available, listing_type (sell/buy/rent), state (new/used), brand_id, model_id, sku_number, attributes[] |
| PUT `/listings/:id` | izmjena |
| POST `/listings/:id/publish` | DRAFT postaje aktivan |
| DELETE `/listings/:id` | dokumentovan; namjerno NIJE u nasem MCP-u, samo CLI `listings rm` |
| GET `/listing/refresh/limits` | free_limit, free_count, paid_count, listing_count |
| GET `/listing-limits` | limiti po grupama: cars, real-estate, other |
| PUT `/listings/:id/refresh` | obnova, dize rang u pretrazi |
| POST `/listings/:id/image-upload` | multipart `images[]`; docs navode i `image_url` (vidi Razilazenja) |
| POST `/listings/:id/image-delete` | imageId u tijelu |
| POST `/listings/:id/image-main` | imageId u tijelu |
| POST `/listings/:id/finish` | zavrsi oglas |
| POST `/listings/:id/hide` | sakrij iz pretrage, ostaje na profilu |
| POST `/listings/:id/unhide` | vrati u pretragu |

### Users

| Endpoint | Napomena |
|---|---|
| GET `/users/:username/listings` | aktivni oglasi, paginacija (?page=), per_page 20 |
| GET `/users/:id/listings/finished` | zavrseni |
| GET `/users/:id/listings/inactive` | neaktivni |
| GET `/users/:id/listings/expired` | istekli |
| GET `/users/:id/listings/hidden` | skriveni |

Napomena: GET `/users/:username` (javni profil) NIJE dokumentovan, a postoji i koristimo ga
(`olx_user_profile`, potvrdjeno zivo 26.07.2026.). Dokaz da zvanicna lista nije potpuna.

### Categories

| Endpoint | Napomena |
|---|---|
| GET `/categories` | top-level kategorije |
| GET `/categories/:id` | podkategorije |
| GET `/category/:id` | jedna kategorija; sadrzi `listing_fee` i `base_listing_price` |
| GET `/categories/:id/attributes` | forme i obavezna polja |
| GET `/categories/:id/brands` | brendovi |
| GET `/categories/:id/brands/:brand_id/models` | modeli |
| GET `/categories/suggest?keyword=` | prijedlog kategorije po naslovu; vraca i `count` (broj oglasa u kategoriji) |
| GET `/categories/find?name=` | pretraga kategorija; vraca puni `path` hijerarhije |

### Locations

| Endpoint | Napomena |
|---|---|
| GET `/cities` | entiteti/regije (FBiH, RS, BD) sa kantonima |
| GET `/cities/:id` | detalji grada (lat, lon, zip, canton_id, state_id) |
| GET `/countries` | drzave (BiH = 49) |
| GET `/country-states` | entiteti sa kantonima; od 27.07.2026. i MCP alat `olx_country_states` |
| GET `/cantons/:id/cities` | gradovi kantona |

### Sponsored

| Endpoint | Napomena |
|---|---|
| POST `/listings/{id}/sponsore` | type 0/1/2 (bez, klasicno, premium); days 1,2,3,5,7,14,21,30; refresh_every 0,3,6,8,24; locations kao NIZ, dokumentovana vrijednost samo "homepage" |
| GET `/listings/{id}/sponsore/price` | isti parametri; cijenu razbija na komponente: search, refresh, locations, extras, total |
| POST `/listings/{id}/discount` | akcijska cijena; price + days 3/7/30; premium, trosi kredite |
| POST `/listings/{id}/discount/finish` | zavrsi akciju |

### Partners

OLX izricito kaze da NE nudi usluge integracije i javno lista vanjske partnere:

- konektor.imperea.ba (office@imperea.ba)
- bitsync.ba (info@bitsync.ba)
- lampa.ba (info@lampa.ba)
- maverus.ba (info@maverus.ba)
- autopilotapp.hithouse.ba (prodaja@hithouse.ba)
- neoweb.ba (info@neoweb.ba)

## 2. Razilazenja dokumentacije i zivog ponasanja

Kad se dokumentacija i zivo ponasanje ne slazu, vazi zivo ponasanje.

- `image_url` na image-upload: dokumentovan, ali uzivo API odbija sve osim multipart `images[]`
  (potvrdjeno, komentar u `src/core/index.ts` kod `uploadImageBlobs`). Nas URL upload zato
  preuzme sliku pa je posalje kao fajl.
- `free_limit` u primjeru odgovora je 750; izmjereno na dva Gold naloga je 1.800. Vec
  zabiljezeno u `pravila-brojeva.md` kao protivrjecnost; vazi izmjereno.
- GET `/users/:username` (javni profil) radi a nije dokumentovan; zvanicna lista endpointa
  ocito nije potpuna, pa vjerovatno postoji jos nedokumentovanih endpointa.
- `locations` na sponsore je niz stringova, sto ostavlja prostor da postoje i druge lokacije
  izdvajanja osim naslovnice; dokumentovana je samo "homepage". Zivo provjereno 27.07.2026.:
  `sponsore/price` sa `locations: ["homepage"]` uredno vraca komponentu `locations` u cijeni.

## 3. Sta API uopste nema (granice produkta)

Dokumentacija nema, a ni zivi testovi nisu nasli:

- pretragu oglasa (search) — nemoguce mjeriti poziciju u pretrazi, skenirati konkurenciju po
  kategoriji ili traziti po SKU; poznati konkurent se ipak analizira po username-u
- klikove i pojmove pretrage — ali PREGLEDI postoje: `GET /listings/:id` vraca `views` i
  `questions`, i za tudje oglase (zivo provjereno 27.07.2026., vidi API-INVENTAR sekciju
  "Propertiji odgovora"); efekat izdvajanja se mjeri vlastitim snimcima pregleda
- citanje i slanje poruka i upita kupaca — postoji samo brojac `new_questions_count` na
  GET `/me`
- zakazivanje promocije (nas planer izdvajanja to rjesava lokalnim plan fajlom; polje
  `sponsor_scheduled` na oglasu pokazuje da platforma interno ima zakazivanje)
- zaseban endpoint za saldo kredita — saldo ipak stize kroz GET `/me`, polje `credits`

## 4. Sta smo iskoristili iz ove analize (uradjeno 27.07.2026.)

- `olx_sponsor_price` i `olx_sponsor_listing` primaju opcioni `locations` niz pored
  `homepage` boolean-a; CLI `sponsor price/apply` ima `--locations`
- novi MCP alat `olx_country_states`
- opis `olx_category` sada objasnjava `listing_fee` (krediti koje objava kosta; 0 = besplatno)
  i `base_listing_price`, kao izvor za trosak objave PRIJE kreiranja oglasa

## 5. Prijedlozi produktizacije

Sve na postojecim endpointima, bez cekanja da OLX nesto doda.

1. **Kalkulator troska objave po kategoriji.** Prije uvoza kataloga u naplatne kategorije
   (nekretnine, vozila) procitati `listing_fee` i `base_listing_price` za sve ciljne
   kategorije i dati klijentu racun "objava X oglasa kosta Y kredita". Podaci vec postoje u
   `olx://categories-index`; treba samo korak u `olx-klijent-flow` onboardingu.
2. **Analiza velicine trzista iz `categories/suggest`.** Polje `count` daje broj oglasa po
   kategoriji, sto je gruba mjera konkurencije. Upotreba: u analizi kandidata
   (`olx-klijent-flow`) pokazati koliko je gusta kategorija u koju klijent ulazi.
3. **Razbijanje cijene izdvajanja po komponentama.** `sponsore/price` vraca search, refresh,
   locations i extras odvojeno. Kreditni savjetnik (`pik-olx-kreditni-savjetnik`) moze
   pokazati sta tacno kosta u kombinaciji umjesto samo totala, i preporuciti gdje se stedi
   (npr. izbaciti naslovnicu, zadrzati autoobnovu).
4. **Pozicioniranje CodeFactory kao integracijskog partnera.** OLX javno kaze da ne radi
   integracije i lista 6 partnera. Nas toolkit vec pokriva 100 posto dokumentovanog API-ja
   plus nedokumentovani javni profil. To je gotov argument za pitch: ili uvrstenje na listu
   partnera (kontakt sa OLX podrskom) ili direktna ponuda klijentima kao "API integracija +
   AI upravljanje shopom".
5. **Lov na nedokumentovane endpointe (oprezno).** Dokazano je da lista nije potpuna
   (`/users/:username` radi). Kandidati za zivi test read-only pozivima: `/shops/:username`,
   varijante statistike, search. Svaki nalaz upisati ovdje i u API-INVENTAR.
6. **Analitika iz propertija odgovora (nadjeno 27.07.2026., IMPLEMENTIRANO isti dan).**
   `views`, `questions`, `sponsor_active`, `date` kao timestamp zadnje obnove,
   `new_questions_count`, `shop.ends_at`, `last_time_active_at` na tudjem profilu.
   Implementirano kao agregacioni sloj: MCP alati `olx_profile_stats`,
   `olx_competitor_report`, `olx_listing_report`, `olx_account_alerts`, `olx_sponsor_effect`
   i CLI `stats` grupa sa dnevnim snapshotom pregleda. Kompletan popis propertija:
   API-INVENTAR.md, sekcija "Propertiji odgovora, izmjereno zivim pozivima 27.07.2026.".

## 6. Recept za osvjezavanje ove analize

1. `curl -s https://api-documentation.olx.ba` pa iz HTML-a procitati listu stranica
   (`/authentication`, `/listings`, `/users`, `/categories`, `/locations`, `/sponsored`,
   `/partners`; nove sekcije bi se pojavile u navigaciji).
2. Za svaku stranicu preuzeti HTML i izvuci tekst (sadrzaj je server-renderovan, nije
   potreban browser).
3. Uporediti popis endpointa sa sekcijom 1 ovog dokumenta i sa `API-INVENTAR.md`.
4. Nove endpointe prvo potvrditi zivim read-only pozivom pa tek onda dodavati u kod.
