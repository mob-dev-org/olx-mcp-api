---
name: olx-analiza-profila
description: >-
  Analiza i savjetovanje za OLX.ba / PIK.ba shop preko olx-pik MCP-a: vlastiti profil, oglasi,
  pozicija u pretrazi, cijene i sta konkretno poboljsati. Koristi ovaj skill kad god korisnik
  pita zasto mu oglasi slabo idu, koje oglase obnoviti ili izdvojiti, kako popraviti naslove,
  da li je cijena dobra, koji artikli na stanju trebaju paznju, ili trazi pregled i analizu
  profila sa preporukama. Okidaci: "analiziraj moje oglase", "sta da izdvojim", "zasto nemam
  pozive", "optimizuj naslov", "pregled profila", "koje da obnovim", "isplati li se izdvajanje".
  Analiza konkurencije je Faza 2 (vidi references/konkurencija-faza2.md). Za sam setup MCP-a
  koristi skill olx-mcp-setup.
---

# OLX/PIK analiza profila i savjetovanje

Ovaj skill te vodi da od sirovih podataka shopa napravis korisnu, konkretnu analizu sa
prioritetnim koracima. Strategija (kako radi pretraga, svjezina, izdvajanje) NIJE prepisana
ovdje, nego zivi u MCP resursima. Tvoj posao je da je primijenis na stvarne oglase korisnika.

## Prvo procitaj strategiju iz resursa

Prije savjetovanja procitaj MCP resurse (preko olx-pik servera):
- `olx://knowledgebase` — API referenca, pravila vidljivosti, dijagnostika.
- Vodic o rangiranju/pretrazi/sortiranju (`olx-dokumentacija/OLX_PIK_Rangiranje_Pretraga_Sortiranje.md`).

Tamo je kljucna hijerarhija: kljucne rijeci u naslovu odlucuju DA LI te nadju, svjezina (obnova)
i izdvajanje odlucuju KOLIKO si visoko. Bez toga savjeti su nagadjanje.

## Tok rada

1. Provjeri pristup: `olx_whoami`. Ako vrati 403, stani i uputi korisnika na skill olx-mcp-setup.
2. Prikupi podatke (sve su sigurni, read-only alati, ne trose kredite):
   - `olx_list_listings` sa `state: active`, `all: true` — cijeli aktivni katalog.
   - Po potrebi `state: hidden|expired|finished` da vidis sta stoji neiskoristeno.
   - `olx_get_listing` za oglase koje detaljnije gledas (naslov, podnaslov, cijena, slike, kategorija).
   - `olx_refresh_limits` — koliko besplatnih obnova je ostalo ovaj mjesec.
   - `olx_sponsor_price` SAMO ako razmatras izdvajanje (vraca cijenu, ne trosi).
3. Dijagnostikuj svaki problematican oglas po pravilima iz `olx://knowledgebase` (sekcija dijagnostika).
4. Napravi izvjestaj po sablonu nize i predlozi konkretne, prioritetne akcije.

Detaljan recept (kako citati naslove, cijene, kako rasporediti obnove, sablon izvjestaja) je u
`references/analiza-recept.md`. Procitaj ga kad radis punu analizu profila.

## Dijagnostika u jednoj recenici

- Malo pregleda -> problem je vidljivost. Prvo naslov (kljucne rijeci) i tacna kategorija, pa tek onda obnova/izdvajanje.
- Mnogo pregleda, malo poruka -> problem je ponuda, ne pozicija. Cijena, slike, opis. Ne trosi kredite na izdvajanje.
- Zasicena kategorija (npr. auto) -> izdvajanje slabije i skuplje. Naglasak na precizan naslov, konkurentnu cijenu, premium + autoobnova.

## Granice i zastite

- Nikad ne predlazi trosak kredita kao prvo rjesenje. Izdvajanje ne spasava los naslov ni lozu cijenu.
- Prije bilo kakvog izdvajanja prikazi cijenu (`olx_sponsor_price`) i trazi izricitu potvrdu. Sam
  toolkit ima spend-guard (`confirm: true`), ali ti to objasni korisniku, ne pokrecaj naplatu tiho.
- Za artikle kojih nema na stanju preporuci hide/finish, nikad brisanje (gubi se historija i pregledi).
- Ne predlazi brisanje pa ponovno objavljivanje radi vrha; to je spam i krsi pravila. Koristi obnovu.
- Postuj mjesecni limit obnova (750 besplatnih); rasporedi ih na najvaznije/najkonkurentnije oglase.

## Format izvjestaja

Koristi ovu strukturu (detaljnija verzija je u references/analiza-recept.md):

```
# Analiza profila: <username>
## Sazetak
<2-4 recenice: stanje kataloga, glavni problem, najveca prilika>
## Nalazi po oglasima
<za svaki problematican oglas: id, naslov, dijagnoza, konkretan prijedlog>
## Prioritetne akcije (redom)
1. Besplatno odmah (naslovi, kategorije, obnova u okviru limita)
2. Ponuda (cijena, slike, opis)
3. Placeno selektivno (izdvajanje gdje se isplati, uz cijenu i potvrdu)
## Sta NE raditi
<gdje ne trositi kredite i zasto>
```

## Konkurencija (Faza 2)

Analiza konkurentskih naloga i cjenovno poredjenje su Faza 2 i trenutno nisu potpuno podrzani u
toolkitu (fali pouzdan pristup tudjim oglasima i pretraga po kategoriji). Ne izmisljaj te podatke.
Plan i tehnicke preduslove vidi u `references/konkurencija-faza2.md`.
