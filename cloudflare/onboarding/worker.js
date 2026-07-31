// PikGPT web onboarding, Cloudflare Worker.
//
// Sta radi: klijent otvori link koji mu je poslao admin, na PikGPT stranici (NE OLX kopiji)
// unese OLX pristup, Worker uradi login ka api.olx.ba, dobijeni token SIFRUJE javnim kljucem
// admina i ostavi u KV. Admin masina ga kasnije povuce i desifruje svojim privatnim kljucem.
//
// Sigurnosna nacela ugradjena ovdje:
//   - Lozinka se NIKAD ne cuva. Postoji samo u tijelu jednog POST-a i odmah ide OLX-u.
//   - Token nikad ne stoji u citljivom obliku: u KV ide samo ECIES sifrat (vidi ecies.mjs).
//   - Stranica se ne pretvara da je OLX. Jasno je PikGPT / CodeFactory.
//   - Login radi samo za sesiju koju je admin unaprijed registrovao, uz ogranicen broj pokusaja,
//     da se Worker ne moze zloupotrijebiti kao OLX login proba.
//   - Admin rute (/admin/*, /pull) traze bearer tajnu, poredjenu u konstantnom vremenu.
//
// Vezivanja i varijable (wrangler.toml / secrets):
//   KV binding  SESIJE
//   var         ADMIN_PUB    javni kljuc admina (base64, iz onboarding-kljuc.mjs)
//   secret      PULL_SECRET  bearer za /admin/* i /pull
//   var         OLX_API      default https://api.olx.ba
//   var         TTL_PENDING  sekundi, default 1800
//   var         TTL_READY    sekundi, default 3600
//   var         MAX_POKUSAJA default 5

import { sifruj } from "../../scripts/lib/ecies.mjs";

const JSON_H = { "content-type": "application/json; charset=utf-8" };
const HTML_H = { "content-type": "text/html; charset=utf-8" };

export default {
  async fetch(request, env) {
    try {
      return await ruter(request, env);
    } catch (e) {
      // Greska se ne prosipa klijentu, ni u log sa tajnama.
      return new Response(JSON.stringify({ error: "interna_greska" }), { status: 500, headers: JSON_H });
    }
  },
};

async function ruter(request, env) {
  const url = new URL(request.url);
  const put = url.pathname;
  const m = request.method;

  // Klijentske rute
  let mm;
  if (m === "GET" && (mm = put.match(/^\/o\/([A-Za-z0-9_-]{16,64})$/))) {
    return formaSesije(mm[1], env);
  }
  if (m === "POST" && (mm = put.match(/^\/o\/([A-Za-z0-9_-]{16,64})\/login$/))) {
    return obradiLogin(mm[1], request, env);
  }

  // Admin rute (bearer)
  if (m === "POST" && put === "/admin/session") {
    if (!adminOk(request, env)) return zabranjeno();
    return napraviSesiju(request, env);
  }
  if (m === "GET" && put === "/pull") {
    if (!adminOk(request, env)) return zabranjeno();
    return povuciSpremne(env);
  }
  if (m === "DELETE" && (mm = put.match(/^\/admin\/session\/([A-Za-z0-9_-]{16,64})$/))) {
    if (!adminOk(request, env)) return zabranjeno();
    await env.SESIJE.delete("sess:" + mm[1]);
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_H });
  }

  if (m === "GET" && put === "/") {
    return new Response("PikGPT onboarding", { headers: { "content-type": "text/plain" } });
  }
  return new Response(JSON.stringify({ error: "nepoznata_ruta" }), { status: 404, headers: JSON_H });
}

// ---- admin auth ----

// Najkraca tajna koja se prihvata. Nije stvar ukusa: bez donje granice bi neposravljen deploy
// (secret put jos nije pokrenut) otvorio admin rute svijetu, jer se prazno prema praznom poredi
// kao jednako. `wrangler secret put` ne javlja da tajna fali, pa brana mora biti ovdje.
const MIN_TAJNA = 24;

function adminOk(request, env) {
  const tajna = env.PULL_SECRET || "";
  if (tajna.length < MIN_TAJNA) return false;
  const h = request.headers.get("authorization") || "";
  const dat = h.startsWith("Bearer ") ? h.slice(7) : "";
  return konstVrijemeJednako(dat, tajna);
}

function konstVrijemeJednako(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function zabranjeno() {
  return new Response(JSON.stringify({ error: "zabranjeno" }), { status: 401, headers: JSON_H });
}

// ---- sesije ----

async function napraviSesiju(request, env) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    return new Response(JSON.stringify({ error: "los_id" }), { status: 400, headers: JSON_H });
  }
  const zapis = { status: "pending", created: novDatum(), attempts: 0 };
  await env.SESIJE.put("sess:" + id, JSON.stringify(zapis), {
    expirationTtl: broj(env.TTL_PENDING, 1800),
  });
  return new Response(JSON.stringify({ ok: true, id }), { headers: JSON_H });
}

async function ucitajSesiju(id, env) {
  const s = await env.SESIJE.get("sess:" + id);
  return s ? JSON.parse(s) : null;
}

async function povuciSpremne(env) {
  const spremne = [];
  let cursor;
  do {
    const lista = await env.SESIJE.list({ prefix: "sess:", cursor });
    for (const k of lista.keys) {
      const s = await env.SESIJE.get(k.name);
      if (!s) continue;
      const z = JSON.parse(s);
      if (z.status === "ready") {
        spremne.push({ id: k.name.slice("sess:".length), blob: z.blob, nalog: z.nalog });
      }
    }
    cursor = lista.list_complete ? undefined : lista.cursor;
  } while (cursor);
  return new Response(JSON.stringify({ sesije: spremne }), { headers: JSON_H });
}

// ---- forma i login ----

async function formaSesije(id, env) {
  const s = await ucitajSesiju(id, env);
  if (!s) return new Response(stranicaIstekla(), { status: 404, headers: HTML_H });
  if (s.status === "ready") return new Response(stranicaVecPovezano(), { headers: HTML_H });
  return new Response(stranicaForme(id), { headers: HTML_H });
}

async function obradiLogin(id, request, env) {
  const s = await ucitajSesiju(id, env);
  if (!s || s.status !== "pending") {
    return odgovorForme(request, false, "Link je istekao ili je vec iskoristen.", null);
  }
  if ((s.attempts || 0) >= broj(env.MAX_POKUSAJA, 5)) {
    return odgovorForme(request, false, "Previse pokusaja. Zatrazi novi link.", null);
  }

  const p = await procitajTijelo(request);
  const olxApi = (env.OLX_API || "https://api.olx.ba").replace(/\/+$/, "");

  let token = "";
  let user = null;

  if (p.mode === "token") {
    token = String(p.token || "").trim();
    if (!token) return await pogresno(s, id, env, request, "Token je prazan.");
    const me = await fetch(olxApi + "/me", { headers: { authorization: "Bearer " + token, accept: "application/json" } });
    if (!me.ok) return await pogresno(s, id, env, request, "Token nije prihvacen. Provjeri ga i probaj ponovo.");
    user = raspakuj(await me.json().catch(() => ({})));
  } else {
    const username = String(p.username || "").trim();
    const password = String(p.password || "");
    if (!username || !password) return await pogresno(s, id, env, request, "Unesi korisnicko ime i lozinku.");
    const r = await fetch(olxApi + "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ username, password, device_name: "pikgpt_web" }),
    });
    if (!r.ok) {
      // 422/401 = pogresni podaci; ne otkrivamo je li problem ime ili lozinka.
      return await pogresno(s, id, env, request, "Podaci nisu tacni. Provjeri korisnicko ime i lozinku.");
    }
    const j = await r.json().catch(() => ({}));
    token = String((j && j.token) || "");
    user = raspakuj(j.user || j.data || {});
    if (!token) return await pogresno(s, id, env, request, "OLX nije vratio pristup. Probaj ponovo za koji trenutak.");
  }

  // Uspjeh: sifruj token, spremi kao ready. Lozinka se ovdje vec izgubila (nije nigdje spremljena).
  const blob = await sifruj(token, env.ADMIN_PUB);
  const nalog = javniNalog(user);
  await env.SESIJE.put(
    "sess:" + id,
    JSON.stringify({ status: "ready", created: s.created, blob, nalog }),
    { expirationTtl: broj(env.TTL_READY, 3600) },
  );

  return odgovorForme(request, true, "PikGPT je povezan.", nalog);
}

async function pogresno(s, id, env, request, poruka) {
  s.attempts = (s.attempts || 0) + 1;
  await env.SESIJE.put("sess:" + id, JSON.stringify(s), { expirationTtl: broj(env.TTL_PENDING, 1800) });
  return odgovorForme(request, false, poruka, null);
}

async function procitajTijelo(request) {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await request.json().catch(() => ({}));
  const fd = await request.formData().catch(() => null);
  if (!fd) return {};
  return {
    mode: fd.get("mode") || "kredencijali",
    username: fd.get("username") || "",
    password: fd.get("password") || "",
    token: fd.get("token") || "",
  };
}

// Iz OLX odgovora izvuci samo bezbjedan, javni podskup za prikaz i za admina.
function raspakuj(o) {
  return o && typeof o === "object" && o.data && typeof o.data === "object" ? o.data : o || {};
}

function javniNalog(u) {
  u = u || {};
  const uzmi = (...k) => {
    for (const key of k) if (u[key] != null && u[key] !== "") return u[key];
    return undefined;
  };
  return cistiPrazno({
    username: uzmi("username", "user_name", "nickname"),
    ime: uzmi("display_name", "name", "ime", "full_name"),
    grad: uzmi("city", "grad", "location"),
    paket: uzmi("package", "paket", "shop_type", "type"),
  });
}

function cistiPrazno(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v;
  return r;
}

// Odgovor na login: JSON ako je pozvano fetchom (Accept json), inace HTML stranica.
function odgovorForme(request, ok, poruka, nalog) {
  const wantsJson = (request.headers.get("accept") || "").includes("application/json");
  if (wantsJson) {
    return new Response(JSON.stringify({ ok, poruka, nalog }), {
      status: ok ? 200 : 400,
      headers: JSON_H,
    });
  }
  return new Response(ok ? stranicaUspjeh(poruka, nalog) : stranicaGreska(poruka), {
    status: ok ? 200 : 400,
    headers: HTML_H,
  });
}

// ---- pomocno ----

function broj(v, def) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// Date.now je dozvoljen u Workeru (za razliku od workflow skripti).
function novDatum() {
  return new Date().toISOString();
}

// ---- HTML (PikGPT brend, ne OLX) ----

const STIL = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:#0f1220;color:#e7e9f3;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.k{width:100%;max-width:420px;background:#171a2b;border:1px solid #262a45;border-radius:16px;padding:28px}
.brand{font-weight:700;font-size:20px;margin:0 0 4px}
.pod{color:#9aa0c0;font-size:14px;margin:0 0 20px}
label{display:block;font-size:13px;color:#c3c7e0;margin:14px 0 6px}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #2d3252;background:#0f1220;color:#e7e9f3;font-size:16px}
input:focus{outline:none;border-color:#5b6cff}
button{width:100%;margin-top:22px;padding:13px;border:0;border-radius:10px;background:#5b6cff;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
.napomena{margin-top:16px;font-size:12px;color:#8b90b3}
.prebaci{margin-top:14px;text-align:center;font-size:13px}
.prebaci a{color:#8b9bff;cursor:pointer;text-decoration:underline}
.greska{background:#3a1a24;border:1px solid #6b2b3c;color:#ffc9d4;padding:10px 12px;border-radius:10px;font-size:14px;margin-bottom:16px}
.ok{color:#79f2b0;font-weight:600}
.cinj{margin:8px 0 0;padding:0;list-style:none}
.cinj li{padding:6px 0;border-top:1px solid #262a45;color:#c3c7e0}
`;

function ljuska(sadrzaj) {
  return `<!doctype html><html lang="bs"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>PikGPT povezivanje</title><style>${STIL}</style></head>
<body><div class="k">${sadrzaj}</div></body></html>`;
}

function stranicaForme(id) {
  return ljuska(`
<p class="brand">PikGPT</p>
<p class="pod">Povezivanje vaseg OLX naloga. Ovime ovlascujete PikGPT da vodi vas shop.
Ovo NIJE OLX stranica, nego CodeFactory servis.</p>
<div id="greska" class="greska" style="display:none"></div>

<form id="f-kred">
  <label>Korisnicko ime na OLX-u</label>
  <input name="username" autocomplete="username" autocapitalize="none" required>
  <label>Lozinka</label>
  <input name="password" type="password" autocomplete="current-password" required>
  <button type="submit">Povezi shop</button>
</form>

<form id="f-token" style="display:none">
  <label>OLX token</label>
  <input name="token" autocomplete="off" required>
  <button type="submit">Povezi tokenom</button>
</form>

<p class="prebaci"><a id="prebaci">Imam OLX token, ne zelim unositi lozinku</a></p>
<p class="napomena">Lozinku ne pohranjujemo. Koristi se samo jednom da se dobije pristup, pa se odbaci.</p>

<script>
const id=${JSON.stringify(id)};
const fk=document.getElementById('f-kred'),ft=document.getElementById('f-token');
const preb=document.getElementById('prebaci'),gr=document.getElementById('greska');
let tokenMod=false;
preb.onclick=()=>{tokenMod=!tokenMod;fk.style.display=tokenMod?'none':'block';
ft.style.display=tokenMod?'block':'none';preb.textContent=tokenMod?'Radije unesi korisnicko ime i lozinku':'Imam OLX token, ne zelim unositi lozinku';};
async function posalji(e,telo){e.preventDefault();gr.style.display='none';
const b=e.target.querySelector('button');b.disabled=true;b.textContent='Povezujem...';
try{const r=await fetch('/o/'+id+'/login',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(telo)});
const j=await r.json();if(j.ok){document.body.firstElementChild.innerHTML=uspjeh(j);}else{gr.textContent=j.poruka||'Greska.';gr.style.display='block';b.disabled=false;b.textContent=tokenMod?'Povezi tokenom':'Povezi shop';}}
catch(_){gr.textContent='Mreza ne radi. Probaj ponovo.';gr.style.display='block';b.disabled=false;b.textContent='Povezi shop';}}
fk.onsubmit=e=>posalji(e,{mode:'kredencijali',username:fk.username.value,password:fk.password.value});
ft.onsubmit=e=>posalji(e,{mode:'token',token:ft.token.value});
function uspjeh(j){const n=j.nalog||{};const red=[];if(n.username)red.push('Nalog: '+n.username);
if(n.paket)red.push('Paket: '+n.paket);if(n.grad)red.push('Lokacija: '+n.grad);
return '<p class="brand">PikGPT <span class="ok">povezan</span></p><p class="pod">Sve je spremno. Mozete zatvoriti ovu stranicu.</p><ul class="cinj">'+red.map(r=>'<li>'+r+'</li>').join('')+'</ul>';}
</script>`);
}

function stranicaUspjeh(poruka, nalog) {
  const n = nalog || {};
  const red = [];
  if (n.username) red.push("Nalog: " + n.username);
  if (n.paket) red.push("Paket: " + n.paket);
  if (n.grad) red.push("Lokacija: " + n.grad);
  return ljuska(`<p class="brand">PikGPT <span class="ok">povezan</span></p>
<p class="pod">${poruka} Mozete zatvoriti ovu stranicu.</p>
<ul class="cinj">${red.map((r) => "<li>" + r + "</li>").join("")}</ul>`);
}

function stranicaGreska(poruka) {
  return ljuska(`<p class="brand">PikGPT</p><div class="greska">${poruka}</div>
<p class="prebaci"><a href="javascript:history.back()">Nazad</a></p>`);
}

function stranicaIstekla() {
  return ljuska(`<p class="brand">PikGPT</p>
<p class="pod">Ovaj link je istekao ili nije ispravan. Zatrazi novi od CodeFactory.</p>`);
}

function stranicaVecPovezano() {
  return ljuska(`<p class="brand">PikGPT <span class="ok">vec povezan</span></p>
<p class="pod">Ovaj nalog je vec povezan. Mozete zatvoriti stranicu.</p>`);
}
