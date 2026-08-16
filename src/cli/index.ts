#!/usr/bin/env bun
import { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { OlxClient, OlxApiError, OlxAuthError, OlxSpendError } from "../core/index.js";
import { odvojiIzuzete, ucitajIzuzeca } from "../core/izuzeca.js";
import { loadConfig } from "../core/config.js";
import { pokrenutDirektno } from "../core/ulaz.js";
import { potrosenoNaDanUFajlovima, putanjeAuditaZaCitanje, setAuditContext } from "../core/audit.js";
import { VERZIJA } from "../core/verzija.js";
import { parseSponsorOptions, SPONSOR_DAYS, REFRESH_EVERY } from "../core/sponsor-options.js";
import { buildPlan, dospjeliTermini, oznaciTermin, planSazetak, zaglavljeniTermini } from "../core/plan.js";
import { citajPlan, citajPlanAkoPostoji, PLAN_FILE, upisiPlan, zauzmiKljuc } from "../core/plan-fajl.js";
import type { PlanKandidat, SponsorPlan } from "../core/plan.js";
import { matchCatalog, summarizeMatches } from "../core/match.js";
import type { PikItem, KatalogItem, OverrideEntry } from "../core/match.js";
import { loadKatalog } from "../core/katalog.js";
import { alarmiNaloga, danCiklusaIzIsteka, dnevniPlanObnova, efekatIzdvajanja, mrtviOglasi, obuhvatIz, pragObnove, promjenaKonkurenta, promjenaPregleda } from "../core/stats.js";
import { intervalUzPrag, poIntervalu, ucitajRitam, upisiRitam } from "../core/ritam-obnova.js";
import { izmjereniDanReseta, ucitajKvotuDnevnik, zapisiKvotu } from "../core/kvota-dnevnik.js";
import { ucitajKonkurenta, upisiKonkurenta } from "../core/konkurenti.js";
import type { OnboardingDetalj } from "../core/stats.js";
import { dnevniTekst, dnevniVrijedanSlanja, onboardingMarkdown, onboardingTelegram, sedmicniTekst } from "../core/izvjestaj.js";
import { chatIdovi, izaberiOdredista, javiAdminu, posaljiPoruku, provjeriChat, type NalazChata } from "../core/telegram.js";
import {
  citajPristup,
  dodajGrupu,
  grupeKlijenta,
  imaGrupu,
  mtimePristupa,
  putanjaPristupa,
  ukloniGrupu,
  upisiPristup,
} from "../core/telegram-grupe.js";
import {
  imaSnapshotaStarijihOd,
  obrisiSnapshotUToku,
  proredjiStareSnapshote,
  SNAPSHOT_DIR,
  ucitajSnapshote,
  ucitajSnapshotUToku,
  upisiSnapshot,
  upisiSnapshotUToku,
  zadnjiSnapshot,
} from "../core/snapshoti.js";
import { razvrstaj } from "../core/backup-spisak.js";
import { kopirajURadnu, popisiStanje, uporediSaKopijom, vratiIzRadne } from "../core/stanje-kopija.js";
import { bootstrap, commitIPush, danaDoIsteka, masinaSePoklapa, postavkeStanja, zadnjiUpis } from "../core/git-stanje.js";
import type { CreateListingInput, Listing, SponsorOptions, SponsorType, SponsorDays, RefreshEvery, CategoryNode, Country, City } from "../core/types.js";
import { arhivirajIzZivog, planReaktivacije, ucitajZapis, type ArhivskiZapis } from "../core/arhiva.js";

// Ucitaj .env ako postoji (Node 20.12+/22). Bez vanjske zavisnosti. Prvo .env iz radnog
// direktorija; ako ga tamo nema, iz korijena klona kojem pripada OVAJ build, da CLI radi
// ispravno i kad ga proces pokrene iz drugog direktorija (Task Scheduler, MCP klijent).
try {
  const loadEnv = (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  const korijenskiEnv = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../.env");
  if (existsSync(".env")) loadEnv?.(".env");
  else if (existsSync(korijenskiEnv)) loadEnv?.(korijenskiEnv);
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
  // envFajl: na 401 preuzmi nov token iz .env bez restarta (vidi OlxClientOptions).
  return new OlxClient(loadConfig(), { envFajl: ".env" });
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

// Izvezeno zbog generatora popisa mogucnosti: on uvozi ovaj modul i seta stablo komandi
// (`program.commands`) umjesto da cita izvorni kod. Ni jedan drugi potrosac ga ne uvozi.
export const program = new Command();
program
  .name("olx")
  .description("Interni CLI za OLX.ba / PIK.ba shopove")
  .version(VERZIJA);

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
        if (opts.all) {
          const svi = await c.listAllActive(user);
          if (!svi.potpuno) {
            console.error(
              `Lista nije potpuna (razlog: ${svi.razlog ?? "nepoznat"}), procitano ${svi.procitanoStranica}` +
                `${svi.stranicaUkupno !== null ? ` od ${svi.stranicaUkupno}` : ""} stranica.`,
            );
          }
          out({ oglasi: svi.oglasi, obuhvat: obuhvatIz(svi) });
        } else {
          out(await c.listActive(user, page));
        }
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
  .option("--yes", "potvrda za naplatne kategorije (vozila, nekretnine, poslovi)", false)
  .action(async (opts: { file: string; publish?: boolean; yes?: boolean }) => {
    try {
      const input = JSON.parse(readFileSync(opts.file, "utf8")) as CreateListingInput;
      const c = await withAuth();
      const created = await c.createListing(input, { confirm: opts.yes });
      out(created);
      if (opts.publish) {
        const pub = await c.publishListing(created.id, { confirm: opts.yes });
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
  .option("--yes", "potvrda za naplatne kategorije (vozila, nekretnine, poslovi)", false)
  .action(async (id: string, opts: { yes?: boolean }) => {
    try {
      out(await (await withAuth()).publishListing(id, { confirm: opts.yes }));
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
  .option("--yes", "potvrda kad izmjena prebacuje oglas u naplatnu kategoriju", false)
  .action(async (id: string, opts: { file?: string; title?: string; price?: string; description?: string; yes?: boolean }) => {
    try {
      const patch = opts.file ? JSON.parse(readFileSync(opts.file, "utf8")) : {};
      if (opts.title) patch.title = opts.title;
      if (opts.description) patch.description = opts.description;
      if (opts.price) patch.price = Number(opts.price);
      out(await (await withAuth()).updateListing(id, patch, { confirm: opts.yes }));
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
  .command("reaktiviraj <id>")
  .description("Vraca zavrsen oglas u zivot objavom NOVOG oglasa sa istim podacima i slikama (pregledi se ne prenose)")
  .option("--cijena <n>", "cijena novog oglasa u KM (obavezna kad original nema citljivu cijenu)")
  .option("--yes", "potvrda eventualne cijene objave u naplatnoj kategoriji", false)
  .option("--potvrdi-robu", "potvrda da roba nije sporna, kad provjera pravila robe zaustavi objavu", false)
  .option("--mjeri-publish", "MJERENJE (samo admin, samo besplatna kategorija): pozovi publish nad zavrsenim oglasom i ispisi sta API vrati", false)
  .action(async (id: string, opts: { cijena?: string; yes?: boolean; potvrdiRobu?: boolean; mjeriPublish?: boolean }) => {
    try {
      const c = await withAuth();
      if (opts.mjeriPublish) {
        // Mjerenje za granu "publish" u planReaktivacije: sta POST /listings/{id}/publish radi
        // nad zavrsenim oglasom. Radi se SAMO na admin nalogu i SAMO nad namjenskim oglasom u
        // besplatnoj kategoriji, jer trenutak naplate (create ili publish) nije izmjeren, pa se
        // po granicama nepoznata cijena tretira kao naplatna. Nalaz zapisati kao saznanje iz prakse.
        out(await c.publishListing(id, { confirm: Boolean(opts.yes), potvrdiRobu: Boolean(opts.potvrdiRobu) }));
        return;
      }
      const brojId = Number(id);
      if (!Number.isInteger(brojId) || brojId <= 0) throw new Error(`Neispravan id oglasa: ${id}`);
      const cijena = opts.cijena !== undefined ? Number(opts.cijena) : undefined;
      if (cijena !== undefined && (!Number.isFinite(cijena) || cijena <= 0)) throw new Error(`Neispravna cijena: ${opts.cijena}`);
      let oglas: Listing | null = null;
      try {
        oglas = await c.getListing(brojId);
      } catch {
        oglas = null; // zavrsen oglas moze biti necitljiv: planReaktivacije odlucuje moze li iz arhive
      }
      const zapis = ucitajZapis(brojId);
      const plan = planReaktivacije(oglas, zapis, { zadataCijena: cijena });
      if (plan.radnja === "stoj") {
        out({ radnja: "nista", zasto: plan.zasto });
        return;
      }
      if (plan.radnja === "otkrij") {
        await c.unhideListing(brojId);
        out({ radnja: "otkriven", id: brojId });
        return;
      }
      let zaObjavu: ArhivskiZapis;
      if (plan.radnja === "objavi_iz_zivog" && oglas) {
        zaObjavu = await arhivirajIzZivog(oglas, { cijena: plan.cijena });
        if (zaObjavu.meta.fajlovi_slika.length === 0) {
          out({ radnja: "nista", zasto: "nijedna slika sa zavrsenog oglasa se nije mogla preuzeti; oglas bez slika se ne objavljuje", neuspjele_slike: zaObjavu.meta.neuspjele_slike });
          return;
        }
      } else {
        if (!zapis) {
          out({ radnja: "nista", zasto: "nema arhive" }); // planReaktivacije ovo vec brani
          return;
        }
        zaObjavu = zapis;
      }
      out(await c.objaviIzArhive(zaObjavu, { confirm: Boolean(opts.yes), potvrdiRobu: Boolean(opts.potvrdiRobu) }));
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
      if (!all.potpuno) {
        console.error(
          `Prolaz nije pokrio cijeli katalog: procitano ${all.oglasi.length} od ` +
            `${all.ukupno ?? "nepoznato"} oglasa (razlog: ${all.razlog ?? "nepoznat"}). ` +
            "Obnova se izvrsava nad onim sto je procitano.",
        );
      }
      // Izuzeci se sklanjaju PRIJE capa, da obnovu koju je vlasnik zabranio ne potrosi mjesto
      // nekome kome obnova treba. Broj preskocenih se uvijek javlja: tiho preskakanje izgleda
      // kao da obnova ne radi.
      const { prolaze, preskoceni } = odvojiIzuzete(
        all.oglasi.filter((l) => l.refresh_available === true),
        ucitajIzuzeca(),
        "obnova",
      );
      const candidates = prolaze.slice(0, cap);

      console.error(
        `Kandidata za obnovu: ${candidates.length} (besplatno preostalo: ${remaining}, cap: ${cap})` +
          `${preskoceni.length > 0 ? `, izuzeto po zelji vlasnika: ${preskoceni.length}` : ""}.`,
      );
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
function sponsorOptions(opts: { type: string; days: string; refreshEvery?: string; homepage?: boolean; locations?: string[] }): SponsorOptions {
  return parseSponsorOptions({
    type: Number(opts.type),
    days: Number(opts.days),
    refreshEvery: opts.refreshEvery === undefined ? 0 : Number(opts.refreshEvery),
    homepage: Boolean(opts.homepage),
    locations: opts.locations,
  });
}

sponsor
  .command("price <id>")
  .description("Cijena izdvajanja (ne trosi kredite)")
  .requiredOption("--type <0|1|2>", "0 bez, 1 klasicno, 2 premium")
  .requiredOption("--days <n>", `dana izdvajanja: ${SPONSOR_DAYS.join(",")}`)
  .option("--refresh-every <h>", `autoobnova u satima: ${REFRESH_EVERY.join(",")}`)
  .option("--homepage", "ukljuci naslovnicu", false)
  .option("--locations <loc...>", 'dodatne lokacije izdvajanja (dokumentovana je samo "homepage")')
  .action(async (id: string, opts: { type: string; days: string; refreshEvery?: string; homepage?: boolean; locations?: string[] }) => {
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
  .option("--locations <loc...>", 'dodatne lokacije izdvajanja (dokumentovana je samo "homepage")')
  .option("--yes", "potvrda troska", false)
  .action(async (id: string, opts: { type: string; days: string; refreshEvery?: string; homepage?: boolean; locations?: string[]; yes?: boolean }) => {
    try {
      out(await (await withAuth()).sponsorListing(id, sponsorOptions(opts), Boolean(opts.yes)));
    } catch (e) {
      fail(e);
    }
  });

// ---- Planer izdvajanja ----
// API ne prima zakazivanje, pa raspored zivi u lokalnom fajlu, a izvrsenje pokrece ova komanda
// (rucno ili kroz dnevni cron). Trosak se nikad ne naplacuje bez --yes.

// PLAN_FILE, citajPlan, upisiPlan i zauzmiKljuc su preseljeni u src/core/plan-fajl.ts, da ih
// mogu koristiti i MCP server i sedmicni izvjestaj, ne samo CLI.

function danasnjiDatum(): string {
  return new Date().toISOString().slice(0, 10);
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
        if (!aktivni.potpuno) {
          console.error(
            `UPOZORENJE: izbor kandidata za izdvajanje je napravljen iz nepotpunog kataloga ` +
              `(procitano ${aktivni.oglasi.length} od ${aktivni.ukupno ?? "nepoznato"} oglasa, ` +
              `razlog: ${aktivni.razlog ?? "nepoznat"}). Najstariji oglasi van ovog obuhvata mozda nisu razmotreni.`,
          );
          out({ obuhvat: obuhvatIz(aktivni) });
        }
        kandidati = aktivni.oglasi
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

      upisiPlan(noviPlan, opts.file);
      ispisiPlan(noviPlan);
      console.error(`Plan je snimljen u ${opts.file}. Nista nije naplaceno.`);
      console.error(`Izvrsenje: bun dist/cli/index.js sponsor plan izvrsi --yes`);
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
          upisiPlan(tekuci, opts.file);
          ishodi.push({ id: termin.listing_id, status: "neuspio" });
          continue;
        }

        if (cijenaSada > termin.cijena) {
          tekuci = oznaciTermin(tekuci, termin.id, {
            status: "cijena_promijenjena",
            napomena: `planirano ${termin.cijena}, sada ${cijenaSada} kredita; nije naplaceno`,
          });
          upisiPlan(tekuci, opts.file);
          ishodi.push({ id: termin.listing_id, status: "cijena_promijenjena", napomena: `${termin.cijena} -> ${cijenaSada}` });
          continue;
        }

        // Upis PRIJE poziva: ako proces padne, termin ostaje "u_toku" i sljedece pokretanje trazi
        // rucnu provjeru umjesto da naplati drugi put.
        tekuci = oznaciTermin(tekuci, termin.id, { status: "u_toku" });
        upisiPlan(tekuci, opts.file);

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
        upisiPlan(tekuci, opts.file);
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

// ---- Statistika i snapshoti ----
// Agregacija je u src/core/stats.ts (ciste funkcije) i orkestratorima na klijentu; ovdje su
// samo komande. Snapshot je jedina teska komanda (getListing po svakom oglasu), zato zivi u
// CLI-u za cron, a MCP alati snapshote samo citaju.

const stats = program.command("stats").description("Statistika, analize i snapshoti (ne trosi kredite)");

stats
  .command("profil")
  .description("Kompaktna statistika vlastitog profila")
  .option("--views <mode>", "none|sample|snapshot", "none")
  .option("--sample-size <n>", "velicina uzorka za sample", "15")
  .action(async (opts: { views: string; sampleSize: string }) => {
    try {
      const c = await withAuth();
      if (opts.views === "snapshot") {
        const zadnji = zadnjiSnapshot();
        if (!zadnji) throw new Error("Nema snapshota u .olx-pik/snapshots; prvo pokreni 'stats snapshot'.");
        const pregledi = zadnji.oglasi.map((o) => ({
          id: o.id,
          title: o.title,
          views: o.views,
          questions: o.questions,
          created_at: o.created_at,
        }));
        out({ snapshot_ts: zadnji.ts, ...(await c.statsProfil({ pregledi })) });
        return;
      }
      const viewsMode = opts.views === "sample" ? "sample" : "none";
      out(await c.statsProfil({ viewsMode, sampleVelicina: Number(opts.sampleSize) || 15 }));
    } catch (e) {
      fail(e);
    }
  });

stats
  .command("onboarding")
  .description("Prva analiza za klijenta: neiskoristene obnove, higijena oglasa, ucinak i prvi potezi")
  .option("--md", "markdown za slanje klijentu umjesto JSON-a")
  .option("--telegram", "kratka verzija za jednu Telegram poruku")
  .option("--bez-snapshota", "ne koristi dnevni snapshot (bez higijene i ucinka)")
  .action(async (opts: { md?: boolean; telegram?: boolean; bezSnapshota?: boolean }) => {
    try {
      const c = await withAuth();
      // Snapshot nosi slike, podnaslov, opis, atribute i preglede. Bez njega izvjestaj i dalje
      // radi, samo je kraci, pa se nedostatak javlja na stderr umjesto da obori komandu.
      let detalji: { oglasi: OnboardingDetalj[]; ts: number } | undefined;
      if (!opts.bezSnapshota) {
        const zadnji = zadnjiSnapshot();
        if (zadnji) {
          detalji = { oglasi: zadnji.oglasi, ts: zadnji.ts };
        } else {
          console.error("Nema snapshota u .olx-pik/snapshots; izvjestaj ide bez higijene i ucinka.");
          console.error("Za punu sliku prvo pokreni: stats snapshot");
        }
      }
      const rezultat = await c.statsOnboarding(detalji);
      if (opts.telegram) out(onboardingTelegram(rezultat.izvjestaj));
      else if (opts.md) out(onboardingMarkdown(rezultat.izvjestaj));
      else out(rezultat);
    } catch (e) {
      fail(e);
    }
  });

stats
  .command("konkurent-snimi <username>")
  .description("Snimi stanje konkurenta u .olx-pik/konkurenti (za sedmicno poredjenje)")
  .action(async (username: string) => {
    try {
      const c = await withAuth();
      const { izvjestaj } = await c.statsKonkurent(username, 0);
      const oglasi = (await c.listAllByState("active", username)).oglasi.map((o) => ({
        id: o.id,
        title: o.title,
        price: typeof o.price === "number" ? o.price : undefined,
        sponsored: typeof o.sponsored === "number" ? o.sponsored : undefined,
      }));
      const putanja = upisiKonkurenta({
        verzija: 1,
        ts: Math.floor(Date.now() / 1000),
        username,
        izvjestaj,
        oglasi,
      });
      out({ fajl: putanja, oglasa: oglasi.length });
    } catch (e) {
      fail(e);
    }
  });

stats
  .command("konkurent-promjena <username>")
  .description("Razlika izmedju dva zadnja snimka konkurenta")
  .action(async (username: string) => {
    try {
      const snimci = ucitajKonkurenta(username);
      if (snimci.length < 2) {
        throw new Error(
          `Za ${username} postoji ${snimci.length} snimak/snimaka. Trebaju bar dva; pokreni 'stats konkurent-snimi ${username}' pa probaj za koji dan.`,
        );
      }
      const prije = snimci[snimci.length - 2]!;
      const sada = snimci[snimci.length - 1]!;
      out(promjenaKonkurenta(username, prije, sada));
    } catch (e) {
      fail(e);
    }
  });

stats
  .command("konkurent <username>")
  .description("Izvjestaj o tudjem nalogu iz javnih podataka")
  .option("--top-views <n>", "broj top oglasa za detaljni pregled", "0")
  .action(async (username: string, opts: { topViews: string }) => {
    try {
      out(await (await withAuth()).statsKonkurent(username, Number(opts.topViews) || 0));
    } catch (e) {
      fail(e);
    }
  });

stats
  .command("konkurent-telefon <username>")
  .description("Telefon kandidata iz javnog teksta (opis shopa i oglasa); API ga ne vraca kao polje")
  .option("--broj-oglasa <n>", "koliko najskorijih aktivnih oglasa provjeriti uz opis shopa", "5")
  .action(async (username: string, opts: { brojOglasa: string }) => {
    try {
      out(await (await withAuth()).statsKonkurentTelefon(username, Number(opts.brojOglasa) || 5));
    } catch (e) {
      fail(e);
    }
  });

stats
  .command("oglas <id>")
  .description("Izracunata analiza jednog oglasa (naseg ili tudjeg)")
  .action(async (id: string) => {
    try {
      out(await (await withAuth()).statsOglas(id));
    } catch (e) {
      fail(e);
    }
  });

stats
  .command("alarmi")
  .description("Brza provjera naloga: paket, krediti, kvota, istekli")
  .option("--krediti-min <n>", "prag salda kredita", "500")
  .option("--paket-dana <n>", "alarm kad paket istice za manje od N dana", "14")
  .action(async (opts: { kreditiMin: string; paketDana: string }) => {
    try {
      out(await (await withAuth()).statsAlarmi({ kreditiMin: Number(opts.kreditiMin), paketDana: Number(opts.paketDana) }));
    } catch (e) {
      fail(e);
    }
  });

stats
  .command("snapshot")
  .description(
    "Dnevni snimak pregleda SVIH aktivnih oglasa u .olx-pik/snapshots (sporo: jedan zahtjev po oglasu; " +
      "za cron, budzet po pokretanju, nastavlja se preko vise pokretanja dok se katalog ne obidje cio)",
  )
  .action(async () => {
    try {
      const startPokretanja = Date.now();
      const cfg = loadConfig();
      const c = await withAuth();
      const username = await c.resolveUsername();
      mkdirSync(SNAPSHOT_DIR, { recursive: true });
      const otpusti = zauzmiKljuc(`${SNAPSHOT_DIR}/snapshot`);
      try {
        const sadaSekunde = Math.floor(Date.now() / 1000);
        let radni = ucitajSnapshotUToku();

        // Podmetnut ili zaostao radni fajl drugog naloga se nikad ne nastavlja: jedan klon je
        // jedan nalog, pa bi nastavak ovdje upisao tudje ID-eve u nas snimak.
        if (radni && radni.account !== username) {
          console.error(
            `Radni fajl snapshota pripada drugom nalogu (${radni.account}), odbacujem i pocinjem prolaz iznova.`,
          );
          obrisiSnapshotUToku();
          radni = null;
        }

        // Prolaz razmazan preko vise pokretanja unosi gresku ogranicenu upravo ovom granicom
        // (mrtvi oglasi se racunaju tek nad periodom od najmanje 14 dana). Prestar prolaz se
        // ODBACUJE umjesto da se nastavi, i to se javlja administratoru: to je jedini nacin da
        // neko sazna da katalog nikako ne stize da se obidje u zadatom roku.
        if (radni && sadaSekunde - radni.pocetak > cfg.maxTrajanjeSnapshotProlazaMs / 1000) {
          const poruka =
            `stats snapshot: prolaz je trajao duze od dozvoljenih ${cfg.maxTrajanjeSnapshotProlazaMs} ms ` +
            `i odbacen je nedovrsen (procitano ${radni.oglasi.length} od ${radni.idevi.length} oglasa). ` +
            "Prolaz krece iznova od pocetka kataloga.";
          console.error(poruka);
          await javiAdminu(poruka);
          obrisiSnapshotUToku();
          radni = null;
        }

        if (!radni) {
          // Spisak ID-eva se cita SAMO ovdje, na pocetku prolaza, i dalje se ne osvjezava:
          // snapshot time ostaje koherentan snimak jednog trenutka. Oglas objavljen usred
          // prolaza nije u ovom snapshotu, nego u sljedecem.
          const aktivni = await c.listAllByState("active", username);
          if (!aktivni.potpuno) {
            throw new Error(
              `Lista aktivnih oglasa nije potpuna (procitano ${aktivni.oglasi.length} od ` +
                `${aktivni.ukupno ?? "nepoznato"} oglasa, razlog: ${aktivni.razlog ?? "nepoznat"}). ` +
                "Snapshot se ne pise: nepotpun snimak bi sutra prijavio zive oglase kao mrtve.",
            );
          }
          radni = {
            pocetak: sadaSekunde,
            account: username,
            idevi: aktivni.oglasi.map((o) => o.id),
            oglasi: [],
            broj_poziva: Math.max(1, Math.ceil(aktivni.oglasi.length / 20)) + 1,
            trajanje_ms: 0,
          };
        }

        const vecObidjeno = new Set(radni.oglasi.map((o) => o.id));
        const preostaliIdevi = radni.idevi.filter((id) => !vecObidjeno.has(id));

        let obradjenoOvajPuta = 0;
        let budzetIstekao = false;
        for (const id of preostaliIdevi) {
          const full = await c.getListing(id);
          // Polja za higijenu se hvataju ovdje jer je puni oglas ionako vec dohvacen. Bez toga bi
          // onboarding izvjestaj morao ponoviti isti prolaz kroz sve oglase, a to je minute.
          const images = Array.isArray(full.images) ? (full.images as unknown[]) : [];
          const attributes = Array.isArray(full.attributes)
            ? (full.attributes as { value?: unknown }[]).filter(
                (a) => a.value !== null && a.value !== undefined && a.value !== "",
              )
            : [];
          const podnaslov = typeof full.short_description === "string" ? full.short_description.trim() : "";
          const opis = typeof full.additional?.description === "string" ? full.additional.description.trim() : "";
          radni.oglasi.push({
            id: full.id,
            title: full.title,
            views: typeof full.views === "number" ? full.views : 0,
            questions: typeof full.questions === "number" ? full.questions : undefined,
            sponsored: typeof full.sponsored === "number" ? full.sponsored : undefined,
            date: typeof full.date === "number" ? full.date : undefined,
            created_at: typeof full.created_at === "number" ? full.created_at : undefined,
            status: full.status,
            price: typeof full.price === "number" ? full.price : undefined,
            slika_broj: images.length,
            ima_podnaslov: podnaslov.length > 0,
            opis_znakova: opis.length,
            atributa: attributes.length,
            category_id: typeof full.category_id === "number" ? full.category_id : undefined,
            // Verzija 3 (vidi ViewsSnapshotOglas): kad je BAS OVAJ oglas procitan. Upisuje se, ali
            // se namjerno ne koristi ni u jednom racunu ovog izdanja.
            procitano_ts: Math.floor(Date.now() / 1000),
          });
          radni.broj_poziva += 1;
          obradjenoOvajPuta += 1;
          if (radni.oglasi.length % 20 === 0) {
            console.error(`Snapshot: ${radni.oglasi.length}/${radni.idevi.length} oglasa...`);
          }
          // Budzet po pokretanju, ne po prolazu: kad istekne, pokretanje staje uredno (radni fajl
          // upisan, izlazni kod 0), a nastavak ide sljedecim pokretanjem crona.
          if (Date.now() - startPokretanja >= cfg.budzetSnapshotMs) {
            budzetIstekao = true;
            break;
          }
        }
        radni.trajanje_ms += Date.now() - startPokretanja;

        if (budzetIstekao && radni.oglasi.length < radni.idevi.length) {
          // Djelimican snapshot se NIKAD ne pise. Ovo nije kvar nego planiran nastavak: izlazni
          // kod ostaje 0 i posaoFail se ne zove.
          upisiSnapshotUToku(radni);
          out({
            nastavlja_se: true,
            oglasa_obidjeno: radni.oglasi.length,
            oglasa_ukupno: radni.idevi.length,
            oglasa_ovo_pokretanje: obradjenoOvajPuta,
            trajanje_ms: Date.now() - startPokretanja,
          });
          return;
        }

        const snapshot = {
          // Verzija 3 nosi procitano_ts po oglasu (vidi ViewsSnapshotOglas u stats.ts). Citac ne
          // gleda broj verzije nego prisustvo polja, pa se snapshoti verzije 1, 2 i 3 i dalje
          // ucitavaju normalno.
          verzija: 3,
          ts: Math.floor(Date.now() / 1000),
          account: username,
          broj_poziva: radni.broj_poziva,
          trajanje_ms: radni.trajanje_ms,
          oglasi: radni.oglasi,
        };
        const putanja = upisiSnapshot(snapshot);
        obrisiSnapshotUToku();
        // Prorjedjivanje TEK poslije potpunog prolaza i uspjelog upisa: prekid na budzetu ne smije
        // brisati istoriju, jer bi neuspjeli prolaz svakodnevno grickao seriju bez ijednog novog
        // snapshota. Funkcija nikad ne baca, pa ne moze oboriti posao koji je svoj dio vec zavrsio.
        const konfig = loadConfig();
        const proredjeno = proredjiStareSnapshote(SNAPSHOT_DIR, {
          pragDana: konfig.snapshotProredjivanjePragDana,
          gustinaDana: konfig.snapshotProredjivanjeGustinaDana,
        });
        out({
          fajl: putanja,
          oglasa: snapshot.oglasi.length,
          trajanje_ms: snapshot.trajanje_ms,
          proredjeno: proredjeno.obrisano,
        });
      } finally {
        otpusti();
      }
    } catch (e) {
      // Snapshot radi nocu iz crona bez ikoga za ekranom. Pad (istekao token, zaglavljen
      // lock) bez javljanja adminu znaci da vremenska serija tiho stane; zato posaoFail,
      // ne fail. Prekid na budzetu NIJE pad (vidi return iznad) i tu ne dolazi.
      await posaoFail("snapshot", e);
    }
  });

stats
  .command("efekat <id>")
  .description("Efekat izdvajanja iz dnevnih snapshota: pregledi dnevno prije/tokom/poslije")
  .option("--od <ts>", "pocetak perioda (unix sekunde); default iz aktivnog izdvajanja")
  .option("--do <ts>", "kraj perioda (unix sekunde)")
  .action(async (id: string, opts: { od?: string; do?: string }) => {
    try {
      const c = await withAuth();
      let period: { od_ts: number; do_ts: number } | null =
        opts.od && opts.do ? { od_ts: Number(opts.od), do_ts: Number(opts.do) } : null;
      if (!period) {
        const listing = await c.getListing(id);
        const aktivno = listing.sponsor_active as { sponsored_until?: number; sponsored_days?: number } | null;
        if (aktivno?.sponsored_until && aktivno.sponsored_days) {
          period = { od_ts: aktivno.sponsored_until - aktivno.sponsored_days * 86_400, do_ts: aktivno.sponsored_until };
        }
      }
      if (!period) throw new Error("Oglas nema aktivno izdvajanje; zadaj --od i --do (unix sekunde).");
      // Prozor NIJE suzen: --od/--do mogu biti proizvoljno u proslosti, a efekatIzdvajanja
      // racuna "prije" segment bez gornje granice unazad. Kratak prozor bi tiho odsjekao
      // baseline i pretvorio validan izracun u pogresno "nema dovoljno snapshota".
      const snapshoti = ucitajSnapshote();
      out({ period, snapshota: snapshoti.length, ...efekatIzdvajanja(snapshoti, Number(id), period) });
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
      if (!active.potpuno) {
        console.error(
          `Upozorenje: uparivanje nije pokrilo cijeli katalog (procitano ${active.oglasi.length} od ` +
            `${active.ukupno ?? "nepoznato"} oglasa, razlog: ${active.razlog ?? "nepoznat"}).`,
        );
      }
      const pik: PikItem[] = [];
      for (const listing of active.oglasi) {
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

// ---- Telegram grupe ----
//
// Rucna administratorska komanda, ne cron posao: zato je van grupe `posao`.
//
// Postoji jer `pripremi-runtime.mjs` odbija rad na vec pripremljenom runtime-u, pa je do sada
// jedini nacin da se doda druga grupa bio rucni edit access.json ili brisanje cijelog runtimea
// (sto gubi uparivanja). Klijentska sesija ovo ne moze pozvati: `runtime/settings.klijent.json`
// joj brani Bash, Write i citanje samog access.json.
const telegram = program.command("telegram").description("Grupe u kojima bot radi (ne trosi kredite)");

// Odredista vise ne dolaze samo iz .env, pa poruka o gresci ne smije upucivati samo tamo: covjek
// bi popunio .env i time zaobisao pravi izvor umjesto da ga popravi.
const BEZ_ODREDISTA =
  "Telegram poruka NIJE poslana: nema nijednog odredista. Ili fali TELEGRAM_BOT_TOKEN u .env, " +
  "ili nema nijedne grupe. Dodaj grupu sa: bun dist/cli/index.js telegram grupe dodaj <id_grupe>";

function spisakOdredista(): { iz_accessa: string[]; iz_enva: string[]; odredista: string[]; access_fajl: string } {
  const izAccessa = grupeKlijenta();
  const izEnva = chatIdovi(process.env.TELEGRAM_CHAT_ID);
  return {
    iz_accessa: izAccessa,
    iz_enva: izEnva,
    odredista: izaberiOdredista(undefined, process.env.TELEGRAM_CHAT_ID, izAccessa),
    access_fajl: putanjaPristupa(),
  };
}

const grupe = telegram.command("grupe").description("Grupe kojima idu izvjestaji");

grupe
  .command("lista", { isDefault: true })
  .description("Ko sve dobija dnevni i sedmicni izvjestaj, i odakle taj id dolazi")
  .action(() => {
    try {
      const s = spisakOdredista();
      // Id koji je samo u .env znaci da bot u toj grupi ne prima poruke: izvjestaj stize, ali
      // klijent ne moze odgovoriti botu. Tiha polovicna postavka, pa se izricito imenuje.
      const samoUEnvu = s.iz_enva.filter((id) => !s.iz_accessa.includes(id));
      out({ ...s, samo_u_envu: samoUEnvu });
    } catch (e) {
      fail(e);
    }
  });

grupe
  .command("dodaj <chatId>")
  .description("Dodaj grupu u access.json (idempotentno)")
  .option("--admin", "radi nad .claude-runtime-admin umjesto klijentskog runtimea", false)
  .option("--trazi-mention", "bot reaguje samo kad ga se oznaci", false)
  .option("--allow <ids>", "ko smije pisati botu u toj grupi (zarezom); podrazumijevano isti kao ostale grupe")
  .action((chatId: string, opts: { admin?: boolean; traziMention?: boolean; allow?: string }) => {
    try {
      const vrsta = opts.admin ? "admin" : "klijent";
      const putanja = putanjaPristupa(vrsta);
      const mtime = mtimePristupa(putanja);
      const pristup = citajPristup(putanja);
      if (!pristup) throw new Error(`Nema ili je pokvaren ${putanja}. Pokreni prvo scripts/pripremi-runtime.mjs.`);

      const bilo = imaGrupu(pristup, chatId);
      const izmjena: Record<string, unknown> = {};
      // Samo izricito zadano polje ulazi u izmjenu: ponovljena komanda nad postojecom grupom ne
      // smije vratiti allowFrom na podrazumijevani i izbaciti ljude kojima je pristup dat rucno.
      if (opts.traziMention) izmjena.requireMention = true;
      if (opts.allow !== undefined) izmjena.allowFrom = chatIdovi(opts.allow);

      const novi = dodajGrupu(pristup, chatId, izmjena);
      const promijenjeno = JSON.stringify(novi) !== JSON.stringify(pristup);
      if (promijenjeno) upisiPristup(novi, { putanja, mtimeOcekivan: mtime ?? undefined });

      out({
        chat_id: String(chatId).trim(),
        runtime: vrsta,
        vec_postojala: bilo,
        promijenjeno,
        grupa: novi.groups[String(chatId).trim()],
        // Izvjestaj krece odmah, jer ga cron cita pri svakom pokretanju. Dolazne poruke ne: plugin
        // cita access.json pri startu sesije, pa dok se ne restartuje bot u novoj grupi cuti.
        napomena: promijenjeno
          ? "Izvjestaji idu odmah. Da bot POCNE odgovarati u toj grupi, restartuj klijentsku sesiju."
          : "Nista nije promijenjeno.",
      });
    } catch (e) {
      fail(e);
    }
  });

grupe
  .command("ukloni <chatId>")
  .description("Ukloni grupu iz access.json (idempotentno)")
  .option("--admin", "radi nad .claude-runtime-admin umjesto klijentskog runtimea", false)
  .action((chatId: string, opts: { admin?: boolean }) => {
    try {
      const vrsta = opts.admin ? "admin" : "klijent";
      const putanja = putanjaPristupa(vrsta);
      const mtime = mtimePristupa(putanja);
      const pristup = citajPristup(putanja);
      if (!pristup) throw new Error(`Nema ili je pokvaren ${putanja}.`);

      const novi = ukloniGrupu(pristup, chatId);
      const promijenjeno = novi !== pristup;
      if (promijenjeno) upisiPristup(novi, { putanja, mtimeOcekivan: mtime ?? undefined });
      out({ chat_id: String(chatId).trim(), runtime: vrsta, promijenjeno, preostalo_grupa: Object.keys(novi.groups).length });
    } catch (e) {
      fail(e);
    }
  });

grupe
  .command("provjeri")
  .description("Je li bot jos u svakoj grupi sa spiska (getChat, ne trosi kredite)")
  .option("--javi", "posalji nalaz administratoru", false)
  .action(async (opts: { javi?: boolean }) => {
    try {
      const nalazi = await provjeriGrupe();
      if (opts.javi && nalazi.mrtvih.length > 0) await javiAdminu(porukaOMrtvimGrupama(nalazi.mrtvih));
      out(nalazi);
    } catch (e) {
      fail(e);
    }
  });

/**
 * getChat nad svakim odredistem. Admin DM se namjerno preskace: `getChat` nad korisnikom radi
 * samo ako je taj korisnik ikad pisao botu, pa bi svaki nalaz tvrdio da je admin mrtav.
 */
async function provjeriGrupe(): Promise<{ provjereno: number; ziv: NalazChata[]; mrtvih: NalazChata[]; nepoznato: NalazChata[] }> {
  const nalazi: NalazChata[] = [];
  for (const id of spisakOdredista().odredista) nalazi.push(await provjeriChat(id));
  return {
    provjereno: nalazi.length,
    ziv: nalazi.filter((n) => n.stanje === "ziv"),
    mrtvih: nalazi.filter((n) => n.stanje === "mrtav"),
    nepoznato: nalazi.filter((n) => n.stanje === "nepoznato"),
  };
}

/**
 * Grupa se NIKAD ne uklanja sama, samo se javi uz gotovu komandu. Tri razloga: getChat moze pasti
 * prolazno; prelazak grupe u supergrupu mijenja id, pa bi automatsko brisanje izbacilo klijenta
 * iz izvjestaja bez traga; i isti unos je dozvola za DOLAZNE poruke, pa bi ga jedna HTTP greska
 * utisala u oba smjera.
 */
function porukaOMrtvimGrupama(mrtvi: NalazChata[]): string {
  const redovi = mrtvi.map((n) => `- ${n.chatId}: ${n.razlog ?? "nedostupna"}`);
  return [
    `Bot vise nije u ${mrtvi.length} ${mrtvi.length === 1 ? "grupi" : "grupa"} sa spiska izvjestaja:`,
    ...redovi,
    "",
    "Ako je to namjerno, ukloni ih:",
    ...mrtvi.map((n) => `  bun dist/cli/index.js telegram grupe ukloni ${n.chatId}`),
    "Ako je grupa presla u supergrupu, id se promijenio i novi treba dodati rucno.",
  ].join("\n");
}

// ---- Zakazani poslovi ----
//
// Ovo pokrece launchd, ne covjek. Kljucno: nijedan model se ne poziva, brojeve racuna kod, pa
// dnevni izvjestaj kosta nula tokena. Obnove unutar besplatne kvote se izvrsavaju bez pitanja
// jer ne kostaju; nista sto trosi kredite se ovdje ne radi.
const posao = program.command("posao").description("Zakazani poslovi za cron (bez modela, bez troska kredita)");

// Greska u poslu ide administratoru, nikad klijentu. Klijent ne treba znati da je nesto puklo,
// treba mu neko ko to popravi.
async function posaoFail(ime: string, e: unknown): Promise<never> {
  const poruka = `Posao "${ime}" nije prosao: ${String(e instanceof Error ? e.message : e)}`;
  console.error(poruka);
  await javiAdminu(poruka);
  process.exit(1);
}

posao
  .command("dnevni")
  .description("Dnevna obnova unutar besplatne kvote i poruka klijentu na Telegram")
  .option("--suho", "izracunaj i ispisi, ali ne obnavljaj i ne salji", false)
  .option("--bez-slanja", "izvrsi obnove ali ne salji Telegram poruku", false)
  .action(async (opts: { suho?: boolean; bezSlanja?: boolean }) => {
    try {
      const c = await withAuth();
      const user = await c.resolveUsername();
      const sadaTs = Math.floor(Date.now() / 1000);

      const me = await c.me();
      const limits = await c.refreshLimits();
      const aktivni = await c.listAllActive(user);
      // Kad lista nije potpuna, meta.total sa API-ja je i dalje tacan broj aktivnih oglasa, pa
      // se on koristi kao imenilac umjesto duzine nepotpune liste u ruci (T5, dva racuna nize).
      const aktivnihUkupno = aktivni.ukupno ?? aktivni.oglasi.length;
      // Izuzeci se sklanjaju i u dnevnom poslu, isto kao u `refresh all`, i preskoceni se javljaju.
      const { prolaze: kandidati, preskoceni: izuzetiDanas } = odvojiIzuzete(
        aktivni.oglasi.filter((l) => l.refresh_available === true),
        ucitajIzuzeca(),
        "obnova",
      );
      // Broj aktivnih oglasa je gornja granica dnevnog tempa: bez toga izvjestaj javi tempo koji
      // je veci od broja oglasa i to klijentu zvuci kao propust, a nije.
      // Ritam je odluka trgovca; kad ga nije rekao, ide podrazumijevani (ravnomjerno).
      const ritam = ucitajRitam();
      const shop = (me.shop ?? null) as { ends_at?: number } | null;
      // Rok kvote: izmjereni dan reseta iz kvota dnevnika je najjaci dokaz, ciklus pretplate je
      // izvod, kalendar samo neizgovoreni fallback (olx://pravila-brojeva). Danasnje ocitanje se
      // dodaje u memoriji, jer se na disk upisuje tek nize, a reset se moze desiti bas danas.
      const izmjeren = izmjereniDanReseta([
        ...ucitajKvotuDnevnik(),
        {
          dan: new Date(sadaTs * 1000).toISOString().slice(0, 10),
          free_count: limits.free_count ?? 0,
          free_limit: limits.free_limit ?? 0,
          aktivnih: aktivnihUkupno,
        },
      ]);
      // Dan ciklusa se cita iz shopa; OLX_DAN_CIKLUSA_KVOTE je rezerva za nalog bez shopa.
      const danCiklusa = danCiklusaIzIsteka(shop?.ends_at) ?? loadConfig().danCiklusaKvote;
      const plan = dnevniPlanObnova({
        refreshLimits: limits,
        kandidata: kandidati.length,
        sadaTs,
        aktivnihOglasa: aktivnihUkupno,
        danCiklusa,
        izmjereniDanReseta: izmjeren,
        imaShop: shop !== null,
        ritam,
      });

      // Stanje kvote se biljezi svaki dan, jer API ne vraca datum reseta i bez ove serije se ne
      // moze vidjeti KAD se kvota obnovi (olx://pravila-brojeva, otvoreno pitanje). Ali samo kad
      // znamo pravi broj: nad nepotpunom listom BEZ meta.total bi upisan broj bio pogodjen, a
      // pogresan broj u kvota dnevniku se taloži danima (T5). Rupa u seriji je bezopasna.
      if (aktivni.potpuno || aktivni.ukupno !== null) {
        zapisiKvotu({
          freeLimit: limits.free_limit ?? 0,
          freeCount: limits.free_count ?? 0,
          aktivnih: aktivnihUkupno,
          danCiklusa,
        });
      } else {
        console.error(
          "Kvota dnevnik NIJE upisan danas: lista aktivnih oglasa je nepotpuna i API nije dao " +
            `meta.total (procitano ${aktivni.oglasi.length} oglasa, razlog: ${aktivni.razlog ?? "nepoznat"}).`,
        );
      }

      let obnovljeno: number | null = null;
      let neuspjelih = 0;
      if (!opts.suho) {
        obnovljeno = 0;
        const naRedu =
          ritam.strategija === "interval" && typeof ritam.dana === "number"
            ? poIntervalu(
                kandidati.map((l) => ({
                  ...l,
                  zadnjaObnova: typeof l.date === "number" ? l.date : undefined,
                })),
                intervalUzPrag(ritam.dana, pragObnove(shop !== null)),
                sadaTs,
              )
            : kandidati;
        for (const l of naRedu.slice(0, plan.za_obnovu)) {
          try {
            await c.refreshListing(l.id);
            obnovljeno += 1;
          } catch {
            neuspjelih += 1;
          }
        }
      }

      // Javka adminu ide TEK ovdje, poslije obnova, i postuje suho/bez-slanja isto kao klijentska
      // poruka nize. Poslana prije petlje bi u suhom prolazu tvrdila da su obnove izvrsene, a
      // nijedna ne bi bila, pa bi admin dobio tacan broj procitanih oglasa uz netacan ishod.
      if (!aktivni.potpuno && !opts.suho && !opts.bezSlanja) {
        await javiAdminu(
          `Dnevni posao: lista aktivnih oglasa nije potpuna, procitano ${aktivni.oglasi.length} od ` +
            `${aktivni.ukupno ?? "nepoznato"} oglasa (razlog: ${aktivni.razlog ?? "nepoznat"}). ` +
            `Obnovljeno ${obnovljeno ?? 0} oglasa nad procitanim dijelom kataloga.`,
        );
      }

      const istekli = await c.listExpired(user, 1);

      // Krediti potroseni danas, iz audit loga (mjesecni fajl + zatecena osnovna putanja). Log
      // koji jos ne postoji znaci nula potrosnje. Svaka druga greska citanja se NE guta u tihu
      // nulu: to bi klijentu prikazalo "potroseno 0" dok je stvarna potrosnja nepoznata, sto je
      // upravo obrnuto od onoga sto plafon treba da postigne. Posao i dalje ne smije pasti zbog
      // ovoga, pa se greska javlja administratoru, ne baca dalje.
      let potroseno: number | null = 0;
      try {
        potroseno = potrosenoNaDanUFajlovima(putanjeAuditaZaCitanje(loadConfig().auditFile), danasnjiDatum());
      } catch (e) {
        potroseno = null;
        if (!opts.bezSlanja) {
          await javiAdminu(
            `Dnevni posao: potrosnja kredita danas se nije mogla procitati iz audit loga (${String(e instanceof Error ? e.message : e)}).`,
          );
        }
      }
      // Plan izdvajanja nije obavezan: klijent bez plana dobija poruku bez te linije.
      const planIzdvajanja = citajPlanAkoPostoji();

      // Prozor = najsiri od dvoje sto se racuna iz iste serije: mrtviOglasi ispod haube
      // koristi danaUnazad=60 (default, nije prosljedjen ovdje), promjenaPregleda nize
      // trazi samo 2 dana. Veci od ta dva prozora je 60.
      const snapshoti = ucitajSnapshote(undefined, 60);
      // Mrtvi oglasi imaju smisla tek nad dovoljno dugom serijom: nad snapshotima od par dana
      // bi pola kataloga izgledalo mrtvo samo zato sto jos nije stiglo dobiti pregled.
      const mrtviSirovo = mrtviOglasi(snapshoti, sadaTs);
      const mrtvi = mrtviSirovo && mrtviSirovo.period_dana >= 14 ? mrtviSirovo : null;
      // Premalo tacaka u prozoru, a starijih ima: serija je PREKINUTA, dakle posao snapshot ne
      // radi vec skoro dva mjeseca. Tada `mrtviOglasi` vrati null i izvjestaj o mrtvim oglasima
      // tiho izostane. Tisina ne smije biti jedini ishod: pokvaren pogon se javlja ADMINU, ne
      // klijentu, jer klijenta ne opterecujemo time sto je nasa masina stala. Nov klon (nema
      // starijih snapshota) je normalno stanje i ne javlja se.
      if (snapshoti.length < 2 && imaSnapshotaStarijihOd(60)) {
        await javiAdminu(
          `Dnevni posao: serija snapshota je prekinuta. U zadnjih 60 dana ima ${snapshoti.length} snimaka, ` +
            "a stariji postoje, pa posao snapshot ocito ne radi. Izvjestaj o mrtvim oglasima izostaje dok se ne popravi. " +
            "Provjeri zakazan posao snapshot; rucno: bun dist/cli/index.js stats snapshot",
        );
      }
      // Bez odluke klijenta se nista ne obnavlja: prvi put ide puno pitanje sa listom (do 10,
      // granice.md), narednih dana samo podsjetnik u poruci koja se ionako salje.
      const obnovePitanje =
        plan.obnove_stanje === "ceka_odluku"
          ? {
              kandidata: kandidati.length,
              naslovi: kandidati.slice(0, 10).map((l) => l.title ?? String(l.id)),
              podsjetnik: Boolean(ritam.pitano),
            }
          : null;
      const podaci = {
        username: user,
        plan,
        obnovljeno,
        neuspjelih_obnova: neuspjelih,
        alarmi: alarmiNaloga(me, limits, istekli.meta.total, sadaTs, {}, izmjeren),
        nova_pitanja: typeof me.new_questions_count === "number" ? me.new_questions_count : null,
        // Dnevni prirast pregleda: dva zadnja snimka, pa raspon od 2 dana umjesto 7.
        promjena: promjenaPregleda(snapshoti, sadaTs, 2),
        dospjelo: planIzdvajanja ? dospjeliTermini(planIzdvajanja, danasnjiDatum()).length : 0,
        potroseno_kredita: potroseno,
        mrtvi: mrtvi && mrtvi.oglasi.length > 0 ? { broj: mrtvi.oglasi.length, dana: mrtvi.period_dana } : null,
        izuzeti: izuzetiDanas.length,
        obnove_pitanje: obnovePitanje,
      };
      const tekst = dnevniTekst(podaci);

      // Jutarnja poruka ide samo kad ima sta korisno reci; "sve isto kao juce" se preskace
      // da klijent ne nauci ignorisati poruke. Preskok NIJE greska.
      if (!opts.suho && !opts.bezSlanja && !dnevniVrijedanSlanja(podaci)) {
        out({ plan, obnovljeno, neuspjelih, poslano_poruka: 0, preskoceno: "nista novo za javiti" });
        return;
      }

      const poslano = opts.suho || opts.bezSlanja ? 0 : await posaljiPoruku(tekst);
      // 0 poslanih van suhog rezima znaci da token ili chat NISU postavljeni: klijent bi bez
      // ove provjere mjesecima cutke ostajao bez jutarnje poruke, a log bi tvrdio uspjeh.
      if (!opts.suho && !opts.bezSlanja && poslano === 0) {
        throw new Error(BEZ_ODREDISTA);
      }
      // Puno pitanje je stiglo do klijenta: zabiljezi, da sutra ide samo podsjetnik. Tek
      // poslije uspjesnog slanja, jer neposlano pitanje nije pitanje.
      if (obnovePitanje && !obnovePitanje.podsjetnik && poslano > 0) {
        upisiRitam({ ...ritam, pitano: new Date().toISOString() });
      }
      out({ plan, obnovljeno, neuspjelih, poslano_poruka: poslano, tekst });
    } catch (e) {
      await posaoFail("dnevni", e);
    }
  });

posao
  .command("sedmicni")
  .description("Sedmicni pregled: prirast pregleda, sta raste, sta miruje i prijedlozi")
  .option("--suho", "ispisi ali ne salji", false)
  .option("--dana <n>", "raspon poredjenja u danima", "7")
  .action(async (opts: { suho?: boolean; dana: string }) => {
    try {
      const c = await withAuth();
      const user = await c.resolveUsername();
      const sadaTs = Math.floor(Date.now() / 1000);
      const zadnji = zadnjiSnapshot();
      const { izvjestaj } = await c.statsOnboarding(zadnji ? { oglasi: zadnji.oglasi, ts: zadnji.ts } : undefined);

      // Plan izdvajanja nije obavezan: klijent koji ga nema dobija izvjestaj bez te sekcije.
      const plan = citajPlanAkoPostoji();
      const tekst = sedmicniTekst({
        username: user,
        // Prozor je isti broj dana koji ide u promjenaPregleda kao danaUnazad, nema
        // razloga citati vise od toga.
        promjena: promjenaPregleda(ucitajSnapshote(undefined, Number(opts.dana) || 7), sadaTs, Number(opts.dana) || 7),
        onboarding: izvjestaj,
        plan: plan ? planSazetak(plan) : null,
        dospjelo: plan ? dospjeliTermini(plan, danasnjiDatum()).length : 0,
      });

      const poslano = opts.suho ? 0 : await posaljiPoruku(tekst);
      if (!opts.suho && poslano === 0) {
        throw new Error(BEZ_ODREDISTA);
      }

      // Provjera zivosti grupa jaha na sedmicnom poslu umjesto da bude svoj cron posao: nov posao
      // trazi launchd sablon I Windows zadatak (.claude/rules/pogon.md) i reinstalaciju poslova na
      // cijeloj floti, a ovdje je rijec o par getChat poziva za dogadjaj koji se desi par puta
      // godisnje. Nalaz ide ISKLJUCIVO adminu; klijent ne treba znati za nasu konfiguraciju.
      let grupe = null;
      if (!opts.suho) {
        try {
          const nalaz = await provjeriGrupe();
          if (nalaz.mrtvih.length > 0) await javiAdminu(porukaOMrtvimGrupama(nalaz.mrtvih));
          grupe = { provjereno: nalaz.provjereno, mrtvih: nalaz.mrtvih.length, nepoznato: nalaz.nepoznato.length };
        } catch (e) {
          // Provjera je dodatak, ne posao: njen pad ne smije oboriti izvjestaj koji je vec poslan.
          console.error(`Provjera grupa nije prosla: ${String(e instanceof Error ? e.message : e)}`);
        }
      }

      out({ poslano_poruka: poslano, grupe, tekst });
    } catch (e) {
      await posaoFail("sedmicni", e);
    }
  });

posao
  .command("backup")
  .description("Posalji klijentsko stanje na daljinu (pamcenje, izuzeca, audit, snapshoti)")
  .option("--suho", "ispisi sta bi islo i sta se preskace, bez ijednog upisa", false)
  .option("--nadzor", "samo javi kad je zadnji put stvarno poslano na daljinski", false)
  .option("--samo-provjeri", "uporedi klon sa onim sto je stvarno na daljinskom", false)
  .option("--vrati", "vrati stanje sa daljinskog u ovaj klon", false)
  .option("--potvrdi", "obavezno uz --vrati", false)
  .option("--pregazi", "uz --vrati: prepisi i fajlove koji vec postoje", false)
  .action(async (opts: { suho?: boolean; nadzor?: boolean; samoProvjeri?: boolean; vrati?: boolean; potvrdi?: boolean; pregazi?: boolean }) => {
    try {
      const korijen = process.cwd();
      const p = postavkeStanja(process.env, homedir(), korijen);

      // Nadzor se pita SA DALJINSKOG, ne iz lokalnog loga: ugasen posao, ugasena masina i istekao
      // token svi izgledaju isto lokalno, a na daljinskom se vidi kao stara grana.
      if (opts.nadzor) {
        if (!existsSync(join(p.radna, ".git"))) {
          out({ grana: p.grana, zadnji_upis: null, dana: null, napomena: "radna kopija ne postoji, backup jos nije radio" });
          return;
        }
        const kada = zadnjiUpis(p.radna, p.grana, p.token);
        const dana = kada ? Math.floor((Date.now() - Date.parse(kada)) / 86_400_000) : null;
        out({ grana: p.grana, zadnji_upis: kada, dana });
        return;
      }

      const svePutanje = popisiStanje(korijen);
      const { uzmi, preskoci, nepoznato } = razvrstaj(svePutanje);
      const zaKopiju = uzmi.map((u) => u.putanja);

      if (opts.suho) {
        out({
          grana: p.grana,
          radna: p.radna,
          ide: uzmi,
          preskace_se: preskoci,
          nepoznato,
          napomena: nepoznato.length > 0 ? "Nepoznato stanje se NE salje dok se ne doda na spisak." : "",
        });
        return;
      }

      if (opts.vrati) {
        if (!opts.potvrdi) throw new Error("Vracanje gazi stanje u ovom klonu. Ponovi sa --potvrdi.");
        bootstrap(p.radna, p.url, p.grana, korijen, p.token);
        const spisakZaVracanje = popisiStanje(p.radna).length > 0 ? popisiStanje(p.radna) : zaKopiju;
        const r = vratiIzRadne(p.radna, korijen, spisakZaVracanje, Boolean(opts.pregazi));
        out({ vraceno: r.vraceno.length, preskoceno: r.preskoceno, iz: p.radna });
        return;
      }

      if (opts.samoProvjeri) {
        // Svjez klon grane, da se poredi sa onim sto je STVARNO na daljinskom, a ne sa lokalnom
        // radnom kopijom koja moze imati necommitovanih izmjena.
        const privremena = mkdtempSync(join(tmpdir(), "olx-provjera-"));
        try {
          bootstrap(join(privremena, "kopija"), p.url, p.grana, korijen, p.token);
          const razlike = uporediSaKopijom(korijen, join(privremena, "kopija"), zaKopiju);
          out({ grana: p.grana, provjereno: zaKopiju.length, razlike });
        } finally {
          rmSync(privremena, { recursive: true, force: true });
        }
        return;
      }

      // Dvije masine na istoj grani se zaustavljaju PRIJE ijednog commita, umjesto da se
      // razilazenje hvata poslije.
      bootstrap(p.radna, p.url, p.grana, korijen, p.token);
      const masina = masinaSePoklapa(p.radna, p.grana, korijen, p.token);
      if (!masina.ok) {
        throw new Error(`Granu "${p.grana}" vec vodi druga masina (${masina.tudja?.hostname}, klon ${masina.tudja?.klon}). Ugasi poslove tamo prije nego sto ovdje krene backup.`);
      }

      const { upisano, sumnjivi } = kopirajURadnu(korijen, p.radna, zaKopiju);
      const ishod = commitIPush(p.radna, p.grana, `stanje ${p.grana} ${new Date().toISOString().slice(0, 10)}`, korijen, p.token);

      const upozorenja: string[] = [];
      if (sumnjivi.length > 0) {
        upozorenja.push(`Zaustavljeno zbog sumnjivog sadrzaja: ${sumnjivi.map((s) => `${s.putanja} (${s.nalazi.join(", ")})`).join("; ")}`);
      }
      if (nepoznato.length > 0) upozorenja.push(`Nije ni na jednom spisku, pa se ne salje: ${nepoznato.join(", ")}`);
      if (ishod.vrsta === "sudar") upozorenja.push(`Razilazenje na grani ${p.grana}: stanje je spaseno na ${ishod.grana}, spoji rucno.`);
      const dana = danaDoIsteka(p.isticeTokena, new Date());
      if (dana !== null && dana <= 14) upozorenja.push(`Token za repo stanja istice za ${dana} dana (${p.isticeTokena}).`);
      if (upozorenja.length > 0) await javiAdminu(`Backup stanja "${p.grana}":\n${upozorenja.join("\n")}`);

      out({ grana: p.grana, ishod: ishod.vrsta, upisano: upisano.length, sumnjivi, nepoznato });
    } catch (e) {
      await posaoFail("backup", e);
    }
  });

// Slanje gotovog teksta. Koristi ga AI runda (scripts/ai-runda.sh): headless sesija napise
// poruku na stdout, a ova komanda je isporuci kroz bot i grupu OVOG klona. Namjerno ne salje
// adminu na gresku (nema posaoFail): pozivalac odlucuje sta sa neuspjehom.
posao
  .command("posalji [tekst...]")
  .description("Posalji tekst na Telegram: klijentu u grupu, ili adminu uz --admin")
  .option("--stdin", "procitaj tekst sa standardnog ulaza umjesto iz argumenta", false)
  .option("--admin", "posalji u admin DM umjesto u grupu klijenta", false)
  .action(async (dijelovi: string[], opts: { stdin?: boolean; admin?: boolean }) => {
    try {
      let tekst = (dijelovi ?? []).join(" ");
      if (opts.stdin) {
        const komadi: Buffer[] = [];
        for await (const komad of process.stdin) komadi.push(komad as Buffer);
        tekst = Buffer.concat(komadi).toString("utf8");
      }
      tekst = tekst.trim();
      if (!tekst) throw new Error("Nema teksta za slanje: daj argument ili --stdin.");
      if (opts.admin) {
        // javiAdminu nikad ne baca, pa se uspjeh ovdje ne moze garantovati; za admin kanal je
        // to prihvatljivo, on je best-effort i u ostatku koda.
        await javiAdminu(tekst);
        out({ kanal: "admin", poslano_poruka: 1 });
        return;
      }
      const poslano = await posaljiPoruku(tekst);
      if (poslano === 0) {
        throw new Error(BEZ_ODREDISTA);
      }
      out({ kanal: "klijent", poslano_poruka: poslano });
    } catch (e) {
      fail(e);
    }
  });

/**
 * Telegram id grupe je NEGATIVAN broj, a commander svaki token koji pocinje minusom cita kao
 * opciju i pada sa "unknown option '-1005678'". Bez ovoga bi svaka komanda nad grupom trazila
 * `--` separator, sto se zaboravi i izgleda kao kvar.
 *
 * Id se PREMJESTA na kraj iza `--`, ne umece se separator na njegovo mjesto: `--` guta sve iza
 * sebe, pa bi `dodaj -100 --trazi-mention` tiho izgubio zastavicu. Ovako opcije ostaju opcije bez
 * obzira na redoslijed.
 *
 * Zahvat je namjerno uzak: dira samo granu `telegram`, samo prvi token koji je cio negativan
 * broj, i preskace ga ako je vrijednost neke opcije. Ostatak CLI-ja parsira commander netaknuto.
 */
function razrijesiNegativneIdove(argv: string[]): string[] {
  if (argv[2] !== "telegram" || argv.includes("--")) return argv;
  const i = argv.findIndex((t, n) => n > 2 && /^-\d+$/.test(t) && !argv[n - 1]!.startsWith("--"));
  if (i === -1) return argv;
  return [...argv.slice(0, i), ...argv.slice(i + 1), "--", argv[i]!];
}

// Komanda se izvrsava SAMO kad je ovaj modul ulaz procesa. Kad ga generator popisa uveze da
// procita stablo komandi, parsiranje bi inace uzelo `process.argv` GENERATORA i izvrsilo nesto
// sasvim deseto.
if (pokrenutDirektno(import.meta.url)) {
  program.parseAsync(razrijesiNegativneIdove(process.argv)).catch(fail);
}
