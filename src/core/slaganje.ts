// Deterministicko slaganje artikla na stalnu pozadinu klijenta.
//
// Zasto postoji: generisanje pozadine iznova (recept pozadina-klijenta do v0.12) davalo je
// SLICNU pozadinu, nikad istu, a tekst i logo su ispadali iskrivljeni. Ovaj modul radi obrnuto:
// fotografija artikla se IZREZE (segmentacija u kodu), pa se zalijepi na pravu sliku pozadine.
// Pikseli pozadine i loga ostaju netaknuti. Gemini poslije samo doradjuje svjetlo i sjenu, i ta
// doradjena varijanta garanciju nema; obje idu klijentu (vidi slika.ts).
//
// Format je UVIJEK 4:3 (odluka vlasnika 04.08.2026): platno je normalizovana pozadina
// 1600x1200, dorada ide sa aspectRatio 4:3, argument odnosa se za ovaj recept odbija.
//
// Slojevi: cista geometrija (izracunajPolozaj, izracunajIzrez4x3, provjeriSlot) je odvojena od
// I/O omotaca koji jedini diraju sharp i @imgly/background-removal-node. Te dvije zavisnosti se
// uvoze ISKLJUCIVO dinamicki: jezgro, testovi i svi ostali recepti rade i na masini gdje ih
// nema, a slaganje tada pada na jasnu poruku kroz slaganjeDostupno().

export interface Slot {
  /** v1 podrzava samo "dno-sredina" (artikal na podiju); enum ostavljen za sirenje. */
  sidro: "dno-sredina";
  /** Koliki dio SIRINE platna artikal zauzima. */
  sirinaPosto: number;
  /** Odmak donje ivice artikla od dna platna, u procentima visine platna. */
  marginaDnaPosto: number;
}

export const ZADANI_SLOT: Slot = { sidro: "dno-sredina", sirinaPosto: 45, marginaDnaPosto: 8 };

/**
 * Platno slozene slike, uvijek 4:3. 1600x1200 je iznad Gemini 4:3 izlaza i dovoljno za OLX;
 * manja pozadina se uvecava (cover), pa upozorenje pri postavljanju kad je original preuzak.
 */
export const PLATNO_4_3 = { sirina: 1600, visina: 1200 } as const;

/**
 * Gornja margina pri klampu visokog artikla. Namjerno velika: logo i natpis na pozadini po
 * pravilu stoje u gornjoj trecini kadra (izmjereno na prvoj klijentskoj pozadini), pa visok
 * artikal ne smije preko njih. Artikal time zauzima najvise ~64% visine kadra, sto je i inace
 * prirodna kompozicija na podiju; ko zeli vise, spusta marginu dna kroz slot.
 */
const GORNJA_MARGINA_POSTO = 28;

export const SLOT_SIRINA_MIN = 10;
export const SLOT_SIRINA_MAX = 90;
export const SLOT_MARGINA_MIN = 0;
export const SLOT_MARGINA_MAX = 30;

export type NalazSlota = { ok: true } | { ok: false; razlog: string };

export function provjeriSlot(slot: Slot): NalazSlota {
  if (slot.sidro !== "dno-sredina") {
    return { ok: false, razlog: `sidro "${String(slot.sidro)}" nije podrzano; postoji samo "dno-sredina"` };
  }
  if (!Number.isFinite(slot.sirinaPosto) || slot.sirinaPosto < SLOT_SIRINA_MIN || slot.sirinaPosto > SLOT_SIRINA_MAX) {
    return { ok: false, razlog: `sirina artikla mora biti ${SLOT_SIRINA_MIN} do ${SLOT_SIRINA_MAX} posto sirine kadra` };
  }
  if (!Number.isFinite(slot.marginaDnaPosto) || slot.marginaDnaPosto < SLOT_MARGINA_MIN || slot.marginaDnaPosto > SLOT_MARGINA_MAX) {
    return { ok: false, razlog: `margina od dna mora biti ${SLOT_MARGINA_MIN} do ${SLOT_MARGINA_MAX} posto visine kadra` };
  }
  return { ok: true };
}

export interface Dimenzije {
  sirina: number;
  visina: number;
}

export interface Izrez4x3 {
  lijevo: number;
  gore: number;
  sirina: number;
  visina: number;
  /** Koliko povrsine originala crop odsijeca; iznad ~20 se klijentu kaze da bira siru sliku. */
  odsjecenoPosto: number;
}

/** Centralni isjecak na 4:3, za normalizaciju pozadine. Cista geometrija, bez piksela. */
export function izracunajIzrez4x3(sirina: number, visina: number): Izrez4x3 | null {
  if (!Number.isFinite(sirina) || !Number.isFinite(visina) || sirina <= 0 || visina <= 0) return null;
  const cilj = 4 / 3;
  let novaSirina = sirina;
  let novaVisina = visina;
  if (sirina / visina > cilj) {
    novaSirina = Math.round(visina * cilj);
  } else {
    novaVisina = Math.round(sirina / cilj);
  }
  const odsjeceno = 1 - (novaSirina * novaVisina) / (sirina * visina);
  return {
    lijevo: Math.floor((sirina - novaSirina) / 2),
    gore: Math.floor((visina - novaVisina) / 2),
    sirina: novaSirina,
    visina: novaVisina,
    odsjecenoPosto: Math.round(odsjeceno * 1000) / 10,
  };
}

export interface Polozaj {
  lijevo: number;
  gore: number;
  sirina: number;
  visina: number;
}

/**
 * Gdje i koliki artikal ide na platno: ciljna sirina iz slota, visina proporcionalno, donja
 * ivica na margini od dna, horizontalno centrirano. Visok artikal (uspravna friteza, ormar) se
 * klampuje po visini da ne izadje iz kadra, pa ispadne uzi od trazene sirine: proporcije se
 * NIKAD ne krive.
 */
export function izracunajPolozaj(platno: Dimenzije, artikal: Dimenzije, slot: Slot): Polozaj {
  const ciljnaSirina = Math.round((platno.sirina * slot.sirinaPosto) / 100);
  let sirina = ciljnaSirina;
  let visina = Math.round((artikal.visina * ciljnaSirina) / artikal.sirina);

  const marginaDna = Math.round((platno.visina * slot.marginaDnaPosto) / 100);
  const gornjaMargina = Math.round((platno.visina * GORNJA_MARGINA_POSTO) / 100);
  const maxVisina = platno.visina - marginaDna - gornjaMargina;
  if (visina > maxVisina) {
    sirina = Math.max(1, Math.round((artikal.sirina * maxVisina) / artikal.visina));
    visina = maxVisina;
  }

  return {
    lijevo: Math.round((platno.sirina - sirina) / 2),
    gore: platno.visina - marginaDna - visina,
    sirina,
    visina,
  };
}

// ---- I/O omotaci: jedina mjesta koja diraju sharp i imgly ----

async function ucitajSharp(): Promise<typeof import("sharp")> {
  const modul = (await import("sharp")) as unknown as { default?: typeof import("sharp") } & typeof import("sharp");
  // sharp je CJS: kroz dinamicki import zna doci i kao modul i kao { default: modul }.
  return modul.default ?? modul;
}

/**
 * Da li je slaganje uopste moguce na ovoj masini. Zavisnosti su teske (imgly i onnxruntime po
 * preko 130 MB) i dolaze sa `bun install`; na klonu gdje ih nema, poruka kaze tacno sta fali.
 *
 * Zasto bas ovako pod Bunom (izmjereno 16.08.2026): imgly pinuje svoj `sharp@0.32`, koji binarni
 * dio jos vuce install skriptom, pa `bun install` pokusa build from source i padne. Zato u
 * `package.json` stoje `overrides.sharp` (imgly time koristi korijenski sharp 0.34 sa gotovim
 * `@img/*` binarima) i prazan `trustedDependencies` (nijedna postinstall skripta se ne pokrece).
 * Ako neko te dvije stavke ukloni, ova provjera ce prva prijaviti posljedicu.
 */
export async function slaganjeDostupno(): Promise<{ ok: true } | { ok: false; razlog: string }> {
  try {
    await import("sharp");
  } catch {
    return { ok: false, razlog: "sharp nije instaliran ili nema binarni dio; pokreni bun install u klonu" };
  }
  try {
    await import("@imgly/background-removal-node");
  } catch {
    return { ok: false, razlog: "@imgly/background-removal-node nije instaliran; pokreni bun install u klonu" };
  }
  return { ok: true };
}

/**
 * Izrez artikla sa fotografije: segmentacija (imgly, ONNX model dolazi u npm paketu pa radi i
 * bez interneta), pa odsijecanje prozirnih ivica. Vraca PNG sa alpha kanalom. Traje sekundama
 * (na starijoj masini i preko deset), sto opis MCP alata kaze unaprijed.
 */
export async function izreziArtikal(bajtovi: Buffer): Promise<Buffer> {
  const { removeBackground } = await import("@imgly/background-removal-node");
  const sharp = await ucitajSharp();
  const blob = await removeBackground(new Blob([new Uint8Array(bajtovi)], { type: "image/png" }));
  const izrez = Buffer.from(await blob.arrayBuffer());
  // trim skida prozirni rub oko artikla, da procenat sirine iz slota znaci artikal, ne prazninu.
  return sharp(izrez).trim().png().toBuffer();
}

/** Pozadina svedena na 4:3 platno: cover crop iz centra, PNG. */
export async function normalizujPozadinu(putanjaIliBajtovi: string | Buffer): Promise<Buffer> {
  const sharp = await ucitajSharp();
  return sharp(putanjaIliBajtovi)
    .resize(PLATNO_4_3.sirina, PLATNO_4_3.visina, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
}

/**
 * Slozi izrezan artikal na normalizovano platno pozadine po slotu. Ulazi su bajtovi (pozadina
 * vec 4:3, artikal vec izrezan sa alpha kanalom), izlaz PNG platna sa artiklom.
 */
export async function slozi(pozadina4x3: Buffer, izrezanArtikal: Buffer, slot: Slot): Promise<Buffer> {
  const sharp = await ucitajSharp();
  const meta = await sharp(izrezanArtikal).metadata();
  if (!meta.width || !meta.height) throw new Error("Izrezan artikal nema citljive dimenzije.");
  const polozaj = izracunajPolozaj(PLATNO_4_3, { sirina: meta.width, visina: meta.height }, slot);
  const skaliran = await sharp(izrezanArtikal).resize(polozaj.sirina, polozaj.visina).png().toBuffer();
  return sharp(pozadina4x3)
    .composite([{ input: skaliran, left: polozaj.lijevo, top: polozaj.gore }])
    .png()
    .toBuffer();
}
