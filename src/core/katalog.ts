// Citanje vanjskog kataloga artikala (zaliha klijenta izvan platforme).
//
// Katalog se dobavlja izvan ovog alata i predaje kao fajl, pa repo ne nosi kredencijale ni jednog
// vanjskog sistema. Prihvataju se dva oblika, jer klijenti imaju razlicite sisteme:
//
// 1. JSON: niz artikala ili { products: [...] }. Polja mogu biti u engleskom obliku (handle, title,
//    skus, totalInventory, price) ili u neutralnom (sifra, naziv, zaliha, cijena).
// 2. CSV sa zaglavljem koje sadrzi kolone sifra, naziv, zaliha, cijena. Imena kolona se citaju bez
//    obzira na velika slova, razmake i crtice, i priznaju se ceste engleske varijante.
//
// Brojevi se citaju tolerantno: prazna zaliha je nepoznata (null), a decimalni zarez se prihvata
// jer ga lokalizovani izvozi salju ("12,50"). Nepoznata zaliha NIJE nula: nula bi znacila
// "nema na stanju" i vodila na skrivanje oglasa koji je mozda pun.

import { readFileSync } from "node:fs";
import type { KatalogItem } from "./match.js";

export function brojIliNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const ocisceno = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!ocisceno) return null;
  const broj = Number(ocisceno);
  return Number.isFinite(broj) ? broj : null;
}

// Minimalni CSV citac: podrzava navodnike i "" kao escape unutar navodnika, te CRLF.
export function parseCsv(text: string): string[][] {
  const redovi: string[][] = [];
  let red: string[] = [];
  let polje = "";
  let uNavodnicima = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (uNavodnicima) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          polje += '"';
          i++;
        } else {
          uNavodnicima = false;
        }
      } else {
        polje += ch;
      }
      continue;
    }
    if (ch === '"') {
      uNavodnicima = true;
    } else if (ch === ",") {
      red.push(polje);
      polje = "";
    } else if (ch === "\n") {
      red.push(polje);
      polje = "";
      if (red.some((c) => c.trim() !== "")) redovi.push(red);
      red = [];
    } else if (ch !== "\r") {
      polje += ch;
    }
  }
  red.push(polje);
  if (red.some((c) => c.trim() !== "")) redovi.push(red);
  return redovi;
}

const KOLONE: Record<string, string[]> = {
  sifra: ["sifra", "šifra", "sku", "kod", "code", "handle", "slug", "id"],
  naziv: ["naziv", "ime", "title", "name", "proizvod"],
  zaliha: ["zaliha", "stanje", "kolicina", "količina", "inventory", "stock", "quantity", "totalinventory"],
  cijena: ["cijena", "price", "cena"],
};

function kljucKolone(naziv: string): string | undefined {
  const cist = naziv.trim().toLowerCase().replace(/[\s_-]/g, "");
  for (const [kljuc, varijante] of Object.entries(KOLONE)) {
    if (varijante.some((v) => v.replace(/[\s_-]/g, "") === cist)) return kljuc;
  }
  return undefined;
}

export function katalogIzCsv(text: string, izvor = "katalog.csv"): KatalogItem[] {
  const redovi = parseCsv(text);
  const zaglavlje = redovi.shift();
  if (!zaglavlje) throw new Error(`CSV katalog ${izvor} je prazan.`);

  const mapa = new Map<string, number>();
  zaglavlje.forEach((naziv, i) => {
    const kljuc = kljucKolone(naziv);
    if (kljuc && !mapa.has(kljuc)) mapa.set(kljuc, i);
  });
  if (!mapa.has("sifra") && !mapa.has("naziv")) {
    throw new Error(
      `CSV katalog ${izvor} mora imati bar kolonu sifra ili naziv. Nadjeno zaglavlje: ${zaglavlje.join(", ")}.`,
    );
  }

  const artikli: KatalogItem[] = [];
  for (const red of redovi) {
    const uzmi = (kljuc: string): string => {
      const i = mapa.get(kljuc);
      return i === undefined ? "" : (red[i] ?? "").trim();
    };
    const sifra = uzmi("sifra");
    const naziv = uzmi("naziv");
    if (!sifra && !naziv) continue;
    artikli.push({
      handle: sifra || naziv,
      title: naziv || sifra,
      skus: sifra ? [sifra] : [],
      totalInventory: brojIliNull(uzmi("zaliha")),
      price: brojIliNull(uzmi("cijena")),
    });
  }
  return artikli;
}

export function katalogIzJson(raw: unknown, izvor = "katalog.json"): KatalogItem[] {
  const list = Array.isArray(raw) ? raw : (raw as { products?: unknown }).products;
  if (!Array.isArray(list)) {
    throw new Error(`JSON katalog ${izvor} nije niz artikala ni { products: [...] }.`);
  }
  return list.map((entry) => {
    const item = entry as Record<string, unknown>;
    const sifra = item.handle ?? item.sifra ?? item.sku ?? "";
    const naziv = item.title ?? item.naziv ?? "";
    const skus = Array.isArray(item.skus)
      ? item.skus.filter((x): x is string => typeof x === "string")
      : typeof item.sku === "string"
        ? [item.sku]
        : typeof item.sifra === "string"
          ? [item.sifra]
          : [];
    return {
      handle: String(sifra),
      title: String(naziv),
      skus,
      totalInventory: brojIliNull(item.totalInventory ?? item.zaliha ?? item.stanje),
      price: brojIliNull(item.price ?? item.cijena),
    };
  });
}

export function loadKatalog(path: string): KatalogItem[] {
  const text = readFileSync(path, "utf8");
  if (path.toLowerCase().endsWith(".csv")) return katalogIzCsv(text, path);
  return katalogIzJson(JSON.parse(text), path);
}
