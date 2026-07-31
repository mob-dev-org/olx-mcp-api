#!/usr/bin/env node
// Napravi onboarding link za JEDAN klon i registruj sesiju na Workeru.
//
// Klon mora vec postojati (redoslijed iz olx-novi-klijent: klon, .env, Telegram runtime, cron,
// pa tek token). Ovaj korak zamjenjuje rucni curl login: klijent umjesto terminala dobije link.
//
// Pokretanje:
//   node scripts/onboarding-link.mjs <putanja-klona>
//
// Ispisuje link i kopira ga u clipboard. Mapiranje session -> klon se pamti u
// ~/.pikgpt/onboarding-sesije.json, odakle ga puller cita.

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { trebaConfig, citajMapu, upisiMapu } from "./lib/podesavanja.mjs";

const arg = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!arg[0]) {
  console.error("Upotreba: node scripts/onboarding-link.mjs <putanja-klona>");
  process.exit(1);
}

const klon = resolve(arg[0]);
if (!existsSync(klon)) {
  console.error(`Klon ne postoji: ${klon}`);
  process.exit(1);
}
if (!existsSync(resolve(klon, ".env")) && !existsSync(resolve(klon, ".env.example"))) {
  console.error(`Upozorenje: ${klon} ne lici na klon (nema .env ni .env.example). Nastavljam svejedno.`);
}

const cfg = trebaConfig();

// session id: base64url, 24 znaka, unutar [A-Za-z0-9_-]{16,64}
const id = randomBytes(18).toString("base64url");

const r = spawnSync(
  "curl",
  [
    "-s", "-o", "/dev/null", "-w", "%{http_code}",
    "-X", "POST", `${cfg.workerBase}/admin/session`,
    "-H", `authorization: Bearer ${cfg.pullSecret}`,
    "-H", "content-type: application/json",
    "-d", JSON.stringify({ id }),
    "--max-time", "20",
  ],
  { encoding: "utf8" },
);
if (r.status !== 0 || r.stdout.trim() !== "200") {
  console.error(`Worker nije registrovao sesiju (HTTP ${r.stdout.trim() || "?"}). Provjeri workerBase i pullSecret.`);
  process.exit(1);
}

// Zapamti mapiranje za pullera.
const mapa = citajMapu();
mapa[id] = { klon, created: new Date().toISOString() };
upisiMapu(mapa);

// Ljudska biljeska u klon (onboarding-stanje.md je crni obrazac za backup, ne curi).
const stanjeDir = resolve(klon, ".olx-pik");
mkdirSync(stanjeDir, { recursive: true });
appendFileSync(
  resolve(stanjeDir, "onboarding-stanje.md"),
  `\n- ${new Date().toISOString()} onboarding link izdat, sesija ${id}, ceka se klijentov login\n`,
);

const link = `${cfg.workerBase}/o/${id}`;
spawnSync("pbcopy", { input: link });

console.log(link);
console.error("");
console.error("Link je kopiran u clipboard. Posalji ga klijentu.");
console.error(`Klon: ${klon}`);
console.error("Kad se klijent uloguje, puller ce sam upisati token i pokrenuti analizu.");
