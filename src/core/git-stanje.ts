// Git nad radnom kopijom klijentskog stanja. Jedini sloj koji zna za git.
//
// Model: jedan privatan repo, JEDNA GRANA PO KLIJENTU. Razlog nije izolacija istorije nego to
// sto na jedan ref pise samo jedna masina, pa je push uvijek fast forward i spajanja nema. Da je
// folder po klijentu na jednoj grani, svaki klon bi svaki dan bio jos jedan pisac na isti ref, pa
// bi automatskom poslu trebala pull i rebase petlja.
//
// Tri pravila iz kojih ne izlazimo:
//   1. Nikad `--force`, nikad `merge`, nikad `rebase`. Automatski posao koji spaja moze izgubiti
//      tudji upis, a ovo je backup.
//   2. Token nikad u remote URL. Iscurio bi kroz `git remote -v` i kroz poruke gresaka.
//   3. Identitet se predaje po komandi, ne upisuje se u `.git/config` ni globalno. Pravilo repoa
//      je da se nista ne konfigurise po masini.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface Ishod {
  kod: number;
  izlaz: string;
}

export interface PostavkeStanja {
  grana: string;
  url: string;
  radna: string;
  token?: string;
  isticeTokena?: string;
}

/**
 * Postavke backupa iz okruzenja.
 *
 * Ime klijenta ide iz `OLX_KLIJENT`, ne iz imena foldera: preimenovanje foldera bi inace tiho
 * pokrenulo novu praznu granu, stari backup bi prestao da se puni, i to se ne bi vidjelo dok ne
 * zatreba.
 */
export function postavkeStanja(env: NodeJS.ProcessEnv, domaci: string, korijen?: string): PostavkeStanja {
  const klijent = (env.OLX_KLIJENT || "").trim();
  if (!klijent) throw new Error("OLX_KLIJENT nije postavljen u .env: bez njega se ne zna koja je grana stanja ovog klijenta.");
  const url = (env.OLX_STANJE_REPO || "").trim();
  if (!url) throw new Error("OLX_STANJE_REPO nije postavljen u .env: nema gdje da se stanje posalje.");
  const grana = imeGrane(klijent);
  const radna = env.OLX_STANJE_RADNA?.trim() || join(domaci, "olx-stanje", grana);
  if (korijen && uKlonu(radna, korijen)) {
    throw new Error(
      `OLX_STANJE_RADNA (${radna}) je unutar klona. Radna kopija tamo bi bila lokalna izmjena, pa bi azurirac trajno preskakao ovaj klon. Stavi je van klona, na primjer ~/olx-stanje/${grana}.`,
    );
  }
  return { grana, url, radna, token: env.OLX_STANJE_TOKEN?.trim() || undefined, isticeTokena: env.OLX_STANJE_TOKEN_ISTICE?.trim() || undefined };
}

/**
 * Da li radna kopija lezi unutar klona. Cijeli dizajn stoji na tome da ne lezi: `azuriraj-sve.sh`
 * preskace svaki klon sa lokalnim izmjenama, pa bi radna kopija unutra znacila da klijent nikad
 * vise ne dobije novu verziju, i to bez ijedne greske.
 */
export function uKlonu(radna: string, korijen: string): boolean {
  const rel = relative(stvarna(korijen), stvarna(radna));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Putanja sa razrijesenim simbolickim linkovima. Bez ovoga brana promasi na macOS-u, gdje je
 * `/tmp` link na `/private/tmp`, pa isti folder ima dva imena i poredjenje kaze da je van klona.
 * Radna kopija jos ne mora postojati, pa se penje do prvog pretka koji postoji.
 */
function stvarna(putanja: string): string {
  let p = resolve(putanja);
  const repovi: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(p), ...repovi);
    } catch {
      const roditelj = dirname(p);
      if (roditelj === p) return resolve(putanja); // doslo do korijena, nista ne postoji
      repovi.unshift(basename(p));
      p = roditelj;
    }
  }
}

/**
 * Koliko dana do isteka tokena, ili null kad datum nije zadan. Istekao token tiho ubija backup,
 * pa se alarmira unaprijed.
 */
export function danaDoIsteka(istice: string | undefined, danas: Date): number | null {
  if (!istice) return null;
  const kraj = Date.parse(`${istice}T00:00:00Z`);
  if (Number.isNaN(kraj)) return null;
  return Math.floor((kraj - Date.parse(`${danas.toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

const IDENTITET = ["-c", "user.name=olx backup", "-c", "user.email=backup@codefactory.local"];

/**
 * Kredencijal ide kroz helper koji cita varijablu okruzenja. Prvi prazan `credential.helper=`
 * brise naslijedjene helpere: bez toga bi macOS keychain ili Git Credential Manager na Windowsu
 * ubacio licni kredencijal i push bi isao iz pogresnog identiteta.
 *
 * Napomena za Windows: `!f() {...}` git izvrsava kroz `sh`, koji Git for Windows isporucuje.
 */
function kredencijal(token: string | undefined): string[] {
  if (!token) return [];
  return [
    "-c",
    "credential.helper=",
    "-c",
    'credential.helper=!f() { echo username=x-access-token; echo "password=$OLX_STANJE_TOKEN"; }; f',
  ];
}

export function git(radna: string | null, args: string[], token?: string): Ishod {
  const puni = radna ? ["-C", radna, ...args] : args;
  try {
    const izlaz = execFileSync("git", puni, {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, ...(token ? { OLX_STANJE_TOKEN: token } : {}), GIT_TERMINAL_PROMPT: "0" },
      timeout: 120_000,
    });
    return { kod: 0, izlaz: izlaz.trim() };
  } catch (e) {
    const greska = e as { status?: number; stdout?: string; stderr?: string };
    return { kod: greska.status ?? 1, izlaz: `${greska.stdout ?? ""}${greska.stderr ?? ""}`.trim() };
  }
}

/** Ime grane iz imena klijenta. Sve van skupa se zamjenjuje, da ime ne moze pokvariti ref. */
export function imeGrane(klijent: string): string {
  return klijent.trim().replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).toLowerCase() || "bez-imena";
}

export function granaPostoji(url: string, grana: string, token?: string): boolean {
  const r = git(null, ["ls-remote", "--heads", url, grana], token);
  if (r.kod !== 0) throw new Error(`Repo stanja nije dostupan (${url}): ${r.izlaz}`);
  return r.izlaz.length > 0;
}

export interface Masina {
  hostname: string;
  klon: string;
  os: string;
  kada: string;
}

export const MASINA_FAJL = "MASINA.json";

export function ovaMasina(klon: string): Masina {
  return { hostname: hostname(), klon, os: process.platform, kada: new Date().toISOString() };
}

/**
 * Upisuje `MASINA.json` samo kad se masina STVARNO promijenila.
 *
 * `kada` se inace mijenja pri svakom pokretanju, pa bi backup svaki dan pravio commit i kad se
 * nijedan podatak nije promijenio. Istorija bi se napunila praznim upisima i vise se ne bi
 * moglo vidjeti kad se stanje zaista mijenjalo.
 */
function upisiMasinuAkoTreba(radna: string, klon: string): void {
  const p = join(radna, MASINA_FAJL);
  const nova = ovaMasina(klon);
  const stara = procitajMasinu(radna);
  if (stara && stara.hostname === nova.hostname && stara.klon === nova.klon && stara.os === nova.os) return;
  writeFileSync(p, `${JSON.stringify(nova, null, 2)}\n`, "utf8");
}

/**
 * Da li granu vodi ova masina. Prevencija je bolja od popravke: dvije masine na istoj grani se
 * ovako zaustave PRIJE ijednog commita, umjesto da se razilazenje hvata poslije.
 *
 * Prazna grana ili grana bez `MASINA.json` znaci prvi upis, dakle poklapa se.
 */
export function masinaSePoklapa(radna: string, grana: string, klon: string, token?: string): { ok: boolean; tudja?: Masina } {
  git(radna, ["fetch", "origin", grana], token);
  const r = git(radna, ["show", `origin/${grana}:${MASINA_FAJL}`], token);
  if (r.kod !== 0) return { ok: true };
  try {
    const daljinska = JSON.parse(r.izlaz) as Masina;
    const nasa = ovaMasina(klon);
    if (daljinska.hostname === nasa.hostname && daljinska.klon === nasa.klon) return { ok: true };
    return { ok: false, tudja: daljinska };
  } catch {
    return { ok: true }; // necitljiv zapis ne smije zaustaviti backup
  }
}

const GITATTRIBUTES = [
  "# Bajt vjerne kopije podataka. Svaka konverzija krajeva linija bi bila tiho ostecenje,",
  "# pa je konverzija iskljucena i za Windows.",
  "* -text",
  "",
].join("\n");

const GITIGNORE = ["# Radna kopija ne smije primiti nista sto posao nije izricito kopirao.", ".env", "*.tmp", ""].join("\n");

/**
 * Priprema radnu kopiju. Idempotentno: nema foldera, nema `.git`, pogresan remote ili grana, sve
 * to znaci ponovnu pripremu, ne pad. Radna kopija je van klona, dakle van svake druge provjere,
 * pa mora umjeti da se sama dovede u red.
 */
export function bootstrap(radna: string, url: string, grana: string, klon: string, token?: string): "klonirano" | "napravljeno" | "zateceno" {
  if (existsSync(join(radna, ".git"))) {
    const trenutna = git(radna, ["rev-parse", "--abbrev-ref", "HEAD"]).izlaz;
    const daljinski = git(radna, ["remote", "get-url", "origin"]).izlaz;
    if (trenutna === grana && daljinski === url) return "zateceno";
    throw new Error(`Radna kopija ${radna} je na grani "${trenutna}" prema "${daljinski}", a ocekuje se "${grana}" prema "${url}". Skloni je rucno.`);
  }

  if (granaPostoji(url, grana, token)) {
    // --single-branch je obavezan, ne kozmetika: bez njega bi masina povukla grane svih klijenata.
    const r = git(null, ["clone", "--branch", grana, "--single-branch", "--depth", "1", url, radna], token);
    if (r.kod !== 0) throw new Error(`Kloniranje grane ${grana} nije uspjelo: ${r.izlaz}`);
    git(radna, ["config", "core.autocrlf", "false"]);
    return "klonirano";
  }

  git(null, ["init", "-b", grana, radna]);
  git(radna, ["config", "core.autocrlf", "false"]);
  git(radna, ["remote", "add", "origin", url]);
  writeFileSync(join(radna, ".gitattributes"), GITATTRIBUTES, "utf8");
  writeFileSync(join(radna, ".gitignore"), GITIGNORE, "utf8");
  writeFileSync(join(radna, MASINA_FAJL), `${JSON.stringify(ovaMasina(klon), null, 2)}\n`, "utf8");
  git(radna, ["add", "-A"]);
  const c = git(radna, [...IDENTITET, "commit", "-m", `prvi upis stanja: ${grana}`]);
  if (c.kod !== 0) throw new Error(`Prvi commit nije uspio: ${c.izlaz}`);
  const p = git(radna, [...kredencijal(token), "push", "-u", "origin", grana], token);
  if (p.kod !== 0) throw new Error(`Prvi push nije uspio: ${p.izlaz}`);
  return "napravljeno";
}

export type IshodSlanja = { vrsta: "poslano"; sha: string } | { vrsta: "nista-novo" } | { vrsta: "sudar"; grana: string };

/**
 * Commit i push. Na razilazenje se NE spaja i NE forsira: nase stanje ide na posebnu granu
 * `<grana>-sudar-<masina>-<datum>` i javlja se adminu. Nista se ne gubi, a covjek odlucuje.
 */
export function commitIPush(radna: string, grana: string, poruka: string, klon: string, token?: string): IshodSlanja {
  upisiMasinuAkoTreba(radna, klon);
  git(radna, ["add", "-A"]);

  const stanje = git(radna, ["status", "--porcelain"]);
  if (stanje.izlaz === "") return { vrsta: "nista-novo" };

  const c = git(radna, [...IDENTITET, "commit", "-m", poruka]);
  if (c.kod !== 0) throw new Error(`Commit nije uspio: ${c.izlaz}`);

  const prvi = git(radna, [...kredencijal(token), "push", "origin", grana], token);
  if (prvi.kod === 0) return { vrsta: "poslano", sha: git(radna, ["rev-parse", "--short", "HEAD"]).izlaz };

  git(radna, [...kredencijal(token), "fetch", "origin", grana], token);
  const predak = git(radna, ["merge-base", "--is-ancestor", `origin/${grana}`, "HEAD"]);
  if (predak.kod === 0) {
    // Daljinski je nas predak, dakle push je pao na mrezi ili tokenu. Jedan ponovni pokusaj.
    const drugi = git(radna, [...kredencijal(token), "push", "origin", grana], token);
    if (drugi.kod === 0) return { vrsta: "poslano", sha: git(radna, ["rev-parse", "--short", "HEAD"]).izlaz };
    throw new Error(`Push nije uspio ni iz drugog pokusaja: ${drugi.izlaz}`);
  }

  const sudar = `${grana}-sudar-${imeGrane(hostname())}-${new Date().toISOString().slice(0, 10)}`;
  const spas = git(radna, [...kredencijal(token), "push", "origin", `HEAD:refs/heads/${sudar}`], token);
  if (spas.kod !== 0) throw new Error(`Razilazenje na grani ${grana}, a spasavanje na ${sudar} nije uspjelo: ${spas.izlaz}`);
  return { vrsta: "sudar", grana: sudar };
}

/** Datum zadnjeg commita na grani, iz daljinskog repoa, bez kloniranja. Za nadzor sa strane. */
export function zadnjiUpis(radna: string, grana: string, token?: string): string | null {
  git(radna, [...kredencijal(token), "fetch", "origin", grana], token);
  const r = git(radna, ["log", "-1", "--format=%cI", `origin/${grana}`]);
  return r.kod === 0 && r.izlaz ? r.izlaz : null;
}

/** Sadrzaj fajla sa grane, bez diranja radne kopije. Koristi `--samo-provjeri`. */
export function procitajSaGrane(radna: string, grana: string, putanja: string): string | null {
  const r = git(radna, ["show", `origin/${grana}:${putanja}`]);
  return r.kod === 0 ? r.izlaz : null;
}

export { IDENTITET as IDENTITET_ZA_TEST, kredencijal as kredencijalZaTest, GITATTRIBUTES as GITATTRIBUTES_ZA_TEST };
export function procitajMasinu(radna: string): Masina | null {
  const p = join(radna, MASINA_FAJL);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Masina;
  } catch {
    return null;
  }
}
