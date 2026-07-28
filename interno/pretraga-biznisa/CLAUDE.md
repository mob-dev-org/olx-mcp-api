# Pretraga biznisa po djelatnosti (interni alat)

> **Samo za nasu internu analizu (CodeFactory).** Ovo NIJE dio proizvoda i ne smije doci do
> klijenta ni u kojem obliku: ne kao MCP alat, ne kao skill, ne kao izlaz koji bot ikad pomene
> ili posalje. Sluzi da MI sami, van klijentskih naloga, procjenjujemo trziste (npr. ko su
> stvarni potencijalni klijenti u nekoj djelatnosti). Klijentski runtime
> (`runtime/SISTEM-klijent.md`, MCP profil `klijent`) nema i ne smije dobiti pristup ovom
> folderu, njegovim skriptama ni izlazima.

Ovaj folder je samostalan alat, odvojen od `src/core` / `src/cli` / `src/mcp` toolkita.
Sluzi da se preko snimka Gold/Platinum shopova (xlsx export sa PIK.ba) utvrdi ko se STVARNO
bavi odredjenom djelatnoscu, jer naziv shopa cesto laze (npr. mnogi prodavci auto dijelova
zovu se "autokuca" ili "autocentar").

Nastalo iz zadatka: razdvajanje pravih auto salona (vozila) od prodavaca auto dijelova na
3874 Gold/Platinum shopa, snimljenih 26.07.2026. Napravljeno generickim da se isti alat
koristi za bilo koju drugu djelatnost (namjestaj, nekretnine, elektronika...), ne samo vozila.

## Kako radi

1. **`server.mjs`** — lokalni destilator izmedju AI-ja i PIK API-ja (`https://api.olx.ba`).
   Pretvara sirovi katalog shopa (~6000 tokena po stranici) u kompaktan sazetak (~120 tokena):
   histogram `top_category_id` po uzorku oglasa + 7 reprezentativnih naslova. Ovaj dio NIJE
   vezan za vozila, radi za bilo koju kategoriju jer samo vraca sta postoji.

   Pokretanje: `OLX_TOKEN=<token> node server.mjs` (default port 4001, `DESTILATOR_PORT` za drugi).

   - `GET /shop/:username` — sazetak jednog shopa. Opcije: `?uzorak=deep` (60 oglasa umjesto 20),
     `?podnaslovi=true` (dodaje `short_description`, 7 dodatnih poziva).
   - `POST /shops {"usernames":[...]}` — isto, za vise shopova odjednom.
   - Sve prolazi kroz jedan red: najvise 2 zahtjeva/s prema PIK-u, retry 1s/4s/10s na 429/5xx.
   - Keš na disku u `cache/{username}.json`, vazi 24h.
   - Samo citanje. Ne diraj sponsore, discount, refresh, hide, finish, delete.

2. **`klasifikuj.mjs <profil>`** — prvi i drugi prolaz klasifikacije preko destilatora, za sve
   shopove iz snimka. Prvi prolaz je deterministicki (histogram, bez AI rasudjivanja); drugi
   prolaz (dublji uzorak + podnaslovi) ide samo na sporne slucajeve.

   Piše `izlazi/<profil>/progress.jsonl`, red po shopu — prekid ne gubi posao, ponovno
   pokretanje nastavlja gdje je stalo (citanjem `progress.jsonl`).

3. **`koriguj.mjs <profil>`** — post-processing bez novih API poziva: iz keša (koji ima pun
   histogram) razdvaja "sporedna_ili_ostalo" na pravu sporednu djelatnost i na "nema veze
   uopste s trazenom djelatnoscu" (npr. kod vozila: shop koji prodaje nekretnine ne treba
   zavrsiti oznacen kao "dijelovi" samo zato sto ima 0% vozila). Piše finalni
   `izlazi/<profil>/shopovi.csv` i `izlazi/<profil>/sazetak.md`.

## Profili (`profili/*.json`)

Profil definise sta se trazi. Polja:

- `snimak` — ime fajla u `snimci/` (ulazni podaci iz xlsx-a, isti snimak moze posluziti za
  vise profila).
- `top_category_id_cilj` / `top_category_id_sporedna` — brojevi kategorije sa PIK-a
  (`GET /categories`) za ciljnu i sporednu djelatnost. Za vozila: `"1"` = Vozila,
  `"928"` = Dijelovi za vozila.
- `shop_category_id_cilj` / `shop_category_id_sporedna` — kategorija koju shop sam prijavi na
  profilu (drugi brojevni prostor od gornjeg!). Za vozila: `1` = vozila, `17` = auto dijelovi.
- `prag_cilj_prvi_prolaz` / `prag_sporedna_prvi_prolaz` — pragovi udjela za prvi (brzi) prolaz.
- `prag_cilj_drugi_prolaz` / `prag_sporedna_drugi_prolaz` — blazi pragovi za drugi (dublji)
  prolaz, jer se tu vec gleda i sadrzaj naslova/podnaslova, ne samo brojka.
- `pojmovi_naziv` — rijeci koje "zvuce" kao ciljna djelatnost, koriste se SAMO za izvjestaj o
  greskama klasifikacije po nazivu, ne za suzavanje skupa koji se provjerava (provjerava se
  citav snimak).
- `naziv_ciljne_klase` / `naziv_sporedne_klase` / `naziv_ostalih` — labele u izlaznom CSV-u.

## Kako dodati pretragu za novu djelatnost

1. Nadji `top_category_id` za ciljnu i (ako postoji) sporednu kategoriju: `GET /categories`
   preko destilatora ili direktno na PIK API-ju.
2. Kopiraj `profili/vozila.json` u `profili/<nova-djelatnost>.json`, promijeni kategorije,
   pragove, pojmove i nazive klasa.
3. Ako je snimak isti (isti xlsx), samo referenciraj isti fajl u `snimci/`. Ako je nov snimak,
   izvezi ga iz xlsx-a u JSON istog oblika kao `snimci/shopovi-snimak-2026-07-26.json`
   (`username, naziv, paket, grad, kanton, oglasa_snimak, web, link`).
4. Pokreni servis (`node server.mjs`), pa `node klasifikuj.mjs <nova-djelatnost>`, pa
   `node koriguj.mjs <nova-djelatnost>`.
5. Provjeri kontrolne tacke rucno na par poznatih primjera prije nego vjerujes cijelom
   izlazu — isti princip kao kod profila `vozila` (par sigurno pozitivnih i par sigurno
   negativnih primjera, provjeriti da padnu na ocekivanu stranu).

## Poznati nalazi (profil `vozila`, snimak 26.07.2026)

Vidi `izlazi/vozila/sazetak.md` za pun izvjestaj. Ukratko: od 3874 shopa, 610 je stvarni
auto salon, 307 stvarno prodaje auto dijelove, 1169 nema nikakve veze s automobilima
(pogresno bi upalo u "dijelovi" da nema koriguj.mjs koraka), 1775 je neaktivno (0 oglasa).

Potvrdjeni testni slucajevi (koriste se za provjeru logike prije nego se vjeruje novom
snimku ili novoj djelatnosti):
- `AutokucaUno` — pravi salon (Škoda diler, Tešanj), shop_category_id 1.
- `AUTOKUCA_PALAC`, `achama`, `vipautocentar`, `autocentareno`, `AutoKucaVolan`,
  `AutoCentarARENA`, `autocentarmx` — prodaju dijelove uprkos "auto" imenu.

## Tehnicke napomene

- Ovo NIJE dio MCP servera (`src/mcp`) niti CLI-a (`src/cli`). Radi kao odvojen Node proces,
  bez novih npm zavisnosti (koristi ugradjeni `http` i `fetch`).
- Token se cita iz `OLX_TOKEN` env varijable u trenutku pokretanja `server.mjs`, nikad se ne
  pise u kod, log ili izlazne fajlove.
- `cache/` i `izlazi/*/progress.jsonl` mogu narasti (hiljade fajlova/redova) — normalno je,
  to je radni materijal, ne treba ga cistiti izmedju pokretanja iste djelatnosti.
