// Lokalni destilator izmedju AI-ja i PIK API-ja: pretvara sirovi katalog shopa
// (~6000 tokena po stranici) u kompaktan sazetak (~120 tokena) za klasifikaciju
// vozila/dijelova. Samo citanje, nikad ne mijenja stanje na PIK-u.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "cache");
fs.mkdirSync(CACHE_DIR, { recursive: true });

const BASE_URL = (process.env.OLX_BASE_URL || "https://api.olx.ba").replace(/\/+$/, "");
const TOKEN = process.env.OLX_TOKEN;
const PORT = Number(process.env.DESTILATOR_PORT || 4001);

if (!TOKEN) {
  console.error("OLX_TOKEN nije postavljen. Stani i pitaj korisnika prije nastavka.");
  process.exit(1);
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 500; // 2 zahtjeva u sekundi prema PIK API-ju
const RETRY_DELAYS_MS = [1000, 4000, 10000];

// --- Globalni rate limiter: svi pozivi prema PIK-u prolaze kroz jedan red, ---
// --- bez obzira dolaze li iz GET /shop ili POST /shops.                    ---
let queueTail = Promise.resolve();
let lastCallAt = 0;

function throttledCall(fn) {
  const run = async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return fn();
  };
  const result = queueTail.then(run, run);
  queueTail = result.catch(() => {});
  return result;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pikGet(pathAndQuery) {
  return throttledCall(async () => {
    let lastErr;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await fetch(BASE_URL + pathAndQuery, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        });
        if (res.ok) return res.json();
        if ((res.status === 429 || res.status >= 500) && attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new Error(`PIK API ${res.status} na ${pathAndQuery}`);
      } catch (err) {
        lastErr = err;
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
      }
    }
    throw lastErr ?? new Error(`PIK API poziv neuspjesan: ${pathAndQuery}`);
  });
}

// --- Kes na disku, po username-u i po kombinaciji opcija. ---
function cacheKey(username, opts) {
  const suffix = [opts.deep ? "deep" : null, opts.podnaslovi ? "podnaslovi" : null]
    .filter(Boolean)
    .join("_");
  const safe = username.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return path.join(CACHE_DIR, suffix ? `${safe}__${suffix}.json` : `${safe}.json`);
}

function readCache(file) {
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(fs.readFileSync(file, "utf8")).podaci;
  } catch {
    return null;
  }
}

function writeCache(file, podaci) {
  fs.writeFileSync(file, JSON.stringify({ ts: new Date().toISOString(), podaci }));
}

// --- Cisti naslov za materijal za rasudjivanje: bez hashtagova, bez ---
// --- ponovljenih promo rijeci, skraceno na 60 znakova. ---
const PROMO_RIJECI = /\b(pik\s*shop|olx\s*shop|pik\.ba|olx\.ba)\b/gi;

function ocistiNaslov(t) {
  return (t || "")
    .replace(/#\S+/g, "")
    .replace(PROMO_RIJECI, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function ravnomjerniIndeksi(n, koliko) {
  if (n <= 0) return [];
  if (n <= koliko) return Array.from({ length: n }, (_, i) => i);
  const korak = (n - 1) / (koliko - 1);
  const set = new Set();
  for (let i = 0; i < koliko; i++) set.add(Math.round(i * korak));
  return [...set].sort((a, b) => a - b);
}

async function dohvatiStranicu(username, page) {
  const d = await pikGet(`/users/${encodeURIComponent(username)}/listings?page=${page}`);
  return { items: d.data ?? [], meta: d.meta ?? {} };
}

async function izgradiSazetak(username, { deep, podnaslovi }) {
  const profil = await pikGet(`/users/${encodeURIComponent(username)}`).catch(() => null);
  if (!profil || !profil.data) {
    return { username, greska: "profil nije nadjen" };
  }
  const d = profil.data;
  const shop = d.shop ?? {};

  const prva = await dohvatiStranicu(username, 1);
  let sviOglasi = prva.items;
  const total = prva.meta.total ?? sviOglasi.length;
  const lastPage = prva.meta.last_page ?? 1;

  if (deep && lastPage > 1) {
    const srednja = Math.max(1, Math.min(lastPage, Math.ceil(lastPage / 2)));
    const stranice = [...new Set([srednja, lastPage])].filter((p) => p !== 1);
    for (const p of stranice) {
      const s = await dohvatiStranicu(username, p);
      sviOglasi = sviOglasi.concat(s.items);
    }
  }

  const kategorije = {};
  for (const o of sviOglasi) {
    const key = String(o.top_category_id ?? "nepoznato");
    kategorije[key] = (kategorije[key] ?? 0) + 1;
  }
  const uzorakSize = sviOglasi.length;
  const vozilaCount = kategorije["1"] ?? 0;
  const udioVozila = uzorakSize > 0 ? Number((vozilaCount / uzorakSize).toFixed(4)) : 0;

  const indeksi = ravnomjerniIndeksi(sviOglasi.length, 7);
  const izabrani = indeksi.map((i) => sviOglasi[i]).filter(Boolean);
  const naslovi = izabrani.map((o) => ocistiNaslov(o.title));

  const rezultat = {
    username,
    naziv: shop.business_name || d.username,
    paket: shop.package || null,
    grad: d.location?.name ?? null,
    shop_category_id: shop.category_id ?? null,
    ukupno: total,
    uzorak: uzorakSize,
    kategorije,
    udio_vozila: udioVozila,
    naslovi,
  };

  if (podnaslovi) {
    const podn = [];
    for (const o of izabrani) {
      try {
        const detalj = await pikGet(`/listings/${o.id}`);
        podn.push(detalj?.data?.short_description ?? null);
      } catch {
        podn.push(null);
      }
    }
    rezultat.podnaslovi = podn;
  }

  return rezultat;
}

async function dohvatiShop(username, opts) {
  const file = cacheKey(username, opts);
  const kes = readCache(file);
  if (kes) return kes;
  const rezultat = await izgradiSazetak(username, opts);
  writeCache(file, rezultat);
  return rezultat;
}

function parseBool(v) {
  return v === "true" || v === "1";
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (req.method === "GET" && url.pathname.startsWith("/shop/")) {
      const username = decodeURIComponent(url.pathname.slice("/shop/".length));
      const opts = {
        deep: url.searchParams.get("uzorak") === "deep",
        podnaslovi: parseBool(url.searchParams.get("podnaslovi")),
      };
      const rezultat = await dohvatiShop(username, opts);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(rezultat));
      return;
    }

    if (req.method === "POST" && url.pathname === "/shops") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      const usernames = Array.isArray(body.usernames) ? body.usernames : [];
      const opts = {
        deep: url.searchParams.get("uzorak") === "deep",
        podnaslovi: parseBool(url.searchParams.get("podnaslovi")),
      };
      // Red je vec globalno throttlovan u pikGet, pa je paralelno pokretanje ovdje
      // samo pogodnost za pozivaoca - PIK i dalje vidi najvise 2 zahtjeva/s.
      const rezultati = await Promise.all(usernames.map((u) => dohvatiShop(u, opts)));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(rezultati));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "nepoznata ruta" }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});

server.listen(PORT, () => {
  console.log(`destilator sluša na http://localhost:${PORT}`);
});
