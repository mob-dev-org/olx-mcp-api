---
name: olx-cron-obnove
description: >-
  Dnevni pregled i obnova oglasa kroz sve OLX/PIK naloge, sa ravnomjernim trosenjem mjesecne
  kvote obnova. Koristi ovaj skill kad korisnik trazi dnevnu ili automatsku obnovu, pita koliko
  obnova da potrosi danas, hoce zbirni pregled svih klijenata, ili trazi da se obnova zakaze.
  Okidaci: "obnovi oglase", "dnevna obnova", "koliko obnova danas", "zakazi obnove", "cron
  obnove", "pregled svih naloga", "iskoristi kvotu obnova". Obnove unutar besplatne kvote se
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

## Ritual, za svaki profil

Zapamti pocetni nalog na startu, da ga na kraju vratis.

1. `olx_list_accounts` — popis profila. Radi redom kroz sve.
2. `olx_switch_account profile=<ime>` pa `olx_whoami` — potvrdi da si stvarno na tom nalogu.
   Ako `whoami` padne (401 ili 403), preskoci nalog, zapisi razlog u izvjestaj i nastavi dalje.
3. `olx_refresh_limits` — `free_limit`, `free_count`. Preostalo = `free_limit - free_count`.
4. Dnevni budzet obnova = preostalo / broj dana do kraja mjeseca, zaokruzeno nadolje, najmanje 1
   kad je preostalo vece od nule. Zadnjeg dana mjeseca potrosi sve preostalo (kvota se ne prenosi).
5. `olx_refresh_bulk confirm=false limit=<dnevni budzet>` — dry-run. Vraca kandidate
   (`refresh_available: true`) i preostalu kvotu. Ako kandidata nema, nalog je zavrsen za danas.
6. Prioritet unutar budzeta: oglasi sa najstarijim datumom prvi (`date` u listi oglasa), jer su
   oni najdublje pali. Ako je kandidata vise nego budzeta, ostatak ide na sutra.
7. `olx_refresh_bulk confirm=true limit=<dnevni budzet>` — izvrsi. Ovo ne trosi kredite, samo
   besplatnu kvotu, pa se radi bez pitanja korisnika.
8. Zapisi ishod: koliko obnovljeno, koliko palo, koliko kvote ostalo.

Na kraju se vrati na pocetni nalog (`olx_switch_account`) i ispisi zbirni izvjestaj.

## Zbirni izvjestaj

Tabela po profilu:

| profil | obnovljeno danas | neuspjelo | preostala kvota | dana do kraja mjeseca | upozorenja |

Upozorenja koja se traze i samo prijavljuju, nikad ne izvrsavaju:

- krediti pri kraju (klijent ne moze izdvajati kad zatreba),
- paket istice za manje od 7 dana (`olx_user_profile`, polje `shop.ends_at`, unix timestamp u
  sekundama),
- izdvajanje na oglasu istice danas ili sutra,
- kvota obnova ide u gubitak (preostalo veliko a dana malo),
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
- Ako mijenjas nalog, na kraju uvijek vrati pocetni, da naredni rad ne krene na tudjem nalogu.

## Zakazivanje (cron unutar Claude)

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
