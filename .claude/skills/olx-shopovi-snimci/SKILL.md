---
name: olx-shopovi-snimci
description: >-
  Obrada Excel snimaka PIK/OLX shopova: razdvajanje po kantonima, poredjenje dva snimka i
  dopisivanje telefona kandidata. Okidaci: "razdvoji shopove", "excel po kantonima", "uporedi sa
  proslim mjesecom", "koliko praznih shopova", "izvuci telefone kandidata", "dodaj telefone u
  listu". Ne za analizu pojedinacnog shopa preko API-ja.
---

# Snimci PIK/OLX shopova: razdvajanje, poredjenje i telefon kandidata

Nekoliko poslova, nekoliko skripti. Sve samo citaju ulazne fajlove i nikad ih ne mijenjaju, osim
telefon skripte (Posao 3), koja dopisuje nove kolone u NOV izlazni fajl; ulazni ostaje netaknut.

## Gdje su fajlovi

- Snimci i rezultati: `olx-dokumentacija/shopovi-snimci/`
- Zastarjeli snimci (Bronze/Silver bez Gold/Platinum, prije nego je snimak obuhvatao sve
  pakete): `olx-dokumentacija/shopovi-snimci/arhiva/`
- Skripte: `.claude/skills/olx-shopovi-snimci/scripts/`

Konvencija imena, drzi je se jer skripte iz imena citaju datum:

- Snimak: `OLX-PIK-shopovi-snimak-YYYY-MM-DD.xlsx`
- Razdvojeno: `shopovi-razdvojeno-YYYY-MM-DD.xlsx`
- Razdvojeno samo za grupu paketa: `shopovi-razdvojeno-<grupa>-YYYY-MM-DD.xlsx`, npr.
  `shopovi-razdvojeno-bronze-silver-2026-07-26.xlsx`
- Razlika: `shopovi-razlika-YYYY-MM-DD-do-YYYY-MM-DD.xlsx`

Ako datum nije u imenu, `razdvoji.py` uzima danasnji, a `uporedi.py` upisuje "nepoznat". Zato
preimenuj snimak prije obrade.

## Posao 1: razdvajanje po kantonima

```bash
python3 .claude/skills/olx-shopovi-snimci/scripts/razdvoji.py \
  olx-dokumentacija/shopovi-snimci/OLX-PIK-shopovi-snimak-2026-07-26.xlsx
```

Izlaz dobija ime automatski, iz datuma u imenu ulaza. Drugi argument je opcion i mijenja putanju
izlaza.

Struktura izlaznog fajla:

- `Info`, datum snimka i osnovni brojevi
- `Pregled kantoni`, jedan red po kantonu ili regiji
- `Pregled gradovi`, samo gradovi sa 5 i vise shopova
- Po jedan list za svaki kanton, poredani po broju shopova opadajuce
- `Firme bez oglasa`, samo tip_naloga firma i nula oglasa

Unutar kantonskog lista redoslijed je:

1. Shopovi sa oglasima, prvo Platinum pa Gold, u svakom paketu opadajuce po broju oglasa
2. Shopovi bez oglasa, isti redoslijed paketa

Prazni redovi su zasjenjeni sivim. Paketi izvan Platinum i Gold (npr. Silver) idu na kraj svog
bloka i skripta ih prijavi u konzoli.

Dodane kolone: `ima_oglase`, `velicina`, `tip_naloga`, `godina_registracije`.

### Samo jedna grupa paketa

`--paketi` ogranicava izlaz na navedene pakete. Tada izvjestaji (`Analiza`, `Pregled kantoni`,
`Pregled gradovi`) dobijaju kolone za te pakete umjesto fiksnih Gold i Platinum kolona, pa u
Bronze/Silver fajlu nema kolona koje su uvijek nula. Jedan poziv pravi jedan fajl:

```bash
python3 .claude/skills/olx-shopovi-snimci/scripts/razdvoji.py \
  olx-dokumentacija/shopovi-snimci/OLX-PIK-shopovi-snimak-2026-07-26.xlsx --paketi Bronze,Silver

python3 .claude/skills/olx-shopovi-snimci/scripts/razdvoji.py \
  olx-dokumentacija/shopovi-snimci/OLX-PIK-shopovi-snimak-2026-07-26.xlsx --paketi Gold,Platinum
```

Bez `--paketi` izlaz je nepromijenjen: svi paketi u jednom fajlu, kolone za Gold i Platinum.
Ostalo o ponasanju:

- Redoslijed u komandi ne utice ni na ime fajla ni na sadrzaj. Paketi se sortiraju po
  `PAKET_RANG`, a sufiks imena je abecedan, pa `Bronze,Silver` i `Silver,Bronze` daju isti fajl.
- Imena paketa su neosjetljiva na velicinu slova i provjeravaju se protiv onoga sto stvarno
  stoji u snimku, ne protiv ugradjenog spiska. Nepoznat paket zaustavlja skriptu uz spisak
  prisutnih, umjesto da napravi prazan fajl.
- List `Info` ima red `Paketi u izvjestaju`, a naslov lista `Analiza` nosi grupu u zagradi, da
  se iz fajla vidi sta je unutra.
- U Bronze/Silver fajlu iz snimka 2026-07-26 list `Firme bez oglasa` i sivo zasjenjenje ostaju
  prazni, jer u tom snimku nijedan Bronze ili Silver shop nema nula oglasa (zatvorene shopove
  je izvor vec izbacio).

## Posao 2: poredjenje dva snimka

```bash
python3 .claude/skills/olx-shopovi-snimci/scripts/uporedi.py \
  olx-dokumentacija/shopovi-snimci/OLX-PIK-shopovi-snimak-2026-07-26.xlsx \
  olx-dokumentacija/shopovi-snimci/OLX-PIK-shopovi-snimak-2026-08-26.xlsx
```

Prvi argument je stariji snimak, drugi noviji. Poredi se po koloni `Shop (username)`.

Listovi u izlazu:

- `Sazetak`, brojevi u jednom pogledu
- `Novi shopovi`, ima ih u novom a nema u starom
- `Nestali shopovi`, ima ih u starom a nema u novom
- `Promjena paketa`, stari i novi paket jedan uz drugi
- `Iz praznog u aktivno`, bili nula oglasa, sada imaju
- `Iz aktivnog u prazno`, imali oglase, sada nula
- `Promjena broja oglasa`, sa kolonom razlike, sortirano po rastu

## Posao 3: telefon kandidata

OLX API ne vraca broj telefona ni za jedan tudji nalog (privatni podaci se ne vracaju za tudje
naloge), pa se cita iz slobodnog teksta koji je prodavac sam upisao: opis shopa i opis prvih
nekoliko aktivnih oglasa. Prinos nije garantovan, samo onoliko kandidata koliko je broj zaista
upisalo u tekst.

```bash
npm run build   # dist/cli/index.js mora biti svjez
python3 .claude/skills/olx-shopovi-snimci/scripts/dodaj-telefone.py \
  olx-dokumentacija/shopovi-snimci/shopovi-razdvojeno-2026-07-28.xlsx \
  [--broj-oglasa 5] [--pauza 0.4]
```

Ulaz je bilo koji xlsx sa kolonom `Shop (username)` na jednom ili vise listova (izlaz
`razdvoji.py`, `prodajna_lista.py`, ili sirovi snimak). Za svaki jedinstven username (isti se ne
pita dvaput ni kad se pojavi na vise listova) poziva CLI `stats konkurent-telefon <username>`
(regex prolaz pa Haiku tek kad regex ne nadje nista sigurno, vidi
`src/core/telefon-ekstrakcija.ts`), i dopisuje dvije kolone: `Telefon` i `Telefon izvor`
(`regex`/`haiku`/prazno). Listovi bez kolone `Shop (username)` (sazetci, analize) se prepisuju
nepromijenjeni. Izlaz je nov fajl (podrazumijevano `<ulaz>-telefoni.xlsx`).

Prikaz telefona u HTML izvjestaju nije dio ovog posla. U samom toolkitu HTML izvjestaja nema
(sve je markdown, telegram tekst i JSON), ali postoji zaseban interni alat van gita,
`interno/pretraga-biznisa/napravi-pregled.py`, koji pravi `pregled-shopova.html` iz svog
pipeline-a i telefone vec prikazuje. On ne cita izlaz ovih skripti, pa se ovdje nista ne
podrazumijeva o njemu.

## Pravila i granice

- Originalni snimci se ne mijenjaju, ni jedan ni drugi.
- Nijedan red se ne brise, ni duplikati. Duplikati se samo prijave u konzoli. U `uporedi.py` se
  kod duplog usernamea uzima prvi red, jer poredjenje trazi jedinstven kljuc, i to se prijavi.
- Ako neka kolona nedostaje, skripta staje sa jasnom greskom i ne pogadja.
- `tip_naloga` je heuristika, ne podatak. Kratke oznake (`doo`, `sp`, `dd`, `obrt`) se traze kao
  samostalne rijeci, da `sp` ne pokupi Sport ili Spektar. Tackasti oblici (`d.o.o.`, `s.p.`,
  `d.d.`) se traze doslovno. Ako naziv istovremeno pada i pod firmu i pod smece, oznaci se kao
  firma.
- Medijana se svuda racuna u dvije varijante, sa i bez shopova koji imaju nula oglasa. Za
  poredjenje kantona koristi medijanu, ne zbir, jer zbirove iskrivljuju pojedinacni giganti
  (u snimku 2026-07-26 jedan shop nosi 413.680 oglasa).
- **Kolona `Broj oglasa` je snimak stanja na dan ekstrakcije.** Iz nje se ne smije zakljucivati
  da shop placa ili ne placa pretplatu, ni da je nalog ugasen. Nula oglasa danas moze biti
  privremeno stanje.
- Kod poredjenja: shop koji je "nestao" nije nuzno ugasen. Mogao je promijeniti paket na nesto
  sto snimak ne pokriva, ili je ekstrakcija bila nepotpuna. Provjeri alatom
  `olx_user_profile <username>` (ili CLI `users profile <username>`): vraca paket, datum do kojeg
  vazi i poslovne podatke. Tek ako profil ne postoji, govori se o gasenju.

## Kad korisnik donese novi snimak

Redoslijed koji se isplati:

1. Preimenuj snimak po konvenciji, sa datumom ekstrakcije.
2. Pokreni `razdvoji.py` na novom snimku. Ako se radi po nivou paketa, pokreni ga jos dvaput,
   sa `--paketi Bronze,Silver` i sa `--paketi Gold,Platinum`.
3. Pokreni `uporedi.py` sa prethodnim snimkom kao prvim argumentom. Njemu ide SIROVI snimak,
   ne razdvojeni fajl, i uvijek cijeli, bez filtera po paketu.
4. Prijavi korisniku: koliko novih, koliko nestalih, ko je promijenio paket, i koliko ih je
   preslo iz praznog u aktivno. To su cetiri broja koja nose vecinu informacije.

## Ovisnosti

`pandas` i `openpyxl`. Provjera: `python3 -c "import pandas, openpyxl"`.

Brojevi i pravila platforme (paketi, cijene, kvote): jedan izvor istine je
`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md`.
