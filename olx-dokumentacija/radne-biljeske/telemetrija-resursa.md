# Telemetrija resursa pogona (radna biljeska, 12.08.2026)

*Historijski zapis. Strazar rezim je penzionisan zajedno sa `cuvar-sesije.mjs`; vazece stanje
otiska resursa je u `olx-dokumentacija/arhitektura.md`, sekcija 9.*

Zasto postoji: vise klonova (jedan klon = jedan klijent) zivi na istoj masini, danas macOS laptop, u
planu Linux, moguce i Windows. Vlasnik flote treba znati koliko mu koji klijent trosi i sta se moze
poboljsati, a da za to ne pamti razlicite sistemske komande po platformi.

Ova biljeska je zapis odluka i stanja rada. Korisnicka dokumentacija varijabli ide u `.env.example`
(sekcija CUVAR SESIJE), a sta je uslo u izdanje u `CHANGELOG.md`.

Slike: <https://claude.ai/code/artifact/741fa916-9b97-4308-956d-eb5309bdf112> (sest dijagrama,
trakovi potrosnje, dan klijenta, hladni start). Izvor stranice stoji uz ovu biljesku
(`strazar-telemetrija-stranica.html`), pa se stranica moze ponovo objaviti iz repoa. Isti dijagrami
u tekstualnom obliku su u `olx-dokumentacija/arhitektura.md`, sekcija 9.

## Odluka: uzorkuje cuvar sesije, ne novi posao

Razmatrane tri opcije:

- **Cuvar sesije uzorkuje (izabrano).** Cuvar se ionako budi svakih 60 s, i jedini pouzdano zna PID
  sesije koju je sam pokrenuo. Nema novog zakazanog posla, nema novog deploy fajla, radi na sve tri
  platforme kroz Node. Jedini koji moze izmjeriti hladni start, jer zna i trenutak budjenja i
  trenutak kad je sesija progovorila.
- **Zaseban masinski sampler.** Centralan pogled, ali traži scheduler na tri platforme (launchd,
  schtasks, systemd kojeg repo jos nema) i prepoznavanje tudjih procesa po cwd ili komandnoj liniji,
  sto je na Windowsu krhko. Vise posla za istu analitiku.
- **Gotov alat (netdata, Prometheus + Grafana).** Bogatiji grafovi, ali server i konfiguracija po
  masini, i nista od toga ne zna sta je klon, sta straza, sta hladni start.

## Sta se mjeri i kako

- **RSS stabla sesije jednim pozivom.** Cuvar zna PID sesije, ali NE zna PID MCP servera (dijete
  sesije) ni bun pollera. Zato se po uzorku povlaci cijela procesna tabela sa pid/ppid/rss
  (`ps -axo pid=,ppid=,rss=,comm=` na macOS i Linux, `Get-CimInstance Win32_Process` na Windows), pa
  cista funkcija (`zbirStabla`) sabira sesiju i sve potomke. Time MCP i bun ulaze u mjerenje bez
  ikakvog PID trackinga i bez dodatnih poziva.
- **Slobodna memorija masine po platformi.** Sirovi `os.freemem()` na Linuxu i macOS-u sistematski
  potcjenjuje dostupnu memoriju jer ne racuna reklamabilni disk kes, pa: Linux `MemAvailable` iz
  `/proc/meminfo`, macOS `vm_stat` (free + inactive stranice), Windows `os.freemem()` (tamo je taj
  broj vec smislen). Ukupna memorija svuda `os.totalmem()`.
- **Swap.** Linux `/proc/meminfo` (`SwapTotal`, `SwapFree`), macOS `sysctl -n vm.swapusage`, Windows
  `Win32_PageFileUsage`.
- **Load.** `os.loadavg()` na macOS i Linux. Na Windowsu Node uvijek vraca `[0,0,0]`, pa se upisuje
  `null`, nikad lazna nula.
- Svako polje je NEZAVISNO best effort: jedna sonda koja padne daje `null` u svom polju i ne rusi
  ostatak uzorka. Svi vanjski pozivi idu kroz `execFile` sa rokom, nikad sinhrono, da subproces koji
  zapne ne blokira petlju cuvara.

## Dva intervala, i zasto je to vazno za izvjestaj

- `OLX_RESURSI_INTERVAL_MIN`, default 5 min, vrijedi dok je sesija ziva. Jedan interval od 15 min
  prerijedak je da uhvati peak sesije koja zivi 20 minuta.
- `OLX_RESURSI_INTERVAL_STRAZA_MIN`, default 30 min, vrijedi dok sesija spava a cuvar strazari. Tamo
  je RSS ravan, cesto uzorkovanje je bacanje.
- Prva varijabla prazna ili 0 iskljucuje telemetriju u cjelini.

Posljedica koja se lako promasi: kad interval nije konstantan, **procenat vremena u strazi se ne
smije racunati iz udjela uzoraka** (bio bi sistematski pogresan, a to je bas broj zbog kojeg se ovo
i gleda). Zato:

- svaki red nosi `interval_min` koji je bio na snazi, pa agregacija sabira vrijeme po stanju
  tezinski;
- primarni izvor za vrijeme u strazi su DOGADJAJI: par `gasenje-straze` pa `budjenje` daje tacno
  trajanje sna. Udio uzoraka ostaje samo rezerva kad par nije zatvoren (straza u toku na kraju
  perioda, ili je cuvar restartovan usred sna). Izvjestaj kaze kojim putem je broj dobijen.

## Zapis na disku

`.olx-pik/resursi/resursi-YYYY-MM.jsonl`, jedan fajl po mjesecu, direktorij se moze pomjeriti kroz
`OLX_RESURSI_DIR`. Isti obrazac kao snapshoti pregleda: `izvjestaj --dana N` cita samo fajlove koji
dodiruju period, a brisanje starog mjeseca je brisanje fajla, ne rezanje sadrzaja. Uz uzorak na 5
minuta jedan mjesec je red velicine par MB. Ciscenje starijeg od 12 mjeseci ide u nocnom ciklusu
cuvara, uz postojece ciscenje inboxa i logova.

Red nosi: vrijeme, tip sesije, ime klona, verziju koda, `interval_min`, stanje (`sesija_ziva`,
`u_strazi`), RSS cuvara, RSS i broj procesa stabla, masinske brojke (ukupno, slobodno, swap, load), i
kod dogadjaja polja dogadjaja (`dogadjaj`, izlazni kod i signal, trajanje sesije, `hladni_start_ms`,
razlog).

Odluke o tome sta NE ulazi:

- Imena tudjih procesa se ne pisu na disk. Procesna tabela se cita u memoriji, u fajl idu samo
  agregirani brojevi.
- Nikakav token ni tajna, nigdje. Fajl ide na CRNI spisak backupa stanja (telemetrija je masinska i
  prolazna, klijentu ne treba).
- Pun uzorak se uzima na periodicnom uzorku i na dogadjaju `gasenje-straze` (to je jedini trenutak
  koji daje broj "koliko je trosio dok je bio budan, neposredno prije nego je legao", dakle glavni
  dokaz koristi strazara). Na pad, `cuvar-gasenje` i SIGINT/SIGTERM upisuje se samo sinhroni RSS
  cuvara: tamo subproces poziv usporava bas trenutak koji ne smije kasniti.

## Hladni start

Mjeri se u strazar rezimu: trenutak kad `strazi()` vrati `probudi`, pa se ceka prvi upis u transkript
sesije (postojeca `najnovijiMtime` logika, korak 500 ms, krov 60 s). Na pogodak se upise
`hladni_start_ms`, na istek roka ostaje `null`. To je aproksimacija (prvi upis u transkript nije
strogo isto kao "MCP i plugin su gotovi"), dovoljna za trend, nije precizno mjerenje.

## Razmicanje uzoraka medju klonovima

Deset klonova koji krenu u istoj sekundi daju deset istovremenih `ps` poziva svakih N minuta. Zato
pomak po klonu iz hasha putanje klona (FNV-1a), a ne `Math.random`: pomak mora biti stabilan kroz
restarte, inace se raspored svaki put mijenja.

## Granica koju treba znati pri citanju brojeva

RSS duplo broji dijeljene biblioteke, pa je zbir stabla **gornja granica**, ne tacan otisak. Mjera
koja odlucuje da li je masini tesko su slobodna memorija i swap. Zato savjeti u izvjestaju nikad ne
prijavljuju moguce curenje na osnovu samog rasta RSS-a bez pritiska na masinu.

## Komande za coveka

- `node scripts/resursi.mjs pregled [--svi <root>]` — trenutno stanje ovog klona, ili svih klonova u
  folderu uz zbir.
- `node scripts/resursi.mjs izvjestaj [--dana N] [--svi <root>]` — prosjek i peak po klijentu, vrijeme
  u strazi naspram aktivnog, broj i trajanje hladnih startova, trend memorije i swapa masine, plus
  sekcija sta poboljsati.
- `node scripts/resursi.mjs dijagnostika` — sta je vratila svaka platformska sonda. Postoji jer se
  Linux i Windows putevi ne mogu provjeriti sa macOS-a: na prvom takvom klonu jedna komanda kaze da
  li sve sonde rade.

## Stanje rada

Grana `arhitektura-manji-resursi`.

- **Gotovo:** `scripts/lib/resursi.mjs` + `scripts/lib/resursi.test.mjs` (commit 78842da). Testovi
  471 prolaz, 0 padova (prije 404, dakle 67 novih). Sve parsiranje, sabiranje stabla, agregacija i
  vrijeme u strazi su ciste funkcije sa ubrizganim zavisnostima, po uzoru na `scripts/lib/straza.mjs`.
- **Ostaje:** uvezivanje u `scripts/cuvar-sesije.mjs` (uzorkovanje i dogadjaji), `scripts/resursi.mjs`
  CLI, crni spisak u `src/core/backup-spisak.ts`, blok u `.env.example`, stavka u `CHANGELOG.md`.
- **Otvoreno:** Windows sonde (`Get-CimInstance`, `Win32_PageFileUsage`) pisane su po analogiji na
  vec provjerene pozive u pogonu, ali nisu pokrenute na pravoj Windows masini. Provjera je jedna
  komanda `dijagnostika` na prvom Windows klonu. Isto vazi za Linux `/proc` puteve.
- Uz ovo ide i prepolovljen prag mirovanja (commit 227b284): klijentska sesija 1 h, admin bot 30 min.
  Telemetrija je nacin da se izmjeri je li to pogodjeno ili treba jos nize.
