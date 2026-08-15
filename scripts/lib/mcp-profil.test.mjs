// Profil MCP servera nad ZIVIM serverom, ne nad cistom funkcijom.
//
// `src/core/config.test.ts` vec pokriva pravilo odlucivanja (odrediMcpProfil) u izolaciji. Ovdje se
// dokazuje ono sto ta provjera ne moze: da se odluka stvarno vidi u broju REGISTROVANIH alata, jer
// se registracija dogadja pri uvozu modula i zavisi od okruzenja procesa. Zato se server pokrece
// kao pravo dijete i pita preko JSON-RPC-a, isto kao sto to radi scripts/kontekst-izvjestaj.mjs.

import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const KORIJEN = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER = join(KORIJEN, "dist", "mcp", "server.js");

/** Alati koje server prijavi za zadano okruzenje. Prazna vrijednost gasi nasljedjenu varijablu. */
function alatiZaOkruzenje(dodatno) {
  return new Promise((resolve_) => {
    // Cist start: oznake sesije i profil NIKAD se ne nasljedjuju iz ljuske u kojoj testovi rade,
    // inace bi rezultat zavisio od toga ko je i odakle pokrenuo `bun run test`.
    const env = {
      ...process.env,
      OLX_SESIJA_TIP: "",
      CLAUDE_CONFIG_DIR: "",
      OLX_MCP_PROFILE: "",
      OLX_TOKEN: "test-token",
      ...dodatno,
    };
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "ignore"], env, cwd: KORIJEN });
    let bafer = "";
    let gotovo = false;
    const zavrsi = (vrijednost) => {
      if (gotovo) return;
      gotovo = true;
      clearTimeout(krov);
      child.kill();
      resolve_(vrijednost);
    };
    const posalji = (poruka) => child.stdin.write(`${JSON.stringify(poruka)}\n`);

    child.stdout.on("data", (komad) => {
      bafer += komad.toString();
      let prelom;
      while ((prelom = bafer.indexOf("\n")) !== -1) {
        const red = bafer.slice(0, prelom).trim();
        bafer = bafer.slice(prelom + 1);
        if (!red) continue;
        let poruka;
        try {
          poruka = JSON.parse(red);
        } catch {
          continue;
        }
        if (poruka.id === 2) zavrsi(poruka.result?.tools?.map((a) => a.name) ?? []);
      }
    });
    child.on("error", () => zavrsi([]));

    const krov = setTimeout(() => zavrsi([]), 20000);
    posalji({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    posalji({ jsonrpc: "2.0", method: "notifications/initialized" });
    posalji({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  });
}

/**
 * Poziva jedan alat i vraca sirov `result`. Odvojeno od `alatiZaOkruzenje` jer brana na tudji nalog
 * nije vidljiva u popisu alata: alat OSTAJE registrovan, samo odbija poziv sa `user`.
 */
function pozoviAlat(dodatno, ime, argumenti) {
  return new Promise((resolve_) => {
    const env = {
      ...process.env,
      OLX_SESIJA_TIP: "",
      CLAUDE_CONFIG_DIR: "",
      OLX_MCP_PROFILE: "",
      OLX_TOKEN: "test-token",
      ...dodatno,
    };
    const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "ignore"], env, cwd: KORIJEN });
    let bafer = "";
    let gotovo = false;
    const zavrsi = (vrijednost) => {
      if (gotovo) return;
      gotovo = true;
      clearTimeout(krov);
      child.kill();
      resolve_(vrijednost);
    };
    const posalji = (poruka) => child.stdin.write(`${JSON.stringify(poruka)}\n`);

    child.stdout.on("data", (komad) => {
      bafer += komad.toString();
      let prelom;
      while ((prelom = bafer.indexOf("\n")) !== -1) {
        const red = bafer.slice(0, prelom).trim();
        bafer = bafer.slice(prelom + 1);
        if (!red) continue;
        let poruka;
        try {
          poruka = JSON.parse(red);
        } catch {
          continue;
        }
        if (poruka.id === 3) zavrsi(poruka.result ?? { greska: poruka.error });
      }
    });
    child.on("error", () => zavrsi(null));
    const krov = setTimeout(() => zavrsi(null), 20000);
    posalji({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    posalji({ jsonrpc: "2.0", method: "notifications/initialized" });
    posalji({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: ime, arguments: argumenti } });
  });
}

if (!existsSync(SERVER)) {
  test("MCP profil: build nedostaje", () => {
    assert.fail(`Nema ${SERVER}. Pokreni bun run build prije testova.`);
  });
} else {
  test("bez oznake klijentskog runtimea server daje pun admin popis", async () => {
    const alati = await alatiZaOkruzenje({});
    assert.ok(alati.length > 0, "server nije prijavio nijedan alat");
    assert.ok(alati.includes("olx_find_category"), "admin popis mora nositi olx_find_category");
    assert.ok(alati.includes("olx_categories"), "admin popis mora nositi olx_categories");
  });

  test("BRANA: klijentski runtime suzava popis i kad .env kaze admin", async () => {
    // Ovo je najvazniji test cijele izmjene. Podrazumijevana vrijednost u .env se okrece na admin,
    // pa klijentski put NE SMIJE zavisiti od nje. Provjeravaju se OBJE oznake, svaka sama za sebe.
    const admin = await alatiZaOkruzenje({});

    for (const oznaka of [{ OLX_SESIJA_TIP: "klijent" }, { CLAUDE_CONFIG_DIR: join(KORIJEN, ".claude-runtime") }]) {
      const klijent = await alatiZaOkruzenje({ ...oznaka, OLX_MCP_PROFILE: "admin" });
      assert.ok(klijent.length > 0, "klijentski popis je prazan");
      assert.ok(
        klijent.length < admin.length,
        `klijentski popis (${klijent.length}) mora biti uzi od admin popisa (${admin.length})`,
      );
      for (const zabranjen of ["olx_find_category", "olx_categories", "olx_category_children", "olx_limit_slika"]) {
        assert.equal(klijent.includes(zabranjen), false, `${zabranjen} ne smije biti registrovan klijentu`);
      }
    }
  });

  test("admin bot runtime dobija pun admin popis", async () => {
    // .claude-runtime-admin pocinje istim nizom znakova kao klijentski runtime, pa bi popustljivo
    // poredjenje putanje admin bota tiho svelo na klijentske alate.
    const admin = await alatiZaOkruzenje({});
    const adminBot = await alatiZaOkruzenje({ CLAUDE_CONFIG_DIR: join(KORIJEN, ".claude-runtime-admin") });
    assert.deepEqual(adminBot.sort(), admin.sort());
  });

  test("klijentu nije registrovan nijedan alat za konkurenciju", async () => {
    // Konkurencija nije dio klijentskog paketa. Prompt to kaze covjeku, ali prompt se moze zaobici
    // formulacijom; alat kojeg nema ne moze se pozvati nikako.
    const klijent = await alatiZaOkruzenje({ OLX_SESIJA_TIP: "klijent", OLX_MCP_PROFILE: "admin" });
    assert.ok(klijent.length > 0, "klijentski popis je prazan");
    for (const zabranjen of ["olx_competitor_report", "olx_user_profile"]) {
      assert.equal(klijent.includes(zabranjen), false, `${zabranjen} ne smije biti registrovan klijentu`);
    }
    // Kontrola u drugom smjeru: admin ih zadrzava u cjelini, ovo je suzavanje a ne brisanje.
    const admin = await alatiZaOkruzenje({});
    for (const zadrzan of ["olx_competitor_report", "olx_user_profile"]) {
      assert.ok(admin.includes(zadrzan), `${zadrzan} mora ostati adminu`);
    }
  });

  test("klijentu se poziv sa tudjim nalogom odbija, uz uputu sta umjesto toga", async () => {
    // Drugi ulaz u istu stvar: alat ostaje registrovan jer klijentu treba za VLASTITI katalog, pa
    // brana mora stajati u pozivu. Odbija se cim je user zadan, bez poredjenja sa vlastitim nalogom.
    for (const alat of ["olx_list_listings", "olx_refresh_bulk"]) {
      const rezultat = await pozoviAlat({ OLX_SESIJA_TIP: "klijent" }, alat, { user: "neki-tudji-shop" });
      assert.ok(rezultat, `${alat}: nema odgovora`);
      assert.equal(rezultat.isError, true, `${alat}: poziv sa tudjim user-om mora biti greska`);
      const tekst = rezultat.content?.map((d) => d.text).join(" ") ?? "";
      assert.match(tekst, /izostavi user/i, `${alat}: poruka mora reci da se user izostavi`);
    }
  });

  test("izricit tip sesije je jaci od zaostale putanje u okruzenju", async () => {
    // Alati za mjerenje zadaju tip izricito; zaostao CLAUDE_CONFIG_DIR ih ne smije preusmjeriti.
    const admin = await alatiZaOkruzenje({});
    const mjereno = await alatiZaOkruzenje({
      OLX_SESIJA_TIP: "admin-bot",
      CLAUDE_CONFIG_DIR: join(KORIJEN, ".claude-runtime"),
    });
    assert.deepEqual(mjereno.sort(), admin.sort());
  });
}
