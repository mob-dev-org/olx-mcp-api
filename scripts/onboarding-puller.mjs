#!/usr/bin/env bun
// Povlaci gotove onboarding sesije sa Workera, desifruje token i sprema ga u pravi klon.
//
// Zasto pull, a ne push: ka ovoj masini nema ulazne HTTP tacke (sav Telegram promet je izlazni,
// zivoj sesiji se komanda ne moze ubaciti). Zato masina sama povlaci. Zakazivanje je vanjsko
// (launchd), kao snapshot i dnevni posao; ova skripta radi jedan prolaz i izadje.
//
// Po sesiji: desifruj token -> upisi OLX_TOKEN u .env klona -> `whoami` provjera ->
// pokreni onboarding analizu (ako postoji) -> javi klijentu i adminu -> obrisi sesiju.
//
// Token se NIKAD ne ispisuje. Pokretanje:
//   bun scripts/onboarding-puller.mjs [--bez-analize]

import { existsSync, copyFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { trebaConfig, privatniKljuc, citajMapu, upisiMapu } from "./lib/podesavanja.mjs";
import { procitajEnv, postaviKljuc } from "./lib/envfajl.mjs";
import { desifruj } from "./lib/ecies.mjs";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BEZ_ANALIZE = process.argv.includes("--bez-analize");
const MAX_POKUSAJA = 5;

const cfg = trebaConfig();
const priv = privatniKljuc();
const mapa = citajMapu();

// Telegram je best-effort: bez builda se samo preskoci slanje, token se svejedno upise.
let posaljiPoruku = null;
try {
  ({ posaljiPoruku } = await import(resolve(KORIJEN, "dist/core/telegram.js")));
} catch {
  console.error("Napomena: dist/core/telegram.js nije dostupan, preskacem Telegram javljanja.");
}

async function javi(klonEnv, kome, tekst) {
  if (!posaljiPoruku) return;
  const chatId = kome === "admin" ? klonEnv.TELEGRAM_ADMIN_CHAT_ID : klonEnv.TELEGRAM_CHAT_ID;
  if (!klonEnv.TELEGRAM_BOT_TOKEN || !chatId) return;
  try {
    await posaljiPoruku(tekst, { botToken: klonEnv.TELEGRAM_BOT_TOKEN, chatId: String(chatId) });
  } catch (e) {
    console.error(`Telegram javljanje palo (${kome}):`, e instanceof Error ? e.message : e);
  }
}

async function obrisiSesiju(id) {
  try {
    await fetch(`${cfg.workerBase}/admin/session/${id}`, {
      method: "DELETE",
      headers: { authorization: "Bearer " + cfg.pullSecret },
    });
  } catch (e) {
    console.error(`Brisanje sesije ${id} palo:`, e instanceof Error ? e.message : e);
  }
  delete mapa[id];
  upisiMapu(mapa);
}

// ---- povuci ----

let odgovor;
try {
  const r = await fetch(`${cfg.workerBase}/pull`, {
    headers: { authorization: "Bearer " + cfg.pullSecret },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  odgovor = await r.json();
} catch (e) {
  console.error("Ne mogu povuci sa Workera:", e instanceof Error ? e.message : e);
  process.exit(1);
}

const sesije = odgovor.sesije || [];
if (!sesije.length) {
  console.log("Nema spremnih sesija.");
  process.exit(0);
}

let obradjeno = 0;

for (const s of sesije) {
  const veza = mapa[s.id];
  if (!veza || !veza.klon) {
    console.error(`Sesija ${s.id} nema poznat klon u mapi, preskacem (mozda druga masina).`);
    continue;
  }
  const klon = veza.klon;
  if (!existsSync(klon)) {
    console.error(`Klon ne postoji: ${klon} (sesija ${s.id}), preskacem.`);
    continue;
  }

  // 1. desifruj (token ostaje u promjenljivoj, nikad u log)
  let token;
  try {
    token = await desifruj(s.blob, priv);
  } catch (e) {
    console.error(`Desifrovanje sesije ${s.id} palo:`, e instanceof Error ? e.message : e);
    continue;
  }

  // 2. .env: napravi iz .env.example ako fali
  const envPut = resolve(klon, ".env");
  if (!existsSync(envPut)) {
    const primjer = resolve(klon, ".env.example");
    if (existsSync(primjer)) copyFileSync(primjer, envPut);
    else writeFileSync(envPut, "");
  }
  postaviKljuc(envPut, "OLX_TOKEN", token);

  const klonEnv = procitajEnv(envPut);

  // 3. provjera pristupa (CLI ucita .env klona sam)
  // `whoami` je komanda na vrhu, NE podkomanda `auth`. Sa "auth whoami" je commander vracao
  // "unknown command" i provjera je padala na SVAKOM klonu, uvijek (nadjeno uzivo 31.07.2026).
  const who = spawnSync(process.execPath, ["dist/cli/index.js", "whoami"], {
    cwd: klon,
    encoding: "utf8",
    timeout: 30000,
  });
  if (who.status !== 0) {
    const p = (veza.pokusaji || 0) + 1;
    veza.pokusaji = p;
    upisiMapu(mapa);
    console.error(`whoami pao za ${klon} (sesija ${s.id}), pokusaj ${p}/${MAX_POKUSAJA}.`);
    if (p === 1 || p >= MAX_POKUSAJA) {
      await javi(klonEnv, "admin", `Onboarding: token za ${klon} nije prosao whoami (pokusaj ${p}).`);
    }
    if (p >= MAX_POKUSAJA) await obrisiSesiju(s.id);
    continue;
  }

  // 4. analiza (elegantno preskoci ako wrapper jos ne postoji, Faza 3)
  const analiza = resolve(KORIJEN, "scripts/onboarding-analiza.sh");
  if (!BEZ_ANALIZE && existsSync(analiza)) {
    console.log(`Pokrecem analizu za ${klon}...`);
    const a = spawnSync("bash", [analiza, klon], { stdio: "inherit", timeout: 20 * 60 * 1000 });
    if (a.status !== 0) {
      await javi(klonEnv, "admin", `Onboarding: token za ${klon} upisan, ali analiza nije prosla. Pokreni rucno.`);
    }
  } else if (!BEZ_ANALIZE) {
    console.error("Wrapper scripts/onboarding-analiza.sh jos ne postoji, preskacem analizu.");
  }

  // 4b. ako sesija tog klona VEC radi, zatrazi joj restart.
  //
  // Zasto: `.env` se cita jednom, pri startu procesa (cuvar-sesije.mjs i MCP server). Sesija koja
  // je krenula prije ovog upisa nema nov token i radila bi bez njega do nocnog restarta u 03:00.
  // Fajl a ne signal, jer cuvar radi i na Windowsu gdje Node ne dostavlja SIGHUP.
  // Kad cuvar ne radi (novi klon, sesija se jos nije ni pokrenula), nema sta da se restartuje.
  // Most (scripts/telegram-most.mjs) preuzima isti posao za klijentske botove pa nosi isti
  // marker kao cuvar sesije; upis oba markera kad oboje postoje (rijedak prelazni slucaj) je
  // bezopasan jer je sadrzaj isti.
  for (const [pid, marker] of [
    ["cuvar-sesije.pid", "restart-sesije"],
    ["cuvar-admin-bota.pid", "restart-admin-bota"],
    ["most.pid", "restart-sesije"],
  ]) {
    if (!existsSync(resolve(klon, ".olx-pik", pid))) continue;
    try {
      writeFileSync(resolve(klon, ".olx-pik", marker), "nov OLX token iz onboardinga\n", "utf8");
      console.error(`Sesija ${klon} radi, zatrazen joj je restart da preuzme nov token.`);
    } catch (e) {
      console.error(`Ne mogu zatraziti restart sesije (${String(e)}). Restartuj je rucno.`);
    }
  }

  // 5. javi klijentu i adminu
  const naziv = s.nalog?.username ? ` (${s.nalog.username})` : "";
  await javi(klonEnv, "klijent", "PikGPT je povezan sa vasim OLX shopom. Sve je spremno, mozete pisati kad god zelite.");
  await javi(klonEnv, "admin", `Onboarding gotov: ${klon}${naziv}. Token upisan, whoami prosao. Pregledaj i dopuni KLIJENT.md (komercijalni dio).`);

  // 6. obrisi sesiju (jednokratno)
  await obrisiSesiju(s.id);
  obradjeno++;
  console.log(`Sesija ${s.id} obradjena za ${klon}.`);
}

console.log(`Gotovo. Obradjeno: ${obradjeno}/${sesije.length}.`);
