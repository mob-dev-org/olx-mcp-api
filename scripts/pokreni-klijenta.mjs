#!/usr/bin/env bun
// Pokrece klijentsku Claude Code sesiju za ovaj klon, u ISTOM terminalu, na obje platforme:
//
//   macOS:              bun scripts/pokreni-klijenta.mjs   (ili scripts/pokreni-klijenta.sh)
//   Windows PowerShell: bun scripts/pokreni-klijenta.mjs
//
// Bun umjesto basha namjerno (pravilo pogona): .sh na Windowsu ili ne postoji ili ga sistem
// otvara kroz Git Bash u novom prozoru. Sva logika (provjere, AI pogon, argv, spawn) zivi u
// scripts/lib/sesija.mjs i dijeli se sa pogonom (scripts/telegram-most.mjs), pa se rucna sesija
// i pogon ne mogu raziici.
//
// Razlika naspram scripts/claude-olx.sh (koji je za razvojni rad) i scripts/claude-ds.mjs
// (rucna DeepSeek sesija): ovdje CLAUDE_CONFIG_DIR pokazuje na .claude-runtime ovog klona, pa
// plugin, channels (bot token, access.json) i settings dolaze iz klona, ne iz globalnog
// ~/.claude. Zato ne treba --strict-mcp-config (globalnih servera nema), a i ne smije: strict
// rezim bi ugasio MCP server Telegram plugina. Kanal je Telegram, pa sesija mora ostati u
// prvom planu i biti interaktivna.
//
// Dodatni argumenti se prosljedjuju Claudeu: bun scripts/pokreni-klijenta.mjs --resume

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aiPogon,
  claudeArgv,
  okruzenjeSesije,
  pokreniClaude,
  provjeriPreduslove,
  sastaviPrompt,
  stazeSesije,
} from "./lib/sesija.mjs";
import { ucitajEnvGlobalno } from "./lib/envfajl.mjs";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(KORIJEN);
ucitajEnvGlobalno(".env"); // postojanje .env provjerava provjeriPreduslove, sa jasnom porukom

const TIP = "klijent";
const STAZE = stazeSesije(TIP, KORIJEN);

const preduslovi = provjeriPreduslove(TIP, KORIJEN, process.env);
if (preduslovi.greske.length > 0) {
  for (const g of preduslovi.greske) console.error(g);
  process.exit(1);
}
for (const u of preduslovi.upozorenja) console.error(u);

if (!existsSync(join(KORIJEN, "dist", "mcp", "server.js"))) {
  console.error("Nema dist/. Pokrecem build.");
  // npm je na Windowsu npm.cmd, pa mu treba shell.
  const build = spawnSync("npm", ["run", "build"], {
    cwd: KORIJEN,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const ai = aiPogon(false, process.env);
if (!ai.ok) {
  console.error(ai.poruka);
  process.exit(1);
}
console.error(
  ai.pogon === "deepseek"
    ? "Klijentska sesija ide na DeepSeek."
    : "Klijentska sesija ide na pretplatu (OLX_KLIJENT_AI nije deepseek).",
);

const dijete = pokreniClaude({
  argv: claudeArgv(sastaviPrompt(TIP, KORIJEN, console.error), process.argv.slice(2)),
  env: okruzenjeSesije({
    osnova: process.env,
    aiEnv: ai.env,
    obrisi: ai.obrisi,
    runtime: STAZE.runtime,
    telegramDir: STAZE.telegramDir,
    mcpProfil: STAZE.mcpProfil,
  }),
  cwd: KORIJEN,
});

// Ctrl+C ide sesiji direktno (foreground grupa na POSIX-u, konzolno stablo na Windowsu);
// launcher ga ignorise da ne umre prije djeteta, pa izadje sa njegovim kodom.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});

dijete.on("error", (e) => {
  console.error(`Sesija se nije pokrenula: ${e.message}. Da li je claude u PATH-u?`);
  process.exit(1);
});

dijete.on("exit", (kod, signal) => {
  process.exit(signal ? 130 : (kod ?? 0));
});
