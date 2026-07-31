// Lokalni test Workera bez wranglera. Mocka KV (Map), stubuje fetch ka OLX-u, i vozi cijeli tok:
// registracija sesije, forma, pogresni pa tacni kredencijali, /pull, desifrovanje, brisanje.
//
// Pokretanje: node cloudflare/onboarding/test-worker.mjs

import worker from "./worker.js";
import { napraviPar, desifruj } from "../../scripts/lib/ecies.mjs";

let palo = 0;
function ok(uslov, opis) {
  if (uslov) console.log("  ok:", opis);
  else {
    palo++;
    console.error("  PAO:", opis);
  }
}

// ---- mock KV ----
function mockKV() {
  const m = new Map();
  return {
    async get(k) {
      return m.has(k) ? m.get(k) : null;
    },
    async put(k, v) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
    async list({ prefix = "", cursor } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
    _dump: m,
  };
}

const par = await napraviPar();
const env = {
  SESIJE: mockKV(),
  ADMIN_PUB: par.javniB64,
  // Najmanje 24 znaka, jer adminOk krace tajne odbija (fail-open brana u worker.js).
  PULL_SECRET: "tajna-za-test-dovoljno-dugacka",
  OLX_API: "https://api.olx.ba",
  TTL_PENDING: "1800",
  TTL_READY: "3600",
  MAX_POKUSAJA: "3",
};

const PRAVI_TOKEN = "olx-bearer-" + "z".repeat(120);

// ---- stub globalnog fetch: samo OLX rute ----
globalThis.fetch = async (url, opcije = {}) => {
  const u = String(url);
  if (u.endsWith("/auth/login")) {
    const telo = JSON.parse(opcije.body || "{}");
    if (telo.username === "MixBox" && telo.password === "tacna") {
      return new Response(
        JSON.stringify({ token: PRAVI_TOKEN, user: { username: "MixBox", city: "Sarajevo", package: "Zlatni" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: { status: 422 } }), { status: 422 });
  }
  if (u.endsWith("/me")) {
    const auth = opcije.headers?.authorization || "";
    if (auth === "Bearer " + PRAVI_TOKEN) {
      return new Response(JSON.stringify({ data: { username: "MixBox", city: "Sarajevo" } }), { status: 200 });
    }
    return new Response("no", { status: 401 });
  }
  throw new Error("neocekivan fetch u testu: " + u);
};

const BASE = "https://onb.example";
const bearer = { authorization: "Bearer " + env.PULL_SECRET };
const SES = "sesija_test_" + "a".repeat(12); // 24 znaka, prolazi regex

async function poziv(method, put, { headers = {}, body } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!init.headers["content-type"]) init.headers["content-type"] = "application/json";
  }
  return worker.fetch(new Request(BASE + put, init), env);
}

console.log("1. admin registruje sesiju");
{
  const bezAuth = await poziv("POST", "/admin/session", { body: { id: SES } });
  ok(bezAuth.status === 401, "bez bearera vraca 401");
  const r = await poziv("POST", "/admin/session", { headers: bearer, body: { id: SES } });
  ok(r.status === 200, "sa bearerom vraca 200");
}

console.log("2. forma");
{
  const r = await poziv("GET", "/o/" + SES);
  const html = await r.text();
  ok(r.status === 200 && html.includes("PikGPT"), "forma se prikaze");
  ok(!html.includes("OLX login") && html.includes("NIJE OLX"), "forma se ne pretvara da je OLX");
  const nema = await poziv("GET", "/o/" + "x".repeat(20));
  ok(nema.status === 404, "nepostojeca sesija vraca 404");
}

console.log("3. pogresni kredencijali i brojac pokusaja");
{
  for (let i = 0; i < 3; i++) {
    const r = await poziv("POST", "/o/" + SES + "/login", {
      headers: { accept: "application/json" },
      body: { mode: "kredencijali", username: "MixBox", password: "netacna" },
    });
    ok(r.status === 400, `pokusaj ${i + 1} odbijen`);
  }
  const r = await poziv("POST", "/o/" + SES + "/login", {
    headers: { accept: "application/json" },
    body: { mode: "kredencijali", username: "MixBox", password: "tacna" },
  });
  const j = await r.json();
  ok(!j.ok && /Previse/.test(j.poruka), "nakon MAX_POKUSAJA i tacna lozinka je blokirana");
}

console.log("4. nova sesija, tacni kredencijali, pa desifrovanje");
{
  const SES2 = "sesija_dobra_" + "b".repeat(12);
  await poziv("POST", "/admin/session", { headers: bearer, body: { id: SES2 } });
  const r = await poziv("POST", "/o/" + SES2 + "/login", {
    headers: { accept: "application/json" },
    body: { mode: "kredencijali", username: "MixBox", password: "tacna" },
  });
  const j = await r.json();
  ok(j.ok === true, "tacni kredencijali daju ok");
  ok(j.nalog?.username === "MixBox" && j.nalog?.grad === "Sarajevo", "javni nalog izvucen");
  ok(j.nalog?.paket === "Zlatni", "paket izvucen");

  const pull = await poziv("GET", "/pull", { headers: bearer });
  const pj = await pull.json();
  const nadjena = pj.sesije.find((s) => s.id === SES2);
  ok(!!nadjena && !!nadjena.blob, "/pull vraca spremnu sesiju sa blobom");
  const token = await desifruj(nadjena.blob, par.privatniB64);
  ok(token === PRAVI_TOKEN, "desifrovani token se poklapa sa originalom");
  ok(!nadjena.blob.includes("tacna"), "sifrat ne sadrzi lozinku u citljivom obliku");

  // provjera da KV nigdje ne drzi lozinku ni sirovi token
  const svKV = [...env.SESIJE._dump.values()].join("|");
  ok(!svKV.includes("tacna"), "KV ne sadrzi lozinku");
  ok(!svKV.includes(PRAVI_TOKEN), "KV ne sadrzi sirovi token");

  const del = await poziv("DELETE", "/admin/session/" + SES2, { headers: bearer });
  ok(del.status === 200, "brisanje sesije prolazi");
  const pull2 = await poziv("GET", "/pull", { headers: bearer });
  const pj2 = await pull2.json();
  ok(!pj2.sesije.find((s) => s.id === SES2), "obrisana sesija vise nije u /pull");
}

console.log("5. token mod");
{
  const SES3 = "sesija_token_" + "c".repeat(12);
  await poziv("POST", "/admin/session", { headers: bearer, body: { id: SES3 } });
  const r = await poziv("POST", "/o/" + SES3 + "/login", {
    headers: { accept: "application/json" },
    body: { mode: "token", token: PRAVI_TOKEN },
  });
  const j = await r.json();
  ok(j.ok === true, "validan token prihvacen kroz /me");
  const lose = await poziv("POST", "/admin/session", { headers: bearer, body: { id: "s" + "d".repeat(20) } });
  ok(lose.status === 200, "priprema za lose token");
  const r2 = await poziv("POST", "/o/" + "s" + "d".repeat(20) + "/login", {
    headers: { accept: "application/json" },
    body: { mode: "token", token: "pogresan" },
  });
  const j2 = await r2.json();
  ok(!j2.ok, "nevalidan token odbijen");
}

console.log("6. admin rute kad tajna nije postavljena");
{
  // Fail-open koji je postojao: prazna tajna i prazan header su iste duzine, pa je poredjenje
  // vracalo true i /admin/session i /pull su stajali otvoreni na javnom URL-u. Scenario nije
  // izmisljen: `wrangler deploy` prodje i bez `wrangler secret put`, i nista ne javi.
  const bezTajne = { ...env, PULL_SECRET: undefined };
  const kratka = { ...env, PULL_SECRET: "prekratka" };

  for (const [ime, e] of [["bez tajne", bezTajne], ["prekratka tajna", kratka]]) {
    const r1 = await worker.fetch(new Request(BASE + "/pull"), e);
    ok(r1.status === 401, `${ime}: /pull odbijen i bez ijednog headera`);

    const r2 = await worker.fetch(
      new Request(BASE + "/pull", { headers: { authorization: "Bearer " } }),
      e,
    );
    ok(r2.status === 401, `${ime}: /pull odbijen i na prazan bearer`);

    const r3 = await worker.fetch(
      new Request(BASE + "/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "sesija_napad_" + "b".repeat(12) }),
      }),
      e,
    );
    ok(r3.status === 401, `${ime}: /admin/session odbijen, Worker nije login oracle`);
  }
}

if (palo) {
  console.error(`\n${palo} provjera palo`);
  process.exit(1);
}
console.log("\nSve provjere prosle.");
