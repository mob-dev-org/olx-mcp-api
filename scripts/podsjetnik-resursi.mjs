#!/usr/bin/env bun
// Podsjetnik pri pokretanju sesije: kratak pregled potrosnje resursa OVOG klona (RSS sesije,
// cuvara, stanje masine), da se telemetrija koju cuvar-sesije.mjs vec skuplja i stvarno pogleda,
// ne samo lezi u .olx-pik/resursi/*.jsonl neprocitana.
//
// Tih je u KLIJENTSKOJ bot sesiji, isti razlog i ista provjera kao provjeri-izdanje.mjs: izlaz
// hooka ulazi u kontekst sesije, a klijent ne treba da vidi RSS brojeve svog bota niti moze
// ista uraditi po tom pitanju. Admin bot sesija i terminalska sesija izvjestaj DOBIJAJU.
//
// Nikad ne pada i nikad ne visi: bez PID fajlova `resursi.mjs pregled` sam kaze "ne radi" za tu
// stavku, a rok ispod brani hook od spore ps/PowerShell sonde. Pad ovog podsjetnika ne smije
// biti pad pokretanja sesije, zato je svaka greska progutana.
//
// Pokretanje (SessionStart hook):
//   bun scripts/podsjetnik-resursi.mjs

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROK_MS = Number(process.env.OLX_PODSJETNIK_RESURSI_ROK_MS ?? 8000);

// Vidi provjeri-izdanje.mjs za isto obrazlozenje: cuvar postavlja CLAUDE_CONFIG_DIR na
// .claude-runtime za klijentsku bot sesiju, na .claude-runtime-admin za admin bota. Terminalska
// sesija tu varijablu nema.
const RUNTIME = (process.env.CLAUDE_CONFIG_DIR ?? "").replace(/[/\\]+$/, "");
if (RUNTIME.endsWith(".claude-runtime")) process.exit(0);

try {
  const izlaz = execFileSync(process.execPath, [join(KORIJEN, "scripts", "resursi.mjs"), "pregled"], {
    cwd: KORIJEN,
    timeout: ROK_MS,
    stdio: ["ignore", "pipe", "ignore"],
  }).toString();
  console.log(izlaz.trim());
  console.log("(puna istorija: bun scripts/resursi.mjs izvjestaj)");
} catch {
  // Best effort podsjetnik, ne kozmeticka provjera koja smije srusiti pokretanje sesije.
}
process.exit(0);
