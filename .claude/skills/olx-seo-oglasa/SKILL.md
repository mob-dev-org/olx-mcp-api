---
name: olx-seo-oglasa
description: >-
  SEO oglasa na OLX.ba / PIK.ba: naslov, podnaslov i format opisa. Koristi ovaj skill kad
  korisnik trazi da se naslovi optimizuju za pretragu, kad pita zasto ga nema u rezultatima
  iako oglas postoji, ili kad trazi da se opisi srede i ujednace. Okidaci: "seo", "optimizuj
  naslove", "popravi naslove", "kljucne rijeci", "zasto me nema u pretrazi", "sredi opise",
  "formatiraj opise", "napisi bolji naslov", "podnaslov". Radi analizu pa izvjestaj, i mijenja
  oglase tek nakon sto korisnik potvrdi koje redove primjenjuje. Za raspored kredita i
  izdvajanje koristi pik-olx-kreditni-savjetnik; za sirok pregled profila olx-analiza-profila.
---

# SEO oglasa: naslov, podnaslov, opis

Naslov i podnaslov odlucuju DA LI te tražilica uopste nadje. Opis ne ulazi u pretragu i sluzi
konverziji. Zato se ova dva posla rade odvojeno: prvo vidljivost (naslov, podnaslov), pa
ubjedljivost (opis).

Pravila nisu prepisana u ovom fajlu. Zive u:

- `references/seo-pravila.md` — sta cini dobar naslov i podnaslov, sa zvanicnim primjerima.
- `references/format-opisa.md` — sablon opisa i ton po kategoriji.
- MCP resursi: `olx://knowledgebase` (sekcije 5.2 i 5.3), `olx://pomoc-index` pa clanak
  `olx://pomoc/kako-pravilno-napisati-naslov-oglasa-208481809.md`, i vodic
  `olx-dokumentacija/OLX_PIK_Rangiranje_Pretraga_Sortiranje.md` (sekcije 4 i 5).

## Tvrda pravila

- Nista se ne mijenja bez potvrde. Prvo izvjestaj, pa korisnik bira redove, pa primjena.
- Naslov je najvise 65 znakova. API odbija duze sa 422, pa duzinu provjeri prije slanja.
- Jedan artikal po oglasu. Ne spajati vise modela u naslov ni u opis: to je protiv pravila i
  tražilica ih ne nalazi.
- Prije bilo kakve izmjene provjeri na kojem si nalogu (`olx_whoami`).
- Ovaj skill ne trosi kredite. Ako se u analizi pokaze da je izdvajanje potez, to je preporuka
  za skill `pik-olx-kreditni-savjetnik`, ne radnja ovdje.

## Tok rada

1. `olx_whoami` — potvrdi nalog i prijavi ga korisniku.
2. `olx_list_listings` sa `state: active`, `all: true` — cijeli aktivni katalog (id, naslov, cijena).
3. Za oglase koje ocjenjujes detaljno pozovi `olx_get_listing <id>`: treba ti `short_description`
   (podnaslov) i `additional.description` (opis), jer ih lista ne vraca. Kod velikih kataloga
   prvo ocijeni naslove iz liste, pa detalje vuci samo za oglase koji idu u izvjestaj.
4. Ocijeni svaki naslov po `references/seo-pravila.md`. Za svaki problem navedi koji je, ne samo
   da postoji ("nema modela", "genitiv umjesto nominativa", "prazna rijec: povoljno").
5. Provjeri i kategoriju kad naslov ne odgovara mjestu: `olx_suggest_category <naslov>` pa
   uporedi sa trenutnom kategorijom oglasa. Pogresna kategorija obara vidljivost jednako kao
   los naslov, a popravlja se kroz `olx_update_listing` sa `category_id` (obavezne atribute nove
   kategorije provjeri kroz `olx_category_attributes`, inace API vraca 422).
6. Predlozi novi naslov i novi podnaslov. Podnaslov nosi ono sto nije stalo u naslov: sinonimi,
   mnozina ili jednina kljucnog pojma, namjena, varijante. Prazan podnaslov je propustena pretraga.
7. Izvjestaj kao tabela, sortiran po prioritetu:

   | id | trenutni naslov | problem | prijedlog naslova | prijedlog podnaslova | prioritet |

   Prioritet: visok kad naslov nema kljucne rijeci koje kupac kuca ili je kategorija pogresna,
   srednji kad naslov radi ali je nepotpun (nema varijante, mjere, godine), nizak kad je samo
   stilski slabiji.
8. Pitaj korisnika koje redove primjenjujes. Prihvati i "sve" i "samo visok prioritet".
9. Primjena: `olx_update_listing` jedan po jedan, sa `title` i `short_description` (i
   `description` kad se radi i opis). Nakon svakog prijavi ishod. Ako neki padne, nastavi ostale
   i na kraju popisi sta nije proslo i zasto.
10. Ne obnavljaj oglas samo zato sto si mu promijenio naslov. Obnova je odvojena odluka i troši
    kvotu; ako je ionako vrijeme obnovi, spomeni to kao sljedeci korak.

## Opisi

Opis ne utice na to da li te tražilica nalazi, pa ga ne treba trpati kljucnim rijecima. Radi ga
po sablonu iz `references/format-opisa.md` kad korisnik trazi da se opisi srede, ili kad oglas
ima mnogo pregleda a malo upita (tad problem nije pozicija nego ponuda).

## Sta ne raditi

- Ne izmisljati podatke o artiklu. Ako u naslovu treba model ili mjera koju ne znas, pitaj
  korisnika ili ostavi red u izvjestaju sa napomenom "treba podatak od korisnika".
- Ne pisati "AKCIJA", "HITNO", "POVOLJNO" i slicno umjesto kljucnih rijeci. To ne pretrazuje niko.
- Ne stavljati cijenu u naslov. Cijena ide u polje cijene; "Po dogovoru" izbacuje oglas iz
  cjenovnih filtera.
- Ne mijenjati vise oglasa jednim pozivom "za svaki slucaj". Samo ono sto je korisnik potvrdio.
