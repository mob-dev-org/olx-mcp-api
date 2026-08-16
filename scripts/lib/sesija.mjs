// Zajednicka logika pokretanja Claude sesije (klijent i admin-bot): staze, provjere, AI
// mapiranje, sastavljanje prompta, argv i spawn. Jedno mjesto istine koje koriste
// scripts/cuvar-sesije.mjs (pogon na obje platforme) i scripts/pokreni-klijenta.mjs (rucni
// launcher), pa se pokretaci ne mogu raziici. Ranije je isti kod zivio u dvije kopije, uz
// ugovor "kad se mijenja jedno, mijenja se i drugo", i vec se jednom razisao (bash je citao
// .env grepom bez toLowerCase, pa je OLX_KLIJENT_AI=DeepSeek tiho padao na pretplatu).
//
// Modul ne dira process.env: sve cita iz parametara i vraca vrijednosti, da nijedan pozivalac
// ne preusmjeri neki drugi proces (isti princip kao scripts/lib/envfajl.mjs).

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const ANTHROPIC_VARIJABLE = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_CUSTOM_MODEL_OPTION",
];

// Staze i identitet tipa sesije. PID fajlovi ostaju u cuvaru: launcher ih nema.
export function stazeSesije(tip, korijen) {
  const jeAdmin = tip === "admin-bot";
  const runtime = join(korijen, jeAdmin ? ".claude-runtime-admin" : ".claude-runtime");
  const telegramDir = join(runtime, "channels", "telegram");
  return {
    jeAdmin,
    runtime,
    telegramDir,
    inbox: join(telegramDir, "inbox"),
    promptFajl: jeAdmin ? "runtime/SISTEM-admin-bot.md" : "runtime/SISTEM-klijent.md",
    mcpProfil: jeAdmin ? "admin" : "klijent",
  };
}

// Provjere prije starta. Vraca poruke umjesto da exituje, da svaki pozivalac zadrzi svoje
// ponasanje na gresku (cuvar i launcher izlaze sa kodom 1, ali launcher prije toga jos builda).
export function provjeriPreduslove(tip, korijen, env) {
  const { jeAdmin, runtime } = stazeSesije(tip, korijen);
  const greske = [];
  const upozorenja = [];
  if (!existsSync(runtime)) {
    greske.push(
      jeAdmin
        ? `Nema ${runtime}. Pokreni prvo: bun scripts/pripremi-admin-runtime.mjs <bot_token> <admin_telegram_id> [id_grupe]`
        : `Nema ${runtime}. Pokreni prvo: bun scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>`,
    );
  }
  if (!existsSync(join(korijen, ".env"))) {
    greske.push(`Nema .env u ${korijen}. Kopiraj .env.example i postavi OLX_TOKEN.`);
  }
  // Ranije je ovdje stajalo upozorenje da ce klijent vidjeti admin alate ako .env ne kaze
  // `klijent`. To vise nije tacno: klijentsku sesiju MCP server prepoznaje sam, po OLX_SESIJA_TIP
  // odnosno po runtime mapi, i tvrdo je suzava bez obzira na .env (odrediMcpProfil,
  // src/core/config.ts). Podrazumijevana vrijednost u .env je od sada `admin`, da goli `claude` u
  // klonu daje pun alat vlasniku.
  //
  // Upozorenje se zato okrece: sada je vrijedno javiti SUPROTAN slucaj, kad .env tvrdi `klijent`
  // za ADMIN bota, jer tu .env stvarno suzava i admin bi tiho ostao bez svojih alata. Klijentski
  // smjer se ne provjerava jer ga .env vise ne moze pokvariti.
  if (jeAdmin && (env.OLX_MCP_PROFILE ?? "").trim().toLowerCase() === "klijent") {
    upozorenja.push("Upozorenje: OLX_MCP_PROFILE je klijent u .env. Admin bot ce ostati bez admin alata.");
  }
  return { greske, upozorenja };
}

// AI pogon sesije. Vraca { ok, env, obrisi, pogon, poruka }. Cita iz parametra env (po pravilu
// process.env poslije loadEnvFile), nista ne mijenja.
export function aiPogon(jeAdmin, env) {
  if (jeAdmin) {
    // Admin bot je vlasnikov kanal i ide iskljucivo na pretplatu. Sve ANTHROPIC_* se brise
    // da naslijedjen export sa masine ne moze tiho preusmjeriti sesiju.
    return { ok: true, env: {}, obrisi: ANTHROPIC_VARIJABLE, pogon: "pretplata" };
  }
  const izbor = (env.OLX_KLIJENT_AI ?? "pretplata").trim().toLowerCase();
  if (izbor !== "deepseek") {
    // Danasnje ponasanje, nista se ne dira. Faza testiranja prvih klijenata ide na pretplati.
    return { ok: true, env: {}, obrisi: [], pogon: "pretplata" };
  }
  const baseUrl = env.OLX_DEEPSEEK_BASE_URL;
  const token = env.OLX_DEEPSEEK_AUTH_TOKEN;
  if (!baseUrl || !token) {
    return {
      ok: false,
      pogon: "deepseek",
      poruka: "OLX_KLIJENT_AI=deepseek, a OLX_DEEPSEEK_BASE_URL ili OLX_DEEPSEEK_AUTH_TOKEN nije popunjen u .env.",
    };
  }
  const izlaz = { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: token };
  // Default modela je flash, uvijek (odluka vlasnika 04.08.2026, cijena). Bez fallbacka bi
  // sesija poslala Claude ime modela, a endpoint `claude-opus-5` mapira na pro, pa bi
  // izostavljena varijabla tiho znacila skuplji model. Pro ostaje izbor po klijentu kroz
  // OLX_DEEPSEEK_MODEL; sta se time gubi pise u deepseek-nalazi.md.
  izlaz.ANTHROPIC_MODEL = env.OLX_DEEPSEEK_MODEL || "deepseek-v4-flash";
  izlaz.ANTHROPIC_DEFAULT_HAIKU_MODEL = env.OLX_DEEPSEEK_HAIKU_MODEL || "deepseek-v4-flash";
  if (env.OLX_DEEPSEEK_TIMEOUT_MS) izlaz.API_TIMEOUT_MS = env.OLX_DEEPSEEK_TIMEOUT_MS;
  // API odbija zahtjev kad su AUTH_TOKEN i API_KEY postavljeni istovremeno.
  return { ok: true, env: izlaz, obrisi: ["ANTHROPIC_API_KEY"], pogon: "deepseek" };
}

/**
 * Sastavi prompt sesije: pravila razgovora + profil klijenta + pamcenje u JEDAN fajl.
 *
 * Zasto sastavljanje a ne dva fajla: `--append-system-prompt-file` nije aditivan, sa dva fajla
 * vazi samo zadnji (izmjereno 30.07.2026). Radi se pri SVAKOM pokretanju, pa nocni restart sam
 * osvjezi pamcenje bez ijednog poziva alata.
 *
 * Kad sastavljanje padne, vraca se na gola pravila: bot bez pamcenja je bolji od mrtvog bota.
 * `log` je callback da cuvar zadrzi svoj format loga a launcher obican console.error.
 */
export function sastaviPrompt(tip, korijen, log) {
  const { jeAdmin, promptFajl } = stazeSesije(tip, korijen);
  const r = spawnSync(process.execPath, ["scripts/sastavi-prompt.mjs", jeAdmin ? "admin-bot" : "klijent"], {
    cwd: korijen,
    encoding: "utf8",
  });
  if (r.status === 0) {
    // Na stdout ide samo putanja; stderr nosi eventualna upozorenja i ne smije je zagaditi.
    const putanja = (r.stdout ?? "").trim().split("\n").pop() ?? "";
    if (putanja && existsSync(putanja)) return putanja;
  }
  const zasto = r.error ? r.error.message : (r.stderr ?? "").trim().split("\n").pop() || `kod ${r.status}`;
  log(`Sastavljanje prompta nije proslo (${zasto}), idem na ${promptFajl} bez pamcenja.`);
  return promptFajl;
}

// Argv za claude. `--setting-sources` mora ukljucivati user: pod CLAUDE_CONFIG_DIR to je
// settings.json runtime foldera, gdje su permissions.deny i ugaseni plugini za klijenta.
// Bez `--strict-mcp-config` namjerno: strict rezim bi ugasio i MCP server Telegram plugina
// (njegov .mcp.json koristi ${CLAUDE_PLUGIN_ROOT} koji se izvan plugin loadera ne zamjenjuje).
export function claudeArgv(promptPutanja, dodatni = []) {
  return [
    "--channels", "plugin:telegram@claude-plugins-official",
    "--append-system-prompt-file", promptPutanja,
    "--setting-sources", "user,project",
    ...dodatni,
  ];
}

// Okruzenje djeteta: osnova (po pravilu process.env) + AI mapiranje + vezanje za runtime klona.
export function okruzenjeSesije({ osnova, aiEnv, obrisi, runtime, telegramDir, mcpProfil }) {
  const okruzenje = {
    ...osnova,
    ...aiEnv,
    CLAUDE_CONFIG_DIR: runtime,
    TELEGRAM_STATE_DIR: telegramDir,
    OLX_MCP_PROFILE: mcpProfil,
    // Tip sesije, izricito. Ovo je PRVI sloj brane: MCP server po njemu sam prepoznaje klijentsku
    // sesiju i tvrdo forsira klijentski profil, bez obzira sta pise u .env klona (odrediMcpProfil,
    // src/core/config.ts). OLX_MCP_PROFILE iznad ostaje drugi sloj, ne jedini.
    OLX_SESIJA_TIP: mcpProfil === "klijent" ? "klijent" : "admin-bot",
  };
  for (const kljuc of obrisi) delete okruzenje[kljuc];
  return okruzenje;
}

// cmd.exe quoting: Node sa shell:true argumente samo spoji razmacima, pa bi argument sa
// razmakom (npr. putanja sastavljenog prompta u klonu ciji folder ima razmak) raspao komandu.
// Quotuje se samo argument kojem treba, da komandna linija za danasnje putanje bez razmaka
// ostane bajt za bajt ista. Poznato ogranicenje: % i ! u putanji cmd svejedno interpretira.
export function zaCmd(a) {
  return /[\s"^&|<>()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

// Da li sesiju treba omotati u pseudoterminal. Uslov je STDOUT, ne stdin: `claude` bez TTY-a na
// izlazu odmah pada sa "Input must be provided either through stdin or as a prompt argument when
// using --print" i kodom 1 (izmjereno 15.08.2026 na golom spawnu cuvara, pet padova zaredom,
// nezavisno od AI pogona). Pod launchd-om i Task Schedulerom stdout je fajl, pa je to bio
// univerzalan slom `--channels` puta, a ne rubni slucaj.
//
// Prekidac OLX_SESIJA_BEZ_PTY=1 vraca staro, golo ponasanje (brz rollback ako omotac negdje
// zakaze). Kad stdout JESTE TTY (rucni `pokreni-klijenta.mjs` iz terminala), nista se ne mijenja.
export function trebaPty(env = process.env, platforma = process.platform, imaTty = process.stdout.isTTY) {
  if (platforma === "win32") return false;
  if ((env.OLX_SESIJA_BEZ_PTY ?? "").trim() !== "") return false;
  return imaTty !== true;
}

export function pokreniClaude({ argv, env, cwd }) {
  const win = process.platform === "win32";
  if (trebaPty(env)) {
    // BSD `script` (macOS): `-q` bez zaglavlja, `/dev/null` kao typescript fajl, pa komanda i
    // njeni argumenti direktno (bez shella, pa razmaci u putanjama ne trebaju quoting).
    //
    // stdout/stderr idu na "ignore" jer TUI kroz pty izbacuje ANSI kontrolne sekvence: sa
    // "inherit" bi to zagusilo .olx-pik/cron-sesija.log. Sve sto cuvar treba zna i bez toga
    // (izlazni kod, pid, transkripti u runtime-u). stdin ostaje "ignore" kao i danas: pty
    // dodjeljuje `script`, ne nasljedjivanje pravog terminala.
    //
    // detached: `script` dobija vlastitu procesnu grupu, da Ctrl+C ili signal grupi cuvara ne
    // presijece sesiju usred posla.
    const dijete = spawn("script", ["-q", "/dev/null", "claude", ...argv], {
      cwd,
      env,
      stdio: ["ignore", "ignore", "ignore"],
      detached: true,
    });
    // Oznaka za pozivaoca: pracen pid je pid `script`-a, a `claude` je njegovo dijete i to u
    // VLASTITOJ procesnoj grupi i sesiji (forkpty radi setsid; izmjereno 16.08.2026: script pgid
    // 58465, claude pgid 58466). Zato ni grupni kill po pidu `script`-a ne dohvata sesiju: gasenje
    // mora ici po STABLU procesa, inace `claude` prezivi kao siroce na istom bot tokenu (dvije
    // sesije, 409 na Telegramu).
    dijete.olxPty = true;
    return dijete;
  }
  return spawn("claude", win ? argv.map(zaCmd) : argv, {
    cwd,
    env,
    stdio: "inherit",
    // Na Windowsu je claude .cmd shim, a njega Node bez shella odbija pokrenuti.
    shell: win,
  });
}
