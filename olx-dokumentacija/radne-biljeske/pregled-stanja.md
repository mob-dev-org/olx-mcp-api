# Pregled stanja: sta postoji, sta je poluzavrseno, sta se preklapa

Interni dokument, snimljen 02.08.2026. sa koda na grani `main` (zadnje izdanje 0.8.0). Namjena je
odluka sta dalje graditi, nije ni prodajni spisak ni referenca za rad. Referenca ostaje
`API-INVENTAR.md` (alati i parametri), `arhitektura.md` (kako je sklopljeno) i `CHANGELOG.md`
(sta je uslo kad).

Izvor je kod, ne dokumentacija. Gdje se dokumentacija i kod razilaze, ovdje stoji ono sto kod
radi, uz napomenu.

---

## 1. Sta postoji, sloj po sloj

### 1.1 Jezgro (`src/core`, 36 fajlova)

Jedan klijent po klonu je ugradjen u temelj: `config.ts` nema profile ni prebacivanje naloga, u
procesu postoji tacno jedan token. To je jaca garancija od provjere naloga u kodu, jer radnja
fizicki ne moze zavrsiti na pogresnom klijentu.

| Grupa | Moduli | Sta radi |
| --- | --- | --- |
| API klijent | `index.ts`, `types.ts`, `config.ts` | Svi endpointi, throttle, retry, obnova tokena na 401, spend guard |
| Trag i sigurnost | `audit.ts`, `verzija.ts`, `zabranjena-roba.ts` | Audit log svake izmjene i troska, verzija u zapisu, filter sporne robe |
| Statistika | `stats.ts`, `snapshoti.ts`, `izvjestaj.ts`, `kvota-dnevnik.ts` | Racun profila, dnevni snimci pregleda, dnevni i sedmicni izvjestaj |
| Obnove i trosak | `ritam-obnova.ts`, `plan.ts`, `plan-fajl.ts`, `sponsor-options.ts`, `izuzeca.ts` | Ritam obnavljanja, planer izdvajanja kroz dane, izuzeci od automatike |
| Sadrzaj | `opisi.ts`, `tekst.ts`, `prijedlozi.ts`, `pamcenje.ts` | Sablon opisa iz klijentovog kataloga, prijedlozi AI runde, trajno pamcenje |
| Slike | `slika.ts`, `vid.ts`, `pozadina.ts`, `gemini.ts`, `slike-ciscenje.ts`, `slike-trag.ts` | Generisanje slike, opis slike kad pogon ne vidi, stalna pozadina klijenta |
| Konkurencija i kandidati | `konkurenti.ts`, `telefon-ekstrakcija.ts`, `match.ts`, `katalog.ts` | Snimci konkurenata, telefon iz javnog teksta, spajanje sa vanjskim katalogom |
| Pogon | `telegram.ts`, `telegram-grupe.ts`, `link.ts`, `git-stanje.ts`, `stanje-kopija.ts`, `backup-spisak.ts`, `ai-dnevnik.ts` | Slanje poruka, spisak grupa, backup stanja, dnevnik AI potrosnje |

Testova ima 28, od kojih `client.test.ts` pokriva `index.ts`, a `slojevi.test.ts` provjerava
granice medju slojevima umjesto jednog modula. Bez testa ostaju `ai-dnevnik`, `audit`, `gemini`,
`konkurenti`, `slike-trag`, `snapshoti` i `tekst`, plus `config` i `types`.

### 1.2 MCP server (`src/mcp/server.ts`)

Racunato iz koda 02.08.2026: 55 registracija alata, od kojih 14 nosi `SAMO_ADMIN` filter, a 2 su
uslovne (`olx_opisi_sliku` samo kad je vid konfigurisan, `olx_generiraj_sliku` samo kad je
generisanje slika konfigurisano). Dakle admin do 55, klijent do 41. Tacan broj u zivoj sesiji se
i dalje cita sa servera, ne odavde.

Grupe alata:

- Citanje naloga i oglasa: `olx_whoami`, `olx_list_listings`, `olx_get_listing`,
  `olx_find_my_listing`, `olx_user_profile`
- Agregati koji racunaju u kodu umjesto da vracaju sirov payload: `olx_profile_stats`,
  `olx_onboarding_report`, `olx_listing_report`, `olx_account_alerts`, `olx_competitor_report`,
  `olx_sponsor_effect`, `olx_mrtvi_oglasi`
- Kategorije i lokacije: `olx_suggest_category`, `olx_find_category`, `olx_category_attributes`
  plus dumpovi koji su admin only
- Kreiranje i izmjena: `olx_draft_check`, `olx_create_listing`, `olx_publish_listing`,
  `olx_update_listing`, `olx_upload_images`, `olx_set_main_image`, `olx_delete_image`
- Grupne radnje: `olx_bulk_price`, `olx_bulk_sklanjanje`, `olx_refresh_bulk`
- Trosak: `olx_sponsor_price`, `olx_sponsor_listing`, `olx_sponsor_plan`, `olx_set_discount`,
  `olx_finish_discount`
- Postavke klijenta: `olx_zapamti`, `olx_izuzeca`, `olx_ritam_obnova`, `olx_pozadina`,
  `olx_sablon_opisa`, `olx_prijedlozi`, `olx_zabiljezi_saznanje`

Resursi: `olx://knowledgebase`, `olx://pravila-brojeva`, `olx://categories-index`,
`olx://categories`, `olx://locations-index`, `olx://locations`, `olx://pomoc-index`,
`olx://pomoc/{fajl}`. Svi citaju lokalne snapshote, nijedan ne zove API.

### 1.3 CLI (`src/cli/index.ts`)

Grupe: `auth`, `users`, `listings` (plus `listings images`), `refresh`, `category`, `location`,
`sponsor` (plus `sponsor plan`), `discount`, `stats`, `telegram` (plus `telegram grupe`),
`posao`. Ukupno 62 komande u 14 grupa.

Ono sto CLI ima a MCP nema, namjerno:

- `listings rm`, pravo brisanje oglasa, ostavljeno ljudskoj ruci
- `auth login`, jedini put do tokena kroz kredencijale
- `category dump`, `location dump`, `category index`, `location index`, jednokratni snapshoti za repo
- `posao dnevni`, `posao sedmicni`, `posao backup`, ulazi za cron
- `stats snapshot`, dnevni snimak pregleda bez kojeg nema mjerenja efekta

### 1.4 Skillovi (11) i podagenti (6)

Skillovi: `olx-analiza-profila`, `olx-cron-obnove`, `olx-izdanje`, `olx-klijent-flow`,
`olx-mcp-setup`, `olx-novi-klijent`, `olx-objava-artikla`, `olx-seo-oglasa`,
`olx-serijski-posao`, `olx-shopovi-snimci`, `pik-olx-kreditni-savjetnik`.

Podagenti: `olx-dijagnostika`, `olx-konkurent`, `olx-korpus`, `olx-prodaja`, `olx-seo-pisac`,
`olx-trijaza`.

### 1.5 Automatski poslovi

Deset launchd zadataka u `deploy/launchd`, cetiri admin i sest klijentskih, plus Windows varijanta
u `deploy/windows`. Raspored je opisan u `arhitektura.md`, sekcija 3. Ukratko: nocni snapshot,
nocni restart sesije, jutarnja obnova sa porukom, jutarnji backup, sedmicni pregled ponedjeljkom,
nadzor backupa, nedjeljna AI runda, cuvari obje sesije.

### 1.6 Admin skripte (33 u `scripts/`)

Cetiri odvojene grupe:

- Izdanje i flota: `izdanje.mjs`, `provjeri-izdanje.mjs`, `upisi-verziju.mjs`,
  `pusti-u-flotu.mjs`, `azuriraj-sve.sh`, `azuriraj-ovaj-klon.mjs`
- Postavka klona: `provjeri-klon.mjs`, `pripremi-runtime.mjs`, `pripremi-admin-runtime.mjs`,
  `instaliraj-cron.sh`, `sastavi-prompt.mjs`, `provjeri-prompt.sh`
- Pogon uzivo: `cuvar-sesije.mjs`, `telegram-most.mjs`, `hook-telegram-odgovor.mjs`,
  `proba-kanala.mjs`, `ai-runda.sh`, `backup-nadzor.sh`, `saznanja-pokupi.sh`
- Mjerenje i pomoc: `testovi.mjs`, `tokeni-izvjestaj.mjs`, `ai-usage.mjs`,
  `kontekst-izvjestaj.mjs`, `ai-cijene.mjs`

### 1.7 Odvojeni potprojekti

- `cloudflare/onboarding`: Worker za web onboarding, klijent se prijavi kroz link, token stize
  sifrovan na admin masinu
- `interno/pretraga-biznisa`: samostalan alat za procjenu trzista iz xlsx snimka Gold i Platinum
  shopova, sa vlastitim `CLAUDE.md` i tvrdom zabranom da ikad dodje do klijenta

---

## 2. Poluzavrseno i rupe

Poredano po tome koliko kosta sto nije dovrseno.

1. **Mjerenje efekta izdvajanja stoji na sporom snapshotu.** `stats snapshot` salje jedan zahtjev
   po oglasu. Na katalogu od par stotina oglasa to je dugotrajan nocni posao, a bez njega
   `olx_sponsor_effect` nema podatke. Nema paralelizacije, nema inkrementalnog snimanja samo
   promijenjenih, nema alarma kad snapshot padne. Ako snapshot tiho stane, gubi se mjerenje i to
   se primijeti tek kad neko pita za efekat.

2. **Sinhronizacija zaliha je zavrsena do pola.** `match` spaja PIK oglase sa vanjskim katalogom,
   ali stabilne veze nema: `sku_number` se postavlja samo pri kreiranju i poslije se ne mijenja, a
   pretrage po SKU nema. Za oglase koji su nastali mimo bota veza se svaki put iznova pogadja po
   naslovu.

3. **Slike koje je klijent dodao kroz aplikaciju se ne mogu ni obrisati ni postaviti kao glavne.**
   `imageId` postoji samo kao povratna vrijednost uploada, GET oglasa vraca samo URL. Izmjereno
   30.07.2026. Znaci da higijena slika radi samo nad onim sto je bot sam okacio.

4. **Retry bez idempotency kljuca na pozivima koji ne kostaju.** `refresh`, `publish` i `update`
   se ponavljaju na 5xx, pa radnja koja je vec izvrsena moze proci dvaput. Pozivi koji kostaju su
   izuzeti (`retryOnServerError: false` na `sponsore`, `discount` i `POST /listings`), pa je steta
   ogranicena na dvostruku obnovu, ne na dvostruki trosak.

5. **Sedam modula bez testa**, od kojih dva nose rizik: `audit.ts` (ako tiho prestane pisati,
   gubi se jedini trag o trosku) i `snapshoti.ts` (temelj svakog trenda). `gemini.ts`,
   `konkurenti.ts`, `ai-dnevnik.ts`, `slike-trag.ts` i `tekst.ts` su manje kriticni.

6. **Kvota obnova nije izmjerena na nalogu koji nije Gold.** Otvoreno pitanje iz `API-INVENTAR.md`:
   prati li kvota paket ili je ista za sve shop pakete. Dok se ne izmjeri, planiranje na
   ne Gold nalozima stoji na pretpostavci.

7. **Pojmovi pretrage po oglasu ne postoje.** Interni vodic ih navodi kao najkorisniji potez za
   naslove, a izvor podataka ne postoji ni u API-ju ni u dokumentaciji. SEO ostaje heuristika, ne
   mjerenje. Provjeriti sa podrskom je jos otvoreno.

---

## 3. Preklapanja i visestruki ulazi

Ovo nisu bugovi, nego mjesta gdje isti posao ima vise ulaza. Svako od njih je odluka: spojiti,
ili zapisati koji je ulaz glavni.

1. **Onboarding klijenta ima cetiri ulaza.** Skill `olx-novi-klijent` (tehnicka postavka klona),
   skill `olx-klijent-flow` (zivotni ciklus i prvi potezi), lanac
   `onboarding-kljuc` plus `onboarding-link` plus `onboarding-puller` (Worker na daljinu), i
   `onboarding-uzivo.mjs` (bez deploya, iz jedne komande). Zadnja dva su dva puta do istog
   rezultata i oba se odrzavaju. Vrijedi odluciti koji je podrazumijevani, pa drugi oznaciti kao
   rezervni.

2. **Analiza vlastitog profila ima cetiri lica.** MCP `olx_profile_stats`, MCP
   `olx_onboarding_report`, CLI `stats profil`, CLI `stats onboarding`, plus skill
   `olx-analiza-profila` koji ih vezuje. Granica izmedju "statistika" i "onboarding izvjestaj" je
   vremenska, ne sadrzajna, pa se u praksi biraju naslijepo.

3. **Konkurent ima pet ulaza.** MCP `olx_competitor_report`, podagent `olx-konkurent`, CLI
   `stats konkurent`, `stats konkurent-snimi`, `stats konkurent-promjena`, plus
   `interno/pretraga-biznisa` koji radi isti posao na hiljadama shopova drugom mehanikom. Snimi i
   promjena su jedini par koji stvarno gradi vremensku seriju; ostalo je jednokratni presjek.

4. **Dokumentacija o stanju je na cetiri mjesta.** `README.md`, `arhitektura.md`,
   `API-INVENTAR.md` (sekcije "Neiskorisceno", "Sta je moguce izgraditi", "Ostaje") i
   `CHANGELOG.md`. Popis "Ostaje" u `API-INVENTAR.md` je od 26.07.2026. i dijelom je pregazen
   izdanjem 0.8.0, a nije azuriran.

5. **Slike prolaze kroz cetiri modula** (`slika`, `vid`, `pozadina`, `gemini`) plus dva uslovna
   MCP alata plus `slike-ciscenje` i `slike-trag`. Podjela odgovornosti nije ocigledna iz imena;
   ovo je prvi kandidat za citanje prije bilo kakve izmjene u tom dijelu.

---

## 4. Mrtav teret

- `PLAN.md` u korijenu repoa je sam sebe oznacio arhiviranim 26.07.2026. i pise da vise ne opisuje
  stvarno stanje. Stoji na najvidljivijem mjestu u repou. Ili u `olx-dokumentacija/arhiva/`, ili
  van repoa.
- `excalidraw.log` i `olx-dokumentacija/radne-biljeske/skeniranje.log` su radni izlazi, ne dokumentacija.
- U `olx-dokumentacija/` stoje tri xlsx fajla i jedan pptx, snimci od 26. i 28.07.2026. Podaci sa
  rokom trajanja u folderu koji je inace referenca.

---

## 5. Zid platforme

Ovo se ne moze izgraditi ma koliko truda ulozili, jer API to ne daje. Vazno je da stoji uz spisak
ideja, da se ne planira u prazno. Puna lista je u `granice.md`, sekcija "Sta platforma ne moze".

- Nema pretrage oglasa, pa nema mjerenja pozicije ni cjenovnog pozicioniranja po kategoriji
- Nema poruka kupcima; `new_questions_count` se pokazao nepouzdan i iskljucen je iz alarma
- Nema statistike po danu ni po kategoriji, pregledi su kumulativni
- Nema zakazivanja izdvajanja na platformi, raspored vodi nas plan fajl
- Kategorija objavljenog oglasa se ne mijenja, API tiho ignorise `category_id`

---

## 6. Prijedlog reda voznje

Poredano po odnosu koristi i truda, ne po velicini.

**Prvo, jer stiti ono sto vec radi:**

- Test za `audit.ts` i `snapshoti.ts`. Oba su temelj necega sto se primijeti tek kad zakaze.
- Alarm kad dnevni snapshot ne napravi fajl. Trenutno tihi kvar.

**Drugo, jer otklanja stvarnu smetnju:**

- Ubrzati `stats snapshot` (paralelni zahtjevi uz throttle koji vec postoji u jezgru). Bez ovoga
  mjerenje efekta ostaje krhko na vecim katalozima.
- Odluciti glavni put onboardinga i drugi svesti na rezervni, da se ne odrzavaju dva.

**Trece, jer cisti sliku:**

- Azurirati "Ostaje" u `API-INVENTAR.md` prema 0.8.0, ili ga preseliti ovamo i drzati na jednom
  mjestu.
- Skloniti `PLAN.md` i radne logove iz vidnog dijela repoa.

**Cetvrto, ako se ide na novu funkcionalnost:**

- Stabilna veza vanjski katalog prema oglasu, da sinhronizacija zaliha postane pouzdana. Ovo je
  jedina stavka sa spiska koja otvara novu upotrebu, a ne popravlja postojecu. Trazi rjesenje za
  `sku_number` koji se ne moze mijenjati, najvjerovatnije vlastitu mapu u `.olx-pik/`.
