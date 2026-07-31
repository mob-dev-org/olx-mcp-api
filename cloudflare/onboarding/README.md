# Web onboarding OLX naloga

Klijent dobije link, otvori PikGPT stranicu, unese OLX pristup. Token zavrsi sifrovan u Cloudflare
KV, admin masina ga povuce, desifruje svojim privatnim kljucem, upise u `.env` klona i pokrene
analizu na pretplati. Puna slika i obrazlozenje: plan u korijenu (`arhitektura.md` za sistem).

Stranica je brendirana kao PikGPT, NE oponasa OLX. Lozinka se nigdje ne cuva: Worker je proslijedi
OLX-u u jednom pozivu i odbaci.

## Dijelovi

- `worker.js` Cloudflare Worker: forma, OLX login, sifrovanje tokena, KV.
- `wrangler.toml` konfiguracija Workera.
- `scripts/lib/ecies.mjs` enkripcija (ECDH P-256 + AES-GCM), dijele je Worker i puller.
- `scripts/onboarding-kljuc.mjs` pravi admin par kljuceva.
- `scripts/onboarding-link.mjs` pravi link i registruje sesiju (admin masina).
- `scripts/onboarding-puller.mjs` povlaci token, upisuje u klon, pokrece analizu.
- `scripts/onboarding-analiza.sh` + `runtime/recepti/onboarding-analiza.md` puni KLIJENT fajlove.
- `deploy/launchd/ba.codefactory.olx.ADMIN.onboarding-puller.plist` zakazivanje pullera.

## Postavka (jednom)

1. Kljucevi na admin masini:
   ```
   node scripts/onboarding-kljuc.mjs
   ```
   Privatni ide u `~/.pikgpt/onboarding-priv.b64` (0600), javni se ispise i kopira u clipboard.

2. Cloudflare Worker:
   ```
   cd cloudflare/onboarding
   npx wrangler login
   npx wrangler kv namespace create SESIJE      # id zalijepi u wrangler.toml (polje id)
   # PULL_SECRET: NAJMANJE 24 znaka. Kraci se odbija, i to namjerno: bez donje granice bi
   # deploy prije `secret put` otvorio admin rute svijetu (prazno prema praznom se poredi
   # kao jednako). Predlog: openssl rand -base64 32
   npx wrangler secret put PULL_SECRET           # isti string ide u puller config
   npx wrangler secret put ADMIN_PUB             # zalijepi javni kljuc iz koraka 1
   npx wrangler deploy
   ```
   Zapamti adresu Workera, npr. `https://pikgpt-onboarding.<tvoj>.workers.dev`.

3. Config admin masine `~/.pikgpt/config.json`:
   ```json
   { "workerBase": "https://pikgpt-onboarding.<tvoj>.workers.dev", "pullSecret": "<isti PULL_SECRET>" }
   ```

4. Puller na raspored (admin masina, Mac):
   ```
   sed "s|KORIJEN|$PWD|g" deploy/launchd/ba.codefactory.olx.ADMIN.onboarding-puller.plist \
     > ~/Library/LaunchAgents/ba.codefactory.olx.ADMIN.onboarding-puller.plist
   launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/ba.codefactory.olx.ADMIN.onboarding-puller.plist
   ```

## Onboarding jednog klijenta

Klon mora vec postojati (skill `olx-novi-klijent`: klon, `.env`, Telegram runtime, cron). Onda:

```
node scripts/onboarding-link.mjs ~/olx-klijenti/<ime>
```

Link je kopiran u clipboard. Posalji ga klijentu. Kad se uloguje, puller u roku od par minuta:

- upise `OLX_TOKEN` u `.env` klona, provjeri `auth whoami`,
- pokrene analizu koja popuni `KLIJENT-javno.md` i cinjenicni dio `KLIJENT.md`,
- javi klijentu u Telegram da je povezan, a tebi da dopunis komercijalni dio.

Komercijalni dio (budzet kredita, popusti, granice) analiza NAMJERNO ne dira. Pregledaj
`KLIJENT.md` i dopuni prije nego shop krene uzivo.

## Provjere (bez deploya)

```
node scripts/lib/ecies.mjs --self-test        # enkripcija radi, pogresan kljuc pada
node cloudflare/onboarding/test-worker.mjs     # rute, brojac pokusaja, token nikad citljiv u KV
node cloudflare/onboarding/test-mac.mjs         # link + puller do upisa OLX_TOKEN u .env
```

`test-mac.mjs` pokrece prave skripte kao odvojene procese uz lokalni server; radi na tvojoj
masini (u nekim sandbox okruzenjima child proces ne moze do lokalnog servera).

## Najkraci put: jedna komanda, bez Cloudflare naloga

```
node scripts/onboarding-uzivo.mjs <putanja-do-klona>
```

Skripta sama pripremi kljuceve i tajnu, digne Worker LOKALNO (`wrangler dev --local`), otvori
Cloudflare brzi tunel, ispise link i kopira ga, pa ceka. Kad se klijent uloguje, token ide u
`.env` klona, prodje `whoami`, pokrene se analiza i sesija se obrise.

Sto ovaj put NE trazi: `wrangler login`, KV namespace, `wrangler secret put`, `wrangler deploy`.
Izmjereno 31.07.2026: `wrangler dev --local` radi bez ijedne prijave, KV se simulira lokalno i
placeholder `id` u `wrangler.toml` ne smeta.

Dvije posljedice koje vrijedi znati:

- **Link zivi samo dok skripta radi.** Kad je ugasis, link prestaje raditi. Za onboarding je to
  dobro: nema zaostalog javnog linka.
- **OLX login ide sa TVOJE IP adrese**, ne sa Cloudflare datacentra, jer Worker radi na tvom
  kompjuteru. Time pitanje egress adrese uopste ne postoji.

Deploy varijanta ispod ostaje moguca ako ti ikad zatreba trajan link.

## Sigurnost

- Lozinka klijenta nikad se ne cuva. Rizik je Worker u prolazu; kod je namjerno minimalan i bez
  logovanja tijela. Klijent koji zna svoj token moze na formi kliknuti "Imam OLX token" i lozinku
  ne unositi uopste.
- **Zasto lozinka uopste, a ne samo token.** Nije stvar pogodnosti: u repou ne postoji nijedno
  mjesto gdje korisnik sam generise token, a tacno mjesto je nepoznato (`API-INVENTAR.md`, dio o
  autentikaciji). Token nastaje jedino kroz `/auth/login`, dakle iz korisnickog imena i lozinke.
  Grana "Imam OLX token" zato radi samo za klijenta koji token vec ima.
- **Mjera koju vrijedi uvijek predloziti klijentu: da promijeni OLX lozinku poslije onboardinga.**
  Token ostaje vazeci, a lozinka koja je prosla kroz nasu formu prestaje vrijediti. Jedan potez,
  bez ikakve stete, i uklanja jedinu preostalu izlozenost.
- Ako se ikad potvrdi da OLX izdaje tokene za shopove zvanicno, kredencijalna grana i sifrovanje
  postaju nepotrebni. Vrijedi pitati podrsku.
- Token u KV je samo ECIES sifrat. Bez privatnog kljuca sa admin masine se ne moze procitati.
- Privatni kljuc, `PULL_SECRET` i KV id nikad ne idu u git.
- Dok `PULL_SECRET` nije postavljen (ili je kraci od 24 znaka), `/admin/*` i `/pull` vracaju
  401 na svaki zahtjev. Ako poslije deploya dobijas 401 iz pullera, prvo provjeri duzinu tajne.
- Provjereno uzivo 31.07.2026: OLX prihvata login preko API-ja, token je sifrovan u Workeru i
  desifrovan admin privatnim kljucem, upisan u `.env` i prosao `whoami`. Egress IP nije pitanje
  kod lokalnog puta.
