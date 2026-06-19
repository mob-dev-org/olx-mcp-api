# Kako funkcioniše rangiranje, pretraga i sortiranje oglasa na OLX.ba / PIK.ba — interni vodič za tim

## TL;DR

Vaš kolega je samo djelimično u pravu. Vrijeme objave/obnove (svježina) jeste glavni faktor pozicije među standardnim (besplatnim) oglasima, ALI to dolazi do izražaja tek nakon što oglas uopšte uđe u skup rezultata neke pretrage — a ulazak u taj skup određuju ključne riječi u naslovu (i podnaslovu). Drugim riječima: ključne riječi odlučuju da li ćete biti pronađeni, a svježina (obnova) i plaćeno izdvajanje odlučuju koliko ćete biti visoko.

Hijerarhija pozicioniranja ide ovako: (1) Plaćeno izdvajanje (premium pa klasično) uvijek je iznad svih standardnih oglasa i može ići na naslovnicu; (2) među standardnim oglasima vlada svježina — obnova oglasu daje „svjež datum" i gura ga na prva mjesta; (3) ključne riječi + tačna kategorija + filteri/atributi određuju u kojim pretragama se uopšte pojavljujete. Sve tri poluge rade zajedno — nijedna sama nije dovoljna.

OLX/PIK ne objavljuje detaljan algoritam rangiranja, ali je zvanično dokumentovano: tražilica pretražuje naslov i podnaslov (ne i detaljni opis), obnova vraća oglas na vrh kategorije, a „najbolja" promocija je izdvajanje + automatsko obnavljanje. Ostatak (npr. tačan default poredak) je razumna pretpostavka izvedena iz dokumentovane mehanike, što je niže jasno označeno.

## Ključni nalazi (sažeto, sve potvrđeno zvaničnim izvorima osim gdje je naznačeno)

- Tražilica spaja riječi iz naslova (AND logika). Na pojam „Golf 7" prikazuju se svi oglasi koji u nazivu sadrže i „Golf" i „7", bez obzira na redoslijed riječi. Riječi se moraju potpuno podudarati — zvanično: „riječi se moraju potpuno podudarati, tako da oglas pod nazivom 'Tastatura i miš' neće moći biti pronađen pod pretragom 'tastature' i slično."
- Detaljni OPIS NE ulazi u glavnu tražilicu; podnaslov DA. Artikli navedeni samo u opisu „neće moći biti pronađeni putem glavne PIK tražilice". Podnaslov je „značajan u pretrazi" i vidljiv prevlačenjem kursora.
- Default sortiranje među standardnim oglasima = svježina. Obnova daje oglasu „svjež datum" i on „dolazi na prva mjesta u kategoriji svaki put kada se obnovi".
- Izdvajanje uvijek pozicionira iznad standardnih. Dvije vrste (klasično i premium); „najbolja" je kombinacija izdvajanje + automatsko obnavljanje (intervali 3, 8 ili 24 sata).
- Tačna kategorija, lokacija na mapi i forme/atributi funkcionišu kao filteri (ne kao tekstualna pretraga), ali su ključni da kupac koji pretražuje unutar kategorije naiđe na vaš oglas.
- Rebrand OLX.ba → Pik.ba (juni 2026): nova adresa pik.ba, stara olx.ba se automatski preusmjerava, sve funkcionalnosti i nalozi ostaju isti. Tretirati kao istu platformu.

## Detalji

### 1. Kako radi OLX/PIK tražilica (search)

Princip podudaranja riječi iz naslova. Zvanični blog („Na koji način objaviti oglas, a da on dospije do kupca koji pretražuje OLX", blog.olx.ba, 2022) objašnjava: tražilica na pojam „Golf 7" prikaže sve oglase koji u nazivu sadrže riječi „Golf" i „7", pa se izlistaju i „VW Golf 7 1.6 g.p.2015", „Golf 7 2.0 TDI 110 KW", „Vw golf 7 tdi". Isto za „alfa romeo" → „Alfa Romeo STELVIO 2.2 210 Q4", „Alfa Romeo Giulietta 1.6 JTDM" itd.

Ključna pravila ponašanja tražilice (sve zvanično):

- Redoslijed riječi nije bitan, ali riječi se moraju potpuno podudarati (igraju ulogu padeži). Doslovno: „termini iz naziva Vašeg oglasa moraju biti podudarni sa unesenim od strane onog koji pretražuje, bez obzira na redoslijed, pri čemu bitnu ulogu igraju padeži… tako da oglas pod nazivom 'Tastatura i miš' neće moći biti pronađen pod pretragom 'tastature' i slično." (blog.olx.ba, 2022). Praktična posljedica: množina/jednina i izvedeni oblici se ne „pogađaju" automatski.
- Dijakritici se tretiraju jednako kao slova bez njih. Zvanični odgovor OLX administracije: „PIK tražilica jednako tretira slova sa i bez afrikata, s toga imajte slobodu na koji način objaviti artikal, ali svakako preporučujemo da unosite slova sa afrikatima." Tj. „kuća" i „kuca" daju iste rezultate, ali se preporučuje ispravno pisanje.

Šta se indeksira — naslov vs. podnaslov vs. opis vs. atributi:

- Naslov (naziv oglasa): primarno polje pretrage. Zvanično („Zlatna pravila objave artikala", blog.olx.ba): „pojam pretrage isključivo treba da odgovara (bude podudaran) jednom od pojmova iz naslova objavljenih artikala."
- Podnaslov: ulazi u pretragu. Zvanični odgovor OLX administracije (komentar uz blog 2022): „Savjetujemo da takve informacije navedete u podnaslovu, koji je također značajan u pretrazi, jer biva vidljiv prevlačenjem kursora preko rezultata." Napomena: ovo je zvanični stav iznesen kroz odgovor administracije, a ne u tijelu samog članka — ali predstavlja zvaničnu informaciju.
- Detaljni opis: NE ulazi u glavnu tražilicu. Zvanično („Više artikala objavi i prodaju ostvari!", blog.olx.ba): ako navedete dodatne artikle samo u opisu, „niti jedan od 4 artikla iz detaljnog opisa neće moći biti pronađeni putem glavne PIK tražilice, te jako teško putem Google, Yahoo i Bing pretraživača." Ovo je najvažniji nalaz za vaš tim: ono što nije u naslovu/podnaslovu praktično je nevidljivo za tražilicu.
- Atributi / detaljne informacije (forme): funkcionišu kao filteri, ne kao tekstualna pretraga slobodnim unosom. Zvanično se navodi da „Označavanjem tačnih formi, kao i lokacije na mapi omogućava dodatnu vidljivost oglasa." (Pretpostavka, jasno označena: indeksiranje sadržaja atributa kao slobodnog teksta nije zvanično dokumentovano; atributi pomažu kroz filtriranje, npr. gorivo, godište, brend/model.)

### 2. Sortiranje rezultata pretrage i uloga svježine

Opcije sortiranja koje korisnik bira (zvanično, „Olakšana pretraga oglasa na Android aplikaciji" + live stranice pretrage olx.ba): kroz opciju „Poredaj"/„Sortiraj" dostupno je:

- Relevantnost
- Datum objave (najnoviji / najstariji)
- Cijena (najniža / najviša — „Najjeftiniji/Najskuplji")
- Lokacija

Default (podrazumijevani) poredak = svježina. (Ovo je razumna, snažno potkrijepljena pretpostavka, a ne doslovno citirana rečenica — OLX/PIK nigdje eksplicitno ne kaže „default je najnoviji na vrhu".) Pretpostavka počiva na zvanično dokumentovanoj mehanici obnove:

- „Istekao oglas — Svaki mjesec dostupna Vam je opcija ručne obnove oglasa, te nakon aktivacije iste Vaš oglas dobija svježi datum…" (pomoc.olx.ba, „Vrsta oglašavanja i status oglasa"). Ručnu obnovu treba uraditi bar jednom u 6 mjeseci, inače oglas ide u „Istekle" i nestaje s pretrage.
- „…Vaš oglas… dolazi na prva mjesta u kategoriji svaki put kada se obnovi." (pomoc.olx.ba, „Izdvajanje oglasa / promocija").
- „Vaš artikal će biti osvježen u pretragama, te će biti znatno bolje pozicioniran" i „svaki dan nanovo zauzima početnu poziciju kod prikaza artikala u kategoriji" (blog.olx.ba, 2015).

Logika je jasna: da poredak nije po datumu/zadnjoj obnovi, obnova ne bi imala efekta na poziciju. Zato je vaš kolega u pravu da je svježina presudna — ali samo za rangiranje unutar standardnih oglasa, i samo nakon što naslov „uhvati" pretragu.

Važno upozorenje o cijeni: ako kupac sortira po cijeni ili koristi cjenovni filter (raspon), oglasi sa cijenom „Po dogovoru" se ISKLJUČUJU iz tih rezultata, jer „ne sadrže broj te se ne mogu sortirati" (blog.olx.ba, „Zašto navoditi cijenu artikla?"). Pravilo za tim: uvijek unositi konkretnu cijenu.

### 3. Izdvajanje (promocija) — klasično, premium i kombinovano

Zvanično (pomoc.olx.ba, „Izdvajanje oglasa / promocija"): promocija „omogućava da se Vaš oglas istakne među hiljadama drugih, pozicionira na vrhu liste rezultata pretrage i privuče pažnju potencijalnih kupaca." Izdvojeni oglas se može dodati i na naslovnu stranicu za dodatnu eksponiranost.

- Dvije vrste izdvajanja: klasično i premium.
- Izdvajanje na kategoriji vs. naslovnici: oglas može biti izdvojen samo u kategoriji (na vrhu rezultata pretrage te kategorije) ili u kategoriji + na naslovnici. Izdvojeni oglasi su vizuelno označeni (tamnija sjena).
- Kombinovana opcija = „najbolja". Zvanično: „Najbolja vrsta promocije oglasa na OLX.ba jeste kombinovana opcija promocije, a to je klasično ili premium Izdvajanje oglasa uz automatsko obnavljanje. Navedena opcija omogućava da se Vaš oglas ističe i dolazi na prva mjesta u kategoriji svaki put kada se obnovi… dostupni intervali obnove su 3, 8 ili 24 sata." Izdvojeni oglas se sam periodično osvježava i ostaje na vrhu izdvojenih.
- Cijena izdvajanja je dinamična. Zvanično (pomoc.olx.ba, „Cijena izdvajanja oglasa / promocije"): „Cijene promocije (klasično i premium izdvajanje) se kreiraju automatski i dinamične su" — veći broj objavljenih i izdvojenih oglasa u kategoriji diže cijenu, a cijena raste i s brojem dana izdvajanja. (Plaća se OLX/PIK kreditima; istorijski 10 kredita = 1 KM.)
- Zakazivanje promocije (novije, 2025): moguće je zakazati izdvajanje u tačno određeno vrijeme i ponavljati ga svaki dan u isto vrijeme — korisno za shopove koji prave „planer promocija".

Realna granica izdvajanja (iz iskustva korisnika, ne zvanično pravilo): ozbiljni kupci često pregledaju i neizdvojene oglase, a u prepunim kategorijama (npr. automobili) izdvojeni oglas se nalazi „u šumi" drugih izdvojenih. Zato izdvajanje nije zamjena za dobar naslov, cijenu i fotografije — ono pojačava ono što već valja.

### 4. Best practice za pisanje naslova (pretvorivo u checklistu)

Zvanične smjernice (blog.olx.ba 2022 + pomoc.olx.ba „Kako pravilno napisati naslov oglasa"):

- Pisati u nominativu. „bolje je objaviti oglas 'Kuća Sarajevo Centar', nego 'Prodajem kuću u Sarajevu u Centru'."
- Dobar vs. loš naslov (zvanični primjeri):
  - „Stan Šip" umjesto „Stan na Šipu"
  - „Volkswagen Golf 7 dizel TDI 110kw" umjesto „Prodajem Golfa očuvan"
  - „Tastatura Logitech K200 za PC" umjesto „Tastatura za PC"
  - „Maska za Apple iPhone 5" umjesto „Maska za telefon" (precizan model „minimalno 50% povećava posjete")
- Za automobil: samo proizvođač i model koji je predmet prodaje. Zabranjeno je trpati više modela/proizvođača u jedan naslov (npr. „Golf, Mercedes, Passat…") — to je „nedozvoljen naslov" i otežava drugima pronalazak (vidi greške niže).
- Jedan oglas = jedan artikal. Različite artikle objaviti odvojeno — to „rezultira najmanje petostruko većim brojem posjeta".
- Iskoristiti podnaslov za dodatne ključne riječi/specifikacije koje ne stanu u naslov (podnaslov ulazi u pretragu).
- Uključiti ključne riječi koje kupac stvarno kuca (brend, model, varijanta, lokacija, namjena).

Najčešće greške (zvanično + izvedeno):

- Naslov bez ključnih riječi („Prodajem povoljno", „Hitno").
- Više artikala/modela u jednom naslovu ili samo u opisu (ne pronalaze se tražilicom).
- Cijena „Po dogovoru" (ispada iz cjenovnih filtera/sortiranja).
- Pogrešna kategorija (vidi tačku 5) — ujedno najčešći razlog prijava među korisnicima.

### 5. Kategorija, lokacija i filteri/atributi

- Tačna kategorija je presudna. Zvanično (pomoc.olx.ba, „Ispravno kategorisanje oglasa"): „Pravilnim kategorisanjem i broj potencijalnih kupaca Vam se povećava, jer većina korisnika traženi proizvod pretražuje direktno u odgovarajućoj kategoriji." Npr. felge/dijelovi ne idu u „Vozila > Automobili" nego u „Dijelovi i oprema".
- Brend i model. Zvanično („Olakšaj pretragu i ubrzaj prodaju!"): označavanje brenda i modela omogućava „bržu identifikaciju, precizniju pretragu i filtriranje rezultata" i poređenje s konkurencijom.
- Lokacija na mapi i tačne forme daju „dodatnu vidljivost oglasa" i omogućavaju pronalazak kroz filtere (npr. mapa nekretnina, filteri vozila po gorivu/godištu).

### 6. Zvanične smjernice „kako doći do kupca koji pretražuje" / „kako privući posjete"

Objedinjeno iz zvaničnih izvora:

- Naslov sa ključnim riječima u nominativu (tačka 4).
- Jedan artikal po oglasu.
- Tačna kategorija + lokacija na mapi + popunjene forme/atributi.
- Konkretna cijena (ne „Po dogovoru").
- Kvalitetne fotografije (do 20 besplatno za shopove; podržan video/„video stories").
- Detaljan, tačan opis stanja (utiče na konverziju i povjerenje, iako ne na tražilicu).
- Redovna obnova za svježinu + izdvajanje za prioritetne artikle.
- Dodatni alati: „spašene pretrage", sistem preporučenih oglasa (ML preporuke na osnovu ključnih riječi/kategorija/klikova), statistika oglasa (pregledi, „pojmovi na pretrazi" pokazuju koje fraze kupci kucaju — koristiti to za optimizaciju naslova).

## Obnavljanje — pravila i limiti (precizno)

- Standardni korisnici: ručna obnova oglasa periodično (oglas dobija „svjež datum"); obnovu treba uraditi bar jednom u 6 mjeseci da oglas ne pređe u „Istekle".
- OLX/PIK shopovi: zvanično (olx.ba/shopovi): „Besplatnih 750 obnavljanja oglasa mjesečno" i „Besplatno ručno obnavljanje oglasa svakih 7 dana." Shop dobija i do 20 fotografija besplatno, grupno uređivanje do 50 artikala, mogućnost izdvajanja na 1 dan, te pri otvaranju 30 dana besplatnog korištenja + 500 OLX kredita dobrodošlice.
- OLX PRO: obnova oglasa svakih 21 dan, izdvajanje na 1 dan, napredna statistika (cijena reda ~10 KM/mjesec).
- Limiti broja oglasa: klasični profil 20 aktivnih oglasa u besplatnim kategorijama, +5 za svaku godinu na platformi. Pojedine kategorije (vozila, nekretnine, teretna vozila, servisi/usluge, poslovi, dio mašina itd.) su naplative za aktivaciju.
- Kombinovana autoobnova (uz izdvajanje): intervali 3, 8 ili 24 sata.

## Rebrand OLX.ba → Pik.ba (juni 2026)

Platforma se u junu 2026. vraća izvornom imenu Pik.ba (pokrenuta 2009. kao Pik.ba, 2015. postala dio OLX mreže). Zvanično: „Nova adresa platforme je pik.ba, a korisnici koji unesu staru adresu olx.ba biće automatski preusmjereni." Promjena se odnosi isključivo na naziv i vizuelni identitet — „Svi korisnički nalozi, aktivni oglasi, historija komunikacije, poruke, sačuvane pretrage i sve funkcionalnosti ostaju potpuno nepromijenjeni", na istoj tehnološkoj infrastrukturi (preko 3 miliona registrovanih korisnika). Za vaš tim: sve u ovom vodiču važi identično pod oba imena; samo zamijenite domen olx.ba → pik.ba.

## Preporuke (konkretni koraci + pragovi koji mijenjaju odluku)

Faza 1 — Osnova (uvijek, za svaki oglas):

1. Naslov = ključne riječi u nominativu, redoslijed: brend + model + ključna specifikacija + (lokacija ako je relevantna). Provjera: „Da li bi kupac ovaj naslov ukucao?"
2. Jedan artikal po oglasu. Nikad više modela u jednom naslovu.
3. Tačna kategorija + popunjene forme/atributi (brend, model, godište, gorivo…) + lokacija na mapi.
4. Konkretna cijena (nikad „Po dogovoru" ako želite biti u cjenovnim filterima).
5. Podnaslov iskoristiti za dodatne ključne riječi koje ne stanu u naslov.
6. Kvalitetne fotografije + detaljan tačan opis.

Faza 2 — Održavanje svježine (besplatno):

7. Obnavljati redovno. Shop: iskoristiti besplatne obnove svakih 7 dana (do 750/mjesec) — rasporedite ih na najvažnije/najkonkurentnije oglase. Standardni profil: bar jednom u 6 mjeseci da oglas ne istekne, a češće za bolju poziciju.
8. Pratiti statistiku oglasa, posebno „pojmovi na pretrazi" — ako kupci kucaju frazu koje nema u vašem naslovu, dopišite je.

Faza 3 — Plaćeno (kad organsko nije dovoljno):

9. Izdvajati selektivno — artikle veće vrijednosti ili one koji „stoje". Za maksimalan efekat: kombinovano izdvajanje + autoobnova (interval prema konkurentnosti kategorije: 24h za mirnije, 3–8h za prometne).
10. Naslovnica za premium/visokovrijedne artikle; kategorija za ostalo.

Pragovi koji mijenjaju preporuku:

- Ako oglas ima mnogo pregleda ali malo poruka → problem je cijena/opis/fotografije, NE pozicija. Ne trošite na izdvajanje; popravite ponudu.
- Ako oglas ima malo pregleda → problem je vidljivost: prvo provjerite naslov (ključne riječi) i kategoriju, pa tek onda obnova/izdvajanje.
- Ako je kategorija prezasićena izdvojenim oglasima (npr. automobili) → izdvajanje daje slabiji relativni efekat i skuplje je; veći naglasak na precizan naslov + konkurentnu cijenu + autoobnovu.

## Ograničenja i napomene o pouzdanosti

- OLX/PIK ne objavljuje detaljan algoritam rangiranja. Sve tvrdnje o redoslijedu prioriteta su izvedene iz zvanično dokumentovane mehanike (pretraga po naslovu, obnova → svjež datum → vrh kategorije, izdvajanje → iznad standardnih).
- Doslovno dokumentovano (visoka pouzdanost): tražilica radi po naslovu; podnaslov ulazi u pretragu; opis NE ulazi; obnova daje svjež datum i diže na vrh; izdvajanje + autoobnova = „najbolja" promocija; intervali 3/8/24h; opcije sortiranja (relevantnost/datum/cijena/lokacija); „Po dogovoru" ispada iz cjenovnih filtera; shop limiti (750/mjesec, 7 dana); rebrand i kontinuitet funkcionalnosti.
- Razumna pretpostavka (jasno označena): da je podrazumijevani poredak standardnih oglasa upravo po svježini (datum/zadnja obnova) — OLX/PIK to ne kaže doslovno, ali proizlazi iz toga što obnova mijenja poziciju; indeksiranje sadržaja atributa kao slobodnog teksta nije potvrđeno (atributi rade kao filteri).
- Korisnički navodi (forumi, komentari) korišteni su samo kao kontekst (npr. da izdvajanje nije svemoćno), nisu tretirani kao zvanično pravilo.
- Opšti princip oglasnih tražilica vs. OLX/PIK-specifično: „svježina + relevantnost ključnih riječi + plaćena promocija" je univerzalni obrazac oglasnih platformi u regiji (npr. sličan na KupujemProdajem); ono što je OLX/PIK-specifično i ovdje potvrđeno jeste: AND-podudaranje cijelih riječi iz naslova, podnaslov u pretrazi, opis van pretrage, konkretni intervali autoobnove (3/8/24h) i shop limiti (750 obnova/7 dana).
