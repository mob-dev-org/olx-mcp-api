// Slanje poruka na Telegram preko Bot API-ja.
//
// Namjerno malen i bez zavisnosti: koriste ga cron poslovi koji rade BEZ modela, pa cijeli
// dnevni izvjestaj kosta nula tokena. Koristi ga i `scripts/telegram-most.mjs` za izlazni
// smjer bota. Sesija koja ide kroz Telegram plugin (`--channels`) ovo ne koristi, ona ima
// vlastiti `reply` alat.
//
// Dvije adrese, dvije publike:
//   TELEGRAM_CHAT_ID        grupa klijenta, tu ide izvjestaj; smije nabrojati vise grupa zarezom
//   TELEGRAM_ADMIN_CHAT_ID  tvoj DM, tu idu greske i tehnicke stvari

import { podijeli, TELEGRAM_MEKI_LIMIT } from "./izvjestaj.js";
import { grupeKlijenta } from "./telegram-grupe.js";

export interface TelegramConfig {
  botToken?: string;
  chatId?: string;
  adminChatId?: string;
}

export function telegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig {
  return {
    botToken: env.TELEGRAM_BOT_TOKEN || undefined,
    chatId: env.TELEGRAM_CHAT_ID || undefined,
    adminChatId: env.TELEGRAM_ADMIN_CHAT_ID || undefined,
  };
}

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "TelegramError";
  }
}

/**
 * Rastavlja `TELEGRAM_CHAT_ID` na spisak odredista.
 *
 * Bot je cesto u vise grupa kod istog klijenta (prodaja, magacin, vlasnik), a Bot API nema
 * poziv koji vraca "u kojim sam grupama". Zato se grupe nabrajaju u konfiguraciji, zarezom.
 * Jedan id bez zareza radi kao i prije, pa stari klonovi nista ne mijenjaju.
 */
export function chatIdovi(vrijednost: string | undefined | null): string[] {
  if (!vrijednost) return [];
  const viđeni = new Set<string>();
  for (const dio of vrijednost.split(",")) {
    const id = dio.trim();
    // Duplikat u .env bi znacio dvije iste poruke u istoj grupi.
    if (id) viđeni.add(id);
  }
  return [...viđeni];
}

/**
 * Kome ide poruka.
 *
 * Cista funkcija, jer je ovo jedina prava odluka u cijelom modulu; sve ostalo je `fetch`. Zato se
 * testira ovdje, a `posaljiPoruku` se ne testira uopste.
 *
 * Pravilo: eksplicitan `chatId` gazi sve i NE gleda ni `.env` ni access.json. Na tome stoje
 * `javiAdminu` (admin DM), Telegram most (odgovor ide u chat iz kojeg je poruka dosla) i
 * onboarding puller (salje u tudji klon, gdje bi citanje naseg access.json bilo pogresno).
 *
 * Bez eksplicitnog: unija grupa iz access.json i id-eva iz `TELEGRAM_CHAT_ID`. Access je prvi,
 * jer je izvor istine; `.env` je dopuna zbog klonova koji su ga vec popunili. Isti id u oba
 * izvora se ne salje dvaput.
 */
export function izaberiOdredista(
  eksplicitni: string | undefined,
  izEnva: string | undefined,
  izAccessa: string[],
): string[] {
  if (eksplicitni) return chatIdovi(eksplicitni);
  const spisak = new Set<string>();
  for (const id of izAccessa) {
    const cist = id.trim();
    if (cist) spisak.add(cist);
  }
  for (const id of chatIdovi(izEnva)) spisak.add(id);
  return [...spisak];
}

/** Odredista za jedan poziv. Disk se cita samo kad eksplicitnog `chatId` nema. */
function odredista(opcije: { chatId?: string; odredista?: string[] }): string[] {
  if (opcije.odredista) return opcije.odredista;
  const cfg = telegramConfig();
  return izaberiOdredista(opcije.chatId, cfg.chatId, opcije.chatId ? [] : grupeKlijenta());
}

/**
 * Salje jednu poruku u svaku podesenu grupu. Duga poruka se cijepa po granici reda, jer bi je
 * Telegram inace prelomio nasumicno usred recenice.
 *
 * Ne baca kad chatId nije postavljen, nego vraca 0 poslanih: cron posao ne smije pasti samo
 * zato sto klijent jos nema grupu.
 *
 * Kad ima vise grupa, pad jedne (bot izbacen, grupa obrisana) NE obara ostale: poruka ode svima
 * kojima moze, a neuspjesi se prijave na stderr. Baca se tek kad nijedna grupa nije primila
 * poruku, jer tada izvjestaja stvarno nema.
 */
export async function posaljiPoruku(
  tekst: string,
  opcije: { botToken?: string; chatId?: string; limit?: number; odredista?: string[] } = {},
): Promise<number> {
  const token = opcije.botToken ?? telegramConfig().botToken;
  const chatovi = odredista(opcije);
  if (!token || chatovi.length === 0) return 0;

  const dijelovi = podijeli(tekst, opcije.limit ?? TELEGRAM_MEKI_LIMIT);
  let poslano = 0;
  const greske: { chat: string; greska: TelegramError }[] = [];

  for (const chat of chatovi) {
    try {
      for (const dio of dijelovi) {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chat, text: dio, disable_web_page_preview: true }),
        });
        if (!res.ok) {
          const tijelo = await res.text().catch(() => "");
          throw new TelegramError(`Telegram je odbio poruku (HTTP ${res.status}): ${tijelo.slice(0, 200)}`, res.status);
        }
        poslano += 1;
      }
    } catch (e) {
      greske.push({ chat, greska: e instanceof TelegramError ? e : new TelegramError(String(e), 0) });
    }
  }

  if (greske.length > 0) {
    const spisak = greske.map((g) => `${g.chat}: ${g.greska.message}`).join("; ");
    if (poslano === 0) throw new TelegramError(spisak, greske[0]!.greska.status);
    console.error(`Poruka nije prosla u sve grupe (${greske.length} od ${chatovi.length}): ${spisak}`);
  }
  return poslano;
}

/**
 * Salje sliku sa diska. Koristi ga Telegram most kad je sesija napravila novu sliku oglasa
 * (`olx_generiraj_sliku`), da je covjek vidi i odobri prije objave.
 *
 * `sendPhoto` je multipart, ne JSON, pa ide preko FormData. Telegram slike komprimuje; za
 * original bi trebao `sendDocument`, ali za pregled na telefonu je slika ono sto covjek ocekuje.
 *
 * Ne baca kad chatId nije postavljen, nego vraca false: isti ugovor kao posaljiPoruku.
 */
export async function posaljiSliku(
  putanja: string,
  opcije: { botToken?: string; chatId?: string; opis?: string; odredista?: string[] } = {},
): Promise<boolean> {
  const token = opcije.botToken ?? telegramConfig().botToken;
  const chatovi = odredista(opcije);
  if (!token || chatovi.length === 0) return false;

  const { readFile } = await import("node:fs/promises");
  const { basename } = await import("node:path");
  const podaci = await readFile(putanja);

  let poslano = 0;
  const greske: string[] = [];
  for (const chat of chatovi) {
    // FormData se ne smije ponovo koristiti nakon slanja, pa se gradi po odredistu.
    const forma = new FormData();
    forma.append("chat_id", chat);
    // Telegram caption ima svoj limit oko 1024 znaka; duzi tekst ide odvojenom porukom.
    if (opcije.opis) forma.append("caption", opcije.opis.slice(0, 1000));
    forma.append("photo", new Blob([new Uint8Array(podaci)]), basename(putanja));

    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: forma });
    if (res.ok) {
      poslano += 1;
    } else {
      const tijelo = await res.text().catch(() => "");
      greske.push(`${chat}: HTTP ${res.status} ${tijelo.slice(0, 200)}`);
    }
  }

  if (poslano === 0) throw new TelegramError(`Telegram je odbio sliku (${greske.join("; ")})`, 0);
  if (greske.length > 0) console.error(`Slika nije prosla u sve grupe: ${greske.join("; ")}`);
  return true;
}

/**
 * Javlja gresku administratoru, nikad klijentu.
 *
 * Nikad ne baca: poziva se iz catch bloka cron posla, gdje bi nova greska sakrila prvu.
 */
export async function javiAdminu(tekst: string): Promise<void> {
  const cfg = telegramConfig();
  if (!cfg.botToken || !cfg.adminChatId) return;
  try {
    await posaljiPoruku(tekst, { chatId: cfg.adminChatId });
  } catch (e) {
    console.error(`Ni admin poruka nije prosla: ${String(e instanceof Error ? e.message : e)}`);
  }
}

// ===== provjera zivosti =====

export type StanjeChata = "ziv" | "mrtav" | "nepoznato";

export interface NalazChata {
  chatId: string;
  stanje: StanjeChata;
  naslov?: string;
  razlog?: string;
}

/**
 * Da li je bot jos u tom chatu.
 *
 * Tri stanja, ne dva, i to je cijela poenta. `mrtav` je samo ono sto Telegram jasno kaze: bot
 * izbacen ili chat ne postoji (4xx). Mrezni kvar, timeout i 5xx daju `nepoznato`, jer bi
 * prijaviti treptaj veze kao izbacenog bota znacilo da admin poslije par laznih uzbuna prestane
 * citati te poruke. Iz istog razloga je i 429 `nepoznato`, a ne `mrtav`.
 *
 * Ne baca: koristi je posao koji ne smije pasti zbog provjere.
 */
export async function provjeriChat(chatId: string, opcije: { botToken?: string } = {}): Promise<NalazChata> {
  const token = opcije.botToken ?? telegramConfig().botToken;
  const id = String(chatId).trim();
  if (!token) return { chatId: id, stanje: "nepoznato", razlog: "nema bot tokena" };

  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: id }),
    });
  } catch (e) {
    return { chatId: id, stanje: "nepoznato", razlog: String(e instanceof Error ? e.message : e) };
  }

  const tijelo = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { title?: string } };
  if (res.ok && tijelo.ok) return { chatId: id, stanje: "ziv", naslov: tijelo.result?.title };
  // 429 je usporavanje, ne odsustvo; 5xx je kvar na njihovoj strani.
  if (res.status === 429 || res.status >= 500) {
    return { chatId: id, stanje: "nepoznato", razlog: `HTTP ${res.status}` };
  }
  return { chatId: id, stanje: "mrtav", razlog: tijelo.description ?? `HTTP ${res.status}` };
}
