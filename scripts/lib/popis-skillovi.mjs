// Sakuplja mogucnosti sistema iz koda: skillove i podagente, sa njihovim frontmatterom.
// Cilj je da generator popisa cita PRAVA polja (ime, opis, okidaci, alati) umjesto da neko
// rucno prepisuje ono sto vec pise u SKILL.md i agent fajlovima, jer prepis vremenom zaostane.
//
// Frontmatter u ovom repou koristi YAML folded scalar (`description: >-`) sa uvucenim nastavkom
// reda, pa je citajFrontmatter napravljen da SLAZE takve redove u jedan, umjesto da uzima samo
// prvi red i odsijece ostatak opisa (kao sto radi gruba verzija u kontekst-izvjestaj.mjs).

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { poPolju } from "./popis-poredak.mjs";

const FRONTMATTER_OMOTAC = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

// Kljuc je ono na POCETKU reda, prije prve dvotacke; nastavak vrijednosti je uvucen razmacima i
// zato ne pocinje slovom/brojem na koloni 0. Ovo razdvaja "description: >-" od reda opisa koji
// sam sadrzi dvotacku (npr. "Okidaci: ...") a ne smije biti procitan kao novi kljuc.
const KLJUC_REDA = /^([A-Za-z_][\w-]*):[ \t]?(.*)$/;

// YAML indikatori blok stringa; kad se nadju kao cijela vrijednost reda, prava vrijednost dolazi
// tek iz nastavka, ne iz ovog reda.
const BLOK_INDIKATORI = new Set(["", ">-", ">", "|-", "|"]);

function skiniNavodnike(vrijednost) {
  if (vrijednost.length < 2) return vrijednost;
  const prvi = vrijednost[0];
  const zadnji = vrijednost[vrijednost.length - 1];
  if ((prvi === '"' || prvi === "'") && prvi === zadnji) {
    return vrijednost.slice(1, -1);
  }
  return vrijednost;
}

/**
 * Cita YAML frontmatter bez YAML biblioteke: repo koristi samo prost oblik (kljuc: vrijednost,
 * folded string sa uvucenim nastavkom), pa poseban parser ovdje ne mora podrzati citav YAML,
 * samo taj oblik i to pouzdano.
 *
 * Vraca `{ polja, tijelo }`. Fajl bez frontmattera vraca `polja: {}` i `tijelo` kao cijeli tekst,
 * jer i takav fajl mora proci kroz isti poziv bez posebnog rukovanja kod pozivaoca.
 */
export function citajFrontmatter(tekst) {
  const poklapanje = tekst.match(FRONTMATTER_OMOTAC);
  if (!poklapanje) {
    return { polja: {}, tijelo: tekst };
  }

  const polja = {};
  const redovi = poklapanje[1].split(/\r?\n/);
  let trenutniKljuc = null;
  let trenutneLinije = [];

  const zavrsiTrenutni = () => {
    if (trenutniKljuc === null) return;
    const vrijednost = skiniNavodnike(trenutneLinije.join(" ").trim());
    polja[trenutniKljuc] = vrijednost;
  };

  for (const red of redovi) {
    const jeNastavak = /^\s/.test(red) && red.trim() !== "";
    if (!jeNastavak) {
      const uskladjeno = red.match(KLJUC_REDA);
      if (uskladjeno) {
        zavrsiTrenutni();
        trenutniKljuc = uskladjeno[1];
        const ostatak = uskladjeno[2].trim();
        trenutneLinije = BLOK_INDIKATORI.has(ostatak) ? [] : [ostatak];
        continue;
      }
    }
    if (trenutniKljuc !== null && red.trim() !== "") {
      trenutneLinije.push(red.trim());
    }
    // prazan red unutar bloka se preskace: fold stil ovdje nikad ne pravi novi pasus, samo
    // razdvaja recenice, pa spajanje razmakom ostaje ispravno i za taj slucaj
  }
  zavrsiTrenutni();

  const tijelo = tekst.slice(poklapanje[0].length);
  return { polja, tijelo };
}

const OKIDACI_OZNAKA = /okida(?:c|č)i\s*:/i;

/** Izvlaci navedene fraze iz recenice "Okidaci: "a", "b", "c"." Prazan niz kad recenice nema. */
function izvuciOkidace(opis) {
  const oznaka = opis.match(OKIDACI_OZNAKA);
  if (!oznaka) return [];
  const ostatakOpisa = opis.slice(oznaka.index + oznaka[0].length);
  const okidaci = [];
  for (const m of ostatakOpisa.matchAll(/"([^"]*)"/g)) {
    okidaci.push(m[1]);
  }
  return okidaci;
}

// Ove fraze u praksi oznacavaju da skill nije za klijentski razgovor. Namjerno usko: bolje
// propustiti oznaku nego oznaciti klijentski skill kao admin-only.
const SAMO_ADMIN_OBRASCI = [
  /samo\s+(?:za\s+)?admin\s+sesij/i,
  /ne\s+za\s+razgovor\s+sa\s+klijentom/i,
];

function jeSamoAdmin(opis) {
  return SAMO_ADMIN_OBRASCI.some((obrazac) => obrazac.test(opis));
}

/**
 * Skuplja sve skillove iz `.claude/skills/<ime>/SKILL.md`. Svaki podfolder je jedan skill; prazan
 * rezultat znaci da je korijen pogresan ili da su skillovi nestali, pa se tretira kao greska a
 * ne kao legitiman "nema nista".
 */
export function skupiSkillove(korijen) {
  const koriSkillova = join(korijen, ".claude", "skills");
  const folderi = readdirSync(koriSkillova, { withFileTypes: true })
    .filter((unos) => unos.isDirectory())
    .map((unos) => unos.name);

  if (folderi.length === 0) {
    throw new Error(`Nema nijednog skilla u ${koriSkillova}`);
  }

  const skillovi = folderi.map((folder) => {
    const putanja = join(koriSkillova, folder, "SKILL.md");
    const tekst = readFileSync(putanja, "utf8");
    const { polja } = citajFrontmatter(tekst);

    const ime = polja.name ?? folder;
    if (polja.name && polja.name !== folder) {
      throw new Error(
        `Skill "${folder}": frontmatter name "${polja.name}" se ne poklapa sa imenom foldera. ` +
          `To lomi ucitavanje skilla, ne samo popis.`,
      );
    }

    const opis = polja.description ?? "";
    return {
      ime,
      opis,
      okidaci: izvuciOkidace(opis),
      samoAdmin: jeSamoAdmin(opis),
    };
  });

  skillovi.sort(poPolju("ime"));
  return skillovi;
}

/**
 * Skuplja sve podagente iz `.claude/agents/*.md`. Svaki fajl je jedan agent; prazan rezultat je
 * greska iz istog razloga kao kod skillova.
 */
export function skupiAgente(korijen) {
  const koriAgenata = join(korijen, ".claude", "agents");
  const fajlovi = readdirSync(koriAgenata, { withFileTypes: true })
    .filter((unos) => unos.isFile() && unos.name.endsWith(".md"))
    .map((unos) => unos.name);

  if (fajlovi.length === 0) {
    throw new Error(`Nema nijednog agenta u ${koriAgenata}`);
  }

  const agenti = fajlovi.map((fajl) => {
    const putanja = join(koriAgenata, fajl);
    const tekst = readFileSync(putanja, "utf8");
    const { polja } = citajFrontmatter(tekst);

    const imeIzFajla = fajl.slice(0, -".md".length);
    const ime = polja.name ?? imeIzFajla;
    if (polja.name && polja.name !== imeIzFajla) {
      throw new Error(
        `Agent "${fajl}": frontmatter name "${polja.name}" se ne poklapa sa imenom fajla.`,
      );
    }

    const alati = polja.tools
      ? polja.tools
          .split(",")
          .map((alat) => alat.trim())
          .filter((alat) => alat.length > 0)
      : [];

    return {
      ime,
      opis: polja.description ?? "",
      alati,
      model: polja.model,
    };
  });

  agenti.sort(poPolju("ime"));
  return agenti;
}
