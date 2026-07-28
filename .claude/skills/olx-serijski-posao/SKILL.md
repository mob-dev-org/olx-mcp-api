---
name: olx-serijski-posao
description: >-
  Posao koji ide kroz mnogo oglasa odjednom: SEO prolaz, ciscenje kataloga, obilazak konkurenata.
  Okidaci: "prodji kroz sve oglase", "sredi cijeli katalog", "ocisti katalog", "provjeri sve
  konkurente". Samo za admin sesiju, ne za razgovor sa klijentom.
---

# Serijski posao kroz mnogo oglasa

Za posao koji dira desetine ili stotine oglasa. Ne pokrece se u klijentskom razgovoru: tamo je
`Task` zabranjen, a klijent ne treba cekati tim agenata da odgovori na jedno pitanje.

## Zasto ovako a ne u jednom razgovoru

Nije zbog kraceg prompta, nego zbog **izolacije konteksta**. Podagent procita jedan oglas i vrati
pet redova. Bez toga do stotog oglasa vuces sto punih payloada u istom razgovoru, pa i kvalitet
odgovora pada, ne samo cijena.

## Obrazac: kod bira, model prosudjuje

Determinizam ostaje u kodu. Model se poziva samo za dio koji trazi prosudbu.

1. **Izbor kandidata radi agregat, ne model.** Ne prelistavaj katalog rucno:
   - SEO prolaz: `olx_onboarding_report` pa uzmi nalaze `naslov_kratak` i `bez_podnaslova`.
   - Ciscenje: `olx_mrtvi_oglasi`.
   - Konkurenti: popis usernameova iz `KLIJENT.md`.
2. **Odsijeci na razuman broj.** Prvi prolaz najvise 20 stavki. Bolje dvije ture koje korisnik
   pregleda nego jedna koju preskoci.
3. **Fan out preko podagenata**, jedan poziv po stavci, svi u jednoj poruci da idu uporedo:
   - `olx-seo-pisac` za tekst oglasa
   - `olx-trijaza` za odluku popraviti, sakriti ili zavrsiti
   - `olx-konkurent` za jednog konkurenta
   Nijedan od njih ne moze potrositi kredit ni promijeniti oglas; oni samo vracaju prijedlog.
4. **Sakupi u jednu tabelu**, najvise 15 redova po poruci uz broj preostalih.
5. **Primjena tek nakon potvrde**, i to grupnim alatom:
   - cijene: `olx_bulk_price` (prvo bez `confirm`, pa sa)
   - sklanjanje: `olx_bulk_sklanjanje` (prvo bez `confirm`, pa sa)
   - tekst: `olx_update_listing` jedan po jedan, jer nema grupnog alata za tekst
6. **Javi ishod u jednom redu**: koliko primijenjeno, koliko palo, sta ostaje za sljedecu turu.

## Kad NE koristiti podagente

- Manje od pet stavki. Rezije vise nego koristi.
- Kad je posao cisto racunski (koliko obnova danas, koliko kredita). To radi agregat sam.
- U klijentskom razgovoru. Nikad.
