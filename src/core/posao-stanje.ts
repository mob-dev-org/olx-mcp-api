// Ishod ZADNJEG pokretanja svakog zakazanog posla (`posao snapshot`, kasnije i `dnevni`,
// `sedmicni`, `backup`), da bi se poslije pada moglo javiti administratoru kad se posao OPORAVI.
//
// Zasto poseban fajl a ne prosirenje audit loga: audit je istorijski trag (nikad se ne cita
// unazad radi "sta je bilo prosli put"), a ovdje treba tacno JEDNO stanje po poslu, prepisano na
// svako pokretanje. Trazenje zadnjeg zapisa u audit.jsonl bi znacilo parsiranje cijelog fajla za
// pitanje na koje mapa odgovara u jednom citanju.
//
// Oblik fajla je mapa ime posla -> zapis (ne jedan zapis za "snapshot"), da isti fajl kasnije
// primi i ostale poslove bez migracije formata: svaki novi posao samo dodaje svoj kljuc.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface PosaoZapis {
  ishod: "ok" | "pad";
  /** Unix sekunde. */
  ts: number;
  /** Samo kad ishod === "pad". Skraceno pri upisu, vidi DUZINA_GRESKE. */
  greska?: string;
}

export type PosaoStanje = Record<string, PosaoZapis>;

// Poruke greske znaju nositi cijeli stack trace; fajl ne smije rasti od toga, a admin poruka o
// oporavku treba samo prepoznatljiv opis proslog pada, ne cijeli izvjestaj.
const DUZINA_GRESKE = 300;

export function putanjaPosaoStanja(env: NodeJS.ProcessEnv = process.env): string {
  return env.OLX_POSAO_STANJE_FILE || ".olx-pik/posao-stanje.json";
}

function jeZapis(x: unknown): x is PosaoZapis {
  if (!x || typeof x !== "object") return false;
  const z = x as Partial<PosaoZapis>;
  if (z.ishod !== "ok" && z.ishod !== "pad") return false;
  if (typeof z.ts !== "number") return false;
  if (z.greska !== undefined && typeof z.greska !== "string") return false;
  return true;
}

// Nepostojeci, necitljiv ili pokvaren fajl vraca prazno stanje umjesto da baci: pozivalac
// (cron posao) ne smije pasti samo zato sto se ne moze procitati proslo stanje. Isti obrazac
// kao ucitajSnapshotUToku u snapshoti.ts.
export function ucitajPosaoStanje(putanja: string = putanjaPosaoStanja()): PosaoStanje {
  let sadrzaj: string;
  try {
    sadrzaj = readFileSync(putanja, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(sadrzaj) as unknown;
    if (!parsed || typeof parsed !== "object") {
      console.error(`Stanje poslova (${putanja}) nije ocekivanog oblika, odbacujem.`);
      return {};
    }
    const rezultat: PosaoStanje = {};
    // Zapis jednog posla koji nije ocekivanog oblika se preskace, a ne obara citanje cijelog
    // fajla: ostali poslovi u istoj mapi ostaju citljivi.
    for (const [ime, zapis] of Object.entries(parsed as Record<string, unknown>)) {
      if (jeZapis(zapis)) rezultat[ime] = zapis;
      else console.error(`Zapis posla "${ime}" u ${putanja} nije ocekivanog oblika, preskacem.`);
    }
    return rezultat;
  } catch {
    console.error(`Stanje poslova (${putanja}) nije citljiv JSON, odbacujem.`);
    return {};
  }
}

export function procitajIshodPosla(ime: string, putanja: string = putanjaPosaoStanja()): PosaoZapis | null {
  return ucitajPosaoStanje(putanja)[ime] ?? null;
}

/**
 * Upisuje ishod JEDNOG posla, cuvajuci zapise svih ostalih poslova iz istog fajla (procitaj,
 * spoji, upisi). Nikad ne prepisuje cijeli fajl samo svojim poslom, jer bi to obrisalo stanje
 * poslova koji jos nisu pokrenuti u ovom prolazu.
 *
 * Upis je best effort: greska ovdje NE SMIJE oboriti posao koji je svoj dio vec zavrsio (upisan
 * snapshot, poslata obnova...). Posljedica neuspjeha je da se propusti najvise JEDNA sljedeca
 * obavijest o oporavku, sto je manja steta od toga da uspjesan posao zavrsi sa greskom.
 */
export function zapisiIshodPosla(ime: string, zapis: PosaoZapis, putanja: string = putanjaPosaoStanja()): void {
  try {
    const stanje = ucitajPosaoStanje(putanja);
    const skraceno: PosaoZapis = {
      ishod: zapis.ishod,
      ts: zapis.ts,
      ...(zapis.greska !== undefined ? { greska: zapis.greska.slice(0, DUZINA_GRESKE) } : {}),
    };
    stanje[ime] = skraceno;
    mkdirSync(dirname(putanja), { recursive: true });
    const tmp = `${putanja}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(stanje, null, 2)}\n`, "utf8");
    renameSync(tmp, putanja); // atomicno, isti obrazac kao izuzeca.ts i plan-fajl.ts
  } catch (e) {
    console.error(`Upis stanja posla "${ime}" nije uspio: ${String(e instanceof Error ? e.message : e)}`);
  }
}

/**
 * Cista funkcija odluke: obavijest o oporavku ide TACNO kad je prethodno pokretanje ISTOG posla
 * palo. Nema prethodnog zapisa (prvi put, ili fajl izgubljen) i prethodni "ok" oboje daju false,
 * jer obavijest o oporavku ima smisla samo kao suprotnost od poznatog pada, ne kao svakodnevna
 * potvrda uspjeha.
 */
export function trebaObavijestOOporavku(prethodni: PosaoZapis | null): boolean {
  return prethodni?.ishod === "pad";
}
