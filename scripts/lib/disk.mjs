// Skeniranje diska po klonu za sedmicni uvid vlasnika flote: koliko prostora trosi svaki klon,
// po kategorijama, i koji fajlovi su najvise narasli od proslog obilaska.
//
// Isti princip kao resursi.mjs: cista funkcija gdje god je moguce, sve zavisnosti (exec, fs
// funkcije) idu kao argumenti default parametara, modul sam ne cita process.env ni
// process.platform (osim kao default vrijednost parametra). Nijedna javna funkcija ne baca
// izuzetak napolje: sve je best effort, `null`/prazan rezultat/`greska` polje na neuspjeh.
//
// TVRDE GRANICE (vidi olx-dokumentacija/granice.md, sekcije "Slike" i "Trag i tajne"):
// - Skeniranje cita SAMO metapodatke (ime, velicina, mtime), NIKAD sadrzaj fajla.
// - Imena fajlova iz FOLDERI_KLIJENTSKOG_MATERIJALA (arhiva artikala, klijentovi fajlovi,
//   generisane/originalne slike, Telegram inbox) se NIKAD ne pojavljuju pojedinacno u
//   rezultatu ovog modula, samo agregat (broj i bajtovi). To su fajlovi klijenta (fotografije
//   njegove robe, njegovi dokumenti, sirova Telegram poruka), ne pogona: isti razlog zbog kojeg
//   backup-spisak.ts drzi ove fajlove iza eksplicitnog bijelog spiska umjesto opsteg pravila, i
//   isti razlog zbog kojeg se slika nikad ne otvara ako je nije trazio klijent. Sedmicni uvid u
//   disk je izvjestaj o POGONU, ne prozor u tudje artikle ili poruke.

import { execFile } from "node:child_process";
import { readdirSync as readdirSyncDefault, statSync as statSyncDefault } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

// Isti obrazac kao resursi.mjs: uvijek async subprocess, nikad sinhroni execSync/spawnSync.
const execFileAsyncDefault = promisify(execFile);

// ---- rekurzivni hod kroz direktorij ----

/**
 * Rekurzivni hod kroz direktorij. Cita SAMO metapodatke (ime, velicina, mtime), nikad sadrzaj.
 * Vraca `Array<{ relativnaPutanja, apsolutnaPutanja, velicinaBajta, mtimeMs }>`, relativna
 * putanja je u odnosu na `putanja` argument, uvijek sa `/` separatorom bez obzira na OS.
 *
 * `readdirSync`/`statSync` injektovani (default `node:fs`). Best effort: folder/fajl koji se ne
 * moze procitati (dozvole, race sa brisanjem) se preskace, ne obara cijeli hod. `.git` se
 * eksplicitno preskace (irelevantan i zna biti velik).
 *
 * Simbolicki linkovi se ne prate (izbjegava beskonacnu petlju): `readdirSync` se zove sa
 * `{ withFileTypes: true }` da tip svake stavke dodje direktno od sistema, bez pratenja linka.
 * Ako tip stavke ipak izidje kao obican fajl a `statSync` na broken symlink baca (Node bez
 * `{ throwIfNoEntry: false }` to radi), to je samo jos jedan slucaj koji se hvata i preskace.
 */
export function obidjiDirektorijum(putanja, { readdirSync = readdirSyncDefault, statSync = statSyncDefault } = {}) {
  const rezultat = [];

  const hodaj = (apsolutnaBaza, relativniPrefiks) => {
    let stavke;
    try {
      stavke = readdirSync(apsolutnaBaza, { withFileTypes: true });
    } catch {
      return; // folder se ne moze procitati ili ne postoji, tiho preskoci
    }

    for (const stavka of stavke) {
      const ime = stavka.name;
      if (ime === ".git") continue;

      const apsolutnaPutanja = join(apsolutnaBaza, ime);
      const relativnaPutanja = relativniPrefiks === "" ? ime : `${relativniPrefiks}/${ime}`;

      let jeSimlink = false;
      let jeDirektorijum = false;
      let jeFajl = false;
      try {
        jeSimlink = typeof stavka.isSymbolicLink === "function" && stavka.isSymbolicLink();
        jeDirektorijum = typeof stavka.isDirectory === "function" && stavka.isDirectory();
        jeFajl = typeof stavka.isFile === "function" && stavka.isFile();
      } catch {
        continue;
      }

      if (jeSimlink) continue; // ne prati simbolicke linkove
      if (jeDirektorijum) {
        hodaj(apsolutnaPutanja, relativnaPutanja);
        continue;
      }
      if (!jeFajl) continue; // socket, fifo, uredjaj i slicno se preskace

      try {
        const stat = statSync(apsolutnaPutanja);
        rezultat.push({
          relativnaPutanja,
          apsolutnaPutanja,
          velicinaBajta: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // fajl nestao izmedju readdir i stat (race), ili polomljen link koji tip nije
        // ispravno prijavio; statSync bez throwIfNoEntry:false na to baca, preskoci
      }
    }
  };

  hodaj(putanja, "");
  return rezultat;
}

// ---- brza velicina teskih foldera (node_modules, dist) ----

/**
 * Brzo mjeri ukupnu velicinu foldera (npr. `node_modules`, `dist`) BEZ file-level obilaska:
 * `node_modules`/`dist` se regenerisu pri svakom `bun install`/build (mtime hiljada fajlova mijenja se
 * bez stvarne promjene sadrzaja), pa file-level detalj za njih nikad ne treba, samo ukupan broj
 * bajtova.
 *
 * macOS/Linux: `du -sk <putanja>`. Kad `putanja` ne postoji, `du` javlja gresku (stderr i/ili
 * exit code != 0) sto je normalan slucaj (npr. klon bez `dist`), vraca se `{ velicinaBajta: 0 }`
 * (poznato stanje, ne nepoznato). Windows: PowerShell `Get-ChildItem -Recurse -File` zbir.
 *
 * Ako sistemska komanda STVARNO padne (timeout, komanda ne postoji, nevalidan izlaz koji se ne
 * da parsirati) ide fallback na rekurzivni Node hod (`obidjiDirektorijumFn`, injektovan da bi se
 * dao mockovati odvojeno od stvarnog `obidjiDirektorijum`), izvor postaje `"node-hod"`. Ako i to
 * padne, vraca se `{ velicinaBajta: null, izvor: null, greska: "poruka" }` (nepoznato).
 */
export async function velicinaFolderaBrzo(
  putanja,
  {
    platform = process.platform,
    exec = execFileAsyncDefault,
    timeoutMs,
    obidjiDirektorijumFn = obidjiDirektorijum,
  } = {},
) {
  const izKomande = await pokusajKomanduZaVelicinu(putanja, { platform, exec, timeoutMs });
  if (izKomande !== undefined) return izKomande;

  try {
    const fajlovi = obidjiDirektorijumFn(putanja);
    const velicinaBajta = (fajlovi ?? []).reduce((zbir, f) => zbir + (f.velicinaBajta ?? 0), 0);
    return { velicinaBajta, izvor: "node-hod", greska: null };
  } catch (e) {
    return { velicinaBajta: null, izvor: null, greska: e?.message ?? String(e) };
  }
}

// Vraca rezultat ako je sistemska komanda dala upotrebljiv odgovor (uspjeh ILI poznato "folder ne
// postoji"). Vraca `undefined` kad treba probati fallback (node hod), nikad ne baca.
async function pokusajKomanduZaVelicinu(putanja, { platform, exec, timeoutMs }) {
  if (platform === "win32") {
    const rok = timeoutMs ?? 8000;
    const komanda = `(Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue '${putanja}' | Measure-Object -Property Length -Sum).Sum`;
    let stdout;
    try {
      ({ stdout } = await exec("powershell", ["-NoProfile", "-Command", komanda], {
        timeout: rok,
        encoding: "utf8",
        killSignal: "SIGKILL",
      }));
    } catch {
      return undefined; // komanda stvarno pala (timeout, powershell ne postoji)
    }
    const ocisceno = (stdout ?? "").trim();
    if (ocisceno === "") return { velicinaBajta: 0, izvor: "powershell", greska: null };
    const broj = Number(ocisceno);
    if (!Number.isFinite(broj)) return undefined; // nevalidan izlaz, ne da se parsirati
    return { velicinaBajta: broj, izvor: "powershell", greska: null };
  }

  const rok = timeoutMs ?? 5000;
  let stdout;
  try {
    ({ stdout } = await exec("du", ["-sk", putanja], {
      timeout: rok,
      encoding: "utf8",
      killSignal: "SIGKILL",
    }));
  } catch (e) {
    // Spawn koji nije uspio (komanda ne postoji) ili timeout je STVARAN neuspjeh komande.
    // Svaki drugi neuspjeh (du se pokrenuo i zavrsio sa exit != 0) je normalan slucaj "folder ne
    // postoji", jer je to jedini razlog zbog kojeg `du -sk` na ovoj putanji ne bi uspio.
    const komandaStvarnoPala = e?.code === "ENOENT" || e?.killed === true;
    if (komandaStvarnoPala) return undefined;
    return { velicinaBajta: 0, izvor: "du", greska: null };
  }
  const poklapanje = (stdout ?? "").match(/^(\d+)/);
  if (!poklapanje) return undefined; // izlaz koji se ne da parsirati
  return { velicinaBajta: Number(poklapanje[1]) * 1024, izvor: "du", greska: null };
}

// ---- klijentov materijal (tvrda granica) ----

/**
 * Relativne putanje (od korijena klona, `/` separator) ciji fajlovi NIKAD ne smiju izaci
 * poimenicno iz ovog modula, samo kroz agregat (broj i bajtovi). Vidi komentar na vrhu fajla.
 */
export const FOLDERI_KLIJENTSKOG_MATERIJALA = [
  ".olx-pik/arhiva-artikala",
  ".olx-pik/klijent-fajlovi",
  ".olx-pik/slike",
  ".claude-runtime/channels/telegram/inbox",
  ".claude-runtime-admin/channels/telegram/inbox",
];

// Izlazne kategorije koje su agregat FOLDERI_KLIJENTSKOG_MATERIJALA (redom kako su gore
// navedene, izuzev sto dva Telegram inbox foldera dijele istu izlaznu kategoriju).
const KATEGORIJE_KLIJENTSKOG_MATERIJALA = ["olx_pik_arhiva", "olx_pik_klijent_fajlovi", "olx_pik_slike", "telegram_inbox"];

// Kategorije sa file-level detaljem iz kojih topNovi smije birati kandidate. Namjerno NE
// ukljucuje: node_modules/dist (nikad nemaju file-level detalj, mtime im je sum od bun install/build,
// vidi velicinaFolderaBrzo) ni kategorije klijentskog materijala (tvrda granica, vidi komentar na
// vrhu fajla i olx-dokumentacija/granice.md sekcije "Slike"/"Trag i tajne").
const KATEGORIJE_ZA_TOP_NOVI = ["olx_pik_snapshots", "olx_pik_konkurenti", "olx_pik_resursi", "olx_pik_ostalo", "transkripti", "ostalo_klona"];

// ---- sazimanje skeniranja ----

/**
 * Sazima rezultate skeniranja (fajlovi po kategoriji + brza velicina teskih foldera) u kompaktan
 * izvjestaj. Cista funkcija, bez I/O.
 *
 * `svojFajlovi` je mapa `{ [kategorija]: Array<...isti oblik kao obidjiDirektorijum, sa dodatim
 * poljem putanjaOdKorijena za puni relativni put od korijena klona> }`, kljucevi su isti kao
 * kljucevi izlaznog `kategorije` objekta OSIM `node_modules`/`dist` (ti nikad nemaju file-level
 * detalj, dolaze iskljucivo kroz `teskeKategorije`). `teskeKategorije` je
 * `{ node_modules: {velicinaBajta, izvor}, dist: {velicinaBajta, izvor} }`.
 *
 * `odVremena` je mtime prag za "novo" (`Date|null`). `null` znaci prvi obilazak: nema poredjenja,
 * `novihFajlovaBroj`/`novihFajlovaBajta` su `null` (ne 0), `topNovi` je prazan niz (naznaku "prvi
 * obilazak" ispisuje pozivalac orkestrator, ne ova funkcija).
 */
export function sazmiSkeniranje({ svojFajlovi = {}, teskeKategorije = {}, odVremena = null } = {}) {
  const agregat = (naziv) => {
    const niz = svojFajlovi[naziv] ?? [];
    return {
      bajta: niz.reduce((zbir, f) => zbir + (f.velicinaBajta ?? 0), 0),
      broj: niz.length,
    };
  };

  const nodeModules = teskeKategorije.node_modules ?? {};
  const dist = teskeKategorije.dist ?? {};

  const kategorije = {
    olx_pik_snapshots: agregat("olx_pik_snapshots"),
    olx_pik_arhiva: agregat("olx_pik_arhiva"),
    olx_pik_klijent_fajlovi: agregat("olx_pik_klijent_fajlovi"),
    olx_pik_slike: agregat("olx_pik_slike"),
    olx_pik_konkurenti: agregat("olx_pik_konkurenti"),
    olx_pik_resursi: agregat("olx_pik_resursi"),
    olx_pik_ostalo: agregat("olx_pik_ostalo"),
    transkripti: agregat("transkripti"),
    telegram_inbox: agregat("telegram_inbox"),
    node_modules: { bajta: nodeModules.velicinaBajta ?? null, izvor: nodeModules.izvor ?? null },
    dist: { bajta: dist.velicinaBajta ?? null, izvor: dist.izvor ?? null },
    ostalo_klona: agregat("ostalo_klona"),
  };

  let ukupnoBajta = 0;
  for (const vrijednost of Object.values(kategorije)) {
    if (typeof vrijednost.bajta === "number") ukupnoBajta += vrijednost.bajta;
  }

  let novihFajlovaBroj = null;
  let novihFajlovaBajta = null;
  let topNovi = [];

  if (odVremena !== null) {
    const pragMs = odVremena.getTime();
    const kandidati = [];
    let broj = 0;
    let bajta = 0;

    // Namjerno SAMO iz KATEGORIJE_ZA_TOP_NOVI: node_modules/dist nemaju svoju stavku u
    // svojFajlovi uopste, a kategorije klijentskog materijala su ovdje eksplicitno izostavljene
    // cak i ako bi pozivalac pogresno proslijedio njihove fajlove pod ovim kljucevima. Druga,
    // eksplicitna brana (a ne samo izostanak iz KATEGORIJE_ZA_TOP_NOVI) da buduca izmjena tog
    // niza ne otvori tvrdu granicu slucajno.
    for (const naziv of KATEGORIJE_ZA_TOP_NOVI) {
      if (KATEGORIJE_KLIJENTSKOG_MATERIJALA.includes(naziv)) continue;
      for (const f of svojFajlovi[naziv] ?? []) {
        if (typeof f.mtimeMs === "number" && f.mtimeMs > pragMs) {
          broj += 1;
          bajta += f.velicinaBajta ?? 0;
          kandidati.push({
            putanja: f.putanjaOdKorijena ?? f.relativnaPutanja,
            velicinaBajta: f.velicinaBajta ?? 0,
            mtimeMs: f.mtimeMs,
          });
        }
      }
    }

    novihFajlovaBroj = broj;
    novihFajlovaBajta = bajta;
    topNovi = kandidati.sort((a, b) => b.velicinaBajta - a.velicinaBajta).slice(0, 10);
  }

  return { kategorije, ukupnoBajta, novihFajlovaBroj, novihFajlovaBajta, topNovi };
}
