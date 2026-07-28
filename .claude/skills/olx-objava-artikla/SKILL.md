---
name: olx-objava-artikla
description: >-
  Vodjena objava novog oglasa, od slike do objavljenog oglasa: kategorija, obavezni atributi,
  naslov i opis, cijena, potvrda. Okidaci: "objavi ovo", "dodaj artikal", "novi oglas", "prodajem
  ovo", ili poslana fotografija bez teksta.
---

# Objava artikla korak po korak

Namijenjeno korisniku koji nije tehnicki i najcesce pise sa telefona. Jedno pitanje odjednom,
kratki odgovori, potvrda prije svakog nepovratnog koraka.

## Tvrdi redoslijed

Oglas se kreira kao nacrt i **nije vidljiv** dok se ne objavi. Redoslijed se ne preskace:

1. `olx_create_listing` (nacrt)
2. `olx_upload_images`
3. `olx_set_main_image`
4. `olx_publish_listing`

Ako se stane poslije koraka 1, ostaje nevidljiv nacrt. To nije steta, ali reci korisniku da
oglas jos nije objavljen.

## Koraci razgovora

### 1. Slika

Fotografija sa Telegrama se sama spusta na disk, a putanja stize u `<channel>` tagu kao
`image_path`. Procitaj je i opisi sta vidis, da korisnik potvrdi da si razumio artikal.

Za vise slika: Telegram album stize kao odvojene poruke i nema bafera. Trazi od korisnika da
posalje sve slike pa napise "gotovo". Prvu poslanu sliku tretiraj kao glavnu osim ako ne kaze
drugacije.

Ako slike nema, objava je i dalje moguca, ali reci da oglasi bez slike prakticno ne prodaju.

### 2. Kategorija

`olx_suggest_category` sa kljucnim rijecima sa slike. Ponudi jednu, najvise dvije mogucnosti i
trazi potvrdu. Nikad ne biraj kategoriju u tisini: pogresna kategorija znaci da oglas ne postoji
za kupca koji pretrazuje.

### 3. Obavezni podaci

`olx_draft_check` sa `category_id` i onim sto vec znas. Vraca sta nedostaje i koje su dozvoljene
vrijednosti.

- Pitaj samo ono sto ne mozes zakljuciti sa slike ili iz onoga sto je korisnik napisao.
- Kad atribut ima popis vrijednosti, ponudi ih kao izbor, ne kao otvoreno pitanje.
- Jedno pitanje po poruci.

### 4. Naslov, podnaslov i opis

Pravila su u `.claude/skills/olx-seo-oglasa/references/seo-pravila.md` i `format-opisa.md`.
Ovdje se ne prepisuju. Ukratko:

- Naslov do 65 znakova, nominativ, brend pa model pa varijanta.
- Podnaslov ULAZI u pretragu; tu idu mnozina, sinonim i strana rijec koji nisu stali u naslov.
- Detaljni opis NE ulazi u pretragu, pisi ga za covjeka.

### 5. Cijena

Pitaj korisnika. Prije toga ponudi orijentir iz **njegovog vlastitog kataloga**: potrazi slicne
artikle koje vec prodaje i reci u kojem su rasponu. To je jedini posten orijentir koji imamo,
jer API nema pretragu tudjih oglasa, pa cijene konkurencije ne mozemo vidjeti. Ne izmisljaj
trzisnu cijenu.

### 6. Pregled i potvrda

Posalji sve na jednom mjestu: naslov, podnaslov, cijena, kategorija, broj slika. Pitaj da li da
se objavi. Bez jasnog da nema koraka 7.

### 7. Objava

Cetiri poziva iz tvrdog redoslijeda. "Objavljeno" javljas tek kad odgovor objave vrati status
objavljenog oglasa; kad status nije jasan, procitaj oglas ponovo pa reci tacno sta jeste. Nikad
ne reci gotovo prije te potvrde, bolje "poslano je, provjeravam" nego sigurnost koju nemas.
Ponudi dvije do tri sljedece stvari, na primjer objavu jos jednog artikla ili obnovu ostalih
oglasa.

## Sta ne raditi

- Ne objavljivati bez `olx_draft_check`. Bez njega API vraca gresku tek nakon slanja, dakle nakon
  sto je korisnik vec potvrdio, i to je najgori trenutak da nesto pukne.
- Ne izmisljati podatke o artiklu koje korisnik nije potvrdio. Kad se sa slike ne vidi velicina,
  materijal ili stanje, pitaj.
