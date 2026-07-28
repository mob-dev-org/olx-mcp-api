// Generička klasifikacija shopova iz snimka po zadatom profilu djelatnosti
// (npr. vozila, namjestaj, nekretnine...). Profil odredjuje koju top_category_id
// vrijednost trazimo, pragove i pojmove za naziv-provjeru. Poziva se:
//   node klasifikuj.mjs <profil>
// gdje je <profil> ime fajla u profili/ bez .json (default: vozila).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESTILATOR_URL = process.env.DESTILATOR_URL || "http://localhost:4001";

const imeProfila = process.argv[2] || "vozila";
const profil = JSON.parse(
  fs.readFileSync(path.join(__dirname, "profili", `${imeProfila}.json`), "utf8"),
);

const IZLAZ_DIR = path.join(__dirname, "izlazi", imeProfila);
fs.mkdirSync(IZLAZ_DIR, { recursive: true });
const PROGRESS_FILE = path.join(IZLAZ_DIR, "progress.jsonl");
const CSV_FILE = path.join(IZLAZ_DIR, "shopovi.csv");
const MD_FILE = path.join(IZLAZ_DIR, "sazetak.md");

const snimak = JSON.parse(
  fs.readFileSync(path.join(__dirname, "snimci", profil.snimak), "utf8"),
);

function bezDijakritike(s) {
  return (s || "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function izgledaKaoCiljnaDjelatnost(row) {
  const tekst = bezDijakritike([row.username, row.naziv, row.web].filter(Boolean).join(" "));
  return profil.pojmovi_naziv.some((p) => tekst.includes(bezDijakritike(p)));
}

function ucitajVecObradjene() {
  const gotovi = new Map();
  if (!fs.existsSync(PROGRESS_FILE)) return gotovi;
  const linije = fs.readFileSync(PROGRESS_FILE, "utf8").split("\n").filter(Boolean);
  for (const l of linije) {
    try {
      const zapis = JSON.parse(l);
      gotovi.set(zapis.username, zapis);
    } catch {
      // los red u progress fajlu se preskace, ne prekida citav posao
    }
  }
  return gotovi;
}

function upisiProgress(zapis) {
  fs.appendFileSync(PROGRESS_FILE, JSON.stringify(zapis) + "\n");
}

async function pozovi(username, opts = {}) {
  const q = new URLSearchParams();
  if (opts.deep) q.set("uzorak", "deep");
  if (opts.podnaslovi) q.set("podnaslovi", "true");
  const qs = q.toString() ? `?${q}` : "";
  const res = await fetch(`${DESTILATOR_URL}/shop/${encodeURIComponent(username)}${qs}`);
  if (!res.ok) throw new Error(`destilator ${res.status} za ${username}`);
  return res.json();
}

function udioCilja(d) {
  const total = d.uzorak || 0;
  if (total === 0) return 0;
  const cilj = d.kategorije?.[profil.top_category_id_cilj] ?? 0;
  return cilj / total;
}

function klasifikujPrviProlaz(d) {
  if (!d || d.greska) return "greska";
  if (!d.ukupno || d.ukupno === 0) return "neaktivan";
  const udio = udioCilja(d);
  if (udio >= profil.prag_cilj_prvi_prolaz) return profil.naziv_ciljne_klase;
  if (udio <= profil.prag_sporedna_prvi_prolaz) return "sporedna_ili_ostalo";
  return "sporno";
}

async function drugiProlaz(username) {
  const dubok = await pozovi(username, { deep: true, podnaslovi: true });
  const udio = udioCilja(dubok);
  let klasifikacija;
  let obrazlozenje;
  if (udio >= profil.prag_cilj_drugi_prolaz) {
    klasifikacija = profil.naziv_ciljne_klase;
    obrazlozenje = `Dublji uzorak (${dubok.uzorak}) pokazuje udio ${udio}, tezisno ciljna djelatnost.`;
  } else if (udio <= profil.prag_sporedna_drugi_prolaz) {
    klasifikacija = "sporedna_ili_ostalo";
    obrazlozenje = `Dublji uzorak (${dubok.uzorak}) pokazuje udio ${udio}, tezisno nije ciljna djelatnost.`;
  } else {
    klasifikacija = "mjesovito";
    obrazlozenje = `Dublji uzorak (${dubok.uzorak}) pokazuje udio ${udio}, mjesano.`;
  }
  return { dubok, klasifikacija, obrazlozenje };
}

// Sporedna_ili_ostalo se dalje razdvaja na "sporednu djelatnost" (npr. dijelovi) i
// "nije ciljna djelatnost uopste" na osnovu shop_category_id ili histograma - vidi koriguj.mjs.
function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

async function main() {
  const gotovi = ucitajVecObradjene();
  const preostali = snimak.filter((r) => !gotovi.has(r.username));
  console.log(
    `Profil: ${imeProfila}. Ukupno u snimku: ${snimak.length}. Vec obradjeno: ${gotovi.size}. Preostalo: ${preostali.length}.`,
  );

  const start = Date.now();
  let obradjenoOvajRun = 0;

  for (const row of preostali) {
    let zapis;
    try {
      const prvi = await pozovi(row.username, {});
      let finalna = klasifikujPrviProlaz(prvi);
      let prolaz = "prvi";
      let obrazlozenje = "";
      let brojOglasaCiljCijeliKatalog =
        prvi.ukupno && prvi.uzorak ? Math.round(udioCilja(prvi) * prvi.ukupno) : 0;

      if (finalna === "sporno") {
        const drugi = await drugiProlaz(row.username);
        finalna = drugi.klasifikacija;
        prolaz = "drugi";
        obrazlozenje = drugi.obrazlozenje;
        if (drugi.dubok.ukupno && drugi.dubok.uzorak) {
          brojOglasaCiljCijeliKatalog = Math.round(udioCilja(drugi.dubok) * drugi.dubok.ukupno);
        }
      }

      zapis = {
        username: row.username,
        naziv_firme: row.naziv,
        paket: row.paket,
        grad: row.grad,
        kanton: row.kanton,
        oglasa_snimak: row.oglasa_snimak,
        oglasa_api: prvi.ukupno ?? 0,
        oglasa_cilj: brojOglasaCiljCijeliKatalog,
        udio_cilj: udioCilja(prvi),
        shop_category_id: prvi.shop_category_id ?? null,
        klasifikacija: finalna,
        prolaz,
        obrazlozenje,
        link: row.link,
        izgleda_ciljno_po_nazivu: izgledaKaoCiljnaDjelatnost(row),
      };
    } catch (err) {
      zapis = {
        username: row.username,
        naziv_firme: row.naziv,
        paket: row.paket,
        grad: row.grad,
        kanton: row.kanton,
        oglasa_snimak: row.oglasa_snimak,
        oglasa_api: null,
        oglasa_cilj: null,
        udio_cilj: null,
        shop_category_id: null,
        klasifikacija: "greska",
        prolaz: "prvi",
        obrazlozenje: String(err?.message ?? err),
        link: row.link,
        izgleda_ciljno_po_nazivu: izgledaKaoCiljnaDjelatnost(row),
      };
    }

    upisiProgress(zapis);
    obradjenoOvajRun++;

    if (obradjenoOvajRun % 25 === 0) {
      const proteklo = Date.now() - start;
      const poShopuMs = proteklo / obradjenoOvajRun;
      const preostaloMs = poShopuMs * (preostali.length - obradjenoOvajRun);
      console.log(
        `${gotovi.size + obradjenoOvajRun}/${snimak.length} obradjeno. Preostalo procjena: ${fmtTime(preostaloMs)}.`,
      );
    }
  }

  console.log("Gotovo sa prvim/drugim prolazom. Pokreni koriguj.mjs za finalni CSV/sazetak.");
}

main().catch((err) => {
  console.error("Prekid sa greskom:", err);
  process.exit(1);
});
