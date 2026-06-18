#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { OlxClient, OlxSpendError } from "../core/index.js";
import { loadConfig } from "../core/config.js";
import type { SponsorOptions, SponsorType, SponsorDays, RefreshEvery } from "../core/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const KB_PATH = resolve(__dirname, "../../kb/OLX_PIK_AI_Knowledgebase.md");

const config = loadConfig();
const client = new OlxClient(config);

type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const structured = data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : { data };
  return { content: [{ type: "text", text }], structuredContent: structured };
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
    return errResult(String(e instanceof Error ? e.message : e));
  }
}

const server = new McpServer({ name: "olx-pik-mcp-server", version: "0.1.0" });

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

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const writeOp = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;
const destructiveOp = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;

// ===== SIGURNI ALATI =====

server.registerTool(
  "olx_whoami",
  { title: "Ko sam", description: "Vraca trenutni nalog. Koristi za test pristupa API-ju.", inputSchema: {}, annotations: readOnly },
  () => run((c) => c.me()),
);

server.registerTool(
  "olx_list_listings",
  {
    title: "Lista oglasa",
    description:
      "Lista oglasa po stanju. state: active|finished|inactive|expired|hidden. user je opciono (default ulogovani). all=true prelistava sve stranice za active.",
    inputSchema: {
      state: z.enum(["active", "finished", "inactive", "expired", "hidden"]).default("active"),
      user: z.string().optional().describe("username ili id; default je ulogovani korisnik"),
      page: z.number().int().min(1).default(1),
      all: z.boolean().default(false).describe("samo za active: prelistaj sve stranice"),
    },
    annotations: readOnly,
  },
  (args) =>
    run(async (c) => {
      const user = args.user ?? (await c.me()).username ?? String((await c.me()).id);
      if (args.state === "active") return args.all ? c.listAllActive(user) : c.listActive(user, args.page);
      if (args.state === "finished") return c.listFinished(user, args.page);
      if (args.state === "inactive") return c.listInactive(user, args.page);
      if (args.state === "expired") return c.listExpired(user, args.page);
      return c.listHidden(user, args.page);
    }),
);

server.registerTool(
  "olx_get_listing",
  { title: "Detalji oglasa", description: "Dohvata pojedinacni oglas po ID-u.", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: readOnly },
  (args) => run((c) => c.getListing(args.id)),
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
      days: z.number().int().describe("1,2,3,5,7,14,21,30"),
      refresh_every: z.number().int().optional().describe("0,3,6,8,24"),
      homepage: z.boolean().default(false),
    },
    annotations: readOnly,
  },
  (args) =>
    run((c) =>
      c.sponsorPrice(args.id, {
        type: args.type as SponsorType,
        days: args.days as SponsorDays,
        refresh_every: args.refresh_every as RefreshEvery | undefined,
        locations: args.homepage ? ["homepage"] : undefined,
      }),
    ),
);

// ===== UPIS =====

server.registerTool(
  "olx_create_listing",
  {
    title: "Kreiraj oglas",
    description:
      "Kreira oglas. Ostaje DRAFT i NIJE vidljiv dok se ne objavi (olx_publish_listing). Obavezan je title. Za vozila koristi brand_id/model_id i attributes (vidi olx_category_attributes).",
    inputSchema: {
      title: z.string().min(1),
      short_description: z.string().optional(),
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
    },
    annotations: writeOp,
  },
  (args) => run((c) => c.createListing(args)),
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
    description: "Mijenja polja oglasa (npr. title, description, price).",
    inputSchema: {
      id: z.union([z.number(), z.string()]),
      title: z.string().optional(),
      description: z.string().optional(),
      short_description: z.string().optional(),
      price: z.number().optional(),
      available: z.boolean().optional(),
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
  "olx_refresh_bulk",
  {
    title: "Bulk obnova",
    description:
      "Obnavlja aktivne oglase kojima je obnova dostupna, uz postivanje mjesecnog limita. confirm=false (default) je dry-run i vraca samo listu kandidata. confirm=true izvrsava obnovu.",
    inputSchema: {
      user: z.string().optional(),
      limit: z.number().int().min(1).max(750).default(100),
      confirm: z.boolean().default(false),
    },
    annotations: writeOp,
  },
  (args) =>
    run(async (c) => {
      const user = args.user ?? (await c.me()).username ?? String((await c.me()).id);
      const limits = await c.refreshLimits();
      const remaining = Math.max(0, limits.free_limit - limits.free_count);
      const cap = Math.min(args.limit, remaining);
      const all = await c.listAllActive(user);
      const candidates = all.filter((l) => l.refresh_available === true).slice(0, cap);
      if (!args.confirm) {
        return { dry_run: true, remaining_free: remaining, candidates: candidates.map((l) => ({ id: l.id, title: l.title })) };
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
      return { refreshed: results.filter((r) => r.ok).length, total: results.length, results };
    }),
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
  { title: "Zavrsi oglas", description: "Oznacava oglas kao zavrsen/prodano (cuva historiju i statistiku).", inputSchema: { id: z.union([z.number(), z.string()]) }, annotations: writeOp },
  (args) => run((c) => c.finishListing(args.id)),
);

server.registerTool(
  "olx_delete_listing",
  {
    title: "Obrisi oglas",
    description:
      "NEPOVRATNO brise oglas. Trazi confirm=true. Za dolazak na vrh koristi obnovu, ne brisanje. Kad nema na stanju koristi hide/finish.",
    inputSchema: { id: z.union([z.number(), z.string()]), confirm: z.boolean().default(false) },
    annotations: destructiveOp,
  },
  (args) =>
    run((c) => {
      if (!args.confirm) throw new Error("Brisanje je nepovratno. Pozovi ponovo sa confirm: true.");
      return c.deleteListing(args.id);
    }),
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
      days: z.number().int().describe("1,2,3,5,7,14,21,30"),
      refresh_every: z.number().int().optional().describe("0,3,6,8,24"),
      homepage: z.boolean().default(false),
      confirm: z.boolean().default(false),
    },
    annotations: writeOp,
  },
  (args) => {
    const options: SponsorOptions = {
      type: args.type as SponsorType,
      days: args.days as SponsorDays,
      refresh_every: args.refresh_every as RefreshEvery | undefined,
      locations: args.homepage ? ["homepage"] : undefined,
    };
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
    annotations: writeOp,
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
  console.error("olx-pik-mcp-server radi preko stdio.");
}

main().catch((e) => {
  console.error("Greska servera:", e);
  process.exit(1);
});
