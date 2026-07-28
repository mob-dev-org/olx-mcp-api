---
name: olx-shopovi-snimci
description: >-
  Obrada Excel snimaka PIK/OLX shopova: razdvajanje po kantonima i poredjenje dva snimka. Okidaci:
  "razdvoji shopove", "excel po kantonima", "uporedi sa proslim mjesecom", "koliko praznih
  shopova". Ne za analizu pojedinacnog shopa preko API-ja.
---

# Snimci PIK/OLX shopova: razdvajanje i poredjenje

Dva posla, dvije skripte. Obje samo citaju ulazne fajlove i nikad ih ne mijenjaju.

## Gdje su fajlovi

- Snimci i rezultati: `olx-dokumentacija/`
- Skripte: `.claude/skills/olx-shopovi-snimci/scripts/`

Konvencija imena, drzi je se jer skripte iz imena citaju datum:

- Snimak: `OLX-PIK-shopovi-snimak-YYYY-MM-DD.xlsx`
- Razdvojeno: `shopovi-razdvojeno-YYYY-MM-DD.xlsx`
- Razlika: `shopovi-razlika-YYYY-MM-DD-do-YYYY-MM-DD.xlsx`

Ako datum nije u imenu, `razdvoji.py` uzima danasnji, a `uporedi.py` upisuje "nepoznat". Zato
preimenuj snimak prije obrade.

## Posao 1: razdvajanje po kantonima

```bash
python3 .claude/skills/olx-shopovi-snimci/scripts/razdvoji.py \
  olx-dokumentacija/OLX-PIK-shopovi-snimak-2026-07-26.xlsx
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

## Posao 2: poredjenje dva snimka

```bash
python3 .claude/skills/olx-shopovi-snimci/scripts/uporedi.py \
  olx-dokumentacija/OLX-PIK-shopovi-snimak-2026-07-26.xlsx \
  olx-dokumentacija/OLX-PIK-shopovi-snimak-2026-08-26.xlsx
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
2. Pokreni `razdvoji.py` na novom snimku.
3. Pokreni `uporedi.py` sa prethodnim snimkom kao prvim argumentom.
4. Prijavi korisniku: koliko novih, koliko nestalih, ko je promijenio paket, i koliko ih je
   preslo iz praznog u aktivno. To su cetiri broja koja nose vecinu informacije.

## Ovisnosti

`pandas` i `openpyxl`. Provjera: `python3 -c "import pandas, openpyxl"`.

Brojevi i pravila platforme (paketi, cijene, kvote): jedan izvor istine je
`olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md`.
