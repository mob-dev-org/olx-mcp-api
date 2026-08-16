# Strazar rezim cuvara: razrada prije implementacije

*Historijski zapis. Strazar rezim je penzionisan zajedno sa `cuvar-sesije.mjs`; vazece stanje
otiska resursa je u `olx-dokumentacija/arhitektura.md`, sekcija 9.*

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

## Rucna provjera (izvrsiti prije uvodjenja na klijente)

Kod je napisan i pokriven automatskim testovima (`scripts/lib/straza.test.mjs`, ide kroz
`npm test`), ali automatski testovi ne mogu potvrditi ni jedan od sedam kriterija gotovosti:
oni traze zivu sesiju, pravi bot token i pravi Telegram. Ovo je taj skript. Radi se na klonu
koji IMA `.claude-runtime` i bot token, najbolje na probnom botu, a ne prvo na klijentu.

Priprema, jednom:

* Klon sa gotovim runtime-om (`node scripts/provjeri-klon.mjs` bez stavki koje FALE).
* Cuvar se pokrece rucno u terminalu, ne kroz launchd, da se log gleda uzivo:
  `node scripts/cuvar-sesije.mjs admin-bot` (ili bez argumenta za klijentsku sesiju).
  Prije toga ugasiti launchd verziju posla, jer dva cuvara istog tipa se odbijaju.
* Log pogona kad ide kroz launchd: `.olx-pik/cron-admin-bot.log`, odnosno
  `.olx-pik/cron-sesija.log` za klijentsku sesiju.

### Korak 1: idle gasenje (kriterij 1)

U `.env`: `OLX_SESIJA_STRAZAR=admin` i `OLX_SESIJA_IDLE_SATI=0.05` (3 minute). Pokreni cuvara.

Ocekivano u logu, po redu:

1. `Cuvar sesije, strazar rezim: nocni termin u 3h i 0.05h mirovanja GASE sesiju, cuvar tada strazari i budi je na prvu poruku.`
2. `Sesija pokrenuta (pid ..., pogon pretplata, profil admin).`
3. poslije oko 3 minute: `Gasim sesiju i ulazim u strazu: 0.05h bez aktivnosti, gasim sesiju.`
4. `Straza: sesija ugasena, cekam poruku (long poll 50s, offset se ne potvrdjuje).`

Provjera i mjerenje na tom mjestu:

* `ps -o rss=,comm= -p $(cat .olx-pik/cuvar-admin-bota.pid)` daje samo cuvara, red velicine
  10 do 20 MB.
* Ni jedan `claude` ni `bun server.ts` proces vise ne postoji:
  `ps ax | grep -E "claude|server.ts" | grep -v grep` je prazno.
* Zapisi izmjereni RSS prije gasenja (dok je sesija ziva) i poslije, to je cijeli dobitak.

### Korak 2: budjenje bez gubitka i vrijeme hladnog starta (kriterij 1)

Posalji poruku botu (u grupu, ili DM ako je admin bot). Zapisi tacno vrijeme slanja.

Ocekivano, po redu:

1. `Straza: update <broj> vidjen, dizem sesiju. Poruku obradjuje plugin, ne cuvar.`
2. u Telegramu se odmah vidi indikator "typing" (traje dok sesija ustaje, do oko 32 s).
3. `Sesija pokrenuta (pid ..., ...)`
4. `telegram channel: polling as @<ime bota>` (to pise sam plugin na stderr, pa upada u isti log)
5. odgovor bota u chatu, na TU poruku, bez ponavljanja i bez duplikata.

Mjerenje hladnog starta: razlika vremenskih pecata izmedju tacke 1 i odgovora u chatu.
Zapisi taj broj u evidenciju; on je pokrice za procjenu "5 do 15 s" iz ove razrade i za
odluku treba li umjesto samog `typing` ici i tekstualna poruka "samo trenutak".

### Korak 3: ponasanje bez prekidaca (kriterij 2)

Zakomentarisi ili isprazni `OLX_SESIJA_STRAZAR`, ostavi kratak idle prag, pokreni cuvara.

Ocekivano: stara log linija `Cuvar sesije: nocni restart u 3h, idle restart poslije 0.05h, ...`,
pa poslije praga `Restart sesije: 0.05h bez aktivnosti, ciscenje konteksta.`, pa nova
`Sesija pokrenuta ...`. Proces `claude` poslije praga MORA postojati. Ni jedna linija sa
rijecju `Straza` se ne smije pojaviti.

### Korak 4: nocni put (kriterij 3)

Vrati `OLX_SESIJA_STRAZAR=admin`, postavi `OLX_SESIJA_RESTART_SAT` na sljedeci puni sat i
pusti cuvara da ga docka (sesija mora mirovati 15 minuta, to je postojeca brana
`MIRNO_PRIJE_RESTARTA_MIN`).

Ocekivano: `Gasim sesiju i ulazim u strazu: nocno ciscenje konteksta.` pa ulazak u strazu.

Druga polovina istog kriterija, straza koja prespava nocni termin: ostavi klon u strazi preko
zadatog sata i provjeri da se pojavi `Nocno ciscenje odradjeno u strazi, sesija se ne dize.`
i da sesija NIJE dignuta.

### Korak 5: jutarnja cron poruka ne budi sesiju (kriterij 3)

Dok je klon u strazi, pokreni jutarnji posao rucno (isto sto radi cron u 07:20). Poruka mora
stici u grupu, a u logu cuvara se NE smije pojaviti ni jedno budjenje. Razlog je strukturni
(poslana poruka bota nije update), pa je ovo provjera da se nesto nije promijenilo mimo plana.

### Korak 6: nema 409 petlje (kriterij 4)

Poslije koraka 1 do 5: `grep -c 409 .olx-pik/cron-admin-bot.log`. Nula je ocekivano.
Jedan izolovan nalaz iz grace prozora (5 s poslije gasenja sesije) je prihvatljiv. Niz
ponovljenih 409 nije i znaci da je poller ostao ziv, sto se javlja alarmom poslije 30 minuta.

### Korak 7: rubovi

* **Vanjski zahtjev za restart u strazi.** Dok je klon u strazi:
  `echo proba > .olx-pik/restart-admin-bota`. Ocekivano u roku od 60 s:
  `Zahtjev za restart pokupljen u strazi: nema sta restartovati, svjez .env se cita pri budjenju.`
  i fajl je obrisan, a sesija se NE dize.
* **Nema tokena.** Privremeno preimenuj `.claude-runtime-admin/channels/telegram/.env` i pusti
  idle prag. Ocekivano: `Straza nije moguca: nema TELEGRAM_BOT_TOKEN u ...`, alarm adminu, i
  sesija se digne kao i bez strazar rezima. Vrati fajl nazad.
* **Prekidac po tipu.** Sa `OLX_SESIJA_STRAZAR=admin` klijentski cuvar
  (`node scripts/cuvar-sesije.mjs`) mora raditi po starom, bez ijedne linije o strazi.
* **Smece u prekidacu.** `OLX_SESIJA_STRAZAR=moze` mora dati upozorenje na stderr i ponasanje
  bez strazara.

### Kriteriji 5, 6 i 7

* Kriterij 5 (`npm test`, `npm run typecheck`, `provjeri-klon.mjs`) je provjeren na admin
  masini i ne trazi zivi bot.
* Kriterij 6 (Windows) ostaje neprovjeren u izvrsenju: straza koristi samo `fetch` i tajmere,
  bez ijednog platformskog poziva, pa je rizik nizak, ali `node --test scripts/lib/straza.test.mjs`
  i jedan prolaz koraka 1 i 2 na Windows masini su jedini pravi dokaz.
* Kriterij 7 (dokumentacija) je zatvoren u istom poslu: `.env.example`, `.claude/rules/pogon.md`,
  `olx-dokumentacija/arhitektura.md`, `CHANGELOG.md`.
