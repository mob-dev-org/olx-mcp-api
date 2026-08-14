// Pokretanje CLI-ja kao pravog djeteta iz testova pogona.
//
// Zasto poseban proces: komande u src/cli/index.ts su inline closures bez izvezene funkcije, i
// zavrsavaju sa process.exit(1) kroz posaoFail. Uvoz u test proces bi ubio sam test, pa se
// orkestracija mjeri jedino izvana: izlazni kod, stdout i tragovi na disku.

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = join(KORIJEN, "dist", "cli", "index.js");

// Svjez prazan folder po testu: CLI cijelo stanje (.olx-pik/) pravi relativno na cwd, pa se
// testovi ovako ne vide medjusobno niti diraju stanje pravog klona.
export function testniDir(ime) {
  return mkdtempSync(join(tmpdir(), `olx-cli-${ime}-`));
}

export function pokreniCli(args, opcije = {}) {
  const { cwd, mockUrl, env: dodatni = {}, timeoutMs = 15000 } = opcije;

  // Env se gradi od nule, ne nasljedjuje se: na razvojnoj masini u okruzenju vec stoje pravi
  // OLX_TOKEN i TELEGRAM_BOT_TOKEN, pa bi nasljedjivanje znacilo da test gadja pravi API ili
  // salje pravu poruku klijentu.
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "test",
    OLX_BASE_URL: mockUrl,
    OLX_TOKEN: "lazni-token-za-test",
    // Throttle i backoff su tu zbog pravog API-ja; protiv lokalnog mocka bi test od tri poziva
    // trajao sekundama, a scenarij sa 500 i cetiri ponavljanja preko deset sekundi.
    OLX_MIN_REQUEST_INTERVAL_MS: "0",
    OLX_MAX_RETRIES: "0",
    ...dodatni,
  };
  // TELEGRAM_* se namjerno NE postavlja: posaljiPoruku tada vrati 0 bez ijednog HTTP poziva, pa
  // testovi provjeravaju da li se do slanja uopste doslo, umjesto da salju stvarnu poruku.

  return new Promise((resolve, reject) => {
    const dijete = spawn(process.execPath, [CLI, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let istekao = false;

    const tajmer = setTimeout(() => {
      istekao = true;
      dijete.kill("SIGKILL");
    }, timeoutMs);

    dijete.stdout.on("data", (d) => (stdout += d));
    dijete.stderr.on("data", (d) => (stderr += d));
    dijete.on("error", (e) => {
      clearTimeout(tajmer);
      reject(e);
    });
    dijete.on("close", (kod) => {
      clearTimeout(tajmer);
      if (istekao) {
        reject(new Error(`CLI ${args.join(" ")} nije zavrsio za ${timeoutMs} ms.\nstdout: ${stdout}\nstderr: ${stderr}`));
        return;
      }
      resolve({ kod, stdout, stderr });
    });
  });
}

// Rezultat komande sa stdout-a. out() pise JSON u vise linija (uvuceno), pa se ne moze uzeti
// zadnja linija: trazi se najduzi zavrsni blok koji se parsira.
export function zadnjiJson(stdout) {
  const linije = stdout.trim().split("\n");
  for (let i = 0; i < linije.length; i++) {
    try {
      return JSON.parse(linije.slice(i).join("\n"));
    } catch {
      continue;
    }
  }
  return null;
}
