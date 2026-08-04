# DeepSeek kao model za Claude Code, izmjereno stanje

Grana `deepseek-testing`. Sve u ovom dokumentu je izmjereno 26.07.2026. skriptama
`npm run deepseek:proba` i `npm run kontekst`, ne pretpostavljeno. Brojevi se osvjezavaju
ponovnim pokretanjem tih skripti.

## Kako je povezano

Claude Code pokrece `dist/mcp/server.js` kao lokalni proces i govori sa njim JSON-RPC-om
preko stdija. Model u tome ne ucestvuje: Claude Code uzme popis alata sa servera i ubaci
njihove seme u API zahtjev kao obican `tools` niz, pa izvrsi `tool_use` lokalno i vrati
`tool_result`. Zato modelu treba samo obicno tool calling, a ne poznavanje MCP-a.

Recenica u DeepSeek dokumentaciji da MCP nije podrzan odnosi se na `mcp_servers` parametar
Anthropic API-ja, gdje se Anthropicovi serveri sami spajaju na udaljeni MCP server. To ovaj
repo ne koristi.

Odgodjeno ucitavanje alata (`tool_search`) je Anthropicova server-side stvar. Claude Code je
sam gasi kad `ANTHROPIC_BASE_URL` nije `api.anthropic.com`, pa na DeepSeeku svi alati idu
odmah u zahtjev. Kompatibilnost je time rijesena bez podesavanja.

## Sta radi

| Provjera | Flash | Pro |
|---|---|---|
| Obican upit | radi | radi |
| Tool calling sa tri nase seme | poziva `olx_whoami` i `olx_refresh_limits` | isto |
| Tool calling sa svih 33 seme | poziva ispravna dva alata | isto |
| Tool calling sa svih 52 seme (ponovljeno 30.07.2026.) | poziva ispravna dva alata | isto |
| `thinking: adaptive` i `cache_control` u zahtjevu | prihvaceno, ne pada | isto |
| Cijena prije troska, bez potvrde | **ne poziva nijedan alat, samo prica** | **poziva `olx_sponsor_price`** |
| Cijena prije troska (ponovljeno 30.07.2026.) | poziva samo `olx_get_listing`, cijenu ne trazi | poziva `olx_get_listing` I `olx_sponsor_price` |

Ponovljeno mjerenje 30.07.2026. sa 52 aktivne seme potvrdjuje nalaz: flash ne dodje do cijene prije
troska ni kad se pita direktno. Brana u kodu (`confirm`) stoji nezavisno od modela, ali sesija koja
ne pita za cijenu je sesija koja klijentu ne moze sama reci koliko nesto kosta.

**Odluka vlasnika 04.08.2026: default modela je ipak flash, uvijek, zbog cijene.** Fallback je u
`scripts/lib/sesija.mjs` (bez varijable bi endpoint Claude ime mapirao na pro, pa bi prazan `.env`
tiho znacio skuplji model). `OLX_DEEPSEEK_MODEL=deepseek-v4-pro` ostaje izbor PO KLIJENTU za
shopove gdje bot treba sam dolaziti do cijene izdvajanja; gornji nalaz je razlog i dalje vazi.

Imena modela: endpoint prihvata i `deepseek-v4-flash` i `deepseek-v4-pro` direktno. Mapiranje
Claude imena radi takodjer: `claude-opus-5` daje `deepseek-v4-pro`, `claude-haiku-4-5` daje
`deepseek-v4-flash`.

## Kes se dobija automatski

DeepSeek ignorise `cache_control`, ali **sam kesira ponovljeni prefiks**. Izmjereno na istom
zahtjevu poslanom dva puta:

| Model | Prvi poziv | Drugi poziv | Razlika |
|---|---|---|---|
| flash | 4993 ulaznih, 0 iz kesa, $0.000722 | 4993 ulaznih, 4992 iz kesa, $0.000048 | 15x jeftinije |
| pro | 4993 ulaznih, 0 iz kesa, $0.002287 | 4993 ulaznih, 4992 iz kesa, $0.000135 | 17x jeftinije |

Zato prica da se fiksni prefiks placa u punoj cijeni svaki potez ne vazi. Placa se prvi put,
poslije ide po cijeni kesa, koja je kod njih oko 50 puta niza od ulaza na promasaj.

Uslov je da prefiks ostane bajt u bajt isti. Sve sto ga mijenja na pocetku, na primjer datum
ili nasumican id u sistemskom promptu, obara kes za sve iza sebe.

## Cijene, stanje 26.07.2026.

Po milion tokena, izvor `api-docs.deepseek.com/quick_start/pricing`:

| Model | Ulaz, promasaj | Ulaz, kes | Izlaz | Kontekst |
|---|---|---|---|---|
| deepseek-v4-flash | $0.14 | $0.0028 | $0.28 | 1M |
| deepseek-v4-pro | $0.435 | $0.003625 | $0.87 | 1M |

Mjereno na 14 probnih poziva: prosjek $0.000513 po pozivu, sto je oko $1.54 mjesecno na 100
poteza dnevno. Isti broj ulaznih tokena na `claude-opus-5` bio bi oko $33.82 mjesecno samo
na ulazu.

## Sta stvarno kosta u sesiji, izmjereno 30.07.2026.

Mjereno na `deepseek-v4-pro` citanjem `usage` iz `result` poruke po potezu, u zivoj sesiji:

| Potez | Ulaz ukupno | Promasaj | Iz kesa | Kes |
|---|---|---|---|---|
| 1 | 39.513 | 39.513 | 0 | 0% |
| 2 | 39.526 | 102 | 39.424 | 100% |
| 3 | 39.539 | 115 | 39.424 | 100% |

Iz toga slijedi jedan zakljucak koji je suprotan intuiciji:

- **Rastuca historija je prakticno besplatna.** Od drugog poteza kes hvata sve. Novi potez je
  oko $0.0002, dakle blizu sto puta jeftinije od prvog.
- **Trosak nosi POKRETANJE sesije**, oko 34 do 40 hiljada tokena punom cijenom, oko $0.015 na
  pro i oko $0.005 na flash.
- **Nova sesija NE hvata kes** za svoj prefiks: izmjereno 0% na prvom potezu, i to i sa
  `--exclude-dynamic-system-prompt-sections` (ta zastava mijenja prefiks za samo 84 tokena, pa
  nije ono cemu se nadamo).

Prakticne posljedice:

- Duga ziva sesija je jeftinija od mnogo kratkih. Zato Telegram most drzi JEDNU sesiju, a ne
  proces po poruci.
- Nocni restart cuvara kosta jedan prefiks, dakle oko pola centa. Nije vrijedno dirati.
- Broj tokena na DeepSeek dashboardu nije mjera troska, jer se tokeni iz kesa broje a placaju
  oko 120 puta manje. Gleda se kolona troska.
- Skracivanje prefiksa vrijedi malo: od 34 do 40 hiljada tokena ovaj repo kontrolise oko 6.300
  (tabela ispod), ostalo je ugradjeni sistemski prompt Claude Code-a sa njegovim alatima.
  Gasenje grupe od 12 alata za kategorije i lokacije stedi 1.000 tokena po SESIJI, dakle pola
  centa. Optimizacija ima smisla zbog manje pogresnih izbora slabijeg modela, ne zbog cijene.
- Sto stvarno stedi: manje poteza za isti posao. Grupni alati umjesto petlje pojedinacnih
  (pravilo je u `granice.md`, sekcija Grupne radnje).

## Koliko tezi lista oglasa, izmjereno 30.07.2026.

Mjereno na pravom shopu od 120 aktivnih oglasa, kroz `kompaktList` iz `core/stats.ts`
(tokeni procijenjeni kao znakovi/3.6):

| Oblik | Znakova | Tokena |
|---|---|---|
| sirovo, `full: true` | 110.894 | 30.804 |
| kompaktno, 9 polja (default) | 22.085 | **6.135** |
| samo 4 polja za svjezinu (id, title, date, refresh_available) | 12.539 | 3.483 |
| 3 polja, bez naslova | 7.201 | 2.000 |

Po oglasu kompaktno: 184 znaka, oko 51 token. Naslovi su skupa stavka: izbacivanje naslova iz
uzeg oblika stedi 1.483 tokena na 120 oglasa.

Kompaktan oblik dakle vec skida 80% naspram sirovog. Zato **dinamicki izbor polja nije uveden**,
i to je odluka a ne propust:

- Usteda je mala: dodatnih 2.600 tokena je oko $0.001 na `pro`, i to samo prvi put, poslije ide
  iz kesa.
- Izbor polja je dodatna odluka za slabiji model. Isti model u tabeli discipline gore nije umio
  ni pozvati alat za cijenu prije troska; da mu komponuje listu polja znaci da ce zatraziti sve,
  ili zatraziti pogresan podskup pa napraviti drugi poziv.
- Promjenljiv oblik izlaza kvari sve poslije: kad alat nekad vraca `date` a nekad ne, model ne
  moze imati stabilnu naviku sta gdje gleda.

Ako uza lista ikad zatreba, ide kao **imenovani oblik** (jedan parametar sa nekoliko fiksnih
vrijednosti, npr. sazetak/svjezina/cijene), nikad kao slobodna lista polja: model tada bira
jedno ime, izlaz ostaje predvidljiv, a usteda je ista.

Kako katalog raste, lista raste linearno: 120 oglasa je 6.135 tokena, 500 bi bilo oko 25.000,
sto je skoro cijeli danasnji prefiks sesije. Tvrda granica na broj oglasa se NE uvodi, jer se
zabija u pravilo iz `SISTEM-klijent.md` da potpunost daje samo pun popis: rez bi tiho lagao o
potpunosti. Put za velik katalog je da posao ide na agregirane alate koji racunaju u kodu
(`olx_profile_stats`, `olx_mrtvi_oglasi`, `olx_listing_report`, `olx_sponsor_plan`,
`olx_account_alerts`), pa lista modelu ne ide uopste.

## Sta ide u svaki potez iz ovog repoa

| Dio | Znakova | Tokena |
|---|---|---|
| MCP seme, 33 alata | 14.211 | 3.948 |
| CLAUDE.md | 3.802 | 1.056 |
| Opisi 7 skillova | 4.602 | 1.278 |
| **Ukupno** | **22.581** | **6.273** |

Tijela skillova (37.479 znakova) i reference (51.533) se placaju samo kad se otvore. Claude
Code dodaje i svoj sistemski prompt sa ugradjenim alatima, sto ovaj repo ne kontrolise.

Najskuplji alati su `olx_create_listing` (10,7% MCP prefiksa) i `olx_update_listing` (10,1%).
Grupa od 12 alata za kategorije i lokacije zauzima 23,5% MCP prefiksa, a ti podaci postoje i
kao CSV snapshot (`olx://categories-index`, `olx://locations-index`) i mijenjaju se rijetko.

## Sta vrijedi optimizovati

Zbog automatskog kesa, smanjivanje prefiksa nije vrijedno zbog cijene. Vrijedi zbog drugog:
manje alata znaci manje pogresnih izbora slabijeg modela. Redoslijed po isplativosti:

1. **Obnove van modela.** Kvota, filtriranje i gornja granica su u kodu
   (`src/cli/index.ts`, `refresh all`). Dnevna obnova kroz crontab kosta nula tokena. Opisano
   u skillu `olx-cron-obnove`, varijanta A.
2. **Prekidac za grupu kategorija i lokacija.** 12 alata iza jednog env prekidaca u MCP
   serveru, jer u dnevnom radu trebaju rijetko. Skida cetvrtinu MCP prefiksa i suzava izbor.
3. **SEO provjere u kodu.** Duzina naslova, ponavljanje naslova, oglasi bez kljucnih rijeci,
   sve se moze izracunati u CLI-ju. Modelu ostaje samo pisanje novog naslova, ono gdje
   stvarno treba jezik.
4. **Analiza kandidata u kodu.** Dohvat profila i oglasa je mehanika. Modelu ostaje procjena.
5. **Skracivanje opisa alata.** Dva najveca alata su petina MCP prefiksa. Njihovi opisi se mogu
   stegnuti bez gubitka znacenja.

## Telegram kanal, izmjereno 29.07.2026. na claude 2.1.220

Kanal ne zavisi od modela, ali **zavisi od jedne varijable okruzenja**, i to je bio pravi
uzrok price da kanal na DeepSeeku ne radi.

Telegram plugin je obican MCP server: dolaznu poruku salje kao notifikaciju
`notifications/claude/channel`, a nju obradjuje Claude Code klijent i ubacuje je u sesiju kao
potez. Model u tome ne ucestvuje, isto kao sa MCP alatima.

### CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC gasi kanal

Izmjereno 30.07.2026., tri sesije istog trena, jedina razlika je okruzenje. Nalaz je linija iz
`--debug-file` loga koja se pojavi u prve tri sekunde starta, pa se provjera radi bez ikakve
poruke sa Telegrama:

| Okruzenje | Linija u debug logu |
|---|---|
| DeepSeek, sa `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` | `channels feature is not currently available` |
| DeepSeek, bez te varijable | `Channel notifications registered` |
| Pretplata | `Channel notifications registered` |

Kanal je eksperimentalna funkcija, a ta varijabla gasi upravo saobracaj kojim Claude Code
provjerava sta je od eksperimentalnih funkcija dostupno. Bez te provjere kanal se tiho ne
registruje: TUI ispise samo `Channels are not currently available`, poruke sa Telegrama nikad
ne dodju u sesiju, a nista ne izgleda kao greska.

Posljedica: `~/.claude/deepseek.env` (stara zsh funkcija `claude-ds`) tu varijablu ima, pa rucne
DeepSeek sesije kanal nisu mogle koristiti dok se ona ne izbaci. Pogon je nikad nije postavljao,
jer `aiPogon()` mapira samo `OLX_DEEPSEEK_*` varijable, ali je zato razlika izmedju rucnog i
pogonskog ponasanja izgledala kao da je problem u provajderu.

Rijeseno u 0.7.0: `scripts/claude-ds.mjs` mapira iste `OLX_DEEPSEEK_*` varijable kao pogon i nista
vise, pa rucna i pogonska sesija imaju isto okruzenje. Ko jos koristi stari zshrc obrazac, ima i
stari problem.

### Disciplina reply-a: izmjereno, i popravljeno u promptu

Model MORA pozvati alat `reply`. Ako samo prica, klijent ne vidi nista, jer transkript sesije
ne ide na Telegram. Ovo nije teorija, izmjereno je 30.07.2026. na istom botu, dva prolaza koji
se razlikuju samo po sistemskom promptu:

| Prolaz | Sta je model uradio |
|---|---|
| DeepSeek, bez `SISTEM-klijent.md` | poruka isporucena, pozvao `olx_whoami` i `olx_profile_stats` oba uspjesno, pa **stao bez `reply`**. Covjek na Telegramu nije dobio nista. |
| DeepSeek, sa `SISTEM-klijent.md` | `Calling MCP tool: reply` i `Tool 'reply' completed successfully`. Odgovor je stigao na telefon. |

Dakle posao je model radio ispravno i prije, samo ga nije dostavio. Instrukcije Telegram
plugina ("anything you want them to see must go through the reply tool") slabijem modelu nisu
bile dovoljne. Zato je pravilo o `reply` sada PRVA sekcija u `runtime/SISTEM-klijent.md`, prije
svih pravila o stilu: kod slabijeg modela mjesto pravila u promptu mijenja ishod.

Dvije stvari izmjerene laznim probnim kanalom:

- `--channels` prima dva oblika: `plugin:<ime>@<marketplace>` za kanale sa odobrene liste, i
  `server:<ime>` za rucno konfigurisan MCP server. Drugi oblik trazi jos i
  `--dangerously-load-development-channels`, pa je samo za razvoj.
- **Sesija bez TTY-a ne radi.** Bez terminala Claude Code prelazi u `--print` rezim i odmah
  izadje sa `Input must be provided either through stdin or as a prompt argument when using
  --print`. Isto se desi i kad je stdin cijev koja ne salje nista. Kanal se isporucuje samo u
  interaktivnoj sesiji.

Zadnja tacka je rizik za pogon: `scripts/cuvar-sesije.mjs` spawna `claude` sa `stdio: "inherit"`,
a pod launchd je stdin `/dev/null` (plist nema `StandardInPath`), dakle bez TTY-a. Na ovoj
verziji bi sesija pala u startu, cuvar bi to vidio kao brzi pad i alarmirao. Na ovoj masini se
to nikad nije pokazalo jer ovdje nijedan klijentski klon nema `.claude-runtime` ni instalirane
launchd poslove.

Razmatrana su dva izlaza. Drugi je probom ispod odbacen, pa ostaje samo prvi:

1. **Dati sesiji pty.** Node to iz jezgra ne umije (`node-pty` je nativna zavisnost, a `script`
   na macOS-u trazi da i sam ima terminal), pa je ovo skuplje nego sto izgleda. Radna
   zaobilaznica za probu je bio mali Python pty pokretac, ali Windows pty nema.
2. ~~Ne ici u interaktivni rezim nego u `-p --input-format stream-json`.~~ Takva sesija ostaje
   ziva i ne izlazi, ali kanal u njoj ne radi (izmjereno, vidi ispod).

### Izmjereno pravim botom, 30.07.2026.

Probni bot iz BotFathera, izolovan `TELEGRAM_STATE_DIR`, poruka poslana sa telefona:

- **`-p --input-format stream-json` NE isporucuje kanal u potez.** Plugin je poruku primio i
  propustio kroz kontrolu pristupa (na Telegramu se vidio typing indikator, a njega plugin
  salje neposredno prije nego posalje notifikaciju), ali sesija na nju nije reagovala i `reply`
  nije pozvan. Dakle rezim koji radi bez terminala kanal ne obradjuje.
- **Interaktivna sesija na pravom pty radi cijeli krug.** Iz debug loga
  (`--debug-file`): `Channel notifications registered`, pa `notifications/claude/channel: reci
  samo KANAL-RADI`, pa `Calling MCP tool: reply` i `Tool 'reply' completed successfully`.
  Odgovor je stigao na telefon.

Cetiri nusnalaza iz istog testa, svaki od njih moze pojesti sate:

- `/start` i `/help` su komande bota sa vlastitim handlerom u pluginu i **do sesije ne dolaze**,
  nego vrate ugradjeni tekst o uparivanju. Proba mora ici obicnom porukom, inace izgleda kao da
  kanal ne radi.
- Poruka koja nije prosla kroz kontrolu pristupa se tiho ispusta, bez ikakvog traga u sesiji.
  Kad se debugira tisina bota, prvo se gleda `access.json` u `TELEGRAM_STATE_DIR`, a ne model.
- **Sesija pokrenuta iz druge Claude Code sesije kanal ne obradjuje.** Dijete naslijedi
  `CLAUDE_CODE_SESSION_ID` i `CLAUDE_CODE_CHILD_SESSION` i vlada se kao ugnijezdjeno dijete
  (Claude Code sam javi da je cuvanje transkripta ugaseno). Prva proba je zbog toga izgledala
  kao da kanal ne radi. Ne dira pogon (launchd ne nosi te varijable), ali svako rucno testiranje
  iz Claude sesije mora ih obrisati.
- Ime alata je `mcp__plugin_telegram_telegram__reply`, ne `mcp__telegram__reply`. Krace ime u
  `--allowedTools` ne uhvati nista, pa sesija stane na potvrdu koju preko Telegrama nema ko
  kliknuti. Isto vazi za `allow` liste u settings fajlovima.

Zakljucak za pogon: interaktivna sesija je jedini rezim u kojem kanal radi, a ona trazi TTY.
Znaci `cuvar-sesije.mjs` mora dobiti pty; prelazak na stream-json nije izlaz. To je jedina
stavka iz ovog poglavlja koja je i dalje otvorena.

### Izlaz koji ne zavisi od kanala: Telegram most

`scripts/telegram-most.mjs` (`npm run most`). Umjesto da Telegram visi na zivoj interaktivnoj
sesiji, most sam vodi razgovor:

```
Telegram getUpdates -> red na disku -> ziva `claude -p` sesija (stdin) -> sendMessage
```

Sesija je JEDAN dugozivi proces u `-p --input-format stream-json` rezimu. Izmjereno 30.07.2026.
da takva sesija prima poruke kroz stdin kad god se posalju, odgovara, i pamti kontekst izmedju
poruka, sve bez terminala: poslano "zapamti broj 4731", pa 32 sekunde kasnije "koji broj sam ti
rekao", odgovor 4731. Isti transport koristi i zvanicni Agent SDK (`query()` sa `AsyncIterable`
promptom; `unstable_v2_createSession` je ukinut u 0.3.142).

Sta se time rjesava odjednom:

- nema TTY-a, dakle radi pod launchd i pod Windows Task Schedulerom
- ne zavisi ni od jedne eksperimentalne funkcije koju varijabla okruzenja moze ugasiti
- nema problema sa disciplinom `reply`: sto model napise, to covjek dobije
- nema troska pokretanja po poruci, kes prefiksa ostaje topao

Sta se gubi naspram kanala: reakcije emojijem i naknadna izmjena poslane poruke. Typing
indikator i dolazne fotografije su rijeseni rucno (fotografija pada u isti inbox koji klijentski
settings vec dozvoljavaju citati).

**Nijedna poruka se ne gubi**, i to nosi red na disku, ne transport: Telegram offset se pomjera
samo nakon sto je poruka zapisana u red, a stavka izlazi iz reda samo nakon sto je odgovor
poslan. Izmjereno: proces ubijen 10 sekundi nakon prijema poruke, poruka ostala u redu, i
odgovorena 16 sekundi nakon restarta bez ikakve ljudske radnje. Isporuka je najmanje jednom,
sto je za ovaj posao ispravan izbor: dupli odgovor je neugodan, propusten je izgubljen klijent.

Allowlist se ne duplira: most cita isti `access.json` koji pripremi skripte vec pisu.

### append-system-prompt-file NIJE aditivan. Izmjereno 30.07.2026.

Sa dva `--append-system-prompt-file` sesija vidi samo ZADNJI fajl. Provjereno markerima: prvi
marker se u odgovoru ne pojavi, drugi se pojavi.

Posljedica za pogon: profil klijenta i pamcenje se NE mogu dodati kao drugi fajl. Prompt se zato
sastavlja u jedan (`scripts/sastavi-prompt.mjs`) pri svakom startu sesije, iz tri dijela: pravila
razgovora, `KLIJENT-javno.md` i pamcenje iz `.olx-pik/pamcenje.json`.

To je ispalo bolje nego dva fajla: sesija se restartuje svaku noc, pa se pamcenje osvjezava samo
po sebi i botu ne treba nijedan poziv alata da bi znao sta je zapisano. Dokazano zivim testom na
DeepSeeku: sesija bez ijednog alata je tacno navela ton i footer koji su bili samo u pamcenju.

Uz to je vazno za kes: sastavljeni prompt je dio prefiksa koji DeepSeek kesira, a mijenja se samo
izmedju sesija, nikad usred razgovora.

### Sta je od svega ovoga bio pravi uzrok

Prica je pocela od pretpostavke da `--channels` ne radi na modelima koji nisu Anthropicovi.
Ispalo je da su u igri bila tri odvojena problema, i nijedan nije bio DeepSeek:

1. `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` u okruzenju gasi kanal bez ikakve greske.
2. Bez pravila u promptu model uradi posao ali ga ne posalje kroz `reply`.
3. Sesija bez TTY-a se ne pokrene, pa pogon pod launchd treba pty.

Kad se prva dva srede, DeepSeek vozi Telegram kanal cijelim krugom. Alternativni Telegram most
se ne pise.

### Skripta za ponavljanje testa

Oba pitanja rjesava jedan test, i za njega postoji skripta. Trazi PROBNI bot iz BotFathera,
nikad klijentov, jer dva pollera na istom tokenu daju 409 i obaraju ziv bot:

```
( set -a; . ~/.claude/deepseek.env; set +a; npm run kanal:proba -- <bot_token> <telegram_id> )
```

Skripta pokrene sesiju u `-p --input-format stream-json` rezimu, dakle bez terminala, sa
izolovanim `TELEGRAM_STATE_DIR` pod `.olx-pik/`, i javi dvije stvari odvojeno: da li je dolazna
poruka stigla do sesije i da li je sesija pozvala `reply`. Bez pogona u okruzenju istu skriptu
pokrenutu golu mjeri pretplatu, sto je koristan kontrolni prolaz.

## Granice koje ostaju

- Podaci klijenata idu na DeepSeek servere. Racunati na to kod obecanja diskrecije.
- Slike i dokumenti se ignorisu na tom endpointu. Zaobilaznica za pogon: vision proxy alat
  `olx_opisi_sliku` (`src/core/vid.ts`) opise sliku jeftinim vision modelom, pa DeepSeek sesija
  nastavi sa tekstom. Iskljucivo Gemini (odluka vlasnika 04.08.2026; Anthropic varijanta
  postojala do v0.12.1): `gemini-3.1-flash-lite`, oko $0.0007 po slici (izmjereno 1147
  ulaznih, 294 izlazna tokena), na ISTOM kljucu kao generisanje slika (`OLX_SLIKA_API_KEY`).

  Gemini je izabran jer generisanje slika (`olx_generiraj_sliku`) svakako trazi Gemini kljuc,
  pa jedan adapter (`src/core/gemini.ts`) pokriva oba posla, i fotografije klijenta idu samo
  jednom vanjskom servisu umjesto dvama. Oba imena modela su provjerena
  pozivom `/v1beta/models` 30.07.2026.

### Generisanje slike: cijena i sta je u njoj

Izmjereno 30.07.2026. na `gemini-3.1-flash-lite-image`, brojevi su iz `usageMetadata`:

| Poziv | Ulaz | Izlaz |
|---|---|---|
| bez ulazne slike | 18 (tekst) | 1403 |
| jedna ulazna slika | 1138 (18 tekst + 1120 slika) | 1355 |
| dvije ulazne slike | 2258 (18 tekst + 2240 slika) | 1373 |

**Zamka u cjenovniku:** izlaz ima DVIJE stope, `$1.50 (text and thinking)` i `$30.00 (images)`.
Ko uzme tekstualnu, promasi oko 18 puta. Prava cijena:

- izlazna slika 4:3, oko 1370 tokena po $30/M, dakle **oko $0.041 po slici**
- ulazna slika klijenta, 1120 tokena po $0.25/M, dakle $0.00028; dvije slike $0.00056

Znaci klijentove fotografije su prakticno besplatne i broj ulaznih slika ne mijenja cijenu;
cijelu cijenu nosi generisanje. Zato je `OLX_SLIKA_MAX_DNEVNO` default 10, sto je oko $12
mjesecno u najgorem slucaju.

Jeftinije od ovoga postoji samo `imagen-4.0-fast-generate-001` po $0.02, ali on ne prima ulaznu
sliku, pa ne moze posao "prepravi ovu moju fotografiju". Medju modelima koji primaju sliku ovaj
je najjeftiniji: `gemini-2.5-flash-image` $0.039, `gemini-3.1-flash-image` $0.067,
`gemini-3-pro-image` $0.134 (sve na 1K).

Batch cijena je pola ($15/M, oko $0.017 po slici), ali batch je asinhron i ne moze u razgovor
na Telegramu.

### Model sliku PRECRTAVA, ne retusira. Izmjereno 30.07.2026.

Ovo je najvazniji nalaz o generisanju slika i mijenja gdje se alat smije koristiti.

Proba na dvije vrste ulaza, istim receptom `proizvod-bijela`:

| Ulaz | Rezultat |
|---|---|
| jedan jednostavan predmet (solja) | odlicno: cista bijela pozadina, meka sjena, predmet vjeran |
| stvarna slika sa oglasa: paleta od ~30 party artikala sa brendiranim pakovanjima | **neupotrebljivo**: raspored artikala promijenjen, neki nestali, natpisi na pakovanjima izmisljeni i necitljivi |

Uzrok je u prirodi modela: on ne mijenja piksele postojece slike nego crta novu sliku po njoj.
Na jednom predmetu to je nevidljivo, na slozenoj fotografiji izmislja sve cega se ne moze
"sjetiti", a to su upravo natpisi i broj artikala. Takva slika laze kupca o tome sta dobija.

Dva uzroka su bila u nasoj kontroli i ispravljena su 30.07.2026.:

- **Odnos strana se uzimao fiksno 4:3.** Kartica oglasa je lezeca, pa je 4:3 izgledao kao dobar
  default, ali na PORTRETNOJ ulaznoj slici prisili model da prekomponuje raspored: artikal se
  skupi i ostane bijela praznina lijevo i desno. Sada se odnos cita iz dimenzija ulazne slike
  (`dimenzijeSlike` cita JPEG SOF i PNG IHDR bez zavisnosti, `najbliziOdnos` bira iz podrzanog
  popisa). Izmjereno: original 585x800 daje 3:4 i izlaz 896x1200.
- **Recepti nisu trazili da artikal ispuni kadar.** "centred and fully visible" to ne pokriva:
  predmet moze biti centriran i cijeli, a zauzimati trecinu kadra. Sada svaki recept nosi izricito
  da subjekt ispunjava kadar do ivica sa malom ravnomjernom marginom.

Pravila koja iz toga slijede:

- Alat je za JEDAN prepoznatljiv predmet (jedan artikal, jedno vozilo), ne za palete, komplete
  ni police.
- Korisnik UVIJEK uporedi staru i novu sliku prije objave. Ovo se ne moze automatizovati, jer
  jedini koji zna sta je na slici je onaj koji je artikal drzao u ruci.
- Masovni prolaz kroz postojeci katalog se NE radi. I bez pitanja tacnosti, 120 oglasa je oko
  $5 i 12 dana pri dnevnom plafonu, ali glavni razlog je da bi dio slika tiho postao netacan.

### Sta API dopusta oko slika, izmjereno 30.07.2026.

Za tok "uzmi staru sliku sa oglasa, obradi je, vrati na oglas" tri koraka rade, cetvrti ne:

| Korak | Stanje |
|---|---|
| citanje starih slika | radi: pun oglas ima `images` kao niz URL-ova |
| obrada kroz Gemini | radi: `olx_generiraj_sliku` prima i URL, sam ga skine (`skiniUlaznuSliku`) |
| upload nove slike | radi: `olx_upload_images` sa `urls` ili `file_paths` |
| brisanje starih slika | **ne moze** |

Zasto ne moze: `image-delete` i `image-main` traze `imageId` u tijelu, a **nema GET endpointa
koji vraca slike sa ID-evima**. Pun oglas daje samo URL-ove (`images`) i prazan `images_old`.
`imageId` se dobija ISKLJUCIVO kao povratna vrijednost uploada. Znaci za slike koje je klijent
sam dodao kroz aplikaciju mi nemamo ID, pa ih ne mozemo ni obrisati ni postaviti kao glavnu.

Posljedica je dobra: umjesto brisanja, nova slika se doda i postavi kao glavna (njen ID imamo),
a originalna fotografija ostaje na oglasu kao druga po redu. Kupac tako i dalje vidi pravu
fotografiju artikla, a cista slika nosi karticu na kojoj se klika. Brisanje starih, ako ga
klijent zeli, radi on sam u aplikaciji.
- Vazno uz to: instrukcije Telegram plugina same govore sesiji da procita fajl slike, a to na
  ovom endpointu obara potez. Zato je pravilo o slikama tvrda granica u `granice.md`, ne
  preporuka u skillu (skill se u klijentskoj sesiji i ne otvara, `Skill` je tamo zabranjen).
- Flash u testu discipline nije pozvao nijedan alat na zahtjev za izdvajanje, samo je pricao.
  Pro je pozvao `olx_sponsor_price`, sto je ispravan prvi korak. Za radnje koje trose kredite
  koristiti pro, ili ostaviti na Claudeu.
- Zastita je u harnessu, ne u promptu: `ask` pravilo u `.claude/settings.json` trazi rucnu
  potvrdu za `olx_sponsor_listing` i `olx_set_discount` bez obzira koji model vozi sesiju.
- Anthropic ne podrzava rutiranje Claude Code-a na modele koji nisu Claude. Radi, ali bez
  podrske.

## Kako se mjeri ponovo

```
npm run kontekst          # sta ide u svaki potez i koliko to kosta
npm run deepseek:proba    # provjera endpointa i oba modela, pise u dnevnik
npm run ai:usage          # zbirna potrosnja po modelu, zadatku i danu
npm run ai:usage -- --dan 2026-07-26
```

Dnevnik je `.olx-pik/ai-usage.jsonl`, jedan red po pozivu, samo brojevi bez sadrzaja poruka.
Fajl je van gita.

## Pokretanje na DeepSeeku

**Zshrc obrazac nije vise mjerodavan ni za pogon ni za rucni rad.** Pogon bira provajdera kroz
`OLX_KLIJENT_AI` i `OLX_DEEPSEEK_*` varijable u `.env` klona (vidi `.env.example`), a od 0.7.0 isto
radi i rucna sesija kroz `scripts/claude-ds.mjs`. Sva konfiguracija je u repou i radi isto na
macOS-u i Windowsu. Zsh funkcija `claude-ds` iz `~/.zshrc` je bila upravo ono sto CLAUDE.md
zabranjuje (globalno po masini), pa je na Windowsu i nije bilo.

Provajder se za rucni rad bira komandom, ne globalnim podesavanjem:

| Komanda | Sta radi |
|---|---|
| `claude` | Anthropic na pretplati. Default, nista se ne mijenja. |
| `node scripts/claude-ds.mjs` | DeepSeek, gola razvojna sesija (globalni `~/.claude`). Varijable vaze samo unutar tog procesa. Radi na obje platforme. |
| `node scripts/pokreni-klijenta.mjs` | Rucna KLIJENTSKA sesija: runtime klona, Telegram kanal, i DeepSeek kad je `OLX_KLIJENT_AI=deepseek` (mapiranje kroz `scripts/lib/sesija.mjs`). Radi na obje platforme. |
| `node scripts/claude-ds.mjs --env` | Ispise podesavanja bez pokretanja sesije, za provjeru. Token se ne ispisuje. |
| `npm run deepseek:proba` | Provjeri endpoint i tool calling bez pokretanja sesije. Cita isti `.env`. |

Kljuc i podesavanja idu u `.env` klona (`OLX_DEEPSEEK_AUTH_TOKEN`, `OLX_DEEPSEEK_BASE_URL`), dakle
na isto mjesto odakle ih cita pogon klijentske sesije. Stari `~/.claude/deepseek.env` proba jos
prihvata kao ispomoc, ali novo se tamo ne podesava. Varijable koje se salju Claudeu su one iz
zvanicne DeepSeek dokumentacije:
`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `API_TIMEOUT_MS`, `ANTHROPIC_MODEL`, uz
`ANTHROPIC_DEFAULT_HAIKU_MODEL` za pozadinske radnje i `ANTHROPIC_CUSTOM_MODEL_OPTION`
za pro u `/model` biracu.

Zasto okruzenje djeteta a ne globalni `export`: postavljen `ANTHROPIC_AUTH_TOKEN` u okruzenju
terminala preuzima **svaku** narednu `claude` sesiju, u svakom projektu, i pretplata se
tada ne koristi. Zato obje skripte varijable postavljaju samo procesu koji pokrenu
(`okruzenjeSesije` u `scripts/lib/sesija.mjs`, isti obrazac u `claude-ds.mjs`), a u shell ne
exportuju nista.

Detalji koji su se pokazali u radu:

- Pro se bira sa `/model` unutar DeepSeek sesije. Za radnje koje trose kredite koristiti
  pro, zbog nalaza iz tabele gore.
- U `/model` biracu birati DeepSeek imena. Ako se izabere Claude ime, DeepSeek ga tiho
  mapira (`claude-opus-5` daje `deepseek-v4-pro`), pa prikaz i stvarnost nisu isto.
- `deepseek-chat` i `deepseek-reasoner` jos rade, ali oba vracaju `deepseek-v4-flash` i
  imaju objavljen datum ukidanja, pa se koriste prava imena modela.
- `ANTHROPIC_SMALL_FAST_MODEL` je zamijenjen sa `ANTHROPIC_DEFAULT_HAIKU_MODEL`, prvi je
  oznacen kao zastario u Claude Code dokumentaciji.
- Ako su istovremeno postavljeni `ANTHROPIC_AUTH_TOKEN` i `ANTHROPIC_API_KEY`, API odbija
  zahtjev. Zato pogon brise `ANTHROPIC_API_KEY` iz okruzenja djeteta (`aiPogon` u
  `scripts/lib/sesija.mjs`, polje `obrisi`; isto radi i `claude-ds.mjs`).
- Pravilo STAROG puta, vrijedi samo za zaostali `~/.claude/deepseek.env`: vrijednosti sa
  razmakom tamo moraju u navodnike, jer shell taj fajl sourca. Za `.env` klona to NE vazi,
  njega parsira Node (`loadEnvFile`), bez navodnika.
