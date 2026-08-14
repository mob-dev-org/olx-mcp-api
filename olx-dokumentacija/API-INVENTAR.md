# Inventar mogucnosti OLX/PIK API-ja u ovom MCP serveru

Dokument je napravljen iskljucivo citanjem izvornog koda i dokumentacije u repozitoriju. Nijedan poziv prema API-ju nije izvrsen, nijedan postojeci fajl nije mijenjan.

Svaka tvrdnja ima referencu na fajl i broj linije. Gdje se iz koda ne moze utvrditi odgovor, pise "nepoznato".

Bazni URL je `https://api.olx.ba`, konfigurabilan kroz `OLX_BASE_URL` (`src/core/config.ts:37`).

---

## 1. Tabela alata

Ukupno 34 registrovana MCP alata. Svi dodiruju API; nema vise alata koji rade samo nad lokalnom konfiguracijom.

Izmjene od 26.07.2026.: dodan `olx_user_profile`; `olx_delete_listing` uklonjen (brisanje kroz bota nije moguce, ostaje CLI `listings rm`); `olx_list_accounts` i `olx_switch_account` uklonjeni, jer jedan klon repozitorija radi za jedan nalog. Brojevi linija u tabeli su iz stanja prije te zadnje izmjene i mogu biti pomjereni; putanje i imena alata vaze.

Izmjene od 27.07.2026. (poredjenje sa zvanicnom dokumentacijom api-documentation.olx.ba, vidi `analiza-api-dokumentacije.md`): dodan `olx_country_states`; `olx_sponsor_price` i `olx_sponsor_listing` primaju opcioni `locations` niz pored `homepage` boolean-a (API prima `locations` kao niz stringova; "homepage" je jedina dokumentovana vrijednost, ostale mogu vratiti 422). Zivo provjereno 27.07.2026.: `sponsore/price` sa `locations: ["homepage"]` vraca komponentu `locations` u cijeni.

Izmjene od 27.07.2026., druga runda (agregacioni sloj, ukupno sada 39 alata): dodano 5 read-only agregata koji vise API poziva sazmu u kompaktan rezultat — `olx_profile_stats` (statistika naloga; views: none/sample/snapshot), `olx_competitor_report` (analiza tudjeg naloga po username-u, opcioni top_views), `olx_listing_report` (izracunata analiza jednog oglasa, radi i za tudje), `olx_account_alerts` (alarmi: pitanja, paket, krediti, kvota, istekli), `olx_sponsor_effect` (efekat izdvajanja iz dnevnih snapshota). Snapshote pravi CLI `stats snapshot` u `.olx-pik/snapshots/views-YYYY-MM-DD.json` (jedan zahtjev po oglasu, za cron). Logika je u `src/core/stats.ts` (ciste funkcije) i orkestratorima na `OlxClient` (`statsProfil`, `statsKonkurent`, `statsOglas`, `statsAlarmi`); paginator `listAllByState` radi za svih pet stanja. Usput: `olx_list_listings` i `olx_get_listing` po defaultu vracaju kompaktan oblik (`full: true` za sirovi API oblik), `all` na listi radi za sva stanja, a `ok()` u MCP serveru vise ne pretty-printa niti duplira payload u structuredContent (kompaktna lista je ~4,5x manja od sirove, mjereno).

Izmjene od 13.08.2026. (kvota objave, eskalacija alarma, prioritet objave; `docs/stories/1.2.*`): `olx_profile_stats` dobija `objava_limit` (preostalo/iskoristeno_procenat/status po grupi kategorija, racunato iz `olx_listing_limits` odgovora) i uslovni `objava_kandidati_predlog` (sortiran po najduze-neobnavljano, samo kad je grupa blizu/na limitu). `olx_account_alerts` alarm `paket` eskalira na tri nivoa (info/upozorenje/hitno, 30/14/3 dana), novi alarm `objava_limit`; `statsProfil`/`statsAlarmi` sada zovu i `listingLimits()` (7->8 i 3->4 API poziva). `olx_izuzeca` dobija treci opseg `objava`. `olx_list_listings` dobija filtere `category_id`/`price_min`/`price_max`. Cijena mjerena `npm run kontekst`: MCP seme +413 tokena (+4.2%).

Izmjene od 14.08.2026. (uklonjen tihi rez na 1000 oglasa u prelistavanju): `listAllByState`/`listAllActive` vise ne staju tiho na 50 stranica, nego vracaju `SviOglasi { oglasi, potpuno, ukupno, razlog }` uz osigurac stranica (`OLX_MAX_STRANICA_LISTE`) i budzet vremena (`OLX_BUDZET_LISTE_MS`/`OLX_BUDZET_LISTE_GRUPNI_MS`), detalji u `arhitektura.md` sekcija 10. Novi alati `olx_bulk_price` i `olx_bulk_sklanjanje` (grupne izmjene, koriste `Set` umjesto `includes` za provjeru ID-eva). `olx_refresh_bulk`, `olx_find_my_listing`, `olx_sponsor_plan` i `olx_sablon_opisa` sada rade sa ovim novim oblikom liste, svaki po svom pravilu (vidi tabelu ispod). `olx_list_listings` sa `all` isporucuje katalog u komadima kroz nov parametar `komad` (redni broj komada, vrijedi samo uz `all: true`), umjesto da odbije ili tiho sijece iznad `OLX_MAX_OGLASA_U_ODGOVORU` (500).

Legenda kolone "Kredit": da = poziv sigurno trosi kredite, moguce = zavisi od kategorije ili paketa, ne = ne trosi.

| MCP alat | HTTP metoda i putanja | Sta radi | Obavezni parametri | Opcioni parametri | R/W | Kredit | Nepovratno |
|---|---|---|---|---|---|---|---|
| `olx_whoami` (`server.ts:279`) | GET `/me` (`core/index.ts:228`) | Vraca podatke o nalogu iz tokena, sluzi kao test pristupa. | nema | nema | read | ne | ne |
| `olx_user_profile` (`server.ts:404`) | GET `/users/:username` (`core/index.ts:263`) | Javni profil korisnika ili shopa: paket, poslovni podaci, ocjene, medalje, vrijeme odgovora, datum registracije. Radi bez tokena vlasnika, pa je osnova za analizu konkurencije i kandidata. Numericki id vraca 404, prihvata samo username. | `username` | nema | read | ne | ne |
| `olx_list_listings` (`server.ts:416`) | GET `/users/:user/listings` (`core/index.ts:365`), `/finished` (`:347`), `/inactive` (`:352`), `/expired` (`:357`), `/hidden` (`:362`) | Lista vlastite oglase po stanju, paginirano. Od 13.08.2026.: opcioni `category_id`/`price_min`/`price_max` filtriraju REZULTAT prije kompaktiranja (sirov API odgovor nosi oba polja po stavci), da se spisak id-eva za bulk `olx_izuzeca` dobije bez rucnog pregleda stotina oglasa. Kompaktan oblik NIJE dobio novo polje za kategoriju/cijenu (trosak tokena na velikom katalogu za onog ko ne filtrira). Od 14.08.2026.: `all: true` isporucuje veliki katalog u komadima po `OLX_MAX_OGLASA_U_ODGOVORU` (500 oglasa, oko 10.000 tokena); sljedeci komad se zahtijeva parametrom `komad`. Alternativa: provjeriti kroz `olx_profile_stats` ili suziti filterom ako cjelokupna lista nije potrebna. | nema (default `state=active`, korisnik se izvlaci iz tokena, `server.ts:355`) | `state`, `user`, `page`, `all`, `category_id`, `price_min`, `price_max`, `komad` | read | ne | ne |
| `olx_bulk_price` | grupni upis: GET liste (paginator) + PUT `/listings/:id` po stavci | Mijenja cijenu na vise oglasa odjednom (`postotak` / `fiksno` / `postavi`), po `ids` ili `category_id`. `confirm=false` (default) je dry-run, samo pregled stara naspram nova cijena. Od 14.08.2026.: sa zadatim `ids` (do 60) cita samo te oglase kroz `getListing`, bez prelistavanja kataloga; inace cita katalog i ODBIJA rad (i u dry-run) kad ga ne procita u cijelosti, jer bi izmjena cijene tiho preskocila dio oglasa. Razlog `katalog_se_mijenjao` dobija jedan automatski ponovni pokusaj. Koristi `Set` za provjeru zadatih ID-eva umjesto `includes` (O(n) umjesto O(n*m)). | `pravilo`, `iznos` | `category_id`, `ids`, `limit` (500), `confirm` | write kad `confirm=true` | ne | ne, rucno se ne vraca |
| `olx_bulk_sklanjanje` | grupni upis: GET liste (paginator) + POST `/listings/:id/hide` ili `/finish` po stavci | Sklanja vise oglasa odjednom: `hide` (artikal se vraca na stanje) ili `finish` (prodano, ostaje u historiji). `confirm=false` (default) vraca samo listu. Od 14.08.2026.: kratak spisak `ids` (do 60) cita kroz `getListing` bez prelistavanja kataloga, i tada ne tvrdi da je oglas aktivan nego vraca `stanje_provjereno: false`; dug spisak ide preko kataloga i ODBIJA rad (i u dry-run) kad ga ne procita u cijelosti, isti razlog kao `olx_bulk_price`. Koristi `Set` umjesto `includes` za ID-eve. | `ids`, `radnja` | `confirm` | write kad `confirm=true` | ne | `finish` se kroz server NE moze ponistiti |
| `olx_find_my_listing` (`server.ts:875`) | GET liste po stanju (paginator `listAllByState`) + lokalno TF-IDF rangiranje (`core/match.ts`, `nadjiPoUpitu`) | Nadje JEDAN poznat oglas po slobodnom opisu. Poredi RIJECI naslova, ne znacenje: NE garantuje potpunost i nije za "svi artikli grupe" (tada `olx_list_listings all:true` pa odabir po znacenju; izmjereno 29.07.2026. na zivom nalogu: upit "radne cipele" nasao 10 od 44 komada obuce). Rezultat nosi `napomena` sa ovom granicom. Od 14.08.2026.: kad je lista nepotpuna, ODBIJA umjesto da javi "nema pogodaka" — negativan zakljucak iz nepotpunog skupa bio bi ista greska kao lazan spisak "nisu aktivni". | `upit` | `state`, `limit` | read | ne | ne |
| `olx_get_listing` (`server.ts:364`) | GET `/listings/:id` (`core/index.ts:261`) | Dohvata jedan oglas po ID-u. | `id` | nema | read | ne | ne |
| `olx_suggest_category` (`server.ts:370`) | GET `/categories/suggest?keyword=` (`core/index.ts:427`) | Predlaze kategoriju na osnovu naslova i vraca broj oglasa. | `keyword` | nema | read | ne | ne |
| `olx_find_category` (`server.ts:376`) | GET `/categories/find?name=` (`core/index.ts:431`) | Pronalazi kategoriju po imenu i vraca puni path. | `name` | nema | read | ne | ne |
| `olx_category_attributes` (`server.ts:382`) | GET `/categories/:id/attributes` (`core/index.ts:415`) | Vraca atribute (forme) kategorije, sa `required` i `options`. | `id` | nema | read | ne | ne |
| `olx_refresh_limits` (`server.ts:388`) | GET `/listing/refresh/limits` (`core/index.ts:290`) | Limiti obnove u ciklusu: `free_limit`, `free_count`, `paid_count`, `listing_count` (`core/types.ts:98`). | nema | nema | read | ne | ne |
| `olx_sponsor_price` (`server.ts:394`) | GET `/listings/:id/sponsore/price` (`core/index.ts:510`) | Racuna cijenu izdvajanja u kreditima, bez naplate. | `id`, `type`, `days` | `refresh_every` (default 0), `homepage`, `locations` (niz; "homepage" jedina dokumentovana vrijednost) | read | ne | ne |
| `olx_sponsor_plan` | GET cijene po kandidatu + `buildPlan` iz `core/plan.ts` (racuna kod, ne model) | Cijeli plan izdvajanja: kandidati, cijene sa API-ja, raspored po danima do budzeta. Nista ne naplacuje; `sacuvaj: true` upise plan u `.olx-pik/plan-izdvajanja.json` (prate ga sedmicni izvjestaj i CLI `sponsor plan izvrsi`). Kod automatskog odabira kandidata (bez zadatih `oglasi`) trazi NAJSTARIJE oglase, a to je bas dio kataloga koji budzet odsijeca, pa od 14.08.2026. cita katalog OD KRAJA uz provjeru poretka (`listNajstarijiAktivni`); kad poredak nije pouzdan ili kandidata ostane premalo, cita cijeli katalog i ODBIJA ako ni on nije potpun, umjesto da predlozi kandidate koji nisu najstariji. Odgovor nosi `izbor` sa kojim putem je odabir napravljen. | `budzet` | `dana` (7), `type` (2), `days`, `refresh_every`, `homepage`, `oglasi` (ID-evi; bez toga najstariji neizdvojeni), `broj_oglasa` (40), `sacuvaj` (false) | read + opcioni upis plana na disk | ne | ne |
| `olx_opisi_sliku` | Google Gemini (`core/vid.ts` + `core/gemini.ts`, model iz `OLX_VID_MODEL`, default gemini-3.1-flash-lite; iskljucivo Gemini od 04.08.2026.), NE zove OLX | Vision proxy: opis slike sa diska za sesije ciji pogon nema vid (DeepSeek slike ignorise). Registruje se kad postoji Gemini kljuc (`OLX_SLIKA_API_KEY` ili poseban `OLX_VID_API_KEY`). Trosak ide u `.olx-pik/ai-usage.jsonl`, ne u kredite. | `putanja` | `pitanje` (default: opis proizvoda za oglas) | read (poziv vanjskog AI-ja) | ne | ne |
| `olx_generiraj_sliku` | Google Gemini `generateContent` (`core/slika.ts` + `core/gemini.ts`, model iz `OLX_SLIKA_MODEL`, default gemini-3.1-flash-lite-image; izmjereno 30.07.2026. oko $0.041 po slici jer se izlazna SLIKA naplacuje $30 po milionu tokena, odvojeno od izlaznog teksta; 4:3 daje 1200x896 i oko 1370 tokena; ulazna slika klijenta je 1120 tokena, oko $0.00028, dakle prakticno besplatna), NE zove OLX | Iz poslane fotografije napravi novu sliku artikla: cist prostor, ravno svjetlo, artikal ostaje isti. Registruje se SAMO kad je `OLX_SLIKA_API_KEY` postavljen. Trosi vanjski AI racun, ne kredite, pa trazi `confirm` i ima dnevni plafon `OLX_SLIKA_MAX_DNEVNO`. Slika pada u `.olx-pik/slike/`, putanja je spremna za `olx_upload_images`. | `recept` | `slike[]` (do 3), `logo`, `odnos` (default 4:3), `confirm` | write (fajl na disk, vanjski trosak) | ne | ne |
| `olx_pozadina` | ne zove nista (`core/pozadina.ts`, stanje u `.olx-pik/pozadina/`) | Stalna pozadina klijenta koju koristi recept `pozadina-klijenta`: opis rijecima, slika, ili oboje. Slika se KOPIRA u klon, pa original iz Telegram inboxa smije nestati. Ide u OBA profila; opis prolazi isti filter kao `dopuna`. Pozadina se svaki put crta iznova, dakle slicna a nikad identicna, i tekst ili logo na njoj ce biti iskrivljen. Registruje se samo kad je `OLX_SLIKA_API_KEY` postavljen. | `radnja` (`postavi`/`prikazi`/`ukloni`) | `opis` (do 200 znakova), `slika` | write (fajl na disk) | ne | ne |
| `olx_prijedlozi` | lokalni folder `.olx-pik/prijedlozi/` (`core/prijedlozi.ts`), NE zove OLX | Cita prijedloge sedmicne AI runde. Postoji jer je `Read` nad `.olx-pik` klijentskoj sesiji zabranjen, pa je do 30.07.2026. "primijeni prijedloge" davalo odbijenu dozvolu iako tri mjesta u dokumentaciji tvrde da radi. Alat pusta SAMO prijedloge; ime fajla sa putanjom se odbija. | `radnja` (lista/procitaj) | `ime` | read | ne | ne |
| `olx_sablon_opisa` (SAMO_ADMIN) | `GET /listings` + `GET /listings/:id` po uzorku, racun u `core/opisi.ts` | Mjeri koji se zavrsni blokovi i fraze STVARNO ponavljaju u klijentovim opisima, sa brojem pojava. Za onboarding: standardni footer se prepoznaje iz kataloga umjesto da se izmisli. Kad se nista ne ponavlja to i kaze; izmjereno na pravom shopu da sablon cesto NE postoji (2 od 25 opisa). RADI i nad nepotpunom listom (uzorkuje sto je procitano, ne mijenja stanje); nepotpunost se prijavljuje u odgovoru kao `obuhvat`. | nema | `broj_oglasa` (default 25), `min_pojava` (default 3) | read | ne | ne |
| `olx_zapamti` | lokalni fajl `.olx-pik/pamcenje.json` (`core/pamcenje.ts`), NE zove OLX | Trajno pamcenje o klijentu (ton, footer opisa, kontakt, radno vrijeme, dostava, placanje, plus napomene). Polja su FIKSNA jer bi slabiji model sa slobodnim kljucevima izmisljao shemu. Citanje botu ne treba: `scripts/sastavi-prompt.mjs` pamcenje ubacuje u sistemski prompt pri svakom startu sesije, pa zapisano vazi od sljedeceg razgovora. | `radnja` (zapisi/zabravi/lista) | `polje`, `vrijednost`, `napomena` | write (lokalni fajl) | ne | ne |
| `olx_izuzeca` | lokalni fajl `.olx-pik/izuzeca.json` (`core/izuzeca.ts`), NE zove OLX | Spisak oglasa koje vlasnik ne zeli automatski dizati; opseg `obnova`, `izdvajanje`, `objava` (od 13.08.2026., prioritet za objavu kad katalog udari u limit kategorije) ili `sve`. Cita ga CLI `refresh all` (dnevni cron), `olx_refresh_bulk` i automatski odabir u `olx_sponsor_plan`, pa izuzet oglas ne ulazi ni u obnovu ni u plan. Opseg `objava` je NAMJERNO izolovan od `odvojiIzuzete("obnova")` — nikad ne blokira dnevnu obnovu tiho, samo je oznaka za klijentovu odluku. Preskoceni se uvijek prijavljuju u rezultatu, jer tiho preskakanje izgleda kao da obnova ne radi. | `radnja` (lista/dodaj/skloni) | `ids`, `opseg` (default sve), `razlog` | write (lokalni fajl) | ne | ne |
| `olx_categories` (`server.ts:419`) | GET `/categories` (`core/index.ts:403`) | Top level kategorije. | nema | nema | read | ne | ne |
| `olx_category_children` (`server.ts:425`) | GET `/categories/:id` (`core/index.ts:407`) | Podkategorije date kategorije. | `id` | nema | read | ne | ne |
| `olx_category` (`server.ts:431`) | GET `/category/:id` (`core/index.ts:411`) | Detalji kategorije: `listing_fee`, `base_listing_price`, `brand_required`, `model_required`, `show_map`, `show_condition`. | `id` | nema | read | ne | ne |
| `olx_category_brands` (`server.ts:437`) | GET `/categories/:id/brands` (`core/index.ts:419`) | Brendovi u kategoriji. | `id` | nema | read | ne | ne |
| `olx_category_models` (`server.ts:443`) | GET `/categories/:id/brands/:brandId/models` (`core/index.ts:423`) | Modeli za zadati brend. | `id`, `brandId` | nema | read | ne | ne |
| `olx_listing_limits` (`server.ts:449`) | GET `/listing-limits` (`core/index.ts:294`) | Limiti broja oglasa po grupama kategorija, sirov proxy. Izracunata verzija (preostalo/iskoristeno_procenat/status po grupi) je od 13.08.2026. dio `olx_profile_stats` (`objava_limit`), ne ovog alata — ovaj ostaje sirovi uvid, agregat racuna. | nema | nema | read | ne | ne |
| `olx_countries` (`server.ts:455`) | GET `/countries` (`core/index.ts:459`) | Lista drzava. | nema | nema | read | ne | ne |
| `olx_cities` (`server.ts:461`) | GET `/cities` (`core/index.ts:455`) | Entiteti i regije (sadrze kantone). | nema | nema | read | ne | ne |
| `olx_city` (`server.ts:467`) | GET `/cities/:id` (`core/index.ts:463`) | Detalji grada: lat, lon, zip, canton_id, state_id. | `id` | nema | read | ne | ne |
| `olx_canton_cities` (`server.ts:473`) | GET `/cantons/:id/cities` (`core/index.ts:471`) | Gradovi u kantonu. | `id` | nema | read | ne | ne |
| `olx_country_states` (dodan 27.07.2026.) | GET `/country-states` (`core/index.ts:466`) | Entiteti/regije drzave sa kantonima, isti oblik kao `olx_cities`. | nema | nema | read | ne | ne |
| `olx_create_listing` (`server.ts:481`) | POST `/listings` (`core/index.ts:267`) | Kreira oglas u DRAFT stanju, jos nije vidljiv. | `title` (max 65 znakova, `server.ts:267`), `category_id` (`server.ts:489`) | `short_description`, `description`, `country_id`, `city_id`, `price`, `available`, `listing_type`, `state`, `brand_id`, `model_id`, `sku_number`, `attributes` | write | moguce, u naplativim kategorijama objava se placa kreditima (`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:159`); indikator je `listing_fee` i `base_listing_price` iz `olx_category` | ne, DRAFT se moze obrisati |
| `olx_link_oglasa` (nije alat, `core/link.ts`) | nema poziva, sastavlja se lokalno | **Javni link na oglas API NE vraca**, ali se sastavlja od `id`, a `slug` sa oglasa ga cini citljivim. Provjereno zivim pozivom 30.07.2026: `https://olx.ba/artikal/<id>` i verzija sa slugom vracaju HTTP 200. Link se od tada vraca iz `olx_create_listing`, `olx_publish_listing` i `olx_get_listing` (kompaktan oblik). Domen je u `OLX_PUBLIC_URL` zbog rebranda. | nema | nema | lokalno | ne | ne |
| `olx_publish_listing` (`server.ts:508`) | POST `/listings/:id/publish` (`core/index.ts:282`) | Objavljuje DRAFT, oglas postaje aktivan i javno vidljiv. Od 30.07.2026. nosi ISTU branu troska kao kreiranje: cita kategoriju oglasa i bez `confirm` u naplatnoj kategoriji NE objavljuje, a nepoznata naknada se tretira kao naplatna. Svjesna posljedica: u toku kreiraj pa objavi se isti oglas dva puta racuna u dnevni plafon, sto je konzervativan smjer. | `id` | `confirm` | write | da, brana sada stoji i ovdje jer tacan trenutak naplate (create ili publish) nije izmjeren | da u smislu javne objave, oglas postaje vidljiv svima |
| `olx_update_listing` (`server.ts:602`) | PUT `/listings/:id` (`core/index.ts:300`) | Mijenja polja oglasa. Od 26.07.2026. izlaze sva polja koja jezgro podrzava. | `id` | `title`, `description`, `short_description`, `price`, `available`, `category_id`, `sku_number`, `state`, `listing_type`, `country_id`, `city_id`, `brand_id`, `model_id`, `attributes` Od 30.07.2026.: kad izmjena nosi `category_id`, prolazi kroz branu troska (prebacivanje u naplatnu kategoriju bez `confirm` se odbija), jer je to bio drugi ulaz u istu rupu. | write | ne | ne, ali prepisuje prethodne vrijednosti bez backupa u kodu; IZMJERENO 29.07.2026: API na zivom oglasu `category_id` tiho ignorise, kategorija se poslije objave ne mijenja (vidi granice.md) |
| `olx_refresh_listing` (`server.ts:545`) | PUT `/listings/:id/refresh` (`core/index.ts:298`) | Obnavlja oglas, daje svjez datum i dize rang. | `id` | nema | write | ne dok ima besplatnih obnova; API prati i `paid_count` (`core/types.ts:101`), sto znaci da postoje i naplacene obnove | ne, ali trosi jednu obnovu iz besplatne kvote |
| `olx_refresh_bulk` (`server.ts:551`) | GET `/listing/refresh/limits` + GET `/users/:user/listings` (sve stranice) + PUT `/listings/:id/refresh` u petlji (`server.ts:566` do `server.ts:585`) | Grupno obnavlja aktivne oglase kojima je obnova dostupna, uz postovanje preostale besplatne kvote. Od 14.08.2026.: RADI i nad nepotpunim katalogom (obnova je besplatna i ne pravi pogresno stanje), obuhvat ide u odgovor; `results` do 4600 stavki zamijenjen sa `neuspjeli` (samo greske, ne cijeli niz). | nema | `user`, `limit` (1 do 4600, default 100; stvarni cap je `free_limit - free_count`), `confirm` (default false, dry run) | write kad je `confirm=true`, inace read | ne dok se ne prekoraci besplatna kvota; kod tvrdo ogranicava na `free_limit - free_count` (`server.ts:569`) | ne, ali trosi obnove iz kvote |
| `olx_hide_listing` (`server.ts:589`) | POST `/listings/:id/hide` (`core/index.ts:345`) | Sklanja oglas iz pretrage, ostaje na profilu. | `id` | nema | write | ne | ne, postoji `olx_unhide_listing` |
| `olx_unhide_listing` (`server.ts:595`) | POST `/listings/:id/unhide` (`core/index.ts:349`) | Vraca skriveni oglas u pretragu. | `id` | nema | write | ne | ne |
| `olx_finish_listing` (`server.ts:667`) | POST `/listings/:id/finish` (`core/index.ts:341`) | Oznacava oglas kao zavrsen ili prodan, cuva historiju. | `id` | nema | write | ne | nepoznato da li se zavrseni oglas moze vratiti u aktivne, u kodu nema takvog poziva |
| `olx_skini_artikal` | GET `/listings/:id` + download slika + POST `/listings/:id/hide`; arhiva u `.olx-pik/arhiva-artikala/<id>/` (`core/arhiva.ts`) | Arhivira oglas (opis + ORIGINALNE slike kao bajtove) pa ga sakrije. Za artikal kojeg nema na stanju a vratice se; arhiva je osiguranje za slucaj da oglas kasnije zavrsi ili nestane. | `id` | nema | write (API + lokalni fajlovi) | ne | da, `olx_vrati_artikal` |
| `olx_arhiva` | lokalni fajlovi `.olx-pik/arhiva-artikala/` (`core/arhiva.ts`), NE zove OLX | Pregled arhive skinutih artikala: lista (id, naslov, kada, broj slika, ponovo objavljen) ili pun zapis jednog. | `radnja` (lista/detalj) | `id` (za detalj) | read | ne | read only |
| `olx_vrati_artikal` | GET `/listings/:id`, pa POST `/listings/:id/unhide` ILI create+upload+publish iz arhive | Vraca skinuti artikal: skriven se otkrije (isti oglas, besplatno); kad oglasa vise nema, objavi NOVI iz arhive sa originalnim slikama, prenese izuzece na novi id i oznaci arhivu. Brana duple objave: odbija kad je ranije vraceni oglas jos aktivan, osim uz `ignorisi_prethodnu_objavu`. | `id` (originalni broj) | `confirm` (naplatne kategorije), `ignorisi_prethodnu_objavu`, `potvrdi_spornu_robu` | write | da, kad je objava iz arhive u naplatnoj kategoriji (ista brana kao create/publish) | otkrivanje da; nova objava se moze zavrsiti ili sakriti |
| `olx_upload_images` (`server.ts:613`) | POST `/listings/:id/image-upload`, multipart polje `images[]` (`core/index.ts:309`) | Dodaje slike na oglas. URL-ovi se prvo preuzmu pa salju kao fajl, jer API ne prihvata `image_url` (`core/index.ts:301`). | `id` i bar jedno od `urls` / `file_paths` (`server.ts:628`) | `urls`, `file_paths` | write | ne | ne, slike se mogu brisati |
| `olx_set_main_image` (`server.ts:638`) | POST `/listings/:id/image-main` (`core/index.ts:337`) | Postavlja glavnu sliku oglasa. | `id`, `imageId` | nema | write | ne | ne |
| `olx_delete_image` (`server.ts:649`) | POST `/listings/:id/image-delete` (`core/index.ts:333`) | Brise sliku sa oglasa. VAZNO: `imageId` se dobija SAMO kao povratna vrijednost uploada; nema GET endpointa koji vraca slike sa ID-evima (pun oglas daje samo URL-ove). Slike koje je klijent dodao kroz aplikaciju se zato NE mogu obrisati ni postaviti kao glavne. Izmjereno 30.07.2026. | `id`, `imageId` | nema | write | ne | da za samu sliku, nema undo poziva u kodu |
| `olx_sponsor_listing` (`server.ts:662`) | POST `/listings/:id/sponsore` (`core/index.ts:534`) | Izdvaja oglas. Bez `confirm=true` samo dohvati cijenu i baca `OlxSpendError` (`core/index.ts:521` do `:509`). | `id`, `type`, `days`, `confirm=true` za stvarnu naplatu | `refresh_every`, `homepage`, `locations` (niz; "homepage" jedina dokumentovana vrijednost) | write | da | da, potroseni krediti se ne vracaju |
| `olx_set_discount` (`server.ts:689`) | POST `/listings/:id/discount` (`core/index.ts:548`) | Postavlja akcijsku cijenu, premium opcija. Bez `confirm=true` baca `OlxSpendError` (`core/index.ts:542`). | `id`, `price`, `days` (3, 7 ili 30), `confirm=true` | nema | write | da | da, potroseni krediti se ne vracaju |
| `olx_finish_discount` (`server.ts:705`) | POST `/listings/:id/discount/finish` (`core/index.ts:552`) | Zavrsava aktivnu akcijsku cijenu. | `id` | nema | write | ne za sam poziv, ali ranije potroseni krediti se ne vracaju | da, prekid akcije prije isteka |

### Metode u jezgru koje nisu izlozene kao MCP alat

- `login()`, POST `/auth/login` (`core/index.ts:201`). Dostupno samo kroz CLI komandu `auth login` (`src/cli/index.ts:183`).
- `countryStates()`, GET `/country-states` je od 27.07.2026. izlozen i kao MCP alat `olx_country_states`; ranije je bio samo u `locationSnapshot` i CLI-u.
- `categoryTree()` (`core/index.ts:436`) i `locationSnapshot()` (`core/index.ts:477`). Agregatori za jednokratni snapshot, pokrecu se preko CLI komandi `category dump` i `location dump` (`src/cli/index.ts:574`).
- `listAllActive()` (`core/index.ts:389`) je dostupan indirektno, kroz `olx_list_listings` sa `all=true`.

### MCP resursi (nisu alati, ali su dio ponude servera)

- `olx://knowledgebase` (`server.ts:76`), lokalni markdown vodic.
- `olx://categories-index` CSV (`server.ts:91`) i `olx://categories` puni JSON (`server.ts:118`).
- `olx://locations-index` CSV (`server.ts:145`) i `olx://locations` puni JSON (`server.ts:172`).
- `olx://pomoc-index` CSV, index 52 clanka zvanicne pomoci (`server.ts:200`).
- `olx://pomoc/{fajl}` ResourceTemplate, pojedinacni clanak pomoci u markdownu (`server.ts:225`). Kompletni korpus (176 KB) se namjerno NE izlaze kao jedan resource; imena sa `/`, `\` i `..` se odbijaju.

Svi resursi citaju lokalne snapshote iz `olx-dokumentacija/`, ne API.

---

## 2. Autentikacija

### Kako se dobija token

Kod podrzava tri nacina (`core/index.ts:120` do `:125`):

- Vec postojeci Bearer token u `OLX_TOKEN`, salje se kao `Authorization: Bearer <token>` (`core/index.ts:121`).
- Login kredencijalima: POST `/auth/login` sa `username`, `password`, `device_name`, odgovor sadrzi token (`core/index.ts:205` do `:207`).
- Stari par zaglavlja `OLX-CLIENT-ID` i `OLX-CLIENT-TOKEN` (`core/index.ts:122` do `:120`).

`ensureAuth()` radi login samo ako nema ni tokena ni client para (`core/index.ts:253`).

Gdje korisnik generise token: u repozitoriju nema URL-a ni ekrana na kojem se token generise. Dokumentacija kaze samo da API pristup vrlo vjerovatno trazi poslovni Shop (Gold ili Platinum) i odobrenje OLX/PIK podrske, sto se provjerava pozivom `/auth/login` pa `/me` (`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:23` i `:24`, `README.md:8`). Tacno mjesto generisanja tokena je nepoznato iz koda.

### Jedan nalog ili vise naloga

- Jedan proces servera u datom trenutku radi na tacno jednom nalogu. Postoji jedna globalna `client` instanca (`server.ts:33` i `:31`).
- Jedan klon repozitorija radi za JEDAN nalog (`OLX_TOKEN`). Prebacivanje naloga u toku rada ne postoji: nema profila i nema alata koji mijenja nalog, pa radnja ne moze zavrsiti na pogresnom klijentu. Za drugog klijenta se klonira repo.
- Rizik: posto je promjena naloga globalna i tiha, svaka naredna operacija ide na novi nalog. Kod to i sam istice u opisu alata (`server.ts:307`), ali nema tehnicke zastite, samo tekstualno upozorenje. Ovo je realna mogucnost da se izdvajanje ili brisanje izvrsi na pogresnom klijentu.

### Gdje se token cuva

- U memoriji klijenta, privatno polje `token` (`core/index.ts:78`).
- U okruzenju: `OLX_TOKEN`, `OLX_CLIENT_ID`, `OLX_CLIENT_TOKEN` (`core/config.ts:39` do `:44`). Profilnih
  varijabli `OLX_TOKEN_<IME>` vise nema: uklonjene su sa multiprofilom, jedan klon je jedan nalog.
- Lozinke se ne drze u `.env`. `OLX_USERNAME` i `OLX_PASSWORD` kod cita ako postoje, ali ovaj klon
  radi sa `OLX_TOKEN`; kredencijali za ponovni login idu u keychain, ne u fajl.
- MCP server ucitava `.env` iz radnog direktorija na startu (`server.ts:15`).
- `.mcp.json` ne sadrzi token, nego referencu `${OLX_TOKEN:-}` (`.mcp.json`, polje `env`).
- `.gitignore` iskljucuje `.env`, `KLIJENT.md`, folder `klijenti/` i `.olx-pik/` (audit log i plan izdvajanja) iz gita. Klijentsko stanje iz `.olx-pik/` ide u ODVOJEN repo stanja, granom po klijentu, kroz `posao backup`; u repo koda ne ide nikad.

### Tajne vrijednosti u cistom tekstu

- Fajl `.env` sadrzi jedan pravi Bearer token u cistom tekstu (`OLX_TOKEN`). Jedan klon repoa radi za jedan nalog, pa u `.env` nikad ne stoje tokeni vise klijenata.
- Fajl `.env` sadrzi i lozinku naloga u cistom tekstu, unutar komentara na liniji `.env:29` ("Kredencijali za ponovni login ako token istekne", username i password). Lozinka je ovdje namjerno necitirana.
- Fajl je u `.gitignore` i nije u git historiji, tako da nije procurio u repozitorij. Ipak, lozinka u komentaru je nepotrebna izlozenost. Preporuka je da se lozinka izbaci i drzi u OS keychainu ili menadzeru lozinki, a u `.env` ostane samo token.
- U izvornom kodu i u `.env.example` nema pravih tajni, samo placeholderi.
- Sigurnosno pravilo iz dokumentacije koje ovo krsi: `olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:33` i `:225` traze token u env ili keychainu, po korisniku, nikad u repou.

### Sta se desava kad token istekne

- Kod ne detektuje istek tokena i ne radi automatsko osvjezavanje. Nema refresh token logike nigdje u `src/`.
- Odgovori 401 i 403 se pretvaraju u `OlxAuthError` sa porukom "Pristup odbijen ... Provjeri token i da li je shop odobren za API" (`core/index.ts:175` do `:171`).
- 401 i 403 se ne ponavljaju, retry se radi samo na 429 i 5xx (`core/index.ts:168`).
- `ensureAuth()` ne pomaze kod isteklog tokena, jer prolazi cim token postoji, bez obzira na to je li validan (`core/index.ts:254`).
- Prakticna posljedica: kad token istekne, svaki alat vraca istu gresku i korisnik mora rucno postaviti novi token ili pokrenuti CLI `auth login` sa kredencijalima.

---

## 3. Ogranicenja

### Throttle, retry i timeout

- Throttle: minimalni razmak izmedju dva zahtjeva, default 350 ms, iz `OLX_MIN_REQUEST_INTERVAL_MS` (`core/config.ts:126`, primjena u `core/index.ts:199` do `:203`, poziva se prije svakog pokusaja u `core/index.ts:271`).
- Retry: default 4 pokusaja, iz `OLX_MAX_RETRIES` (`core/config.ts:127`). Ponavlja se na 429 uvijek, a na 5xx i na mrezne greske samo kad je poziv idempotentan (`core/index.ts:300` i `:352`).
- Iskljucen retry: `POST /listings/:id/sponsore`, `POST /listings/:id/discount` i `POST /listings` idu sa `retryOnServerError: false` (`core/index.ts:267`, `:536`, `:548`), jer je server mogao izvrsiti radnju pa pasti na odgovoru: ponavljanje bi znacilo dvostruku naplatu ili duplikat oglasa.
- Backoff: eksponencijalni `2^pokusaj * 250 ms`, ogranicen na 8000 ms, plus do 200 ms slucajnog jittera (`core/index.ts:170` i `:178`).
- Timeout: default 20000 ms po zahtjevu, iz `OLX_TIMEOUT_MS`, realizovan preko `AbortController` (`core/config.ts:128`, `core/index.ts:277` i `:278`).
- Stvarni rate limiti API-ja su nepoznati. Dokumentacija to izricito navodi kao neprovjereno (`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:224`).

### Limiti koje vraca ili namece API

- Obnove: `GET /listing/refresh/limits` vraca `free_limit`, `free_count`, `paid_count`, `listing_count` (`core/types.ts:98` do `:76`). `free_limit` zavisi od naloga: zvanicna pomoc tvrdi 750, izmjereno je 1.800 na dva Gold naloga; uvijek procitati, ne pretpostavljati (`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:46`).
- Bulk obnova u kodu nikad ne prelazi preostalu besplatnu kvotu, `remaining = free_limit - free_count` (`server.ts:569`), a ulazni `limit` je dodatno ogranicen na najvise 4600 (`server.ts:560`).
- Broj oglasa: `GET /listing-limits` vraca limite po grupama kategorija (cars, real-estate, other). Konkretne brojeve kod ne poznaje, tip je `unknown` (`core/index.ts:293`).
- Naslov: najvise 65 znakova, validira se lokalno jer API vraca 422 (`server.ts:267`).
- Dani izdvajanja: samo 1, 2, 3, 5, 7, 14, 21, 30 (`server.ts:268` do `:205`, `core/types.ts:216`).
- Autoobnova: samo 0, 3, 6, 8, 24 sata, parametar je na API-ju obavezan pa kod salje 0 kad nije zadan (`server.ts:271` do `:209`, `core/index.ts:514`).
- Tip izdvajanja: 0, 1 ili 2 (`server.ts:401`, `core/types.ts:215`).
- Akcijska cijena: samo 3, 7 ili 30 dana (`server.ts:697`, `core/types.ts:240`).
- Paginacija: `per_page` 20 po dokumentaciji (`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:65`). `listAllActive` prelistava najvise 50 stranica (`core/index.ts:389`).
- Slike: broj i velicina slika se u kodu nigdje ne provjeravaju, nema limita ni validacije formata. Dokumentacija spominje do 20 fotografija besplatno za shopove (`olx-dokumentacija/OLX_PIK_Rangiranje_Pretraga_Sortiranje.md`, dio o shop paketima), ali API limit i maksimalna velicina fajla su nepoznati iz koda. CLI opcija za lokalne fajlove je i sama oznacena kao "format NEPOTVRDJEN" (`src/cli/index.ts:378`).
- Dubina stabla kategorija: default 6 nivoa kod snapshota (`core/index.ts:436`).

### Kodovi gresaka koje kod hvata

- 401 i 403: `OlxAuthError`, "Pristup odbijen", znaci nevazeci token ili shop bez odobrenog API pristupa (`core/index.ts:175`). Ne ponavlja se.
- 429: ponavlja se sa backoffom, znaci prekoracen rate limit (`core/index.ts:168`).
- 500 i vise: ponavlja se sa backoffom, osim na pozivima koji kostaju ili kreiraju oglas (`core/index.ts:168`).
- Svi ostali statusi izvan 2xx: `OlxApiError` sa statusom i punim tijelom odgovora. MCP ispisuje tijelo, sto je namjerno zbog 422 validacije po poljima (`core/index.ts:180`, `server.ts:64` do `:64`).
- Timeout: `AbortError` se pretvara u `OlxApiError` sa statusom 0 i porukom "Timeout nakon Xms" (`core/index.ts:190` i `:183`).
- Mrezna greska: takodjer `OlxApiError` sa statusom 0 (`core/index.ts:191`).
- `OlxSpendError`: interna greska alata, ne dolazi od API-ja. Baca se kad bi operacija potrosila kredite bez `confirm` (`core/index.ts:50`, `:498`, `:517`). MCP je prikazuje zajedno sa dohvacenom cijenom (`server.ts:60` do `:60`).
- 404 se ne obradjuje posebno. Komentar u kodu biljezi da `/users/:id/listings` vraca 404 dok `/users/:username/listings` radi, zato se svuda koristi username (`core/index.ts:231` i `:224`).
- Zastita od tihe greske: prazan korisnik ili literal "undefined" baca `OlxAuthError` prije poziva (`core/index.ts:355` do `:338`).

---

## 4. Podaci o konkurenciji i statistika

### Javni podaci o tudjim oglasima i shopovima

- `GET /users/:username/listings` i njegove varijante vracaju i tudje javne oglase, jer `olx_list_listings` prima proizvoljan `user` parametar (`server.ts:347`, `core/index.ts:363`). Podrazumijevano se koristi korisnik iz tokena (`server.ts:355`).
- **Potvrdjeno zivim testom 26.07.2026.** na javnom Platinum shopu: `active` vraca 33 oglasa sa punim cijenama, `finished` vraca 156 oglasa ali sa cijenom 0 i oznakom "Na upit", `inactive` vraca 2 oglasa sa cijenom, `expired` i `hidden` vracaju prazno. Ovo obara raniju napomenu iz `.claude/skills/olx-analiza-profila/references/konkurencija-faza2.md` da je stvar nepotvrdjena.
- Podaci koji dolaze po tudjem oglasu: naslov, cijena, kategorija, brend, godiste, kilometraza, gorivo, broj slika, `sponsored`, `olx_stories`, `premium_badges`, `refresh_available`, `date` zadnje obnove, `created_at` i `updated_at` na zavrsenim oglasima.
- **`GET /users/:username`** (radi i kao `GET /shops/:username`) nije u zvanicnoj dokumentaciji, pronadjen je probom 26.07.2026. Varijanta sa brojcanim id-om vraca 404, prolazi samo username. Od 26.07.2026. je implementiran kao `olx_user_profile` i CLI `users profile` (`core/index.ts:247`).
- Sta vraca za tudji shop: `type`, `id`, `username`, medalje (ukljucujuci `platinum_shop` ili `gold_shop`), `shop.package` (npr. Platinum), `shop.business_name`, `shop.business_vat`, `shop.ends_at`, `shop.web`, `shop.description`, `shop.working_hours`, `location` sa lat i lon, `created_at`, `avg_response_time`, `feedbacks` sa brojem pozitivnih i negativnih ocjena, te postavke privatnosti.
- Oblik odgovora, provjeren ponovo 26.07.2026. na javnom Platinum shopu: `shop.ends_at` i `created_at` su unix timestampi u sekundama (ne datum kao tekst), `shop.registered` je boolean, `avg_response_time` je broj (14 na tom nalogu), a `shop.business_name` i `shop.business_vat` su popunjeni i kad je `registered` false. Tipovi u `core/types.ts` (`OlxPublicProfile`) prate ovaj oblik.
- Prakticna vrijednost: paket konkurenta se moze procitati direktno, sto u kombinaciji sa poljem `sponsored` na njihovim oglasima pokazuje da li plaćeni paket zaista i koriste.

### Statistika

- **ISPRAVKA 27.07.2026.: pregledi oglasa POSTOJE.** `GET /listings/:id` vraca polje `views` (broj pregleda), i to i za VLASTITE i za TUDJE oglase (zivo provjereno: vlastiti oglas 100 pregleda, tudji Platinum oglas 4.798 pregleda). Uz `views` dolaze i `questions` (broj pitanja na oglasu) i `feedbacks`. Ranija tvrdnja da nema pregleda vazila je samo za listu oglasa; pojedinacni oglas ih nosi. Nema klikova, nema pojmova na pretrazi, nema agregata po kategoriji ni vremenskog perioda, ali se vremenska serija pregleda moze graditi vlastitim snimcima (cron).
- Saldo kredita JESTE dostupan. `GET /me` vraca polje `credits` (potvrdjeno zivim pozivom 26.07.2026. na Gold nalogu, saldo se vraca kao broj). Polje nije u tipu `OlxUser` (`core/types.ts:4`), ali prolazi kroz index potpis, pa ga `olx_whoami` vec vraca. Ranija tvrdnja u sekciji 6 da se saldo ne moze procitati je netacna.
- `GET /me` vraca i paket shopa (`shop.package`, npr. Gold), datum isteka paketa `shop.ends_at`, prosjecno vrijeme odgovora `avg_response_time` i brojac `new_questions_count`. **Brojac je NEPOUZDAN** (u praksi 07.2026. vratio 0 uz postojeca pitanja na nalogu): ne koristiti ga za izvjestaje ni alarme dok se semantika ne izmjeri poredjenjem weba i API-ja.
- Jedina brojka blizu statistike je `count` u prijedlogu kategorije, koji pokazuje broj oglasa uz predlozenu kategoriju (`core/types.ts:172`, `olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md:87`).
- Iz liste vlastitih oglasa dolaze polja koja se mogu koristiti kao gruba interna metrika: `sponsored`, `date`, `refresh_available`, `status`, `visible` (`core/types.ts:105` do `:91`).
- Interna dokumentacija spominje da statistika oglasa i "pojmovi na pretrazi" postoje na platformi (`olx-dokumentacija/OLX_PIK_Rangiranje_Pretraga_Sortiranje.md`, dio 6 i Faza 2), ali za njih u dokumentaciji nema API endpointa, pa se ne mogu dohvatiti kroz ovaj MCP.

### Pretraga

- Pretraga oglasa po kljucnoj rijeci, kategoriji, cijeni ili lokaciji ne postoji u ovom toolkitu. Nijedan poziv u `src/core/index.ts` ne gadja search endpoint.
- Postoji samo pretraga kategorija po imenu: `/categories/suggest?keyword=` (`core/index.ts:427`) i `/categories/find?name=` (`core/index.ts:431`). To vraca kategorije, ne oglase.
- Repozitorij i sam biljezi da search endpoint nedostaje i da vjerovatno postoji na API-ju, ali nije dokumentovan (`.claude/skills/olx-analiza-profila/references/konkurencija-faza2.md`, tacke 2 i 3).

Zakljucak (revidiran 27.07.2026.): konkurentska analiza po POZNATOM konkurentu je itekako moguca (profil, svi oglasi, pregledi po oglasu, kadenca obnove, udio sponzorisanih); sto nedostaje je OTKRIVANJE konkurenata po kategoriji ili kljucnoj rijeci, jer nema search endpointa. Konkurenti se moraju unijeti rucno po username-u (izvor: mjesecni Excel snimci shopova).

### Propertiji odgovora, izmjereno zivim pozivima 27.07.2026.

Tipovi u `core/types.ts` namjerno tipiziraju samo podskup; API vraca znatno vise. Sve ispod je
procitano iz stvarnih odgovora na Gold nalogu (MixBox) i javnom Platinum shopu.

**`GET /me` (olx_whoami)** nosi, pored poznatog `credits` i `shop.package`:

- `new_questions_count` — brojac pitanja, NEPOUZDAN (07.2026. vratio 0 uz postojeca pitanja); ne graditi nista na njemu
- `active_deliveries_count`, `unconfirmed_deliveries_count` — dostava
- `feedbacks.positive` / `feedbacks.negative` — ocjene naloga
- `avg_response_time` — prosjecno vrijeme odgovora u minutama
- `shop.ends_at` — unix timestamp isteka paketa (alarm za produzenje!)
- `settings.pro.auto_renewal` — da li je ukljucena autoobnova na nivou naloga
- `medals`, `email_verified`, `phone_verified`, `created_at`

**`GET /listings/:id` (olx_get_listing)**, radi i za tudje oglase:

- `views` — broj pregleda oglasa (javno!)
- `questions`, `feedbacks` — po oglasu
- `date` — unix timestamp ZADNJE OBNOVE (obnova "boosta datum", pa je `date` > `created_at`
  dokaz obnove; na tudjim oglasima ovo otkriva kadencu obnavljanja konkurenta)
- `created_at` i `additional.updated_at` — starost i zadnja izmjena
- `sponsor_active` — SAMO na vlastitom oglasu: placena cijena, `sponsored_until`,
  `criterias` (type, days, refresh_every), `auto_renewal`; na tudjem je null iako je oglas
  sponzorisan (flag `sponsored` u listi je javan: 0/1/2)
- `sponsor_scheduled` — polje postoji (null); platforma dakle interno ima zakazivanje
  izdvajanja, endpoint za postavljanje nije poznat
- `has_discount`, `regular_price`, `sponsor_discount` — akcijska cijena
- `pinned`, `highlighted`, `urgent`, `premium_badges` — pozicijske oznake
- `attributes` (puni, sa `required` i `group_name`), `images` (broj slika), `sku_number`,
  `quantity`, `price_by_agreement`, `shipping`, `image_masking`

**`GET /users/:username/listings` (olx_list_listings)**, radi i za tudje (i `finished`
varijanta, zivo provjereno):

- `sponsored` (0/1/2), `date` (zadnja obnova), `refresh_available`
- `has_discount`, `original_price`, `discounted_price` — vidljive akcije konkurenta
- `card_payment`, `shipping`, `labels`, `special_labels`, `premium_badges`, `pinned`,
  `olx_stories`
- `meta.total` — tacan broj oglasa po stanju bez prelistavanja

**`GET /users/:username` (olx_user_profile)** za tudji nalog dodatno:

- `last_time_active_at` — kad je korisnik zadnji put bio aktivan (mrtav ili ziv shop!)
- `feedbacks`, `medals`, `created_at`, `avg_response_time`, `pro.pro`, `delivery_enabled`
- privatni podaci (email, telefon, krediti) se NE vracaju za tudje naloge

Sta se iz ovoga izvodi bez ijednog novog endpointa:

1. **Mjerenje efekta izdvajanja.** Snimiti `views` prije izdvajanja, pa dnevno tokom i poslije:
   prirast pregleda dnevno u odnosu na baseline je direktna mjera povrata. Ovo obara raniju
   tvrdnju u sekciji 7 da se efekat ne moze mjeriti brojem.
2. **Statistika vlastitog profila.** Jedan prolaz kroz sve oglase daje: preglede po oglasu,
   preglede po danu starosti (`views / dani od created_at`), oglase bez pitanja, mrtve oglase
   (nisko `views`, staro `date`), udio sponzorisanih.
3. **Analiza konkurenta po username-u.** Profil (aktivnost, ocjene, paket) + oglasi (broj,
   cijene, akcije, udio sponzorisanih, kadenca obnove iz `date`) + pojedini artikl
   (`views` njihovog top oglasa protiv naseg ekvivalenta, broj slika, popunjenost atributa).
4. **Alarmi za nalog.** `shop.ends_at` blizu (paket istice), `credits` ispod praga, broj
   `expired` oglasa (mrtvi inventar koji se moze reaktivirati). `new_questions_count` je
   iskljucen iz alarma kao nepouzdan (vidi napomenu uz `GET /me`).

---

## 5. Neiskoristeno

Dokumentacija API-ja u repozitoriju postoji: `olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md`, sekcija 4, tabele od linije 39 do linije 118, i od 27.07.2026. `olx-dokumentacija/analiza-api-dokumentacije.md` sa kompletnim popisom endpointa prepisanim sa zvanicnog `api-documentation.olx.ba`. Ne postoji OpenAPI spec ni Postman kolekcija.

Poredjenje te liste sa implementacijom:

- Svi endpointi navedeni u dokumentaciji su implementirani u `src/core/index.ts`. Nema nijednog dokumentovanog endpointa koji jezgro ne pokriva.
- Neiskoristeno na nivou MCP sloja, iako postoji u jezgru:
  - POST `/auth/login` (`core/index.ts:205`) nije MCP alat, samo CLI komanda.
  - GET `/country-states` je od 27.07.2026. izlozen kao MCP alat `olx_country_states`.

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

- **Zdravstveni pregled naloga.** Jedan izvjestaj: ko sam, koliko aktivnih, skrivenih, isteklih i zavrsenih oglasa, koliko je obnova ostalo u tekucem ciklusu.
  - Alati: `olx_whoami`, `olx_list_listings` (svih pet stanja), `olx_refresh_limits`, `olx_listing_limits`.
  - Nedostaje: nista.
- **Detektor slabih naslova.** Prolazak kroz sve aktivne oglase i oznacavanje naslova koji su kraci od praga, nemaju brend ili model, sadrze rijeci bez pretrazivacke vrijednosti ili prelaze 65 znakova.
  - Alati: `olx_list_listings` sa `all=true`, `olx_get_listing`, plus pravila iz `olx://knowledgebase`.
  - Nedostaje: nista, cijela logika je lokalna. Bez podataka o stvarnim pojmovima pretrage ostaje heuristika, ne mjerenje.
- **Provjera ispravne kategorije.** Za svaki aktivni oglas uporediti trenutnu kategoriju sa onom koju API predlaze na osnovu naslova.
  - Alati: `olx_list_listings`, `olx_suggest_category`, `olx_category`.
  - Nedostaje: promjena kategorije objavljenog oglasa. Sema `olx_update_listing` prima `category_id`, ali IZMJERENO 29.07.2026: API ga na zivom oglasu tiho ignorise. Jedini put je zavrsiti oglas i kreirati novi, uz gubitak pregleda (granice.md).
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
  - Nedostaje: stabilna veza izmedju vanjskog SKU i OLX oglasa. `sku_number` se moze postaviti pri kreiranju (`server.ts:500`), ali ga `olx_update_listing` ne moze naknadno mijenjati, a ni pretraga po SKU ne postoji.
- **Rotacija izdvajanja po budzetu.** Rasporedjivanje zadanog broja kredita na najvrijednije artikle, uz dohvat cijene za svaki i jednu potvrdu korisnika za cijeli plan.
  - Alati: `olx_list_listings`, `olx_sponsor_price`, `olx_sponsor_listing` sa `confirm`.
  - Nedostaje: zakazivanje u tacno vrijeme ne postoji na API-ju, pa bi vremensku komponentu morao voditi vanjski scheduler.
- **Automatski dnevni ritam obnova.** Raspored koji svakog dana obnavlja odredjeni broj oglasa tako da se kvota rasporedi ravnomjerno do reseta umjesto da se potrosi odjednom.
  - Alati: `olx_refresh_limits`, `olx_refresh_bulk`.
  - Nedostaje: MCP server nema vlastiti scheduler, treba vanjski pokretac. ISPRAVKA 27.07.2026.: podatak o zadnjoj obnovi POSTOJI, polje `date` u listi i na pojedinacnom oglasu je timestamp zadnje obnove (obnova "boosta" datum oglasa; provjereno na oglasu sa autoobnovom gdje je `date` svjezije od `created_at`).
- **Zastita od rada na pogresnom nalogu.** Obavezna potvrda naloga prije svake operacije koja mijenja stanje ili trosi kredite.
  - Alati: `olx_whoami`.
  - Nedostaje: izmjena servera tako da svaki write alat provjeri ocekivani nalog. Trenutno je zastita samo tekst u opisu alata (`server.ts:307`), ne kod.

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
  - Alati: `olx_sponsor_price` za trosak, `olx_get_listing` za brojeve.
  - ISPRAVKA 27.07.2026.: pregledi i upiti POSTOJE kroz API (`views` i `questions` na
    `GET /listings/:id`). Vremenska serija se gradi vlastitim snimcima: snimiti `views` prije
    izdvajanja pa dnevno tokom trajanja; prirast po danu u odnosu na baseline je mjera efekta.
    Vidi sekciju "Propertiji odgovora" u dijelu 4.

---

## Sazetak rizika

- Dva prava tokena i jedna lozinka stoje u cistom tekstu u `.env` (`.env:26`, `.env:29`, `.env:30`). Fajl je izvan gita, ali lozinku u komentaru treba ukloniti.
- Nema tehnicke provjere naloga prije trosenja kredita; obavezu potvrde (`olx_whoami`) namece CLAUDE.md, ne kod. Brisanje oglasa kroz MCP nije moguce, a promjena naloga ne postoji.
- Retry se i dalje izvrsava na PUT i POST pozivima koji ne kostaju (`refresh`, `publish`, `update`), pa kod 5xx nakon vec izvrsene radnje moze doci do dvostrukog izvrsenja; kod nema idempotency kljuc. Pozivi koji kostaju (`sponsore`, `discount`) i `POST /listings` su izuzeti (`core/index.ts:168`).
- Nema detekcije isteka tokena ni automatskog ponovnog logina.
- Svi limiti oko slika (broj, velicina, format) su neprovjereni i nisu validirani lokalno.

---

## Propusteno / preporuke (popis za buduce izmjene koda)

Stanje 26.07.2026., nakon runde "sistem-flow". Stavke 1 do 6 i 8 sa prethodnog popisa su
rijesene i zapisane nize kao ucinjeno; ostatak je red voznje za sljedecu rundu.

### Ucinjeno u rundi sistem-flow (26.07.2026.)

- Bulk obnova: gornja granica `limit` podignuta sa 750 na 4600 (`server.ts:560`); stvarni cap
  ostaje `free_limit - free_count` (`server.ts:569`).
- `GET /users/:username` izlozen kao `olx_user_profile` i CLI `users profile <username>`
  (`core/index.ts:247`). Rucni curl u skillu `olx-shopovi-snimci` je zamijenjen alatom.
- `olx_update_listing` prima sva polja iz `UpdateListingInput`, ukljucujuci `category_id`,
  `sku_number`, `state`, `listing_type`, lokaciju, brend, model i atribute.
- `olx_delete_listing` uklonjen iz MCP-a. Brisanje kroz bota nije moguce; na "obrisi" se
  predlaze `olx_finish_listing`. Brisanje ostaje u CLI (`listings rm`).
- Korpus podrske izlozen kao `olx://pomoc-index` i `olx://pomoc/{fajl}`; kompletni fajl od
  176 KB se ne izlaze kao jedan resource.
- Retry iskljucen za `sponsore`, `discount` i `POST /listings` (`retryOnServerError: false`).
- Spend-guard i retry politika pokriveni testovima: `src/core/client.test.ts` (10 testova, uz
  17 postojecih za `match.ts`).
- `.mcp.json` prosljedjuje samo `OLX_TOKEN` i `OLX_BASE_URL`.
- Multiprofil je uklonjen: jedan klon je jedan klijent (`core/config.ts` ima samo `loadConfig`).
- Audit log: svaka radnja koja mijenja stanje ili trosi kredite ide u `.olx-pik/audit.jsonl`
  (`core/audit.ts`), sa imenom CLI komande ili MCP alata. Tijelo zahtjeva se ne zapisuje.
  Odbijen trosak se takodjer biljezi.
- Obnova tokena: 401 uz postavljene kredencijale pokrece jedan login kroz dijeljeni promise;
  403 se ne lijeci loginom; radnje koje kostaju se ne ponavljaju automatski.
- Planer izdvajanja: `core/plan.ts` plus CLI `sponsor plan` (plan fajl u `.olx-pik/`, budzet kao
  tvrda granica, ponovna provjera cijene, kljuc protiv dvostrukog pokretanja).
- Vanjski katalog: `core/katalog.ts` cita JSON i CSV, pa `match` radi i za sisteme koji nisu
  Shopify. Prepoznavanje koda modela vise nije vezano na prefikse jednog dobavljaca.
- Ciscenje `.env` (26.07.2026.): iz lokalnog fajla su izbaceni lozinka u komentaru, `OLX_PASSWORD`,
  `OLX_USERNAME` i zaostali profilni tokeni `OLX_TOKEN_*` sa `OLX_PROFILE`. Ostaje samo `OLX_TOKEN`
  ovog klona; prava na fajlu su `600`. Tokeni koji su bili u fajlu se rotiraju na nalozima.

### Ostaje

1. **Pojmovi pretrage po oglasu** ne postoje u API-ju. RIJESENO DJELIMICNO 27.07.2026.:
   pregledi (`views`) i pitanja (`questions`) POSTOJE na `GET /listings/:id`, pa se efekat
   izdvajanja mjeri vlastitim snimcima pregleda. Pojmovi pretrage i dalje nedostaju;
   provjeriti sa podrskom.
2. **Otvoreno mjerenje**: `olx_refresh_limits` na nalogu koji nije Gold — razlucuje da li
   kvota obnova prati paket ili je 1800 za sve shop pakete.
