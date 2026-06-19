#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { OlxClient, OlxApiError, OlxAuthError, OlxSpendError } from "../core/index.js";
import { resolveConfig, listProfileNames } from "../core/config.js";
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

function client(): OlxClient {
  const profile = (program.opts() as { profile?: string }).profile;
  return new OlxClient(resolveConfig(profile).config);
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
  const me = await c.me();
  const username = me.username ?? (me.id !== undefined ? String(me.id) : undefined);
  if (!username) throw new OlxAuthError("Ne mogu odrediti korisnika. Zadaj --user.");
  return username;
}

const program = new Command();
program
  .name("olx")
  .description("Interni CLI za OLX.ba / PIK.ba shopove")
  .version("0.1.0")
  .option("-p, --profile <name>", "OLX profil (za vise klijenata/tokena); vidi: olx auth profiles");

// ---- Auth ----
const auth = program.command("auth").description("Autentifikacija");

auth
  .command("profiles")
  .description("Lista konfigurisanih profila (imena, bez tokena)")
  .action(() => {
    const names = listProfileNames();
    if (!names.length) {
      console.error("Nema konfigurisanih profila. Koristi se jedan OLX_TOKEN.");
      console.error("Dodaj profile u .olx-profiles.json ili env OLX_TOKEN_<IME>.");
      return;
    }
    out({ profiles: names, napomena: "Aktiviraj profil sa --profile <ime> ili env OLX_PROFILE." });
  });
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

function sponsorOptions(opts: { type: string; days: string; refreshEvery?: string; homepage?: boolean }): SponsorOptions {
  return {
    type: Number(opts.type) as SponsorType,
    days: Number(opts.days) as SponsorDays,
    refresh_every: opts.refreshEvery ? (Number(opts.refreshEvery) as RefreshEvery) : undefined,
    locations: opts.homepage ? ["homepage"] : undefined,
  };
}

sponsor
  .command("price <id>")
  .description("Cijena izdvajanja (ne trosi kredite)")
  .requiredOption("--type <0|1|2>", "0 bez, 1 klasicno, 2 premium")
  .requiredOption("--days <n>", "1,2,3,5,7,14,21,30")
  .option("--refresh-every <h>", "0,3,6,8,24")
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
  .requiredOption("--days <n>", "1,2,3,5,7,14,21,30")
  .option("--refresh-every <h>", "0,3,6,8,24")
  .option("--homepage", "ukljuci naslovnicu", false)
  .option("--yes", "potvrda troska", false)
  .action(async (id: string, opts: { type: string; days: string; refreshEvery?: string; homepage?: boolean; yes?: boolean }) => {
    try {
      out(await (await withAuth()).sponsorListing(id, sponsorOptions(opts), Boolean(opts.yes)));
    } catch (e) {
      fail(e);
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

program.parseAsync(process.argv).catch(fail);
