---
name: olx-klijent-flow
description: >-
  Zivotni ciklus klijenta za OLX/PIK uslugu CodeFactory: interna analiza kandidata iz javnih
  podataka, onboarding kad potpise, i prvi potezi po redoslijedu isplativosti. Koristi ovaj skill
  kad korisnik pominje potencijalnog klijenta ili kandidata, trazi pitch ili analizu tudjeg shopa,
  preuzima novi nalog, ili pita odakle poceti sa svjezim klijentom. Okidaci: "analiziraj
  kandidata", "potencijalni klijent", "pitch za klijenta", "onboarding klijenta", "novi klijent",
  "prvi potezi za klijenta", "trazi token od klijenta", "preuzeli smo shop". Za sam SEO naslova
  koristi olx-seo-oglasa, za raspored kredita pik-olx-kreditni-savjetnik.
---

# Klijent flow: kandidat, onboarding, prvi potezi

Tri faze, svaka sa svojim receptom. Ne mijesaj ih: kandidat se gleda bez njegovog pristupa,
onboarding trazi token, prvi potezi traze potvrdu za svaki potez koji nesto mijenja ili trosi.

- Faza 1, analiza kandidata: `references/analiza-kandidata.md`
- Faza 2, onboarding: `references/onboarding-checklista.md` i `references/token-poruka.md`
- Faza 3, prvi potezi: nize u ovom fajlu

Ovaj skill ne drzi cjenovnik nasih usluga. To je interno i van repozitorija.

## Faza 1: analiza kandidata (bez njegovog tokena)

Sve iz javnih podataka: `olx_user_profile`, `olx_list_listings` po stanjima, uzorak
`olx_get_listing`, i provjera kategorija. Izlaz je interni dokument sa 3 do 5 konkretnih
propusta i procjenom sta se da popraviti. Recept, obrazac propusta i granice nalaza su u
`references/analiza-kandidata.md`.

Sto se iz javnih podataka NE vidi: krediti, statistika pregleda, pojmovi pretrage, stvarna
prodaja. Ne nagadjati te brojeve; njihovo odsustvo je i sam argument za saradnju.

## Faza 2: onboarding (klijent je potpisao)

Pet koraka: token od klijenta, novi klon repozitorija za tog klijenta, upis `OLX_TOKEN` u `.env`
tog klona i popunjen `KLIJENT.md`, provjera naloga (`olx_whoami`), i baseline izvjestaj u
`klijenti/<ime>/baseline-<datum>.md`. Detalji i provjere po koraku su u
`references/onboarding-checklista.md`; gotova poruka za token je u `references/token-poruka.md`
(kopiraj je u clipboard i javi korisniku).

Folder `klijenti/` je u `.gitignore`: sadrzi podatke klijenata i nikad ne ide u git.

## Faza 3: prvi potezi (redoslijed po isplativosti)

Redoslijed nije proizvoljan. Vidljivost prije promocije: izdvajanje ne spašava naslov koji
pretraga ne nalazi (hijerarhija u `olx://knowledgebase`, 5.1).

1. SEO pass naslova i podnaslova — skill `olx-seo-oglasa`. Besplatno, najveci efekat, jer bez
   kljucnih rijeci oglas ne postoji za tražilicu. Ocekivani efekat: oglasi ulaze u rezultate za
   pojmove koje kupci stvarno kucaju. Trazi potvrdu po redu, ne mijenja se sve odjednom.
2. Ispravka kategorija — `olx_suggest_category` pa poredjenje sa trenutnom, izmjena kroz
   `olx_update_listing` sa `category_id`. Prije izmjene provjeri obavezne atribute nove
   kategorije (`olx_category_attributes`), inace API vraca 422. Ocekivani efekat: oglas postoji
   za kupca koji pretrazuje kroz kategoriju.
3. Raspored obnova — skill `olx-cron-obnove`. Besplatno do mjesecne kvote koju vraca
   `olx_refresh_limits`. Ocekivani efekat: stalna svjezina, bez trosenja kredita.
4. Prijedlog izdvajanja — skill `pik-olx-kreditni-savjetnik`. Tek kad su prva tri odradjena, i
   samo na artikle koji nose promet. Uvijek prvo `olx_sponsor_price`, pa potvrda klijenta, pa
   izvrsenje sa `confirm: true`.

Nakon svakog poteza zapisi sta je uradjeno u `klijenti/<ime>/` (isti folder kao baseline), da se
za mjesec dana moze uporediti sa polaznim stanjem.

## Tvrda pravila

- Prije svakog upisa i svakog troska: `olx_whoami`, i reci korisniku na kojem si nalogu. Jedan
  klon radi za jedan nalog, pa promjena naloga kroz bota ne postoji.
- Nista se ne trosi bez izricite potvrde. Obnove unutar besplatne kvote su izuzetak i njih
  radimo bez pitanja, jer ne kostaju.
- Bot ne brise oglase. Na "obrisi" predlozi `olx_finish_listing`.
- Podaci klijenata ostaju lokalno: `.env` za token, `klijenti/` za dokumente, oboje u
  `.gitignore`.
- Analiza kandidata ne dira tudji nalog. Samo citanje javnih podataka.
