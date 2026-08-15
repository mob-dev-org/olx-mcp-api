// Zajednicka podesavanja admin masine za web onboarding. Cita ih onboarding-link.mjs i
// onboarding-puller.mjs. Sve zivi u ~/.pikgpt/ (van git stabla), ili se gazi env varijablama.
//
// Fajlovi:
//   ~/.pikgpt/config.json           { "workerBase": "...", "pullSecret": "..." }
//   ~/.pikgpt/onboarding-priv.b64   privatni kljuc (0600), pravi ga onboarding-kljuc.mjs
//   ~/.pikgpt/onboarding-sesije.json mapa session -> { klon, created }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";

export const BAZA = process.env.PIKGPT_DIR || resolve(homedir(), ".pikgpt");
const CONFIG = resolve(BAZA, "config.json");
const MAPA = resolve(BAZA, "onboarding-sesije.json");
const PRIV = process.env.PIKGPT_ONBOARDING_KEY || resolve(BAZA, "onboarding-priv.b64");

function citajJson(putanja, podrazumijevano) {
  if (!existsSync(putanja)) return podrazumijevano;
  try {
    return JSON.parse(readFileSync(putanja, "utf8"));
  } catch {
    return podrazumijevano;
  }
}

export function config() {
  const c = citajJson(CONFIG, {});
  const workerBase = (process.env.PIKGPT_WORKER_BASE || c.workerBase || "").replace(/\/+$/, "");
  const pullSecret = process.env.PIKGPT_PULL_SECRET || c.pullSecret || "";
  return { workerBase, pullSecret };
}

export function trebaConfig() {
  const c = config();
  const fali = [];
  if (!c.workerBase) fali.push("workerBase (ili PIKGPT_WORKER_BASE)");
  if (!c.pullSecret) fali.push("pullSecret (ili PIKGPT_PULL_SECRET)");
  if (fali.length) {
    throw new Error(
      `Fali podesavanje: ${fali.join(", ")}. Popuni ${CONFIG} ili postavi env varijable.`,
    );
  }
  return c;
}

export function privatniKljuc() {
  if (!existsSync(PRIV)) {
    throw new Error(`Nema privatnog kljuca: ${PRIV}. Napravi ga: bun scripts/onboarding-kljuc.mjs`);
  }
  return readFileSync(PRIV, "utf8").trim();
}

export function citajMapu() {
  return citajJson(MAPA, {});
}

export function upisiMapu(mapa) {
  mkdirSync(dirname(MAPA), { recursive: true });
  writeFileSync(MAPA, JSON.stringify(mapa, null, 2) + "\n");
}
