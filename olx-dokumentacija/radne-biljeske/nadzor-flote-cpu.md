# Nadzor flote i CPU po klonu: odluke

Datum: 12.08.2026. Grana: `arhitektura-manji-resursi`. Kontekst: flotni ADMIN posao
`scripts/nadzor-flote.mjs` (dnevni disk+CPU+PSI+memorija sken svih klonova, analiza svaka 3
dana) i `SHEMA_VERZIJA 2` telemetrije resursa. Ova biljeska bilezi ODLUKE za buducu referencu, ne
prepricava kod (kod je vec komentarisan na vrhu svakog fajla).

## 1. CPU po klonu: delta kumulativnog vremena, ne trenutni `%cpu`

Odluka: `scripts/lib/cpu.mjs` racuna CPU% stabla procesa klona iz DELTE kumulativnog CPU vremena
izmedju dva mjerenja (Linux: `/proc/pid/stat`, macOS: `ps -o cputime=`), nikad iz trenutnog
`%cpu` polja koje `ps` vec nudi.

Zasto: trenutni `%cpu` iz `ps` je zivotni prosjek procesa od kad je pokrenut. Klijentska sesija
koja satima miruje (strazar rezim) pa naglo pocne raditi bi sa tim poljem i dalje pokazivala
nisko %cpu jos satima poslije budjenja, jer se novi rad razvuce na sve prethodne sate mirovanja.
Pitanje na koje flotni nadzor treba odgovoriti je "ko jede procesor UPRAVO SADA", a na to
odgovara samo delta izmedju dva uzastopna mjerenja.

## 2. macOS `ps -o cputime=` ne prelama u sate iznad 1000 minuta

Zivi nalaz sa masine, nije iz dokumentacije: `ps -o cputime=` na macOS ispisuje format
`MM:SS.CC` (minute:sekunde.stotinke) i NASTAVLJA tako i kad kumulativno vrijeme predje 1000+
minuta, umjesto da prijedje na `hh:mm:ss` stil kakav se ocekuje sa GNU/Linux `ps`. Parsiranje
koje pretpostavlja fiksan broj komponenti (sati:minute:sekunde) bi na macOS-u za dugo zivu sesiju
pogresno protumacilo polje.

Provjereno da li je ovo vec zabiljezeno preko `olx_zabiljezi_saznanje` (`.olx-pik/saznanja.jsonl`
u ovom repou): fajl `.olx-pik/saznanja.jsonl` NE POSTOJI u repou, pa nalaz zasad postoji samo u
komentaru `scripts/lib/cpu.mjs` i ovdje. Odluku da li ga dodatno zabiljeziti preko MCP alata
donosi koordinator, ne ovaj worker (worker nema MCP pristup u ovoj sesiji).

## 3. Deljeni marker za pritisak na masinu

Ranija faza iste grane (`pritisak-masine.mjs`): pritisak na masinu (CPU/PSI/memorija preko
praga) se biljezi kroz jedan zajednicki marker fajl umjesto da svaki potrosac (cuvar sesije,
flotni nadzor) vodi svoje odvojeno stanje. Alternativa (svaki potrosac cita sirove uzorke i sam
racuna da li je prag pregazen) je odbacena jer bi udvostrucila logiku praga na dva mjesta i
otvorila prostor da se dva mjesta neuskladjeno ponasaju kad se prag promijeni.

## 4. SHEMA_VERZIJA 2: tolerancija na mjesovit period

`cpu_klona_pct` je novo polje u `scripts/lib/resursi.mjs` (`SHEMA_VERZIJA = 2`). Stari redovi
(sema 1, upisani prije ove grane) nemaju ovo polje uopste.

- Odsustvo polja se tretira kao `null` ("klon jos nije nadogradjen na CPU telemetriju"), NIKAD
  kao `0`. Nula bi lazno tvrdila da je klon mjeren i da je bio potpuno neaktivan.
- Agregat vraca `cpuPodaciOd`: timestamp prvog reda u periodu koji IMA CPU vrijednost, tako da
  izvjestaj moze reci "CPU prosjek racunat samo od X" umjesto da tiho izmijesa period bez
  podataka sa periodom sa podacima u istom prosjeku.

## 5. Nema Windows twin-a za `nadzor-flote.mjs` (stav koordinatora, ne odstupanje bez razloga)

`scripts/nadzor-flote.mjs` ima samo macOS launchd sablon
(`deploy/launchd/ba.codefactory.olx.ADMIN.nadzor-flote.plist`), sa Windows (`schtasks`) i Linux
(`cron`) komandama dokumentovanim TEKSTUALNO unutar komentara plist-a, ne kao aktivan zapis u
`deploy/windows/instaliraj-zadatke.ps1`.

Stav koordinatora/tehnickog vodje ove grane (prenosim kao njegovu odluku): pravilo iz
`.claude/rules/pogon.md` ("Svaki posao postoji na obje platforme... ko doda jedno bez drugog,
nije zavrsio posao") je pisano za KLIJENT poslove, gdje su klijenti na mjesovitim platformama
(macOS/Windows/Linux). ADMIN poslovi zive na JEDNOJ masini vlasnika (ova ista masina, uvijek), pa
za njih to pravilo NIKAD nije ni bilo primijenjeno u praksi: dokaz su sva cetiri postojeca ADMIN
posla (`ai-runda`, `backup-nadzor`, `saznanja`, sad i `nadzor-flote`), nijedan nema Windows
blizanca u `deploy/windows/instaliraj-zadatke.ps1`. Ovo NIJE odstupanje od pravila nego dosljedna
primjena vec uspostavljenog obrasca za ovu kategoriju posla.

Predlog za sljedeci prolaz (NE dirati `pogon.md` sada, nije dio ovog zadatka): precizirati tekst
`pogon.md` tom razlikom (KLIJENT posao vs ADMIN posao), jer pravilo koje svi postojeci primjeri
krse na isti nacin nije stvarno pravilo, nego neuskladjena dokumentacija.

## 6. `OLX_NADZOR_DIR` i izvor spiska klonova: gdje se postavljaju kad default ne odgovara

`OLX_NADZOR_DIR`, `OLX_KLIJENTI_ROOT`, `OLX_KLIJENTI_POPIS` NISU po-klon varijable (koriste se
samo na ADMIN masini kad se pokrece `nadzor-flote.mjs`, nikad u `.env` klijentskog klona), zato
se NE DODAJU u `.env.example` (bilo bi zbunjujuce za klijenta koji taj skript nikad ne pokrece).
Dokumentovane su na dva mjesta umjesto toga:

- `olx-dokumentacija/arhitektura.md`, pododjeljak 9.4: tacno ime `OLX_NADZOR_DIR` sa
  redoslijedom razrjesenja (env override > root-podfolder kad je spisak klonova iz folder-skena >
  homedir fallback `~/olx-nadzor`), i `OLX_KLIJENTI_ROOT`/`OLX_KLIJENTI_POPIS` kao izvor spiska
  klonova od kojeg razrjesenje polazi.
- Sam plist sablon (`deploy/launchd/ba.codefactory.olx.ADMIN.nadzor-flote.plist`) ima opcioni,
  zakomentarisan primjer kako se ove varijable postavljaju kad default ne odgovara, preko
  `EnvironmentVariables` kljuca:

```xml
<key>EnvironmentVariables</key>
<dict>
  <key>OLX_NADZOR_DIR</key>
  <string>/Users/admin/olx-nadzor</string>
  <key>OLX_KLIJENTI_ROOT</key>
  <string>/Users/admin/olx-klonovi</string>
</dict>
```

Bez override-a: `<root>/nadzor` kad je spisak klonova iz folder-skena (`--svi`/
`OLX_KLIJENTI_ROOT`), inace `~/olx-nadzor`.
