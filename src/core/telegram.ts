// Slanje poruka na Telegram preko Bot API-ja.
//
// Namjerno malen i bez zavisnosti: koriste ga cron poslovi koji rade BEZ modela, pa cijeli
// dnevni izvjestaj kosta nula tokena. Interaktivni bot ne koristi ovo, on ide kroz Telegram
// plugin Claude Code-a.
//
// Dvije adrese, dvije publike:
//   TELEGRAM_CHAT_ID        grupa klijenta, tu ide izvjestaj
//   TELEGRAM_ADMIN_CHAT_ID  tvoj DM, tu idu greske i tehnicke stvari

import { podijeli, TELEGRAM_MEKI_LIMIT } from "./izvjestaj.js";

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
 * Salje jednu poruku. Duga poruka se cijepa po granici reda, jer bi je Telegram inace prelomio
 * nasumicno usred recenice.
 *
 * Ne baca kad chatId nije postavljen, nego vraca 0 poslanih: cron posao ne smije pasti samo
 * zato sto klijent jos nema grupu.
 */
export async function posaljiPoruku(
  tekst: string,
  opcije: { botToken?: string; chatId?: string; limit?: number } = {},
): Promise<number> {
  const cfg = telegramConfig();
  const token = opcije.botToken ?? cfg.botToken;
  const chat = opcije.chatId ?? cfg.chatId;
  if (!token || !chat) return 0;

  const dijelovi = podijeli(tekst, opcije.limit ?? TELEGRAM_MEKI_LIMIT);
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
  }
  return dijelovi.length;
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
