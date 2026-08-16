// Testovi zajednicke logike pokretanja sesije. Cuvaju ugovor iz pogon.md: argv i AI mapiranje
// zive samo u sesija.mjs, pa svako razilazenje pokretaca pada ovdje, ne kod klijenta.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ANTHROPIC_VARIJABLE, aiPogon, claudeArgv, okruzenjeSesije, stazeSesije, zaCmd } from "./sesija.mjs";

test("aiPogon: pretplata je default i ne dira nista", () => {
  const r = aiPogon(false, {});
  assert.equal(r.ok, true);
  assert.equal(r.pogon, "pretplata");
  assert.deepEqual(r.env, {});
  assert.deepEqual(r.obrisi, []);
});

test("aiPogon: izbor ne zavisi od velikih slova i razmaka", () => {
  const r = aiPogon(false, { OLX_KLIJENT_AI: "  DeepSeek " });
  assert.equal(r.pogon, "deepseek");
});

test("aiPogon: deepseek bez varijabli NE pokrece sesiju", () => {
  const r = aiPogon(false, { OLX_KLIJENT_AI: "deepseek" });
  assert.equal(r.ok, false);
  assert.match(r.poruka, /OLX_DEEPSEEK_BASE_URL ili OLX_DEEPSEEK_AUTH_TOKEN/);
});

test("aiPogon: deepseek mapira OLX_DEEPSEEK_* u ANTHROPIC_*, brise API_KEY i ODBIJA pro model", () => {
  const r = aiPogon(false, {
    OLX_KLIJENT_AI: "deepseek",
    OLX_DEEPSEEK_BASE_URL: "https://api.deepseek.com/anthropic",
    OLX_DEEPSEEK_AUTH_TOKEN: "tajna",
    // Pro modeli su iskljuceni potpuno (odluka vlasnika 04.08.2026: nenamjeran pro je kostao
    // 1.68 USD u jednom danu): ime sa segmentom "pro" pada na flash default.
    OLX_DEEPSEEK_MODEL: "deepseek-v4-pro",
    OLX_DEEPSEEK_HAIKU_MODEL: "deepseek-v4-flash",
    OLX_DEEPSEEK_TIMEOUT_MS: "600000",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.env, {
    ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    ANTHROPIC_AUTH_TOKEN: "tajna",
    ANTHROPIC_MODEL: "deepseek-v4-flash",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
    API_TIMEOUT_MS: "600000",
  });
  // API odbija zahtjev kad su AUTH_TOKEN i API_KEY postavljeni istovremeno.
  assert.deepEqual(r.obrisi, ["ANTHROPIC_API_KEY"]);
});

test("aiPogon: bez OLX_DEEPSEEK_MODEL default je flash, uvijek", () => {
  // Odluka vlasnika 04.08.2026. Bez fallbacka bi endpoint Claude ime `claude-opus-5` mapirao
  // na pro, pa bi izostavljena varijabla tiho znacila skuplji model.
  const r = aiPogon(false, {
    OLX_KLIJENT_AI: "deepseek",
    OLX_DEEPSEEK_BASE_URL: "https://api.deepseek.com/anthropic",
    OLX_DEEPSEEK_AUTH_TOKEN: "tajna",
  });
  assert.equal(r.ok, true);
  assert.equal(r.env.ANTHROPIC_MODEL, "deepseek-v4-flash");
  assert.equal(r.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "deepseek-v4-flash");
});

test("aiPogon: admin uvijek pretplata i brise sve ANTHROPIC varijable", () => {
  const r = aiPogon(true, { OLX_KLIJENT_AI: "deepseek", OLX_DEEPSEEK_BASE_URL: "x", OLX_DEEPSEEK_AUTH_TOKEN: "y" });
  assert.equal(r.pogon, "pretplata");
  assert.deepEqual(r.obrisi, ANTHROPIC_VARIJABLE);
});

test("claudeArgv: tacan redoslijed flagova i prosljedjivanje dodatnih", () => {
  assert.deepEqual(claudeArgv("/tmp/prompt.md", ["--resume"]), [
    "--channels", "plugin:telegram@claude-plugins-official",
    "--append-system-prompt-file", "/tmp/prompt.md",
    "--setting-sources", "user,project",
    "--resume",
  ]);
});

test("stazeSesije: klijent i admin-bot idu u razlicite runtime foldere", () => {
  const k = stazeSesije("klijent", "/klon");
  const a = stazeSesije("admin-bot", "/klon");
  assert.equal(k.jeAdmin, false);
  assert.equal(a.jeAdmin, true);
  assert.match(k.runtime, /\.claude-runtime$/);
  assert.match(a.runtime, /\.claude-runtime-admin$/);
  assert.equal(k.mcpProfil, "klijent");
  assert.equal(a.mcpProfil, "admin");
  assert.equal(k.promptFajl, "runtime/SISTEM-klijent.md");
  assert.equal(a.promptFajl, "runtime/SISTEM-admin-bot.md");
});

test("zaCmd: obican argument ostaje netaknut, razmak i navodnik se quotuju", () => {
  assert.equal(zaCmd("--channels"), "--channels");
  assert.equal(zaCmd("plugin:telegram@claude-plugins-official"), "plugin:telegram@claude-plugins-official");
  assert.equal(zaCmd("C:\\Klon Sa Razmakom\\prompt.md"), '"C:\\Klon Sa Razmakom\\prompt.md"');
  assert.equal(zaCmd('a"b'), '"a\\"b"');
  assert.equal(zaCmd("a&b"), '"a&b"');
});

// ---- okruzenjeSesije ----

test("okruzenjeSesije: mcpProfil klijent postavlja OLX_SESIJA_TIP na klijent", () => {
  const r = okruzenjeSesije({
    osnova: {},
    aiEnv: {},
    obrisi: [],
    runtime: "/klon/.claude-runtime",
    telegramDir: "/klon/.claude-runtime/channels/telegram",
    mcpProfil: "klijent",
  });
  assert.equal(r.OLX_SESIJA_TIP, "klijent");
});

test("okruzenjeSesije: mcpProfil admin postavlja OLX_SESIJA_TIP na admin-bot", () => {
  const r = okruzenjeSesije({
    osnova: {},
    aiEnv: {},
    obrisi: [],
    runtime: "/klon/.claude-runtime-admin",
    telegramDir: "/klon/.claude-runtime-admin/channels/telegram",
    mcpProfil: "admin",
  });
  assert.equal(r.OLX_SESIJA_TIP, "admin-bot");
});

test("okruzenjeSesije: postavlja CLAUDE_CONFIG_DIR, TELEGRAM_STATE_DIR i OLX_MCP_PROFILE iz argumenata", () => {
  const r = okruzenjeSesije({
    osnova: {},
    aiEnv: {},
    obrisi: [],
    runtime: "/klon/.claude-runtime",
    telegramDir: "/klon/.claude-runtime/channels/telegram",
    mcpProfil: "klijent",
  });
  assert.equal(r.CLAUDE_CONFIG_DIR, "/klon/.claude-runtime");
  assert.equal(r.TELEGRAM_STATE_DIR, "/klon/.claude-runtime/channels/telegram");
  assert.equal(r.OLX_MCP_PROFILE, "klijent");
});

test("okruzenjeSesije: obrisi uklanja kljuceve iz osnove", () => {
  const r = okruzenjeSesije({
    osnova: { ANTHROPIC_API_KEY: "tajna", DRUGO: "ostaje" },
    aiEnv: {},
    obrisi: ["ANTHROPIC_API_KEY"],
    runtime: "/klon/.claude-runtime",
    telegramDir: "/klon/.claude-runtime/channels/telegram",
    mcpProfil: "klijent",
  });
  assert.equal("ANTHROPIC_API_KEY" in r, false);
  assert.equal(r.DRUGO, "ostaje");
});

test("okruzenjeSesije: aiEnv nadjacava istoimeni kljuc iz osnove", () => {
  const r = okruzenjeSesije({
    osnova: { ANTHROPIC_MODEL: "staro" },
    aiEnv: { ANTHROPIC_MODEL: "novo" },
    obrisi: [],
    runtime: "/klon/.claude-runtime",
    telegramDir: "/klon/.claude-runtime/channels/telegram",
    mcpProfil: "klijent",
  });
  assert.equal(r.ANTHROPIC_MODEL, "novo");
});

test("okruzenjeSesije: ne mijenja proslijedjeni osnova objekat", () => {
  const osnova = { ANTHROPIC_API_KEY: "tajna", NESTO: "1" };
  const kopija = { ...osnova };
  okruzenjeSesije({
    osnova,
    aiEnv: { ANTHROPIC_MODEL: "novo" },
    obrisi: ["ANTHROPIC_API_KEY"],
    runtime: "/klon/.claude-runtime",
    telegramDir: "/klon/.claude-runtime/channels/telegram",
    mcpProfil: "klijent",
  });
  assert.deepEqual(osnova, kopija);
});
