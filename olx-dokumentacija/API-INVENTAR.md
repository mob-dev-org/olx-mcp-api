# Inventar mogucnosti OLX/PIK API-ja u ovom MCP serveru

Dokument je napravljen iskljucivo citanjem izvornog koda i dokumentacije u repozitoriju. Nijedan poziv prema API-ju nije izvrsen, nijedan postojeci fajl nije mijenjan.

Svaka tvrdnja ima referencu na fajl i broj linije. Gdje se iz koda ne moze utvrditi odgovor, pise "nepoznato".

Bazni URL je `https://api.olx.ba`, konfigurabilan kroz `OLX_BASE_URL` (`src/core/config.ts:37`).

---

## 1. Tabela alata

Ukupno 35 registrovanih MCP alata (`src/mcp/server.ts:214` do `src/mcp/server.ts:631`). Tri alata ne dodiruju API (rade samo nad lokalnom konfiguracijom).

Legenda kolone "Kredit": da = poziv sigurno trosi kredite, moguce = zavisi od kategorije ili paketa, ne = ne trosi.

| MCP alat | HTTP metoda i putanja | Sta radi | Obavezni parametri | Opcioni parametri | R/W | Kredit | Nepovratno |
|---|---|---|---|---|---|---|---|
| `olx_whoami` (`server.ts:214`) | GET `/me` (`core/index.ts:220`) | Vraca podatke o nalogu iz tokena, sluzi kao test pristupa. | nema | nema | read | ne | ne |
| `olx_list_accounts` (`server.ts:220`) | nema API poziva (`server.ts:230`) | Ispisuje aktivni profil i imena svih konfigurisanih profila, bez tokena. | nema | nema | read | ne | ne |
| `olx_switch_account` (`server.ts:237`) | nema API poziva (`server.ts:248`) | Mijenja aktivni nalog za sve naredne pozive na ovom serveru. | `profile` | nema | write (lokalno stanje) | ne | ne, ali mijenja na kojem nalogu se izvrsavaju naredne radnje |
| `olx_list_listings` (`server.ts:262`) | GET `/users/:user/listings` (`core/index.ts:342`), `/finished` (`:347`), `/inactive` (`:352`), `/expired` (`:357`), `/hidden` (`:362`) | Lista vlastite oglase po stanju, paginirano. | nema (default `state=active`, korisnik se izvlaci iz tokena, `server.ts:278`) | `state`, `user`, `page`, `all` | read | ne | ne |
| `olx_get_listing` (`server.ts:287`) | GET `/listings/:id` (`core/index.ts:245`) | Dohvata jedan oglas po ID-u. | `id` | nema | read | ne | ne |
| `olx_suggest_category` (`server.ts:293`) | GET `/categories/suggest?keyword=` (`core/index.ts:404`) | Predlaze kategoriju na osnovu naslova i vraca broj oglasa. | `keyword` | nema | read | ne | ne |
| `olx_find_category` (`server.ts:299`) | GET `/categories/find?name=` (`core/index.ts:408`) | Pronalazi kategoriju po imenu i vraca puni path. | `name` | nema | read | ne | ne |
| `olx_category_attributes` (`server.ts:305`) | GET `/categories/:id/attributes` (`core/index.ts:392`) | Vraca atribute (forme) kategorije, sa `required` i `options`. | `id` | nema | read | ne | ne |
| `olx_refresh_limits` (`server.ts:311`) | GET `/listing/refresh/limits` (`core/index.ts:267`) | Mjesecni limiti obnove: `free_limit`, `free_count`, `paid_count`, `listing_count` (`core/types.ts:71`). | nema | nema | read | ne | ne |
| `olx_sponsor_price` (`server.ts:317`) | GET `/listings/:id/sponsore/price` (`core/index.ts:487`) | Racuna cijenu izdvajanja u kreditima, bez naplate. | `id`, `type`, `days` | `refresh_every` (default 0), `homepage` | read | ne | ne |
| `olx_categories` (`server.ts:342`) | GET `/categories` (`core/index.ts:380`) | Top level kategorije. | nema | nema | read | ne | ne |
| `olx_category_children` (`server.ts:348`) | GET `/categories/:id` (`core/index.ts:384`) | Podkategorije date kategorije. | `id` | nema | read | ne | ne |
| `olx_category` (`server.ts:354`) | GET `/category/:id` (`core/index.ts:388`) | Detalji kategorije: `listing_fee`, `base_listing_price`, `brand_required`, `model_required`, `show_map`, `show_condition`. | `id` | nema | read | ne | ne |
| `olx_category_brands` (`server.ts:360`) | GET `/categories/:id/brands` (`core/index.ts:396`) | Brendovi u kategoriji. | `id` | nema | read | ne | ne |
| `olx_category_models` (`server.ts:366`) | GET `/categories/:id/brands/:brandId/models` (`core/index.ts:400`) | Modeli za zadati brend. | `id`, `brandId` | nema | read | ne | ne |
| `olx_listing_limits` (`server.ts:372`) | GET `/listing-limits` (`core/index.ts:271`) | Limiti broja oglasa po grupama kategorija. | nema | nema | read | ne | ne |
| `olx_countries` (`server.ts:378`) | GET `/countries` (`core/index.ts:436`) | Lista drzava. | nema | nema | read | ne | ne |
| `olx_cities` (`server.ts:384`) | GET `/cities` (`core/index.ts:432`) | Entiteti i regije (sadrze kantone). | nema | nema | read | ne | ne |
| `olx_city` (`server.ts:390`) | GET `/cities/:id` (`core/index.ts:440`) | Detalji grada: lat, lon, zip, canton_id, state_id. | `id` | nema | read | ne | ne |
| `olx_canton_cities` (`server.ts:396`) | GET `/cantons/:id/cities` (`core/index.ts:448`) | Gradovi u kantonu. | `id` | nema | read | ne | ne |
| `olx_create_listing` (`server.ts:404`) | POST `/listings` (`core/index.ts:249`) | Kreira oglas u DRAFT stanju, jos nije vidljiv. | `title` (max 65 znakova, `server.ts:202`), `category_id` (`server.ts:412`) | `short_description`, `description`, `country_id`, `city_id`, `price`, `available`, `listing_type`, `state`, `brand_id`, `model_id`, `sku_number`, `attributes` | write | moguce, u naplativim kategorijama objava se placa kreditima (`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:159`); indikator je `listing_fee` i `base_listing_price` iz `olx_category` | ne, DRAFT se moze obrisati |
| `olx_publish_listing` (`server.ts:431`) | POST `/listings/:id/publish` (`core/index.ts:259`) | Objavljuje DRAFT, oglas postaje aktivan i javno vidljiv. | `id` | nema | write | moguce, isto kao gore, tacan trenutak naplate nepoznat iz koda | da u smislu javne objave, oglas postaje vidljiv svima |
| `olx_update_listing` (`server.ts:437`) | PUT `/listings/:id` (`core/index.ts:254`) | Mijenja polja oglasa. | `id` | `title`, `description`, `short_description`, `price`, `available` | write | ne | ne, ali prepisuje prethodne vrijednosti bez backupa u kodu |
| `olx_refresh_listing` (`server.ts:458`) | PUT `/listings/:id/refresh` (`core/index.ts:275`) | Obnavlja oglas, daje svjez datum i dize rang. | `id` | nema | write | ne dok ima besplatnih obnova; API prati i `paid_count` (`core/types.ts:74`), sto znaci da postoje i naplacene obnove | ne, ali trosi jednu obnovu iz mjesecne kvote |
| `olx_refresh_bulk` (`server.ts:464`) | GET `/listing/refresh/limits` + GET `/users/:user/listings` (sve stranice) + PUT `/listings/:id/refresh` u petlji (`server.ts:478` do `server.ts:497`) | Grupno obnavlja aktivne oglase kojima je obnova dostupna, uz postovanje preostale besplatne kvote. | nema | `user`, `limit` (1 do 750, default 100), `confirm` (default false, dry run) | write kad je `confirm=true`, inace read | ne dok se ne prekoraci besplatna kvota; kod tvrdo ogranicava na `free_limit - free_count` (`server.ts:481`) | ne, ali trosi obnove iz kvote |
| `olx_hide_listing` (`server.ts:501`) | POST `/listings/:id/hide` (`core/index.ts:322`) | Sklanja oglas iz pretrage, ostaje na profilu. | `id` | nema | write | ne | ne, postoji `olx_unhide_listing` |
| `olx_unhide_listing` (`server.ts:507`) | POST `/listings/:id/unhide` (`core/index.ts:326`) | Vraca skriveni oglas u pretragu. | `id` | nema | write | ne | ne |
| `olx_finish_listing` (`server.ts:513`) | POST `/listings/:id/finish` (`core/index.ts:318`) | Oznacava oglas kao zavrsen ili prodan, cuva historiju. | `id` | nema | write | ne | nepoznato da li se zavrseni oglas moze vratiti u aktivne, u kodu nema takvog poziva |
| `olx_delete_listing` (`server.ts:519`) | DELETE `/listings/:id` (`core/index.ts:263`) | Trajno brise oglas. | `id`, `confirm=true` (bez toga alat baca gresku, `server.ts:530`) | nema | write | ne | da, nepovratno, gubi se historija i statistika |
| `olx_upload_images` (`server.ts:535`) | POST `/listings/:id/image-upload`, multipart polje `images[]` (`core/index.ts:286`) | Dodaje slike na oglas. URL-ovi se prvo preuzmu pa salju kao fajl, jer API ne prihvata `image_url` (`core/index.ts:278`). | `id` i bar jedno od `urls` / `file_paths` (`server.ts:550`) | `urls`, `file_paths` | write | ne | ne, slike se mogu brisati |
| `olx_set_main_image` (`server.ts:560`) | POST `/listings/:id/image-main` (`core/index.ts:314`) | Postavlja glavnu sliku oglasa. | `id`, `imageId` | nema | write | ne | ne |
| `olx_delete_image` (`server.ts:571`) | POST `/listings/:id/image-delete` (`core/index.ts:310`) | Brise sliku sa oglasa. | `id`, `imageId` | nema | write | ne | da za samu sliku, nema undo poziva u kodu |
| `olx_sponsor_listing` (`server.ts:584`) | POST `/listings/:id/sponsore` (`core/index.ts:510`) | Izdvaja oglas. Bez `confirm=true` samo dohvati cijenu i baca `OlxSpendError` (`core/index.ts:498` do `:509`). | `id`, `type`, `days`, `confirm=true` za stvarnu naplatu | `refresh_every`, `homepage` | write | da | da, potroseni krediti se ne vracaju |
| `olx_set_discount` (`server.ts:611`) | POST `/listings/:id/discount` (`core/index.ts:522`) | Postavlja akcijsku cijenu, premium opcija. Bez `confirm=true` baca `OlxSpendError` (`core/index.ts:517`). | `id`, `price`, `days` (3, 7 ili 30), `confirm=true` | nema | write | da | da, potroseni krediti se ne vracaju |
| `olx_finish_discount` (`server.ts:627`) | POST `/listings/:id/discount/finish` (`core/index.ts:526`) | Zavrsava aktivnu akcijsku cijenu. | `id` | nema | write | ne za sam poziv, ali ranije potroseni krediti se ne vracaju | da, prekid akcije prije isteka |

### Metode u jezgru koje nisu izlozene kao MCP alat

- `login()`, POST `/auth/login` (`core/index.ts:193`). Dostupno samo kroz CLI komandu `auth login` (`src/cli/index.ts:183`).
- `countryStates()`, GET `/country-states` (`core/index.ts:443`). Nema odgovarajuci MCP alat, koristi se samo unutar `locationSnapshot` (`core/index.ts:456`) i CLI-a.
- `categoryTree()` (`core/index.ts:413`) i `locationSnapshot()` (`core/index.ts:454`). Agregatori za jednokratni snapshot, pokrecu se preko CLI komandi `category dump` i `location dump` (`src/cli/index.ts:559`).
- `listAllActive()` (`core/index.ts:366`) je dostupan indirektno, kroz `olx_list_listings` sa `all=true`.

### MCP resursi (nisu alati, ali su dio ponude servera)

- `olx://knowledgebase` (`server.ts:73`), lokalni markdown vodic.
- `olx://categories-index` CSV (`server.ts:88`) i `olx://categories` puni JSON (`server.ts:115`).
- `olx://locations-index` CSV (`server.ts:142`) i `olx://locations` puni JSON (`server.ts:169`).

Svi resursi citaju lokalne snapshote iz `olx-dokumentacija/`, ne API.

---

## 2. Autentikacija

### Kako se dobija token

Kod podrzava tri nacina (`core/index.ts:114` do `:125`):

- Vec postojeci Bearer token u `OLX_TOKEN`, salje se kao `Authorization: Bearer <token>` (`core/index.ts:115`).
- Login kredencijalima: POST `/auth/login` sa `username`, `password`, `device_name`, odgovor sadrzi token (`core/index.ts:197` do `:207`).
- Stari par zaglavlja `OLX-CLIENT-ID` i `OLX-CLIENT-TOKEN` (`core/index.ts:116` do `:120`).

`ensureAuth()` radi login samo ako nema ni tokena ni client para (`core/index.ts:237`).

Gdje korisnik generise token: u repozitoriju nema URL-a ni ekrana na kojem se token generise. Dokumentacija kaze samo da API pristup vrlo vjerovatno trazi poslovni Shop (Gold ili Platinum) i odobrenje OLX/PIK podrske, sto se provjerava pozivom `/auth/login` pa `/me` (`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:23` i `:24`, `README.md:8`). Tacno mjesto generisanja tokena je nepoznato iz koda.

### Jedan nalog ili vise naloga

- Jedan proces servera u datom trenutku radi na tacno jednom nalogu. Postoji jedna globalna `client` instanca (`server.ts:30` i `:31`).
- Vise naloga se moze konfigurisati kao profili i mijenjati u toku rada alatom `olx_switch_account`, koji zamjenjuje globalnog klijenta (`server.ts:248` do `:251`). To nije paralelan rad, nego prebacivanje.
- Profili se ucitavaju iz `.olx-profiles.json` ili iz env varijabli oblika `OLX_TOKEN_<IME>` (`core/config.ts:54` do `:94`).
- Rizik: posto je promjena naloga globalna i tiha, svaka naredna operacija ide na novi nalog. Kod to i sam istice u opisu alata (`server.ts:242`), ali nema tehnicke zastite, samo tekstualno upozorenje. Ovo je realna mogucnost da se izdvajanje ili brisanje izvrsi na pogresnom klijentu.

### Gdje se token cuva

- U memoriji klijenta, privatno polje `token` (`core/index.ts:72`).
- U okruzenju: `OLX_TOKEN`, `OLX_TOKEN_<IME>`, `OLX_CLIENT_ID`, `OLX_CLIENT_TOKEN` (`core/config.ts:38` do `:43`, `core/config.ts:86`).
- U fajlu `.olx-profiles.json`, putanja se moze promijeniti kroz `OLX_PROFILES_FILE` (`core/config.ts:58`).
- MCP server ucitava `.env` iz radnog direktorija na startu (`server.ts:15`).
- `.mcp.json` ne sadrzi token, nego referencu `${OLX_TOKEN:-}` (`.mcp.json`, polje `env`).
- `.gitignore` iskljucuje `.env` i `.olx-profiles.json` iz gita.

### Tajne vrijednosti u cistom tekstu

- Fajl `.env` sadrzi dva prava Bearer tokena u cistom tekstu: `OLX_TOKEN_PROTON_ILIDZA` (`.env:26`) i `OLX_TOKEN_MIXBOX` (`.env:30`).
- Fajl `.env` sadrzi i lozinku naloga u cistom tekstu, unutar komentara na liniji `.env:29` ("Kredencijali za ponovni login ako token istekne", username i password). Lozinka je ovdje namjerno necitirana.
- Fajl je u `.gitignore` i nije u git historiji, tako da nije procurio u repozitorij. Ipak, lozinka u komentaru je nepotrebna izlozenost. Preporuka je da se lozinka izbaci i drzi u OS keychainu ili menadzeru lozinki, a u `.env` ostane samo token.
- U izvornom kodu, `.env.example` i `.olx-profiles.example.json` nema pravih tajni, samo placeholderi.
- Sigurnosno pravilo iz dokumentacije koje ovo krsi: `olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:33` i `:225` traze token u env ili keychainu, po korisniku, nikad u repou.

### Sta se desava kad token istekne

- Kod ne detektuje istek tokena i ne radi automatsko osvjezavanje. Nema refresh token logike nigdje u `src/`.
- Odgovori 401 i 403 se pretvaraju u `OlxAuthError` sa porukom "Pristup odbijen ... Provjeri token i da li je shop odobren za API" (`core/index.ts:167` do `:171`).
- 401 i 403 se ne ponavljaju, retry se radi samo na 429 i 5xx (`core/index.ts:160`).
- `ensureAuth()` ne pomaze kod isteklog tokena, jer prolazi cim token postoji, bez obzira na to je li validan (`core/index.ts:238`).
- Prakticna posljedica: kad token istekne, svaki alat vraca istu gresku i korisnik mora rucno postaviti novi token ili pokrenuti CLI `auth login` sa kredencijalima.

---

## 3. Ogranicenja

### Throttle, retry i timeout

- Throttle: minimalni razmak izmedju dva zahtjeva, default 350 ms, iz `OLX_MIN_REQUEST_INTERVAL_MS` (`core/config.ts:44`, primjena u `core/index.ts:93` do `:97`, poziva se prije svakog pokusaja u `core/index.ts:141`).
- Retry: default 4 pokusaja, iz `OLX_MAX_RETRIES` (`core/config.ts:45`). Ponavlja se na 429 i na svaki status 500 i vise (`core/index.ts:160`), te na mrezne greske i timeout (`core/index.ts:177`).
- Backoff: eksponencijalni `2^pokusaj * 250 ms`, ogranicen na 8000 ms, plus do 200 ms slucajnog jittera (`core/index.ts:162` i `:178`).
- Timeout: default 20000 ms po zahtjevu, iz `OLX_TIMEOUT_MS`, realizovan preko `AbortController` (`core/config.ts:46`, `core/index.ts:143` i `:144`).
- Stvarni rate limiti API-ja su nepoznati. Dokumentacija to izricito navodi kao neprovjereno (`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:224`).

### Limiti koje vraca ili namece API

- Obnove: `GET /listing/refresh/limits` vraca `free_limit`, `free_count`, `paid_count`, `listing_count` (`core/types.ts:71` do `:76`). `free_limit` zavisi od naloga: zvanicna pomoc tvrdi 750, izmjereno je 1.800 na dva Gold naloga; uvijek procitati, ne pretpostavljati (`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:46`).
- Bulk obnova u kodu nikad ne prelazi preostalu besplatnu kvotu, `remaining = free_limit - free_count` (`server.ts:481`), a ulazni `limit` je dodatno ogranicen na najvise 750 (`server.ts:472`).
- Broj oglasa: `GET /listing-limits` vraca limite po grupama kategorija (cars, real-estate, other). Konkretne brojeve kod ne poznaje, tip je `unknown` (`core/index.ts:270`).
- Naslov: najvise 65 znakova, validira se lokalno jer API vraca 422 (`server.ts:202`).
- Dani izdvajanja: samo 1, 2, 3, 5, 7, 14, 21, 30 (`server.ts:203` do `:205`, `core/types.ts:189`).
- Autoobnova: samo 0, 3, 6, 8, 24 sata, parametar je na API-ju obavezan pa kod salje 0 kad nije zadan (`server.ts:206` do `:209`, `core/index.ts:491`).
- Tip izdvajanja: 0, 1 ili 2 (`server.ts:324`, `core/types.ts:188`).
- Akcijska cijena: samo 3, 7 ili 30 dana (`server.ts:619`, `core/types.ts:213`).
- Paginacija: `per_page` 20 po dokumentaciji (`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:65`). `listAllActive` prelistava najvise 50 stranica (`core/index.ts:366`).
- Slike: broj i velicina slika se u kodu nigdje ne provjeravaju, nema limita ni validacije formata. Dokumentacija spominje do 20 fotografija besplatno za shopove (`olx-dokumentacija/OLX_PIK_Rangiranje_Pretraga_Sortiranje.md`, dio o shop paketima), ali API limit i maksimalna velicina fajla su nepoznati iz koda. CLI opcija za lokalne fajlove je i sama oznacena kao "format NEPOTVRDJEN" (`src/cli/index.ts:363`).
- Dubina stabla kategorija: default 6 nivoa kod snapshota (`core/index.ts:413`).

### Kodovi gresaka koje kod hvata

- 401 i 403: `OlxAuthError`, "Pristup odbijen", znaci nevazeci token ili shop bez odobrenog API pristupa (`core/index.ts:167`). Ne ponavlja se.
- 429: ponavlja se sa backoffom, znaci prekoracen rate limit (`core/index.ts:160`).
- 500 i vise: ponavlja se sa backoffom, greska na strani API-ja (`core/index.ts:160`).
- Svi ostali statusi izvan 2xx: `OlxApiError` sa statusom i punim tijelom odgovora. MCP ispisuje tijelo, sto je namjerno zbog 422 validacije po poljima (`core/index.ts:172`, `server.ts:61` do `:64`).
- Timeout: `AbortError` se pretvara u `OlxApiError` sa statusom 0 i porukom "Timeout nakon Xms" (`core/index.ts:182` i `:183`).
- Mrezna greska: takodjer `OlxApiError` sa statusom 0 (`core/index.ts:183`).
- `OlxSpendError`: interna greska alata, ne dolazi od API-ja. Baca se kad bi operacija potrosila kredite bez `confirm` (`core/index.ts:49`, `:498`, `:517`). MCP je prikazuje zajedno sa dohvacenom cijenom (`server.ts:57` do `:60`).
- 404 se ne obradjuje posebno. Komentar u kodu biljezi da `/users/:id/listings` vraca 404 dok `/users/:username/listings` radi, zato se svuda koristi username (`core/index.ts:223` i `:224`).
- Zastita od tihe greske: prazan korisnik ili literal "undefined" baca `OlxAuthError` prije poziva (`core/index.ts:332` do `:338`).

---

## 4. Podaci o konkurenciji i statistika

### Javni podaci o tudjim oglasima i shopovima

- `GET /users/:username/listings` i njegove varijante vracaju i tudje javne oglase, jer `olx_list_listings` prima proizvoljan `user` parametar (`server.ts:270`, `core/index.ts:340`). Podrazumijevano se koristi korisnik iz tokena (`server.ts:278`).
- **Potvrdjeno zivim testom 26.07.2026.** na shopu APlus: `active` vraca 33 oglasa sa punim cijenama, `finished` vraca 156 oglasa ali sa cijenom 0 i oznakom "Na upit", `inactive` vraca 2 oglasa sa cijenom, `expired` i `hidden` vracaju prazno. Ovo obara raniju napomenu iz `.claude/skills/olx-analiza-profila/references/konkurencija-faza2.md` da je stvar nepotvrdjena.
- Podaci koji dolaze po tudjem oglasu: naslov, cijena, kategorija, brend, godiste, kilometraza, gorivo, broj slika, `sponsored`, `olx_stories`, `premium_badges`, `refresh_available`, `date` zadnje obnove, `created_at` i `updated_at` na zavrsenim oglasima.
- **Postoji nedokumentovani endpoint za tudji profil: `GET /users/:username`** (radi i kao `GET /shops/:username`). Nije naveden ni u dokumentaciji ni u `src/core`, pronadjen je probom 26.07.2026. Varijanta sa brojcanim id-om vraca 404, prolazi samo username.
- Sta vraca za tudji shop: `type`, `id`, `username`, medalje (ukljucujuci `platinum_shop` ili `gold_shop`), `shop.package` (npr. Platinum), `shop.business_name`, `shop.business_vat`, `shop.ends_at`, `shop.web`, `shop.description`, `shop.working_hours`, `location` sa lat i lon, `created_at`, `avg_response_time`, `feedbacks` sa brojem pozitivnih i negativnih ocjena, te postavke privatnosti.
- Prakticna vrijednost: paket konkurenta se moze procitati direktno, sto u kombinaciji sa poljem `sponsored` na njihovim oglasima pokazuje da li plaćeni paket zaista i koriste.

### Statistika

- U kodu nema nijednog statistickog endpointa. Nema pregleda, nema klikova, nema pojmova na pretrazi, nema podataka po kategoriji ni po shopu, nema vremenskog perioda.
- Saldo kredita JESTE dostupan. `GET /me` vraca polje `credits` (potvrdjeno zivim pozivom 26.07.2026., nalog Proton_Ilidza je imao 1488 kredita). Polje nije u tipu `OlxUser` (`core/types.ts:4`), ali prolazi kroz index potpis, pa ga `olx_whoami` vec vraca. Ranija tvrdnja u sekciji 6 da se saldo ne moze procitati je netacna.
- `GET /me` vraca i paket shopa (`shop.package`, npr. Gold), datum isteka paketa `shop.ends_at`, prosjecno vrijeme odgovora `avg_response_time` i brojac neodgovorenih pitanja `new_questions_count`.
- Jedina brojka blizu statistike je `count` u prijedlogu kategorije, koji pokazuje broj oglasa uz predlozenu kategoriju (`core/types.ts:145`, `olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:87`).
- Iz liste vlastitih oglasa dolaze polja koja se mogu koristiti kao gruba interna metrika: `sponsored`, `date`, `refresh_available`, `status`, `visible` (`core/types.ts:78` do `:91`).
- Interna dokumentacija spominje da statistika oglasa i "pojmovi na pretrazi" postoje na platformi (`olx-dokumentacija/OLX_PIK_Rangiranje_Pretraga_Sortiranje.md`, dio 6 i Faza 2), ali za njih u dokumentaciji nema API endpointa, pa se ne mogu dohvatiti kroz ovaj MCP.

### Pretraga

- Pretraga oglasa po kljucnoj rijeci, kategoriji, cijeni ili lokaciji ne postoji u ovom toolkitu. Nijedan poziv u `src/core/index.ts` ne gadja search endpoint.
- Postoji samo pretraga kategorija po imenu: `/categories/suggest?keyword=` (`core/index.ts:404`) i `/categories/find?name=` (`core/index.ts:408`). To vraca kategorije, ne oglase.
- Repozitorij i sam biljezi da search endpoint nedostaje i da vjerovatno postoji na API-ju, ali nije dokumentovan (`.claude/skills/olx-analiza-profila/references/konkurencija-faza2.md`, tacke 2 i 3).

Zakljucak: konkurentska analiza kroz ovaj MCP trenutno nije moguca na pouzdan nacin.

---

## 5. Neiskoristeno

Dokumentacija API-ja u repozitoriju postoji: `olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md`, sekcija 4, tabele od linije 39 do linije 118. To je jedina lista endpointa u repozitoriju. Ne postoji OpenAPI spec ni Postman kolekcija.

Poredjenje te liste sa implementacijom:

- Svi endpointi navedeni u dokumentaciji su implementirani u `src/core/index.ts`. Nema nijednog dokumentovanog endpointa koji jezgro ne pokriva.
- Neiskoristeno na nivou MCP sloja, iako postoji u jezgru:
  - POST `/auth/login` (`core/index.ts:197`) nije MCP alat, samo CLI komanda.
  - GET `/country-states` (`core/index.ts:443`) nije MCP alat.

Endpointi koji postoje na API-ju, a nisu ni u dokumentaciji ni u kodu:

- `GET /users/:username` i `GET /shops/:username`, profil tudjeg korisnika ili shopa sa paketom i poslovnim podacima. Potvrdjeno zivim pozivom 26.07.2026. Vrijedi ga dodati u `src/core` i izloziti kao read-only alat, npr. `olx_user_profile`.

Ovaj nalaz znaci da lista u dokumentaciji nije potpuna, nego samo ono sto je tim do sada prepisao. Vjerovatno postoji jos nedokumentovanih endpointa.

Sta dokumentacija ne pokriva, pa se ne moze provjeriti bez zivog testa:

- Nema dokumentovanog search endpointa za oglase.
- Nema dokumentovanih statistickih endpointa.
- Nema dokumentovanog endpointa za poruke, upite kupaca ni notifikacije.
- Nema zasebnog endpointa za stanje kredita, ali saldo stize kroz `GET /me` u polju `credits`. Dokumentacija to ne spominje, potvrdjeno je zivim pozivom.
- Nema dokumentovanog endpointa za zakazivanje promocije, iako interni vodic navodi da ta opcija postoji na platformi od 2025. (`olx-dokumentacija/OLX_PIK_Rangiranje_Pretraga_Sortiranje.md`, dio 3).

Ovi endpointi se ne izmisljaju. Ako postoje na API-ju, to se mora potvrditi zivim testom ili zvanicnom referencom `api-documentation.olx.ba`.

---

## 6. Sta je moguce izgraditi

Lista je ogranicena na ono sto postojeci endpointi stvarno omogucavaju.

### Lako

- **Zdravstveni pregled naloga.** Jedan izvjestaj: ko sam, koliko aktivnih, skrivenih, isteklih i zavrsenih oglasa, koliko je obnova ostalo ovaj mjesec.
  - Alati: `olx_whoami`, `olx_list_listings` (svih pet stanja), `olx_refresh_limits`, `olx_listing_limits`.
  - Nedostaje: nista.
- **Detektor slabih naslova.** Prolazak kroz sve aktivne oglase i oznacavanje naslova koji su kraci od praga, nemaju brend ili model, sadrze rijeci bez pretrazivacke vrijednosti ili prelaze 65 znakova.
  - Alati: `olx_list_listings` sa `all=true`, `olx_get_listing`, plus pravila iz `olx://knowledgebase`.
  - Nedostaje: nista, cijela logika je lokalna. Bez podataka o stvarnim pojmovima pretrage ostaje heuristika, ne mjerenje.
- **Provjera ispravne kategorije.** Za svaki aktivni oglas uporediti trenutnu kategoriju sa onom koju API predlaze na osnovu naslova.
  - Alati: `olx_list_listings`, `olx_suggest_category`, `olx_category`.
  - Nedostaje: nista. Napomena: premjestanje oglasa u drugu kategoriju nije podrzano, `olx_update_listing` ne prima `category_id` (`server.ts:442` do `:449`), iako ga jezgro tehnicki podrzava kroz `UpdateListingInput` (`core/types.ts:69`).
- **Planer obnova sa dry run pregledom.** Prikaz kandidata za obnovu i preostale kvote prije bilo kakvog trosenja.
  - Alati: `olx_refresh_bulk` sa `confirm=false`, `olx_refresh_limits`.
  - Nedostaje: nista, vec je implementirano kao dry run.
- **Kalkulator izdvajanja bez trosenja.** Poredjenje cijene za vise kombinacija `type`, `days` i `refresh_every` na istom oglasu, pa preporuka najisplativije.
  - Alati: `olx_sponsor_price` u petlji.
  - Nedostaje: nista. Saldo kredita dolazi iz `olx_whoami`, polje `credits`, pa se moze provjeriti i da li budzet pokriva plan.

### Srednje

- **Uvoz kataloga sa vlastitog webshopa.** Automatsko kreiranje oglasa iz vanjskog izvora, sa kategorizacijom, slikama i objavom.
  - Alati: `olx_suggest_category` ili `olx_find_category`, `olx_category_attributes`, `olx_category_brands`, `olx_category_models`, `olx_city`, `olx_create_listing`, `olx_upload_images`, `olx_set_main_image`, `olx_publish_listing`.
  - Nedostaje: mapiranje vanjskog kataloga na `attributes` po kategoriji, provjera duplikata (API nema pretragu pa se duplikat mora traziti kroz vlastitu listu oglasa), te potvrda maksimalnog broja i velicine slika.
- **Sinhronizacija stanja zaliha.** Kad artikla nema na stanju, oglas se sakrije ili zavrsi, a kad se vrati, otkrije.
  - Alati: `olx_list_listings`, `olx_hide_listing`, `olx_unhide_listing`, `olx_finish_listing`, `olx_update_listing` za `available` i `price`.
  - Nedostaje: stabilna veza izmedju vanjskog SKU i OLX oglasa. `sku_number` se moze postaviti pri kreiranju (`server.ts:423`), ali ga `olx_update_listing` ne moze naknadno mijenjati, a ni pretraga po SKU ne postoji.
- **Rotacija izdvajanja po budzetu.** Rasporedjivanje zadanog broja kredita na najvrijednije artikle, uz dohvat cijene za svaki i jednu potvrdu korisnika za cijeli plan.
  - Alati: `olx_list_listings`, `olx_sponsor_price`, `olx_sponsor_listing` sa `confirm`.
  - Nedostaje: zakazivanje u tacno vrijeme ne postoji na API-ju, pa bi vremensku komponentu morao voditi vanjski scheduler.
- **Automatski dnevni ritam obnova.** Raspored koji svakog dana obnavlja odredjeni broj oglasa tako da se mjesecna kvota rasporedi ravnomjerno umjesto da se potrosi odjednom.
  - Alati: `olx_refresh_limits`, `olx_refresh_bulk`.
  - Nedostaje: MCP server nema vlastiti scheduler, treba vanjski pokretac. Takodjer nedostaje podatak koji oglas je zadnji put obnovljen, u listi postoji samo `date` i `refresh_available` (`core/types.ts:84` i `:89`).
- **Zastita od rada na pogresnom nalogu.** Obavezna potvrda naloga prije svake operacije koja mijenja stanje ili trosi kredite.
  - Alati: `olx_list_accounts`, `olx_switch_account`, `olx_whoami`.
  - Nedostaje: izmjena servera tako da svaki write alat provjeri ocekivani nalog. Trenutno je zastita samo tekst u opisu alata (`server.ts:242`), ne kod.

### Tesko

- **Analiza konkurencije po imenu shopa.** Puni presjek tudje ponude, promocione strategije i brzine prometa. Prelazi u kategoriju srednje tezine sada kad je pristup potvrdjen.
  - Alati: `olx_list_listings` sa tudjim usernameom, stanja `active`, `finished` i `inactive`.
  - Nedostaje: nista za jedan poznati shop kojem znas username.
  - Ogranicenje: prodajne cijene zavrsenih oglasa nisu vidljive, a "zavrsen" ne znaci nuzno prodan.
- **Cjenovno pozicioniranje na nivou cijele kategorije.** Poredjenje nase cijene sa svim ponudjacima, ne samo sa shopovima koje imenom vec znamo.
  - Alati: `olx_list_listings` po pojedinacnim shopovima.
  - Nedostaje: search endpoint po kategoriji ili kljucnoj rijeci, koji ne postoji u toolkitu. Bez njega se konkurenti moraju rucno pronaci i unijeti po usernameu, sto daje nepotpunu sliku trzista.
- **Mjerenje pozicije u pretrazi.** Provjera na kojem mjestu se nas oglas pojavljuje za zadatu kljucnu rijec.
  - Alati: nijedan postojeci ne moze ovo.
  - Nedostaje: search endpoint sa poretkom rezultata. Ne postoji ni u kodu ni u dokumentaciji.
- **Optimizacija naslova na osnovu stvarnih pojmova pretrage.** Dopisivanje fraza koje kupci stvarno kucaju, sto interni vodic navodi kao najkorisniji potez.
  - Alati: `olx_update_listing` za samu izmjenu.
  - Nedostaje: izvor podataka. Statistika i "pojmovi na pretrazi" nisu dostupni kroz API, samo kroz web ili aplikaciju.
- **Mjerenje povrata ulozenih kredita.** Racunanje da li se izdvajanje isplatilo.
  - Alati: `olx_sponsor_price` za trosak.
  - Nedostaje: brojevi pregleda i upita prije i poslije izdvajanja. Ne postoje kroz API.

---

## Sazetak rizika

- Dva prava tokena i jedna lozinka stoje u cistom tekstu u `.env` (`.env:26`, `.env:29`, `.env:30`). Fajl je izvan gita, ali lozinku u komentaru treba ukloniti.
- Promjena naloga kroz `olx_switch_account` je globalna i tiha. Nema tehnicke provjere prije trosenja kredita ili brisanja.
- Retry se izvrsava i na POST i PUT pozivima (`core/index.ts:160`), ukljucujuci `sponsore`, `refresh` i `publish`. Ako API vrati 5xx nakon sto je radnju vec proveo, ponavljanje moze dovesti do dvostrukog izvrsenja. Kod nema idempotency kljuc.
- Nema detekcije isteka tokena ni automatskog ponovnog logina.
- Svi limiti oko slika (broj, velicina, format) su neprovjereni i nisu validirani lokalno.

---

## Propusteno / preporuke (popis za buduce izmjene koda)

Stanje 26.07.2026. Kod se u konsolidaciji znanja nije dirao; ovo je red vožnje za sljedecu
rundu, poredano po odnosu koristi i truda.

1. **Tvrdi limit 750 u bulk obnovi** (`src/mcp/server.ts:472`, `z.number().max(750)`). Pisano po
   zastarjeloj brojci; Gold nalozi vracaju `free_limit` 1800. Podici na 4600 ili ukloniti gornju
   granicu (stvarni cap se ionako racuna iz `free_limit - free_count` na `server.ts:481`).
2. **`GET /users/:username` implementirati kao `olx_user_profile`** (read-only). Endpoint
   postoji i radi (potvrdjeno zivim pozivom), vraca paket, poslovne podatke, ocjene i vrijeme
   odgovora tudjeg shopa. Osnova za analizu konkurencije; sada se poziva rucno curl-om.
3. **`olx_update_listing` ne prima `category_id` ni `sku_number`** iako jezgro to podrzava
   (`core/types.ts:69`). Blokira premjestanje oglasa u tacnu kategoriju (cest prvi savjet iz
   analize) i sync sa Shopify zalihom.
4. **Korpus podrske izloziti kao MCP resource**: `olx://pomoc-index` (CSV pregled) plus
   pojedinacni clanci, po uzoru na categories-index. Kompletni fajl od 176 KB ne izlagati kao
   jedan resource.
5. **Retry bez idempotency kljuca na POST/PUT** (`core/index.ts:160`): kod 5xx nakon vec
   izvrsene radnje moguce dvostruko izvrsenje, ukljucujuci dvostruku naplatu izdvajanja.
   Najmanje: iskljuciti retry za `sponsore` i `discount`.
6. **Spend-guard nema nijedan test.** Jedan test da `sponsorListing` bez `confirm` NE salje
   POST (i da baca `OlxSpendError`) cuva jedinu zastitu od trosenja kredita od regresije.
   Trenutno testovi pokrivaju samo `match.ts` (17 testova).
7. **Detekcija isteka tokena**: 401/403 tretirati kao signal za relogin kad postoje
   kredencijali, umjesto generičke poruke.
8. **`.mcp.json` ne prosljedjuje `OLX_PROFILE`** iako je multiprofil glavna funkcija; default
   registracija je jednonalogna, README obilaznicu opisuje rucno.
9. **Lozinka u komentaru `.env:29`** — izbaciti, drzati u keychainu.
10. **Iz PLAN.md obecano a neuradjeno**: cron auto-obnova, planer izdvajanja, audit log
    (zapis svake write operacije sa nalogom, alatom i ishodom — korisno cim vise ljudi radi
    sa vise klijenata).
11. **Otvoreno mjerenje**: `olx_refresh_limits` na nalogu koji nije Gold — razlucuje da li
    kvota obnova prati paket ili je 1800 za sve shop pakete.
