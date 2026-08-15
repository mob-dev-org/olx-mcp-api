// Sitni citac i pisac .env fajla, bez zavisnosti.
//
// Zasto ne process.loadEnvFile: puller obradjuje vise klonova u jednom procesu, a loadEnvFile
// puni globalni process.env i ne prepisuje vec postavljeno, pa bi se klonovi mijesali. Ovdje se
// vrijednosti citaju eksplicitno iz fajla i prosljedjuju kao argumenti, bez globalnog stanja.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

// Ulazne skripte (cuvar-sesije, pokreni-klijenta, ...) i dalje zele globalni process.env, isti
// obrazac kao process.loadEnvFile. Bun tu funkciju NEMA (izmjereno 15.08.2026: TypeError, "is not
// a function"), ali to je bezopasno: Bun SAM, prije nego ijedna linija skripte krene, ucita .env
// iz tekuceg direktorija u process.env (nativna Bun osobina, bez ikakvog poziva). Zato je pod
// Bunom ova funkcija no-op; poziv postoji samo da Node put (npr. dok wrangler jos trazi Node)
// ostane identican kao prije.
export function ucitajEnvGlobalno(putanja) {
  if (typeof process.loadEnvFile !== "function") return; // Bun: vec ucitano, nema sta raditi
  try {
    process.loadEnvFile(putanja);
  } catch {
    // postojanje .env se provjerava dalje niz kod, sa jasnom porukom
  }
}

// Procitaj .env u mapu. Zadnja definicija kljuca pobjedjuje (isto kao `grep ... | tail -1`).
export function procitajEnv(putanja) {
  const mapa = {};
  if (!existsSync(putanja)) return mapa;
  for (const linija of readFileSync(putanja, "utf8").split(/\r?\n/)) {
    const t = linija.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    mapa[t.slice(0, eq).trim()] = t.slice(eq + 1);
  }
  return mapa;
}

// Postavi (ili zamijeni) jedan kljuc, cuvajuci ostale linije i komentare. Vrijednost ide sirova,
// bez navodnika, tacno kako .env.example drzi OLX_TOKEN.
export function postaviKljuc(putanja, kljuc, vrijednost) {
  const linije = existsSync(putanja) ? readFileSync(putanja, "utf8").split(/\r?\n/) : [];
  const nova = `${kljuc}=${vrijednost}`;
  let nadjeno = false;
  for (let i = 0; i < linije.length; i++) {
    const t = linije[i].trim();
    if (t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq > 0 && t.slice(0, eq).trim() === kljuc) {
      linije[i] = nova;
      nadjeno = true;
      break;
    }
  }
  if (!nadjeno) {
    if (linije.length && linije[linije.length - 1] === "") linije.splice(linije.length - 1, 0, nova);
    else linije.push(nova);
  }
  let izlaz = linije.join("\n");
  if (!izlaz.endsWith("\n")) izlaz += "\n";
  writeFileSync(putanja, izlaz);
}
