// Integracioni test Mac strane (onboarding-link.mjs + onboarding-puller.mjs) protiv Workera
// podignutog iza lokalnog http servera. OLX se stubuje, whoami se stubuje laznim CLI-jem u
// privremenom klonu. Provjerava da token stvarno sleti u .env i da se sesija obrise.
//
// Pokretanje: node cloudflare/onboarding/test-mac.mjs

import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import worker from "./worker.js";
import { napraviPar } from "../../scripts/lib/ecies.mjs";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let palo = 0;
const ok = (u, opis) => (u ? console.log("  ok:", opis) : (palo++, console.error("  PAO:", opis)));

const PRAVI_TOKEN = "olx-bearer-" + "q".repeat(100);
// Najmanje 24 znaka, jer adminOk u worker.js krace tajne odbija (brana od fail-opena).
const PULL = "tajna-mac-test-dovoljno-dugacka";

// ---- mock KV ----
function mockKV() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    async list({ prefix = "" } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

const par = await napraviPar();
const env = { SESIJE: mockKV(), ADMIN_PUB: par.javniB64, PULL_SECRET: PULL, OLX_API: "https://api.olx.ba", MAX_POKUSAJA: "5" };

// ---- stub OLX, sve ostalo ide pravom fetchu (da lokalni server radi) ----
const praviFetch = globalThis.fetch;
globalThis.fetch = async (url, opcije = {}) => {
  const u = String(url);
  if (u === "https://api.olx.ba/auth/login") {
    const t = JSON.parse(opcije.body || "{}");
    if (t.username === "MixBox" && t.password === "tacna") {
      return new Response(JSON.stringify({ token: PRAVI_TOKEN, user: { username: "MixBox", city: "Sarajevo" } }), { status: 200 });
    }
    return new Response("{}", { status: 422 });
  }
  return praviFetch(url, opcije);
};

// ---- lokalni server oko workera ----
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request("http://127.0.0.1" + req.url, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
  });
  const r = await worker.fetch(request, env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// ---- privremeni ~/.pikgpt i klon ----
const baza = mkdtempSync(resolve(tmpdir(), "pikgpt-"));
const pikgptDir = resolve(baza, ".pikgpt");
mkdirSync(pikgptDir, { recursive: true });
writeFileSync(resolve(pikgptDir, "onboarding-priv.b64"), par.privatniB64 + "\n", { mode: 0o600 });

const klon = resolve(baza, "klon");
mkdirSync(resolve(klon, "dist/cli"), { recursive: true });
writeFileSync(resolve(klon, ".env.example"), "OLX_TOKEN=\nTELEGRAM_BOT_TOKEN=\nTELEGRAM_CHAT_ID=\n");
// Lazni CLI koji NE prolazi na bilo sta: zapise argumente i pada ako komanda nije `whoami`.
// Prije je bio `process.exit(0)` na sve, pa je puller godinama mogao zvati nepostojecu komandu i
// test bi bio zelen. Nadjeno uzivo 31.07.2026: zvao je `auth whoami`, sto commander ne poznaje.
writeFileSync(
  resolve(klon, "dist/cli/index.js"),
  [
    "const a = process.argv.slice(2);",
    "require('node:fs').writeFileSync(require('node:path').resolve(__dirname, '../../cli-argumenti.txt'), a.join(' '));",
    "process.exit(a.join(' ') === 'whoami' ? 0 : 1);",
  ].join("\n") + "\n",
);

const okrog = {
  ...process.env,
  PIKGPT_DIR: pikgptDir,
  PIKGPT_WORKER_BASE: BASE,
  PIKGPT_PULL_SECRET: PULL,
};

// Async spawn: sync bi zamrznuo event loop, pa lokalni server u istom procesu ne bi mogao
// prihvatiti djetetovu konekciju (deadlock).
function pokreni(skripta, args) {
  return new Promise((res) => {
    const d = spawn(process.execPath, [resolve(KORIJEN, skripta), ...args], { env: okrog });
    let out = "", err = "";
    d.stdout.on("data", (b) => (out += b));
    d.stderr.on("data", (b) => (err += b));
    d.on("close", (status) => res({ status, stdout: out, stderr: err }));
  });
}

console.log("1. link skripta registruje sesiju");
const lr = await pokreni("scripts/onboarding-link.mjs", [klon]);
if (lr.status !== 0) console.error("LINK stdout:", lr.stdout, "\nLINK stderr:", lr.stderr);
const link = (lr.stdout || "").trim().split("\n").pop();
ok(lr.status === 0, "link skripta prolazi");
ok(/\/o\/[A-Za-z0-9_-]{16,64}$/.test(link || ""), "ispisan validan link");
const id = (link || "").split("/o/")[1];
const mapa = JSON.parse(readFileSync(resolve(pikgptDir, "onboarding-sesije.json"), "utf8"));
ok(mapa[id]?.klon === klon, "mapa vezuje sesiju za klon");

console.log("2. klijent se uloguje (simulacija)");
const login = await praviFetch(`${BASE}/o/${id}/login`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({ mode: "kredencijali", username: "MixBox", password: "tacna" }),
});
ok((await login.json()).ok === true, "login uspio, sesija spremna");

console.log("3. puller upisuje token i cisti sesiju");
const pr = await pokreni("scripts/onboarding-puller.mjs", ["--bez-analize"]);
if (pr.status !== 0) console.error(pr.stdout, pr.stderr);
ok(pr.status === 0, "puller prolazi");
ok(!(pr.stdout + pr.stderr).includes(PRAVI_TOKEN), "puller nigdje ne ispisuje token");

const envKlon = readFileSync(resolve(klon, ".env"), "utf8");
ok(envKlon.includes(`OLX_TOKEN=${PRAVI_TOKEN}`), "OLX_TOKEN upisan u .env klona");

const argumenti = readFileSync(resolve(klon, "cli-argumenti.txt"), "utf8").trim();
ok(argumenti === "whoami", `puller zove 'whoami', ne '${argumenti}'`);

const pull = await praviFetch(`${BASE}/pull`, { headers: { authorization: "Bearer " + PULL } });
ok((await pull.json()).sesije.length === 0, "sesija obrisana sa Workera");

const mapa2 = JSON.parse(readFileSync(resolve(pikgptDir, "onboarding-sesije.json"), "utf8"));
ok(!mapa2[id], "sesija uklonjena iz lokalne mape");

server.close();
if (palo) { console.error(`\n${palo} provjera palo`); process.exit(1); }
console.log("\nSve Mac provjere prosle.");
