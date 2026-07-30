#!/usr/bin/env node
// Proba Telegram kanala na pogonu koji je trenutno u okruzenju.
//
// Odgovara na jedno pitanje: kad covjek posalje poruku botu, da li sesija na OVOM modelu
// isporucenu poruku vidi i da li na nju odgovori pozivom alata reply. Ako model samo prica,
// covjek na Telegramu ne vidi nista, jer transkript sesije ne ide u chat.
//
// Vazno: pokrece sesiju u rezimu `-p --input-format stream-json`, dakle BEZ terminala. To je
// namjerno: interaktivna sesija trazi TTY (vidi deepseek-nalazi.md), a pod launchd i na
// Windowsu TTY-a nema, pa je ovo rezim koji pogonu stvarno treba dokazati.
//
// Token ide u izolovan TELEGRAM_STATE_DIR pod .olx-pik/, nikad u stanje ziveg klijentskog
// bota. Koristi PROBNI bot iz BotFathera, ne klijentov: dva pollera na istom tokenu daju
// 409 Conflict i obaraju ziv bot.
//
//   node scripts/proba-kanala.mjs <bot_token> <tvoj_telegram_id> [--sekundi 150]
//
// Pogon se bira okruzenjem, ne ovom skriptom, da mapiranje varijabli ostane na jednom mjestu:
//   pretplata:  node scripts/proba-kanala.mjs ...
//   deepseek:   ( set -a; . ~/.claude/deepseek.env; set +a; node scripts/proba-kanala.mjs ... )

import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const TAJNA = "KANAL-RADI";

const argv = process.argv.slice(2);
const token = argv[0];
const telegramId = argv[1];
const sekundiArg = argv.indexOf("--sekundi");
const SEKUNDI = sekundiArg !== -1 ? Number(argv[sekundiArg + 1]) : 150;

if (!token || !telegramId || !/^\d+$/.test(telegramId)) {
  console.error(
    "Upotreba: node scripts/proba-kanala.mjs <bot_token> <tvoj_telegram_id> [--sekundi 150]\n" +
      "Telegram ID je broj; dobija se od @userinfobot.",
  );
  process.exit(2);
}

const STANJE = resolve(".olx-pik/proba-kanala");
const TELEGRAM_DIR = join(STANJE, "channels", "telegram");

function pocisti() {
  try {
    rmSync(STANJE, { recursive: true, force: true });
  } catch {
    // ako ostane, u njemu je samo probni token; javi covjeku da ga rucno obrise
  }
}

// ---- stanje probnog kanala ----
mkdirSync(join(TELEGRAM_DIR, "inbox"), { recursive: true });
writeFileSync(join(TELEGRAM_DIR, ".env"), `TELEGRAM_BOT_TOKEN=${token}\n`, "utf8");
chmodSync(join(TELEGRAM_DIR, ".env"), 0o600);
writeFileSync(
  join(TELEGRAM_DIR, "access.json"),
  `${JSON.stringify({ dmPolicy: "allowlist", allowFrom: [telegramId], groups: {}, pending: {} }, null, 2)}\n`,
  "utf8",
);
chmodSync(join(TELEGRAM_DIR, "access.json"), 0o600);

// ---- ko je bot ----
let botIme = "(nepoznato)";
try {
  const odgovor = await fetch(`https://api.telegram.org/bot${token}/getMe`);
  const tijelo = await odgovor.json();
  if (tijelo?.ok && tijelo.result?.username) botIme = `@${tijelo.result.username}`;
  else {
    console.error(`Telegram nije prihvatio token: ${tijelo?.description ?? "bez objasnjenja"}`);
    pocisti();
    process.exit(1);
  }
} catch (e) {
  console.error(`Ne mogu doci do Telegrama: ${e instanceof Error ? e.message : e}`);
  pocisti();
  process.exit(1);
}

const pogon = process.env.ANTHROPIC_BASE_URL ? `${process.env.ANTHROPIC_BASE_URL} (${process.env.ANTHROPIC_MODEL ?? "default model"})` : "Anthropic pretplata";

console.log(`Bot: ${botIme}`);
console.log(`Pogon: ${pogon}`);
console.log(`Stanje kanala: ${TELEGRAM_DIR}`);
console.log("");
console.log(`SADA posalji tom botu OBICNU poruku sa Telegrama: reci samo ${TAJNA}`);
console.log("NE /start i NE /help: to su komande bota, imaju svoj handler i do sesije ne dolaze.");
console.log(`Cekam ${SEKUNDI}s, pa ispisujem nalaz.`);
console.log("");

// ---- sesija ----
const argvClaude = [
  "-p",
  "--verbose",
  "--input-format",
  "stream-json",
  "--output-format",
  "stream-json",
  "--channels",
  "plugin:telegram@claude-plugins-official",
  "--allowedTools",
  "mcp__telegram__reply",
];

const dijete = spawn("claude", argvClaude, {
  env: { ...process.env, TELEGRAM_STATE_DIR: TELEGRAM_DIR },
  stdio: ["pipe", "pipe", "pipe"],
  shell: process.platform === "win32",
});

let dolaznaVidjena = false;
let replyPozvan = false;
const greske = [];
let bafer = "";

dijete.stdout.on("data", (dio) => {
  bafer += dio.toString("utf8");
  let nl;
  while ((nl = bafer.indexOf("\n")) !== -1) {
    const red = bafer.slice(0, nl).trim();
    bafer = bafer.slice(nl + 1);
    if (!red) continue;
    let poruka;
    try {
      poruka = JSON.parse(red);
    } catch {
      continue;
    }
    const sadrzaj = poruka?.message?.content;
    if (Array.isArray(sadrzaj)) {
      for (const blok of sadrzaj) {
        if (blok.type === "text" && typeof blok.text === "string" && blok.text.includes("<channel")) {
          dolaznaVidjena = true;
        }
        if (blok.type === "tool_use" && String(blok.name ?? "").includes("reply")) {
          replyPozvan = true;
          console.log(`  reply pozvan: ${JSON.stringify(blok.input ?? {})}`);
        }
      }
    }
    // Dolazna poruka moze doci i kao obican user turn sa <channel> tagom u stringu.
    if (typeof sadrzaj === "string" && sadrzaj.includes("<channel")) dolaznaVidjena = true;
  }
});

dijete.stderr.on("data", (dio) => {
  const tekst = dio.toString("utf8").trim();
  if (tekst) greske.push(tekst);
});

dijete.on("error", (e) => {
  greske.push(`sesija se nije pokrenula: ${e.message}. Da li je claude u PATH-u?`);
});

setTimeout(() => {
  dijete.kill("SIGTERM");
  setTimeout(() => dijete.kill("SIGKILL"), 2000);
}, SEKUNDI * 1000);

dijete.on("exit", (kod, signal) => {
  console.log("");
  console.log("=== nalaz ===");
  console.log(`sesija je izasla: kod ${kod}, signal ${signal ?? "-"}`);
  console.log(`dolazna poruka isporucena sesiji: ${dolaznaVidjena ? "DA" : "NE"}`);
  console.log(`sesija pozvala reply: ${replyPozvan ? "DA" : "NE"}`);
  if (greske.length > 0) {
    console.log("");
    console.log("stderr sesije:");
    for (const g of greske.slice(0, 20)) console.log(`  ${g}`);
  }
  console.log("");
  if (dolaznaVidjena && replyPozvan) {
    console.log("Kanal radi na ovom pogonu, i to bez terminala. Ovo je rezim koji pogon moze koristiti.");
  } else if (dolaznaVidjena) {
    console.log("Poruka je stigla do sesije, ali model nije pozvao reply. Covjek na Telegramu ne bi vidio nista.");
    console.log("Za pogon: jaci model za mainline, ili stroza uputa u SISTEM-klijent.md.");
  } else {
    console.log("Poruka nije stigla do sesije. Provjeri da li si poslao poruku, da li je ID tacan,");
    console.log("i da li je u BotFatheru privatnost bota postavljena kako treba.");
  }
  pocisti();
  console.log(`Probno stanje kanala obrisano (${STANJE}).`);
  process.exit(dolaznaVidjena && replyPozvan ? 0 : 1);
});
