---
name: olx-cron-obnove
description: >-
  Dnevni pregled i obnova oglasa na OLX/PIK nalogu ovog klona, sa ravnomjernim trosenjem mjesecne
  kvote obnova. Koristi ovaj skill kad korisnik trazi dnevnu ili automatsku obnovu, pita koliko
  obnova da potrosi danas, hoce dnevni pregled stanja, ili trazi da se obnova zakaze.
  Okidaci: "obnovi oglase", "dnevna obnova", "koliko obnova danas", "zakazi obnove", "cron
  obnove", "pregled naloga", "iskoristi kvotu obnova". Obnove unutar besplatne kvote se
  izvrsavaju bez pitanja jer ne kostaju; izdvajanje i akcijska cijena nikad automatski, samo kao
  preporuka u izvjestaju.
---

# Dnevna obnova kroz sve naloge

Obnova daje oglasu svjez datum i dize ga na vrh kategorije medju standardnim oglasima. Besplatna
je do mjesecne kvote, pa je neiskoristena kvota cist gubitak. Zato se ne trosi u jednom danu,
nego ravnomjerno kroz mjesec.

Brojeve ne pretpostavljaj. Kvota se cita sa API-ja (`olx_refresh_limits`), jer se razlikuje po
nalogu; poznata protivrjecnost zvanicne pomoci i izmjerenog stanja je opisana u
`olx://knowledgebase`, sekcija 5.4.

## Dnevni ritual

1. `olx_whoami` — potvrdi nalog ovog klona i reci korisniku koji je. Ako padne (401 ili 403),
   stani i prijavi: token ne vrijedi ili shop nema odobren API pristup (skill olx-mcp-setup).
1a. Dnevni snapshot pregleda (CLI, PRIJE obnova): `node dist/cli/index.js stats snapshot`.
   Traje 1-2 minute (jedan zahtjev po oglasu), pise `.olx-pik/snapshots/views-YYYY-MM-DD.json`.
   Bez ovih dnevnih snimaka se efekat izdvajanja ne moze mjeriti (`olx_sponsor_effect`).
2. `olx_refresh_limits` — `free_limit`, `free_count`. Preostalo = `free_limit - free_count`.
3. Dnevni budzet obnova = preostalo / broj dana do kraja mjeseca, zaokruzeno nadolje, najmanje 1
   kad je preostalo vece od nule. Zadnjeg dana mjeseca potrosi sve preostalo (kvota se ne prenosi).
4. `olx_refresh_bulk confirm=false limit=<dnevni budzet>` — dry-run. Vraca kandidate
   (`refresh_available: true`) i preostalu kvotu. Ako kandidata nema, nalog je zavrsen za danas.
5. Prioritet unutar budzeta: oglasi sa najstarijim datumom prvi (`date` u listi oglasa), jer su
   oni najdublje pali. Ako je kandidata vise nego budzeta, ostatak ide na sutra.
6. `olx_refresh_bulk confirm=true limit=<dnevni budzet>` — izvrsi. Ovo ne trosi kredite, samo
   besplatnu kvotu, pa se radi bez pitanja korisnika.
7. Zapisi ishod: koliko obnovljeno, koliko palo, koliko kvote ostalo.

Na kraju ispisi izvjestaj.

## Izvjestaj

| obnovljeno danas | neuspjelo | preostala kvota | dana do kraja mjeseca | upozorenja |

Upozorenja: pozovi `olx_account_alerts` (jedan poziv pokriva neodgovorena pitanja, paket pri
isteku, saldo kredita, kvotu koja propada i istekle oglase) i prenesi njegove alarme u
izvjestaj. Dodatno rucno provjeri i samo prijavi, nikad ne izvrsavaj:

- izdvajanje na oglasu istice danas ili sutra (`sponsor_active.sponsored_until` na oglasu),
- oglasi koji stalno padaju na obnovi (isti id vise dana zaredom),
- oglasi sa mnogo pregleda i bez upita, ili sa naslovom bez kljucnih rijeci: to je posao za
  skill `olx-seo-oglasa`, ne za obnovu.

## Granice

- Obnova unutar besplatne kvote: izvrsava se bez pitanja.
- Izdvajanje, akcijska cijena, izmjene naslova i cijena, sakrivanje i zavrsavanje oglasa: nikad
  automatski. Idu samo kao preporuka u izvjestaju.
- Nikad ne prekoraci `free_limit - free_count`. `olx_refresh_bulk` sam ogranicava na tu vrijednost,
  ali i dnevni budzet racunaj iz nje, ne iz zeljenog broja.
- Ne brisi i ne objavljuj ponovo oglase da bi dosli na vrh. To je spam po pravilima platforme.
- Obnove se biljeze u audit log (`.olx-pik/audit.jsonl`), pa se kasnije moze dokazati sta je i
  kada obnovljeno.

## Zakazivanje

Dvije varijante. Prva ne kosta nista i ne zavisi od modela, druga daje izvjestaj i upozorenja.

### Varijanta A: sistemski cron preko CLI-ja (bez modela)

Kvota, filtriranje kandidata i gornja granica su u kodu (`src/cli/index.ts`, komanda `refresh all`),
ne u promptu. Zato dnevna obnova ne treba Claudea: obicna crontab linija radi isti posao, bez
troska po tokenima i bez zavisnosti od modela ili pretplate.

```
0 3 * * * cd /putanja/do/olx-mcp-api && node dist/cli/index.js refresh all --limit 60 --yes >> .olx-pik/cron.log 2>&1
30 2 * * * cd /putanja/do/olx-mcp-api && node dist/cli/index.js stats snapshot >> .olx-pik/cron.log 2>&1
```

Druga linija je dnevni snapshot pregleda (prije obnova, da snimak ne pokupi svjeze datume);
bez njega `olx_sponsor_effect` nema podatke za mjerenje.

- `cd` u korijen repoa je obavezan: CLI cita `.env` iz radnog direktorija, pa token ne mora u
  crontab liniju. `OLX_TOKEN` mora biti popunjen, inace job svaku noc tiho pada na AUTH gresci.
- `--limit` je gornja granica, a ne cilj. Stvarni cap ostaje `free_limit - free_count`.
- Bez `--yes` komanda samo prikazuje kandidate, sto je nacin da se linija provjeri prije zakazivanja.
- Ova varijanta ne daje izvjestaj ni upozorenja iz sekcije gore, samo obnavlja. Za analizu se
  ritual pokrece rucno kroz Claudea kad zatreba.

### Varijanta B: cron unutar Claude (sa izvjestajem)

Ritual se moze zakazati kao lokalni Claude cron job, jedan poziv dnevno, predlozeno 08:00:

- Registracija: `CronCreate` sa dnevnim rasporedom i promptom `/olx-cron-obnove`.
- Pregled: `CronList`. Ukidanje ili pauza: `CronDelete`.

Prije registracije ritual se pokrene rucno bar jednom, da se vidi izvjestaj i provjeri da je
obnovio samo do izracunatog dnevnog budzeta. Cron se registruje samo kad korisnik izricito kaze
da ga ukljuci.

Ogranicenja zakazivanja koja korisnik mora znati:

- Racunar mora biti upaljen u vrijeme izvrsavanja. Job se ne izvrsava na spavanju i propusteni
  dan se ne nadoknadjuje sam.
- Radi lokalno, na ovoj masini i sa tokenima iz lokalnog `.env`.
- Ako se profil ili token promijeni, job ce prijaviti gresku za taj nalog i nastaviti ostale.
