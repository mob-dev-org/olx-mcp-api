#!/usr/bin/env bun
// Preflight provjera klijentskog klona: sta je usteklo, sta fali i TACNA komanda za popravku.
//
// Pokrece se PRIJE bilo kakvog rada sa klijentom na klonu (onboarding korak, pocetak rada u
// terminalu, dijagnostika). Ne zove OLX, ne trosi nista; cita fajlove i stanje masine.
// Radi na macOS i Windows (zato Bun, ne bash; vidi .claude/rules/pogon.md).
//
// Izlaz: checklista OK / FALI / PAZNJA sa komandom uz svaku stavku koja fali.
// Exit kod: 0 kad nista ne FALI (PAZNJA ne obara), 1 inace.
//
// Pokretanje: bun scripts/provjeri-klon.mjs

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ucitajEnvGlobalno, procitajEnv } from "./lib/envfajl.mjs";
import { adminTgIdIzEnva, jednobotniRezim, validanAdminTgId } from "./lib/most.mjs";
import { registrovaniSufiksiPosla } from "./lib/analiza-flote.mjs";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(KORIJEN);
ucitajEnvGlobalno(".env"); // .env se provjerava kao stavka nize

const IME = basename(KORIJEN);
const WIN = process.platform === "win32";
const stavke = [];

function ok(naziv, detalj = "") {
  stavke.push({ status: "OK", naziv, detalj, komanda: "" });
}
function fali(naziv, detalj, komanda) {
  stavke.push({ status: "FALI", naziv, detalj, komanda });
}
function paznja(naziv, detalj, komanda = "") {
  stavke.push({ status: "PAZNJA", naziv, detalj, komanda });
}

function komandaPostoji(ime) {
  try {
    execFileSync(WIN ? "where" : "which", [ime], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// Grupe kojima idu izvjestaji. Namjerno duplirano umjesto uvoza iz dist/core/telegram-grupe.js:
// ova skripta radi i kad build ne postoji (build je tek stavka 5 nize), pa bi uvoz tiho ugasio
// bas ovu provjeru na klonu kojem najvise treba.
function grupeIzAccessa(rt = ".claude-runtime") {
  try {
    const a = JSON.parse(readFileSync(join(rt, "channels", "telegram", "access.json"), "utf8"));
    return Object.keys(a?.groups ?? {}).filter((k) => k.trim().length > 0);
  } catch {
    return [];
  }
}

/** allowFrom (top-level, privatne poruke) iz istog access.json. Prazno kad fajl ili polje ne
 * postoji. Koristi je jednobotna provjera nize: bez ovog ID-a na listi vlasnikova privatna
 * poruka nikad ne prodje `dozvoljena()`, pa se admin grana u ruteru nikad ne pozove. */
function allowFromIzAccessa(rt = ".claude-runtime") {
  try {
    const a = JSON.parse(readFileSync(join(rt, "channels", "telegram", "access.json"), "utf8"));
    return (a?.allowFrom ?? []).map((v) => String(v));
  } catch {
    return [];
  }
}

/** true kad je posao "admin-bot" registrovan na ovoj masini za OVAJ klon (bilo koja platforma).
 * Koristi cistu funkciju iz analiza-flote.mjs umjesto vlastitog regexa: sufiks posla se vec
 * parsira tamo, testirano na oba formata (schtasks CSV, launchctl list). Ako je sama komanda
 * (schtasks/launchctl) nedostupna, vraca false: to je isti "tretiraj nepoznato kao odsutno" duh
 * kao ostatak ove skripte, ne novi FALI izvor. */
function adminBotPosaoRegistrovan() {
  let izlaz = "";
  try {
    izlaz = execFileSync(WIN ? "schtasks" : "launchctl", WIN ? ["/query", "/fo", "csv"] : ["list"], {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    return false;
  }
  return registrovaniSufiksiPosla(izlaz.split("\n"), IME).has("admin-bot");
}

/** Isti split kao `chatIdovi` u src/core/telegram.ts, u tri reda. */
function idoviIzEnva(v) {
  return String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// 0. Verzija i izdanje. Nije provjera nego kontekst za sve ostalo: kad se prijavi problem, prvo
//    pitanje je kojim kodom klon radi. Zato NIKAD ne obara (uvijek ok ili paznja): klon koji radi
//    ne smije biti zaustavljen zato sto git nije u PATH-u ili klon nema tagove.
{
  let verzija = "nepoznata";
  try {
    verzija = JSON.parse(readFileSync(join(KORIJEN, "package.json"), "utf8")).version ?? verzija;
  } catch {
    // package.json bez verzije ili nevaljao: javlja se kao paznja nize
  }

  let izdanje = "";
  if (komandaPostoji("git") && existsSync(join(KORIJEN, ".git"))) {
    try {
      // --always: klon bez `v` tagova vrati kratki sha umjesto da padne. Plitak klon ili klon
      // prije prvog tagiranog izdanja nije greska.
      izdanje = execFileSync("git", ["describe", "--tags", "--always"], {
        cwd: KORIJEN,
        stdio: ["ignore", "pipe", "ignore"],
      })
        .toString()
        .trim();
    } catch {
      // bez commita ili bez tagova: ostaje prazno
    }
  }

  if (verzija === "nepoznata") {
    paznja("Verzija", "package.json ne kaze verziju, pa audit log ne moze reci kojim kodom je radjeno");
  } else if (izdanje) {
    ok("Verzija", `${verzija} (${izdanje})`);
  } else {
    ok("Verzija", `${verzija} (izdanje nepoznato, git ne daje opis)`);
  }
}

// 1. Bun runtime: pogon vozi na Bunu (Telegram plugin ga i inace trazi, .claude/rules/pogon.md),
//    i .env autoload ide kroz njega, ne kroz Node process.loadEnvFile (Bun tu funkciju nema, ali
//    .env iz cwd ucita sam prije nego skripta i krene, izmjereno 15.08.2026).
if (typeof Bun !== "undefined") ok("Bun runtime", Bun.version);
else fali("Bun runtime", "pogon vozi na Bunu, aktivni proces nije Bun", "instaliraj Bun: curl -fsSL https://bun.sh/install | bash");

// 2. claude u PATH-u
if (komandaPostoji("claude")) ok("claude u PATH-u");
else fali("claude u PATH-u", "sesija se ne moze pokrenuti", "instaliraj Claude Code pa ponovo otvori terminal");

// 3. .env i kljucne varijable
if (!existsSync(".env")) {
  fali(".env", "nema konfiguracije klona", `${WIN ? "copy" : "cp"} .env.example .env  # pa popuni OLX_TOKEN i TELEGRAM_*`);
} else {
  ok(".env postoji");
  if (process.env.OLX_TOKEN || (process.env.OLX_USERNAME && process.env.OLX_PASSWORD)) ok("OLX pristup (token ili kredencijali)");
  else fali("OLX pristup", "ni OLX_TOKEN ni OLX_USERNAME/OLX_PASSWORD nisu postavljeni", "upisi OLX_TOKEN u .env");

  // OLX_MCP_PROFILE se ovdje NAMJERNO vise ne provjerava. Klijentski profil vise ne zavisi od te
  // vrijednosti: MCP server sam prepoznaje klijentsku sesiju i tvrdo je suzava. Podrazumijevana
  // vrijednost je od sada `admin`, da goli `claude` u klonu vlasniku da pun alat. Umjesto citanja
  // varijable, nize (tacka 5b, poslije provjere builda) stoji MJERENJE stvarnog ishoda.

  for (const v of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ADMIN_CHAT_ID"]) {
    if (process.env[v]) ok(v);
    else fali(v, "bez ovoga izvjestaji i alarmi tiho ne idu (posao bi sada pao sa greskom)", `upisi ${v} u .env`);
  }

  // TELEGRAM_CHAT_ID vise nije jedini izvor odredista: grupe dolaze iz access.json, a .env je
  // dopuna. Zato je FALI samo kad su OBA prazna, inace bi svaki uredan klon bez .env spiska
  // svako jutro prijavljivao problem koji ne postoji.
  {
    const izAccessa = grupeIzAccessa();
    const izEnva = idoviIzEnva(process.env.TELEGRAM_CHAT_ID);
    const ukupno = new Set([...izAccessa, ...izEnva]).size;
    if (ukupno === 0) {
      fali(
        "Odredista izvjestaja",
        "nema nijedne grupe: ni u access.json ni u TELEGRAM_CHAT_ID, pa dnevni posao pada",
        "bun dist/cli/index.js telegram grupe dodaj <id_grupe>",
      );
    } else {
      ok("Odredista izvjestaja", `${ukupno} (${izAccessa.length} iz access.json, ${izEnva.length} iz .env)`);
    }
    // Id samo u .env znaci da bot u toj grupi NE prima poruke: izvjestaj stize, a klijent pise u
    // prazno. Tiha polovicna postavka, pa se imenuje. Obrnut slucaj vise nije nalaz: grupa iz
    // access.json bez unosa u .env je od sada normalno stanje.
    const samoUEnvu = izEnva.filter((id) => !izAccessa.includes(id));
    if (samoUEnvu.length > 0) {
      paznja(
        "Grupa bez dolaznog pristupa",
        `${samoUEnvu.join(", ")} prima izvjestaj ali nije u access.json, pa bot tu ne odgovara na poruke`,
        `bun dist/cli/index.js telegram grupe dodaj ${samoUEnvu[0]}`,
      );
    }
  }

  if ((process.env.OLX_KLIJENT_AI ?? "pretplata").trim().toLowerCase() === "deepseek") {
    if (process.env.OLX_DEEPSEEK_BASE_URL && process.env.OLX_DEEPSEEK_AUTH_TOKEN) ok("DeepSeek pogon konfigurisan");
    else fali("DeepSeek pogon", "OLX_KLIJENT_AI=deepseek a OLX_DEEPSEEK_* nije popunjen: sesija odbija start", "popuni OLX_DEEPSEEK_BASE_URL i OLX_DEEPSEEK_AUTH_TOKEN u .env");
  }

  // Kanal je eksperimentalna funkcija Claude Code-a i registruje se samo ako smije provjeriti
  // sta je dostupno. CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC tu provjeru gasi, pa poruke sa
  // Telegrama tiho ne dodju u sesiju: nema greske, bot samo ne odgovara. Izmjereno 30.07.2026.
  // (olx-dokumentacija/deepseek-nalazi.md). U .env je fatalno, jer loadEnvFile to daje sesiji.
  {
    const IME = "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC";
    let uEnvFajlu = false;
    try {
      uEnvFajlu = readFileSync(".env", "utf8")
        .split("\n")
        .some((red) => red.trim().startsWith(`${IME}=`) && !red.trim().startsWith("#"));
    } catch {
      // .env je vec provjeren iznad
    }
    if (uEnvFajlu) {
      fali(IME, "postavljen u .env: Telegram kanal se nece registrovati i bot nece odgovarati", `izbrisi red ${IME} iz .env`);
    } else if (process.env[IME]) {
      paznja(IME, "postavljen u okruzenju: gdje god se sesija tako pokrene, Telegram kanal tiho ne radi", `izbrisi ${IME} iz ~/.claude/deepseek.env i shell profila`);
    } else {
      ok("Kanal nije ugasen varijablom okruzenja");
    }
  }

  if (!Number(process.env.OLX_MAX_SPEND_PER_DAY)) {
    paznja("OLX_MAX_SPEND_PER_DAY", "0 znaci BEZ dnevnog plafona kredita", "postavi plafon u .env prije prvog klijenta");
  } else ok("Dnevni plafon kredita", process.env.OLX_MAX_SPEND_PER_DAY);
}

// 4. KLIJENT.md u KORIJENU (ne u klijenti/)
if (existsSync("KLIJENT.md")) ok("KLIJENT.md u korijenu");
else fali("KLIJENT.md", "pogon (AI runda, skillovi) ne zna ko je klijent", `${WIN ? "copy" : "cp"} KLIJENT.primjer.md KLIJENT.md  # pa popuni`);

// 4b. Javni profil klijenta: ulazi u sistemski prompt, pa bot od prve poruke zna ton i footer.
//     Nije obavezan (klon bez njega radi kao prije), ali bez njega bot ne zna nista o klijentu.
if (existsSync("KLIJENT-javno.md")) ok("KLIJENT-javno.md (bot zna ton i footer)");
else paznja("KLIJENT-javno.md", "bot ne zna ton, footer ni granice klijenta", `${WIN ? "copy" : "cp"} KLIJENT-javno.primjer.md KLIJENT-javno.md  # pa popuni`);

// 5. Build postoji i nije stariji od src/
{
  const cli = join("dist", "cli", "index.js");
  if (!existsSync(cli)) {
    fali("Build (dist/)", "nema kompajliranog koda", "bun install && bun run build");
  } else {
    let najnovijiSrc = 0;
    const obidji = (dir) => {
      for (const s of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, s.name);
        if (s.isDirectory()) obidji(p);
        else najnovijiSrc = Math.max(najnovijiSrc, statSync(p).mtimeMs);
      }
    };
    try {
      obidji("src");
    } catch {
      // bez src/ (npr. arhivski klon) poredjenje nema smisla
    }
    if (najnovijiSrc > statSync(cli).mtimeMs) fali("Build svjezina", "src/ je noviji od dist/, pogon vozi stari kod", "bun run build");
    else ok("Build svjez");
  }
}

// 5a. Zavisnosti za slaganje slike na klijentovu pozadinu. Nisu uslov za rad klona (sve ostalo
//     radi i bez njih), pa je ovo paznja a ne fali: bez njih otpada samo recept sa stalnom
//     pozadinom, i to uz jasnu poruku iz slaganjeDostupno(). Provjerava se STVARNO ucitavanje,
//     ne postojanje mape: sharp bez binarnog dijela postoji na disku a puca pri prvom pozivu.
{
  const nedostaje = [];
  for (const paket of ["sharp", "@imgly/background-removal-node"]) {
    try {
      await import(paket);
    } catch {
      nedostaje.push(paket);
    }
  }
  if (nedostaje.length) {
    paznja("Slaganje slike na pozadinu", `nedostaje ${nedostaje.join(", ")}; recept sa stalnom pozadinom nece raditi`, "bun install");
  } else {
    ok("Slaganje slike na pozadinu (sharp + imgly)");
  }
}

// 5b. Klijentski put STVARNO daje klijentski profil.
//
// Mjeri se ishod, ne cita vrijednost iz .env: `.env` od sada podrazumijevano kaze `admin` (da goli
// `claude` u klonu vlasniku da pun alat), pa bi citanje varijable ovdje prijavilo kvar tamo gdje ga
// nema, a pravi kvar (klijentska sesija koja dobije admin alate) ne bi ni primijetilo. Zove se ista
// funkcija koju koristi i MCP server, sa okruzenjem kakvo klijentskoj sesiji pravi
// `okruzenjeSesije` (scripts/lib/sesija.mjs), i to uz NAJGORI slucaj: .env koji kaze admin.
{
  const config = join("dist", "core", "config.js");
  if (!existsSync(config)) {
    paznja("Klijentski profil", "nema dist/core/config.js, provjera preskocena", "bun run build");
  } else {
    try {
      const { odrediMcpProfil } = await import(pathToFileURL(resolve(config)).href);
      const klijentskiPut = {
        OLX_SESIJA_TIP: "klijent",
        CLAUDE_CONFIG_DIR: join(process.cwd(), ".claude-runtime"),
        OLX_MCP_PROFILE: "admin",
      };
      const dobijeno = odrediMcpProfil(klijentskiPut);
      if (dobijeno === "klijent") ok("Klijentski profil (izmjeren, ne procitan iz .env)");
      else {
        fali(
          "Klijentski profil",
          `klijentska sesija bi dobila profil "${dobijeno}": musterija bi vidjela i admin alate`,
          "prijavi ovo odmah, brana u src/core/config.ts (odrediMcpProfil) ne radi",
        );
      }
    } catch (e) {
      paznja("Klijentski profil", `provjera nije mogla da se izvrsi (${e?.message ?? e})`, "bun run build");
    }
  }
}

// 6. Telegram runtime (klijentska sesija)
{
  const rt = ".claude-runtime";
  const tg = join(rt, "channels", "telegram");
  if (!existsSync(rt)) {
    fali("Telegram runtime", "sesija se ne moze pokrenuti bez .claude-runtime", "bun scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>");
  } else if (!existsSync(join(tg, ".env")) || !existsSync(join(tg, "access.json"))) {
    // "Ponovi pripremu" nije izvrsivo: pripremi skripta odbija postojeci runtime.
    fali(
      "Telegram runtime",
      ".claude-runtime postoji ali fali telegram .env ili access.json",
      `obrisi ${rt} pa ponovo: bun scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id> (PAZNJA: brisanje gubi postojeca uparivanja)`,
    );
  } else {
    const grupe = grupeIzAccessa(rt);
    ok("Telegram runtime pripremljen", `${grupe.length} ${grupe.length === 1 ? "grupa" : "grupa"} u access.json`);

    // Token za most (isti OR redoslijed kao ucitajToken() u telegram-most.mjs): glavni .env je vec
    // ucitan u process.env, a pripremi-runtime.mjs pise TELEGRAM_BOT_TOKEN SAMO u runtime .env.
    // Postojanje fajla (provjereno gore) ne znaci da kljuc unutra ima vrijednost, pa se sadrzaj
    // cita eksplicitno umjesto da se pretpostavi.
    const tokenGlavni = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
    const tokenRuntime = (procitajEnv(join(tg, ".env")).TELEGRAM_BOT_TOKEN ?? "").trim();
    if (tokenGlavni || tokenRuntime) {
      ok("Telegram bot token (most)", tokenRuntime ? `u ${tg}/.env` : ".env");
    } else {
      fali(
        "Telegram bot token (most)",
        `nema TELEGRAM_BOT_TOKEN ni u .env ni u ${tg}/.env, most se ne moze pokrenuti`,
        `upisi TELEGRAM_BOT_TOKEN u .env, ili ponovo bun scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>`,
      );
    }
  }

  // Telegram plugin. Pogon (scripts/telegram-most.mjs) ga NE koristi: most govori sa Telegramom
  // direktno preko fetch/sendMessage, mimo `--channels` i mimo plugina. Plugin je potreban jos
  // samo rucnoj probi zive sesije u prvom planu (scripts/pokreni-klijenta.mjs), pa njegovo
  // odsustvo vise ne blokira klon, samo se javlja kao paznja.
  if (existsSync(rt)) {
    // Plugin cache ide PO config diru, ne globalno: klijentska sesija radi sa
    // CLAUDE_CONFIG_DIR=.claude-runtime, pa joj instalacija u ~/.claude ne znaci nista
    // (izmjereno 01.08.2026: prazan config dir javlja "No plugins installed").
    const cache = join(rt, "plugins", "cache", "claude-plugins-official", "telegram");
    let verzija = null;
    try {
      verzija = readdirSync(cache).find((v) => existsSync(join(cache, v, ".mcp.json"))) ?? null;
    } catch {
      // mape nema
    }
    if (verzija) ok("Telegram plugin", `verzija ${verzija} u ${rt}`);
    else {
      // Instalaciju sada rade pripremi skripte same; kad plugin fali, njihova instalacija je
      // pala (najcesce: nema GitHub SSH kljuca za kloniranje marketplacea, ili nema mreze).
      // Komanda za popravku po platformi: prefiks dodjela i && ne postoje u PowerShellu 5.1.
      paznja(
        "Telegram plugin",
        `nije instaliran u ${rt}; pogon (most) radi bez njega, treba jos samo rucnoj probi bun scripts/pokreni-klijenta.mjs; auto instalaciju radi pripremi skripta, pad je najcesce SSH kljuc ili mreza`,
        WIN
          ? `$env:CLAUDE_CONFIG_DIR="${rt}"; claude plugin marketplace add anthropics/claude-plugins-official; claude plugin install telegram@claude-plugins-official`
          : `CLAUDE_CONFIG_DIR=${rt} claude plugin marketplace add anthropics/claude-plugins-official && CLAUDE_CONFIG_DIR=${rt} claude plugin install telegram@claude-plugins-official`,
      );
    }

    // Pogon (scripts/telegram-most.mjs) se pokrece Bunom direktno iz launchd/Task Scheduler
    // posla (nema plugina ni interaktivne sesije izmedju): bez Buna u PATH-u posao ne krene
    // uopste, a greska se ne vidi nigdje osim u logu cron posla.
    if (komandaPostoji("bun")) ok("bun u PATH-u", "pogon (telegram-most.mjs)");
    else
      fali(
        "bun u PATH-u",
        "scripts/telegram-most.mjs se pokrece Bunom iz zakazanog posla, bez njega bot tiho ne odgovara",
        WIN ? 'powershell -c "irm bun.sh/install.ps1 | iex"' : "instaliraj bun: https://bun.sh",
      );

    // Na Windowsu kredencijali pretplate zive u config diru (na macOS-u u Keychainu), pa svaki
    // runtime trazi svoj `claude login`. Bez toga klon prodje preflight a sesija se ne moze
    // autentifikovati. Trag prijave je .credentials.json u config diru; PAZNJA a ne FALI, jer
    // ime fajla nije nas ugovor pa odsustvo ne smije blokirati. DeepSeek klonove ne dira
    // (auth ide kroz OLX_DEEPSEEK_AUTH_TOKEN).
    const klijentAi = (process.env.OLX_KLIJENT_AI ?? "pretplata").trim().toLowerCase();
    if (WIN && klijentAi !== "deepseek") {
      if (existsSync(join(rt, ".credentials.json"))) ok("Prijava pretplate u runtime-u", `trag u ${rt}`);
      else
        paznja(
          "Prijava pretplate u runtime-u",
          `nema traga prijave u ${rt}, pa sesija na pretplati vjerovatno ne moze da se autentifikuje`,
          `$env:CLAUDE_CONFIG_DIR="${rt}" pa claude login (jednom po runtime folderu)`,
        );
    }
  }
}

// 7. Zakazani poslovi
{
  if (WIN) {
    let izlaz = "";
    try {
      izlaz = execFileSync("schtasks", ["/query", "/fo", "csv"], { encoding: "utf8", stdio: "pipe" });
    } catch {
      // schtasks nedostupan
    }
    // Isto brojanje kao macOS grana nize: puki podstring "olx" bi propustio klon kojem fali
    // pola zadataka, jer JEDAN registrovan zadatak vec sadrzi taj tekst. Brojimo redove ciji
    // TaskName sadrzi tacan prefiks "ba.codefactory.olx.<ime>." (deploy/windows/instaliraj-zadatke.ps1
    // gradi imena tako), isto kao sto macOS grana broji retke iz `launchctl list`.
    const prefiksZadatka = `ba.codefactory.olx.${IME}.`.toLowerCase();
    const nasi = izlaz.split("\n").filter((r) => r.toLowerCase().includes(prefiksZadatka));
    // Backup je uslovni posao (isti uslov kao u instaliraj-cron.sh i instaliraj-zadatke.ps1):
    // instalira se samo kad je repo stanja podesen, pa i ocekivani broj zavisi od toga. Admin-bot
    // se u ovaj broj NIKAD ne racuna: u dvobotnom rezimu je uslovan bonus (postojanje
    // .claude-runtime-admin ne cini taj posao obaveznim), a u jednobotnom rezimu
    // (OLX_MOST_ADMIN_TG_ID popunjen) admin-bot kao ODVOJEN posao ne smije ni postojati (isti bot
    // token vozi obje sesije kroz posao "sesija"). Ta grana ima svoju provjeru nize (jednobotna
    // sekcija), ne ovdje.
    const ocekivano = process.env.OLX_STANJE_REPO ? 5 : 4;
    const imena = ocekivano === 5 ? "snapshot, dnevno, sedmicno, sesija, backup" : "snapshot, dnevno, sedmicno, sesija";
    if (nasi.length >= ocekivano) ok("Zakazani poslovi (Task Scheduler)", `${nasi.length} poslova`);
    else if (nasi.length > 0)
      paznja(
        "Zakazani poslovi",
        `samo ${nasi.length} od ocekivanih ${ocekivano}+ (${imena})`,
        "powershell -ExecutionPolicy Bypass -File deploy/windows/instaliraj-zadatke.ps1",
      );
    else
      fali(
        "Zakazani poslovi",
        "nista nije registrovano: nema snapshota, jutarnje poruke ni mosta",
        "powershell -ExecutionPolicy Bypass -File deploy/windows/instaliraj-zadatke.ps1",
      );
  } else {
    let izlaz = "";
    try {
      izlaz = execFileSync("launchctl", ["list"], { encoding: "utf8", stdio: "pipe" });
    } catch {
      // launchctl nedostupan (linux?)
    }
    const nasi = izlaz.split("\n").filter((r) => r.includes(`ba.codefactory.olx.${IME}.`));
    // Backup je uslovni posao: instalira se samo kad je repo stanja podesen, pa i ocekivani broj
    // zavisi od toga. Fiksna 4 bi tvrdila da je sve u redu na klonu kojem backup nedostaje.
    // Admin-bot se ovdje NIKAD ne racuna, ni u dvobotnom (uslovan bonus) ni u jednobotnom rezimu
    // (u jednobotnom taj posao kao ODVOJEN proces ne smije ni postojati), isti razlog kao u
    // Windows grani iznad.
    const ocekivano = process.env.OLX_STANJE_REPO ? 5 : 4;
    const imena = ocekivano === 5 ? "snapshot, dnevno, sedmicno, sesija, backup" : "snapshot, dnevno, sedmicno, sesija";
    if (nasi.length >= ocekivano) ok("Zakazani poslovi (launchd)", `${nasi.length} poslova`);
    else if (nasi.length > 0) paznja("Zakazani poslovi", `samo ${nasi.length} od ocekivanih ${ocekivano}+ (${imena})`, "scripts/instaliraj-cron.sh");
    else fali("Zakazani poslovi", "nista nije instalirano: nema snapshota, jutarnje poruke ni mosta", "scripts/instaliraj-cron.sh");
  }
}

// 8. Most radi (scripts/telegram-most.mjs, PID brava po ulozi)
//    Dvobotni rezim (default): DVA odvojena procesa, bun scripts/telegram-most.mjs (klijentski) i
//    bun scripts/telegram-most.mjs admin-bot (admin), svaki sa svojim PID fajlom. Instalira ih
//    korak zakazanih poslova (sekcija 7), pa je PAZNJA ovdje normalna na svjeze podignutoj masini
//    ili prije prve instalacije, ne blokira klon.
//    Jednobotni rezim (OLX_MOST_ADMIN_TG_ID popunjen): JEDAN proces (posao "sesija") nosi obje
//    zive sesije rutiranjem po poruci, pa admin most kao ODVOJEN proces ovdje uopste ne postoji i
//    ne provjerava se (vidi jednobotnu sekciju nize).
function provjeriMost(naziv, pidIme) {
  const pidFajl = join(".olx-pik", pidIme);
  let radi = false;
  try {
    const pid = Number(readFileSync(pidFajl, "utf8").trim());
    process.kill(pid, 0);
    radi = true;
  } catch {
    // nema fajla ili proces mrtav
  }
  const uputa =
    "pogon je scripts/instaliraj-cron.sh (macOS) odnosno deploy\\windows\\instaliraj-zadatke.ps1 (Windows); " +
    "rucna proba u prvom planu (obradi sto ceka pa izadje): bun scripts/telegram-most.mjs --jednom";
  if (radi) ok(naziv);
  else paznja(naziv, "ne radi (normalno ako poslovi jos nisu instalirani ili je masina svjeze podignuta)", uputa);
}
provjeriMost("Most radi", "most.pid");
// Admin most je opcion po klonu (isto uslovljavanje kao u scripts/instaliraj-cron.sh): stavka se
// prikazuje samo kad ovaj klon uopste ima admin runtime, inace bi svaki klijentski klon bez admin
// bota trajno prikazivao paznju za nesto sto tom klonu i ne treba.
if (existsSync(".claude-runtime-admin") && !jednobotniRezim(process.env)) {
  provjeriMost("Admin most radi", "most-admin.pid");
}

// 9. Snapshot svjezina (temelj mjerenja pregleda)
{
  const dir = join(".olx-pik", "snapshots");
  let zadnji = 0;
  try {
    for (const f of readdirSync(dir)) {
      if (f.startsWith("views-")) zadnji = Math.max(zadnji, statSync(join(dir, f)).mtimeMs);
    }
  } catch {
    // jos nema snapshota
  }
  if (!zadnji) paznja("Dnevni snapshot", "jos nijedan: mjerenje pregleda i izdvajanja ne moze poceti", "bun dist/cli/index.js stats snapshot");
  else if (Date.now() - zadnji > 48 * 60 * 60 * 1000) paznja("Dnevni snapshot", `zadnji je stariji od 48h (${new Date(zadnji).toISOString().slice(0, 10)})`, "provjeri posao snapshot; rucno: bun dist/cli/index.js stats snapshot");
  else ok("Dnevni snapshot svjez");
}

// 10. Backup stanja (jedina kopija van ove masine)
{
  if (!process.env.OLX_STANJE_REPO) {
    paznja("Backup stanja", "nije podesen: pamcenje, izuzeca i snapshoti postoje SAMO na ovom disku", "popuni OLX_KLIJENT i OLX_STANJE_REPO u .env, pa scripts/instaliraj-cron.sh");
  } else {
    const log = join(".olx-pik", "cron-backup.log");
    let zadnji = 0;
    try {
      zadnji = statSync(log).mtimeMs;
    } catch {
      // posao jos nije radio
    }
    if (!zadnji) paznja("Backup stanja", "podesen, ali jos nijednom nije radio", "bun dist/cli/index.js posao backup --suho  # pa bez --suho");
    else if (Date.now() - zadnji > 48 * 60 * 60 * 1000) paznja("Backup stanja", `zadnji je stariji od 48h (${new Date(zadnji).toISOString().slice(0, 10)})`, "provjeri posao backup; rucno: bun dist/cli/index.js posao backup");
    else ok("Backup stanja svjez");
  }
}

// 11. Jednobotni rezim (OLX_MOST_ADMIN_TG_ID popunjen u .env): jedan bot token vozi i klijentsku
//     i admin zivu sesiju, rutiranjem po poruci (vidi scripts/lib/most.mjs). Ovaj blok se
//     prikazuje SAMO kad je rezim ukljucen; dvobotni klon (podrazumijevano, varijabla prazna) ga
//     uopste ne vidi.
if (jednobotniRezim(process.env)) {
  const adminId = adminTgIdIzEnva(process.env);

  // ID se ispisuje u DETALJU svake stavke ove sekcije namjerno: pogresno upisan ID bi tudjoj
  // osobi u privatnom razgovoru dao admin alate, pa mora biti vidljiv pri svakoj provjeri klona.
  if (validanAdminTgId(adminId)) {
    ok("Jednobotni rezim: OLX_MOST_ADMIN_TG_ID", `${adminId} (mora biti pozitivan licni Telegram ID vlasnika)`);
  } else {
    fali(
      "Jednobotni rezim: OLX_MOST_ADMIN_TG_ID",
      `vrijednost "${adminId}" nije validan Telegram ID; mora biti pozitivan cio broj, negativan izgleda kao ID grupe`,
      "upisi ispravan licni Telegram ID vlasnika u OLX_MOST_ADMIN_TG_ID (.env)",
    );
  }

  if (existsSync(".claude-runtime-admin")) {
    ok("Jednobotni rezim: admin runtime postoji", `.claude-runtime-admin (ID iz .env: ${adminId})`);
  } else {
    fali(
      "Jednobotni rezim: admin runtime",
      `nema .claude-runtime-admin (nosi prompt i profil admin sesije za ID ${adminId})`,
      `bun scripts/pripremi-admin-runtime.mjs --bez-bota ${adminId || "<id>"}`,
    );
  }

  if (validanAdminTgId(adminId)) {
    const dozvoljeni = allowFromIzAccessa();
    if (dozvoljeni.includes(adminId)) {
      ok("Jednobotni rezim: vlasnik na allowFrom listi", `${adminId} u .claude-runtime/channels/telegram/access.json`);
    } else {
      fali(
        "Jednobotni rezim: vlasnik na allowFrom listi",
        `${adminId} nije u allowFrom u .claude-runtime/channels/telegram/access.json: privatna poruka ne prolazi ` +
          `dozvoljena(), admin grana se nikad ne pozove i vlasnik dobija TISINU bez ijedne poruke greske`,
        `rucno dodaj ${adminId} u allowFrom u .claude-runtime/channels/telegram/access.json (pripremi-runtime.mjs odbija rad na postojecem runtime-u)`,
      );
    }
  }

  // Dva getUpdates konzumera na istom bot tokenu daju 409 Conflict, pa admin-bot NE SMIJE biti
  // registrovan kao odvojen posao dok je jednobotni rezim ukljucen.
  if (adminBotPosaoRegistrovan()) {
    fali(
      "Jednobotni rezim: posao admin-bot NE SMIJE postojati",
      "admin-bot je i dalje registrovan kao odvojen posao: dva getUpdates konzumera na istom bot tokenu daju 409 Conflict",
      WIN ? "powershell -ExecutionPolicy Bypass -File deploy\\windows\\instaliraj-zadatke.ps1" : "scripts/instaliraj-cron.sh",
    );
  } else {
    ok("Jednobotni rezim: posao admin-bot nije registrovan (ocekivano)");
  }
}

// ---- ispis ----
const sirina = Math.max(...stavke.map((s) => s.naziv.length));
let brojFali = 0;
for (const s of stavke) {
  if (s.status === "FALI") brojFali += 1;
  const oznaka = s.status === "OK" ? "  OK  " : s.status === "FALI" ? " FALI " : "PAZNJA";
  console.log(`[${oznaka}] ${s.naziv.padEnd(sirina)}  ${s.detalj}`);
  if (s.komanda) console.log(`${" ".repeat(9 + sirina)}  -> ${s.komanda}`);
}
console.log("");
if (brojFali > 0) {
  console.log(`Klon "${IME}" NIJE spreman za klijenta: ${brojFali} stavki fali (redoslijed popravki odozgo).`);
  process.exit(1);
}
console.log(`Klon "${IME}" je spreman.` + (stavke.some((s) => s.status === "PAZNJA") ? " Ima stavki za paznju, vidi iznad." : ""));
