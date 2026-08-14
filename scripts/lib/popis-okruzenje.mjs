// Sakupljac inventara varijabli okruzenja: sta kod stvarno cita naspram sta `.env.example`
// pominje. Ne parsira logiku (koja grana koristi koju varijablu, sa kojim defaultom), samo trazi
// IME po obrascu. Ta prostota je namjerna: revizija je vec jednom pokazala da rucni popis tiho
// zaostane (86 u kodu naspram 66 u primjeru), a najgori ishod grubog trazenja imena je jedan lazan
// pogodak koji se rucno izuzme, sto je jeftinije od jos jednog tihog zaostajanja.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { poredi } from "./popis-poredak.mjs";

const FOLDERI = ["src", "scripts", "deploy"];
const EKSTENZIJE = new Set([".ts", ".mjs", ".js", ".sh", ".ps1", ".plist"]);
/**
 * Porodice imena koje se traze. Nije samo `OLX_`: pogon cita i Telegram tokene, PIKGPT postavke
 * onboardinga, DeepSeek putanju i `CLAUDE_CONFIG_DIR`, a bas te varijable odlucuju hoce li bot
 * uopste odgovarati. Kad bi obrazac gledao samo `OLX_`, nova `TELEGRAM_` varijabla bi propala
 * kroz istu rupu zbog koje ovaj inventar postoji.
 */
const PREFIKSI_KONFIGURACIJE = ["OLX", "TELEGRAM", "PIKGPT", "DEEPSEEK"];

/**
 * Porodice koje NE pripadaju `.env.example`, jer ih ne postavlja klon nego okolina: harness ih
 * ubaci u sesiju, plugin loader ih zamijeni, proxy skripta ih prosljedjuje dalje. Popisuju se da se
 * zna da postoje, ali se nikad ne poredi sa primjerom: kad bi se poredilo, primjer bi trazio da
 * klijent rucno postavi nesto sto mu alat postavlja sam.
 */
const PREFIKSI_SPOLJA = ["CLAUDE", "ANTHROPIC", "GEMINI"];

const PREFIKSI = [...PREFIKSI_KONFIGURACIJE, ...PREFIKSI_SPOLJA];
const OBRAZAC_IMENA = new RegExp(`(?:${PREFIKSI.join("|")})_[A-Z0-9_]+`, "g");

/** Da li ime pripada konfiguraciji klona, dakle da li se smije traziti u `.env.example`. */
function jeKonfiguracija(ime) {
  return PREFIKSI_KONFIGURACIJE.some((p) => ime.startsWith(`${p}_`));
}
const NAJVISE_PUTANJA = 6;

/**
 * Imena koja obrazac pogodi a nisu prava varijabla okruzenja (dio duzeg identifikatora, primjer u
 * komentaru i slicno). Popunjava se tek nakon uvida u stvaran izlaz, i to samo za ono sto je
 * ocito lazan pogodak; sumnjivo ostaje unutra radije nego da se izgubi prava varijabla.
 */
export const IZUZETA = new Set([
  // Komentari pisu "OLX_DEEPSEEK_*" kao skraceni zapis za citavu grupu varijabli; zvjezdica
  // prekida obrazac imena, pa ostaje ovaj patrljak koji sam nije varijabla.
  "OLX_DEEPSEEK_",
  // Ime fajla u komentaru (olx-dokumentacija/OLX_PIK_AI_Knowledgebase.md); veliko K je slucajno
  // poravnato sa obrascem imena varijable, malo "nowledgebase" poslije njega prekida match.
  "OLX_PIK_AI_K",
  // MAPA_OLX_PIK_PREFIKSA je lokalna JS konstanta u nadzor-flote.mjs, ne varijabla okruzenja;
  // obrazac je pogodio rep njenog imena jer i on odgovara sablonu OLX_[A-Z0-9_]+.
  "OLX_PIK_PREFIKSA",
  // Sljedeca tri su imena JS konstanti u kodu, ne varijable okruzenja: ANTHROPIC_VARIJABLE je
  // spisak imena koja se brisu iz okruzenja proxy sesije, TELEGRAM_DIR je putanja racunata u
  // pripremi-runtime.mjs, TELEGRAM_MEKI_LIMIT je prag duzine poruke iz izvjestaj.ts.
  "ANTHROPIC_VARIJABLE",
  "TELEGRAM_DIR",
  "TELEGRAM_MEKI_LIMIT",
]);

/** Rekurzivno nalazi fajlove trazenih ekstenzija ispod `korijenFoldera`, preskace skriveno. */
function nadjiFajlove(korijenFoldera, korijen, izlaz) {
  let stavke;
  try {
    stavke = readdirSync(korijenFoldera, { withFileTypes: true });
  } catch {
    // Folder (npr. deploy/) ne mora postojati u svakoj granazi razvoja; odsutnost nije greska.
    return;
  }
  for (const stavka of stavke) {
    if (stavka.name.startsWith(".")) continue;
    const puna = join(korijenFoldera, stavka.name);
    if (stavka.isDirectory()) {
      if (stavka.name === "node_modules" || stavka.name === "dist") continue;
      nadjiFajlove(puna, korijen, izlaz);
      continue;
    }
    const tacka = stavka.name.lastIndexOf(".");
    if (tacka === -1) continue;
    if (!EKSTENZIJE.has(stavka.name.slice(tacka))) continue;
    izlaz.push(puna);
  }
}

/** Relativna putanja normalizovana na "/", da izlaz bude isti na macOS-u i Windowsu. */
function relativnaPutanja(korijen, puna) {
  return relative(korijen, puna).split(sep).join("/");
}

/** Kljucevi iz `.env.example`: sve prije prvog "=" na redu koji nije prazan ni komentar. */
function skupiPrimjer(korijen) {
  const putanja = join(korijen, ".env.example");
  let tekst;
  try {
    tekst = readFileSync(putanja, "utf8");
  } catch (greska) {
    throw new Error(`Ne mogu procitati .env.example u korijenu (${putanja}): ${greska.message}`);
  }
  const kljucevi = new Set();
  for (const red of tekst.split("\n")) {
    const t = red.trim();
    if (t === "" || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const kljuc = t.slice(0, i).trim();
    if (kljuc) kljucevi.add(kljuc);
  }
  return kljucevi;
}

/**
 * Skuplja imena varijabli iz koda (`src`, `scripts`, `deploy`) i poredi ih sa `.env.example`.
 * Vraca deterministican rezultat: bez datuma, bez apsolutnih putanja, sve sortirano po kodnim
 * tackama (vidi `popis-poredak.mjs`, ne `localeCompare`, jer red mora biti isti na svakoj masini).
 */
export function skupiOkruzenje(korijen) {
  const fajlovi = [];
  for (const folder of FOLDERI) nadjiFajlove(join(korijen, folder), korijen, fajlovi);
  fajlovi.sort(poredi);

  /** @type {Map<string, string[]>} ime varijable -> relativne putanje gdje se pojavljuje */
  const pojave = new Map();

  for (const puna of fajlovi) {
    let tekst;
    try {
      tekst = readFileSync(puna, "utf8");
    } catch {
      // Fajl je mogao nestati izmedju listanja i citanja (paralelna izmjena drugog procesa);
      // to nije razlog da cijeli popis padne.
      continue;
    }
    const rel = relativnaPutanja(korijen, puna);
    const pogodjena = new Set(tekst.match(OBRAZAC_IMENA) ?? []);
    for (const ime of pogodjena) {
      if (IZUZETA.has(ime)) continue;
      if (!pojave.has(ime)) pojave.set(ime, []);
      pojave.get(ime).push(rel);
    }
  }

  const uPrimjeru = skupiPrimjer(korijen);

  const varijable = [...pojave.keys()].sort(poredi).map((ime) => {
    const sveGdje = [...new Set(pojave.get(ime))].sort(poredi);
    const gdje = sveGdje.slice(0, NAJVISE_PUTANJA);
    const stavka = { ime, gdje, uPrimjeru: uPrimjeru.has(ime), konfiguracija: jeKonfiguracija(ime) };
    if (sveGdje.length > NAJVISE_PUTANJA) stavka.viseFajlova = sveGdje.length - NAJVISE_PUTANJA;
    return stavka;
  });

  const imenaUKodu = new Set(varijable.map((v) => v.ime));
  const uPrimjeruAneUKodu = [...uPrimjeru].filter((ime) => !imenaUKodu.has(ime)).sort(poredi);
  const uKoduANeUPrimjeru = varijable
    .filter((v) => v.konfiguracija && !v.uPrimjeru)
    .map((v) => v.ime)
    .sort(poredi);

  return { varijable, uPrimjeruAneUKodu, uKoduANeUPrimjeru };
}
