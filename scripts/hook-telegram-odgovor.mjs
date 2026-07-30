#!/usr/bin/env node
// Stop hook: ne pusti sesiju da zavrsi potez ako je poruka dosla sa Telegram kanala a odgovor
// nije poslan alatom `reply`.
//
// Zasto hook a ne samo prompt. Pravilo o `reply` stoji kao prva sekcija u SISTEM-klijent.md i
// SISTEM-admin-bot.md, i izmjereno je da pomaze (deepseek-nalazi.md). Ali slabiji model ga
// povremeno preskoci: uradi posao, napise odgovor u transkript, i stane. Covjek na Telegramu
// tada ne vidi NISTA i nema nikakvog znaka da se nesto desilo. Isti obrazac kao `ask` pravilo
// za trosak: zastita ide u harness, ne u prompt.
//
// Kako radi: procita transkript od kraja do zadnje korisnicke poruke. Ako ta poruka nosi
// <channel ... > tag (tako Claude Code ubacuje dolaznu poruku kanala) a poslije nje nema poziva
// alata `reply`, potez se blokira sa objasnjenjem. Model tada dobije priliku poslati poruku.
//
// Sesije bez kanala hook ne dira, jer u njima nema <channel> taga: to su terminalske sesije i
// Telegram most (most odgovor salje sam, nema `reply` alat).
//
// Registruje se u .claude/settings.json:
//   "hooks": { "Stop": [{ "hooks": [{ "type": "command",
//     "command": "node scripts/hook-telegram-odgovor.mjs" }] }] }

import { readFileSync } from "node:fs";

const IME_REPLY = "reply";

function procitajStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

/** Hook nikad ne obara sesiju: na svaku nejasnocu pusta potez dalje. */
function pusti() {
  process.exit(0);
}

function blokiraj(razlog) {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason: razlog })}\n`);
  process.exit(0);
}

const ulaz = procitajStdin();
if (!ulaz) pusti();

// stop_hook_active znaci da smo vec jednom blokirali ovaj potez. Drugi put se pusta, da model
// koji uporno ne poziva alat ne zavrti sesiju u krug.
if (ulaz.stop_hook_active) pusti();

const putanja = ulaz.transcript_path;
if (typeof putanja !== "string" || !putanja) pusti();

let redovi;
try {
  redovi = readFileSync(putanja, "utf8").split("\n").filter((r) => r.trim());
} catch {
  pusti();
}

// Od kraja unazad: skupljamo pozvane alate dok ne naidjemo na zadnju korisnicku poruku.
let replyPozvan = false;
let dolaznaSaKanala = false;

for (let i = redovi.length - 1; i >= 0; i--) {
  let zapis;
  try {
    zapis = JSON.parse(redovi[i]);
  } catch {
    continue;
  }
  const poruka = zapis.message ?? zapis;
  const sadrzaj = poruka?.content;

  if (Array.isArray(sadrzaj)) {
    for (const blok of sadrzaj) {
      if (blok?.type === "tool_use" && String(blok.name ?? "").endsWith(IME_REPLY)) replyPozvan = true;
    }
  }

  const jeKorisnik = zapis.type === "user" || poruka?.role === "user";
  if (!jeKorisnik) continue;

  // Tekst korisnicke poruke moze biti string ili niz blokova.
  const tekst = typeof sadrzaj === "string"
    ? sadrzaj
    : Array.isArray(sadrzaj)
      ? sadrzaj.filter((b) => b?.type === "text").map((b) => b.text ?? "").join(" ")
      : "";

  // tool_result poruke su takodjer role user; njih preskacemo i trazimo pravu korisnicku poruku.
  const jeToolResult = Array.isArray(sadrzaj) && sadrzaj.some((b) => b?.type === "tool_result");
  if (jeToolResult) continue;

  dolaznaSaKanala = tekst.includes("<channel");
  break;
}

if (dolaznaSaKanala && !replyPozvan) {
  blokiraj(
    "Poruka je dosla sa Telegrama, a nisi je odgovorio alatom reply. Covjek cita Telegram, ne " +
      "ovaj transkript, pa trenutno nije dobio nista. Posalji odgovor alatom reply sa chat_id iz " +
      "dolazne poruke, pa onda zavrsi.",
  );
}

pusti();
