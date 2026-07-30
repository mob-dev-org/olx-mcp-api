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
| `thinking: adaptive` i `cache_control` u zahtjevu | prihvaceno, ne pada | isto |
| Cijena prije troska, bez potvrde | **ne poziva nijedan alat, samo prica** | **poziva `olx_sponsor_price`** |

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

Posljedica: `~/.claude/deepseek.env` (licna komanda `claude-ds`) tu varijablu ima, pa rucne
DeepSeek sesije kanal ne mogu koristiti dok se ona ne izbaci. Pogon je nikad nije postavljao,
jer `aiPogon()` mapira samo `OLX_DEEPSEEK_*` varijable, ali je zato razlika izmedju rucnog i
pogonskog ponasanja izgledala kao da je problem u provajderu.

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
  nastavi sa tekstom. Dva provajdera, `OLX_VID_PROVAJDER`:

  | Provajder | Model | Po slici | Napomena |
  |---|---|---|---|
  | anthropic (default) | claude-haiku-4-5 | oko $0.003 | trazi vlastiti Anthropic kljuc |
  | gemini | gemini-3.1-flash-lite | oko $0.0007 (izmjereno 1147 ulaznih, 294 izlazna tokena) | koristi ISTI kljuc kao generisanje slika |

  Gemini je izabran kao preporuka jer generisanje slika (`olx_generiraj_sliku`) svakako trazi
  Gemini kljuc, pa jedan adapter (`src/core/gemini.ts`) pokriva oba posla, i fotografije
  klijenta idu samo jednom vanjskom servisu umjesto dvama. Oba imena modela su provjerena
  pozivom `/v1beta/models` 30.07.2026.
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

**Za POGON (klijentska sesija) ovaj zshrc obrazac vise nije mjerodavan:** pogon bira provajdera
kroz `OLX_KLIJENT_AI` i `OLX_DEEPSEEK_*` varijable u `.env` klona (vidi `.env.example`), pa je
sva konfiguracija u repou i radi isto na macOS-u i Windowsu. `claude-ds` iz `~/.zshrc` ostaje
samo kao licna komanda za rucni rad u terminalu, ako je vec podesena.

Provajder se za rucni rad bira komandom, ne globalnim podesavanjem:

| Komanda | Sta radi |
|---|---|
| `claude` | Anthropic na pretplati. Default, nista se ne mijenja. |
| `claude-ds` | DeepSeek. Varijable vaze samo unutar te komande. |
| `claude-ds --env` | Ispise podesavanja bez pokretanja sesije, za provjeru. |

Funkcija `claude-ds` je u `~/.zshrc`, a podesavanja i kljuc u `~/.claude/deepseek.env`
(prava 600, van repoa i van gita). Varijable su one iz zvanicne DeepSeek dokumentacije:
`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `API_TIMEOUT_MS`, `ANTHROPIC_MODEL`, uz
`ANTHROPIC_DEFAULT_HAIKU_MODEL` za pozadinske radnje i `ANTHROPIC_CUSTOM_MODEL_OPTION`
za pro u `/model` biracu.

Zasto podshell a ne globalni `export`: postavljen `ANTHROPIC_AUTH_TOKEN` u okruzenju
terminala preuzima **svaku** narednu `claude` sesiju, u svakom projektu, i pretplata se
tada ne koristi. Podshell to drzi unutar jedne komande.

Detalji koji su se pokazali u radu:

- Pro se bira sa `/model` unutar `claude-ds` sesije. Za radnje koje trose kredite koristiti
  pro, zbog nalaza iz tabele gore.
- U `/model` biracu birati DeepSeek imena. Ako se izabere Claude ime, DeepSeek ga tiho
  mapira (`claude-opus-5` daje `deepseek-v4-pro`), pa prikaz i stvarnost nisu isto.
- `deepseek-chat` i `deepseek-reasoner` jos rade, ali oba vracaju `deepseek-v4-flash` i
  imaju objavljen datum ukidanja, pa se koriste prava imena modela.
- `ANTHROPIC_SMALL_FAST_MODEL` je zamijenjen sa `ANTHROPIC_DEFAULT_HAIKU_MODEL`, prvi je
  oznacen kao zastario u Claude Code dokumentaciji.
- Ako su istovremeno postavljeni `ANTHROPIC_AUTH_TOKEN` i `ANTHROPIC_API_KEY`, API odbija
  zahtjev. Funkcija zato radi `unset ANTHROPIC_API_KEY` prije pokretanja.
- Vrijednosti sa razmakom u `deepseek.env` moraju biti u navodnicima, jer shell taj fajl
  sourca, ne parsira kao dotenv.
