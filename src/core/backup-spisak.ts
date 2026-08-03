// Sta se od klijentskog stanja sprema na daljinu, a sta nikad ne smije izaci iz klona.
//
// Zasto bijeli spisak a ne `.gitignore`: crni spisak bi tiho objavio svaki NOVI fajl koji neko
// kasnije doda u `.olx-pik/`, a to se sudara sa granicom da token nikad ne ide u git. Bijeli
// spisak ne objavi nista sto nije izricito navedeno, a sve ostalo prijavi kao nepoznato, pa
// spisak ne moze ostati ustajao a da se to ne primijeti.
//
// Zasto se putanje GRADE, a ne prepisuju kao literali: `.olx-pik/...` je samo podrazumijevana
// vrijednost, a `OLX_AUDIT_FILE`, `OLX_PAMCENJE_FILE`, `OLX_IZUZECA_FILE`, `OLX_PRIJEDLOZI_DIR` i
// `OLX_AI_USAGE_FILE` je mogu pomjeriti. Klon koji ijednu pomjeri dobio bi tih backup praznog
// mjesta da spisak nosi literale.
//
// Ovaj modul ne dira disk ni mrezu: prima popis putanja, vraca odluku. Kopiranje je u
// `stanje-kopija.ts`, git u `git-stanje.ts`.

import { putanjaDnevnika } from "./ai-dnevnik.js";
import { putanjaTraga } from "./slike-trag.js";
import { putanjaRitma } from "./ritam-obnova.js";
import { putanjaKvoteDnevnika } from "./kvota-dnevnik.js";
import { loadConfig } from "./config.js";
import { putanjaIzuzeca } from "./izuzeca.js";
import { KONKURENTI_DIR } from "./konkurenti.js";
import { putanjaPamcenja } from "./pamcenje.js";
import { mapaPozadine } from "./pozadina.js";
import { PLAN_FILE } from "./plan-fajl.js";
import { mapaPrijedloga } from "./prijedlozi.js";
import { SNAPSHOT_DIR } from "./snapshoti.js";

export interface StavkaSpiska {
  /** Putanja u klonu. Mapa se prepoznaje po `obrazac`. */
  putanja: string;
  /** Za mapu: koji fajlovi unutra ulaze. Za pojedinacan fajl ostaje undefined. */
  obrazac?: RegExp;
  opis: string;
}

/** Dvije runtime mape su fiksne po imenu, pa ih spisak nosi doslovno. */
const RUNTIME_MAPE = [".claude-runtime", ".claude-runtime-admin"];

/**
 * Sve sto ide na daljinu. Redoslijed je informativan, koristi se i za ispis u `--suho`.
 */
export function bijeliSpisak(env: NodeJS.ProcessEnv = process.env): StavkaSpiska[] {
  const stavke: StavkaSpiska[] = [
    { putanja: putanjaPamcenja(env), opis: "pamcenje bota o klijentu" },
    { putanja: putanjaIzuzeca(env), opis: "oglasi koje klijent ne da dizati" },
    { putanja: loadConfig(env).auditFile, opis: "trag svih radnji i troska" },
    { putanja: putanjaDnevnika(env), opis: "potrosnja vanjskog AI racuna" },
    // Ide na daljinu jer je dokazni materijal: jedini zapis o tome sta je trazeno od generatora
    // slika i sta je odbijeno. Bez njega se zloupotreba ne moze rekonstruisati poslije oporavka.
    { putanja: putanjaTraga(env), opis: "zahtjevi prema generatoru slika" },
    // Odluka klijenta, isto kao izuzeca: bez nje bot poslije oporavka nametne svoj raspored.
    { putanja: putanjaRitma(env), opis: "ritam obnavljanja koji je trazio klijent" },
    // Pozadina je odluka klijenta i jedini fajl u backupu koji je binaran. Ide jer bez njega
    // poslije oporavka svi novi oglasi tiho dobiju drugu pozadinu od starih, a to se vidi.
    {
      putanja: mapaPozadine(env),
      obrazac: /^(pozadina\.json|slika\.(jpe?g|png|webp|gif))$/,
      opis: "stalna pozadina za generisanje slika",
    },
    // Serija stanja kvote. Nezamjenjiva retroaktivno, kao i snapshoti pregleda: po njoj se
    // vidi KAD se kvota obnavlja, a API taj datum ne vraca.
    { putanja: putanjaKvoteDnevnika(env), opis: "dnevno stanje kvote obnova" },
    { putanja: PLAN_FILE, opis: "raspored izdvajanja" },
    { putanja: ".olx-pik/saznanja.jsonl", opis: "zapisi iz prakse" },
    // Marker dokle je `saznanja-pokupi.sh` stigao. Bez njega bi se poslije oporavka sva saznanja
    // pokupila ponovo i duplirala u admin ulazu.
    { putanja: ".olx-pik/saznanja.pokupljeno", opis: "dokle su saznanja pokupljena" },
    { putanja: ".olx-pik/tokeni-dnevnik.jsonl", opis: "dnevni zbir potrosnje tokena" },
    { putanja: SNAPSHOT_DIR, obrazac: /^views-\d{4}-\d{2}-\d{2}\.json$/, opis: "dnevni snapshoti pregleda" },
    { putanja: KONKURENTI_DIR, obrazac: /^[A-Za-z0-9_-]+-\d{4}-\d{2}-\d{2}\.json$/, opis: "snimci konkurenata" },
    { putanja: mapaPrijedloga(env), obrazac: /^runda-\d{4}-\d{2}-\d{2}\.md$/, opis: "prijedlozi sedmicne runde" },
    { putanja: "KLIJENT.md", opis: "interni kontekst o klijentu" },
    { putanja: "KLIJENT-javno.md", opis: "javni profil, ulazi u prompt" },
  ];
  // access.json nije tajna (token je u susjednom .env, koji je na crnom spisku), a jeste
  // najbolniji dio rekonstrukcije: ID grupe i spisak ljudi koji smiju pisati botu. Bez njega
  // na novoj masini svi ponovo salju svoj Telegram ID.
  for (const m of RUNTIME_MAPE) {
    stavke.push({ putanja: `${m}/channels/telegram/access.json`, opis: `ko smije pisati botu (${m})` });
  }
  return stavke;
}

/**
 * Sto se nikad ne kopira, ma gdje se naslo. Provjerava se PRIJE bijelog spiska, da fajl unutar
 * dozvoljene mape ne moze proci samo zato sto je mapa dozvoljena.
 */
export function crniObrasci(): { obrazac: RegExp; razlog: string }[] {
  return [
    // Nikad nista sto se zove .env, bez obzira gdje lezi. Tu su OLX i Telegram tokeni.
    { obrazac: /(^|\/)\.env(\.|$)/, razlog: "tajna" },
    // Skill olx-novi-klijent izricito propisuje da se tokeni ovdje PRIVREMENO upisuju dok se ne
    // zna konacno mjesto. Zato eksplicitno crn, a ne samo izostavljen iz bijelog spiska.
    { obrazac: /(^|\/)onboarding-stanje\.md$/, razlog: "moze nositi token u toku postavke" },
    { obrazac: /(^|\/)proba-kanala(\/|$)/, razlog: "izolovani probni kanal sa bot tokenom" },
    { obrazac: /(^|\/)slike(\/|$)/, razlog: "generisane slike, do 20 MB dnevno" },
    // Radni fajlovi koje bot pravi za klijenta (tabele, izvozi): isporuceni su u grupu cim
    // nastanu, pa poslije oporavka ne znace nista, a znaju biti veliki.
    { obrazac: /(^|\/)klijent-fajlovi(\/|$)/, razlog: "radni fajlovi za klijenta, isporuceni u grupu" },
    { obrazac: /(^|\/)projects(\/|$)/, razlog: "transkripti razgovora" },
    { obrazac: /(^|\/)inbox(\/|$)/, razlog: "dolazne fotografije klijenta" },
    { obrazac: /(^|\/)test-audit\.jsonl$/, razlog: "ostatak testova" },
    { obrazac: /(^|\/)most-stanje\.json$/, razlog: "prolazni red poruka" },
    // Popis slika koje cekaju brisanje. Pokazuje na fajlove koji su i sami crni i koji ce nestati
    // za sat vremena, pa poslije oporavka ne znaci nista.
    { obrazac: /(^|\/)slike-potrosene\.json$/, razlog: "prolazni popis slika za brisanje" },
    { obrazac: /(^|\/)prompt-[^/]*\.md$/, razlog: "sastavlja se pri svakom startu" },
    { obrazac: /(^|\/)cron-[^/]*\.log$/, razlog: "log" },
    { obrazac: /\.tmp$/, razlog: "polovicno upisan fajl" },
    { obrazac: /\.lock$/, razlog: "lock" },
    { obrazac: /\.pid$/, razlog: "pid" },
    // Prolazan marker kojim vanjski proces trazi restart sesije; cuvar ga obrise po obradi.
    { obrazac: /(^|\/)restart-(sesije|admin-bota)$/, razlog: "prolazan zahtjev za restart" },
    { obrazac: /\.alarm$/, razlog: "alarm masine" },
    { obrazac: /(^|\/)node_modules(\/|$)/, razlog: "zavisnosti" },
    { obrazac: /(^|\/)dist(\/|$)/, razlog: "build izlaz" },
  ];
}

export interface Razvrstano {
  uzmi: { putanja: string; opis: string }[];
  preskoci: { putanja: string; razlog: string }[];
  /** Ni na jednom spisku: novo stanje koje niko nije odlucio da li se cuva. */
  nepoznato: string[];
}

/** Normalizacija na kose crte naprijed, da se isti obrasci koriste i na Windowsu. */
export function normalizuj(putanja: string): string {
  return putanja.replace(/\\/g, "/").replace(/^\.\//, "");
}

function crn(putanja: string): string | null {
  for (const { obrazac, razlog } of crniObrasci()) {
    if (obrazac.test(putanja)) return razlog;
  }
  return null;
}

/**
 * Razvrsta stvarno prisutne putanje. `putanje` su relativne prema korijenu klona.
 *
 * Nepoznato NIJE greska nego alarm: neko je dodao novo stanje a niko nije odlucio ide li u
 * backup. Tiho izostavljanje bi znacilo da se to otkrije tek na dan oporavka.
 */
export function razvrstaj(putanje: string[], env: NodeJS.ProcessEnv = process.env): Razvrstano {
  const spisak = bijeliSpisak(env).map((s) => ({ ...s, putanja: normalizuj(s.putanja) }));
  const uzmi: Razvrstano["uzmi"] = [];
  const preskoci: Razvrstano["preskoci"] = [];
  const nepoznato: string[] = [];

  for (const sirova of putanje) {
    const p = normalizuj(sirova);
    const razlog = crn(p);
    if (razlog) {
      preskoci.push({ putanja: p, razlog });
      continue;
    }
    const pogodak = spisak.find((s) => {
      if (!s.obrazac) return s.putanja === p;
      if (!p.startsWith(`${s.putanja}/`)) return false;
      return s.obrazac.test(p.slice(s.putanja.length + 1));
    });
    if (pogodak) uzmi.push({ putanja: p, opis: pogodak.opis });
    else nepoznato.push(p);
  }
  return { uzmi, preskoci, nepoznato };
}

/**
 * Odsijeca nepotpun zadnji red. Kopija jsonl fajla uhvacena usred dopisivanja moze zavrsiti na
 * pola reda; potrosaci takav red preskacu, ali backup nema razloga da ga uopste nosi.
 */
export function odsijeciNepotpunuLiniju(sadrzaj: string): string {
  if (sadrzaj === "" || sadrzaj.endsWith("\n")) return sadrzaj;
  const zadnji = sadrzaj.lastIndexOf("\n");
  return zadnji === -1 ? "" : sadrzaj.slice(0, zadnji + 1);
}

// Bijeli spisak stiti od novih FAJLOVA, ali ne od SADRZAJA. `saznanja.jsonl` i `prijedlozi/*.md`
// pise model, `KLIJENT.md` covjek, i nista ne sprjecava da tamo zavrsi token. Pogodak znaci da se
// taj fajl ne salje i da se javi adminu.
const SUMNJIVI: { ime: string; obrazac: RegExp }[] = [
  { ime: "Telegram bot token", obrazac: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/ },
  { ime: "GitHub token", obrazac: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { ime: "kljuc oblika sk-", obrazac: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { ime: "Google API kljuc", obrazac: /\bAIza[A-Za-z0-9_-]{35}\b/ },
  { ime: "Google AI Studio kljuc", obrazac: /\bAQ\.[A-Za-z0-9_-]{20,}\b/ },
  { ime: "JWT", obrazac: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/ },
  { ime: "privatni kljuc", obrazac: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

/** Imena obrazaca koji su se javili u tekstu. Prazan niz znaci cisto. */
export function nadjiSumnjive(tekst: string): string[] {
  return SUMNJIVI.filter((s) => s.obrazac.test(tekst)).map((s) => s.ime);
}

/**
 * Odrediste u radnoj kopiji. Putanja koja je pomjerena van klona kroz env ne smije izaci iz
 * radne kopije, pa se spusta u `van-klona/` pod svojim imenom.
 */
export function ciljUKopiji(izvor: string): string {
  const p = normalizuj(izvor);
  const vanKlona = p.startsWith("/") || p.startsWith("../") || /^[A-Za-z]:\//.test(p);
  return vanKlona ? `van-klona/${p.split("/").pop()}` : p;
}
