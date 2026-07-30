#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { OlxClient, OlxSpendError, OlxApiError, naknadaKategorije } from "../core/index.js";
import { loadConfig } from "../core/config.js";
import { withAuditContext } from "../core/audit.js";
import { parseSponsorOptions } from "../core/sponsor-options.js";
import {
  efekatIzdvajanja,
  izracunajNoveCijene,
  kompaktCsv,
  kompaktList,
  kompaktListing,
  mrtviOglasi,
  provjeriNacrt,
  type OglasPregledi,
} from "../core/stats.js";
import { onboardingMarkdown, onboardingTelegram } from "../core/izvjestaj.js";
import { ucitajSnapshote } from "../core/snapshoti.js";
import { nadjiPoUpitu } from "../core/match.js";
import { PLAN_FILE, upisiPlan, zauzmiKljuc } from "../core/plan-fajl.js";
import { buildPlan, planSazetak, type PlanKandidat } from "../core/plan.js";
import { opisiSliku, vidKonfigurisan } from "../core/vid.js";
import { OPSEZI, bezSklonjenog, odvojiIzuzete, saDodatim, spisak, ucitajIzuzeca, upisiIzuzeca } from "../core/izuzeca.js";
import { ODNOSI, RECEPTI, ZADANI_ODNOS, generisiSliku, maxDnevno, slikaKonfigurisana, type Odnos } from "../core/slika.js";
import { brojPozivaDanas } from "../core/ai-dnevnik.js";

// Ucitaj .env ako postoji (Node 20.12+), da OLX_TOKEN bude dostupan i kad server pokrene MCP
// klijent. Prvo iz radnog direktorija; ako ga tamo nema, iz korijena klona kojem pripada OVAJ
// build, da server radi i kad ga klijent pokrene sa drugim cwd. Token ostaje u .env (gitignore).
try {
  const loadEnv = (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  const korijenskiEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
  if (existsSync(".env")) loadEnv?.(".env");
  else if (existsSync(korijenskiEnv)) loadEnv?.(korijenskiEnv);
} catch {
  // .env nije obavezan
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_PATH = resolve(__dirname, "../../olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md");
const PRAVILA_BROJEVA_PATH = resolve(__dirname, "../../olx-dokumentacija/pravila-brojeva.md");
const CATEGORIES_PATH = resolve(__dirname, "../../olx-dokumentacija/categories.json");
const CATEGORIES_CSV_PATH = resolve(__dirname, "../../olx-dokumentacija/categories.csv");
const LOCATIONS_PATH = resolve(__dirname, "../../olx-dokumentacija/locations.json");
const LOCATIONS_CSV_PATH = resolve(__dirname, "../../olx-dokumentacija/locations.csv");
const POMOC_DIR = resolve(__dirname, "../../olx-dokumentacija/PIK-pomoc-korpus");
const POMOC_INDEX_PATH = resolve(POMOC_DIR, "index.csv");
const POMOC_CLANCI_DIR = resolve(POMOC_DIR, "clanci");

// Jedan klon repozitorija radi za jedan nalog: token dolazi iz OLX_TOKEN u .env ovog klona.
// Za drugog klijenta se klonira repo. Zato nema alata za promjenu naloga i nema mutabilnog
// stanja: nemoguce je da radnja tiho zavrsi na pogresnom klijentu.
const config = loadConfig();
const client = new OlxClient(config);

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

// Kompaktan stringify bez indentacije: pretty-print na velikim listama znacajno napuhava broj
// tokena. structuredContent se namjerno NE salje, jer bi dupliralo cijeli payload u odgovoru
// (alati ne deklarisu outputSchema, pa polje nije obavezno).
function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return { content: [{ type: "text", text }] };
}

function errResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// Zajednicki wrapper: osigurava auth i pretvara greske u citljiv rezultat.
async function run(fn: (c: OlxClient) => Promise<unknown>): Promise<ToolResult> {
  try {
    await client.ensureAuth();
    return ok(await fn(client));
  } catch (e) {
    if (e instanceof OlxSpendError) {
      const detail = e.price ? `\n${JSON.stringify(e.price, null, 2)}` : "";
      return errResult(`${e.message}${detail}\nPozovi ponovo sa confirm: true da bi se kredit naplatio.`);
    }
    if (e instanceof OlxApiError) {
      // Prikazi tijelo odgovora (npr. 422 validacija po poljima) da se vidi sta tacno fali.
      const detail = e.body !== undefined ? `\n${JSON.stringify(e.body, null, 2)}` : "";
      return errResult(`${e.message}${detail}`);
    }
    return errResult(String(e instanceof Error ? e.message : e));
  }
}

const server = new McpServer({ name: "olx-pik-mcp-server", version: "0.1.0" });

// Svaki alat se izvrsava unutar audit konteksta sa svojim imenom, da zapis u audit logu kaze
// koja je radnja pokrenula poziv. Omotano je na jednom mjestu, pa registracije alata nize ostaju
// obicni registerTool pozivi (i cuvaju tipove svojih shema). Kontekst ide kroz AsyncLocalStorage,
// pa se dva preklopljena poziva alata ne mogu pomijesati.
//
// Isti wrapper nosi i filter profila. Alati iz SAMO_ADMIN se u profilu `klijent` uopste ne
// registruju, pa njihove seme ne ulaze u kontekst. To su redom pretraga i dumpovi kategorija,
// brendova, modela i lokacija: najveci payloadi u serveru, a klijentu ne trebaju jer lokacija
// dolazi iz .env, a kategoriju bira `olx_suggest_category` pri objavi.
const SAMO_ADMIN = new Set([
  "olx_categories",
  "olx_category_children",
  "olx_category",
  "olx_category_brands",
  "olx_category_models",
  "olx_cities",
  "olx_countries",
  "olx_country_states",
  "olx_city",
  "olx_canton_cities",
  "olx_find_category",
  // Analiticki alati koji klijentu ne trebaju u svakodnevnom radu. Njihovo izbacivanje stedi
  // vise nego skracivanje proze, a analiza konkurenta i mjerenje efekta izdvajanja su ionako
  // posao koji se radi iz admin sesije.
  "olx_competitor_report",
  "olx_sponsor_effect",
]);

const zaKlijenta = config.mcpProfil === "klijent";

const registrujAlat = server.registerTool.bind(server);
server.registerTool = ((name: string, toolConfig: unknown, handler: (args: never) => unknown) => {
  if (zaKlijenta && SAMO_ADMIN.has(name)) return undefined as never;
  return registrujAlat(
    name,
    toolConfig as never,
    ((args: never) => withAuditContext({ operation: name, source: "mcp" }, () => handler(args))) as never,
  );
}) as typeof server.registerTool;

// ---- KB kao resource ----
server.registerResource(
  "knowledgebase",
  "olx://knowledgebase",
  {
    title: "OLX/PIK AI Knowledgebase",
    description: "Interni vodic: API referenca, pravila vidljivosti i dijagnostika. Procitaj prije savjetovanja.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const text = readFileSync(KB_PATH, "utf8");
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
  },
);

// ---- Pravila brojeva: ima prednost nad svim ostalim referencama kad je u pitanju broj ----
server.registerResource(
  "pravila-brojeva",
  "olx://pravila-brojeva",
  {
    title: "OLX/PIK pravila brojeva (prednost nad svim referencama)",
    description:
      "Razdvaja brojeve na tri razreda: fiksne na platformi, vezane za nalog (kvota obnova, krediti) i vezane za kategoriju (cijena izdvajanja). Kad je bilo koja druga referenca u sukobu sa ovim fajlom, vazi ovaj. Procitaj PRIJE nego izgovoris ijedan broj o trosku ili kvoti.",
    mimeType: "text/markdown",
  },
  async (uri) => {
    const text = readFileSync(PRAVILA_BROJEVA_PATH, "utf8");
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
  },
);

// ---- Lagani CSV index kategorija (preferirano za pretragu) ----
server.registerResource(
  "categories-index",
  "olx://categories-index",
  {
    title: "OLX/PIK index kategorija (CSV)",
    description:
      "Lagani CSV za PRONALAZAK kategorije: kolone id, parent_id, level, path, name i zastavice (brand_required, model_required, has_models, show_condition, listing_fee, base_listing_price). Koristi OVO za izbor kategorije po imenu/path. Za forme i opcije izabrane kategorije pozovi alat olx_category_attributes <id> (i olx_category za detalje), ne ucitavaj cijeli categories JSON.",
    mimeType: "text/csv",
  },
  async (uri) => {
    if (!existsSync(CATEGORIES_CSV_PATH)) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: "CSV index jos nije generisan. Pokreni: node dist/cli/index.js category dump (ili category index).",
          },
        ],
      };
    }
    const text = readFileSync(CATEGORIES_CSV_PATH, "utf8");
    return { contents: [{ uri: uri.href, mimeType: "text/csv", text }] };
  },
);

// ---- Puno stablo kategorija (detaljni snapshot; koristi tek kad CSV index nije dovoljan) ----
server.registerResource(
  "categories",
  "olx://categories",
  {
    title: "OLX/PIK stablo kategorija (puni JSON)",
    description:
      "Detaljni snapshot cijelog stabla (olx-dokumentacija/categories.json), velik. Za obicnu pretragu kategorije koristi olx://categories-index (CSV). Ovaj puni JSON citaj samo kad trebas polja kojih nema u CSV-u.",
    mimeType: "application/json",
  },
  async (uri) => {
    // Blizu 2 MB u jednom odgovoru. U klijentskom profilu se ne servira uopste: opis je do sada
    // samo savjetovao CSV index, a savjet nije zastita.
    if (zaKlijenta) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: "Puni JSON stabla kategorija nije dostupan u klijentskom profilu jer je prevelik. Koristi olx://categories-index (CSV) ili olx_suggest_category.",
          },
        ],
      };
    }
    if (!existsSync(CATEGORIES_PATH)) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: "Snapshot kategorija jos nije generisan. Pokreni: node dist/cli/index.js category dump",
          },
        ],
      };
    }
    const text = readFileSync(CATEGORIES_PATH, "utf8");
    return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
  },
);

// ---- Lagani CSV index lokacija (preferirano za pretragu) ----
server.registerResource(
  "locations-index",
  "olx://locations-index",
  {
    title: "OLX/PIK index lokacija (CSV)",
    description:
      "Lagani CSV za PRONALAZAK lokacije: kolone type (country|city), id, name, code, canton_id. Koristi OVO da nadjes country_id (BiH = 49) i city_id po imenu. Puni JSON (olx://locations) citaj samo za detalje (lat/lon, zip, state).",
    mimeType: "text/csv",
  },
  async (uri) => {
    if (!existsSync(LOCATIONS_CSV_PATH)) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: "CSV index lokacija jos nije generisan. Pokreni: node dist/cli/index.js location dump (ili location index).",
          },
        ],
      };
    }
    const text = readFileSync(LOCATIONS_CSV_PATH, "utf8");
    return { contents: [{ uri: uri.href, mimeType: "text/csv", text }] };
  },
);

// ---- Puni JSON lokacija (detaljni snapshot; koristi tek kad CSV index nije dovoljan) ----
server.registerResource(
  "locations",
  "olx://locations",
  {
    title: "OLX/PIK lokacije (puni JSON)",
    description:
      "Detaljni snapshot lokacija (olx-dokumentacija/locations.json): drzave, entiteti, gradovi sa lat/lon/zip/state. Za obican pronalazak country_id/city_id koristi olx://locations-index (CSV). Ovaj JSON citaj samo za dodatne detalje.",
    mimeType: "application/json",
  },
  async (uri) => {
    if (!existsSync(LOCATIONS_PATH)) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: "Snapshot lokacija jos nije generisan. Pokreni: node dist/cli/index.js location dump",
          },
        ],
      };
    }
    const text = readFileSync(LOCATIONS_PATH, "utf8");
    return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
  },
);

// ---- Zvanicna pomoc (pomoc.olx.ba) kao resursi: index pa pojedinacni clanak ----
// Kompletni korpus (176 KB) se NE izlaze kao jedan resource; citaj index, pa samo trazeni clanak.
server.registerResource(
  "pomoc-index",
  "olx://pomoc-index",
  {
    title: "Zvanicna PIK/OLX pomoc (index clanaka, CSV)",
    description:
      "Index 52 clanka zvanicne podrske (pomoc.olx.ba): kolone kategorija, sekcija, naslov, azurirano, url. Koristi OVO da nadjes clanak, pa procitaj pojedinacni preko olx://pomoc/<ime-fajla>.md. Zvanicna pomoc je izvor za pravila platforme; gdje se razlikuje od izmjerenog stanja, vazi knowledgebase (olx://knowledgebase).",
    mimeType: "text/csv",
  },
  async (uri) => {
    if (!existsSync(POMOC_INDEX_PATH)) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: "Korpus pomoci nije prisutan. Osvjezavanje po receptu: olx-dokumentacija/PIK-pomoc-korpus/NALAZI-i-osvjezavanje.md",
          },
        ],
      };
    }
    return { contents: [{ uri: uri.href, mimeType: "text/csv", text: readFileSync(POMOC_INDEX_PATH, "utf8") }] };
  },
);

server.registerResource(
  "pomoc-clanak",
  new ResourceTemplate("olx://pomoc/{fajl}", { list: undefined }),
  {
    title: "Zvanicni clanak pomoci",
    description:
      "Jedan clanak zvanicne pomoci u markdownu. {fajl} je ime fajla iz kolone url/naslova u olx://pomoc-index, npr. cijena-izdvajanja-oglasa-promocije-360014561439.md",
    mimeType: "text/markdown",
  },
  async (uri, variables) => {
    const raw = variables.fajl;
    const name = Array.isArray(raw) ? raw[0] : raw;
    // Putanju gradimo samo iz imena fajla: bez separatora i bez ".." da se ne izadje iz foldera.
    const safe = typeof name === "string" ? decodeURIComponent(name) : "";
    if (!safe || safe.includes("/") || safe.includes("\\") || safe.includes("..")) {
      return {
        contents: [{ uri: uri.href, mimeType: "text/plain", text: `Neispravno ime clanka: ${String(name)}` }],
      };
    }
    const file = resolve(POMOC_CLANCI_DIR, safe.endsWith(".md") ? safe : `${safe}.md`);
    if (!file.startsWith(POMOC_CLANCI_DIR) || !existsSync(file)) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/plain",
            text: `Clanak ne postoji: ${safe}. Provjeri imena u olx://pomoc-index.`,
          },
        ],
      };
    }
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: readFileSync(file, "utf8") }] };
  },
);

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const writeOp = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

// API prihvata samo ove vrijednosti; sve ostalo vraca 422 pa ih odbijamo lokalno.
// refresh_every je na API-ju OBAVEZAN, zato ima default 0 (izdvajanje bez autoobnove).
// API odbija naslov duzi od 65 znakova (422). Pretraga trazi TACNE rijeci, padezi se broje,
// pa naslov mora sadrzati oblik koji kupac kuca ("radne hlace", ne samo "radna").
const TITLE_SCHEMA = z.string().min(1).max(65).describe("naslov, najvise 65 znakova; mora sadrzati tacne pojmove koje kupci traze");
const SPONSOR_DAYS_SCHEMA = z
  .union([z.literal(1), z.literal(2), z.literal(3), z.literal(5), z.literal(7), z.literal(14), z.literal(21), z.literal(30)])
  .describe("broj dana: 1,2,3,5,7,14,21,30 (15 nije validan)");
const REFRESH_EVERY_SCHEMA = z
  .union([z.literal(0), z.literal(3), z.literal(6), z.literal(8), z.literal(24)])
  .default(0)
  .describe("autoobnova u satima: 0 bez, ili 3,6,8,24 (obavezno na API-ju, 12 nije validan)");
const destructiveOp = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;
// Radnje koje nepovratno trose kredite. Isti oblik kao destructiveOp, ali odvojena konstanta jer
// je razlog drugaciji: podatak se ne gubi, novac se gubi. Hostovi koriste destructiveHint da
// zatraze potvrdu od korisnika, sto je ovdje tacno ono sto treba, pored `confirm` gate u kodu.
const trosakOp = destructiveOp;

// ===== SIGURNI ALATI =====

server.registerTool(
  "olx_whoami",
  { title: "Ko sam", description: "Vraca trenutni nalog. Koristi za test pristupa API-ju.", inputSchema: {}, annotations: readOnly },
  () => run((c) => c.me()),
);

server.registerTool(
  "olx_user_profile",
  {
    title: "Javni profil korisnika/shopa",
    description:
      "Javni profil tudjeg ili svog shopa po USERNAME-u: paket (Gold/Platinum), poslovni podaci, ocjene, medalje, vrijeme odgovora i datum registracije. Osnova za analizu konkurencije i kandidata (ne treba njihov token). Numericki id ne radi, samo username.",
    inputSchema: { username: z.string().min(1).describe("username shopa; numericki id vraca 404") },
    annotations: readOnly,
  },
  (args) => run((c) => c.userProfile(args.username)),
);

server.registerTool(
  "olx_list_listings",
  {
    title: "Lista oglasa",
    description:
      "Lista oglasa po stanju, svojih ili tudjih. Po stranici vraca kompaktne stavke, a all vraca cijeli katalog kao CSV sa zaglavljem (ista polja, 60% manje tokena). all i full se ne mogu kombinovati.",
    inputSchema: {
      state: z.enum(["active", "finished", "inactive", "expired", "hidden"]).default("active"),
      user: z.string().optional().describe("username ili id; default je ulogovani korisnik"),
      page: z.number().int().min(1).default(1),
      all: z.boolean().default(false).describe("prelistaj sve stranice datog stanja"),
      full: z.boolean().default(false).describe("sirovi API oblik umjesto kompaktnog"),
    },
    annotations: readOnly,
  },
  (args) => {
    // all + full je jedini poziv u serveru bez gornje granice: prelista sve stranice i vrati ih
    // sirove. Na shopu od par stotina oglasa to je payload koji sam pojede kontekst, a nikad nije
    // ono sto je trebalo. Ko stvarno treba sirov oblik, uzme ga po stranici ili po oglasu.
    if (args.all && args.full) {
      return Promise.resolve(
        errResult(
          "Kombinacija all i full nije dozvoljena jer vraca neogranicen payload. " +
            "Koristi all bez full za kompaktnu listu svih oglasa, ili full sa page za jednu stranicu, " +
            "ili olx_get_listing za sirovi oblik jednog oglasa.",
        ),
      );
    }
    return run(async (c) => {
      const user = args.user ?? (await c.resolveUsername());
      if (args.all) {
        // Cijeli katalog ide kao CSV, ne kao niz objekata: imena polja ponovljena po oglasu su
        // vise od pola payloada, a CSV nosi ista polja uz 60% manje tokena (izmjereno, vidi
        // kompaktCsv). Na jednoj stranici razlika je mala pa tamo ostaje JSON.
        const sve = await c.listAllByState(args.state, user);
        return { csv: kompaktCsv(sve), ukupno: sve.length };
      }
      const stranica =
        args.state === "active"
          ? await c.listActive(user, args.page)
          : args.state === "finished"
            ? await c.listFinished(user, args.page)
            : args.state === "inactive"
              ? await c.listInactive(user, args.page)
              : args.state === "expired"
                ? await c.listExpired(user, args.page)
                : await c.listHidden(user, args.page);
      return args.full ? stranica : { data: kompaktList(stranica.data), meta: stranica.meta };
    });
  },
);

server.registerTool(
  "olx_get_listing",
  {
    title: "Detalji oglasa",
    description:
      "Dohvata pojedinacni oglas po ID-u (radi i za tudje; nosi views i questions). Default je kompaktan oblik bez user i punog category bloka, slike kao broj + prva, atributi samo popunjeni; full=true vraca sirovi API oblik. Za izracunatu analizu koristi olx_listing_report.",
    inputSchema: {
      id: z.union([z.number(), z.string()]),
      full: z.boolean().default(false).describe("sirovi API oblik umjesto kompaktnog"),
    },
    annotations: readOnly,
  },
  (args) => run(async (c) => (args.full ? c.getListing(args.id) : kompaktListing(await c.getListing(args.id)))),
);

server.registerTool(
  "olx_suggest_category",
  { title: "Prijedlog kategorije", description: "Prijedlog kategorije po naslovu (keyword). Vraca i broj oglasa.", inputSchema: { keyword: z.string().min(1) }, annotations: readOnly },
  (args) => run((c) => c.suggestCategory(args.keyword)),
);

server.registerTool(
  "olx_find_category",
  { title: "Pronadji kategoriju", description: "Pronalazi kategoriju po imenu i vraca puni path.", inputSchema: { name: z.string().min(1) }, annotations: readOnly },
  (args) => run((c) => c.findCategory(args.name)),
);

server.registerTool(
  "olx_category_attributes",
  { title: "Atributi kategorije", description: "Atributi (forme) kategorije: id, naziv, opcije, da li je obavezno. Potrebno za validan create payload.", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: readOnly },
  (args) => run((c) => c.categoryAttributes(args.id)),
);

server.registerTool(
  "olx_refresh_limits",
  { title: "Limiti obnove", description: "Mjesecni limiti obnove (free_limit, free_count, listing_count).", inputSchema: {}, annotations: readOnly },
  () => run((c) => c.refreshLimits()),
);

server.registerTool(
  "olx_sponsor_price",
  {
    title: "Cijena izdvajanja",
    description: "Dohvata cijenu izdvajanja u kreditima. NE trosi kredite. Uvijek pozovi ovo prije izdvajanja.",
    inputSchema: {
      id: z.union([z.number(), z.string()]),
      type: z.number().int().min(0).max(2).describe("0 bez, 1 klasicno, 2 premium"),
      days: SPONSOR_DAYS_SCHEMA,
      refresh_every: REFRESH_EVERY_SCHEMA,
      homepage: z.boolean().default(false),
      locations: z.array(z.string()).optional().describe("dodatne lokacije izdvajanja; dokumentovana je samo \"homepage\", ostale API moze odbiti sa 422"),
    },
    annotations: readOnly,
  },
  (args) =>
    run((c) =>
      c.sponsorPrice(
        args.id,
        parseSponsorOptions({
          type: args.type,
          days: args.days,
          refreshEvery: args.refresh_every,
          homepage: args.homepage,
          locations: args.locations,
        }),
      ),
    ),
);

// Plan izdvajanja racuna KOD, ne model: cijene dolaze sa API-ja po kandidatu, raspored i
// budzet racuna testirani buildPlan iz core-a. Model rezultat samo objasnjava i trazi
// potvrdu. Time izmisljen broj u planu postaje tehnicki nemoguc, ne samo zabranjen.
server.registerTool(
  "olx_sponsor_plan",
  {
    title: "Plan izdvajanja (racuna kod)",
    description:
      "Izracuna plan izdvajanja: kandidati (zadani ID-evi ili najstariji neizdvojeni aktivni), cijena svakog sa API-ja, raspored po danima do budzeta. NISTA ne naplacuje; brojeve ne racunaj sam nego ih citaj odavde. sacuvaj: true upise plan u fajl koji prate sedmicni izvjestaj i CLI izvrsenje.",
    inputSchema: {
      budzet: z.number().positive().describe("ukupno kredita za raspodjelu"),
      dana: z.number().int().min(1).max(31).default(7).describe("na koliko dana se termini rasporede"),
      type: z.number().int().min(0).max(2).default(2).describe("0 bez, 1 klasicno, 2 premium"),
      days: SPONSOR_DAYS_SCHEMA,
      refresh_every: REFRESH_EVERY_SCHEMA,
      homepage: z.boolean().default(false),
      oglasi: z.array(z.union([z.number(), z.string()])).optional().describe("konkretni ID-evi; bez ovoga najstariji neizdvojeni aktivni"),
      broj_oglasa: z.number().int().min(1).max(100).default(40),
      sacuvaj: z.boolean().default(false),
    },
  },
  (args) =>
    run(async (c) => {
      const opcije = parseSponsorOptions({
        type: args.type,
        days: args.days,
        refreshEvery: args.refresh_every,
        homepage: args.homepage,
      });
      const user = await c.resolveUsername();

      let kandidati: PlanKandidat[];
      if (args.oglasi && args.oglasi.length > 0) {
        kandidati = [];
        for (const id of args.oglasi) {
          const oglas = await c.getListing(id);
          kandidati.push({ id: Number(id), naslov: oglas.title, vec_izdvojen: Boolean(oglas.sponsored) });
        }
      } else {
        // Automatski odabir preskace oglase koje je vlasnik izuzeo od izdvajanja. Kad ID-eve
        // navede sam (grana iznad), to je izricita zelja i izuzece se ne primjenjuje.
        const aktivni = await c.listAllActive(user);
        const { prolaze } = odvojiIzuzete(
          aktivni.filter((l) => !l.sponsored),
          ucitajIzuzeca(),
          "izdvajanje",
        );
        kandidati = prolaze
          .sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
          .slice(0, args.broj_oglasa)
          .map((l) => ({ id: l.id, naslov: l.title }));
      }

      // GET cijene ne trosi kredite. Kandidat bez citljive cijene ne ulazi u plan.
      const bez_cijene: number[] = [];
      for (const kandidat of kandidati) {
        try {
          kandidat.cijena = (await c.sponsorPrice(kandidat.id, opcije)).total;
        } catch {
          bez_cijene.push(Number(kandidat.id));
        }
      }

      const plan = buildPlan({
        kandidati,
        budzet: args.budzet,
        danaRaspored: args.dana,
        opcije,
        pocetniDatum: new Date().toISOString().slice(0, 10),
        napravljen: new Date().toISOString(),
        nalog: user,
      });

      if (args.sacuvaj) {
        const otkljucaj = zauzmiKljuc(PLAN_FILE);
        try {
          upisiPlan(plan);
        } finally {
          otkljucaj();
        }
      }

      return {
        ...planSazetak(plan),
        termini: plan.termini.map((t) => ({
          id: t.listing_id,
          naslov: t.naslov,
          za_datum: t.za_datum,
          cijena: t.cijena,
        })),
        ...(bez_cijene.length > 0 ? { bez_cijene } : {}),
        sacuvan: Boolean(args.sacuvaj),
        napomena: "Nista nije naplaceno. Pojedinacni termin se izvrsava kroz olx_sponsor_listing uz potvrdu.",
      };
    }),
);

// Vision proxy za sesije ciji glavni model nema vid (DeepSeek ignorise slike). Registruje se
// SAMO kad je OLX_VID_API_KEY postavljen: klonovi na pretplati vide slike direktno i ovu semu
// ne placaju u kontekstu.
if (vidKonfigurisan()) {
  server.registerTool(
    "olx_opisi_sliku",
    {
      title: "Opisi sliku (vision proxy)",
      description:
        "Posalje sliku sa diska jeftinom vision modelu i vrati tekstualni opis proizvoda. Koristi SAMO kad sliku ne mozes direktno vidjeti (pogon bez vida). Ne zove OLX i ne trosi kredite.",
      inputSchema: {
        putanja: z.string().min(1).describe("puna putanja do fajla slike, npr. iz Telegram inboxa"),
        pitanje: z.string().optional().describe("sta te o slici zanima; bez ovoga opis proizvoda za oglas"),
      },
      annotations: readOnly,
    },
    async (args) => {
      try {
        return ok(await opisiSliku(args.putanja, args.pitanje));
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    },
  );
}

// Generisanje slike oglasa. Registruje se SAMO kad je OLX_SLIKA_API_KEY postavljen, isto kao
// vision proxy. Kosta vanjski AI racun (ne OLX kredite), pa nosi confirm branu i dnevni plafon.
if (slikaKonfigurisana()) {
  server.registerTool(
    "olx_generiraj_sliku",
    {
      title: "Napravi sliku oglasa iz fotografije",
      description:
        "Iz poslane fotografije napravi novu sliku artikla: cist prostor i ravno svjetlo, artikal ostaje isti " +
        "(stanje, boja i ostecenja se ne popravljaju). Ne trosi OLX kredite nego vanjski AI racun, pa bez " +
        "confirm true samo vrati sta bi radio i stanje dnevnog plafona. Vraca putanju nove slike, spremnu za " +
        "olx_upload_images ili za slanje korisniku na odobrenje.",
      inputSchema: {
        recept: z
          .string()
          .min(3)
          .describe(`ime recepta (${Object.keys(RECEPTI).join(", ")}) ili slobodna uputa na engleskom`),
        slike: z
          .array(z.string().min(1))
          .optional()
          .describe("putanje do poslanih fotografija, npr. iz Telegram inboxa; prva je glavna"),
        logo: z.string().optional().describe("ime firme koje ide na tablu u pozadini, samo za recepte koji ga koriste"),
        odnos: z.enum(ODNOSI).optional().describe(`odnos strana, default ${ZADANI_ODNOS} jer je kartica oglasa pejzazna`),
        confirm: z.boolean().optional().describe("true tek nakon sto korisnik potvrdi"),
      },
    },
    async (args) => {
      const plafon = maxDnevno();
      const danas = brojPozivaDanas("slika");
      if (!args.confirm) {
        return ok({
          napravljeno: false,
          trazi_potvrdu: true,
          recept: args.recept,
          ulaznih_slika: args.slike?.length ?? 0,
          odnos: args.odnos ?? ZADANI_ODNOS,
          danas_generisano: danas,
          plafon,
          napomena:
            "Nista nije napravljeno. Generisanje ne trosi OLX kredite. Ponovi poziv sa confirm: true kad korisnik potvrdi.",
        });
      }
      try {
        return ok(
          await generisiSliku({
            recept: args.recept,
            ulazneSlike: args.slike,
            logo: args.logo,
            odnos: args.odnos as Odnos | undefined,
          }),
        );
      } catch (e) {
        return errResult(String(e instanceof Error ? e.message : e));
      }
    },
  );
}

// Saznanja iz prakse: kad se API ponasa suprotno dokumentaciji ili ocekivanju, sesija to
// zabiljezi jednom recenicom. Fajl kupi scripts/saznanja-pokupi.sh sa admin masine i nosi u
// glavni repo, pa iz terena nastaju popravke dokumentacije i koda. Dostupno u OBA profila.
server.registerTool(
  "olx_zabiljezi_saznanje",
  {
    title: "Zabiljezi saznanje iz prakse",
    description:
      "Upisi jednu recenicu o neocekivanom ponasanju API-ja ili platforme (nesto radi drugacije od dokumentacije, nova greska, novo ogranicenje). Ne zove OLX, ne trosi kredite. Pozovi odmah kad se desi, pa nastavi posao.",
    inputSchema: {
      tekst: z.string().min(10).describe("sta je primijeceno, jedna do dvije recenice, bez tajni"),
      tema: z.string().optional().describe("kratka oznaka, npr. update_listing, kvota, telegram"),
    },
  },
  async (args) => {
    try {
      mkdirSync(".olx-pik", { recursive: true });
      const red = JSON.stringify({
        ts: new Date().toISOString(),
        profil: config.mcpProfil,
        tema: args.tema ?? null,
        tekst: args.tekst,
      });
      appendFileSync(".olx-pik/saznanja.jsonl", `${red}\n`, "utf8");
      return ok({ zabiljezeno: true });
    } catch (e) {
      return errResult(String(e instanceof Error ? e.message : e));
    }
  },
);

server.registerTool(
  "olx_categories",
  { title: "Kategorije", description: "Top-level kategorije. Za stabilan snapshot citaj resource olx://categories.", inputSchema: {}, annotations: readOnly },
  () => run((c) => c.categories()),
);

server.registerTool(
  "olx_category_children",
  { title: "Podkategorije", description: "Podkategorije date kategorije.", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: readOnly },
  (args) => run((c) => c.childrenCategories(args.id)),
);

server.registerTool(
  "olx_category",
  {
    title: "Kategorija (detalji)",
    description:
      "Jedna kategorija: listing_fee (krediti koje objava oglasa kosta u ovoj kategoriji; 0 = besplatna objava), base_listing_price (osnovna cijena oglasa u kreditima), brand_required, model_required, show_map, show_condition. Za trosak objave PRIJE kreiranja oglasa procitaj ova dva polja; tumacenje brojeva ima olx://pravila-brojeva. Obje kolone nosi i olx://categories-index.",
    inputSchema: { id: z.union([z.number(), z.string()]) },
    annotations: readOnly,
  },
  (args) => run((c) => c.category(args.id)),
);

server.registerTool(
  "olx_category_brands",
  { title: "Brendovi kategorije", description: "Brendovi u kategoriji (za vozila i sl.).", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: readOnly },
  (args) => run((c) => c.categoryBrands(args.id)),
);

server.registerTool(
  "olx_category_models",
  { title: "Modeli brenda", description: "Modeli za dati brend u kategoriji. Daje model_id za create payload.", inputSchema: { id: z.union([z.number(), z.string()]), brandId: z.union([z.number(), z.string()]) }, annotations: readOnly },
  (args) => run((c) => c.categoryModels(args.id, args.brandId)),
);

server.registerTool(
  "olx_listing_limits",
  { title: "Limiti broja oglasa", description: "Limiti broja oglasa po grupama kategorija (cars, real-estate, other).", inputSchema: {}, annotations: readOnly },
  () => run((c) => c.listingLimits()),
);

server.registerTool(
  "olx_countries",
  { title: "Drzave", description: "Lista drzava (BiH = id 49). Za stabilan snapshot citaj resource olx://locations.", inputSchema: {}, annotations: readOnly },
  () => run((c) => c.countries()),
);

server.registerTool(
  "olx_cities",
  { title: "Entiteti/regije", description: "Entiteti/regije (sadrze kantone). Za stabilan snapshot citaj resource olx://locations.", inputSchema: {}, annotations: readOnly },
  () => run((c) => c.cities()),
);

server.registerTool(
  "olx_country_states",
  {
    title: "Entiteti drzave",
    description: "Entiteti/regije drzave sa kantonima (isti oblik kao olx_cities). Za stabilan snapshot citaj resource olx://locations.",
    inputSchema: {},
    annotations: readOnly,
  },
  () => run((c) => c.countryStates()),
);

server.registerTool(
  "olx_city",
  { title: "Grad po ID", description: "Detalji grada (lat, lon, zip, canton_id, state_id). Daje city_id za create payload.", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: readOnly },
  (args) => run((c) => c.city(args.id)),
);

server.registerTool(
  "olx_canton_cities",
  { title: "Gradovi kantona", description: "Gradovi u datom kantonu.", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: readOnly },
  (args) => run((c) => c.cantonCities(args.id)),
);

// ===== STATS AGREGATI =====
// Sloj biznis logike: vise API poziva ispod haube, AI dobija vec izracunat kompaktan rezultat.

server.registerTool(
  "olx_onboarding_report",
  {
    title: "Onboarding izvjestaj",
    description:
      "Prva analiza shopa u jednom pozivu: neiskoristene besplatne obnove i dnevni tempo do kraja mjeseca, oglasi sa nedostacima, svjezina, pregledi i upiti, rangirana lista prvih poteza.",
    inputSchema: {
      format: z
        .enum(["json", "markdown", "telegram"])
        .default("json")
        .describe("json za obradu, markdown za dokument klijentu, telegram za jednu poruku"),
      bez_snapshota: z.boolean().default(false).describe("preskoci snapshot, izvjestaj bez higijene i ucinka"),
    },
    annotations: readOnly,
  },
  (args) =>
    run(async (c) => {
      const zadnji = args.bez_snapshota ? null : (ucitajSnapshote().at(-1) ?? null);
      const rezultat = await c.statsOnboarding(zadnji ? { oglasi: zadnji.oglasi, ts: zadnji.ts } : undefined);
      if (args.format === "markdown") return onboardingMarkdown(rezultat.izvjestaj);
      if (args.format === "telegram") return onboardingTelegram(rezultat.izvjestaj);
      return zadnji
        ? rezultat
        : { ...rezultat, napomena: "Nema snapshota u .olx-pik/snapshots; pokreni CLI 'stats snapshot' za higijenu i ucinak." };
    }),
);

server.registerTool(
  "olx_profile_stats",
  {
    title: "Statistika profila",
    description:
      "Pregled vlastitog naloga u jednom pozivu: paket i istek, krediti, kvota obnova, oglasi po stanjima, cijene, udio sponzorisanih, neobnovljeni oglasi. Polje nova_pitanja je neprovjeren brojac sa API-ja: ne iznositi ga korisniku kao cinjenicu.",
    inputSchema: {
      views: z
        .enum(["none", "sample", "snapshot"])
        .default("none")
        .describe("none brzo (default), sample uzorak ~15 oglasa (oko 10s), snapshot sa diska bez poziva"),
      sample_size: z.number().int().min(3).max(30).optional().describe("velicina uzorka za views=sample, default 15"),
    },
    annotations: readOnly,
  },
  (args) =>
    run(async (c) => {
      if (args.views === "snapshot") {
        const snapshoti = ucitajSnapshote();
        const zadnji = snapshoti[snapshoti.length - 1];
        if (!zadnji) {
          return c.statsProfil().then((r) => ({ ...r, napomena: "Nema snapshota u .olx-pik/snapshots; pokreni CLI 'stats snapshot'. Vracena statistika bez pregleda." }));
        }
        const pregledi: OglasPregledi[] = zadnji.oglasi.map((o) => ({
          id: o.id,
          title: o.title,
          views: o.views,
          questions: o.questions,
          created_at: o.created_at,
        }));
        const r = await c.statsProfil({ pregledi });
        return { ...r, snapshot_ts: zadnji.ts };
      }
      return c.statsProfil({ viewsMode: args.views, sampleVelicina: args.sample_size });
    }),
);

server.registerTool(
  "olx_competitor_report",
  {
    title: "Izvjestaj o konkurentu",
    description:
      "Analiza tudjeg naloga iz javnih podataka u jednom pozivu: paket, aktivnost, ocjene, broj aktivnih i zavrsenih oglasa, cijene (min/median/max), udio sponzorisanih i akcija, kadenca obnove. top_views > 0 dodatno vraca izvjestaj (ukljucujuci preglede) za N najskorije obnovljenih oglasa. Konkurenta zadaj po username-u (nema pretrage po kategoriji).",
    inputSchema: {
      username: z.string().min(1),
      top_views: z.number().int().min(0).max(10).default(0),
    },
    annotations: readOnly,
  },
  (args) => run((c) => c.statsKonkurent(args.username, args.top_views)),
);

server.registerTool(
  "olx_listing_report",
  {
    title: "Izvjestaj o oglasu",
    description:
      "Izracunata analiza jednog oglasa (naseg ili tudjeg): pregledi ukupno i dnevno, pitanja, starost, dana od zadnje obnove, broj slika i popunjenih atributa, duzina naslova i podnaslov, cijena i akcija, sponzorstvo (na nasem oglasu i placeni detalji). Jedan API poziv.",
    inputSchema: { id: z.union([z.number(), z.string()]) },
    annotations: readOnly,
  },
  (args) => run((c) => c.statsOglas(args.id)),
);

server.registerTool(
  "olx_account_alerts",
  {
    title: "Alarmi naloga",
    description:
      "Brza provjera naloga (3 API poziva): paket pri isteku, saldo kredita ispod praga, kvota obnova koja propada pred kraj mjeseca, istekli oglasi za reaktivaciju. Vraca ok: true kad je sve cisto. Pragovi su podesivi.",
    inputSchema: {
      krediti_min: z.number().int().min(0).optional().describe("prag salda kredita, default 500"),
      paket_dana: z.number().int().min(1).optional().describe("alarm kad paket istice za manje od N dana, default 14"),
    },
    annotations: readOnly,
  },
  (args) => run((c) => c.statsAlarmi({ kreditiMin: args.krediti_min, paketDana: args.paket_dana })),
);

server.registerTool(
  "olx_sponsor_effect",
  {
    title: "Efekat izdvajanja",
    description:
      "Mjeri efekat izdvajanja oglasa iz dnevnih snapshota pregleda (.olx-pik/snapshots, pravi ih CLI 'stats snapshot'): pregledi dnevno prije, tokom i poslije perioda, plus faktor rasta. Period se cita iz aktivnog izdvajanja oglasa (sponsor_active), a moze se zadati i rucno preko od_ts/do_ts (unix sekunde).",
    inputSchema: {
      id: z.union([z.number(), z.string()]),
      od_ts: z.number().int().optional(),
      do_ts: z.number().int().optional(),
    },
    annotations: readOnly,
  },
  (args) =>
    run(async (c) => {
      let period: { od_ts: number; do_ts: number } | null =
        args.od_ts && args.do_ts ? { od_ts: args.od_ts, do_ts: args.do_ts } : null;
      if (!period) {
        const listing = await c.getListing(args.id);
        const aktivno = listing.sponsor_active as { sponsored_until?: number; sponsored_days?: number } | null;
        if (aktivno?.sponsored_until && aktivno.sponsored_days) {
          period = { od_ts: aktivno.sponsored_until - aktivno.sponsored_days * 86_400, do_ts: aktivno.sponsored_until };
        }
      }
      if (!period) {
        return {
          greska: "Oglas nema aktivno izdvajanje, a period nije zadan. Zadaj od_ts i do_ts (unix sekunde) proslog izdvajanja.",
        };
      }
      const snapshoti = ucitajSnapshote();
      return { period, snapshota: snapshoti.length, ...efekatIzdvajanja(snapshoti, Number(args.id), period) };
    }),
);

// ===== UPIS =====

server.registerTool(
  "olx_find_my_listing",
  {
    title: "Nadji svoj oglas po opisu",
    description:
      "Pronalazi JEDAN poznat oglas po slobodnom opisu kad korisnik ne zna ID (\"prodao sam crvene cipele\"). Poredi RIJECI naslova, ne znacenje, pa NE garantuje potpunost: artikal cije ime ne dijeli rijeci sa upitom nece biti nadjen. Za \"svi artikli grupe\" NIJE dovoljan alat: tada olx_list_listings all:true pa sam odaberi sta pripada grupi. Skor NIJE dokaz: uvijek pokazi naslov korisniku i trazi potvrdu prije bilo kakve radnje, pogotovo prije zavrsavanja oglasa.",
    inputSchema: {
      upit: z.string().min(2),
      state: z.enum(["active", "finished", "inactive", "expired", "hidden"]).default("active"),
      limit: z.number().int().min(1).max(10).default(3),
    },
    annotations: readOnly,
  },
  (args) =>
    run(async (c) => {
      const user = await c.resolveUsername();
      const oglasi = await c.listAllByState(args.state, user);
      const pogodci = nadjiPoUpitu(
        args.upit,
        oglasi.map((o) => ({ id: o.id, title: o.title, price: typeof o.price === "number" ? o.price : undefined })),
        args.limit,
      );
      // Napomena ide u REZULTAT namjerno: opis alata slabiji model zna preskociti, a ovo
      // procita uz svaki odgovor. Prag 0.35 samo mijenja formulaciju, nista ne filtrira
      // (zasto alat nema apsolutni prag: match.test.ts, test o pragovima).
      const najbolji = pogodci[0]?.skor ?? 0;
      const napomena =
        (najbolji < 0.35 ? `Najbolji skor je svega ${najbolji}: ovo su kandidati, ne nalaz. ` : "") +
        "Pretraga poredi rijeci naslova, pa artikli drugacijeg imena (npr. samo model) nisu obuhvaceni; za potpun popis grupe koristi olx_list_listings all:true pa sam odaberi.";
      return { upit: args.upit, pretrazeno: oglasi.length, pogodci, napomena };
    }),
);

server.registerTool(
  "olx_draft_check",
  {
    title: "Provjera nacrta oglasa",
    description:
      "Validira nacrt PRIJE olx_create_listing: naslov (max 65), obavezni atributi kategorije i dozvoljene vrijednosti, kvaliteta (podnaslov, opis, cijena) i naknada objave u kreditima. Vraca spreman: true/false. Obavezan korak.",
    inputSchema: {
      category_id: z.union([z.number(), z.string()]),
      title: z.string().optional(),
      short_description: z.string().optional(),
      description: z.string().optional(),
      price: z.number().optional(),
      attributes: z.array(z.object({ id: z.number(), value: z.string() })).optional(),
    },
    annotations: readOnly,
  },
  (args) =>
    run(async (c) => {
      // Naknada se dohvata ovdje da se trosak sazna PRIJE nego korisnik potvrdi oglas, a ne kao
      // iznenadjenje na kreiranju.
      const [atributi, kategorija] = await Promise.all([
        c.categoryAttributes(args.category_id),
        c.category(args.category_id).catch(() => null),
      ]);
      const naknada = naknadaKategorije(kategorija);
      return {
        ...provjeriNacrt(args, atributi.data ?? []),
        naknada_objave_kredita: naknada,
        ...(naknada > 0
          ? { napomena_troska: `Objava u ovoj kategoriji kosta ${naknada} kredita. Trazi potvrdu prije kreiranja.` }
          : {}),
      };
    }),
);

server.registerTool(
  "olx_create_listing",
  {
    title: "Kreiraj oglas",
    description:
      "Kreira oglas kao DRAFT, nije vidljiv dok se ne objavi (olx_publish_listing). Prvo pozovi olx_draft_check. U naplatnim kategorijama (vozila, nekretnine, poslovi, usluge) bez confirm=true samo javi cijenu i ne kreira.",
    inputSchema: {
      title: TITLE_SCHEMA,
      category_id: z.union([z.number(), z.string()]).describe("vidi olx://categories-index"),
      short_description: z.string().optional().describe("podnaslov; ULAZI u pretragu, iskoristi ga za ključne riječi koje ne stanu u naslov"),
      description: z.string().optional(),
      country_id: z.union([z.number(), z.string()]).optional(),
      city_id: z.union([z.number(), z.string()]).optional(),
      price: z.number().optional(),
      available: z.boolean().optional(),
      listing_type: z.enum(["sell", "buy", "rent"]).optional(),
      state: z.enum(["new", "used"]).optional(),
      brand_id: z.union([z.number(), z.string()]).optional(),
      model_id: z.union([z.number(), z.string()]).optional(),
      sku_number: z.string().optional(),
      attributes: z.array(z.object({ id: z.number(), value: z.string() })).optional(),
      confirm: z
        .boolean()
        .default(false)
        .describe("obavezan u naplatnim kategorijama, vidi opis alata"),
    },
    annotations: writeOp,
  },
  (args) => {
    const { confirm, ...nacrt } = args;
    return run((c) => c.createListing(nacrt, { confirm }));
  },
);

server.registerTool(
  "olx_publish_listing",
  { title: "Objavi oglas", description: "Objavljuje DRAFT oglas (postaje aktivan i vidljiv).", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: writeOp },
  (args) => run((c) => c.publishListing(args.id)),
);

server.registerTool(
  "olx_update_listing",
  {
    title: "Izmijeni oglas",
    description:
      "Mijenja polja oglasa. Salje se samo ono sto se mijenja. Pored teksta i cijene moze i kategorija, stanje, lokacija, brend/model i atributi. Kad mijenjas category_id provjeri obavezne atribute nove kategorije (olx_category_attributes), inace API vraca 422.",
    inputSchema: {
      id: z.union([z.number(), z.string()]),
      title: TITLE_SCHEMA.optional(),
      description: z.string().optional(),
      short_description: z.string().optional().describe("podnaslov; ULAZI u pretragu, iskoristi ga za kljucne rijeci koje ne stanu u naslov"),
      price: z.number().optional(),
      available: z.boolean().optional(),
      category_id: z.union([z.number(), z.string()]).optional().describe("nova kategorija; vidi olx://categories-index"),
      sku_number: z.string().optional(),
      state: z.enum(["new", "used"]).optional(),
      listing_type: z.enum(["sell", "buy", "rent"]).optional(),
      country_id: z.union([z.number(), z.string()]).optional(),
      city_id: z.union([z.number(), z.string()]).optional(),
      brand_id: z.union([z.number(), z.string()]).optional(),
      model_id: z.union([z.number(), z.string()]).optional(),
      attributes: z.array(z.object({ id: z.number(), value: z.string() })).optional(),
    },
    annotations: writeOp,
  },
  (args) => {
    const { id, ...patch } = args;
    return run((c) => c.updateListing(id, patch));
  },
);

server.registerTool(
  "olx_refresh_listing",
  { title: "Obnovi oglas", description: "Obnavlja oglas (svjez datum, dize rang u kategoriji).", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: writeOp },
  (args) => run((c) => c.refreshListing(args.id)),
);

server.registerTool(
  "olx_bulk_price",
  {
    title: "Grupna promjena cijene",
    description:
      "Mijenja cijenu na vise oglasa odjednom. pravilo: postotak (-10 znaci snizi 10 posto), fiksno (-5 znaci oduzmi 5), postavi (svima ista cijena). confirm=false (default) vraca samo pregled stara naspram nova, bez ijedne izmjene. Ne trosi kredite, ali se rucno ne vraca, pa pregled OBAVEZNO pokazi korisniku prije potvrde.",
    inputSchema: {
      pravilo: z.enum(["postotak", "fiksno", "postavi"]),
      iznos: z.number(),
      category_id: z.number().int().optional().describe("ogranici na jednu kategoriju"),
      ids: z.array(z.number().int()).optional().describe("tacna lista oglasa; ima prednost nad category_id"),
      limit: z.number().int().min(1).max(500).default(50),
      confirm: z.boolean().default(false),
    },
    annotations: destructiveOp,
  },
  (args) =>
    run(async (c) => {
      const user = await c.resolveUsername();
      const svi = await c.listAllActive(user);
      const izabrani = args.ids?.length
        ? svi.filter((l) => args.ids?.includes(l.id))
        : args.category_id !== undefined
          ? svi.filter((l) => l.category_id === args.category_id)
          : svi;

      const pregled = izracunajNoveCijene(
        izabrani
          .slice(0, args.limit)
          .map((l) => ({ id: l.id, title: l.title, price: typeof l.price === "number" ? l.price : undefined })),
        { vrsta: args.pravilo, iznos: args.iznos },
      );

      if (!args.confirm) {
        return { dry_run: true, obuhvaceno: izabrani.length, ...pregled };
      }
      if (pregled.stavke.length === 0) {
        return { izmijenjeno: 0, ukupno: 0, napomena: "Nijedan oglas ne zadovoljava pravilo.", preskoceno: pregled.preskoceno };
      }

      // Kljuc kao kod plana izdvajanja: dvije paralelne grupne izmjene bi se pregazile.
      const otpusti = zauzmiKljuc(".olx-pik/bulk-price");
      try {
        const rezultati: { id: number; ok: boolean; nova: number; greska?: string }[] = [];
        for (const s of pregled.stavke) {
          try {
            await c.updateListing(s.id, { price: s.nova });
            rezultati.push({ id: s.id, ok: true, nova: s.nova });
          } catch (e) {
            rezultati.push({ id: s.id, ok: false, nova: s.nova, greska: String(e instanceof Error ? e.message : e) });
          }
        }
        return {
          izmijenjeno: rezultati.filter((r) => r.ok).length,
          ukupno: rezultati.length,
          preskoceno: pregled.preskoceno.length,
          neuspjeli: rezultati.filter((r) => !r.ok),
        };
      } finally {
        otpusti();
      }
    }),
);

server.registerTool(
  "olx_bulk_sklanjanje",
  {
    title: "Grupno sakrivanje ili zavrsavanje",
    description:
      "Sklanja vise oglasa odjednom: radnja 'hide' kad se artikal vraca na stanje, 'finish' kad je prodan (ostaje u historiji profila). confirm=false (default) vraca samo listu. Zavrsavanje se kroz ovaj server NE moze ponistiti, pa listu obavezno pokazi korisniku prije potvrde.",
    inputSchema: {
      ids: z.array(z.number().int()).min(1),
      radnja: z.enum(["hide", "finish"]),
      confirm: z.boolean().default(false),
    },
    annotations: destructiveOp,
  },
  (args) =>
    run(async (c) => {
      const user = await c.resolveUsername();
      const svi = await c.listAllActive(user);
      const izabrani = svi.filter((l) => args.ids.includes(l.id));
      const nepoznati = args.ids.filter((id) => !svi.some((l) => l.id === id));

      if (!args.confirm) {
        return {
          dry_run: true,
          radnja: args.radnja,
          oglasi: izabrani.map((l) => ({ id: l.id, title: l.title })),
          nisu_aktivni: nepoznati,
        };
      }
      const rezultati: { id: number; ok: boolean; greska?: string }[] = [];
      for (const l of izabrani) {
        try {
          await (args.radnja === "hide" ? c.hideListing(l.id) : c.finishListing(l.id));
          rezultati.push({ id: l.id, ok: true });
        } catch (e) {
          rezultati.push({ id: l.id, ok: false, greska: String(e instanceof Error ? e.message : e) });
        }
      }
      return {
        radnja: args.radnja,
        uspjelo: rezultati.filter((r) => r.ok).length,
        ukupno: rezultati.length,
        neuspjeli: rezultati.filter((r) => !r.ok),
        nisu_aktivni: nepoznati,
      };
    }),
);

server.registerTool(
  "olx_mrtvi_oglasi",
  {
    title: "Oglasi bez novih pregleda",
    description:
      "Oglasi koji nisu dobili nijedan NOV pregled u zadanom periodu, racunato iz razlike dnevnih snapshota. Razlicito od 'nula pregleda ukupno': hvata i oglas koji je nekad imao mnogo pregleda a sada stoji. Kandidati za popravku naslova, sakrivanje ili zavrsavanje.",
    inputSchema: {
      dana: z.number().int().min(7).max(365).default(60),
      limit: z.number().int().min(1).max(50).default(20),
    },
    annotations: readOnly,
  },
  (args) =>
    run(async () => {
      const rezultat = mrtviOglasi(ucitajSnapshote(), Math.floor(Date.now() / 1000), args.dana);
      if (!rezultat) {
        return {
          greska: "Nema dva snapshota za poredjenje. Pokreni CLI 'stats snapshot' bar dva puta u razmaku od nekoliko dana.",
        };
      }
      return { ...rezultat, ukupno: rezultat.oglasi.length, oglasi: rezultat.oglasi.slice(0, args.limit) };
    }),
);

server.registerTool(
  "olx_refresh_bulk",
  {
    title: "Bulk obnova",
    description:
      "Obnavlja aktivne oglase kojima je obnova dostupna, uz postivanje mjesecnog limita. confirm=false (default) je dry-run i vraca samo listu kandidata. confirm=true izvrsava obnovu.",
    inputSchema: {
      user: z.string().optional(),
      // Gornja granica je samo sanity check; stvarni cap je free_limit - free_count sa API-ja.
      limit: z.number().int().min(1).max(4600).default(100),
      confirm: z.boolean().default(false),
    },
    annotations: writeOp,
  },
  (args) =>
    run(async (c) => {
      const user = args.user ?? (await c.resolveUsername());
      const limits = await c.refreshLimits();
      const remaining = Math.max(0, limits.free_limit - limits.free_count);
      const cap = Math.min(args.limit, remaining);
      const all = await c.listAllActive(user);
      // Izuzeci PRIJE capa, da zabranjena obnova ne potrosi mjesto onome kome obnova treba.
      const { prolaze, preskoceni } = odvojiIzuzete(
        all.filter((l) => l.refresh_available === true),
        ucitajIzuzeca(),
        "obnova",
      );
      const candidates = prolaze.slice(0, cap);
      const izuzeto = preskoceni.length > 0 ? { izuzeto: preskoceni.map((l) => ({ id: l.id, title: l.title })) } : {};
      if (!args.confirm) {
        return {
          dry_run: true,
          remaining_free: remaining,
          candidates: candidates.map((l) => ({ id: l.id, title: l.title })),
          ...izuzeto,
        };
      }
      const results: { id: number; ok: boolean }[] = [];
      for (const l of candidates) {
        try {
          await c.refreshListing(l.id);
          results.push({ id: l.id, ok: true });
        } catch {
          results.push({ id: l.id, ok: false });
        }
      }
      return { refreshed: results.filter((r) => r.ok).length, total: results.length, results, ...izuzeto };
    }),
);

// Oglasi koje vlasnik ne zeli automatski dizati. Iz prakse: neki artikli mu se ne isplati
// obnavljati ni izdvajati, a bez spiska ih dnevna obnova svaki put ponovo pokupi. Spisak zivi u
// klonu (.olx-pik/izuzeca.json) i cita ga i CLI cron obnova, ne samo ovaj alat.
server.registerTool(
  "olx_izuzeca",
  {
    title: "Oglasi koje ne dizati automatski",
    description:
      "Spisak oglasa koje vlasnik ne zeli da se automatski obnavljaju i/ili izdvajaju. Dnevna obnova ih preskace. Opseg: 'obnova', 'izdvajanje' ili 'sve'. Radnja 'lista' ne trazi ids.",
    inputSchema: {
      radnja: z.enum(["lista", "dodaj", "skloni"]),
      ids: z.array(z.number().int()).optional().describe("id-evi oglasa; obavezno za dodaj i skloni"),
      opseg: z.enum(OPSEZI).default("sve"),
      razlog: z.string().optional().describe("kratko zasto, da se poslije zna"),
    },
  },
  async (args) => {
    try {
      const izuzeca = ucitajIzuzeca();
      if (args.radnja === "lista") {
        const s = spisak(izuzeca);
        return ok({ ukupno: s.length, oglasi: s });
      }
      if (!args.ids || args.ids.length === 0) {
        return errResult(`Radnja '${args.radnja}' trazi ids.`);
      }
      const kada = new Date().toISOString();
      let novo = izuzeca;
      for (const id of args.ids) {
        novo =
          args.radnja === "dodaj"
            ? saDodatim(novo, id, args.opseg, args.razlog ?? null, kada)
            : bezSklonjenog(novo, id, args.opseg);
      }
      upisiIzuzeca(novo);
      const s = spisak(novo);
      return ok({ radnja: args.radnja, opseg: args.opseg, dodirnuto: args.ids.length, ukupno: s.length, oglasi: s });
    } catch (e) {
      return errResult(String(e instanceof Error ? e.message : e));
    }
  },
);

server.registerTool(
  "olx_hide_listing",
  { title: "Sakrij oglas", description: "Sakriva oglas (preporuceno umjesto brisanja kad artikla nema na stanju).", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: writeOp },
  (args) => run((c) => c.hideListing(args.id)),
);

server.registerTool(
  "olx_unhide_listing",
  { title: "Otkrij oglas", description: "Vraca skriveni oglas u pretragu.", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: writeOp },
  (args) => run((c) => c.unhideListing(args.id)),
);

server.registerTool(
  "olx_finish_listing",
  {
    title: "Zavrsi oglas",
    description:
      "Oznacava oglas kao zavrsen/prodano (cuva historiju i statistiku). Kad korisnik trazi BRISANJE oglasa, predlozi ovo: oglas ide u Zavrsene, ostaje u historiji profila kao dokaz prodaje i ne gubi se statistika. Brisanje kroz bota ne postoji, samo u CLI (listings rm).",
    inputSchema: { id: z.union([z.number(), z.string()]) },
    annotations: destructiveOp,
  },
  (args) => run((c) => c.finishListing(args.id)),
);

server.registerTool(
  "olx_upload_images",
  {
    title: "Dodaj slike",
    description:
      "Dodaje slike na oglas (multipart, polje images[]; API ne prihvata image_url). urls = slike sa interneta (server ih preuzme pa posalje kao fajl). file_paths = lokalni fajlovi na masini gdje radi server. Zadaj bar jedno. Tok: kreiraj oglas, dodaj slike, postavi glavnu (olx_set_main_image), pa objavi.",
    inputSchema: {
      id: z.union([z.number(), z.string()]),
      urls: z.array(z.string()).optional().describe("URL-ovi slika"),
      file_paths: z.array(z.string()).optional().describe("putanje lokalnih fajlova na serveru"),
    },
    annotations: writeOp,
  },
  (args) =>
    run(async (c) => {
      if (!args.urls?.length && !args.file_paths?.length) {
        throw new Error("Zadaj urls ili file_paths.");
      }
      const result: Record<string, unknown> = {};
      if (args.urls?.length) result.by_url = await c.uploadImagesByUrl(args.id, args.urls);
      if (args.file_paths?.length) result.by_file = await c.uploadImageFiles(args.id, args.file_paths);
      return result;
    }),
);

server.registerTool(
  "olx_set_main_image",
  {
    title: "Glavna slika",
    description: "Postavlja glavnu sliku oglasa po imageId (id slike iz odgovora uploada).",
    inputSchema: { id: z.union([z.number(), z.string()]), imageId: z.number().int() },
    annotations: writeOp,
  },
  (args) => run((c) => c.setMainImage(args.id, args.imageId)),
);

server.registerTool(
  "olx_delete_image",
  {
    title: "Obrisi sliku",
    description: "Brise sliku sa oglasa po imageId.",
    inputSchema: { id: z.union([z.number(), z.string()]), imageId: z.number().int() },
    annotations: destructiveOp,
  },
  (args) => run((c) => c.deleteImage(args.id, args.imageId)),
);

// ===== TROSAK KREDITA =====

server.registerTool(
  "olx_sponsor_listing",
  {
    title: "Izdvoji oglas",
    description:
      "Izdvaja oglas i TROSI KREDITE. confirm=false (default) vraca samo cijenu i ne naplacuje. confirm=true naplacuje. Najjaca kombinacija je type 2 + refresh_every 3/8/24.",
    inputSchema: {
      id: z.union([z.number(), z.string()]),
      type: z.number().int().min(0).max(2).describe("0 bez, 1 klasicno, 2 premium"),
      days: SPONSOR_DAYS_SCHEMA,
      refresh_every: REFRESH_EVERY_SCHEMA,
      homepage: z.boolean().default(false),
      locations: z.array(z.string()).optional().describe("dodatne lokacije izdvajanja; dokumentovana je samo \"homepage\", ostale API moze odbiti sa 422"),
      confirm: z.boolean().default(false),
    },
    annotations: trosakOp,
  },
  (args) => {
    const options = parseSponsorOptions({
      type: args.type,
      days: args.days,
      refreshEvery: args.refresh_every,
      homepage: args.homepage,
      locations: args.locations,
    });
    return run((c) => c.sponsorListing(args.id, options, args.confirm));
  },
);

server.registerTool(
  "olx_set_discount",
  {
    title: "Akcijska cijena",
    description: "Postavlja akcijsku cijenu (premium, TROSI KREDITE). confirm=true obavezno za izvrsenje. days: 3,7,30.",
    inputSchema: {
      id: z.union([z.number(), z.string()]),
      price: z.number().positive(),
      days: z.union([z.literal(3), z.literal(7), z.literal(30)]),
      confirm: z.boolean().default(false),
    },
    annotations: trosakOp,
  },
  (args) => run((c) => c.setDiscount(args.id, { price: args.price, days: args.days }, args.confirm)),
);

server.registerTool(
  "olx_finish_discount",
  { title: "Zavrsi akcijsku cijenu", description: "Zavrsava aktivnu akcijsku cijenu na oglasu.", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: writeOp },
  (args) => run((c) => c.finishDiscount(args.id)),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const acc = client.hasToken() ? "token je postavljen" : "BEZ TOKENA (pozivi ce vracati 401)";
  console.error(`olx-pik-mcp-server radi preko stdio. ${acc}`);
}

main().catch((e) => {
  console.error("Greska servera:", e);
  process.exit(1);
});
