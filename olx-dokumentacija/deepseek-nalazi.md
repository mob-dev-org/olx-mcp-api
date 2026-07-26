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

## Granice koje ostaju

- Podaci klijenata idu na DeepSeek servere. Racunati na to kod obecanja diskrecije.
- Slike i dokumenti se ignorisu na tom endpointu.
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

Konfiguracija je globalna, u `~/.zshrc`, po zvanicnoj DeepSeek dokumentaciji:

```
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_AUTH_TOKEN=<kljuc>
export API_TIMEOUT_MS=600000
export ANTHROPIC_MODEL=deepseek-v4-flash
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export ANTHROPIC_CUSTOM_MODEL_OPTION=deepseek-v4-pro
```

Posljedice koje treba imati na umu:

- Vazi za **svaku** `claude` sesiju na masini, ne samo za ovaj repo. Pretplata se ne koristi
  dok su te varijable postavljene. Za povratak na Claude: zakomentarisati blok i otvoriti
  novi terminal.
- Pro se bira sa `/model` unutar sesije. Za radnje koje trose kredite koristiti pro, zbog
  nalaza iz tabele gore.
- `deepseek-chat` iz starije dokumentacije jos radi, ali vraca `deepseek-v4-flash` i ima
  objavljen datum ukidanja, pa se koristi pravo ime modela.
- `ANTHROPIC_SMALL_FAST_MODEL` je zamijenjen sa `ANTHROPIC_DEFAULT_HAIKU_MODEL`, prvi je
  oznacen kao zastario u Claude Code dokumentaciji.
- Ako su istovremeno postavljeni `ANTHROPIC_AUTH_TOKEN` i `ANTHROPIC_API_KEY`, API odbija
  zahtjev. Zato ne drzati kljuc na dva mjesta.
