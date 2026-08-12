# Strazar rezim cuvara: razrada prije implementacije

Datum: 12.08.2026. Grana: `arhitektura-manji-resursi`. Nastavak na
`analiza-manji-resursi.md` (tacka o hipotezi 3). Ovo je specifikacija namjere; plan
implementacije radi tehnicki vodja i vraca ga na pregled prije izvrsenja.

## Cilj

Sesija (claude proces, 130 do 416 MB, plus bun poller ~42 MB, plus MCP server) ne stoji
ziva dok klijent cuti. Poslije praga mirovanja cuvar je UGASI i sam jeftino straza nad
bot tokenom; na prvu poruku je digne. Dobitak: ~200 do 500 MB po klonu u mirovanju pada
na ~10 do 20 MB (sam cuvar).

## Ne-ciljevi

* Ne dira se nista u `src/` (core, cli, mcp). Kalendarski poslovi ostaju kakvi jesu.
* Ne mijenja se Telegram plugin ni njegov ugovor: on ostaje jedini OBRADJIVAC poruka.
* Ne uvodi se novi runtime ni novi stalni proces: prosiruje se postojeci
  `scripts/cuvar-sesije.mjs` (Node, radi na macOS i Windows, pravilo iz pogon.md).
* Bez izdanja u ovom poslu: verzija i changelog idu kroz skill `olx-izdanje` kasnije.

## Danasnje stanje (izmjereno, reference)

* `scripts/cuvar-sesije.mjs`: idle restart (prag `OLX_SESIJA_IDLE_SATI`, default 2 h
  klijent / 1 h admin bot) radi `zatraziRestart` (linija 481), a exit handler (linija
  448 do 451) sesiju digne ponovo za 3 s. Memorija se nikad ne vraca.
* Idle uslov `aktivnost > startTs` (linija 555) znaci da se sesija koja nikad nije
  dobila poruku NIKAD ne gasi. Strazar ovu rupu zatvara usput.
* Telegram polling drzi grammy u bun procesu plugina, unutar sesije. Dva aktivna
  `getUpdates` konzumera na istom tokenu se sudaraju (409), zato straza smije raditi
  SAMO dok je sesija mrtva.
* `.claude/rules/pogon.md` trenutno kaze da se `getUpdates` mimo plugina NE pokusava.
  To pravilo je pisano za zivu sesiju; u sklopu ovog posla se dopunjuje: zabrana vazi
  dok sesija zivi, strazar smije dok je sesija ugasena i NIKAD ne potvrdjuje offset.

## Mehanika strazara

Cuvar dobija drugo stanje. Danas: SESIJA_ZIVA (uz kratke prelaze restarta). Novo:
SESIJA_ZIVA i STRAZA.

1. **Ulazak u strazu.** Kad strazar rezim ukljucen (`OLX_SESIJA_STRAZAR=1` u `.env`,
   default iskljuceno, ponasanje bez prekidaca bajt za bajt isto kao danas):
   * idle prag (postojeci `IDLE_SATI`) gasi sesiju postojecim putem (`ugasiDijete`),
     ali exit handler umjesto ponovnog `pokreni()` ulazi u strazu;
   * nocni termin (03 h) radi isto: ciscenje inboxa i logova kao danas, pa gasenje i
     straza umjesto restarta;
   * rupa sa praznom sesijom nestaje sama: prazna sesija se gasi po idle pragu bez
     obzira na `aktivnost > startTs`, jer je straza pokriva.
2. **Straza.** Petlja `getUpdates` long poll (timeout ~50 s) na bot token, fetch iz
   samog cuvara, bez ijedne nove zavisnosti. Kljucno pravilo: **offset se NIKAD ne
   potvrdjuje.** Poruka se vidi ali se ne pojede; kad sesija ustane, plugin povuce istu
   poruku ponovo i obradi je svojim normalnim putem (allowlist, inbox, kanal).
   Token se cita isto kako ga cita `dist/core/telegram.js` (cuvar ga vec importuje za
   `javiAdminu`); admin bot ima svoj token i svoj runtime, ista logika po tipu.
3. **Budjenje.** Na prvu nepraznu listu update-a: prekini strazu (nijedan novi
   `getUpdates` zahtjev), best effort `sendChatAction typing` u chat iz update-a da
   klijent vidi da se nesto desava, pa postojeci `pokreni()`. Hladni start (claude +
   MCP + plugin) je procijenjenih 5 do 15 s.
4. **V1 budi na SVAKI update.** Bez filtriranja po allowlistu: jednostavno i sigurno,
   plugin ionako odbacuje nedozvoljeno, a cijena je povremeno nepotrebno budjenje koje
   idle prag opet ugasi. Filtriranje po `access.json` (i potvrda offseta za tudje
   update-e da se ne gomilaju) je moguca V2, ne raditi je odmah.
5. **Rubovi u strazi:**
   * `RESTART_ZAHTJEV` fajl (onboarding puller): u strazi ga samo obrisati; sesija
     ionako cita svjez `.env` pri sljedecem startu.
   * Greska mreze u strazi: backoff (npr. 5 s pa do 60 s), bez alarma na prvi pad;
     alarm adminu tek na duze neprekinuto stanje (npr. 30 min bez uspjesnog poll-a).
   * Ako `pokreni()` padne po budjenju, postojeca mehanika brzih padova i alarma vazi;
     update ostaje nepotvrdjen na Telegramu pa se nista ne gubi.
   * Kratko preklapanje straze i plugin pollera je prezivljivo (plugin ima retry sa
     backoffom do 15 s, 8 pokusaja na 409), ali dizajn ga izbjegava: straza ne salje
     novi zahtjev poslije odluke o budjenju.

## Kriticna provjera PRIJE pisanja koda

**Da li plugin pri startu odbacuje zaostale update-e?** Cijeli dizajn stoji na tome da
plugin poslije budjenja povuce nepotvrdjeni update. Grammy `bot.start()` po defaultu NE
odbacuje zaostalo, ali to treba potvrditi citanjem plugin koda
(`.claude-runtime*/plugins/... telegram/0.0.6/server.ts`, trazi `drop_pending_updates`
ili ekvivalent). Ako plugin ipak odbacuje, dizajn se vraca na razmatranje (opcije:
straza cita a ne dira, pa sesiji poruku dostavi drugim kanalom; ili izmjena pristupa) i
NE ide se dalje bez nove odluke.

Drugu stvar izmjeriti na pocetku: stvarno vrijeme hladnog starta do prvog odgovora, da
upozorenje klijentu i `typing` imaju pokrice.

## Sta se mijenja, po fajlovima

* `scripts/cuvar-sesije.mjs`: stanje straze, ulazak/izlazak, poll petlja (po
  mogucnosti logika u novom `scripts/lib/straza.mjs` da bude testabilna izolovano).
* `scripts/lib/sesija.mjs`: po potrebi izvoz pomocnih funkcija; `claudeArgv` i AI
  mapiranje se NE diraju.
* `.env.example`: `OLX_SESIJA_STRAZAR` sa objasnjenjem i defaultom iskljuceno.
* `.claude/rules/pogon.md`: dopuna pravila o `getUpdates` (vidi gore).
* `olx-dokumentacija/arhitektura.md`: opis cuvara (dijagram velike slike i tabela
  automatskog), jedna recenica o strazi i hladnom startu.
* `CHANGELOG.md`: sekcija za sljedece izdanje (bez podizanja verzije u ovom poslu).

## Kriteriji gotovosti

1. Sa `OLX_SESIJA_STRAZAR=1`: poslije idle praga `claude` proces NE postoji (provjera
   `ps`), cuvar zivi; poruka u grupu budi sesiju i biva NORMALNO obradjena (nista
   izgubljeno), mjereno vrijeme do odgovora zabiljezeno.
2. Bez prekidaca: ponasanje identicno danasnjem (idle restart, nocni restart), nijedan
   postojeci log format promijenjen bez potrebe.
3. Nocno gasenje radi i sesija ustaje na prvu jutarnju poruku klijenta; jutarnja
   cron poruka u 07:20 stize uredno i BEZ budjenja sesije (ona ide mimo sesije).
4. Nema 409 petlje: u logu straze i plugina nema ponavljanog conflict niza.
5. `node scripts/provjeri-klon.mjs` prolazi; `npm test` i `npm run typecheck` prolaze.
6. Radi na macOS launchd putu; Windows put ne smije biti razbijen (isti .mjs fajl,
   bez platformski specificnih poziva mimo grana po `process.platform`).
7. Dokumentacija i pravilo pogona dopunjeni u istom poslu.

## Redoslijed uvodjenja (poslije spajanja)

1. Admin bot jednog klona (`OLX_SESIJA_IDLE_SATI` moze i krace, npr. 0.25), mjerenje
   RSS prije i poslije.
2. Klijentska sesija istog klona.
3. Flota kroz redovno izdanje, prekidac i dalje opt-in po klonu.
