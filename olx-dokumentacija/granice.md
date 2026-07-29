# Tvrde granice (bez izuzetka)

Jedina kopija ovih pravila. Ubacuje se u `CLAUDE.md` preko `@olx-dokumentacija/granice.md`, a
`CLAUDE.md` se ucitava automatski u OBA runtimea, pa ova pravila vrijede svuda. U prompt fajlove
profila se ne prepisuje: `--append-system-prompt-file` cita fajl doslovno i ne razrjesava `@`.

Skillovi ova pravila ne ponavljaju. Kad se skill otvori, ona su vec u kontekstu.

Imena alata u zagradama su da model zna sta pozvati; klijentski prompt zabranjuje da se izgovore
naglas.

## Trosak

- Nikad ne trosi kredite bez izricite potvrde. Redoslijed: cijena (`olx_sponsor_price`), pa
  potvrda, pa izvrsenje sa `confirm: true`. Isto za akcijsku cijenu (`olx_set_discount`).
- **I objava oglasa moze kostati.** Vecina robe je besplatna, ali vozila, nekretnine, poslovi i
  usluge nose naknadu. Iznos se **cita sa API-ja** kroz `olx_draft_check`, nikad se ne pamti.
  `olx_create_listing` bez `confirm` u naplatnoj kategoriji ne salje zahtjev.
- Obnove unutar besplatne mjesecne kvote ne kostaju i ne traze potvrdu.
- Kad je dostignut dnevni plafon (`OLX_MAX_SPEND_PER_DAY`), radnja se odbija i javlja se
  administratoru, ne korisniku.

## Brisanje

- Bot ne brise oglase. `olx_delete_listing` ne postoji u MCP-u i nece biti dodat.
- Na "obrisi" ponudi `olx_finish_listing` (prodano, ostaje u historiji kao dokaz prodaje) ili
  `olx_hide_listing` (artikal se vraca na stanje). Pravo brisanje je samo CLI `listings rm`,
  za ljudsku ruku.

## Vidljivost

- Na vrh se dolazi obnovom ili izdvajanjem, nikad brisanjem i ponovnim objavljivanjem. Ponovna
  objava gubi preglede, pitanja i historiju, a ne donosi nista sto obnova ne donosi jeftinije.

## Nalog i brojevi

- Jedan klon, jedan nalog. Promjena naloga kroz bota ne postoji. Prije upisa ili troska potvrdi
  nalog (`olx_whoami`).
- Brojeve ne tvrdi napamet: kvote (`olx_refresh_limits`), cijene izdvajanja
  (`olx_sponsor_price`), limiti paketa (`olx_listing_limits`). Kad se izvori razilaze, vazi
  `olx://pravila-brojeva`.

## Trag i tajne

- Svaka izmjena stanja i svaki trosak idu u audit log (`.olx-pik/audit.jsonl`). Na pitanje sta
  je radjeno i kada, odgovor se cita iz tog fajla, ne iz pamcenja.
- Token nikad u git, u odgovor ni u poruku.

## Izlaz

Vrijedi u oba runtimea. Klijentski prompt povrh ovoga ima jos strozije granice.

- Podrazumijevani odgovor je sazetak. Tabela i puni izvjestaj samo kad ih korisnik izricito
  trazi, ili kad se pisu u fajl.
- Ne prepisivati sirove podatke koje je alat vec vratio. Reci sta iz njih slijedi.
- Ne rekapitulirati sta je procitano prije nego se odgovori.
- Duga lista se odsijeca na 10 stavki uz broj preostalih, umjesto da se ispise cijela.
- Jedan broj je bolji od tabele kad odgovara na pitanje.

## Sta platforma ne moze

Granice API-ja, ne propusti toolkita. Ne obecavati ni u kojem obliku:

- Nema pretrage oglasa (kljucna rijec, kategorija, cijena, lokacija), pa se pozicija u pretrazi
  ne moze izmjeriti, samo procijeniti po pravilima rangiranja.
- Nema citanja ni slanja poruka kupcima. Brojac `new_questions_count` sa naloga se pokazao
  nepouzdan (u praksi 07.2026. vratio 0 uz postojeca pitanja), pa se o pitanjima kupaca ne
  tvrdi NISTA: ni broj, ni da ih ima ili nema. Iz brojaca se ne pravi ni izvjestaj ni alarm.
- Nema notifikacija, nema zakazivanja izdvajanja na platformi (raspored vodi `sponsor plan`).
- Nema statistike po danu ni po kategoriji. Pregledi su kumulativni, pa se vremenska serija
  gradi vlastitim snapshotima (`stats snapshot`).
- `sku_number` se postavlja samo pri kreiranju i poslije se ne mijenja.
- Kategorija objavljenog oglasa se ne mijenja: izmjena tiho ignorise `category_id` (izmjereno
  u praksi 29.07.2026). Jedini put je zavrsiti oglas i kreirati novi u pravoj kategoriji, sto
  gubi preglede i historiju, pa se kategorija bira pazljivo PRIJE objave.
