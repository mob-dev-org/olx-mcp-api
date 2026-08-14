# Sta sistem radi, obicnim jezikom

Ovo je JEDINI dio popisa koji se pise rukom, jer se iz imena alata ne moze izvesti korist za
covjeka koji plati uslugu. Cita se minut prije razgovora sa musterijom.

Teme su poredane po tome sta klijenta prvo zanima, ne po tome kako je sistem gradjen. Recenice su
pisane da se mogu IZGOVORITI naglas, bez ijednog imena alata. Kad dopisujes, drzi taj ton: sta
covjek dobija, ne sta sistem radi.

Uz svaku temu stoji nevidljivi red `<!-- pokriva: ... -->`. On ne sluzi citaocu nego provjeri:
`node scripts/popis-mogucnosti.mjs --provjeri` trazi da svaka sposobnost iz koda pripada tacno
jednoj temi. Kad neko doda nov alat, provjera pada dok se ime ne dopise u odgovarajuci red. Ako ne
pripada nijednoj temi, to je stvarno nova sposobnost i trazi novu temu sa svojom recenicom.

Promjena opisa alata ovdje ne trazi nista: opisi se ne porede, samo imena.

Sto ovdje NE pise, ne obecavaj. Popust, gratis artikal, rok dostave i slicno idu u razgovor samo
ako ih je klijent sam rekao.

## Kako to izgleda u svakodnevnom radu

<!-- pokriva: cli:telegram, cli:telegram grupe, posao:sesija, posao:admin-bot -->

Sve ide kroz obican razgovor u Telegramu, sa telefona, istim jezikom kojim bi to rekao svom
radniku. Nema panela koji se uci, nema novog programa. Bot je budan i nocu i vikendom, a ko mu
smije pisati odredjujes ti, pa mozes ubaciti i svoje ljude u grupu.

## Objava novog artikla

<!-- pokriva: olx_suggest_category, olx_find_category, olx_categories, olx_category, olx_category_children, olx_category_attributes, olx_category_brands, olx_category_models, olx_draft_check, olx_create_listing, olx_publish_listing, olx_upload_images, olx_set_main_image, olx_delete_image, olx_sablon_opisa, olx_prijedlozi, cli:category, cli:listings images -->

Posaljes fotografiju i par rijeci, a nazad dobijes gotov oglas: pogodjenu kategoriju, popunjena
obavezna polja, naslov i opis pisane tako da te ljudi nadju u pretrazi, i slike na oglasu. Ono sto
inace oduzme deset minuta po artiklu ovdje traje koliko i jedna poruka.

Prije nego se bilo sta objavi, provjeri se hoce li to nesto kostati, jer vozila, nekretnine,
poslovi i usluge nose naknadu. Bez tvoje potvrde ne ide dalje.

## Da oglasi ostanu vidljivi, a da te ne kosta

<!-- pokriva: olx_refresh_listing, olx_refresh_bulk, olx_refresh_limits, olx_ritam_obnova, cli:refresh, posao:dnevno -->

Oglas koji stoji nedirnut tone u listi, a obnova ga vraca na vrh. Svaki nalog ima besplatnu
mjesecnu kvotu obnova, i vecina ljudi je ili ne iskoristi ili je potrosi u prva tri dana pa ostatak
mjeseca bude nevidljiva.

Sistem tu kvotu rasporedjuje ravnomjerno kroz cijeli mjesec i radi to sam, svako jutro, bez tvog
klika. To je dio koji ne kosta nista a najbrze se vidi.

## Da katalog bude uredan bez klikanja

<!-- pokriva: olx_list_listings, olx_get_listing, olx_find_my_listing, olx_update_listing, olx_hide_listing, olx_unhide_listing, olx_finish_listing, olx_bulk_sklanjanje, olx_mrtvi_oglasi, olx_izuzeca, cli:listings -->

Sto je prodano oznaci se kao prodano i ostaje ti u historiji kao dokaz da si prodavao. Sto trenutno
nema na stanju se sklanja, pa vrati kad roba stigne, umjesto da kupac zove za nesto sto nemas.

Izmjena preko cijelog kataloga je jedan potez, a ne sto klikova. Oglase koje niko ne gleda ne moras
traziti, sami se prijave.

## Cijene i akcije

<!-- pokriva: olx_bulk_price, olx_set_discount, olx_finish_discount, cli:discount -->

Cijene se mijenjaju grupno, po pravilu koje ti zadas, na primjer sve u jednoj kategoriji za deset
posto. Akcijska cijena se postavi i sama prestane kad akcija istekne, pa ne ostane da visi
zaboravljena.

## Kad se placa izdvajanje

<!-- pokriva: olx_sponsor_listing, olx_sponsor_price, olx_sponsor_plan, olx_sponsor_effect, cli:sponsor, cli:sponsor plan -->

Prvo vidis cijenu, pa tek onda odlucis. Bez tvoje izricite potvrde ne trosi se nijedan kredit, i to
vrijedi za svaki oglas posebno.

Poslije se mjeri je li se isplatilo, po pregledima prije, tokom i poslije izdvajanja. Tako se novac
usmjerava na ono sto stvarno vuce, a ne po osjecaju.

## Slike artikla

<!-- pokriva: olx_generiraj_sliku, olx_opisi_sliku, olx_pozadina, olx_limit_slika -->

Fotografija sa telefona se moze ocistiti tako da artikal dobije miran prostor i ravno svjetlo,
umjesto stola u magacinu ili sarene prostirke. Pozadinu zadas jednom, pa svi oglasi izgledaju kao
jedna serija.

Vazno da se kaze unaprijed: pozadina se svaki put crta iznova, pa je slicna a nikad identicna, i
natpisi i logo se na njoj izoblice. Zato se brendirana pozadina ne nudi.

## Da vidis sta se stvarno desava

<!-- pokriva: olx_profile_stats, olx_listing_report, olx_account_alerts, cli:stats, posao:snapshot, posao:sedmicno -->

Svako jutro stigne kratak pregled sta se desilo na shopu, a jednom sedmicno siri izvjestaj sa
rastom i prijedlozima.

Sam sajt ne pamti kako je bilo prosle sedmice, pokazuje samo zbirni broj pregleda od pocetka. Zato
sistem svake noci pravi vlastiti snimak, pa se rast uopste moze izmjeriti. Ko to ne radi, ne moze
znati je li mu bolje ili gore.

## Konkurencija

<!-- pokriva: olx_competitor_report, olx_user_profile, olx_onboarding_report, cli:users, posao:onboarding-puller -->

Tudji shop se gleda samo javnim podacima, onim sto svako vidi na sajtu: koliko ima oglasa, koliko
su svjezi, u kojem su rasponu cijene, koliko izdvajaju. Iz toga se vidi gdje si u odnosu na njih i
sta rade drugacije.

## Nalog, limiti i lokacije

<!-- pokriva: olx_whoami, olx_listing_limits, olx_cities, olx_city, olx_countries, olx_country_states, olx_canton_cities, cli:auth, cli:location -->

Jedan postavljen sistem radi za jedan nalog i to se ne moze zabunom promijeniti, pa nema straha da
nesto zavrsi na tudjem shopu.

Koliko ti je jos mjesta ostalo za nove oglase i dokle traje paket cita se sa naloga u tom trenutku,
ne pamti se napamet, pa broj koji dobijes vazi.

## Pamcenje i arhiva

<!-- pokriva: olx_zapamti, olx_zabiljezi_saznanje, olx_arhiva, olx_skini_artikal, olx_vrati_artikal, posao:saznanja -->

Sto jednom kazes ostaje zapamceno i poslije zatvaranja razgovora, pa ne moras svaki put ispocetka
objasnjavati kako radis.

Artikal koji skines cuva se u arhivi zajedno sa slikama, pa se isti oglas vrati kad roba dodje, bez
ponovnog pisanja i slikanja.

## Sta radi samo, dok niko ne gleda

<!-- pokriva: cli:posao, posao:backup, posao:backup-nadzor, posao:nadzor-flote, posao:ai-runda -->

Jutarnji pregled, obnove, nocni snimci i sigurnosna kopija idu po rasporedu, i onda kad si na putu
ili na godisnjem.

Tvoji podaci se svaki dan cuvaju van tog racunara, a poseban nadzor javlja nama ako je nesto stalo,
pa problem vidimo prije nego ga ti primijetis.
