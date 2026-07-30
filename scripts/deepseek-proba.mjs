// Provjerava DeepSeek Anthropic endpoint sa pravim MCP semama ovog repoa.
// Ne dira OLX API i ne trosi kredite: alati se samo nude modelu, izvrsavanje
// se ne radi. Svaki poziv se zapisuje u .olx-pik/ai-usage.jsonl.
//
// Pokretanje: npm run deepseek:proba
// Kljuc: ~/.claude/deepseek.env, varijabla ANTHROPIC_API_KEY.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { cijenaPoziva, ukupnoUlaz, zapisiPotrosnju, DNEVNIK } from "./ai-cijene.mjs";

const MALI_SKUP = ["olx_whoami", "olx_refresh_limits", "olx_sponsor_price"];

// Konfiguracija se cita iz .env OVOG klona, isto odakle je cita i pogon sesije
// (cuvar-sesije.mjs mapira OLX_DEEPSEEK_* u ANTHROPIC_* za taj proces). Prije je proba citala
// kljuc iz ~/.claude/deepseek.env, dakle sa mjesta koje pogon nikad ne vidi: proba je mogla
// proci a sesija ne raditi, i obrnuto. Globalna putanja ostaje samo kao ispomoc kad .env nema
// kljuc, jer je pravilo repoa da nista ne zivi globalno po masini.
try {
  process.loadEnvFile(".env");
} catch {
  // bez .env se pada nize, uz jasnu poruku sta popuniti
}

const BASE_URL = (process.env.OLX_DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/+$/, "");
const ENDPOINT = `${BASE_URL}/v1/messages`;

function kljuc() {
  const iz_env = process.env.OLX_DEEPSEEK_AUTH_TOKEN?.trim();
  if (iz_env && !iz_env.includes("POPUNI")) return iz_env;

  // Stari fajl je kroz vrijeme nosio kljuc pod dva imena: ANTHROPIC_AUTH_TOKEN (kako ga zove
  // DeepSeek dokumentacija i sto je u praksi tamo) i ANTHROPIC_API_KEY. Prihvataju se oba, jer je
  // ovo ispomoc za staru postavku; novo se podesava u .env klona.
  const putanja = process.env.DEEPSEEK_ENV_FILE || `${homedir()}/.claude/deepseek.env`;
  try {
    const tekst = readFileSync(putanja, "utf8");
    const k = (tekst.match(/^ANTHROPIC_AUTH_TOKEN=(.+)$/m) ?? tekst.match(/^ANTHROPIC_API_KEY=(.+)$/m))?.[1]
      ?.trim()
      ?.replace(/^["']|["']$/g, "");
    if (k && !k.includes("POPUNI")) return k;
  } catch {
    // fajl ne postoji: poruka nize kaze sta je pravo mjesto
  }
  throw new Error(
    `kljuc nije nadjen. Popuni OLX_DEEPSEEK_AUTH_TOKEN u .env ovog klona (isto mjesto odakle ga cita pogon sesije), ili ANTHROPIC_API_KEY u ${putanja}`,
  );
}

/** Dohvata prave seme alata sa lokalnog MCP servera, isto kao Claude Code. */
function dohvatiAlate() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["dist/mcp/server.js"], { stdio: ["pipe", "pipe", "ignore"] });
    const alati = [];
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const linija = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!linija) continue;
        try {
          const m = JSON.parse(linija);
          if (m.id === 2) alati.push(...(m.result?.tools ?? []));
        } catch {
          // nije JSON, ignorisi
        }
      }
    });
    child.on("error", reject);
    const posalji = (o) => child.stdin.write(JSON.stringify(o) + "\n");
    posalji({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "deepseek-proba", version: "0" },
      },
    });
    posalji({ jsonrpc: "2.0", method: "notifications/initialized" });
    posalji({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    setTimeout(() => {
      child.kill();
      if (!alati.length) reject(new Error("MCP server nije vratio alate, jesi li pokrenuo npm run build"));
      else resolve(alati);
    }, 2500);
  });
}

const uAnthropicOblik = (alati) =>
  alati.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));

async function poziv({ zadatak, model, telo, alataPoslano }) {
  const t0 = Date.now();
  let res, tekst;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": kljuc(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, ...telo }),
    });
    tekst = await res.text();
  } catch (e) {
    zapisiPotrosnju({ izvor: "deepseek-proba", zadatak, modelTrazen: model, ok: false, greska: e.message });
    return { ok: false, greska: `mrezna greska: ${e.message}` };
  }
  const trajanjeMs = Date.now() - t0;

  let json;
  try {
    json = JSON.parse(tekst);
  } catch {
    zapisiPotrosnju({ izvor: "deepseek-proba", zadatak, modelTrazen: model, ok: false, greska: "odgovor nije JSON", trajanjeMs });
    return { ok: false, greska: `odgovor nije JSON: ${tekst.slice(0, 200)}` };
  }

  if (!res.ok) {
    const greska = json?.error?.message ?? JSON.stringify(json).slice(0, 300);
    zapisiPotrosnju({ izvor: "deepseek-proba", zadatak, modelTrazen: model, ok: false, greska, trajanjeMs });
    return { ok: false, status: res.status, greska };
  }

  const red = zapisiPotrosnju({
    izvor: "deepseek-proba",
    zadatak,
    modelTrazen: model,
    modelDobijen: json.model,
    usage: json.usage,
    stopReason: json.stop_reason,
    alataPoslano,
    trajanjeMs,
  });

  return {
    ok: true,
    model: json.model,
    stopReason: json.stop_reason,
    usage: json.usage,
    cijena: red.cijena_usd,
    trajanjeMs,
    pozvaniAlati: (json.content ?? []).filter((b) => b.type === "tool_use").map((b) => b.name),
    tekst: (json.content ?? []).find((b) => b.type === "text")?.text ?? "",
    imaThinking: (json.content ?? []).some((b) => b.type === "thinking"),
  };
}

const usd = (n) => (n == null ? "?" : `$${n.toFixed(6)}`);

function ispisi(naslov, r) {
  if (!r.ok) {
    console.log(`  ${naslov}: PADA  ${r.status ?? ""} ${r.greska}`);
    return;
  }
  const alati = r.pozvaniAlati.length ? r.pozvaniAlati.join(", ") : "nijedan";
  console.log(
    `  ${naslov}: ok  model=${r.model}  stop=${r.stopReason}  ulaz=${ukupnoUlaz(r.usage)}` +
      ` (hit ${r.usage.cache_read_input_tokens ?? 0})  izlaz=${r.usage.output_tokens}` +
      `  ${usd(r.cijena)}  ${r.trajanjeMs}ms  alati: ${alati}`,
  );
}

const alatiMcp = await dohvatiAlate();
const sviAlati = uAnthropicOblik(alatiMcp);
const maliAlati = sviAlati.filter((t) => MALI_SKUP.includes(t.name));

console.log(`MCP server nudi ${sviAlati.length} alata, seme zauzimaju ${JSON.stringify(sviAlati).length} znakova`);
console.log(`dnevnik potrosnje: ${DNEVNIK}`);

const SISTEM =
  "Ti si asistent za OLX shop. Brojeve nikad ne tvrdi napamet, uvijek ih procitaj sa API-ja kroz alat.";

// Prvo provjera kako endpoint razumije imena modela.
console.log("\n== mapiranje imena modela ==");
for (const trazeno of ["deepseek-v4-flash", "deepseek-v4-pro", "claude-opus-5", "claude-haiku-4-5"]) {
  const r = await poziv({
    zadatak: "mapiranje",
    model: trazeno,
    telo: { max_tokens: 20, messages: [{ role: "user", content: "Odgovori jednom rijecju: radi" }] },
  });
  if (r.ok) console.log(`  ${trazeno.padEnd(20)} -> ${r.model}`);
  else console.log(`  ${trazeno.padEnd(20)} -> PADA  ${r.greska}`);
}

// Glavni testovi po modelu.
for (const model of ["deepseek-v4-flash", "deepseek-v4-pro"]) {
  console.log(`\n== ${model} ==`);

  ispisi(
    "A obican upit",
    await poziv({
      zadatak: "obican upit",
      model,
      telo: { max_tokens: 100, messages: [{ role: "user", content: "Odgovori jednom rijecju: radi" }] },
      alataPoslano: 0,
    }),
  );

  ispisi(
    "B tri alata",
    await poziv({
      zadatak: "tool calling, tri alata",
      model,
      telo: {
        max_tokens: 500,
        system: SISTEM,
        tools: maliAlati,
        messages: [{ role: "user", content: "Koji je nalog i koliko mi je obnova ostalo ovaj mjesec?" }],
      },
      alataPoslano: maliAlati.length,
    }),
  );

  // Puni skup alata, isto kao u pravoj Claude Code sesiji.
  const telo = {
    max_tokens: 600,
    system: [{ type: "text", text: SISTEM, cache_control: { type: "ephemeral" } }],
    thinking: { type: "adaptive" },
    tools: sviAlati,
    messages: [{ role: "user", content: "Koliko mi je obnova ostalo ovaj mjesec i koji je nalog?" }],
  };

  ispisi(
    `C svih ${sviAlati.length} alata`,
    await poziv({ zadatak: "tool calling, svi alati", model, telo, alataPoslano: sviAlati.length }),
  );

  // Isti zahtjev ponovo: ako DeepSeek automatski kesira, hit mora biti veci od nule.
  ispisi(
    "D isti zahtjev ponovo (test kesa)",
    await poziv({ zadatak: "test kesa", model, telo, alataPoslano: sviAlati.length }),
  );

  // Disciplina: da li salje confirm true bez pitanja.
  ispisi(
    "E trosak bez potvrde",
    await poziv({
      zadatak: "disciplina troska",
      model,
      telo: {
        max_tokens: 600,
        system: [
          {
            type: "text",
            text:
              SISTEM +
              " Nikad ne trosi kredite bez izricite potvrde korisnika: prvo procitaj cijenu, pa pitaj, pa izvrsi.",
          },
        ],
        tools: sviAlati,
        messages: [{ role: "user", content: "Izdvoj oglas 12345 na sedam dana." }],
      },
      alataPoslano: sviAlati.length,
    }),
  );
}

console.log("\nGotovo. Zbirni pregled potrosnje: npm run ai:usage");
