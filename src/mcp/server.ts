#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { OlxClient, OlxSpendError, OlxPravilaError, OlxApiError, naknadaKategorije } from "../core/index.js";
import { objasniPogotke, provjeriRobu } from "../core/zabranjena-roba.js";
import { loadConfig } from "../core/config.js";
import { pokrenutDirektno } from "../core/ulaz.js";
import { linkOglasa } from "../core/link.js";
import { procitajPrijedlog, spisakPrijedloga } from "../core/prijedlozi.js";
import { nadjiSablon } from "../core/opisi.js";
import { POLJA, bezNapomene, bezPolja, saNapomenom, saPoljem, ucitajPamcenje, upisiPamcenje } from "../core/pamcenje.js";
import { withAuditContext } from "../core/audit.js";
import { VERZIJA } from "../core/verzija.js";
import { parseSponsorOptions } from "../core/sponsor-options.js";
import { odaberiStrategiju, odsijeciSpisak, podijeliUKomade, uputaZaNepotpun } from "../core/obuhvat.js";
import { suziKategorijeIndeks } from "../core/kategorije-indeks.js";
import {
  efekatIzdvajanja,
  izracunajNoveCijene,
  obuhvatIz,
  pragObnove,
  kompaktCsv,
  kompaktList,
  kompaktListing,
  mrtviOglasi,
  provjeriNacrt,
  type OglasPregledi,
} from "../core/stats.js";
import { onboardingMarkdown, onboardingTelegram } from "../core/izvjestaj.js";
import { ucitajSnapshote, zadnjiSnapshot } from "../core/snapshoti.js";
import { nadjiPoUpitu } from "../core/match.js";
import { PLAN_FILE, upisiPlan, zauzmiKljuc } from "../core/plan-fajl.js";
import { buildPlan, planSazetak, type PlanKandidat } from "../core/plan.js";
import { opisiSliku, vidKonfigurisan } from "../core/vid.js";
import { OPSEZI, bezSklonjenog, odvojiIzuzete, preneseno, saDodatim, spisak, ucitajIzuzeca, upisiIzuzeca } from "../core/izuzeca.js";
import { kompaktSpisak, mapaZapisa, noviZapis, planVracanja, preuzmiSlike, saOznakomObjave, ucitajSveZapise, ucitajZapis, upisiZapis, velicinaArhive } from "../core/arhiva.js";
import type { Listing, ListingSummary, SviOglasi } from "../core/types.js";
import { INTERVAL_MAX, STRATEGIJE, intervalUzPrag, normalizujRitam, ritamZapisan, ucitajRitam, upisiRitam } from "../core/ritam-obnova.js";
import { procitajOverride, upisiOverride } from "../core/slika-limit.js";
import { POZADINA_OPIS_MAX, obrisiPozadinu, sacuvajPozadinu, sazetakPozadine, ucitajPozadinu } from "../core/pozadina.js";
import { DOPUNA_MAX, ODNOSI, RECEPTI, RECEPT_POZADINA, ZADANI_ODNOS, generisiSliku, maxDnevno, provjeriDopunu, provjeriZahtjevSlike, slikaKonfigurisana, type Odnos } from "../core/slika.js";
import { oznaciPotrosene, pocistiPotrosene } from "../core/slike-ciscenje.js";
import { zapisiZahtjevSlike } from "../core/slike-trag.js";
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
// envFajl: na 401 se procita `.env` i preuzme nov token bez restarta sesije. Bitno jer se
// `.env` cita jednom pri startu, a onboarding ga upisuje dok sesija vec radi.
const client = new OlxClient(config, { envFajl: ".env" });

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

// Radnja koja mijenja stanje (cijena, sklanjanje) nad nepotpunom listom bi tiho preskocila
// oglase koje nije vidjela, sto je gore od odbijanja. Zato oba grupna alata koja mijenjaju
// stanje staju ovdje umjesto da nastave nad djelomicnim spiskom.
function odbijNepotpunKatalog(svi: SviOglasi, sta: string) {
  const obuhvat = obuhvatIz(svi);
  return {
    odbijeno: true,
    razlog: "nepotpun_katalog",
    obuhvat,
    uputa: uputaZaNepotpun(svi.razlog, sta, obuhvat.procitano, obuhvat.ukupno),
  };
}

// Jedan automatski ponovni pokusaj SAMO kad je razlog "katalog_se_mijenjao": taj razlog se
// postavlja tek kad su SVE stranice vec procitane (meta.total se pomjerio izmedju prve i
// zadnje), dakle budzet nije bio potrosen. Najgori slucaj je dvostruko vrijeme citanja, i dalje
// unutar grupnog budzeta i MCP zida. Za "budzet" i "osigurac" ponovni pokusaj ne bi pomogao (isti
// razlog bi se opet desio), zato se ne pokusava.
async function procitajKatalogSaPonavljanjem(c: OlxClient, user: string): Promise<SviOglasi> {
  let svi = await c.listAllActive(user, { budzetMs: config.budzetListeGrupniMs });
  if (!svi.potpuno && svi.razlog === "katalog_se_mijenjao") {
    svi = await c.listAllActive(user, { budzetMs: config.budzetListeGrupniMs });
  }
  return svi;
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
    if (e instanceof OlxPravilaError) {
      return errResult(
        `${e.message}\nPitaj korisnika zeli li ipak, pa tek onda pozovi ponovo sa potvrdi_spornu_robu: true. Odgovornost ostaje na vlasniku naloga.`,
      );
    }
    if (e instanceof OlxApiError) {
      // Prikazi tijelo odgovora (npr. 422 validacija po poljima) da se vidi sta tacno fali.
      const detail = e.body !== undefined ? `\n${JSON.stringify(e.body, null, 2)}` : "";
      return errResult(`${e.message}${detail}`);
    }
    return errResult(String(e instanceof Error ? e.message : e));
  }
}

// Ime servera je namjerno literal i ne izvodi se iz package.json ("olx-pik-toolkit"): server je
// u Claude konfiguraciji registrovan kao "olx-pik", pa promjena identiteta u handshakeu pokvari
// postojece registracije. Verzija se povlaci, ime ne.
const server = new McpServer({ name: "olx-pik-mcp-server", version: VERZIJA });

// Svaki alat se izvrsava unutar audit konteksta sa svojim imenom, da zapis u audit logu kaze
// koja je radnja pokrenula poziv. Omotano je na jednom mjestu, pa registracije alata nize ostaju
// obicni registerTool pozivi (i cuvaju tipove svojih shema). Kontekst ide kroz AsyncLocalStorage,
// pa se dva preklopljena poziva alata ne mogu pomijesati.
//
// Isti wrapper nosi i filter profila. Alati iz SAMO_ADMIN se u profilu `klijent` uopste ne
// registruju, pa njihove seme ne ulaze u kontekst. To su redom pretraga i dumpovi kategorija,
// brendova, modela i lokacija: najveci payloadi u serveru, a klijentu ne trebaju jer lokacija
// dolazi iz .env, a kategoriju bira `olx_suggest_category` pri objavi.
export const SAMO_ADMIN = new Set([
  "olx_sablon_opisa",
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
  // Javni profil tudjeg shopa je drugi ulaz u istu stvar koju `olx_competitor_report` vec zatvara,
  // pa ide sa njim. Klijent za SVOJ nalog nista ne gubi: `olx_profile_stats` u jednom pozivu daje
  // paket i njegov istek, kredite, kvotu obnova i oglase po stanjima.
  "olx_user_profile",
  // Brana troska (zastita racuna kod vanjskog AI-ja): samo administrator smije danas podici
  // dnevni plafon generisanja slika.
  "olx_limit_slika",
]);

const zaKlijenta = config.mcpProfil === "klijent";

/**
 * Brana na tudji nalog u klijentskom profilu.
 *
 * Izbacivanje alata za konkurenciju iz klijentskog profila ne vrijedi nista dok drugi alat prima
 * `user` i vraca tudji katalog sa cijenama. Zato se u klijentskom profilu poziv odbija cim je
 * `user` UOPSTE zadan: ne poredi se sa vlastitim nalogom, jer bi to trazilo dodatni poziv i granu,
 * a klijentu `user` ionako nikad ne treba (bez njega se cita njegov vlastiti katalog).
 *
 * Poruka mora reci sta da se uradi umjesto toga, inace model pokusa isto ponovo.
 */
function odbijTudjiNalog(user: string | undefined): ToolResult | undefined {
  if (!zaKlijenta || user === undefined) return undefined;
  return errResult(
    "Rad sa tudjim nalogom nije dostupan. Izostavi user i poziv ce vratiti tvoj vlastiti katalog.",
  );
}

// ===== Popis registracija, za generator popisa mogucnosti =====
//
// Isti omotac kroz koji ionako prolazi svaka registracija usput vodi i evidenciju o njoj. Zato
// `scripts/popis-mogucnosti.mjs` samo uveze ovaj modul i procita popis, umjesto da pokrece server
// i prica sa njim preko stdio (krhko i sporo) ili da parsira ovaj fajl (tiho pukne). Popis se
// puni pri svakom pokretanju servera, ali ga niko u radu ne cita, pa nista ne kosta.
//
// Zapisuje se PRIJE filtera profila, dakle uvijek puna lista. Ko je u kojem profilu se izvodi iz
// `SAMO_ADMIN`, pa jedan uvoz daje oba profila.

export interface ZapisAlata {
  ime: string;
  naslov?: string;
  opis?: string;
  /** Kljucevi ulazne seme, redom kako su zadati. */
  polja: string[];
  /** Ima li polje `confirm`, dakle da li je alat iza brane potvrde. */
  traziPotvrdu: boolean;
  /** `readOnlyHint` i `destructiveHint` iz anotacija, za razvrstavanje na citanje, upis i trosak. */
  samoCitanje?: boolean;
  razoran?: boolean;
  /** Ime uslova ako se alat registruje samo pod uslovom; inace prazno. */
  uslov?: string;
}

export interface ZapisResursa {
  ime: string;
  uri: string;
  naslov?: string;
  opis?: string;
}

export const POPIS_ALATA: ZapisAlata[] = [];
export const POPIS_RESURSA: ZapisResursa[] = [];

/**
 * Sta znaci koji uslov, obicnim jezikom. Kljuc se postavlja kroz `uslovRegistracije` oko uslovne
 * grane registracija, a ovdje stoji objasnjenje koje generator ispisuje covjeku.
 */
export const USLOVI: Record<string, string> = {
  vid: "samo kad je podesen Gemini kljuc za vid (OLX_VID_API_KEY ili OLX_SLIKA_API_KEY)",
  slika: "samo kad je podesen kljuc za generisanje slika (OLX_SLIKA_API_KEY)",
};

/**
 * Uslov pod kojim se registruju alati koji slijede. Postavlja se oko uslovne grane i odmah vraca
 * na prazno. Bez ovoga bi alat koji postoji samo uz vanjski kljuc na masini bez tog kljuca tiho
 * nestao iz popisa mogucnosti, umjesto da u njemu stoji sa napomenom pod kojim uslovom radi.
 */
let uslovRegistracije: string | undefined;

/**
 * Otvara uslovnu granu registracija. Ime uslova MORA biti opisano u `USLOVI`.
 *
 * Zasto baca umjesto da preskoci: oba uslova su danas prosta provjera env kljuca, pa generator
 * popisa uveze server sa postavljenim kljucevima i tako vidi i te alate. Kad bi neko dodao granu
 * pod uslovom koji generator ne zna uciniti tacnim, alati u njoj bi tiho nestali iz popisa, sto je
 * tacno bolest zbog koje popis uopste postoji. Ovako se to sazna odmah, i to kroz `npm test`, jer
 * provjera svjezine popisa uvozi ovaj modul.
 */
function pocniUslov(ime: string): void {
  if (!(ime in USLOVI)) {
    throw new Error(
      `Uslovna registracija "${ime}" nije opisana u USLOVI (src/mcp/server.ts). ` +
        "Dodaj opis i pobrini se da ga scripts/popis-mogucnosti.mjs moze uciniti tacnim.",
    );
  }
  uslovRegistracije = ime;
}

function zavrsiUslov(): void {
  uslovRegistracije = undefined;
}

const registrujAlat = server.registerTool.bind(server);
server.registerTool = ((name: string, toolConfig: unknown, handler: (args: never) => unknown) => {
  const cfg = toolConfig as {
    title?: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  };
  const polja = Object.keys(cfg.inputSchema ?? {});
  POPIS_ALATA.push({
    ime: name,
    naslov: cfg.title,
    opis: cfg.description,
    polja,
    traziPotvrdu: polja.includes("confirm"),
    samoCitanje: cfg.annotations?.readOnlyHint,
    razoran: cfg.annotations?.destructiveHint,
    ...(uslovRegistracije ? { uslov: uslovRegistracije } : {}),
  });
  if (zaKlijenta && SAMO_ADMIN.has(name)) return undefined as never;
  return registrujAlat(
    name,
    toolConfig as never,
    ((args: never) => withAuditContext({ operation: name, source: "mcp" }, () => handler(args))) as never,
  );
}) as typeof server.registerTool;

const registrujResurs = server.registerResource.bind(server);
server.registerResource = ((name: string, uri: unknown, metadata: unknown, ...ostalo: unknown[]) => {
  const meta = metadata as { title?: string; description?: string } | undefined;
  POPIS_RESURSA.push({
    ime: name,
    // Obicni resursi imaju URI kao string; sablon (ResourceTemplate) nosi obrazac u sebi.
    uri: typeof uri === "string" ? uri : String((uri as { uriTemplate?: unknown })?.uriTemplate ?? ""),
    naslov: meta?.title,
    opis: meta?.description,
  });
  return (registrujResurs as (...a: unknown[]) => unknown)(name, uri, metadata, ...ostalo);
}) as typeof server.registerResource;

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

// ---- CSV index kategorija: SAMO gornji nivoi (za orijentaciju, ne za konacan izbor) ----
// Cijeli CSV ima >2000 redova; puni ga ne servira ni admin ni klijent profil. Rez je vidljiv kroz
// # napomenu na vrhu CSV-a (suziKategorijeIndeks u core).
//
// Uputa KOJIM alatom se ide dublje zavisi od profila: olx_find_category i olx_category_children su
// u SAMO_ADMIN, pa u klijentskom profilu ne postoje. Klijent kategoriju bira olx_suggest_category
// alatom. Zato i opis i napomena u CSV-u granaju po profilu; jedan tekst za oba bi klijenta slao
// na alat koji ne moze pozvati.
server.registerResource(
  "categories-index",
  "olx://categories-index",
  {
    title: "OLX/PIK index kategorija (CSV, samo gornji nivoi)",
    description: zaKlijenta
      ? "CSV sa SAMO gornjim nivoima stabla kategorija (kolone id, parent_id, level, path, name i zastavice brand_required, model_required, has_models, show_condition, listing_fee, base_listing_price); napomena na vrhu kaze koliko je redova prikazano od ukupno. Za konkretnu kategoriju koristi olx_suggest_category, a obavezna polja forme procitaj alatom olx_category_attributes <id>."
      : "CSV sa SAMO gornjim nivoima stabla kategorija (kolone id, parent_id, level, path, name i zastavice brand_required, model_required, has_models, show_condition, listing_fee, base_listing_price); napomena na vrhu kaze koliko je redova prikazano od ukupno. Kategoriju po imenu nadji alatom olx_find_category, spusti se niz stablo alatom olx_category_children <id>, a obavezna polja forme procitaj alatom olx_category_attributes <id>.",
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
    const puniCsv = readFileSync(CATEGORIES_CSV_PATH, "utf8");
    const { text } = suziKategorijeIndeks(puniCsv, undefined, zaKlijenta);
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
// Odvojeno od `confirm` namjerno: jedna zastavica za dvije razlicite stvari znaci da potvrda
// sporne robe tiho potvrdi i cijenu koju korisnik nikad nije cuo.
const POTVRDA_ROBE = z
  .boolean()
  .default(false)
  .describe("true tek nakon sto korisnik potvrdi oglas koji je javljen kao sporna roba");
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
      "Lista oglasa po stanju, svojih ili tudjih. Po stranici vraca kompaktne stavke, a all vraca cijeli katalog kao CSV sa zaglavljem (ista polja, 60% manje tokena). all i full se ne mogu kombinovati. Filteri category_id, price_min i price_max suzavaju rezultat u kodu i sluze da se iz kataloga od stotina artikala izvuce spisak ID-eva za grupne alate (olx_bulk_sklanjanje, olx_bulk_price, olx_izuzeca) bez rucnog prebiranja; sa all: true filter vazi nad cijelim katalogom, bez njega samo nad trazenom stranicom. Veliki katalog (all bez filtera) se isporucuje u komadima; sljedeci komad se trazi parametrom komad.",
    inputSchema: {
      state: z.enum(["active", "finished", "inactive", "expired", "hidden"]).default("active"),
      user: z.string().optional().describe("username ili id; default je ulogovani korisnik; u klijentskom profilu tudji nalog nije dostupan"),
      page: z.number().int().min(1).default(1),
      all: z.boolean().default(false).describe("prelistaj sve stranice datog stanja"),
      full: z.boolean().default(false).describe("sirovi API oblik umjesto kompaktnog"),
      category_id: z.number().int().optional().describe("zadrzi samo oglase te kategorije"),
      price_min: z.number().optional().describe("zadrzi samo oglase sa cijenom >= ove vrijednosti"),
      price_max: z.number().optional().describe("zadrzi samo oglase sa cijenom <= ove vrijednosti"),
      komad: z.number().int().min(1).default(1).describe("redni broj komada kod velikog kataloga; vrijedi samo uz all: true"),
    },
    annotations: readOnly,
  },
  (args) => {
    const tudji = odbijTudjiNalog(args.user);
    if (tudji) return Promise.resolve(tudji);
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
    // Filter radi u kodu, nad odgovorom koji je API vec vratio: /listings nosi category_id i
    // price po stavci (provjereno na zivom nalogu 13.08.2026.), pa filtriranje ne trazi ni
    // full: true ni dodatni poziv po oglasu. Filtrira se PRIJE kompaktiranja, jer kompaktan
    // oblik namjerno ne nosi category_id - na katalogu od par stotina redova ta kolona je cist
    // trosak tokena za svakog ko ne filtrira.
    const filterZadan = args.category_id !== undefined || args.price_min !== undefined || args.price_max !== undefined;
    const filtriraj = (stavke: ListingSummary[]): ListingSummary[] =>
      stavke.filter((o) => {
        if (args.category_id !== undefined && o.category_id !== args.category_id) return false;
        if (args.price_min !== undefined || args.price_max !== undefined) {
          // Oglas bez cijene ("na upit") ne moze zadovoljiti cjenovni raspon, pa ispada.
          const cijena = typeof o.price === "number" ? o.price : null;
          if (cijena === null) return false;
          if (args.price_min !== undefined && cijena < args.price_min) return false;
          if (args.price_max !== undefined && cijena > args.price_max) return false;
        }
        return true;
      });

    return run(async (c) => {
      const user = args.user ?? (await c.resolveUsername());
      if (args.all) {
        // Cijeli katalog ide kao CSV, ne kao niz objekata: imena polja ponovljena po oglasu su
        // vise od pola payloada, a CSV nosi ista polja uz 60% manje tokena (izmjereno, vidi
        // kompaktCsv). Na jednoj stranici razlika je mala pa tamo ostaje JSON.
        const sve = await c.listAllByState(args.state, user, { budzetMs: config.budzetListeMs });
        const suzeno = filterZadan ? filtriraj(sve.oglasi) : sve.oglasi;
        // Dijeljenje ide nad brojem koji STVARNO ide u odgovor: ako je filter zadan, to je
        // suzeno, a ne cijela nepotpuna/potpuna lista procitana sa API-ja.
        const podjela = podijeliUKomade(suzeno, config.maxOglasaUOdgovoru, args.komad);
        if (podjela.van_opsega) {
          return {
            odbijeno: true,
            razlog: "komad_van_opsega",
            komad: args.komad,
            komada_ukupno: podjela.komada_ukupno,
            uputa: `Trazen je komad ${args.komad}, a katalog ima ${podjela.komada_ukupno} komada. Trazi broj izmedju 1 i ${podjela.komada_ukupno}.`,
          };
        }
        const rezultat: Record<string, unknown> = {
          csv: kompaktCsv(podjela.stavke),
          ukupno: podjela.stavke.length,
        };
        if (filterZadan) rezultat.od_ukupno = sve.oglasi.length;
        if (!sve.potpuno) rezultat.obuhvat = obuhvatIz(sve);
        // Polja o komadima idu u odgovor SAMO kad komada stvarno ima vise od jednog. Mali katalog
        // je i dalje jedan odgovor kao i prije, bez ijednog novog polja: svako polje se placa
        // tokenima u svakom pozivu, a onome ko je dobio cijeli spisak ta polja ne znace nista.
        if (podjela.komada_ukupno > 1) {
          rezultat.ukupno_svih = suzeno.length;
          rezultat.komad = podjela.komad;
          rezultat.komada_ukupno = podjela.komada_ukupno;
          if (podjela.ima_jos) {
            rezultat.uputa = `Katalog ima jos komada. Sljedeci se dobija ponovnim pozivom sa komad: ${podjela.komad + 1}.`;
          }
        }
        return rezultat;
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
      if (!filterZadan) {
        return args.full ? stranica : { data: kompaktList(stranica.data), meta: stranica.meta };
      }
      // Bez all: true filter vidi samo jednu stranicu. Bez ove napomene "3 rezultata" izgleda
      // kao "3 u cijelom katalogu", a moze ih biti 300 na ostalim stranicama.
      const suzeno = filtriraj(stranica.data);
      const napomena = `Filter je primijenjen samo na stranicu ${stranica.meta.current_page} od ${stranica.meta.last_page}. Za cijeli katalog pozovi ponovo sa all: true.`;
      return args.full
        ? { data: suzeno, meta: stranica.meta, od_ukupno_na_stranici: stranica.data.length, napomena }
        : { data: kompaktList(suzeno), meta: stranica.meta, od_ukupno_na_stranici: stranica.data.length, napomena };
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
  { title: "Limiti obnove", description: "Limiti besplatne obnove sa naloga (free_limit, free_count, listing_count). Datum kad se kvota obnavlja API NE vraca; rok se izvodi iz ciklusa pretplate (dan iz shop.ends_at), a kalendarski mjesec nije rok i ne izgovara se (olx://pravila-brojeva).", inputSchema: {}, annotations: readOnly },
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
      let izborNacina: "od_kraja" | "pun_katalog" | undefined;
      let kandidataOgranicenoNa: number | undefined;
      if (args.oglasi && args.oglasi.length > 0) {
        kandidati = [];
        for (const id of args.oglasi) {
          const oglas = await c.getListing(id);
          kandidati.push({ id: Number(id), naslov: oglas.title, vec_izdvojen: Boolean(oglas.sponsored) });
        }
      } else {
        // Automatski odabir preskace oglase koje je vlasnik izuzeo od izdvajanja. Kad ID-eve
        // navede sam (grana iznad), to je izricita zelja i izuzece se ne primjenjuje.
        //
        // Trazi se NAJSTARIJE aktivne oglase. Lista sa API-ja dolazi tako da su najskorije
        // obnovljeni oglasi prvi, pa upravo zadnje stranice kataloga nose najstarije oglase:
        // ako bi se ovdje citalo sa pocetka i stalo na budzetu, odsjekao bi se bas onaj dio
        // kataloga u kojem su najstariji oglasi, i predlozili bi se kandidati koji uopste nisu
        // najstariji. To nije nepotpun rezultat nego sistemski pogresan, zato se prvo pokusava
        // citanje od kraja (koje to odsijecanje izbjegava), uz provjeru da poredak stvarno
        // stoji (nije dokumentovan, vidi olx://knowledgebase); kad provjera ili broj kandidata
        // ne prodju, radnja pada na puno citanje kataloga i, ako ni ono nije potpuno, odbija se.
        let izbor: "od_kraja" | "pun_katalog";
        const rezervaZaFilter = args.broj_oglasa * 3 + 20;
        const odKraja = await c.listNajstarijiAktivni(user, {
          najmanje: rezervaZaFilter,
          budzetMs: config.budzetListeMs,
        });
        const filtriraniOdKraja = odKraja.poredakPouzdan
          ? odvojiIzuzete(
              odKraja.oglasi.filter((l) => !l.sponsored),
              ucitajIzuzeca(),
              "izdvajanje",
            ).prolaze
          : [];

        let kandidatiOglasa: ListingSummary[];
        if (odKraja.poredakPouzdan && filtriraniOdKraja.length >= args.broj_oglasa) {
          izbor = "od_kraja";
          kandidatiOglasa = filtriraniOdKraja;
        } else {
          izbor = "pun_katalog";
          const svi = await procitajKatalogSaPonavljanjem(c, user);
          if (!svi.potpuno) return odbijNepotpunKatalog(svi, "Prijedlog izdvajanja");
          const { prolaze: prolazePunKatalog } = odvojiIzuzete(
            svi.oglasi.filter((l) => !l.sponsored),
            ucitajIzuzeca(),
            "izdvajanje",
          );
          kandidatiOglasa = prolazePunKatalog;
        }

        // Cijena je poziv po kandidatu (~0,57 s); uz grupni budzet od 120 s i krov
        // prekoracaja od ~107 s, svih 100 (max `broj_oglasa`) cijena bi doslo preblizu MCP
        // zidu od 300000 ms, zato se u ovoj (sporijoj) grani krug cijena ogranicava na 40.
        const sortirani = kandidatiOglasa.sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
        const gornjaGranica = izbor === "pun_katalog" ? Math.min(args.broj_oglasa, 40) : args.broj_oglasa;
        kandidati = sortirani.slice(0, gornjaGranica).map((l) => ({ id: l.id, naslov: l.title }));

        izborNacina = izbor;
        if (izbor === "pun_katalog" && gornjaGranica < args.broj_oglasa) {
          kandidataOgranicenoNa = gornjaGranica;
        }
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
        ...(izborNacina ? { izbor: izborNacina } : {}),
        ...(kandidataOgranicenoNa !== undefined ? { kandidata_ograniceno_na: kandidataOgranicenoNa } : {}),
        sacuvan: Boolean(args.sacuvaj),
        napomena: "Nista nije naplaceno. Pojedinacni termin se izvrsava kroz olx_sponsor_listing uz potvrdu.",
      };
    }),
);

// Vision proxy za sesije ciji glavni model nema vid (DeepSeek ignorise slike). Iskljucivo
// Gemini; registruje se SAMO kad postoji Gemini kljuc (OLX_SLIKA_API_KEY ili OLX_VID_API_KEY):
// klonovi na pretplati vide slike direktno i ovu semu ne placaju u kontekstu.
// Oznaka uslova stoji oko grane i vraca se odmah iza nje: alat koji postoji samo uz vanjski
// kljuc mora u popisu mogucnosti stajati sa napomenom, a ne nestati na masini bez kljuca.
pocniUslov("vid");
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
zavrsiUslov();

// Generisanje slike oglasa. Registruje se SAMO kad je OLX_SLIKA_API_KEY postavljen, isto kao
// vision proxy. Kosta vanjski AI racun (ne OLX kredite), pa nosi confirm branu i dnevni plafon.
//
// Sema recepta se razlikuje po profilu, i to je prva od dvije brane nad sadrzajem. U klijentskom
// profilu slobodan tekst nije opcija koju model uopste VIDI, pa je ni ne pokusa; odbijanje je
// validaciono i ne kosta nijedan token kod Geminija. Druga brana je u jezgru
// (provjeriZahtjevSlike), jer ona vazi za svakog pozivaoca, ne samo za MCP.
const receptSema: z.ZodType<string> = zaKlijenta
  ? z.enum(Object.keys(RECEPTI) as [string, ...string[]]).describe(`ime recepta: ${Object.keys(RECEPTI).join(", ")}`)
  : z
      .string()
      .min(3)
      .describe(`ime recepta (${Object.keys(RECEPTI).join(", ")}) ili slobodna uputa na engleskom`);

pocniUslov("slika");
if (slikaKonfigurisana()) {
  server.registerTool(
    "olx_generiraj_sliku",
    {
      title: "Napravi sliku oglasa iz fotografije",
      description:
        "Iz poslane fotografije ili slike sa objavljenog oglasa napravi novu sliku artikla: cist prostor i " +
        "ravno svjetlo. VAZNO: model sliku PRECRTAVA, ne retusira, pa na slozenoj fotografiji (vise " +
        "artikala, sitni natpisi, brendovi) izmislja detalje i takva slika laze kupca; koristi ga za JEDAN " +
        "prepoznatljiv predmet i UVIJEK daj korisniku da uporedi staru i novu prije objave. Ne trosi OLX " +
        "kredite nego vanjski AI racun, pa bez confirm true samo vrati sta bi radio i stanje dnevnog " +
        "plafona. Vraca putanju nove slike, spremnu za olx_upload_images ili za slanje na odobrenje.",
      inputSchema: {
        recept: receptSema,
        dopuna: z
          .string()
          .max(DOPUNA_MAX)
          .optional()
          .describe(
            "kratko podesavanje scene koje je trazio korisnik, npr. pozadina svijetlo siva; samo uz " +
              "recept koji ima ulaznu fotografiju",
          ),
        slike: z
          .array(z.string().min(1))
          .optional()
          .describe("putanje poslanih fotografija ILI URL-ovi slika sa objavljenog oglasa; prva je glavna"),
        logo: z.string().optional().describe("ime firme koje ide na tablu u pozadini, samo za recepte koji ga koriste"),
        odnos: z.enum(ODNOSI).optional().describe(`odnos strana, default ${ZADANI_ODNOS} jer je kartica oglasa pejzazna`),
        confirm: z.boolean().optional().describe("true tek nakon sto korisnik potvrdi"),
      },
    },
    async (args) => {
      const plafon = maxDnevno();
      const danas = brojPozivaDanas("slika");
      // Ista brana kao u jezgru, ali OVDJE, prije potvrde: bez toga bi korisnik potvrdio potez
      // koji ionako pada, pa bi na kraju dobio gresku umjesto odgovora.
      const nalaz = provjeriZahtjevSlike({
        recept: args.recept,
        dopuna: args.dopuna,
        ulaznihSlika: args.slike?.length ?? 0,
        profil: config.mcpProfil,
      });
      if (!nalaz.ok) {
        // Trag pise ona brana koja je zahtjev zaustavila, pa je uvijek tacno jedan zapis po
        // zahtjevu: ovdje kad padne ovdje, u jezgru kad prodje dovde.
        zapisiZahtjevSlike({
          recept: args.recept,
          dopuna: args.dopuna,
          ulaznihSlika: args.slike?.length ?? 0,
          odbijeno: true,
          razlog: nalaz.razlog,
        });
        return errResult(`Ovaj zahtjev se ne moze uraditi: ${nalaz.razlog}.`);
      }
      if (!args.confirm) {
        return ok({
          napravljeno: false,
          trazi_potvrdu: true,
          recept: args.recept,
          dopuna: args.dopuna ?? null,
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
            dopuna: args.dopuna,
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

  // Stalna pozadina klijenta: zada se jednom, poslije samo recept "pozadina-klijenta". Ide u
  // OBA profila jer je to postavka koju covjek radi za sebe, ne trosak i ne izmjena oglasa.
  server.registerTool(
    "olx_pozadina",
    {
      title: "Stalna pozadina za slike",
      description:
        "Pozadina koju recept pozadina-klijenta koristi umjesto bijelog studija, da svi oglasi imaju isti prostor. " +
        "postavi = zapamti opis i/ili sliku pozadine (slika se kopira u klon, pa smije nestati iz inboxa); " +
        "prikazi = sta je sada postavljeno; ukloni = vrati se na bijelu podlogu. VAZNO reci korisniku: pozadina se " +
        "svaki put crta iznova, pa je SLICNA a nikad identicna, a tekst i logo na pozadini ce biti iskrivljeni.",
      inputSchema: {
        radnja: z.enum(["postavi", "prikazi", "ukloni"]),
        opis: z
          .string()
          .max(POZADINA_OPIS_MAX)
          .optional()
          .describe(
            "scena rijecima, npr. svijetlo sivi beton; ulazi u prompt na engleskom, pa prevedi ono " +
              "sto je korisnik rekao; samo uz radnju postavi",
          ),
        slika: z.string().min(1).optional().describe("putanja fotografije pozadine koju je poslao korisnik"),
      },
      annotations: writeOp,
    },
    async (args) => {
      if (args.radnja === "prikazi") {
        const pozadina = ucitajPozadinu();
        return ok(
          pozadina
            ? { postavljena: true, ...pozadina, sazetak: sazetakPozadine(pozadina) }
            : { postavljena: false, napomena: `Pozadina nije postavljena, pa recept ${RECEPT_POZADINA} nije dostupan.` },
        );
      }
      if (args.radnja === "ukloni") {
        const bilo = obrisiPozadinu();
        return ok({
          uklonjena: bilo,
          napomena: bilo ? "Slike se ponovo prave na bijeloj podlozi." : "Pozadina ni nije bila postavljena.",
        });
      }
      // Opis pozadine prolazi ISTI filter kao dopuna na receptu: on ide u prompt, pa je za njega
      // nebitno kojim ga je putem covjek unio.
      if (args.opis) {
        const nalaz = provjeriDopunu(args.opis, POZADINA_OPIS_MAX);
        if (!nalaz.ok) return errResult(`Opis pozadine se ne moze prihvatiti: ${nalaz.razlog}.`);
      }
      const rezultat = sacuvajPozadinu({ opis: args.opis, izvorSlike: args.slika });
      if (!rezultat.ok) return errResult(`Pozadina nije sacuvana: ${rezultat.razlog}.`);
      return ok({
        postavljena: true,
        ...rezultat.pozadina,
        sazetak: sazetakPozadine(rezultat.pozadina),
        napomena:
          `Od sada recept ${RECEPT_POZADINA} stavlja artikle na ovu pozadinu. Ona se svaki put crta iznova, ` +
          "pa dva oglasa nece imati doslovno istu pozadinu.",
      });
    },
  );
}
zavrsiUslov();

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
      "Prva analiza shopa u jednom pozivu: neiskoristene besplatne obnove i dnevni tempo do reseta kvote, oglasi sa nedostacima, svjezina, pregledi i upiti, rangirana lista prvih poteza. Rok reseta ide po ciklusu pretplate, ne po kalendarskom mjesecu; kad rok nije poznat, dana_do_reseta je null i ne izgovara se.",
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
      // Treba samo zadnji snapshot, ne cijela serija: zadnjiSnapshot() cita fajlove od
      // najnovijeg unazad i staje na prvom ispravnom, umjesto da parsira do 120 fajlova.
      const zadnji = args.bez_snapshota ? null : zadnjiSnapshot();
      // MCP zid je 300000 ms; razgovor ceka odgovor, pa se prelistavanje ogranicava grupnim
      // budzetom. CLI (src/cli/index.ts) isti poziv radi bez budzeta, jer tamo niko ne ceka.
      const rezultat = await c.statsOnboarding(
        zadnji ? { oglasi: zadnji.oglasi, ts: zadnji.ts } : undefined,
        { budzetMs: config.budzetListeGrupniMs },
      );
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
      "Pregled vlastitog naloga u jednom pozivu: paket i njegov istek (shop.ends_at), krediti, iskoristenost kvote obnova (bez roka reseta, za rok je olx_refresh_limits), oglasi po stanjima, cijene, udio sponzorisanih, neobnovljeni oglasi, te objava_limit: popunjenost limita broja oglasa po grupama kategorija (preostalo, procenat, status slobodno/blizu_limita/dostignut). Kad je neka grupa blizu limita ili dostignuta, dodaje se i objava_kandidati_predlog, spisak najduze neobnavljanih oglasa kao prijedlog sta prvo skloniti; kriterij je starost obnove, NE broj pregleda, i to je prijedlog za vlasnika a ne automatska radnja. Polje nova_pitanja je neprovjeren brojac sa API-ja: ne iznositi ga korisniku kao cinjenicu.",
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
        // Isto: treba samo zadnji snapshot, ne cijela serija ucitana radi jednog elementa.
        const zadnji = zadnjiSnapshot();
        if (!zadnji) {
          // Isti razlog kao kod onboarding izvjestaja: MCP zid je 300000 ms, pa razgovorni poziv
          // dobija grupni budzet umjesto neogranicenog prelistavanja. CLI ovaj poziv radi bez
          // budzeta.
          return c
            .statsProfil({ budzetMs: config.budzetListeGrupniMs })
            .then((r) => ({ ...r, napomena: "Nema snapshota u .olx-pik/snapshots; pokreni CLI 'stats snapshot'. Vracena statistika bez pregleda." }));
        }
        const pregledi: OglasPregledi[] = zadnji.oglasi.map((o) => ({
          id: o.id,
          title: o.title,
          views: o.views,
          questions: o.questions,
          created_at: o.created_at,
        }));
        const r = await c.statsProfil({ pregledi, budzetMs: config.budzetListeGrupniMs });
        return { ...r, snapshot_ts: zadnji.ts };
      }
      return c.statsProfil({ viewsMode: args.views, sampleVelicina: args.sample_size, budzetMs: config.budzetListeGrupniMs });
    }),
);

server.registerTool(
  "olx_competitor_report",
  {
    title: "Izvjestaj o konkurentu",
    description:
      "Analiza tudjeg naloga iz javnih podataka u jednom pozivu: paket, aktivnost, ocjene, broj aktivnih i zavrsenih oglasa, cijene (min/median/max), udio sponzorisanih i akcija, kadenca obnove. top_views > 0 dodatno vraca izvjestaj (ukljucujuci preglede) za N najskorije obnovljenih oglasa. Konkurenta zadaj po username-u (nema pretrage po kategoriji). Postoci vrijede za dio kataloga u polju obuhvat, ne za cijeli shop kad on kaze da uzorak nije potpun.",
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
      "Brza provjera naloga (4 API poziva): paket pri isteku, saldo kredita ispod praga, slabo iskoristena kvota obnova pred resetom, istekli oglasi za reaktivaciju, popunjenost limita objave po grupama kategorija. Reset kvote ide po ciklusu pretplate, ne po kalendarskom mjesecu. Alarmi 'paket' i 'objava_limit' nose polje nivo (info, upozorenje, hitno) da se zna sta gori a sta samo tinja; ostali alarmi su binarni i nemaju nivo. Vraca ok: true kad je sve cisto. Samo dva praga se mogu postaviti.",
    inputSchema: {
      krediti_min: z.number().int().min(0).optional().describe("prag salda kredita, default 500"),
      paket_dana: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("mijenja SAMO srednji prag isteka paketa (nivo upozorenje), default 14; nivoi info i hitno ostaju 30 i 3"),
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
      // Prozor NIJE suzen: efekatIzdvajanja racuna segmente "prije" i "poslije" perioda bez
      // gornje granice unazad/unaprijed, a period (od_ts/do_ts) moze biti proizvoljno star
      // (rucno zadan ili iz proslog sponsor_active). Kratak prozor bi tiho odsjekao "prije"
      // segment i pretvorio validan izracun u upozorenje "nema dovoljno snapshota".
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
      const svi = await c.listAllByState(args.state, user, { budzetMs: config.budzetListeMs });
      const pogodci = nadjiPoUpitu(
        args.upit,
        svi.oglasi.map((o) => ({ id: o.id, title: o.title, price: typeof o.price === "number" ? o.price : undefined })),
        args.limit,
      );
      // "Nema pogodaka" nad nepotpunim katalogom je negativan zakljucak iz nepotpunog skupa,
      // isti razred greske kao lazan spisak "nisu aktivni" u olx_bulk_sklanjanje. Ne tvrdi se da
      // oglas ne postoji, nego se odbija sa jasnim razlogom.
      if (pogodci.length === 0 && !svi.potpuno) {
        const obuhvat = obuhvatIz(svi);
        return {
          odbijeno: true,
          razlog: "nepotpun_katalog",
          obuhvat,
          uputa:
            `Oglas nije nadjen u dijelu kataloga koji je procitan (${obuhvat.procitano} od ${obuhvat.ukupno ?? "nepoznato"} oglasa, razlog: ${svi.razlog ?? "nepoznat"}). ` +
            "Katalog nije procitan u cijelosti, pa se ne moze tvrditi da oglas ne postoji. " +
            "Reci korisniku da moze dati broj oglasa direktno (tada ide olx_get_listing, bez ikakvog prelistavanja), " +
            "ili neka upit suzi na jednu rijec iz naslova, pa pokusaj ponovo.",
        };
      }
      // Napomena ide u REZULTAT namjerno: opis alata slabiji model zna preskociti, a ovo
      // procita uz svaki odgovor. Prag 0.35 samo mijenja formulaciju, nista ne filtrira
      // (zasto alat nema apsolutni prag: match.test.ts, test o pragovima).
      const najbolji = pogodci[0]?.skor ?? 0;
      const napomena =
        (najbolji < 0.35 ? `Najbolji skor je svega ${najbolji}: ovo su kandidati, ne nalaz. ` : "") +
        "Pretraga poredi rijeci naslova, pa artikli drugacijeg imena (npr. samo model) nisu obuhvaceni; za potpun popis grupe koristi olx_list_listings all:true pa sam odaberi.";
      return {
        upit: args.upit,
        pretrazeno: svi.oglasi.length,
        pogodci,
        napomena,
        ...(svi.potpuno ? {} : { obuhvat: obuhvatIz(svi) }),
      };
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
      // Sporna roba se javlja OVDJE, dok je oglas jos nacrt: kasnije brane u jezgru rade isto, ali
      // tek na kreiranju, a tada je korisnik vec potrosio vrijeme na pisanje.
      const sporno = provjeriRobu(args.title ?? "", args.description ?? "");
      return {
        ...provjeriNacrt(args, atributi.data ?? []),
        naknada_objave_kredita: naknada,
        ...(naknada > 0
          ? { napomena_troska: `Objava u ovoj kategoriji kosta ${naknada} kredita. Trazi potvrdu prije kreiranja.` }
          : {}),
        ...(sporno.length > 0
          ? {
              upozorenje_zabranjena_roba: {
                pogoci: sporno,
                napomena: `${objasniPogotke(sporno)} Reci to korisniku PRIJE kreiranja i pitaj zeli li ipak; kreiranje bez potvrdi_spornu_robu nece proci.`,
              },
            }
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
      potvrdi_spornu_robu: POTVRDA_ROBE,
    },
    annotations: writeOp,
  },
  (args) => {
    const { confirm, potvrdi_spornu_robu, ...nacrt } = args;
    return run(async (c) => {
      const oglas = await c.createListing(nacrt, { confirm, potvrdiRobu: potvrdi_spornu_robu });
      // Link ide uz odgovor jer ga API ne vraca, a korisnik ga trazi odmah poslije objave.
      return { ...oglas, link: linkOglasa(oglas.id, oglas.slug) };
    });
  },
);

server.registerTool(
  "olx_publish_listing",
  {
    title: "Objavi oglas",
    description:
      "Objavljuje DRAFT oglas (postaje aktivan i vidljiv) i vraca `link` na objavljeni oglas, koji obavezno posalji korisniku. Objava u naplatnoj kategoriji (vozila, nekretnine, poslovi, usluge) trazi confirm: bez njega vrati cijenu i ne objavi.",
    inputSchema: {
      id: z.union([z.number(), z.string()]),
      confirm: z.boolean().default(false).describe("true tek nakon sto korisnik potvrdi cijenu objave"),
      potvrdi_spornu_robu: POTVRDA_ROBE,
    },
    annotations: writeOp,
  },
  (args) =>
    run(async (c) => {
      const odgovor = await c.publishListing(args.id, {
        confirm: args.confirm,
        potvrdiRobu: args.potvrdi_spornu_robu,
      });
      // Slug se cita sa objavljenog oglasa, jer ga API generise iz naslova pri objavi. Kad se
      // citanje ne uspije, link bez sluga radi isto, pa se zbog toga objava ne prijavljuje kao pad.
      let slug: unknown;
      try {
        slug = (await c.getListing(args.id)).slug;
      } catch {
        slug = undefined;
      }
      return { ...odgovor, link: linkOglasa(args.id, slug) };
    }),
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
      confirm: z.boolean().default(false).describe("potrebno samo kad izmjena nosi category_id u naplatnu kategoriju"),
      potvrdi_spornu_robu: POTVRDA_ROBE,
    },
    annotations: writeOp,
  },
  (args) => {
    const { id, confirm, potvrdi_spornu_robu, ...patch } = args;
    return run((c) => c.updateListing(id, patch, { confirm, potvrdiRobu: potvrdi_spornu_robu }));
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
      "Mijenja cijenu na vise oglasa odjednom. pravilo: postotak (-10 znaci snizi 10 posto), fiksno (-5 znaci oduzmi 5), postavi (svima ista cijena). confirm=false (default) vraca samo pregled stara naspram nova, bez ijedne izmjene. Ne trosi kredite, ali se rucno ne vraca, pa pregled OBAVEZNO pokazi korisniku prije potvrde. Sa zadatim ids cita samo te oglase; bez njih cita katalog i staje ako ga ne procita u cijelosti.",
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
      const strategija = odaberiStrategiju(args.ids);

      let stavke: { id: number; title: string; price?: number }[];
      let nepoznati: number[] = [];
      if (strategija.nacin === "po_id") {
        // ids je izricito zadan i unutar praga: citamo samo trazene oglase, katalog se uopste
        // ne prelistava. Nema provjere potpunosti kataloga jer katalog nije ni procitan.
        stavke = [];
        for (const id of args.ids!) {
          try {
            const l = await c.getListing(id);
            stavke.push({ id: l.id, title: l.title, price: typeof l.price === "number" ? l.price : undefined });
          } catch {
            nepoznati.push(id);
          }
        }
      } else {
        const svi = await procitajKatalogSaPonavljanjem(c, user);
        if (!svi.potpuno) {
          return odbijNepotpunKatalog(svi, "Promjena cijene");
        }
        const izabraniIds = args.ids?.length ? new Set(args.ids) : null;
        const izabrani = izabraniIds
          ? svi.oglasi.filter((l) => izabraniIds.has(l.id))
          : args.category_id !== undefined
            ? svi.oglasi.filter((l) => l.category_id === args.category_id)
            : svi.oglasi;
        stavke = izabrani.map((l) => ({ id: l.id, title: l.title, price: typeof l.price === "number" ? l.price : undefined }));
      }

      const pregled = izracunajNoveCijene(stavke.slice(0, args.limit), { vrsta: args.pravilo, iznos: args.iznos });

      // `nepoznati` ide u odgovor samo kad ga stvarno ima: prazan niz u svakom odgovoru je trosak
      // tokena bez ijedne informacije.
      const nepoznatiPolje = nepoznati.length > 0 ? { nepoznati } : {};

      if (!args.confirm) {
        return { dry_run: true, obuhvaceno: stavke.length, ...nepoznatiPolje, ...pregled };
      }
      if (pregled.stavke.length === 0) {
        return {
          izmijenjeno: 0,
          ukupno: 0,
          napomena: "Nijedan oglas ne zadovoljava pravilo.",
          preskoceno: pregled.preskoceno,
          ...nepoznatiPolje,
        };
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
        const neuspjeliOdsjecak = odsijeciSpisak(rezultati.filter((r) => !r.ok), config.maxStavkiUOdgovoru);
        return {
          izmijenjeno: rezultati.filter((r) => r.ok).length,
          ukupno: rezultati.length,
          preskoceno: pregled.preskoceno.length,
          neuspjeli: neuspjeliOdsjecak.stavke,
          ...(neuspjeliOdsjecak.odsjeceno ? { neuspjelih_ukupno: neuspjeliOdsjecak.ukupno } : {}),
          ...nepoznatiPolje,
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
      "Sklanja vise oglasa odjednom: radnja 'hide' kad se artikal vraca na stanje, 'finish' kad je prodan (ostaje u historiji profila). confirm=false (default) vraca samo listu. Zavrsavanje se kroz ovaj server NE moze ponistiti, pa listu obavezno pokazi korisniku prije potvrde. Kratak spisak ids cita samo te oglase, dug spisak ide preko kataloga i staje ako ga ne procita u cijelosti.",
    inputSchema: {
      ids: z
        .array(z.number().int())
        .min(1)
        .max(
          4600,
          "Spisak ids je predug za jedan poziv. Podijeli ga u manje grupe i pozovi alat vise puta; svaka grupa ide sa svojom potvrdom.",
        ),
      radnja: z.enum(["hide", "finish"]),
      confirm: z.boolean().default(false),
    },
    annotations: destructiveOp,
  },
  (args) =>
    run(async (c) => {
      const user = await c.resolveUsername();
      const strategija = odaberiStrategiju(args.ids);

      let izabrani: { id: number; title: string }[];
      let nepoznati: number[];
      // Tacno u grani "po_id" stoji na false: id postoji (getListing je uspio), ali se ne moze
      // tvrditi da je oglas aktivan, jer puni odgovor nema pouzdano polje koje razlikuje aktivan
      // od isteklog, neaktivnog i zavrsenog (`status` je proizvoljan string bez potvrdjene seme,
      // `visible` i `available` mjere nesto drugo). Radnja se ipak izvrsava, jer trazeni oglas
      // postoji; samo se ne tvrdi da je aktivan. Zastavica umjesto spiska svih ID-eva: spisak bi
      // ponovio ono sto stoji u `oglasi`, a placa se tokenima u svakom odgovoru.
      let stanjeProvjereno: boolean;

      if (strategija.nacin === "po_id") {
        // ids je izricito zadan i unutar praga: citamo samo trazene oglase, katalog se uopste
        // ne prelistava, pa nema ni provjere potpunosti kataloga jer katalog nije ni procitan.
        izabrani = [];
        nepoznati = [];
        for (const id of args.ids) {
          try {
            const l = await c.getListing(id);
            izabrani.push({ id: l.id, title: l.title });
          } catch {
            // 404 ili druga greska ne obara cijelu radnju, ide u isti spisak kao katalogska
            // grana (nisu_aktivni).
            nepoznati.push(id);
          }
        }
        stanjeProvjereno = false;
      } else {
        const svi = await procitajKatalogSaPonavljanjem(c, user);
        if (!svi.potpuno) {
          return odbijNepotpunKatalog(svi, "Sklanjanje oglasa");
        }
        // Set umjesto includes/some: petlja po nizu je O(n*m), a na katalogu od nekoliko hiljada
        // oglasa i spisku od nekoliko hiljada ID-eva to je milioni nepotrebnih poredjenja.
        const trazeni = new Set(args.ids);
        const aktivniIds = new Set(svi.oglasi.map((l) => l.id));
        izabrani = svi.oglasi.filter((l) => trazeni.has(l.id)).map((l) => ({ id: l.id, title: l.title }));
        nepoznati = args.ids.filter((id) => !aktivniIds.has(id));
        stanjeProvjereno = true;
      }

      if (!args.confirm) {
        const oglasiOdsjecak = odsijeciSpisak(izabrani, config.maxStavkiUOdgovoru);
        const nisuAktivniOdsjecak = odsijeciSpisak(nepoznati, config.maxStavkiUOdgovoru);
        // Kad je spisak rezan, potvrda se daje nad skupom koji je covjek vidio samo dijelom, a
        // 'finish' se kroz ovaj server ne vraca. Polje `oglasi_ukupno` pored liste nije dovoljno:
        // model prepricava odgovor svojim rijecima i bez izricite recenice prepricao bi ga kao da
        // je prikazan cijeli spisak. Zato napomena ide RIJECIMA, ne samo kao broj.
        const napomena = oglasiOdsjecak.odsjeceno
          ? `Prikazano je prvih ${oglasiOdsjecak.stavke.length} od ${oglasiOdsjecak.ukupno} oglasa. Potvrda se odnosi na SVIH ${oglasiOdsjecak.ukupno}, ne samo na prikazane. Reci to korisniku prije nego zatrazis potvrdu.`
          : null;
        return {
          dry_run: true,
          radnja: args.radnja,
          oglasi: oglasiOdsjecak.stavke,
          ...(oglasiOdsjecak.odsjeceno ? { oglasi_ukupno: oglasiOdsjecak.ukupno } : {}),
          ...(napomena ? { napomena } : {}),
          nisu_aktivni: nisuAktivniOdsjecak.stavke,
          ...(nisuAktivniOdsjecak.odsjeceno ? { nisu_aktivnih_ukupno: nisuAktivniOdsjecak.ukupno } : {}),
          ...(stanjeProvjereno ? {} : { stanje_provjereno: false }),
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
      const neuspjeliOdsjecak = odsijeciSpisak(rezultati.filter((r) => !r.ok), config.maxStavkiUOdgovoru);
      const nisuAktivniOdsjecak = odsijeciSpisak(nepoznati, config.maxStavkiUOdgovoru);
      return {
        radnja: args.radnja,
        uspjelo: rezultati.filter((r) => r.ok).length,
        ukupno: rezultati.length,
        neuspjeli: neuspjeliOdsjecak.stavke,
        ...(neuspjeliOdsjecak.odsjeceno ? { neuspjelih_ukupno: neuspjeliOdsjecak.ukupno } : {}),
        nisu_aktivni: nisuAktivniOdsjecak.stavke,
        ...(nisuAktivniOdsjecak.odsjeceno ? { nisu_aktivnih_ukupno: nisuAktivniOdsjecak.ukupno } : {}),
        ...(stanjeProvjereno ? {} : { stanje_provjereno: false }),
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
      // Prozor = trazeni broj dana: to je tacno ono sto mrtviOglasi/promjenaPregleda
      // koriste kao danaUnazad, nista se ne odsijeca ispod racuna.
      const rezultat = mrtviOglasi(ucitajSnapshote(undefined, args.dana), Math.floor(Date.now() / 1000), args.dana);
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
  (args) => {
    const tudji = odbijTudjiNalog(args.user);
    if (tudji) return Promise.resolve(tudji);
    return run(async (c) => {
      const user = args.user ?? (await c.resolveUsername());
      const limits = await c.refreshLimits();
      const remaining = Math.max(0, limits.free_limit - limits.free_count);
      const cap = Math.min(args.limit, remaining);
      const all = await c.listAllActive(user, { budzetMs: config.budzetListeGrupniMs });
      // Za razliku od bulk_price/bulk_sklanjanje, obnova nad nepotpunom listom NE odbija: obnova
      // je besplatna, ne pravi pogresno stanje i ne moze se pogresno primijeniti, pa je bolje
      // obnoviti dio kataloga nego nista. Obuhvat ide u odgovor da se to vidi.
      const obuhvat = obuhvatIz(all);
      // Izuzeci PRIJE capa, da zabranjena obnova ne potrosi mjesto onome kome obnova treba.
      const { prolaze, preskoceni } = odvojiIzuzete(
        all.oglasi.filter((l) => l.refresh_available === true),
        ucitajIzuzeca(),
        "obnova",
      );
      const candidates = prolaze.slice(0, cap);
      // Izuzeti oglasi rastu sa spiskom izuzeca klijenta, pa i njih rezhe isti prag kao ostale
      // liste; bez toga bi jedan dug spisak izuzeca vratio rez na mala vrata.
      const izuzetiOdsjecak = odsijeciSpisak(
        preskoceni.map((l) => ({ id: l.id, title: l.title })),
        config.maxStavkiUOdgovoru,
      );
      const izuzeto =
        preskoceni.length > 0
          ? {
              izuzeto: izuzetiOdsjecak.stavke,
              ...(izuzetiOdsjecak.odsjeceno ? { izuzetih_ukupno: izuzetiOdsjecak.ukupno } : {}),
            }
          : {};
      if (!args.confirm) {
        const candidatesOdsjecak = odsijeciSpisak(
          candidates.map((l) => ({ id: l.id, title: l.title })),
          config.maxStavkiUOdgovoru,
        );
        return {
          dry_run: true,
          remaining_free: remaining,
          candidates: candidatesOdsjecak.stavke,
          ...(candidatesOdsjecak.odsjeceno ? { candidates_ukupno: candidatesOdsjecak.ukupno } : {}),
          obuhvat,
          ...izuzeto,
        };
      }
      const results: { id: number; ok: boolean; greska?: string }[] = [];
      for (const l of candidates) {
        try {
          await c.refreshListing(l.id);
          results.push({ id: l.id, ok: true });
        } catch (e) {
          results.push({ id: l.id, ok: false, greska: String(e instanceof Error ? e.message : e) });
        }
      }
      const neuspjeliOdsjecak = odsijeciSpisak(results.filter((r) => !r.ok), config.maxStavkiUOdgovoru);
      return {
        refreshed: results.filter((r) => r.ok).length,
        total: results.length,
        neuspjeli: neuspjeliOdsjecak.stavke,
        ...(neuspjeliOdsjecak.odsjeceno ? { neuspjelih_ukupno: neuspjeliOdsjecak.ukupno } : {}),
        obuhvat,
        ...izuzeto,
      };
    });
  },
);

// Sablon opisa iz onoga sto klijent VEC pise. Pri onboardingu klijent trazi "standardni footer,
// vidi u drugim oglasima kako to izgleda", a jedini pouzdan izvor je njegov postojeci katalog.
// Alat samo MJERI ucestalost i nikad ne predlaze footer koji se ne ponavlja: izmjereno je da na
// pravom shopu sablon cesto ne postoji (2 od 25 opisa), a izmisljen footer bi postao obecanje
// kupcu na svim buducim oglasima.
server.registerTool(
  "olx_sablon_opisa",
  {
    title: "Sablon iz postojecih opisa",
    description:
      "Cita opise vlastitih oglasa i javlja koji se zavrsni blokovi i fraze STVARNO ponavljaju, sa brojem pojava. Sluzi da se standardni footer prepozna iz klijentovog kataloga umjesto da se izmisli. Kad se nista ne ponavlja, to i kaze: tada footera nema.",
    inputSchema: {
      broj_oglasa: z.number().int().min(3).max(60).default(25).describe("koliko oglasa uzorkovati; vise je tacnije ali sporije"),
      min_pojava: z.number().int().min(2).max(20).default(3).describe("prag ispod kojeg se ponavljanje ne prijavljuje"),
    },
    annotations: readOnly,
  },
  (args) =>
    run(async (c) => {
      const user = await c.resolveUsername();
      // `broj_oglasa` je najvise 60, pa nema smisla prelistati cijeli katalog da bi se poslije
      // zadrzalo samo prvih 60: `maxStranica` staje cim ima dovoljno stranica za trazeni uzorak
      // (+1 stranica rezerve zbog moguce paginacije preklapanja). Time citanje 3000 oglasa (150
      // stranica) pada na svega par stranica.
      const aktivni = await c.listAllActive(user, {
        budzetMs: config.budzetListeMs,
        maxStranica: Math.ceil(args.broj_oglasa / 20) + 1,
      });
      const uzorak = aktivni.oglasi.slice(0, args.broj_oglasa);
      const opisi: string[] = [];
      for (const o of uzorak) {
        const puni = await c.getListing(o.id);
        opisi.push(String((puni.additional as { description?: unknown } | null)?.description ?? ""));
      }
      // Namjerno mali uzorak (maxStranica ogranicen gore) inace uzrokuje potpuno:false sa
      // razlog:"osigurac", jer je trazeno stranica > maxStranica. To NIJE greska niti nepotpuno
      // citanje kataloga: uzorak je tacno onoliki koliko je trazen. Zato se ovdje ne prijavljuje
      // `obuhvat` (koji bi sugerisao problem), nego samo jasna napomena da je uzet uzorak.
      // `oglasa_ukupno` ostaje tacan (meta.total sa prve stranice) bez obzira na velicinu uzorka.
      // Broj umjesto zastavice: `uzorkovano_oglasa` govori i da je uzorak i koliki je, pa se iz
      // odgovora vidi na cemu ponavljanje pociva, a polje ne kosta vise od gole zastavice.
      return {
        ...nadjiSablon(opisi, { minPojava: args.min_pojava }),
        oglasa_ukupno: aktivni.ukupno ?? aktivni.oglasi.length,
        uzorkovano_oglasa: uzorak.length,
      };
    }),
);

// Prijedlozi sedmicne AI runde. Runda ih pise na disk, a klijentski bot ih nije mogao procitati
// jer mu je Read nad .olx-pik zabranjen, pa je "primijeni prijedloge" davalo odbijenu dozvolu.
// Alat, ne otvaranje foldera: u .olx-pik su i audit trag i potrosnja, i to klijentu ne treba.
server.registerTool(
  "olx_prijedlozi",
  {
    title: "Prijedlozi sedmicne analize",
    description:
      "Cita prijedloge koje je napravila sedmicna analiza. `lista` daje sto postoji, `procitaj` bez imena daje najnoviji. Prijedlog je predlog, ne naredba: svaku stavku pokazi korisniku i trazi potvrdu prije izvrsenja, a trosak i dalje ide kroz svoju potvrdu.",
    inputSchema: {
      radnja: z.enum(["lista", "procitaj"]),
      ime: z.string().optional().describe("ime fajla iz liste; bez njega se cita najnoviji"),
    },
    annotations: readOnly,
  },
  async (args) => {
    try {
      if (args.radnja === "lista") {
        const s = spisakPrijedloga();
        return ok({ ukupno: s.length, prijedlozi: s });
      }
      const p = procitajPrijedlog(args.ime);
      if (!p) return ok({ ima: false, napomena: "Sedmicna analiza jos nije napravila nijedan prijedlog." });
      return ok({ ima: true, ime: p.ime, sadrzaj: p.sadrzaj });
    } catch (e) {
      return errResult(String(e instanceof Error ? e.message : e));
    }
  },
);

// Pamcenje o klijentu. Klijentska sesija se resetuje svaku noc i ne nastavlja se, a KLIJENT.md
// joj je zabranjen za citanje, pa je do sada svaka informacija iz razgovora nestajala u 3h. Ovaj
// alat je jedini nacin da bot sam zapise nesto o klijentu. Procitano ne treba: sadrzaj pamcenja
// ulazi u sistemski prompt pri svakom startu (scripts/sastavi-prompt.mjs), pa bot vec zna.
server.registerTool(
  "olx_zapamti",
  {
    title: "Zapamti o klijentu",
    description:
      "Trajno zapise sto klijent kaze o sebi i svojim navikama, da se poslije restarta ne izgubi. Polja su fiksna: " +
      `${POLJA.join(", ")}. Sve ostalo ide kao napomena. Zapisano samo dodaj kad je klijent to zaista rekao, nikad iz pretpostavke. ` +
      "Citanje ti ne treba: zapisano sam dolazi u tvoja pravila na pocetku sljedeceg razgovora.",
    inputSchema: {
      radnja: z.enum(["zapisi", "zabravi", "lista"]),
      polje: z.enum(POLJA).optional().describe("koje imenovano polje se postavlja ili brise"),
      vrijednost: z.string().optional().describe("vrijednost polja; prazna vrijednost brise polje"),
      napomena: z.string().optional().describe("slobodan zapis kad ne pripada nijednom polju"),
    },
  },
  async (args) => {
    try {
      const p = ucitajPamcenje();
      if (args.radnja === "lista") {
        return ok({ polja: p.polja, napomene: p.napomene });
      }
      const kada = new Date().toISOString();
      let novo = p;
      if (args.radnja === "zapisi") {
        if (args.polje) novo = saPoljem(novo, args.polje, args.vrijednost ?? "", kada);
        if (args.napomena) novo = saNapomenom(novo, args.napomena, kada);
        if (!args.polje && !args.napomena) return errResult("Zadaj polje sa vrijednoscu ili napomenu.");
      } else {
        if (args.polje) novo = bezPolja(novo, args.polje);
        if (args.napomena) novo = bezNapomene(novo, args.napomena);
        if (!args.polje && !args.napomena) return errResult("Zadaj polje ili napomenu koja se sklanja.");
      }
      upisiPamcenje(novo);
      return ok({
        radnja: args.radnja,
        polja: novo.polja,
        napomena_ukupno: novo.napomene.length,
        napomena:
          "Zapisano. Vazi od sljedeceg razgovora, jer se pravila sesije sastavljaju pri pokretanju.",
      });
    } catch (e) {
      return errResult(String(e instanceof Error ? e.message : e));
    }
  },
);

// Ritam kojim vlasnik zeli da mu se oglasi obnavljaju. Obnove su BESPLATNE unutar kvote, pa je
// ritam stvar njegovog ukusa i ne trosi mu nista. Zapis zivi u klonu (.olx-pik/ritam-obnova.json)
// i cita ga dnevna cron obnova, koja radi bez modela, zato je strukturiran a ne slobodan tekst.
server.registerTool(
  "olx_ritam_obnova",
  {
    title: "Ritam obnavljanja oglasa",
    description:
      "Kojim ritmom se oglasi automatski obnavljaju. 'ravnomjerno' rasporedi kroz ciklus, 'sve-dostupno' dize svaki oglas koji platforma da, 'interval' dize isti oglas svakih N dana, 'iskljuceno' ne obnavlja nista automatski. DOK VLASNIK NE IZABERE, dnevni posao ne obnavlja nista i pita ga u jutarnjoj poruci; njegov odgovor se zapisuje ovim alatom. Radnja 'procitaj' ne trazi strategiju. Kraci interval od praga platforme se podize na prag i to se javi. Ne trosi kredite.",
    inputSchema: {
      radnja: z.enum(["procitaj", "postavi"]),
      strategija: z.enum(STRATEGIJE).optional().describe("obavezno za postavi"),
      dana: z.number().int().min(1).max(INTERVAL_MAX).optional().describe("samo za interval: oglas ne cesce od ovoliko dana"),
    },
  },
  async (args) => {
    try {
      const ritam = ucitajRitam();
      if (args.radnja === "procitaj") {
        return ok({ ...ritam, zapisano: ritamZapisan(ritam), podrazumijevani: !ritamZapisan(ritam) });
      }
      if (!args.strategija) return errResult("Radnja 'postavi' trazi strategiju.");
      if (args.strategija === "interval" && typeof args.dana !== "number") {
        return errResult("Strategija 'interval' trazi i broj dana.");
      }

      // Prag platforme se ne moze zaobici, pa se kraci interval podize i to se JAVI. Tiho
      // prihvatanje bi klijentu obecalo ritam koji se ne moze izvrsiti.
      const prag = pragObnove(true);
      const trazeno = args.dana ?? 0;
      const dana = args.strategija === "interval" ? intervalUzPrag(trazeno, prag) : undefined;
      const novo = normalizujRitam({
        strategija: args.strategija,
        ...(dana !== undefined ? { dana } : {}),
        kada: new Date().toISOString(),
      });
      upisiRitam(novo);
      return ok({
        ...novo,
        ...(dana !== undefined && dana !== trazeno
          ? { napomena: `Interval je podignut sa ${trazeno} na ${dana} dana, jer platforma besplatnu obnovu istog oglasa daje tek nakon ${prag} dana.` }
          : {}),
        vazi_od: "sljedece dnevne obnove",
      });
    } catch (e) {
      return errResult(String(e instanceof Error ? e.message : e));
    }
  },
);

// Jednodnevni override dnevnog plafona generisanja slika. Postoji jer admin bot sesija namjerno
// nema Bash/Write/Edit/Read na .env* (Telegram nalog ne smije biti kljuc od cijele masine), pa se
// plafon iz .env ne moze mijenjati kroz razgovor. Ovaj alat je brana troska, zato SAMO_ADMIN.
server.registerTool(
  "olx_limit_slika",
  {
    title: "Jednodnevni limit generisanja slika",
    description:
      "Dnevni plafon generisanja slika (inace iz OLX_SLIKA_MAX_DNEVNO ili fallback 10). 'postavi' upisuje novi limit koji vazi SAMO ZA DANAS; sutra automatski pada nazad na .env/fallback vrijednost, bez rucnog vracanja. Radnja 'procitaj' vraca trenutni override ili javlja da nema (ili da je od ranijeg dana pa je istekao). Ne trosi kredite, samo mijenja plafon jednog jeftinog AI poziva.",
    inputSchema: {
      radnja: z.enum(["procitaj", "postavi"]),
      limit: z.number().int().positive().optional().describe("obavezno za postavi"),
      razlog: z.string().optional(),
    },
  },
  async (args) => {
    try {
      const danasIso = new Date().toISOString().slice(0, 10);
      const override = procitajOverride();
      if (args.radnja === "procitaj") {
        if (override && override.datum === danasIso) {
          return ok({ ...override, aktivan: true });
        }
        return ok({
          aktivan: false,
          napomena: override
            ? `Nema override-a za danas (${danasIso}); posljednji je bio za ${override.datum} i vec je istekao.`
            : `Nema override-a za danas (${danasIso}); plafon je iz .env/fallback.`,
        });
      }
      if (typeof args.limit !== "number") return errResult("Radnja 'postavi' trazi limit.");

      const novo = { datum: danasIso, limit: args.limit, kada: new Date().toISOString(), razlog: args.razlog ?? null };
      upisiOverride(novo);
      return ok({ ...novo, napomena: "Vazi samo za danas. Sutra plafon automatski pada nazad na .env/fallback vrijednost." });
    } catch (e) {
      return errResult(String(e instanceof Error ? e.message : e));
    }
  },
);

// Oglasi koje vlasnik ne zeli automatski dizati. Iz prakse: neki artikli mu se ne isplati
// obnavljati ni izdvajati, a bez spiska ih dnevna obnova svaki put ponovo pokupi. Spisak zivi u
// klonu (.olx-pik/izuzeca.json) i cita ga i CLI cron obnova, ne samo ovaj alat.
server.registerTool(
  "olx_izuzeca",
  {
    title: "Oglasi koje ne dizati automatski",
    description:
      "Spisak oglasa koje vlasnik ne zeli da se automatski obnavljaju i/ili izdvajaju. Dnevna obnova ih preskace. Opseg: 'obnova', 'izdvajanje', 'objava' ili 'sve'. Opseg 'objava' je drugacije prirode: on NISTA ne preskace, nego oznacava artikle najnizeg prioriteta za mjesto u limitu objave, tj. prve kandidate za sklanjanje kad grupa kategorija udari u limit; stvarno sklanjanje ide kroz olx_bulk_sklanjanje. Radnja 'lista' ne trazi ids.",
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
  "olx_skini_artikal",
  {
    title: "Skini artikal (arhiviraj pa sakrij)",
    description:
      "Kad artikla nema na stanju a vratice se: sacuva oglas i ORIGINALNE slike lokalno, pa sakrije oglas. Besplatno i reverzibilno; povratak je olx_vrati_artikal. Prije poziva potvrdi sa korisnikom o kojem se oglasu radi.",
    inputSchema: { id: z.number().int() },
    annotations: writeOp,
  },
  (args) =>
    run(async (c) => {
      const oglas = await c.getListing(args.id);
      const zapis = noviZapis(oglas, new Date().toISOString());
      const { fajlovi, neuspjele } = await preuzmiSlike(zapis.meta.url_slika, mapaZapisa(args.id));
      zapis.meta.fajlovi_slika = fajlovi;
      zapis.meta.neuspjele_slike = neuspjele;
      // Ponovno arhiviranje ne smije zaboraviti da je artikal ranije vec objavljen iz arhive.
      const stari = ucitajZapis(args.id);
      if (stari?.meta.ponovo_objavljen) zapis.meta.ponovo_objavljen = stari.meta.ponovo_objavljen;
      upisiZapis(zapis);
      const vecSkriven = oglas.visible === false;
      if (!vecSkriven) await c.hideListing(args.id);
      return {
        id: args.id,
        naslov: oglas.title,
        vec_bio_skriven: vecSkriven,
        sacuvano_slika: fajlovi.length,
        neuspjele_slike: neuspjele,
        // Dok je oglas samo skriven, otkrivanje vraca SVE i bez arhive; arhiva je osiguranje
        // za slucaj da oglas kasnije zavrsi ili nestane.
        napomena: neuspjele.length > 0 ? "dio slika nije sacuvan u arhivu; otkrivanje skrivenog oglasa svejedno vraca sve slike" : null,
      };
    }),
);

server.registerTool(
  "olx_arhiva",
  {
    title: "Arhiva skinutih artikala",
    description:
      "Lokalna arhiva artikala skinutih sa shopa (olx_skini_artikal). Radnja 'lista' vraca pregled (odsjecen na limit, ukupno je pun broj), 'detalj' pun zapis jednog artikla po originalnom broju oglasa.",
    inputSchema: {
      radnja: z.enum(["lista", "detalj"]),
      id: z.number().int().optional(),
      limit: z.number().int().min(1).max(50).default(20).describe("gornja granica za radnju 'lista'; ukupno u odgovoru ostaje pun broj"),
    },
    annotations: readOnly,
  },
  async (args) => {
    try {
      if (args.radnja === "detalj") {
        if (!args.id) return errResult("Radnja 'detalj' trazi id.");
        const zapis = ucitajZapis(args.id);
        return zapis ? ok(zapis) : errResult(`U arhivi nema zapisa za oglas ${args.id}.`);
      }
      const zapisi = ucitajSveZapise();
      const velicinaMb = Math.round((velicinaArhive() / 1_048_576) * 10) / 10;
      const odsjecak = odsijeciSpisak(kompaktSpisak(zapisi), args.limit);
      return ok({
        ukupno: odsjecak.ukupno,
        velicina_mb: velicinaMb,
        artikli: odsjecak.stavke,
        ...(odsjecak.odsjeceno ? { odsjeceno: true } : {}),
      });
    } catch (e) {
      return errResult(String(e instanceof Error ? e.message : e));
    }
  },
);

server.registerTool(
  "olx_vrati_artikal",
  {
    title: "Vrati skinuti artikal",
    description:
      "Vraca ranije skinut artikal (id = originalni broj, vidi olx_arhiva lista). Skriven oglas samo otkrije, besplatno. Kad oglasa vise nema, objavi NOVI iz arhive sa originalnim slikama: prije potvrde korisnika pozovi olx_draft_check; u naplatnim kategorijama bez confirm=true samo javi cijenu.",
    inputSchema: {
      id: z.number().int(),
      confirm: z.boolean().default(false).describe("true tek nakon sto korisnik potvrdi eventualnu cijenu objave"),
      ignorisi_prethodnu_objavu: z.boolean().default(false).describe("true samo kad korisnik izricito zeli jos jedan primjerak vec vracenog artikla"),
      potvrdi_spornu_robu: POTVRDA_ROBE,
    },
    annotations: writeOp,
  },
  (args) =>
    run(async (c) => {
      const zapis = ucitajZapis(args.id);
      let oglas: Listing | null = null;
      try {
        oglas = await c.getListing(args.id);
      } catch {
        oglas = null; // zavrsen ili obrisan: planVracanja odlucuje moze li iz arhive
      }
      const plan = planVracanja(zapis, oglas);
      if (plan.radnja === "stoj") return { radnja: "nista", zasto: plan.zasto };
      if (plan.radnja === "otkrij") {
        await c.unhideListing(args.id);
        return { radnja: "otkriven", id: args.id, link: linkOglasa(args.id, oglas?.slug) };
      }
      if (!zapis) return { radnja: "nista", zasto: "nema arhive" }; // planVracanja ovo vec brani

      // Brana duple objave: ista arhiva je vec jednom vracena i taj novi oglas jos zivi.
      const ranije = zapis.meta.ponovo_objavljen;
      if (ranije && !args.ignorisi_prethodnu_objavu) {
        let noviAktivan = false;
        try {
          noviAktivan = (await c.getListing(ranije.novi_id)).visible !== false;
        } catch {
          noviAktivan = false;
        }
        if (noviAktivan) {
          return {
            radnja: "nista",
            zasto: `artikal je vec vracen kao oglas ${ranije.novi_id} i taj oglas je aktivan; za jos jedan primjerak pozovi sa ignorisi_prethodnu_objavu: true`,
          };
        }
      }

      // Kljuc brani paralelnu duplu objavu (dvije poruke u isto vrijeme).
      const otpusti = zauzmiKljuc(".olx-pik/arhiva-objava");
      try {
        const create = { ...zapis.create };
        if (create.city_id === undefined && config.defaultCityId !== undefined) create.city_id = config.defaultCityId;
        if (create.country_id === undefined && config.defaultCountryId !== undefined) create.country_id = config.defaultCountryId;
        const draft = await c.createListing(create, { confirm: args.confirm, potvrdiRobu: args.potvrdi_spornu_robu });
        const kada = new Date().toISOString();

        const mapa = mapaZapisa(args.id);
        if (zapis.meta.fajlovi_slika.length > 0) {
          let slike;
          try {
            slike = await c.uploadImageFiles(draft.id, zapis.meta.fajlovi_slika.map((f) => resolve(mapa, f)));
          } catch (e) {
            // STOP prije objave: oglas bez slika se ne objavljuje. Draft ostaje da se ne izgubi.
            return {
              radnja: "prekinuto_prije_objave",
              draft_id: draft.id,
              zasto: `slike nisu poslane (${String(e instanceof Error ? e.message : e)}); oglas NIJE objavljen, pokusaj ponovo ili posalji slike pa objavi`,
            };
          }
          // Redoslijed uploada prati arhivu, pa je prva slika iz odgovora glavna. imageId
          // postoji samo u odgovoru uploada, arhiva ga nema.
          const glavna = slike[0]?.id;
          if (glavna !== undefined) {
            try {
              await c.setMainImage(draft.id, glavna);
            } catch {
              // glavna ostaje po defaultu API-ja; nije razlog da objava padne
            }
          }
        }

        const objava = await c.publishListing(draft.id, { confirm: args.confirm, potvrdiRobu: args.potvrdi_spornu_robu });
        // Odluka "ovaj ne diraj" prati ARTIKAL, ne broj oglasa: prenesi izuzece na novi id.
        const izuzeca = ucitajIzuzeca();
        const prenesenaIzuzeca = preneseno(izuzeca, args.id, draft.id, kada);
        if (prenesenaIzuzeca !== izuzeca) upisiIzuzeca(prenesenaIzuzeca);
        upisiZapis(saOznakomObjave(zapis, draft.id, kada));

        let slug: unknown;
        try {
          slug = (await c.getListing(draft.id)).slug;
        } catch {
          slug = undefined;
        }
        return {
          radnja: "objavljen_iz_arhive",
          stari_id: args.id,
          novi_id: draft.id,
          poslano_slika: zapis.meta.fajlovi_slika.length,
          izuzece_preneseno: prenesenaIzuzeca !== izuzeca,
          status: (objava as { status?: unknown }).status ?? null,
          link: linkOglasa(draft.id, slug),
        };
      } finally {
        otpusti();
      }
    }),
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
      // Prvo pometi sto je od ranije dozrelo, pa tek onda radi. Ciscenje je lijeno i vezano za
      // posao sa slikama, da klon ne dobija jos jedan zadatak za instalirati na dvije platforme.
      pocistiPotrosene();
      const result: Record<string, unknown> = {};
      if (args.urls?.length) result.by_url = await c.uploadImagesByUrl(args.id, args.urls);
      if (args.file_paths?.length) {
        result.by_file = await c.uploadImageFiles(args.id, args.file_paths);
        // Tek poslije uspjesnog uploada: fajl je odradio posao i smije nestati kad odgoda prodje.
        oznaciPotrosene(args.file_paths);
      }
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

// Server se dize SAMO kad je ovaj modul ulaz procesa. Kad ga neko uvozi (generator popisa
// mogucnosti), registracije alata i resursa se izvrse a stdio transport se ne otvara, pa uvoz
// ne otima standardni ulaz i ne ostavlja proces koji visi.
if (pokrenutDirektno(import.meta.url)) {
  main().catch((e) => {
    console.error("Greska servera:", e);
    process.exit(1);
  });
}
