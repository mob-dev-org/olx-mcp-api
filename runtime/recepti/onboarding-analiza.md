# Onboarding analiza: popuni KLIJENT-javno.md i cinjenicni dio KLIJENT.md

Ovo je zadatak za headless admin sesiju koju pokrece `scripts/onboarding-analiza.sh`, odmah
nakon sto je token novog klijenta upisan u `.env`. Radis nad JEDNIM klonom (jedan shop). Tvrde
granice iz CLAUDE.md vec vaze. Ovo je STROGO read-only nad OLX-om: nista ne mijenjas, ne
obnavljas, ne izdvajas, ne trosis. Jedini upis koji radis je u dva lokalna fajla, `KLIJENT.md`
i `KLIJENT-javno.md`.

## Redoslijed rada

1. `olx_whoami` da potvrdis nalog.
2. `olx_onboarding_report` (bez snapshota je uredu, prvog dana ga jos nema): odatle citas
   djelatnost po kategorijama, higijenu i prve poteze.
3. `olx_profile_stats` sa `views: "sample"`: cijene i stanje oglasa.
4. Kompaktna lista aktivnih oglasa (`olx_list_listings`, bez `full`) da vidis kategorije i
   nazive robe.
5. Procitaj `KLIJENT.primjer.md` i `KLIJENT-javno.primjer.md` da znas tacne sekcije. Ako
   `KLIJENT.md` ili `KLIJENT-javno.md` vec postoje, procitaj ih i NE gazi ono sto je covjek
   vec upisao; popunjavas samo prazna cinjenicna polja.

## Sta upisujes

U `KLIJENT-javno.md` (ovo ulazi u prompt klijentske sesije, mora biti tacno):

- Ko je klijent: cime se shop bavi jednom recenicom, izvedeno iz kategorija i naziva robe.
- Ton: predlozi razuman default (na vi, kratko, profesionalno) i oznaci u jednoj recenici da je
  to prijedlog koji admin moze promijeniti.
- Standardni zavrsni blok opisa (footer): SAMO ako se ponavlja u postojecim opisima oglasa.
  Prepisi ga doslovno. Ako ga nema ili nije jasan, IZBACI tu sekciju. Nikad ga ne izmisljaj.
- Sekcije "Sta se nikad ne dize" i "Dogovorene granice" IZBACI iz javnog fajla: to su odluke,
  ne cinjenice, i popunjava ih covjek.

U `KLIJENT.md` popunjavas SAMO cinjenicna polja:

- Ko je klijent: naziv firme (ako se vidi iz naloga), username, cime se bavi, glavne kategorije,
  web ako je naveden u oglasima.
- Sta je vec uradjeno: datum preuzimanja naloga (danasnji), zadnji potez ostavi prazno.

## Sta NIKAD ne diras (granice.md)

Ne upisujes nista komercijalno, ni u jedan fajl, jer se komercijalna ponuda ne izmislja:

- mjesecni budzet kredita i dnevni plafon,
- popuste, kod za popust, gratis artikle, rok dostave,
- sekciju "Granice, po dogovoru" i "Kako komuniciramo" u `KLIJENT.md` (kontakt osoba, budzet).

Ta polja ostavljas prazna kako su u sablonu. Njih popunjava admin poslije razgovora sa klijentom.

## Zavrsni odgovor

Kratak sazetak za admina (ne salje se klijentu, ide u log): sta si popunio u oba fajla i jedna
recenica sta jos ostaje covjeku (komercijalni dio). Bez markdown naslova, do 6 redova.
