#!/usr/bin/env bun
// Pokrece Claude Code sesiju na DeepSeek pogonu, sa konfiguracijom iz .env OVOG klona.
//
// Zasto postoji: isto je radila zsh funkcija `claude-ds` iz ~/.zshrc, ali to je konfiguracija
// globalna po masini, sto CLAUDE.md zabranjuje ("sva konfiguracija zivi u repou i .env"). Zato je
// na Windowsu i nije bilo. Ova skripta radi isto na obje platforme i cita kljuc sa istog mjesta
// odakle ga cita pogon klijentske sesije (cuvar-sesije.mjs), pa se ne moze dogoditi da rucna
// sesija radi a bot ne, ili obrnuto.
//
// Varijable vaze SAMO unutar procesa koji ova skripta pokrene. Nista se ne exportuje u shell.
//
// Pokretanje:
//   bun scripts/claude-ds.mjs              # sesija na DeepSeeku
//   bun scripts/claude-ds.mjs --env        # samo ispisi podesavanja, ne pokreci nista
//   bun scripts/claude-ds.mjs -p "upit"    # svi ostali argumenti idu Claudeu

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ucitajEnvGlobalno } from "./lib/envfajl.mjs";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(KORIJEN);

// Provjera fajla ide ODVOJENO od ucitavanja: pod Bunom process.loadEnvFile ne postoji, pa bi
// try/catch oko samog poziva pogresno prijavio "nema .env" i kad .env stvarno postoji (Bun ga je
// vec sam ucitao prije ove linije, izmjereno 15.08.2026).
if (!existsSync(".env")) {
  console.error("Nema .env u korijenu klona. Napravi ga iz .env.example pa popuni OLX_DEEPSEEK_*.");
  process.exit(1);
}
ucitajEnvGlobalno(".env");

const arg = process.argv.slice(2);
const SAMO_ENV = arg.includes("--env");
const zaClaude = arg.filter((a) => a !== "--env");

const baseUrl = process.env.OLX_DEEPSEEK_BASE_URL?.trim();
const token = process.env.OLX_DEEPSEEK_AUTH_TOKEN?.trim();

if (!baseUrl || !token || token.includes("POPUNI")) {
  console.error("DeepSeek nije podesen u .env ovog klona. Fale:");
  if (!baseUrl) console.error("  OLX_DEEPSEEK_BASE_URL   (npr. https://api.deepseek.com/anthropic)");
  if (!token || token.includes("POPUNI")) console.error("  OLX_DEEPSEEK_AUTH_TOKEN");
  console.error("Uzor je u .env.example. Isto mjesto cita i pogon klijentske sesije.");
  process.exit(1);
}

// ANTHROPIC_API_KEY se BRISE: kad ostane, prevagne nad AUTH_TOKEN-om i sesija tiho ode na
// pretplatu umjesto na DeepSeek, sto se vidi tek na racunu.
const env = {
  ...process.env,
  ANTHROPIC_BASE_URL: baseUrl,
  ANTHROPIC_AUTH_TOKEN: token,
  ...(process.env.OLX_DEEPSEEK_MODEL ? { ANTHROPIC_MODEL: process.env.OLX_DEEPSEEK_MODEL } : {}),
  ...(process.env.OLX_DEEPSEEK_HAIKU_MODEL
    ? { ANTHROPIC_DEFAULT_HAIKU_MODEL: process.env.OLX_DEEPSEEK_HAIKU_MODEL }
    : {}),
  ...(process.env.OLX_DEEPSEEK_TIMEOUT_MS ? { API_TIMEOUT_MS: process.env.OLX_DEEPSEEK_TIMEOUT_MS } : {}),
};
delete env.ANTHROPIC_API_KEY;

if (SAMO_ENV) {
  console.log("DeepSeek pogon, podesavanja iz .env ovog klona:");
  for (const kljuc of [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "API_TIMEOUT_MS",
  ]) {
    if (env[kljuc]) console.log(`  ${kljuc}=${env[kljuc]}`);
  }
  // Token se nikad ne ispisuje, ni skraceno: ovo se cesto pusta uz nekog drugog za ekranom.
  console.log(`  ANTHROPIC_AUTH_TOKEN=(postavljen, ${token.length} znakova)`);
  console.log("  ANTHROPIC_API_KEY=(obrisan, da pretplata ne prevagne)");
  process.exit(0);
}

// shell na Windowsu, jer je `claude` tamo .cmd omotac koji spawn bez shella ne nalazi.
const dijete = spawn("claude", zaClaude, {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

dijete.on("error", (e) => {
  console.error(`Ne mogu pokrenuti claude: ${e.message}`);
  console.error("Je li Claude Code instaliran i u PATH-u? Provjeri sa: claude --version");
  process.exit(1);
});

dijete.on("exit", (kod, signal) => {
  process.exit(signal ? 1 : (kod ?? 0));
});
