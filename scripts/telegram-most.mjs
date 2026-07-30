#!/usr/bin/env node
// Telegram most: bot koji NE zavisi od zive interaktivne Claude Code sesije.
//
// Zasto postoji. Kanal (`--channels`) radi samo u interaktivnoj sesiji, a interaktivna sesija
// trazi terminal; pod launchd terminala nema. Uz to je kanal eksperimentalna funkcija koju
// jedna varijabla okruzenja tiho ugasi (izmjereno, olx-dokumentacija/deepseek-nalazi.md).
//
//   Telegram getUpdates -> red na disku -> ziva `claude -p` sesija (stdin) -> sendMessage
//
// Sesija je JEDAN dugozivi proces u stream-json rezimu. Izmjereno je da takva sesija prima
// poruke kroz stdin kad god ih posaljemo, odgovara, i pamti kontekst izmedju poruka, sve bez
// terminala. Time nema troska pokretanja po poruci i kes prefiksa ostaje topao.
//
// Nijedna poruka se ne gubi, i to nosi red na disku, ne transport:
//   1. Telegram offset se pomjera SAMO nakon sto je poruka zapisana u red (fsync kroz rename).
//   2. Stavka se brise iz reda SAMO nakon sto je odgovor poslan na Telegram.
//   Ako proces padne izmedju, poruka je i dalje u redu i obradi se ponovo. Isporuka je dakle
//   najmanje jednom, sto je za ovaj posao ispravan izbor: dupli odgovor je neugodan, propusten
//   je izgubljen klijent.
//
// Pokretanje:
//   node scripts/telegram-most.mjs            # pogon
//   node scripts/telegram-most.mjs --jednom   # obradi sto ceka pa izadji (za probu)
//
// Pogon (DeepSeek ili pretplata) bira se okruzenjem: ovaj proces samo prenosi svoje okruzenje.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

// ---- konfiguracija ----

if (typeof process.loadEnvFile === "function" && existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env sa neispravnim redom: provjeri-klon.mjs to prijavljuje jasnije
  }
}

const JEDNOM = process.argv.includes("--jednom");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const RUNTIME = process.env.CLAUDE_CONFIG_DIR || ".claude-runtime";
const INBOX = join(RUNTIME, "channels", "telegram", "inbox");
const STANJE_FAJL = ".olx-pik/most-stanje.json";
const PROMPT_FAJL = "runtime/SISTEM-klijent.md";
const ALBUM_CEKANJE_MS = 2500;
const POLL_TIMEOUT_S = 50;
const POTEZ_TIMEOUT_MS = Number(process.env.OLX_MOST_POTEZ_TIMEOUT_MS) || 300000;
const MAX_POKUSAJA = 3;

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN nije postavljen u .env. Most se ne moze pokrenuti.");
  process.exit(2);
}

const log = (sta) => console.log(`${new Date().toISOString()} ${sta}`);

// ---- stanje i red, oboje na disku ----
// Jedan fajl: offset, ID sesije i red stavki. Upis je atomican (tmp + rename), pa pad u
// sredini upisa ne moze ostaviti pokvaren fajl.

function citajStanje() {
  try {
    const s = JSON.parse(readFileSync(STANJE_FAJL, "utf8"));
    return { offset: s.offset ?? 0, sesija: s.sesija ?? null, red: Array.isArray(s.red) ? s.red : [] };
  } catch {
    return { offset: 0, sesija: null, red: [] };
  }
}

let stanje = citajStanje();

function sacuvaj() {
  mkdirSync(dirname(STANJE_FAJL), { recursive: true });
  const tmp = `${STANJE_FAJL}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(stanje, null, 2)}\n`, "utf8");
  renameSync(tmp, STANJE_FAJL);
}

// ---- kontrola pristupa ----
// Jedan izvor istine sa kanalom: cita se access.json koji pripremi skripte vec pisu, pa se
// allowlist ne drzi na dva mjesta. Bez tog fajla most ne prima nista.

function citajPristup() {
  try {
    const a = JSON.parse(readFileSync(join(RUNTIME, "channels", "telegram", "access.json"), "utf8"));
    return {
      dmPolicy: a.dmPolicy ?? "allowlist",
      allowFrom: (a.allowFrom ?? []).map(String),
      groups: a.groups ?? {},
    };
  } catch {
    return null;
  }
}

/** true kad poruka smije u sesiju. Sve ostalo se tiho ispusta, kao i kod kanala. */
function dozvoljena(poruka, pristup, botIme) {
  const posiljalac = String(poruka.from?.id ?? "");
  if (!posiljalac) return false;
  const tip = poruka.chat?.type;

  if (tip === "private") {
    return pristup.dmPolicy !== "disabled" && pristup.allowFrom.includes(posiljalac);
  }
  if (tip === "group" || tip === "supergroup") {
    const politika = pristup.groups[String(poruka.chat.id)];
    if (!politika) return false;
    const dozvoljeni = (politika.allowFrom ?? []).map(String);
    if (dozvoljeni.length > 0 && !dozvoljeni.includes(posiljalac)) return false;
    if (politika.requireMention ?? true) {
      const tekst = poruka.text ?? poruka.caption ?? "";
      if (!botIme || !tekst.includes(`@${botIme}`)) return false;
    }
    return true;
  }
  return false;
}

// ---- Telegram ----

async function tg(metoda, tijelo) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${metoda}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tijelo ?? {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`Telegram ${metoda}: ${j.description ?? res.status}`);
  return j.result;
}

/** Skine fotografiju u inbox koji klijentska sesija smije citati. Vraca putanju ili null. */
async function skiniFoto(poruka) {
  const velicine = poruka.photo;
  if (!Array.isArray(velicine) || velicine.length === 0) return null;
  const najveca = velicine[velicine.length - 1]; // Telegram salje rastuce, zadnja je najveca
  try {
    const info = await tg("getFile", { file_id: najveca.file_id });
    const res = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${info.file_path}`);
    if (!res.ok) throw new Error(`preuzimanje fajla: ${res.status}`);
    const ext = (info.file_path.match(/\.[a-z0-9]+$/i) ?? [".jpg"])[0].toLowerCase();
    mkdirSync(INBOX, { recursive: true });
    const putanja = resolve(INBOX, `${Date.now()}-${najveca.file_unique_id}${ext}`);
    writeFileSync(putanja, Buffer.from(await res.arrayBuffer()));
    return putanja;
  } catch (e) {
    log(`fotografija nije skinuta: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

// ---- ziva sesija ----

const ZABRANJENI_ALATI = ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "Agent", "Grep", "Glob", "Skill"];

let sesija = null; // { dijete, cekaci: [], buf }

function argviSesije(nastavak) {
  const id = stanje.sesija ?? randomUUID();
  return {
    id,
    argv: [
      "-p",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      // Telegram MCP plugin ovdje NE treba: poruke saljemo sami, pa strict izolacija smije.
      "--strict-mcp-config",
      "--mcp-config",
      ".mcp.json",
      "--append-system-prompt-file",
      PROMPT_FAJL,
      "--setting-sources",
      "user,project",
      "--permission-mode",
      "acceptEdits",
      // Headless sesija nema koga da klikne potvrdu: bez ovoga bi visjela.
      "--allowedTools",
      "mcp__olx-pik",
      "--disallowedTools",
      ...ZABRANJENI_ALATI,
      nastavak ? "--resume" : "--session-id",
      id,
    ],
  };
}

function pokreniSesiju(nastavak) {
  const { id, argv } = argviSesije(nastavak);
  const dijete = spawn("claude", argv, {
    env: { ...process.env, CLAUDE_CONFIG_DIR: RUNTIME },
    stdio: ["pipe", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const s = { dijete, id, buf: "", cekac: null, greske: "" };

  dijete.stdout.on("data", (d) => {
    s.buf += d.toString("utf8");
    let i;
    while ((i = s.buf.indexOf("\n")) !== -1) {
      const red = s.buf.slice(0, i);
      s.buf = s.buf.slice(i + 1);
      if (!red.trim()) continue;
      let j;
      try {
        j = JSON.parse(red);
      } catch {
        continue;
      }
      // `result` zatvara potez i nosi konacan tekst.
      if (j.type === "result" && s.cekac) {
        const cekac = s.cekac;
        s.cekac = null;
        cekac({ ok: j.subtype === "success", tekst: typeof j.result === "string" ? j.result.trim() : "" });
      }
    }
  });
  dijete.stderr.on("data", (d) => {
    s.greske = `${s.greske}${d.toString("utf8")}`.slice(-2000);
  });
  dijete.on("exit", (kod) => {
    log(`sesija izasla (kod ${kod})${s.greske.trim() ? `: ${s.greske.trim().slice(-300)}` : ""}`);
    if (sesija === s) sesija = null;
    if (s.cekac) {
      const cekac = s.cekac;
      s.cekac = null;
      cekac({ ok: false, tekst: "", greska: `sesija je pala (kod ${kod})` });
    }
  });
  dijete.on("error", (e) => log(`sesija se nije pokrenula: ${e.message}. Da li je claude u PATH-u?`));

  if (s.id !== stanje.sesija) {
    stanje = { ...stanje, sesija: s.id };
    sacuvaj();
  }
  log(`sesija pokrenuta (pid ${dijete.pid ?? "?"}, ${nastavak ? "nastavak" : "nova"} ${s.id})`);
  return s;
}

/** Posalje tekst zivoj sesiji i vrati sto je vratila. Pokrece sesiju ako je nema. */
function posaljiSesiji(tekst) {
  if (!sesija) sesija = pokreniSesiju(Boolean(stanje.sesija));
  const s = sesija;
  if (s.cekac) return Promise.resolve({ ok: false, tekst: "", greska: "sesija je zauzeta" });

  return new Promise((zavrsi) => {
    const tajmer = setTimeout(() => {
      if (s.cekac) {
        s.cekac = null;
        log("potez je prekoracio vrijeme, gasim sesiju");
        s.dijete.kill("SIGTERM");
        zavrsi({ ok: false, tekst: "", greska: "potez nije zavrsio na vrijeme" });
      }
    }, POTEZ_TIMEOUT_MS);

    s.cekac = (rezultat) => {
      clearTimeout(tajmer);
      zavrsi(rezultat);
    };

    s.dijete.stdin.write(
      `${JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: tekst }] } })}\n`,
      (e) => {
        if (e && s.cekac) {
          const cekac = s.cekac;
          s.cekac = null;
          clearTimeout(tajmer);
          cekac({ ok: false, tekst: "", greska: `upis u sesiju pao: ${e.message}` });
        }
      },
    );
  });
}

// ---- obrada reda ----

let radi = false;

function tekstStavke(stavka) {
  const dijelovi = [stavka.tekst || "(bez teksta)"];
  if (stavka.slike?.length) {
    const opis = stavka.slike.length === 1 ? "Poslana je fotografija" : `Poslano je ${stavka.slike.length} fotografija`;
    dijelovi.push(`\n[${opis}, na disku: ${stavka.slike.join(", ")}]`);
  }
  return dijelovi.join("");
}

/** Slike koje su nastale tokom poteza. Sesija ih pravi kroz olx_generiraj_sliku. */
function slikeNovijeOd(od) {
  const dir = process.env.OLX_SLIKA_DIR || ".olx-pik/slike";
  try {
    return readdirSync(dir)
      .map((ime) => join(dir, ime))
      .filter((p) => {
        try {
          return statSync(p).mtimeMs >= od;
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return []; // mape nema dok se prva slika ne napravi
  }
}

async function obradiRed() {
  if (radi) return;
  radi = true;
  const { posaljiPoruku, posaljiSliku, javiAdminu } = await import("../dist/core/telegram.js");
  try {
    while (stanje.red.length > 0) {
      const stavka = stanje.red[0];
      const kucaj = setInterval(() => {
        void tg("sendChatAction", { chat_id: stavka.chatId, action: "typing" }).catch(() => {});
      }, 4000);
      void tg("sendChatAction", { chat_id: stavka.chatId, action: "typing" }).catch(() => {});

      const potezPoceo = Date.now();
      let odgovor;
      try {
        odgovor = await posaljiSesiji(tekstStavke(stavka));
        // Gasenje nije neuspjeh stavke: ostavljamo je u redu netaknutu, bez pokusaja.
        if (gasenje) return;
        // Nastavak moze pasti ako je historija sesije nestala: krecemo od nove, jednom.
        if (!odgovor.ok && stanje.sesija && !stavka.novaSesijaProbana) {
          log(`potez pao (${odgovor.greska ?? "bez objasnjenja"}), krecem novu sesiju`);
          stavka.novaSesijaProbana = true;
          stanje = { ...stanje, sesija: null };
          sacuvaj();
          odgovor = await posaljiSesiji(tekstStavke(stavka));
        }
      } finally {
        clearInterval(kucaj);
      }

      if (odgovor.ok && odgovor.tekst) {
        try {
          await posaljiPoruku(odgovor.tekst, { chatId: String(stavka.chatId) });
          log(`odgovoreno u chat ${stavka.chatId} (${odgovor.tekst.length} znakova)`);
          // Slika koju je sesija napravila tokom ovog poteza ide odmah za tekstom. Ne trazi se
          // nikakva saradnja modela: dovoljno je da je fajl nastao, pa i slabiji model ne moze
          // zaboraviti da je posalje.
          for (const putanja of slikeNovijeOd(potezPoceo)) {
            try {
              await posaljiSliku(putanja, { chatId: String(stavka.chatId) });
              log(`poslana slika ${putanja}`);
            } catch (e) {
              log(`slika nije poslana: ${e instanceof Error ? e.message : e}`);
            }
          }
          // Tek sada stavka izlazi iz reda: prije ovoga pad znaci ponovnu obradu, ne gubitak.
          stanje = { ...stanje, red: stanje.red.slice(1) };
          sacuvaj();
          continue;
        } catch (e) {
          log(`slanje na Telegram palo: ${e instanceof Error ? e.message : e}`);
        }
      }

      stavka.pokusaja = (stavka.pokusaja ?? 0) + 1;
      if (stavka.pokusaja >= MAX_POKUSAJA) {
        log(`stavka odustaje poslije ${stavka.pokusaja} pokusaja`);
        stanje = { ...stanje, red: stanje.red.slice(1) };
        sacuvaj();
        await javiAdminu(
          `Telegram most: poruka iz chata ${stavka.chatId} nije odgovorena poslije ${stavka.pokusaja} pokusaja.\n` +
            `Zadnja greska: ${odgovor.greska ?? "sesija je vratila prazan tekst"}`,
        ).catch(() => {});
      } else {
        sacuvaj();
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  } finally {
    radi = false;
  }
}

// ---- album bafer ----
// Telegram album stize kao vise odvojenih poruka sa istim media_group_id i bez signala da je
// zadnja. Kratko cekanje ih spaja u jednu stavku, pa korisnik ne mora pisati "gotovo".

const albumi = new Map();

function uRed(stavka) {
  stanje = { ...stanje, red: [...stanje.red, stavka] };
  sacuvaj();
  void obradiRed();
}

function ubaci(chatId, tekst, slike, albumId) {
  if (!albumId) {
    uRed({ chatId, tekst, slike });
    return;
  }
  const postojeci = albumi.get(albumId);
  if (postojeci) {
    postojeci.slike.push(...slike);
    if (tekst && !postojeci.tekst) postojeci.tekst = tekst;
    clearTimeout(postojeci.tajmer);
  }
  const stavka = postojeci ?? { chatId, tekst, slike: [...slike] };
  stavka.tajmer = setTimeout(() => {
    albumi.delete(albumId);
    uRed({ chatId: stavka.chatId, tekst: stavka.tekst, slike: stavka.slike });
  }, ALBUM_CEKANJE_MS);
  albumi.set(albumId, stavka);
}

// ---- glavna petlja ----

let gasenje = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (gasenje) return; // launchd i shell umiju poslati oba signala
    gasenje = true;
    log("gasim se, sto je u redu ostaje za sljedece pokretanje");
    sesija?.dijete.kill("SIGTERM");
    setTimeout(() => process.exit(0), 500);
  });
}

const pristup = citajPristup();
if (!pristup) {
  console.error(
    `Nema ${join(RUNTIME, "channels", "telegram", "access.json")}. Most bez allowlista ne prima nista.\n` +
      "Pripremi runtime: node scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>",
  );
  process.exit(2);
}

let botIme = null;
try {
  botIme = (await tg("getMe")).username ?? null;
} catch (e) {
  console.error(`Telegram nije prihvatio token: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}

log(`most radi kao @${botIme}, offset ${stanje.offset}, u redu ${stanje.red.length}, sesija ${stanje.sesija ?? "(nova)"}`);
if (stanje.red.length > 0) void obradiRed(); // sto je ostalo od proslog pokretanja

while (!gasenje) {
  let noviji;
  try {
    noviji = await tg("getUpdates", {
      offset: stanje.offset,
      timeout: JEDNOM ? 0 : POLL_TIMEOUT_S,
      allowed_updates: ["message"],
    });
  } catch (e) {
    log(`getUpdates pao: ${e instanceof Error ? e.message : e}`);
    await new Promise((r) => setTimeout(r, 5000));
    continue;
  }

  for (const u of noviji) {
    const poruka = u.message;
    if (poruka && dozvoljena(poruka, pristup, botIme)) {
      const tekst = (poruka.text ?? poruka.caption ?? "").trim();
      if (tekst.startsWith("/")) {
        log(`komanda ${tekst.split(" ")[0]} preskocena`); // komande ne idu u sesiju
      } else {
        const slika = await skiniFoto(poruka);
        if (tekst || slika) ubaci(poruka.chat.id, tekst, slika ? [slika] : [], poruka.media_group_id ?? null);
      }
    } else if (poruka) {
      log(`ispusteno: chat ${poruka.chat?.id}, od ${poruka.from?.id}`);
    }
    // Offset se pomjera tek kad je poruka obradjena do reda: pad prije ovoga znaci da je
    // Telegram i dalje drzi i dostavlja je ponovo.
    stanje = { ...stanje, offset: u.update_id + 1 };
    sacuvaj();
  }

  if (JEDNOM) {
    while (radi || stanje.red.length > 0 || albumi.size > 0) await new Promise((r) => setTimeout(r, 500));
    sesija?.dijete.kill("SIGTERM");
    break;
  }
}
