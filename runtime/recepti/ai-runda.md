# AI runda: sedmicna analiza jednog shopa

Ovo je zadatak za headless admin sesiju koju pokrece `scripts/ai-runda.sh`. Radis nad JEDNIM
klonom (jedan shop). Tvrde granice iz CLAUDE.md vec vaze. Ova runda je STROGO read-only nad
OLX-om: nista ne mijenjas, ne obnavljas, ne izdvajas i ne trosis. Sve sto vrijedi uraditi ide u
prijedloge koje klijent poslije odobrava svom botu.

## Redoslijed rada

1. `olx_whoami`, pa `olx_profile_stats` sa `views: "snapshot"`. Ako snapshota nema, bez
   pregleda, ne mjeri uzorkom (predugo za rundu).
2. `olx_account_alerts` i `olx_mrtvi_oglasi`.
3. `olx_onboarding_report` u formatu `json`: iz njega se biraju kandidati za korak 4, najslabiji
   naslovi i mrtvi oglasi.
4. Fan-out na podagente po obrascu iz skilla `olx-serijski-posao`, svi pozivi u jednoj poruci:
   - `olx-seo-pisac` za najvise 10 najslabijih naslova (kratki, bez podnaslova, bez kljucnih
     rijeci).
   - `olx-trijaza` za mrtve oglase, najvise 10.
   - `olx-konkurent` za usernameove iz `KLIJENT.md` ovog klona (sekcija o konkurentima). Ako
     fajla ili sekcije nema, konkurente preskoci bez napomene.
5. Napisi prijedloge u fajl `.olx-pik/prijedlozi/runda-<danasnji datum YYYY-MM-DD>.md`:
   po stavci id oglasa, trenutni naslov, sta se predlaze (novi naslov/podnaslov, sakriti,
   zavrsiti, cijena), i jedna recenica zasto. Grupisi po tipu radnje da bot poslije moze
   primjenjivati grupno. Bez tehnickih pojmova: fajl klijentski bot cita kroz alat olx_prijedlozi i prepricava ga
   korisniku, pa sve mora biti razumljivo covjeku koji nije tehnicki.

## Zavrsni odgovor

Tvoj zavrsni tekst se salje DOSLOVNO u Telegram grupu klijenta. Zato:

- Do 1200 znakova, latinica, bosanski, bez emojija, bez crtice kao interpunkcije.
- Nijedno ime alata, fajla ili tehnicki pojam. Pisi kao covjek koji vodi shop.
- Sadrzaj: 2 do 3 recenice o stanju shopa (sta raste, sta stoji), pa najvise 5 bulletpointa
  sa konkretnim prijedlozima, pa jedna zavrsna recenica: da moze odgovoriti "primijeni
  prijedloge" i bot ce ih proci s njim stavku po stavku.
- Brojeve navodi samo one koje si stvarno procitao. Nista ne obecavaj (pozicija u pretrazi,
  zarada).
- Ako podataka nema dovoljno (nov klon, nema snapshota), posalji krace: sta je provjereno,
  da je sve uredu ili sta treba, bez izmisljanja trendova.

Nikakav drugi tekst osim te poruke: bez uvoda, bez rekapitulacije rada, bez markdown naslova.
