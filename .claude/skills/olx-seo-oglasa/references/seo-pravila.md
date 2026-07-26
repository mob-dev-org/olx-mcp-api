# Pravila naslova i podnaslova (destilat zvanicnih izvora)

Izvori: zvanicni clanak `olx://pomoc/kako-pravilno-napisati-naslov-oglasa-208481809.md`,
`olx://knowledgebase` sekcije 5.2 i 5.3, i interni vodic
`olx-dokumentacija/OLX_PIK_Rangiranje_Pretraga_Sortiranje.md` sekcije 4 i 5. Kad se izvori
razilaze, vazi knowledgebase (tamo je zapisano sta je izmjereno).

## Kako tražilica gleda naslov

- Rijeci se spajaju po AND logici. Pretraga "Golf 7" vraca oglase koji imaju i "Golf" i "7",
  bez obzira na redoslijed rijeci u naslovu.
- Rijeci se moraju potpuno podudarati. Padezi se broje, mnozina i jednina se ne pogadjaju:
  oglas "Tastatura i mis" se NE nalazi na pretragu "tastature".
- Podnaslov (`short_description`) ULAZI u pretragu. Detaljni opis NE ulazi. Sto nije u naslovu
  ili podnaslovu, tražilici je nevidljivo.
- Kategorija, lokacija na mapi i atributi rade kao filteri, ne kao tekstualna pretraga.

Prakticna posljedica: naslov gradi za oblik koji kupac kuca, a u podnaslov stavi drugi oblik
istog pojma (mnozinu, sinonim, stranu rijec) kad ne stane u naslov.

## Checklista dobrog naslova

1. Nominativ. "Stan Sip", ne "Stan na Sipu". "Kuca Sarajevo Centar", ne "Prodajem kucu u Sarajevu".
2. Brend, model i varijanta, u tom redu. Precizan model po zvanicnom nalazu povecava posjete
   znacajno ("Maska za Apple iPhone 5" umjesto "Maska za telefon").
3. Rijeci koje kupac stvarno kuca: vrsta artikla, brend, model, mjera ili velicina, namjena,
   ponekad lokacija.
4. Jedan artikal. Nabrajanje vise modela je nedozvoljeno i otezava pronalazak. Razdvojeni oglasi
   po zvanicnoj smjernici daju visestruko vise posjeta.
5. Do 65 znakova (API odbija duze). Kad ne stane sve, prioritet je: vrsta artikla, brend, model,
   pa ostalo.
6. Bez praznih rijeci: "povoljno", "hitno", "akcija", "kao nov", "extra". One ne pretrazuju se i
   trose mjesto.
7. Bez cijene u naslovu i bez "po dogovoru" kao cijene (oglas ispada iz cjenovnih filtera i
   sortiranja).
8. Dijakritici se tretiraju jednako kao slova bez njih, ali pisi pravilno.

## Zvanicni primjeri dobrog i loseg naslova

| Loše | Dobro |
| --- | --- |
| Prodajem kucu u Sarajevu u Centru | Kuca Sarajevo Centar |
| Stan na Sipu | Stan Sip |
| Prodajem Golfa ocuvan max full oprema | Volkswagen Golf 7 dizel TDI 110kw |
| Tastatura za PC | Tastatura Logitech K200 za PC |
| Prodajem mobitel iphone | iPhone 14 PRO MAX 1TB |
| Prodajem pametni televizor kao nov | TV TCL 75C635 SMART 75'' 4K QLED Android |
| Maska za telefon | Maska za Apple iPhone 5 |
| Golf, Mercedes, Passat, dijelovi | jedan oglas po modelu |

## Podnaslov (short_description)

- Ulazi u pretragu, pa se tretira kao drugi naslov, ne kao ukras.
- Sadrzaj: oblici pojma koji nisu stali u naslov (mnozina, sinonim, strani naziv), varijante
  (velicine, boje kad je jedan artikal u vise varijanti istog oglasa), namjena ("za gradiliste",
  "za ugostiteljstvo"), i kljucni tehnicki podatak.
- Prazan podnaslov znaci da oglas ulazi u pretragu samo sa 65 znakova naslova. To je gubitak.
- Ne ponavljati naslov rijec po rijec. Ponavljanje ne dodaje nove pojmove.

## Ocjena postojeceg naslova (kako klasifikovati problem)

- `nema kljucnih rijeci` — naslov ne sadrzi ni vrstu artikla ni brend/model koji kupac kuca.
- `pogresan padez` — naslov je u genitivu ili lokativu ("hlaca", "u Sarajevu").
- `nedostaje model ili varijanta` — ima vrstu i brend, nema model, mjeru ili godinu.
- `vise artikala` — jedan oglas nosi vise modela ili "mix".
- `prazne rijeci` — mjesto zauzimaju "povoljno", "hitno", "akcija".
- `predugo` — preko 65 znakova, API bi vratio 422.
- `pogresna kategorija` — ne problem naslova, ali obara vidljivost isto; provjeri
  `olx_suggest_category` pa uporedi.

## Sta se NE mijenja radi SEO-a

- Cijena. Promjena cijene je poslovna odluka korisnika, ne SEO potez.
- Kategorija bez provjere obaveznih atributa nove kategorije (`olx_category_attributes`).
- Brisanje i ponovno objavljivanje da bi oglas "osvjezio". To je spam po pravilima platforme;
  za svjezinu postoji obnova.
