#!/usr/bin/env node
// Onboarding klijenta iz JEDNE komande, bez Cloudflare naloga i bez deploya.
//
// Cilj: klijent dobije link, uloguje se, a token i sve ostalo ostane na OVOM kompjuteru.
//
//   node scripts/onboarding-uzivo.mjs <putanja-do-klona>
//
// Sta radi, redom: pripremi kljuceve i tajnu ako fale, digne Worker LOKALNO (`wrangler dev
// --local`), otvori Cloudflare brzi tunel do njega, registruje sesiju, ispise link i kopira ga u
// clipboard, pa ceka da se klijent uloguje. Kad token stigne, upise ga u `.env` klona, provjeri
// `whoami`, pokrene analizu i pocisti za sobom.
//
// Zasto lokalno a ne deploy: nema `wrangler login`, nema KV namespace-a, nema `secret put` i nema
// javno dostupnog Workera koji drzi tokene. Uz to OLX login ide sa OVE IP adrese, a ne sa
// Cloudflare datacentra, pa pitanje egress adrese uopste ne postoji.
//
// Zasto Worker uopste, kad je sve lokalno: `workerd` NE MOZE pisati po disku. Zato Worker token
// ostavi u (lokalnom) KV-u, a ova skripta ga izvadi i upise. To je jedini razlog zasto pull
// postoji; nije ostatak deploy varijante.
//
// Sto se NE mijenja: `worker.js`, `ecies.mjs`, `onboarding-link.mjs` i `onboarding-puller.mjs`
// rade kao i prije i njihovi testovi ih i dalje pokrivaju. Ova skripta ih samo vodi. Deploy
// varijanta (README) ostaje moguca za slucaj da ikad zatreba trajan link.

import { existsSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { BAZA, config } from "./lib/podesavanja.mjs";
import { procitajEnv } from "./lib/envfajl.mjs";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_DIR = resolve(KORIJEN, "cloudflare/onboarding");

const arg = process.argv.slice(2);
const klon = arg.find((a) => !a.startsWith("--"));
const port = Number(arg.find((a) => a.startsWith("--port="))?.split("=")[1] ?? 8787);
const rokMin = Number(arg.find((a) => a.startsWith("--rok-min="))?.split("=")[1] ?? 30);
const bezAnalize = arg.includes("--bez-analize");

if (!klon) {
  console.error("Upotreba: node scripts/onboarding-uzivo.mjs <putanja-do-klona> [--port=8787] [--rok-min=30] [--bez-analize]");
  process.exit(2);
}
const klonPut = resolve(klon);
if (!existsSync(klonPut)) {
  console.error(`Klon ne postoji: ${klonPut}`);
  process.exit(2);
}

const djeca = [];
let zavrsavam = false;

function pocisti() {
  if (zavrsavam) return;
  zavrsavam = true;
  for (const d of djeca) {
    try {
      d.kill("SIGTERM");
    } catch {
      // proces je vec mrtav
    }
  }
}
process.on("SIGINT", () => {
  console.log("\nPrekinuto. Gasim Worker i tunel.");
  pocisti();
  process.exit(130);
});
process.on("exit", pocisti);

const cekaj = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pokreni proces i cekaj red u izlazu koji zadovoljava `trazi`; vrati taj red. */
function pokreniICekaj(komanda, argumenti, opcije, trazi, rokMs, ime) {
  return new Promise((res, rej) => {
    const d = spawn(komanda, argumenti, { ...opcije, stdio: ["ignore", "pipe", "pipe"] });
    djeca.push(d);
    let sve = "";
    let gotovo = false;
    const rok = setTimeout(() => {
      if (gotovo) return;
      gotovo = true;
      rej(new Error(`${ime} se nije podigao u ${Math.round(rokMs / 1000)}s. Izlaz:\n${sve.slice(-800)}`));
    }, rokMs);
    const gledaj = (b) => {
      sve += b.toString();
      if (gotovo) return;
      const pogodak = trazi(sve);
      if (pogodak) {
        gotovo = true;
        clearTimeout(rok);
        res(pogodak);
      }
    };
    d.stdout.on("data", gledaj);
    d.stderr.on("data", gledaj);
    d.on("exit", (kod) => {
      if (gotovo) return;
      gotovo = true;
      clearTimeout(rok);
      rej(new Error(`${ime} je izasao (kod ${kod}) prije nego se podigao. Izlaz:\n${sve.slice(-800)}`));
    });
  });
}

// ---- 1. kljucevi i tajna ----

const privFajl = resolve(BAZA, "onboarding-priv.b64");
if (!existsSync(privFajl)) {
  console.log("Nema admin kljuceva, pravim ih.");
  const r = spawnSync("node", [resolve(KORIJEN, "scripts/onboarding-kljuc.mjs")], { stdio: "inherit" });
  if (r.status !== 0) process.exit(1);
}
const pubFajl = resolve(BAZA, "onboarding-pub.b64");
const cfgFajl = resolve(BAZA, "config.json");
let cfg = existsSync(cfgFajl) ? config() : { workerBase: "", pullSecret: "" };
if (!cfg.pullSecret || cfg.pullSecret.length < 24) {
  // Tajna se generise ovdje i NIKAD se ne ispisuje. Minimum je 24 znaka, jer adminOk u
  // worker.js krace odbija (brana od fail-opena kad tajna fali).
  cfg = { ...cfg, pullSecret: randomBytes(32).toString("base64url") };
  writeFileSync(cfgFajl, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  chmodSync(cfgFajl, 0o600);
  console.log("Napravljena nova pull tajna u ~/.pikgpt/config.json");
}

// .dev.vars je lokalni izvor tajni za `wrangler dev`; u .gitignore je.
const devVars = resolve(WORKER_DIR, ".dev.vars");
writeFileSync(devVars, `ADMIN_PUB=${readFileSync(pubFajl, "utf8").trim()}\nPULL_SECRET=${cfg.pullSecret}\n`, { mode: 0o600 });
chmodSync(devVars, 0o600);

// ---- 2. Worker lokalno ----

console.log("Dizem Worker lokalno...");
await pokreniICekaj(
  "npx",
  ["wrangler", "dev", "--local", "--port", String(port)],
  { cwd: WORKER_DIR },
  (s) => (/Ready on https?:\/\/[^\s]+/.test(s) ? "ok" : null),
  90_000,
  "wrangler dev",
);
console.log(`Worker slusa na http://127.0.0.1:${port}`);

// ---- 3. tunel ----

console.log("Otvaram Cloudflare tunel...");
const tunel = await pokreniICekaj(
  "cloudflared",
  ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
  {},
  (s) => s.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0] ?? null,
  60_000,
  "cloudflared",
);
console.log(`Tunel: ${tunel}`);

// Adresa tunela je nova pri svakom pokretanju, pa se config osvjezava svaki put.
writeFileSync(cfgFajl, `${JSON.stringify({ ...cfg, workerBase: tunel }, null, 2)}\n`, { mode: 0o600 });
chmodSync(cfgFajl, 0o600);

// cloudflared ispise adresu PRIJE nego je ona stvarno dostupna sa interneta: dok se hostname ne
// propagira, curl vraca 000 (veza ne uspijeva). Izmjereno u praksi: nekad 12s, nekad preko 20s.
// Zato se ceka do 90s i ZAHTIJEVA 200; ranije se nastavljalo naslijepo, pa je registracija sesije
// padala na 000 i skripta je izlazila sa beskorisnom porukom.
process.stdout.write("Cekam da adresa tunela propagira");
let tunelZiv = false;
for (let i = 0; i < 30; i++) {
  const r = spawnSync("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "8", `${tunel}/`], { encoding: "utf8" });
  if ((r.stdout ?? "").trim() === "200") {
    tunelZiv = true;
    break;
  }
  process.stdout.write(".");
  await cekaj(3000);
}
console.log("");
if (!tunelZiv) {
  console.error(`Tunel ${tunel} nije postao dostupan u 90s. Provjeri mrezu i probaj ponovo.`);
  pocisti();
  process.exit(1);
}
console.log("Tunel je dostupan.");

// ---- 4. link ----

const link = spawnSync("node", [resolve(KORIJEN, "scripts/onboarding-link.mjs"), klonPut], { encoding: "utf8" });
if (link.status !== 0) {
  console.error(link.stdout, link.stderr);
  process.exit(1);
}
const adresa = (link.stdout || "").trim().split("\n").find((r) => r.startsWith("http"));
if (!adresa) {
  console.error("Link nije dobijen:\n", link.stdout, link.stderr);
  process.exit(1);
}

console.log("");
console.log("Posalji ovaj link klijentu na Telegram:");
console.log("");
console.log(`  ${adresa}`);
console.log("");
console.log(`Cekam da se uloguje (rok ${rokMin} min). Ctrl+C prekida.`);
console.log("Dok ovaj proces radi, link je ziv; kad se ugasi, link prestaje raditi.");

// ---- 5. cekaj token ----

const envPut = resolve(klonPut, ".env");
const imaToken = () => Boolean(procitajEnv(envPut).OLX_TOKEN);
const doKada = Date.now() + rokMin * 60_000;
let uspjelo = false;

while (Date.now() < doKada) {
  await cekaj(5000);
  // Puller radi jedan prolaz i izadje; on desifruje, upise token i pokrene analizu.
  // Puller ide DIREKTNO na lokalni Worker, ne kroz tunel: na istoj je masini, pa bi izlazak na
  // internet i vracanje bio nepotreban put koji jos i pada. Izmjereno 31.07.2026: kroz tunel je
  // Node fetch vracao "fetch failed" u petlji, dok je link skripta (curl) prolazila. `workerBase`
  // u configu ostaje adresa tunela, jer je ona ono sto klijent otvara.
  const r = spawnSync("node", [resolve(KORIJEN, "scripts/onboarding-puller.mjs"), ...(bezAnalize ? ["--bez-analize"] : [])], {
    encoding: "utf8",
    env: { ...process.env, PIKGPT_WORKER_BASE: `http://127.0.0.1:${port}` },
  });
  const izlaz = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (izlaz && !/nema spremnih sesija/i.test(izlaz)) console.log(izlaz);
  if (imaToken()) {
    uspjelo = true;
    break;
  }
}

console.log("");
if (uspjelo) {
  console.log(`Gotovo. OLX_TOKEN je upisan u ${envPut}, sve je ostalo na ovom kompjuteru.`);
  console.log("Gasim Worker i tunel; link od sada ne radi.");
} else {
  console.log(`Rok od ${rokMin} min je istekao, a token nije stigao.`);
  console.log("Ako se klijent nije uspio ulogovati, provjeri je li OLX prihvatio podatke; na formi");
  console.log("postoji i grana 'Imam OLX token', koja login ka OLX-u uopste ne radi.");
}
pocisti();
process.exit(uspjelo ? 0 : 1);
