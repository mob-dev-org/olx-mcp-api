// Instalacija Telegram plugina u runtime folder klona (.claude-runtime ili
// .claude-runtime-admin). Plugin cache zivi u $CLAUDE_CONFIG_DIR/plugins/, dakle po runtime-u;
// instalacija u globalni ~/.claude klijentskoj sesiji ne vrijedi nista (izmjereno 01.08.2026:
// prazan config dir javlja "No plugins installed").
//
// Pozivaju je pripremi skripte na kraju pripreme, da zatvore rupu "klon izgleda zdrav a bot
// cuti". Instalacija moze pasti (claude nije u PATH-u, nema GitHub SSH kljuca za kloniranje
// marketplacea, nema mreze), pa nikad ne rusi pripremu: ispise rucne komande i vrati ok: false.
// Preflight u provjeri-klon.mjs ostaje kapija prije rada sa klijentom.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Ista cache putanja koju provjerava provjeri-klon.mjs. Vraca verziju ili null.
export function verzijaPlugina(runtimeDir) {
  const cache = join(runtimeDir, "plugins", "cache", "claude-plugins-official", "telegram");
  try {
    return readdirSync(cache).find((v) => existsSync(join(cache, v, ".mcp.json"))) ?? null;
  } catch {
    return null;
  }
}

function komandaPostoji(ime) {
  try {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [ime], { stdio: "ignore" });
    return r.status === 0;
  } catch {
    return false;
  }
}

// Idempotentna instalacija. Nikad ne baca; vraca { ok, verzija?, poruka? }.
export function instalirajTelegramPlugin(runtimeDir) {
  const vec = verzijaPlugina(runtimeDir);
  if (vec) {
    console.log(`Telegram plugin vec instaliran (verzija ${vec}).`);
    return { ok: true, verzija: vec };
  }

  console.log("Instaliram Telegram plugin u runtime (marketplace se klonira preko SSH-a, ~38 MB)...");
  const opcije = {
    env: { ...process.env, CLAUDE_CONFIG_DIR: runtimeDir },
    // inherit: pripremi skripte se pokrecu rucno u terminalu, pa covjek vidi napredak i
    // eventualni trust prompt marketplacea.
    stdio: "inherit",
    // Na Windowsu je claude .cmd shim, a njega Node bez shella odbija pokrenuti.
    shell: process.platform === "win32",
    timeout: 300_000,
  };
  // Neuspjeh pojedinacne komande nije presuda (marketplace moze vec postojati u runtime-u);
  // presudu daje iskljucivo cache putanja poslije oba koraka.
  spawnSync("claude", ["plugin", "marketplace", "add", "anthropics/claude-plugins-official"], opcije);
  spawnSync("claude", ["plugin", "install", "telegram@claude-plugins-official"], opcije);

  const verzija = verzijaPlugina(runtimeDir);
  if (verzija) {
    console.log(`Telegram plugin instaliran (verzija ${verzija}).`);
    if (!komandaPostoji("bun")) {
      console.log(
        "Upozorenje: bun nije u PATH-u. Plugin dize MCP server sa `bun run`; bez buna bot tiho ne odgovara. Instalacija: https://bun.sh",
      );
    }
    return { ok: true, verzija };
  }

  console.error("Telegram plugin NIJE instaliran automatski. Moguci uzroci: claude nije u PATH-u,");
  console.error("nema GitHub SSH kljuca (marketplace se klonira preko SSH-a) ili nema mreze.");
  console.error("Instaliraj rucno, pa provjeri sa: node scripts/provjeri-klon.mjs");
  console.error(
    `  macOS/Linux: CLAUDE_CONFIG_DIR=${runtimeDir} claude plugin marketplace add anthropics/claude-plugins-official && CLAUDE_CONFIG_DIR=${runtimeDir} claude plugin install telegram@claude-plugins-official`,
  );
  console.error(
    `  PowerShell:  $env:CLAUDE_CONFIG_DIR="${runtimeDir}"; claude plugin marketplace add anthropics/claude-plugins-official; claude plugin install telegram@claude-plugins-official`,
  );
  return { ok: false, poruka: "instalacija nije uspjela" };
}
