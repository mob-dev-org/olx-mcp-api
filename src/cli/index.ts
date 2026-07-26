#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { OlxClient, OlxApiError, OlxAuthError, OlxSpendError } from "../core/index.js";
import { loadConfig } from "../core/config.js";
import { setAuditContext } from "../core/audit.js";
import { parseSponsorOptions, SPONSOR_DAYS, REFRESH_EVERY } from "../core/sponsor-options.js";
import { buildPlan, dospjeliTermini, oznaciTermin, planSazetak, zaglavljeniTermini } from "../core/plan.js";
import type { PlanKandidat, SponsorPlan } from "../core/plan.js";
import { matchCatalog, summarizeMatches } from "../core/match.js";
import type { PikItem, KatalogItem, OverrideEntry } from "../core/match.js";
import { loadKatalog } from "../core/katalog.js";
import type { CreateListingInput, SponsorOptions, SponsorType, SponsorDays, RefreshEvery, CategoryNode, Country, City } from "../core/types.js";

// Ucitaj .env ako postoji (Node 20.12+/22). Bez vanjske zavisnosti.
try {
  (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(".env");
} catch {
  // .env nije obavezan
}

function out(value: unknown): void {
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function fail(err: unknown): never {
  if (err instanceof OlxSpendError) {
    console.error(`TROSAK: ${err.message}`);
    if (err.price) console.error(JSON.stringify(err.price, null, 2));
    console.error("Dodaj --yes da potvrdis trosak.");
  } else if (err instanceof OlxAuthError) {
    console.error(`AUTH: ${err.message}`);
  } else if (err instanceof OlxApiError) {
    console.error(`API (${err.status}): ${err.message}`);
    if (err.body !== undefined) console.error(JSON.stringify(err.body, null, 2));
  } else {
    console.error(`GRESKA: ${String(err)}`);
  }
  process.exit(1);
}

// Jedan klon repoa radi za jedan nalog: token iz OLX_TOKEN u .env ovog klona.
function client(): OlxClient {
  return new OlxClient(loadConfig());
}

// Puno ime komande ("sponsor apply"), da audit log kaze koja je radnja pokrenula poziv.
function commandPath(cmd: Command): string {
  const dijelovi: string[] = [];
  let current: Command | null = cmd;
  while (current && current.name() !== "olx") {
    dijelovi.unshift(current.name());
    current = current.parent as Command | null;
  }
  return dijelovi.join(" ") || "olx";
}

// Lagani CSV index kategorija: samo polja bitna za izbor kategorije i kreiranje oglasa.
// Opcije (forme) NISU ovdje; dohvataju se po potrebi sa category attributes <id>.
const CATEGORY_CSV_HEADERS = [
  "id",
  "parent_id",
  "level",
  "path",
  "name",
  "brand_required",
  "model_required",
  "has_models",
  "show_condition",
  "listing_fee",
  "base_listing_price",
] as const;

interface CategoryCsvRow {
  id: number;
  parent_id: number | null;
  level: number;
  path: string;
  name: string;
  brand_required: 0 | 1;
  model_required: 0 | 1;
  has_models: 0 | 1;
  show_condition: 0 | 1;
  listing_fee: number | "";
  base_listing_price: number | "";
}

function flattenCategories(tree: CategoryNode[]): CategoryCsvRow[] {
  const rows: CategoryCsvRow[] = [];
  const flag = (v: unknown): 0 | 1 => (v ? 1 : 0);
  const numOrEmpty = (v: unknown): number | "" => (typeof v === "number" ? v : "");
  const walk = (nodes: CategoryNode[], level: number, parentPath: string): void => {
    for (const node of nodes) {
      const path = parentPath ? `${parentPath} > ${node.name}` : node.name;
      rows.push({
        id: node.id,
        parent_id: node.parent_id ?? null,
        level,
        path,
        name: node.name,
        brand_required: flag(node.brand_required),
        model_required: flag(node.model_required),
        has_models: flag(node.has_models),
        show_condition: flag(node.show_condition),
        listing_fee: numOrEmpty(node.listing_fee),
        base_listing_price: numOrEmpty(node.base_listing_price),
      });
      if (Array.isArray(node.children) && node.children.length) walk(node.children, level + 1, path);
    }
  };
  walk(tree, 1, "");
  return rows;
}

function toCsv(rows: CategoryCsvRow[]): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CATEGORY_CSV_HEADERS.join(",")];
  for (const row of rows) lines.push(CATEGORY_CSV_HEADERS.map((h) => esc(row[h])).join(","));
  return lines.join("\n") + "\n";
}

// Lagani CSV index lokacija: drzave (country_id) i gradovi (city_id, canton_id) za izbor pri kreiranju.
const LOCATION_CSV_HEADERS = ["type", "id", "name", "code", "canton_id"] as const;

interface LocationCsvRow {
  type: "country" | "city";
  id: number;
  name: string;
  code: string;
  canton_id: number | "";
}

function flattenLocations(snap: { countries?: Country[]; cities?: City[] }): LocationCsvRow[] {
  const rows: LocationCsvRow[] = [];
  for (const country of snap.countries ?? []) {
    rows.push({ type: "country", id: country.id, name: country.name, code: country.code ?? "", canton_id: "" });
  }
  for (const city of snap.cities ?? []) {
    rows.push({
      type: "city",
      id: city.id,
      name: city.name,
      code: "",
      canton_id: typeof city.canton_id === "number" ? city.canton_id : "",
    });
  }
  return rows;
}

function locationsToCsv(rows: LocationCsvRow[]): string {
  const esc = (v: unknown): string => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [LOCATION_CSV_HEADERS.join(",")];
  for (const row of rows) lines.push(LOCATION_CSV_HEADERS.map((h) => esc(row[h])).join(","));
  return lines.join("\n") + "\n";
}

async function withAuth(): Promise<OlxClient> {
  const c = client();
  await c.ensureAuth();
  return c;
}

// Vraca username ulogovanog korisnika ako nije eksplicitno zadat.
async function resolveUser(c: OlxClient, given?: string): Promise<string> {
  if (given) return given;
  return c.resolveUsername();
}

const program = new Command();
program
  .name("olx")
  .description("Interni CLI za OLX.ba / PIK.ba shopove")
  .version("0.1.0");

// Svaka radnja se u audit logu vidi pod imenom komande koja ju je pokrenula.
program.hook("preAction", (_thisCommand, actionCommand) => {
  setAuditContext({ operation: commandPath(actionCommand), source: "cli" });
});

// ---- Auth ----
const auth = program.command("auth").description("Autentifikacija");

auth
  .command("login")
  .description("Login kredencijalima iz env, ispisuje token")
  .action(async () => {
    try {
      const c = client();
      const res = await c.login();
      out({ token: res.token, user: { id: res.user.id, username: res.user.username, type: res.user.type } });
      console.error("Savjet: postavi OLX_TOKEN na ovaj token da preskocis login.");
    } catch (e) {
      fail(e);
    }
  });

program
  .command("whoami")
  .description("Prikazuje trenutni nalog (test pristupa)")
  .action(async () => {
    try {
      const c = await withAuth();
      out(await c.me());
    } catch (e) {
      fail(e);
    }
  });

// ---- Users (javni podaci) ----
const users = program.command("users").description("Javni podaci o korisnicima i shopovima");

users
  .command("profile <username>")
  .description("Javni profil shopa: paket, poslovni podaci, ocjene, vrijeme odgovora (samo username)")
  .action(async (username: string) => {
    try {
      const c = await withAuth();
      out(await c.userProfile(username));
    } catch (e) {
      fail(e);
    }
  });

// ---- Listings ----
const listings = program.command("listings").description("Upravljanje oglasima");

listings
  .command("ls")
  .description("Lista oglasa")
  .option("--state <state>", "active|finished|inactive|expired|hidden", "active")
  .option("--user <user>", "username ili id (default: ulogovani)")
  .option("--all", "prelistaj sve stranice (samo active)", false)
  .option("--page <n>", "broj stranice", "1")
  .action(async (opts: { state: string; user?: string; all?: boolean; page: string }) => {
    try {
      const c = await withAuth();
      const user = await resolveUser(c, opts.user);
      const page = Number(opts.page) || 1;
      if (opts.state === "active") {
        out(opts.all ? await c.listAllActive(user) : await c.listActive(user, page));
      } else if (opts.state === "finished") out(await c.listFinished(user, page));
      else if (opts.state === "inactive") out(await c.listInactive(user, page));
      else if (opts.state === "expired") out(await c.listExpired(user, page));
      else if (opts.state === "hidden") out(await c.listHidden(user, page));
      else throw new Error(`Nepoznat state: ${opts.state}`);
    } catch (e) {
      fail(e);
    }
  });

listings
  .command("get <id>")
  .description("Detalji oglasa")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).getListing(id));
    } catch (e) {
      fail(e);
    }
  });

listings
  .command("create")
  .description("Kreira oglas iz JSON fajla (ostaje DRAFT dok se ne objavi)")
  .requiredOption("--file <path>", "JSON fajl sa poljima oglasa")
  .option("--publish", "objavi odmah nakon kreiranja", false)
  .action(async (opts: { file: string; publish?: boolean }) => {
    try {
      const input = JSON.parse(readFileSync(opts.file, "utf8")) as CreateListingInput;
      const c = await withAuth();
      const created = await c.createListing(input);
      out(created);
      if (opts.publish) {
        const pub = await c.publishListing(created.id);
        console.error("Objavljeno:");
        out(pub);
      } else {
        console.error("Oglas je DRAFT i nije vidljiv. Objavi sa: olx listings publish " + created.id);
      }
    } catch (e) {
      fail(e);
    }
  });

listings
  .command("publish <id>")
  .description("Objavljuje DRAFT oglas")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).publishListing(id));
    } catch (e) {
      fail(e);
    }
  });

listings
  .command("update <id>")
  .description("Izmjena oglasa")
  .option("--file <path>", "JSON sa poljima za izmjenu")
  .option("--title <title>")
  .option("--price <price>")
  .option("--description <description>")
  .action(async (id: string, opts: { file?: string; title?: string; price?: string; description?: string }) => {
    try {
      const patch = opts.file ? JSON.parse(readFileSync(opts.file, "utf8")) : {};
      if (opts.title) patch.title = opts.title;
      if (opts.description) patch.description = opts.description;
      if (opts.price) patch.price = Number(opts.price);
      out(await (await withAuth()).updateListing(id, patch));
    } catch (e) {
      fail(e);
    }
  });

listings
  .command("hide <id>")
  .description("Sakriva oglas (umjesto brisanja kad nema na stanju)")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).hideListing(id));
    } catch (e) {
      fail(e);
    }
  });

listings
  .command("unhide <id>")
  .description("Vraca skriveni oglas")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).unhideListing(id));
    } catch (e) {
      fail(e);
    }
  });

listings
  .command("finish <id>")
  .description("Oznacava oglas kao zavrsen/prodano")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).finishListing(id));
    } catch (e) {
      fail(e);
    }
  });

listings
  .command("rm <id>")
  .description("Brise oglas (nepovratno; radije koristi hide/finish)")
  .option("--yes", "potvrda brisanja", false)
  .action(async (id: string, opts: { yes?: boolean }) => {
    try {
      if (!opts.yes) throw new Error("Brisanje je nepovratno. Dodaj --yes. Savjet: za re-ranking koristi refresh, ne brisanje.");
      out(await (await withAuth()).deleteListing(id));
    } catch (e) {
      fail(e);
    }
  });

listings
  .command("limits")
  .description("Limiti broja oglasa po grupama kategorija (cars, real-estate, other)")
  .action(async () => {
    try {
      out(await (await withAuth()).listingLimits());
    } catch (e) {
      fail(e);
    }
  });

// ---- Slike ----
const images = listings.command("images").description("Slike oglasa");

images
  .command("add <id>")
  .description("Dodaje slike na oglas (URL-ovi i/ili lokalni fajlovi)")
  .option("--url <url...>", "jedan ili vise URL-ova slika")
  .option("--file <path...>", "jedan ili vise lokalnih fajlova (multipart; format NEPOTVRDJEN)")
  .action(async (id: string, opts: { url?: string[]; file?: string[] }) => {
    try {
      if (!opts.url?.length && !opts.file?.length) {
        throw new Error("Zadaj bar jedan --url ili --file.");
      }
      const c = await withAuth();
      const result: Record<string, unknown> = {};
      if (opts.url?.length) result.by_url = await c.uploadImagesByUrl(id, opts.url);
      if (opts.file?.length) result.by_file = await c.uploadImageFiles(id, opts.file);
      out(result);
    } catch (e) {
      fail(e);
    }
  });

images
  .command("main <id> <imageId>")
  .description("Postavlja glavnu sliku oglasa")
  .action(async (id: string, imageId: string) => {
    try {
      out(await (await withAuth()).setMainImage(id, Number(imageId)));
    } catch (e) {
      fail(e);
    }
  });

images
  .command("rm <id> <imageId>")
  .description("Brise sliku sa oglasa")
  .action(async (id: string, imageId: string) => {
    try {
      out(await (await withAuth()).deleteImage(id, Number(imageId)));
    } catch (e) {
      fail(e);
    }
  });

// ---- Refresh ----
const refresh = program.command("refresh").description("Obnova oglasa (svjezina)");

refresh
  .command("limits")
  .description("Mjesecni limiti obnove")
  .action(async () => {
    try {
      out(await (await withAuth()).refreshLimits());
    } catch (e) {
      fail(e);
    }
  });

refresh
  .command("one <id>")
  .description("Obnavlja jedan oglas")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).refreshListing(id));
    } catch (e) {
      fail(e);
    }
  });

refresh
  .command("all")
  .description("Bulk obnova aktivnih oglasa kojima je obnova dostupna")
  .option("--user <user>", "username ili id (default: ulogovani)")
  .option("--limit <n>", "maksimalan broj obnova u ovom pokretanju", "100")
  .option("--yes", "potvrda za izvrsenje", false)
  .action(async (opts: { user?: string; limit: string; yes?: boolean }) => {
    try {
      const c = await withAuth();
      const user = await resolveUser(c, opts.user);
      const limit = Number(opts.limit) || 100;

      const limits = await c.refreshLimits();
      const remaining = Math.max(0, limits.free_limit - limits.free_count);
      const cap = Math.min(limit, remaining);

      const all = await c.listAllActive(user);
      const candidates = all.filter((l) => l.refresh_available === true).slice(0, cap);

      console.error(`Kandidata za obnovu: ${candidates.length} (besplatno preostalo: ${remaining}, cap: ${cap}).`);
      if (!opts.yes) {
        console.error("Probni prikaz (dry-run). Dodaj --yes da izvrsis obnovu.");
        out(candidates.map((l) => ({ id: l.id, title: l.title })));
        return;
      }

      const results: { id: number; ok: boolean; message?: string }[] = [];
      for (const l of candidates) {
        try {
          const r = (await c.refreshListing(l.id)) as { message?: string };
          results.push({ id: l.id, ok: true, message: r.message });
        } catch (e) {
          results.push({ id: l.id, ok: false, message: String(e) });
        }
      }
      out({ obnovljeno: results.filter((r) => r.ok).length, ukupno: results.length, detalji: results });
    } catch (e) {
      fail(e);
    }
  });

// ---- Category ----
const category = program.command("category").description("Kategorije i atributi");

category
  .command("suggest <keyword>")
  .description("Prijedlog kategorije po naslovu")
  .action(async (keyword: string) => {
    try {
      out(await (await withAuth()).suggestCategory(keyword));
    } catch (e) {
      fail(e);
    }
  });

category
  .command("find <name>")
  .description("Pronadji kategoriju po imenu (vraca puni path)")
  .action(async (name: string) => {
    try {
      out(await (await withAuth()).findCategory(name));
    } catch (e) {
      fail(e);
    }
  });

category
  .command("attributes <id>")
  .description("Atributi kategorije")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).categoryAttributes(id));
    } catch (e) {
      fail(e);
    }
  });

category
  .command("list")
  .description("Top-level kategorije")
  .action(async () => {
    try {
      out(await (await withAuth()).categories());
    } catch (e) {
      fail(e);
    }
  });

category
  .command("children <id>")
  .description("Podkategorije date kategorije")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).childrenCategories(id));
    } catch (e) {
      fail(e);
    }
  });

category
  .command("get <id>")
  .description("Jedna kategorija (sadrzi listing_fee, base_listing_price, brand/model_required)")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).category(id));
    } catch (e) {
      fail(e);
    }
  });

category
  .command("brands <id>")
  .description("Brendovi u kategoriji")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).categoryBrands(id));
    } catch (e) {
      fail(e);
    }
  });

category
  .command("models <id> <brandId>")
  .description("Modeli za brend u kategoriji")
  .action(async (id: string, brandId: string) => {
    try {
      out(await (await withAuth()).categoryModels(id, brandId));
    } catch (e) {
      fail(e);
    }
  });

category
  .command("dump")
  .description("Povlaci cijelo stablo kategorija i snima u JSON (jednokratni snapshot za repo/MCP)")
  .option("--out <path>", "izlazni JSON fajl", "olx-dokumentacija/categories.json")
  .option("--depth <n>", "maksimalna dubina stabla", "6")
  .action(async (opts: { out: string; depth: string }) => {
    try {
      const c = await withAuth();
      const tree = await c.categoryTree(Number(opts.depth) || 6);
      const payload = { generated_at: new Date().toISOString(), base_url: c.baseUrl, tree };
      mkdirSync(dirname(opts.out), { recursive: true });
      writeFileSync(opts.out, JSON.stringify(payload, null, 2));
      const csvOut = opts.out.replace(/\.json$/i, ".csv");
      const rows = flattenCategories(tree);
      writeFileSync(csvOut, toCsv(rows));
      console.error(`Snimljeno ${tree.length} top-level (${rows.length} ukupno) u ${opts.out}.`);
      console.error(`Lagani CSV index: ${csvOut}.`);
      console.error("Savjet: commitaj oba fajla (JSON + CSV) za MCP resurse olx://categories i olx://categories-index.");
    } catch (e) {
      fail(e);
    }
  });

category
  .command("index")
  .description("Generise lagani CSV index iz postojeceg categories.json (bez API poziva)")
  .option("--from <path>", "ulazni JSON", "olx-dokumentacija/categories.json")
  .option("--out <path>", "izlazni CSV", "olx-dokumentacija/categories.csv")
  .action((opts: { from: string; out: string }) => {
    try {
      const parsed = JSON.parse(readFileSync(opts.from, "utf8")) as { tree?: CategoryNode[] };
      const rows = flattenCategories(parsed.tree ?? []);
      mkdirSync(dirname(opts.out), { recursive: true });
      writeFileSync(opts.out, toCsv(rows));
      console.error(`Lagani CSV index: ${rows.length} kategorija u ${opts.out}.`);
    } catch (e) {
      fail(e);
    }
  });

// ---- Location ----
const location = program.command("location").description("Lokacije (drzave, gradovi, kantoni)");

location
  .command("countries")
  .description("Drzave (BiH = id 49)")
  .action(async () => {
    try {
      out(await (await withAuth()).countries());
    } catch (e) {
      fail(e);
    }
  });

location
  .command("cities")
  .description("Entiteti/regije")
  .action(async () => {
    try {
      out(await (await withAuth()).cities());
    } catch (e) {
      fail(e);
    }
  });

location
  .command("city <id>")
  .description("Grad po ID (lat, lon, zip, canton_id, state_id)")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).city(id));
    } catch (e) {
      fail(e);
    }
  });

location
  .command("states")
  .description("Entiteti (country-states)")
  .action(async () => {
    try {
      out(await (await withAuth()).countryStates());
    } catch (e) {
      fail(e);
    }
  });

location
  .command("canton-cities <id>")
  .description("Gradovi u kantonu")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).cantonCities(id));
    } catch (e) {
      fail(e);
    }
  });

location
  .command("dump")
  .description("Povlaci lokacije (drzave, entiteti, kantoni->gradovi) i snima u JSON (jednokratni snapshot)")
  .option("--out <path>", "izlazni JSON fajl", "olx-dokumentacija/locations.json")
  .option("--no-cities", "preskoci obilazak kantona za listu gradova")
  .action(async (opts: { out: string; cities: boolean }) => {
    try {
      const c = await withAuth();
      const snap = await c.locationSnapshot(opts.cities);
      const payload = { generated_at: new Date().toISOString(), base_url: c.baseUrl, ...snap };
      mkdirSync(dirname(opts.out), { recursive: true });
      writeFileSync(opts.out, JSON.stringify(payload, null, 2));
      const csvOut = opts.out.replace(/\.json$/i, ".csv");
      const rows = flattenLocations(snap);
      writeFileSync(csvOut, locationsToCsv(rows));
      console.error(
        `Snimljeno: ${snap.countries.length} drzava, ${snap.entities.length} entiteta, ${snap.cities.length} gradova u ${opts.out}.`,
      );
      console.error(`Lagani CSV index: ${csvOut}.`);
      console.error("Savjet: commitaj oba fajla (JSON + CSV) za MCP resurse olx://locations i olx://locations-index.");
    } catch (e) {
      fail(e);
    }
  });

location
  .command("index")
  .description("Generise lagani CSV index lokacija iz postojeceg locations.json (bez API poziva)")
  .option("--from <path>", "ulazni JSON", "olx-dokumentacija/locations.json")
  .option("--out <path>", "izlazni CSV", "olx-dokumentacija/locations.csv")
  .action((opts: { from: string; out: string }) => {
    try {
      const parsed = JSON.parse(readFileSync(opts.from, "utf8")) as { countries?: Country[]; cities?: City[] };
      const rows = flattenLocations(parsed);
      mkdirSync(dirname(opts.out), { recursive: true });
      writeFileSync(opts.out, locationsToCsv(rows));
      console.error(`Lagani CSV index: ${rows.length} lokacija u ${opts.out}.`);
    } catch (e) {
      fail(e);
    }
  });

// ---- Sponsor ----
const sponsor = program.command("sponsor").description("Izdvajanje (trosi kredite)");

// Dozvoljene vrijednosti su u jezgru (src/core/sponsor-options.ts), da lista ne zivi u tri kopije.
function sponsorOptions(opts: { type: string; days: string; refreshEvery?: string; homepage?: boolean }): SponsorOptions {
  return parseSponsorOptions({
    type: Number(opts.type),
    days: Number(opts.days),
    refreshEvery: opts.refreshEvery === undefined ? 0 : Number(opts.refreshEvery),
    homepage: Boolean(opts.homepage),
  });
}

sponsor
  .command("price <id>")
  .description("Cijena izdvajanja (ne trosi kredite)")
  .requiredOption("--type <0|1|2>", "0 bez, 1 klasicno, 2 premium")
  .requiredOption("--days <n>", `dana izdvajanja: ${SPONSOR_DAYS.join(",")}`)
  .option("--refresh-every <h>", `autoobnova u satima: ${REFRESH_EVERY.join(",")}`)
  .option("--homepage", "ukljuci naslovnicu", false)
  .action(async (id: string, opts: { type: string; days: string; refreshEvery?: string; homepage?: boolean }) => {
    try {
      out(await (await withAuth()).sponsorPrice(id, sponsorOptions(opts)));
    } catch (e) {
      fail(e);
    }
  });

sponsor
  .command("apply <id>")
  .description("Izdvaja oglas (TROSI KREDITE; trazi --yes)")
  .requiredOption("--type <0|1|2>", "0 bez, 1 klasicno, 2 premium")
  .requiredOption("--days <n>", `dana izdvajanja: ${SPONSOR_DAYS.join(",")}`)
  .option("--refresh-every <h>", `autoobnova u satima: ${REFRESH_EVERY.join(",")}`)
  .option("--homepage", "ukljuci naslovnicu", false)
  .option("--yes", "potvrda troska", false)
  .action(async (id: string, opts: { type: string; days: string; refreshEvery?: string; homepage?: boolean; yes?: boolean }) => {
    try {
      out(await (await withAuth()).sponsorListing(id, sponsorOptions(opts), Boolean(opts.yes)));
    } catch (e) {
      fail(e);
    }
  });

// ---- Planer izdvajanja ----
// API ne prima zakazivanje, pa raspored zivi u lokalnom fajlu, a izvrsenje pokrece ova komanda
// (rucno ili kroz dnevni cron). Trosak se nikad ne naplacuje bez --yes.

const PLAN_FILE = ".olx-pik/plan-izdvajanja.json";

function citajPlan(putanja: string): SponsorPlan {
  const raw: unknown = JSON.parse(readFileSync(putanja, "utf8"));
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as SponsorPlan).termini)) {
    throw new Error(`Fajl ${putanja} nije plan izdvajanja.`);
  }
  return raw as SponsorPlan;
}

function upisiPlan(putanja: string, plan: SponsorPlan): void {
  mkdirSync(dirname(putanja), { recursive: true });
  writeFileSync(putanja, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

function danasnjiDatum(): string {
  return new Date().toISOString().slice(0, 10);
}

// Kljuc protiv dvostrukog izvrsenja: dva paralelna pokretanja ne smiju naplatiti isti termin.
function zauzmiKljuc(putanja: string): () => void {
  const kljuc = `${putanja}.lock`;
  try {
    writeFileSync(kljuc, String(process.pid), { flag: "wx" });
  } catch {
    throw new Error(`Izvrsenje je vec u toku (postoji ${kljuc}). Ako je proces pao, obrisi taj fajl rucno.`);
  }
  return () => {
    try {
      rmSync(kljuc, { force: true });
    } catch {
      // ako se kljuc ne moze obrisati, sljedece pokretanje ce to prijaviti
    }
  };
}

function ispisiPlan(plan: SponsorPlan): void {
  const s = planSazetak(plan);
  out({
    napravljen: plan.napravljen,
    nalog: plan.nalog,
    budzet: plan.budzet,
    dana_raspored: plan.dana_raspored,
    sazetak: s,
    termini: plan.termini.map((t) => ({
      za_datum: t.za_datum,
      id: t.listing_id,
      naslov: t.naslov,
      cijena: t.cijena,
      status: t.status,
      ...(t.napomena ? { napomena: t.napomena } : {}),
    })),
  });
}

const plan = sponsor.command("plan").description("Raspored izdvajanja kroz dane (plan fajl, izvrsenje uz --yes)");

plan
  .command("napravi")
  .description("Pravi predlog plana: dohvata cijene (ne trosi) i rasporedjuje ih u budzet")
  .requiredOption("--budzet <n>", "koliko kredita ukupno smije otici na ovaj plan")
  .option("--dana <n>", "kroz koliko dana se raspored siri", "7")
  .option("--type <0|1|2>", "0 bez, 1 klasicno, 2 premium", "1")
  .option("--trajanje <n>", `koliko dana traje jedno izdvajanje: ${SPONSOR_DAYS.join(",")}`, "7")
  .option("--refresh-every <h>", `autoobnova u satima: ${REFRESH_EVERY.join(",")}`)
  .option("--homepage", "ukljuci naslovnicu", false)
  .option("--broj-oglasa <n>", "koliko oglasa najvise razmatrati", "40")
  .option("--oglasi <ids>", "izricit spisak ID-jeva, odvojen zapezom (preskace izbor po svjezini)")
  .option("--user <user>", "username (default: ulogovani)")
  .option("--file <putanja>", "gdje se snima plan", PLAN_FILE)
  .action(async (opts: {
    budzet: string;
    dana: string;
    type: string;
    trajanje: string;
    refreshEvery?: string;
    homepage?: boolean;
    brojOglasa: string;
    oglasi?: string;
    user?: string;
    file: string;
  }) => {
    try {
      const budzet = Number(opts.budzet);
      if (!Number.isFinite(budzet) || budzet <= 0) throw new Error("--budzet mora biti pozitivan broj kredita.");
      const opcije = sponsorOptions({
        type: opts.type,
        days: opts.trajanje,
        refreshEvery: opts.refreshEvery,
        homepage: opts.homepage,
      });

      const c = await withAuth();
      const user = await resolveUser(c, opts.user);
      const limit = Math.max(1, Number(opts.brojOglasa) || 40);

      let kandidati: PlanKandidat[];
      if (opts.oglasi) {
        const ids = opts.oglasi.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x));
        if (!ids.length) throw new Error("--oglasi ne sadrzi ni jedan validan ID.");
        kandidati = [];
        for (const id of ids) {
          const oglas = await c.getListing(id);
          kandidati.push({ id, naslov: oglas.title, vec_izdvojen: Boolean(oglas.sponsored) });
        }
      } else {
        // Bez izricitog spiska: najstariji aktivni oglasi koji nisu izdvojeni. Ovo je heuristika
        // (najdublje su pali), ne mjerenje: API ne daje ni pregled ni pojmove pretrage.
        const aktivni = await c.listAllActive(user);
        kandidati = aktivni
          .filter((l) => !l.sponsored)
          .sort((a, b) => (a.date ?? 0) - (b.date ?? 0))
          .slice(0, limit)
          .map((l) => ({ id: l.id, naslov: l.title }));
      }

      // Cijena se dohvata za svakog kandidata; GET ne trosi kredite.
      for (const kandidat of kandidati) {
        try {
          const cijena = await c.sponsorPrice(kandidat.id, opcije);
          kandidat.cijena = cijena.total;
        } catch (e) {
          // Bez cijene kandidat ne ulazi u plan; razlog ide na stderr da se ne izgubi tiho.
          console.error(
            `Cijena za oglas ${kandidat.id} nije dohvacena, preskacem: ${String(e instanceof Error ? e.message : e)}`,
          );
        }
      }

      const noviPlan = buildPlan({
        kandidati,
        budzet,
        danaRaspored: Number(opts.dana) || 7,
        opcije,
        pocetniDatum: danasnjiDatum(),
        napravljen: new Date().toISOString(),
        nalog: user,
      });

      upisiPlan(opts.file, noviPlan);
      ispisiPlan(noviPlan);
      console.error(`Plan je snimljen u ${opts.file}. Nista nije naplaceno.`);
      console.error(`Izvrsenje: node dist/cli/index.js sponsor plan izvrsi --yes`);
    } catch (e) {
      fail(e);
    }
  });

plan
  .command("prikazi")
  .description("Ispisuje trenutni plan i sta je od njega izvrseno")
  .option("--file <putanja>", "putanja plana", PLAN_FILE)
  .action((opts: { file: string }) => {
    try {
      ispisiPlan(citajPlan(opts.file));
    } catch (e) {
      fail(e);
    }
  });

plan
  .command("izvrsi")
  .description("Izvrsava termine dospjele do danas (TROSI KREDITE; bez --yes je probni prikaz)")
  .option("--file <putanja>", "putanja plana", PLAN_FILE)
  .option("--datum <YYYY-MM-DD>", "racunaj kao da je taj datum (za provjeru)")
  .option("--yes", "potvrda troska", false)
  .action(async (opts: { file: string; datum?: string; yes?: boolean }) => {
    let otpusti: (() => void) | undefined;
    try {
      let tekuci = citajPlan(opts.file);
      const danas = opts.datum ?? danasnjiDatum();

      const zaglavljeni = zaglavljeniTermini(tekuci);
      if (zaglavljeni.length) {
        throw new Error(
          `Plan ima ${zaglavljeni.length} termina u stanju "u_toku" (prekinuto izvrsenje): ` +
            `${zaglavljeni.map((t) => t.listing_id).join(", ")}. ` +
            "Provjeri rucno da li su ti oglasi izdvojeni (listings get <id>, polje sponsored), " +
            "pa im u planu postavi izvrsen ili planiran. Automatski ih ne diram, da se ne naplati dva puta.",
        );
      }

      const dospjeli = dospjeliTermini(tekuci, danas);
      if (!dospjeli.length) {
        out({ danas, dospjelo: 0, napomena: "Nema termina za danas.", sazetak: planSazetak(tekuci) });
        return;
      }

      const ukupno = dospjeli.reduce((zbir, t) => zbir + t.cijena, 0);
      if (!opts.yes) {
        out({
          probni_prikaz: true,
          danas,
          dospjelo: dospjeli.length,
          procijenjen_trosak: ukupno,
          termini: dospjeli.map((t) => ({ id: t.listing_id, naslov: t.naslov, cijena: t.cijena })),
        });
        console.error("Probni prikaz. Dodaj --yes da se izdvajanje stvarno naplati.");
        return;
      }

      otpusti = zauzmiKljuc(opts.file);
      const c = await withAuth();
      const ishodi: { id: number; status: string; napomena?: string }[] = [];

      for (const termin of dospjeli) {
        // Cijena se provjerava ponovo: plan je star nekoliko dana, a cijena izdvajanja je dinamicna.
        let cijenaSada: number | undefined;
        try {
          cijenaSada = (await c.sponsorPrice(termin.listing_id, termin.opcije)).total;
        } catch (e) {
          tekuci = oznaciTermin(tekuci, termin.id, {
            status: "neuspio",
            napomena: `cijena se ne moze dohvatiti: ${String(e instanceof Error ? e.message : e)}`,
          });
          upisiPlan(opts.file, tekuci);
          ishodi.push({ id: termin.listing_id, status: "neuspio" });
          continue;
        }

        if (cijenaSada > termin.cijena) {
          tekuci = oznaciTermin(tekuci, termin.id, {
            status: "cijena_promijenjena",
            napomena: `planirano ${termin.cijena}, sada ${cijenaSada} kredita; nije naplaceno`,
          });
          upisiPlan(opts.file, tekuci);
          ishodi.push({ id: termin.listing_id, status: "cijena_promijenjena", napomena: `${termin.cijena} -> ${cijenaSada}` });
          continue;
        }

        // Upis PRIJE poziva: ako proces padne, termin ostaje "u_toku" i sljedece pokretanje trazi
        // rucnu provjeru umjesto da naplati drugi put.
        tekuci = oznaciTermin(tekuci, termin.id, { status: "u_toku" });
        upisiPlan(opts.file, tekuci);

        try {
          await c.sponsorListing(termin.listing_id, termin.opcije, true);
          tekuci = oznaciTermin(tekuci, termin.id, {
            status: "izvrsen",
            izvrseno_u: new Date().toISOString(),
            napomena: cijenaSada < termin.cijena ? `pojeftinilo: ${termin.cijena} -> ${cijenaSada}` : undefined,
          });
          ishodi.push({ id: termin.listing_id, status: "izvrsen" });
        } catch (e) {
          tekuci = oznaciTermin(tekuci, termin.id, {
            status: "neuspio",
            napomena: String(e instanceof Error ? e.message : e),
          });
          ishodi.push({ id: termin.listing_id, status: "neuspio", napomena: String(e instanceof Error ? e.message : e) });
        }
        upisiPlan(opts.file, tekuci);
      }

      out({ danas, izvrseno: ishodi.filter((i) => i.status === "izvrsen").length, ishodi, sazetak: planSazetak(tekuci) });
    } catch (e) {
      fail(e);
    } finally {
      otpusti?.();
    }
  });

// ---- Discount ----
const discount = program.command("discount").description("Akcijska cijena (premium, trosi kredite)");

discount
  .command("set <id>")
  .description("Postavlja akcijsku cijenu (TROSI KREDITE; trazi --yes)")
  .requiredOption("--price <price>", "nova cijena")
  .requiredOption("--days <3|7|30>", "trajanje")
  .option("--yes", "potvrda troska", false)
  .action(async (id: string, opts: { price: string; days: string; yes?: boolean }) => {
    try {
      const days = Number(opts.days) as 3 | 7 | 30;
      out(await (await withAuth()).setDiscount(id, { price: Number(opts.price), days }, Boolean(opts.yes)));
    } catch (e) {
      fail(e);
    }
  });

discount
  .command("finish <id>")
  .description("Zavrsava aktivnu akcijsku cijenu")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).finishDiscount(id));
    } catch (e) {
      fail(e);
    }
  });

// ---- Spajanje sa vanjskim katalogom ----
// Citanje kataloga (JSON ili CSV) zivi u jezgru (src/core/katalog.ts), da se moze testirati bez
// pokretanja CLI-a. Ovdje je samo komanda.

program
  .command("match")
  .description("Spaja PIK oglase sa vanjskim katalogom i njegovom zalihom")
  .requiredOption("--katalog <fajl>", "JSON ili CSV katalog (kolone: sifra, naziv, zaliha, cijena)")
  .option("--overrides <fajl>", "JSON sa rucnim mapiranjem po PIK id-u")
  .option("--out <fajl>", "gdje snimiti izvjestaj")
  .option("--user <user>", "username (default: ulogovani)")
  .option("--with-sku", "dohvati SKU za svaki oglas (sporo: jedan zahtjev po oglasu)", false)
  .option("--min-score <n>", "prag za automatski match", "0.72")
  .action(async (opts: { katalog: string; overrides?: string; out?: string; user?: string; withSku?: boolean; minScore: string }) => {
    try {
      const c = await withAuth();
      const user = await resolveUser(c, opts.user);
      const katalog = loadKatalog(opts.katalog);
      const overrides = opts.overrides
        ? (JSON.parse(readFileSync(opts.overrides, "utf8")) as Record<string, OverrideEntry>)
        : {};

      const active = await c.listAllActive(user);
      const pik: PikItem[] = [];
      for (const listing of active) {
        // SKU nije u listi, samo na pojedinacnom oglasu, pa je dohvat opcion.
        let sku: string | null = null;
        if (opts.withSku) {
          const detail = (await c.getListing(listing.id)) as { sku_number?: string | null };
          sku = detail.sku_number ?? null;
        }
        pik.push({
          id: listing.id,
          title: listing.title ?? "",
          sku,
          // Aktivna lista daje category_id, drugi oblici daju ugnijezdeni category objekat.
          categoryId: listing.category_id ?? (listing.category as { id?: number } | undefined)?.id ?? null,
          price: typeof listing.price === "number" ? listing.price : null,
        });
      }

      const results = matchCatalog(pik, katalog, { overrides, autoThreshold: Number(opts.minScore) || 0.72 });
      const report = {
        generated_for: user,
        pik_count: pik.length,
        katalog_count: katalog.length,
        sku_fetched: Boolean(opts.withSku),
        summary: summarizeMatches(results),
        results,
      };
      if (opts.out) {
        mkdirSync(dirname(opts.out), { recursive: true });
        writeFileSync(opts.out, JSON.stringify(report, null, 2));
        out({ ...report, results: `snimljeno u ${opts.out}` });
      } else {
        out(report);
      }
    } catch (e) {
      fail(e);
    }
  });

program.parseAsync(process.argv).catch(fail);
