# Korištenje olx-pik MCP alata i sigurno izvršenje

Ako je `olx-pik` MCP server dostupan, koristi ga da provjeriš stvarno stanje naloga umjesto da
nagađaš (koji su oglasi aktivni, šta je već izdvojeno, cijene). Alati se učitavaju preko
pretrage alata; nazivi su na bosanskom i počinju sa `olx_`.

## Redoslijed rada (uvijek isti)

1. **Provjeri aktivni nalog prije svega.** Pozovi `olx_list_accounts` (ili `olx_whoami` ako
   postoji) da potvrdiš na kom si nalogu. Server radi na jednom aktivnom nalogu.
2. **Po potrebi promijeni nalog** sa `olx_switch_account` i obavezno potvrdi korisniku na koji si
   nalog prešao PRIJE bilo kakvog upisa ili troška, da se radnja ne izvrši na pogrešnom klijentu.
3. **Čitaj stanje** (bezopasno): `olx_list_listings` (po stanju: active, finished, inactive,
   expired, hidden), `olx_get_listing` za pojedinačni oglas, `olx_category` za pravila i cijene
   kategorije.
4. **Provjeri šta je već izdvojeno** prije nego predložiš nova izdvajanja, da se ne duplira.
5. **Izvrši samo uz potvrdu** (vidi niže).

## Glavni alati

| Alat | Šta radi | Troši kredite / nepovratno |
|---|---|---|
| `olx_list_accounts` | Aktivni nalog i profili | Ne |
| `olx_switch_account` | Mijenja aktivni nalog | Ne (ali potvrdi prelazak) |
| `olx_list_listings` | Lista oglasa po stanju | Ne |
| `olx_get_listing` | Pojedinačni oglas po ID-u | Ne |
| `olx_category` | Pravila i cijene kategorije | Ne |
| `olx_sponsor_price` | Cijena izdvajanja u kreditima | Ne (samo upit) |
| `olx_sponsor_listing` | Izdvaja oglas | DA, troši kredite |
| `olx_set_discount` | Postavlja akcijsku cijenu | DA, troši kredite |
| `olx_finish_discount` | Završava akcijsku cijenu | Ne |
| `olx_refresh_listing` | Obnavlja jedan oglas | Besplatno do kvote |
| `olx_refresh_bulk` | Obnavlja više aktivnih | Besplatno do kvote |
| `olx_hide_listing` / `olx_unhide_listing` | Sakriva / vraća oglas | Ne |
| `olx_finish_listing` | Završava oglas (prodano) | Ne |
| `olx_delete_listing` | Nepovratno briše oglas | Nepovratno, izbjegavaj |

Imena se mogu malo razlikovati po verziji servera; ako alat ne postoji, pretraži dostupne alate
ponovo prije nego zaključiš da ga nema.

## Sigurno izvršenje (obavezno)

- **Akcije koje troše kredite** (`olx_sponsor_listing`, `olx_set_discount`) i **nepovratne
  akcije** (`olx_delete_listing`) NIKAD ne pokreći bez izričite potvrde korisnika. Prvo pripremi
  plan sa ID-evima, periodom, tipom obnove i ukupnim troškom, pa sačekaj jasno "izvrši".
- **Prije izdvajanja provjeri stvarnu cijenu** preko `olx_sponsor_price` ako alat postoji, jer je
  cijena dinamična; ne oslanjaj se samo na statički cjenovnik.
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
- Obnova: `GET /listing/refresh/limits` (vraća `free_limit: 750`, `free_count`, `paid_count`),
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
- `days`: 1, 2, 3, 5, 7, 14, 21, 30.
- `refresh_every`: 0, 3, 8, 24 (sati). API ponegdje navodi i 3/6/8/24; interval od 6 sati je
  NEPOTVRĐEN na zvaničnom izvoru. Cjenovnik u skillu pokriva 8h, 24h (svaki dan) i bez obnove.
- `locations`: `["homepage"]` za prikaz i na naslovnici.

### Životni ciklus oglasa (DRAFT zamka)

Kreiraj (`POST /listings` daje DRAFT, nevidljiv) → upload slika → postavi glavnu sliku →
`publish`. Ako se preskoči publish, oglas ostaje nevidljiv. Uvijek provjeri da je oglas objavljen.

### Zaštite u alatu (obavezno)

- Prije `sponsore` i `discount` uvijek dohvati cijenu (`sponsore/price`) i traži potvrdu.
- Prije bulk obnove provjeri `refresh/limits` i ne prelazi 750 besplatnih.
- Ne briši radi re-rankinga; koristi refresh ili hide.
- Tokeni u env varijablama ili keychainu, po korisniku, nikad u kodu ili gitu.
- Ne logiraj lične podatke kupaca; ne izvozi cijene kredita ni marže u materijale za klijente.
