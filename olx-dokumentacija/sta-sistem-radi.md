# Sta sistem radi, obicnim jezikom

Ovo je JEDINI dio popisa koji se pise rukom, jer se iz imena alata ne moze izvesti korist za
covjeka koji plati uslugu. Cita se minut prije razgovora sa musterijom.

Uz svaku temu stoji nevidljivi red `<!-- pokriva: ... -->`. On ne sluzi citaocu nego provjeri:
`node scripts/popis-mogucnosti.mjs --provjeri` trazi da svaka sposobnost iz koda pripada tacno
jednoj temi. Kad neko doda nov alat, provjera pada dok se ime ne dopise u odgovarajuci red. Ako ne
pripada nijednoj temi, to je stvarno nova sposobnost i trazi novu temu sa svojom recenicom.

Promjena opisa alata ovdje ne trazi nista: opisi se ne porede, samo imena.

> NAPOMENA: recenice ispod su grube i ceka ih prepravka. Struktura i mapa pokrivenosti su gotove.

## Objava novog artikla

<!-- pokriva: olx_suggest_category, olx_find_category, olx_categories, olx_category, olx_category_children, olx_category_attributes, olx_category_brands, olx_category_models, olx_draft_check, olx_create_listing, olx_publish_listing, olx_upload_images, olx_set_main_image, olx_delete_image, olx_sablon_opisa, olx_prijedlozi, cli:category, cli:listings images -->

Posaljes fotografiju i par rijeci, a nazad dobijes gotov oglas: pogodjenu kategoriju, popunjena
obavezna polja, naslov i opis pisane za pretragu, i slike na oglasu. Prije slanja se provjeri hoce
li objava nesto kostati, jer vozila, nekretnine, poslovi i usluge nose naknadu, i bez tvoje
potvrde ne ide dalje.

## Slike artikla

<!-- pokriva: olx_generiraj_sliku, olx_opisi_sliku, olx_pozadina, olx_limit_slika -->

Fotografija sa telefona se moze ocistiti tako da artikal dobije miran prostor i ravno svjetlo,
umjesto stola u magacinu. Pozadina se moze zadati jednom pa da svi oglasi izgledaju kao jedna
serija.

## Odrzavanje kataloga

<!-- pokriva: olx_list_listings, olx_get_listing, olx_find_my_listing, olx_update_listing, olx_hide_listing, olx_unhide_listing, olx_finish_listing, olx_bulk_sklanjanje, olx_mrtvi_oglasi, olx_izuzeca, cli:listings -->

Katalog se drzi urednim bez rucnog klikanja po sajtu: sto je prodano ide u prodano, sto nema na
stanju se sakrije pa vrati kad stigne roba, a izmjena preko cijelog kataloga je jedan potez a ne
sto klikova. Oglasi koje niko ne gleda se sami prijave.

## Cijene i akcije

<!-- pokriva: olx_bulk_price, olx_set_discount, olx_finish_discount, cli:discount -->

Cijene se mijenjaju grupno, po pravilu koje zadas. Akcijska cijena se postavi i sama zavrsi kad
akcija istekne.

## Vidljivost bez troska

<!-- pokriva: olx_refresh_listing, olx_refresh_bulk, olx_refresh_limits, olx_ritam_obnova, cli:refresh, posao:dnevno -->

Svaki nalog ima besplatnu mjesecnu kvotu obnova, a obnova vraca oglas na vrh liste. Sistem tu
kvotu trosi ravnomjerno kroz mjesec umjesto da se potrosi u tri dana, i to radi sam svako jutro.

## Placeno izdvajanje

<!-- pokriva: olx_sponsor_listing, olx_sponsor_price, olx_sponsor_plan, olx_sponsor_effect, cli:sponsor, cli:sponsor plan -->

Kad se placa izdvajanje, prvo se vidi cijena pa se tek onda trosi, i nikad bez tvoje potvrde.
Poslije se mjeri je li se isplatilo, po pregledima prije i poslije.

## Izvjestaji i mjerenje

<!-- pokriva: olx_profile_stats, olx_listing_report, olx_account_alerts, cli:stats, posao:snapshot, posao:sedmicno -->

Svako jutro stigne kratak pregled sta se desilo na shopu, a jednom sedmicno siri izvjestaj. Sam
sajt ne pamti sta je bilo prosle sedmice, pa sistem pravi vlastite snimke da bi se rast uopste
mogao vidjeti.

## Konkurencija i novi klijenti

<!-- pokriva: olx_competitor_report, olx_user_profile, olx_onboarding_report, cli:users, posao:onboarding-puller -->

Tudji shop se moze pogledati javnim podacima: koliko ima oglasa, koliko su svjezi, kako stoje
cijene. Isto se koristi i kad se procjenjuje da li se novom klijentu isplati uzeti shop.

## Nalog, limiti i lokacije

<!-- pokriva: olx_whoami, olx_listing_limits, olx_cities, olx_city, olx_countries, olx_country_states, olx_canton_cities, cli:auth, cli:location -->

Jedan klon radi za jedan nalog i to se ne moze zabunom promijeniti. Limiti paketa i preostali
prostor za nove oglase se citaju sa naloga, ne pamte se napamet.

## Pamcenje i arhiva

<!-- pokriva: olx_zapamti, olx_zabiljezi_saznanje, olx_arhiva, olx_skini_artikal, olx_vrati_artikal, posao:saznanja -->

Sto jednom kazes ostaje zapamceno i poslije zatvaranja razgovora. Skinut artikal se cuva u arhivi,
pa se isti oglas moze vratiti bez ponovnog pisanja.

## Razgovor preko Telegrama

<!-- pokriva: cli:telegram, cli:telegram grupe, posao:sesija, posao:admin-bot -->

Sve se radi kroz obican razgovor u Telegramu, sa telefona, bez ucenja ijednog alata. Bot je uvijek
budan, a ko mu smije pisati je izricito odobreno.

## Automatski poslovi i sigurnost podataka

<!-- pokriva: cli:posao, posao:backup, posao:backup-nadzor, posao:nadzor-flote, posao:ai-runda -->

Poslovi rade sami po rasporedu, i kad niko ne gleda. Stanje se svakodnevno cuva van racunara, a
nadzor javlja ako je neki dio flote stao.
