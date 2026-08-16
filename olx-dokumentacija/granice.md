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
  Bez `confirm` ne salju zahtjev NI `olx_create_listing`, NI `olx_publish_listing`, NI
  `olx_update_listing` kad mijenja kategoriju: naplata moze pasti na kreiranju ili na objavi, a
  nacrt u naplatnu kategoriju moze doci i mimo bota, pa brana stoji na sva tri mjesta.
- **Nepoznata cijena se tretira kao naplatna.** Kad se naknada kategorije ne moze procitati,
  radnja trazi potvrdu umjesto da tiho prodje. Nula i "ne znam" nisu isto.
- **Komercijalna ponuda se nikad ne izmislja.** Popust, kod za popust, gratis artikal, rok
  dostave i slicno idu u oglas samo ako stoje u profilu klijenta ili ih je klijent rekao u
  razgovoru. Izmisljena ponuda je obecanje koje klijent mora ispuniti kupcu.
- Obnove unutar besplatne kvote ne kostaju i ne traze potvrdu.
- Kad je dostignut dnevni plafon (`OLX_MAX_SPEND_PER_DAY`), radnja se odbija i javlja se
  administratoru, ne korisniku.

## Brisanje

- Bot ne brise oglase. `olx_delete_listing` ne postoji u MCP-u i nece biti dodat.
- Na "obrisi" ponudi `olx_finish_listing` (prodano, ostaje u historiji kao dokaz prodaje) ili
  `olx_hide_listing` (artikal se vraca na stanje). Pravo brisanje je samo CLI `listings rm`,
  za ljudsku ruku.

## Grupne radnje

- Radnja nad VISE od jednog oglasa ide grupnim alatom, nikad pojedinacnim u petlji:
  zavrsavanje i sakrivanje kroz `olx_bulk_sklanjanje`, obnove kroz `olx_refresh_bulk`, cijene
  kroz `olx_bulk_price`. Grupni alat je jedan potez sa jednom potvrdom i jednim spiskom greska.
- Petlja od N pojedinacnih poziva je N puta cekanja i N prilika da se pogrijesi ID, a korisnik
  za to vrijeme ne vidi nista. Izmjereno u praksi 29.07.2026: 47 poziva `olx_finish_listing`
  gdje je trebao jedan `olx_bulk_sklanjanje`.
- Pojedinacni alat ostaje ispravan izbor za jedan oglas.

## Vidljivost

- Na vrh se dolazi obnovom ili izdvajanjem, nikad brisanjem i ponovnim objavljivanjem. Ponovna
  objava gubi preglede, pitanja i historiju, a ne donosi nista sto obnova ne donosi jeftinije.
- Jedini izuzetak je ZAVRSEN oglas, i to ne zbog ranga nego zato sto drugog puta nema: API za
  `finish` nema par kakav `unhide` jeste za `hide`, a opciju ponovne objave zavrsenih platforma
  je ukinula (saznato 04.08.2026). Zato `olx_reaktiviraj_oglas` radi ponovnu objavu samo nad
  izricito zavrsenim oglasom, a aktivan, istekao i neobjavljen nacrt odbija i upucuje na jeftiniji
  put. Gubitak pregleda se korisniku kaze PRIJE objave, ne poslije.

## Nalog i brojevi

- Jedan klon, jedan nalog. Promjena naloga kroz bota ne postoji. Prije upisa ili troska potvrdi
  nalog (`olx_whoami`).
- Brojeve ne tvrdi napamet: kvote (`olx_refresh_limits`), cijene izdvajanja
  (`olx_sponsor_price`), limiti paketa (`olx_listing_limits`). Kad se izvori razilaze, vazi
  `olx://pravila-brojeva`.

## Slike

- Kad je alat `olx_opisi_sliku` u listi alata, to znaci da pogon ove sesije NE vidi slike.
  Tada se fajl slike nikad ne otvara citanjem fajla: citanje bi sliku poslalo modelu koji je ne
  prihvata i potez bi pao (izmjereno na DeepSeek endpointu, `deepseek-nalazi.md`). Slika ide
  iskljucivo kroz taj alat, pa se dalje radi sa tekstualnim opisom koji je vratio.
- Kad tog alata nema, sesija slike vidi sama i citanje fajla je ispravan put.
- Ni u jednom slucaju se ne izmislja sadrzaj slike koja nije ni vidjena ni opisana.
- **Stalna pozadina sa SLIKOM daje dvije verzije, i to se kaze unaprijed.** Kad je klijent zadao
  pozadinu sa slikom (`olx_pozadina`), artikal se na nju SLAZE u kodu: slozena slika ima pozadinu
  i logo tacno kao original, uvijek u 4:3. Uz nju se nudi i Gemini DORADJENA varijanta (ljepse
  svjetlo i sjena), na kojoj logo i tekst pozadine NISU garantovani, jer model sliku precrtava.
  Klijent uvijek bira izmedju te dvije; obecava se identicna pozadina SAMO za slozenu verziju.
  Pozadina zadana samo OPISOM se i dalje crta iznova (slicna, nikad ista) i za nju vazi staro
  upozorenje: tekst i logo ce biti iskrivljeni.
- **Pro modeli su iskljuceni u kodu.** Svaki Gemini model sa "pro" segmentom u imenu se odbija
  (brana u `pozoviGemini`), bez izuzetka: izmjereno 04.08.2026. da nenamjeran pro model kosta
  1.68 USD u jednom danu. Isto vazi za pogonski model sesije (OLX_DEEPSEEK_MODEL).
- **Generisana slika prikazuje artikal koji se oglasava, i nista drugo.** Alat
  (`olx_generiraj_sliku`) postoji da fotografija artikla dobije cist prostor i ravno svjetlo, ne
  da crta sadrzaj po zelji. U klijentskom profilu to je i tvrdo zatvoreno: recept se bira sa
  spiska, uz njega ide prava fotografija, a kratka zelja o sceni prolazi kroz filter. Odbijen
  zahtjev se ne pokusava zaobici drugom formulacijom, nego se korisniku kaze da se to ne moze.
- **Vise stvarnih artikala sa iste fotografije nije izmisljanje sadrzaja.** Kad klijent posalje
  jednu fotografiju na kojoj stvarno stoji vise artikala, svi se prepoznaju i slazu na pozadinu:
  sav sadrzaj je stvaran i prisutan na fotografiji koju je klijent poslao, sto nije u sukobu sa
  pravilom iznad. Artikli koji se na fotografiji dodiruju prepoznaju se kao jedan.
- **Tudja fotografija u oglasu je vlasnicka odluka, i ide samo na nov zapakovan artikal.**
  Referentna (stock) slika (`olx_stock_slika`) je jedini tok u kojem u oglas ulazi fotografija
  koju klijent nije snimio. Otvorio ga je vlasnik 16.08.2026, svjesno i uz izlozen rizik, i zato
  stoji iza prekidaca `OLX_STOCK_SLIKE` koji je po defaultu UGASEN: na klonu gdje ga niko nije
  upalio alata nema. Sto ga ogranicava:
  - **Samo nov, zapakovan artikal.** Polovan se odbija u kodu. Referentna slika prikazuje MODEL,
    ne bas taj primjerak, pa bi na polovnom artiklu lagala kupca o ogrebotinama i habanju upravo
    one stvari koju kupuje. Nepoznato stanje se NE tumaci u korist prolaza, nego trazi izricitu
    tvrdnju da je artikal nov i potvrdu; isto pravilo kao "nepoznata cijena je naplatna".
  - **Samo izvor sa poznatom licencom.** Trazi se na Wikimedia Commonsu, gdje svaka slika nosi
    eksplicitnu slobodnu licencu, i ta licenca se sa autorom vraca uz svakog kandidata. Slika sa
    proizvodjackog sajta ili web shopa je tudje autorsko djelo bez ikakve dozvole i ne uzima se.
  - **Samo sa hostova sa spiska.** Preuzima se jedino sa `upload.wikimedia.org`, uz dopunu koja
    se upisuje rukom u `.env` (`OLX_STOCK_HOSTOVI`), nikad kroz razgovor. Preusmjerenja se ne
    prate, sadrzaj se provjerava po magic bajtovima a ne po ekstenziji, i vazi granica velicine.
  - **Korisnik uvijek bira, i uvijek vidi licencu.** Kandidati mu se salju svi, uz ime autora i
    licencu, jer je navodjenje autora USLOV koristenja slike. Bot ne bira umjesto njega.
  - **Odgovornost nosi oglasivac.** Bot pribavlja sliku i njenu licencu; da li je smije staviti
    u svoj oglas i da li je uslov licence ispunio, odgovara klijent kao oglasivac. To mu se kaze
    kad prvi put zatrazi, ne poslije.
  - Za tu sliku se AI ne zove i dnevni plafon generisanja se ne trosi.

## Trag i tajne

- Svaka izmjena stanja i svaki trosak idu u audit log (`.olx-pik/audit.jsonl`). Na pitanje sta
  je radjeno i kada, odgovor se cita iz tog fajla, ne iz pamcenja.
- Token nikad u git, u odgovor ni u poruku. To vrijedi i za backup stanja: on salje samo ono sto
  je na bijelom spisku, a fajl u kojem se nadje oblik tokena se zaustavlja i prijavljuje.

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
