# olx-pik-toolkit

Interni CLI i MCP server za upravljanje OLX.ba / PIK.ba shopovima. Jedno jezgro (`src/core`), dva lica: CLI (`src/cli`) i MCP server (`src/mcp`).

## Zahtjevi

- Node.js 18 ili noviji (koristi se ugradjeni `fetch`).
- Odobren API pristup za shop (Gold ili Platinum + odobrenje OLX/PIK podrske). Provjeri sa `olx whoami`.

## Brzi start

```bash
npm install
npm run build
cp .env.example .env     # popuni OLX_TOKEN ili OLX_USERNAME/OLX_PASSWORD
node dist/cli/index.js whoami
```

Provjere: `npm test` (testovi match logike, bez mreze) i `npm run typecheck`.

## CLI primjeri

```bash
# Sigurno (citanje)
node dist/cli/index.js listings ls --state active --all
node dist/cli/index.js users profile <username>           # javni profil shopa (paket, ocjene)
node dist/cli/index.js refresh limits
node dist/cli/index.js category suggest "golf 7"
node dist/cli/index.js sponsor price 12345 --type 2 --days 7 --refresh-every 8

# Obnova
node dist/cli/index.js refresh one 12345
node dist/cli/index.js refresh all --limit 200            # dry-run
node dist/cli/index.js refresh all --limit 200 --yes      # izvrsi

# Trosak kredita (uvijek trazi --yes)
node dist/cli/index.js sponsor apply 12345 --type 2 --days 7 --refresh-every 8 --yes

# Planer izdvajanja: predlog u fajl (ne trosi), pa izvrsenje termina dospjelih danas
node dist/cli/index.js sponsor plan napravi --budzet 500 --dana 7 --trajanje 7
node dist/cli/index.js sponsor plan prikazi
node dist/cli/index.js sponsor plan izvrsi              # probni prikaz
node dist/cli/index.js sponsor plan izvrsi --yes        # naplacuje

# Slike (URL-ovi i/ili lokalni fajlovi)
node dist/cli/index.js listings images add 12345 --url https://primjer.com/1.jpg https://primjer.com/2.jpg
node dist/cli/index.js listings images add 12345 --file ./slika1.jpg ./slika2.jpg
node dist/cli/index.js listings images main 12345 67890     # postavi glavnu sliku po imageId
node dist/cli/index.js listings images rm 12345 67890        # obrisi sliku
```

Napomena o slikama (potvrdjeno uzivo): API prima slike samo kao stvarne fajlove preko `multipart/form-data`, pod poljem `images[]`. Ne prihvata `image_url`. Zato `--url` prvo preuzme sliku pa je posalje kao fajl, a `--file` salje lokalni fajl direktno. Oba zavrse isto na `POST /listings/:id/image-upload`.

## Spajanje sa vanjskim katalogom (komanda match)

CLI ima komandu `match` koja spaja PIK oglase sa artiklima iz vanjskog kataloga (po sifri, pa po
slicnosti naslova: IDF Jaccard i trigram Dice, sa normalizacijom dijakritika). Katalog se predaje
kao fajl, pa repo ne nosi kredencijale nijednog vanjskog sistema:

```bash
node dist/cli/index.js match --katalog izvoz.csv --out izvjestaj.json
node dist/cli/index.js match --katalog shopify-izvoz.json --with-sku
```

Prihvata se CSV sa kolonama `sifra, naziv, zaliha, cijena` (izvoz iz WooCommerce, ERP-a, Excela)
ili JSON (Shopify izvoz sa `handle/title/skus/totalInventory/price`, ili neutralna imena polja).
Prazna zaliha ostaje nepoznata, ne nula, da se ne skrije oglas koji je pun. Logika je u
`src/core/match.ts` i `src/core/katalog.ts`, pokrivena testovima (`npm test`).

## Snapshot kategorija i lokacija (statički, bez stalnog dohvatanja)

Kategorije i lokacije se rijetko mijenjaju, pa se jednom povuku u JSON i koriste kao statički MCP resource (`olx://categories`, `olx://locations`). Pokreni jednom kad token proradi:

```bash
node --env-file=.env dist/cli/index.js category dump      # -> olx-dokumentacija/categories.json
node --env-file=.env dist/cli/index.js location dump      # -> locations.json + locations.csv (lagani index)
```

`category dump` uz puni `categories.json` pravi i lagani `categories.csv` (index: id, parent_id, level, path, name + zastavice brand/model/has_models/show_condition/fee). CSV se regenerise iz JSON-a i bez API poziva: `node dist/cli/index.js category index`.

Zatim commitaj te fajlove. Poslije toga AI/MCP cita kategorije i lokacije iz resursa bez ijednog API poziva:

- `olx://categories-index` (CSV) za PRONALAZAK kategorije po imenu/path. Lagano, koristi prvo.
- `olx://categories` (puni JSON) samo kad trebas polja kojih nema u CSV-u.
- `olx://locations-index` (CSV) za `country_id` (BiH = 49) i `city_id` po imenu. Lagano, koristi prvo.
- `olx://locations` (puni JSON) samo za detalje (lat/lon, zip, state).

Za forme i opcije izabrane kategorije koristi live alat `olx_category_attributes <id>` (opcije nisu u snapshotu, dolaze iz API-ja). Pojedinacni live upiti su i dalje dostupni (`category list/children/get/brands/models`, `location countries/cities/city`).

## Jedan klon, jedan klijent, jedan nalog

Ovaj repozitorij se klonira po klijentu. U `.env` tog klona ide token samo tog naloga:

```bash
OLX_TOKEN=token_tog_naloga
```

Zato u toolkitu nema profila, nema prebacivanja naloga i nema alata koji mijenja nalog u letu.
Radnja ne moze zavrsiti na pogresnom klijentu, jer u procesu postoji samo jedan nalog. Za drugog
klijenta kloniraj repo ponovo i postavi njegov token.

Ko je klijent ovog klona pise u `KLIJENT.md` (kopija `KLIJENT.primjer.md`, u `.gitignore`):
naziv firme, username, glavne kategorije, ton komunikacije, sta bot smije bez pitanja i sta nikad
bez potvrde. Brojevi (paket, krediti, kvota obnova) se ne prepisuju tamo, nego citaju sa API-ja.

Kad token istekne: ako su u `.env` postavljeni `OLX_USERNAME` i `OLX_PASSWORD`, toolkit sam
obnovi token na prvi 401 i ponovi citanje. Radnje koje trose kredite se posle obnove NE ponavljaju
same, nego se javlja da ih treba pokrenuti ponovo, da se nista ne naplati dva puta.

## MCP server

```bash
npm run build
node dist/mcp/server.js   # radi preko stdio
```

## Za kolege: kloniranje i dodavanje MCP-a u Claude Code

Repozitorij ima `.mcp.json` u korijenu, pa Claude Code automatski ponudi `olx-pik` MCP server kad otvoriš projekat. Token se NE čuva u repou; svako postavlja svoj kroz env varijablu `OLX_TOKEN`.

Koraci poslije kloniranja:

```bash
# 1. Build (dist/ je u .gitignore, pa se mora lokalno izgraditi)
npm install
npm run build

# 2. Postavi svoj token u okruzenje (zamijeni vrijednost svojim tokenom)
export OLX_TOKEN=tvoj_token        # zsh/bash; trajno dodaj u ~/.zshrc ili ~/.bashrc

# 3. Otvori Claude Code u korijenu repozitorija
claude
```

Pri prvom otvaranju Claude Code pita da odobriš projektni MCP server `olx-pik`. Potvrdi, pa provjeri sa `/mcp`. Server preuzima `OLX_TOKEN` iz tvog okruzenja preko `${OLX_TOKEN:-}` u `.mcp.json` (prazan default ako varijabla nije postavljena).

Alternativa bez `.mcp.json` (registracija samo za tebe, token ostaje lokalno):

```bash
claude mcp add olx-pik -s user \
  -e OLX_TOKEN=tvoj_token \
  -e OLX_BASE_URL=https://api.olx.ba \
  -- node "$(pwd)/dist/mcp/server.js"
```

Napomene:
- Bez postavljenog `OLX_TOKEN` server se podigne, ali API pozivi vraćaju 401/403. Provjeri pristup sa `node --env-file=.env dist/cli/index.js whoami` ili kroz MCP alat `olx_whoami`.
- Token nikad ne commitati. `.env` i pravi tokeni su u `.gitignore`.

## Claude Code skillovi

Repozitorij nosi sedam skillova u `.claude/skills/` (folder je skriven u file browserima jer pocinje tackom, ali je u gitu):

- `olx-mcp-setup`: postavljanje i koristenje toolkita (token, MCP, CLI, troubleshooting).
- `olx-analiza-profila`: analiza vlastitog profila i oglasa uz strategiju iz KB resursa.
- `pik-olx-kreditni-savjetnik`: potrosnja kredita, izdvajanje, cjenovnik, strategija promocije.
- `olx-shopovi-snimci`: obrada Excel snimaka Gold/Platinum shopova (razdvajanje po kantonima, poredjenje dva snimka).
- `olx-seo-oglasa`: naslov, podnaslov i format opisa; izvjestaj pa primjena tek uz potvrdu.
- `olx-klijent-flow`: kandidat iz javnih podataka, onboarding sa tokenom, prvi potezi po ROI.
- `olx-cron-obnove`: dnevni pregled naloga i ravnomjerno trosenje kvote obnova.

Dolaze automatski sa kloniranjem; nista se ne instalira posebno. Sistemski prompt za bota je u
`CLAUDE.md` u korijenu.

### Dnevna obnova (cron unutar Claude)

Skill `olx-cron-obnove` opisuje dnevni ritual za nalog ovog klona: `olx_refresh_limits`, dry-run
pa obnova do dnevnog budzeta (preostala kvota podijeljena danima do kraja mjeseca), pa zbirni
izvjestaj sa upozorenjima (krediti pri kraju, paket istice, kvota ide u gubitak). Obnove unutar besplatne kvote ne kostaju, pa se izvrsavaju bez
pitanja; izdvajanje i akcijska cijena nikad automatski. Zakazuje se kao lokalni Claude cron job
(`CronCreate`, dnevno u 08:00), i to samo kad korisnik izricito to kaze. Racunar mora biti
upaljen u to vrijeme.

### Audit log

Svaka radnja koja mijenja stanje ili trosi kredite upisuje se u `.olx-pik/audit.jsonl` (jedan JSON
po liniji, van gita). Zapis nosi vrijeme, ime komande ili MCP alata, metodu, putanju, status,
trajanje i broj pokusaja, a kod odbijenog troska i to da potvrda nije data. Tijelo zahtjeva se
nikad ne zapisuje, jer login nosi lozinku. Citanja se ne biljeze osim ako se postavi
`OLX_AUDIT_READS=1`. Putanja se mijenja kroz `OLX_AUDIT_FILE`; prazna vrijednost gasi log.

### Podaci klijenata

Onboarding klijenta pise baseline i zapise poteza u `klijenti/<ime>/`. Taj folder je u
`.gitignore` jer sadrzi podatke klijenata. Token klijenta ide u `.env` tog klona kao `OLX_TOKEN`,
a kontekst klijenta u `KLIJENT.md`. Nista od toga ne ide u git.

Izvori znanja (jedan izvor istine, ne duplirati brojeve po skillovima):
- `olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md` — pravila platforme, paketi, kvote, pretraga.
- `olx-dokumentacija/API-INVENTAR.md` — svi MCP alati, parametri, rupe u API-ju.
- `olx-dokumentacija/PIK-pomoc-korpus/` — 52 zvanicna clanka podrske (pomoc.olx.ba).

`PLAN.md` je arhiviran handoff iz faze prije builda; stvarno stanje opisuju README i API-INVENTAR.
