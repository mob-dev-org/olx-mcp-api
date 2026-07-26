# Nalazi iz zvanicne pomoci i kako korpus osvjeziti

Povuceno: 2026-07-26 sa `https://pomoc.olx.ba/hc/bs`
Obim: 8 kategorija, 16 sekcija, 52 clanka, oko 24.000 rijeci.

## Sta je u paketu

- `PIK-pomoc-kompletno.md` — sve u jednom fajlu, uredjeno po kategoriji i sekciji, sa izvorom i datumom azuriranja uz svaki clanak. Ovo ubaci u Claude projekat ili kao MCP resource.
- `clanci/` — 52 pojedinacna markdown fajla sa frontmatterom (naslov, kategorija, sekcija, izvor, datum, id). Pogodno za Obsidian ili za RAG gdje treba granularnost.
- `index.csv` — pregled svih clanaka sa linkovima. Dobro za brzo trazenje.
- `pik-pomoc.json` — isti sadrzaj masinski citljiv, za skripte i ugradnju u toolkit.

## Vazno: sukob sa nasim izmjerenim podatkom

Zvanicni clanak "Otvaranje OLX Shopa" navodi **750 besplatnih obnavljanja mjesecno** za shop.
Nas izmjereni podatak preko API-ja na Gold nalogu je **1.800**.

Moguca objasnjenja, ni jedno potvrdjeno:

- Clanak je star i nije azuriran nakon uvodjenja paketa Bronze, Silver, Gold, Platinum.
- 750 je osnovni shop, a vise paketa nosi vecu kvotu.
- Kvota se racuna drugacije nego sto pretpostavljamo.

Prakticno pravilo: **uvijek citaj stvarni `free_limit` sa naloga**, ne citiraj ni 750 ni 1.800 kao fiksno. U prodajnom razgovoru reci "vasa kvota se procita sa naloga u nekoliko sekundi".

## Sto smo dobili novo (nije bilo u nasem knowledgebase-u)

- **Neogranicen broj istovremeno izdvojenih oglasa** za shopove. Bitno za planiranje: nema tehnickog ogranicenja koliko artikala moze biti izdvojeno paralelno, samo budzetsko.
- **Skrivanje historije cijene na oglasu** je shop pogodnost. Relevantno kad se radi akcijska cijena.
- **Zakazano izdvajanje se moze otkazati kroz web**, opcija stoji na stranici oglasa. Potvrdjuje nas nalaz da API nema endpoint za otkazivanje, ali da je rucno moguce.
- **Zakazivanje ide u intervalima od pola sata**, i mora se postaviti najkasnije do ponoci na dan promocije.
- **Neaktivan oglas** je poseban status: trazi aktivaciju uz kredit da bi postao vidljiv. Razlicito od isteklog i skrivenog.
- **Besplatna vremenska aktivacija** vazi u kategorijama Vozila, Nekretnine, Poslovi, Servisi i usluge, Mining rigovi. Timer do 5 dana, samo za korisnike bez aktivnih oglasa u toj kategoriji. Ako se placa kreditom prije isteka timera, cijena je manja sto je manje vremena preostalo.
- **Top 5 korisnika po prihvacenim prijavama zloupotrebe** mjesecno dobija duplo kredita, ali ne dva mjeseca zaredom. Marginalno za nas, ali objasnjava odakle nekim nalozima krediti.
- **Oko 30 posto prijava zloupotrebe je neispravno** i odbija se. Ako se planira zarada kredita kroz prijave, treba znati tacan format prijave, inace je gubljenje vremena.
- **Sedam fotografija besplatno** za klasican profil je potvrdjeno u clanku o kreditima, dvadeset za shop u clanku o otvaranju shopa.

## Sta ovdje NEMA, a mislili smo da ima

- Nema clanka o pinovanju oglasa na shop stranici.
- Nema clanka o Video Stories.
- Nema tabele cjenovnika izdvajanja. Zvanicno stoji samo da je cijena dinamicna i da zavisi od broja objavljenih i izdvojenih oglasa u kategoriji te od broja dana. Nasa tabela ostaje jedini konkretan izvor, i ostaje samo snimak.
- Nema cijena paketa shopa u KM.
- Nema nista o API-ju osim jedne stavke u listi pogodnosti shopa.

Zakljucak: pomoc pokriva "kako se sta radi", a blog pokriva "zasto i kako bolje". Za strategiju je blog.olx.ba i dalje bogatiji izvor. To je sljedeci korpus za povlacenje ako treba.

## Kako osvjeziti korpus za tri mjeseca

Cijela stranica je Zendesk Help Center, pa scrape kroz browser nije potreban. Tri poziva i skripta:

```bash
for f in categories sections articles; do
  curl -s "https://pomoc.olx.ba/api/v2/help_center/bs/$f.json?per_page=100" -o $f.json
done
python3 build_corpus.py
```

Ako broj clanaka predje 100, dodaj petlju po `page` dok `next_page` nije prazan.

Za pracenje promjena: polje `updated_at` postoji na svakom clanku. Uporedi novi `index.csv` sa starim i vidi sta je mijenjano, bez ponovnog citanja svega.

## Napomena o koristenju

Ovo je doslovan sadrzaj tudje zvanicne dokumentacije. Koristiti interno kao izvor istine i kao osnovu za savjetovanje. Ne prepakivati kao vlastiti materijal za klijente i ne objavljivati.
