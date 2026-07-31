#!/usr/bin/env node
// Pravi admin par kljuceva za web onboarding (ECDH P-256, vidi scripts/lib/ecies.mjs).
//
// Privatni kljuc je JEDINO sto moze desifrovati token koji stigne sa Cloudflarea. Zato:
//   - ostaje na ovoj masini, u fajlu sa dozvolom 0600, VAN git stabla (default ~/.pikgpt/),
//   - nikad se ne ispisuje ni kopira,
//   - njegov gubitak znaci ponovni onboarding svih klijenata (token se vise ne moze procitati).
//
// Javni kljuc se ugradjuje u Worker kao varijabla ADMIN_PUB. On je javan po prirodi, pa se
// slobodno ispisuje i kopira u clipboard.
//
// Pokretanje:
//   node scripts/onboarding-kljuc.mjs            # napravi par ako ne postoji, ispisi javni
//   node scripts/onboarding-kljuc.mjs --force    # prepisi postojeci privatni (OPREZ)
//   node scripts/onboarding-kljuc.mjs --show      # samo ponovo ispisi javni iz postojeceg para
//
// Putanja privatnog fajla: PIKGPT_ONBOARDING_KEY (default ~/.pikgpt/onboarding-priv.b64).

import { writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { napraviPar, sifruj, desifruj } from "./lib/ecies.mjs";

const KLJUC_FAJL = process.env.PIKGPT_ONBOARDING_KEY || resolve(homedir(), ".pikgpt/onboarding-priv.b64");
const JAVNI_FAJL = KLJUC_FAJL.replace(/priv\.b64$/, "pub.b64");
const arg = process.argv.slice(2);
const FORCE = arg.includes("--force");
const SHOW = arg.includes("--show");

function uClipboard(tekst) {
  const r = spawnSync("pbcopy", { input: tekst });
  return r.status === 0;
}

if (SHOW) {
  if (!existsSync(JAVNI_FAJL)) {
    console.error(`Nema javnog kljuca u ${JAVNI_FAJL}. Pokreni bez --show da napravis par.`);
    process.exit(1);
  }
  const javni = readFileSync(JAVNI_FAJL, "utf8").trim();
  console.log(javni);
  if (uClipboard(javni)) console.error("Javni kljuc kopiran u clipboard.");
  process.exit(0);
}

if (existsSync(KLJUC_FAJL) && !FORCE) {
  console.error(`Privatni kljuc vec postoji: ${KLJUC_FAJL}`);
  console.error("Za ponovni ispis javnog: --show. Za prepis (gubi stari): --force.");
  process.exit(1);
}

const par = await napraviPar();

// Provjeri da par radi prije nego ista upisemo: sifruj pa desifruj probni tekst.
const proba = await sifruj("proba", par.javniB64);
if ((await desifruj(proba, par.privatniB64)) !== "proba") {
  console.error("PAO: novi par ne prolazi roundtrip, nista nije upisano.");
  process.exit(1);
}

mkdirSync(dirname(KLJUC_FAJL), { recursive: true });
writeFileSync(KLJUC_FAJL, par.privatniB64 + "\n", { mode: 0o600 });
chmodSync(KLJUC_FAJL, 0o600);
writeFileSync(JAVNI_FAJL, par.javniB64 + "\n", { mode: 0o644 });

console.error(`Privatni kljuc upisan: ${KLJUC_FAJL} (0600)`);
console.error(`Javni kljuc upisan:   ${JAVNI_FAJL}`);
console.error("");
console.error("Javni kljuc (ADMIN_PUB) je ispod i kopiran u clipboard.");
console.error("Zalijepi ga u Worker: cd cloudflare/onboarding && npx wrangler secret put ADMIN_PUB");
console.error("(ili kao [vars] ADMIN_PUB u wrangler.toml; javni kljuc smije biti u varijablama)");
console.error("");
console.log(par.javniB64);
uClipboard(par.javniB64);
