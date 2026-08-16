// Referentna (stock) fotografija sa interneta za NOV, ZAPAKOVAN artikal poznatog modela.
//
// Zasto ovaj modul postoji i zasto je ovako uzak: klijent koji prodaje nov zapakovan telefon
// nema sta da fotografise osim kutije, a kupac trazi sliku modela. Vlasnik je 16.08.2026. donio
// odluku da se taj put otvori. Odluka je njegova i zapisana je u granice.md; ovaj modul je samo
// sprovodi, i sprovodi je usko.
//
// Izvor je Wikimedia Commons, i to nije proizvoljan izbor nego glavna zastita:
//
//   - Slike na Commonsu nose EKSPLICITNU slobodnu licencu (CC BY, CC BY-SA, javno dobro), koja
//     se cita iz istog odgovora i vraca korisniku. Proizvodjacka fotografija sa web shopa je
//     tudje autorsko djelo bez ikakve dozvole; Commons slika je djelo sa dozvolom i uslovom
//     (atribucija). Razlika je pravna, ne kozmeticka.
//   - Cijela pretraga i cijelo preuzimanje staju na DVA hosta, pa allowlista ima smisla i SSRF
//     povrsina je jedna tacka, a ne otvoren internet.
//   - API nema kljuc i nema trosak, pa ovaj tok ne otvara nov racun ni nov plafon.
//
// Sta ovo NE rjesava, i mora se reci naglas: atribucija (ime autora i licenca) je USLOV licence.
// Bot je ispisuje uz svaku sliku, ali je u oglas upisuje covjek. Odgovornost za pravo koristenja
// slike u oglasu nosi oglasivac, ne bot.
//
// Pokrivenost je ogranicena: poznati modeli telefona i tehnike po pravilu postoje, obican artikal
// ne. Kad nema pogotka, odgovor je "nema", nikad izmisljen URL.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { MAX_BAJTA_SLIKE } from "./arhiva.js";
import type { ListingState } from "./types.js";

/** Host sa kojeg se PRETRAZUJE. Odvojen od hosta sa kojeg se preuzima, jer to i jesu dva hosta. */
export const HOST_PRETRAGE = "commons.wikimedia.org";

/**
 * Hostovi sa kojih se smije PREUZETI slika. Tacno poredjenje imena hosta, nikad `endsWith`:
 * `endsWith("wikimedia.org")` bi propustio `upload.wikimedia.org.napadac.com`.
 *
 * Lista se moze prosiriti kroz `OLX_STOCK_HOSTOVI` u `.env`, dakle rukom administratora na
 * masini, nikad kroz razgovor. Svaki dopisan host je svjesno prosirenje i autorskog i SSRF
 * rizika, pa mu je mjesto tamo gdje stoji i OLX token, a ne u poruci korisnika.
 */
export const ZADANI_HOSTOVI = ["upload.wikimedia.org"] as const;

export function dozvoljeniHostovi(env: NodeJS.ProcessEnv = process.env): string[] {
  const dodatni = (env.OLX_STOCK_HOSTOVI ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...ZADANI_HOSTOVI, ...dodatni];
}

export type NalazUrla = { ok: true; url: URL } | { ok: false; razlog: string };

/**
 * Da li se sa ovog URL-a smije preuzeti slika. Cista funkcija, bez mreze.
 *
 * Redom se odbija ono cime bi se allowlista zaobisla: druga shema (`file:` cita disk servera,
 * `data:` ubacuje sadrzaj bez ikakvog hosta), korisnik i lozinka u URL-u (neki klijenti ih
 * salju kao Authorization), i svaki host koji nije DOSLOVNO na spisku.
 */
export function provjeriUrl(url: string, dozvoljeni: string[] = dozvoljeniHostovi()): NalazUrla {
  let parsiran: URL;
  try {
    parsiran = new URL(url);
  } catch {
    return { ok: false, razlog: "nije ispravan URL" };
  }
  if (parsiran.protocol !== "https:") {
    return { ok: false, razlog: `shema "${parsiran.protocol}" nije dozvoljena, samo https` };
  }
  if (parsiran.username || parsiran.password) {
    return { ok: false, razlog: "URL nosi korisnika ili lozinku, to se ne preuzima" };
  }
  const host = parsiran.hostname.toLowerCase();
  if (!dozvoljeni.includes(host)) {
    return { ok: false, razlog: `host "${host}" nije na spisku dozvoljenih (${dozvoljeni.join(", ")})` };
  }
  return { ok: true, url: parsiran };
}

/**
 * Format slike po MAGIC BAJTOVIMA, ne po ekstenziji ni po `content-type` zaglavlju. Oboje pise
 * druga strana, pa ni jedno ni drugo nije dokaz: odgovor `text/html` (stranica greske) inace
 * zavrsi na disku kao `01.jpg` i padne tek na uploadu.
 *
 * SVG se NAMJERNO ne prepoznaje kao slika iako ga Commons vraca: SVG je dokument koji moze
 * nositi skriptu, a OLX ga ionako ne prima.
 */
export function prepoznajSliku(bafer: Buffer | Uint8Array): string | null {
  const b = bafer;
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  const riff = b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
  const webp = b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  if (riff && webp) return "image/webp";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  return null;
}

export type NalazStanja = { ok: true } | { ok: false; razlog: string };

/**
 * Brana stanja artikla. Stock slika prikazuje MODEL, ne bas taj primjerak, pa na polovnom
 * artiklu laze kupca o ogrebotinama i habanju upravo te stvari koju kupuje.
 *
 * `state` na oglasu je enum ("new" / "used"), ali je opcionalan i cesto ga jos nema, jer se slika
 * bira PRIJE nego oglas postoji. Zato isti obrazac kao "nepoznata cijena je naplatna" iz
 * granice.md: nepoznato stanje se ne tumaci u korist prolaza, nego trazi da covjek izricito kaze
 * da je artikal nov i zapakovan, i da to potvrdi.
 */
export function provjeriStanjeArtikla(p: {
  /** Stanje sa postojeceg oglasa, kad oglas vec postoji. */
  state?: ListingState;
  /** Sta je korisnik izricito rekao za artikal koji tek objavljuje. */
  stanje?: ListingState;
  confirm?: boolean;
}): NalazStanja {
  const poznato = p.state ?? p.stanje;
  if (poznato === "used") {
    return {
      ok: false,
      razlog:
        "artikal je polovan, a referentna slika prikazuje model a ne bas taj primjerak; polovan artikal " +
        "se slika onakav kakav jeste",
    };
  }
  if (p.state === "new") return { ok: true };
  if (p.stanje === "new") {
    if (!p.confirm) {
      return {
        ok: false,
        razlog: "stanje artikla nije potvrdjeno; ponovi sa confirm true tek kad korisnik kaze da je artikal nov i zapakovan",
      };
    }
    return { ok: true };
  }
  return {
    ok: false,
    razlog:
      "stanje artikla nije poznato; referentna slika se koristi samo za nov, zapakovan artikal, pa zadaj " +
      'stanje "new" i potvrdu',
  };
}

export interface Kandidat {
  naslov: string;
  /** URL sa kojeg se preuzima; uvijek umanjena verzija, original zna biti i preko 8 MB. */
  url: string;
  /** Stranica opisa na Commonsu, za covjeka koji hoce provjeriti izvor. */
  izvorStranica: string;
  mime: string;
  sirina: number;
  visina: number;
  bajtova: number;
  licenca: string;
  autor: string;
}

/** HTML iz `extmetadata` (autor dolazi kao `<a href=...>Ime</a>`) sveden na goli tekst. */
function bezHtmla(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const MAKS_KANDIDATA = 3;

/**
 * Kandidati za pojam, sa licencom i autorom. Trazi se po imenu modela, pa je pojam ono sto je
 * korisnik rekao ("iPhone 15 Pro"), ne opis oglasa.
 *
 * `iiurlwidth` trazi umanjenu verziju i Commons vrati `thumburl`; taj URL se NE sastavlja rucno
 * (izmjereno 16.08.2026: rucno slozen thumb put vraca 400), nego se uzima iz odgovora.
 */
export async function traziKandidate(
  pojam: string,
  opts: { fetchFn?: typeof fetch; limit?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<Kandidat[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const limit = Math.min(opts.limit ?? MAKS_KANDIDATA, 10);
  const upit = new URL(`https://${HOST_PRETRAGE}/w/api.php`);
  upit.searchParams.set("action", "query");
  upit.searchParams.set("format", "json");
  upit.searchParams.set("generator", "search");
  upit.searchParams.set("gsrsearch", pojam);
  // namespace 6 je File:, inace pretraga vrati clanke umjesto slika
  upit.searchParams.set("gsrnamespace", "6");
  upit.searchParams.set("gsrlimit", String(limit * 3));
  upit.searchParams.set("prop", "imageinfo");
  upit.searchParams.set("iiprop", "url|size|mime|extmetadata");
  upit.searchParams.set("iiurlwidth", "1200");

  const odgovor = await fetchFn(upit.toString(), {
    headers: { "user-agent": "olx-pik-toolkit (interni alat za oglase)" },
  });
  if (!odgovor.ok) throw new Error(`Pretraga referentnih slika nije prosla: HTTP ${odgovor.status}.`);
  const tijelo = (await odgovor.json()) as {
    query?: { pages?: Record<string, unknown> };
  };
  const stranice = Object.values(tijelo.query?.pages ?? {}) as Array<{
    title?: string;
    imageinfo?: Array<{
      url?: string;
      thumburl?: string;
      descriptionurl?: string;
      mime?: string;
      thumbwidth?: number;
      thumbheight?: number;
      size?: number;
      extmetadata?: Record<string, { value?: unknown }>;
    }>;
  }>;

  const kandidati: Kandidat[] = [];
  for (const s of stranice) {
    const ii = s.imageinfo?.[0];
    if (!ii) continue;
    // SVG i sve sto nije rasterska slika otpada odmah: OLX ga ne prima, a magic bajtovi bi ga
    // ionako odbili poslije preuzimanja. Bolje da ne trosimo preuzimanje.
    if (ii.mime !== "image/jpeg" && ii.mime !== "image/png" && ii.mime !== "image/webp") continue;
    const url = ii.thumburl ?? ii.url;
    if (!url) continue;
    const em = ii.extmetadata ?? {};
    kandidati.push({
      naslov: String(s.title ?? "").replace(/^File:/, ""),
      url,
      izvorStranica: ii.descriptionurl ?? `https://${HOST_PRETRAGE}/wiki/${encodeURIComponent(String(s.title ?? ""))}`,
      mime: ii.mime,
      sirina: ii.thumbwidth ?? 0,
      visina: ii.thumbheight ?? 0,
      bajtova: ii.size ?? 0,
      licenca: bezHtmla(String(em.LicenseShortName?.value ?? "")) || "licenca nije navedena",
      autor: bezHtmla(String(em.Artist?.value ?? "")) || "autor nije naveden",
    });
    if (kandidati.length >= limit) break;
  }
  return kandidati;
}

export interface PreuzetaSlika {
  putanja: string;
  mime: string;
  bajtova: number;
  /** Doslovan URL sa kojeg je slika stigla; ide u trag i u audit zapis. */
  izvorUrl: string;
}

/**
 * Preuzimanje jednog kandidata. Nije `preuzmiSlike` iz arhiva.ts namjerno: ta funkcija je pisana
 * za URL-ove sa OLX CDN-a koje je vratio OLX, pa nema ni provjeru hosta ni provjeru sadrzaja, i
 * na proizvoljnom URL-u bi bila otvoren SSRF put iz MCP servera.
 *
 * Redirekcije se NE prate (`redirect: "manual"`): allowlista koja pusta prvi skok a onda ide
 * kuda je server rekao nije allowlista.
 */
export async function preuzmiKandidata(
  url: string,
  mapa: string,
  opts: { fetchFn?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<PreuzetaSlika> {
  const env = opts.env ?? process.env;
  const nalaz = provjeriUrl(url, dozvoljeniHostovi(env));
  if (!nalaz.ok) throw new Error(`Slika se ne preuzima: ${nalaz.razlog}.`);

  const fetchFn = opts.fetchFn ?? fetch;
  const odgovor = await fetchFn(nalaz.url.toString(), {
    redirect: "manual",
    headers: { "user-agent": "olx-pik-toolkit (interni alat za oglase)" },
  });
  if (odgovor.status >= 300 && odgovor.status < 400) {
    throw new Error("Slika se ne preuzima: izvor preusmjerava, a preusmjerenja se ne prate.");
  }
  if (!odgovor.ok) throw new Error(`Slika se ne preuzima: HTTP ${odgovor.status}.`);

  const najavljeno = Number(odgovor.headers.get("content-length"));
  if (Number.isFinite(najavljeno) && najavljeno > MAX_BAJTA_SLIKE) {
    throw new Error(`Slika najavljuje ${najavljeno} bajta, granica je ${MAX_BAJTA_SLIKE}.`);
  }
  const bafer = Buffer.from(await odgovor.arrayBuffer());
  if (bafer.length > MAX_BAJTA_SLIKE) {
    throw new Error(`Slika ima ${bafer.length} bajta, granica je ${MAX_BAJTA_SLIKE}.`);
  }

  const mime = prepoznajSliku(bafer);
  if (!mime) {
    throw new Error("Preuzeti sadrzaj nije slika (provjereno po sadrzaju, ne po ekstenziji).");
  }

  const nastavak = mime === "image/jpeg" ? "jpg" : mime.slice("image/".length);
  const pecat = new Date().toISOString().replace(/[:.]/g, "-");
  mkdirSync(mapa, { recursive: true });
  const putanja = resolve(mapa, `stock-${pecat}-${Math.random().toString(36).slice(2, 7)}.${nastavak}`);
  writeFileSync(putanja, bafer);
  return { putanja, mime, bajtova: bafer.length, izvorUrl: nalaz.url.toString() };
}
