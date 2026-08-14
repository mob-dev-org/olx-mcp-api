// Skuplja popis zakazanih poslova iz dva izvora istine: launchd sablona (macOS) i
// Windows skripte koja registruje istovjetne zadatke. Ne pamti brojeve niti termine
// rucno, cita ih iz fajlova, jer bi svaka rucna kopija ostala neusaglasena cim se
// neko sabloni promijeni a generator ne.
//
// Zasto vlastiti plist citac umjesto `plutil`: `plutil` postoji samo na macOS-u, a ova
// skripta mora raditi i na Windows masini koja generise isti popis (npr. u testu koji
// poredi izlaz). Struktura plistova u ovom repou je plitka pa punu XML biblioteku nije
// vrijedno uvoditi, dovoljan je mali rekurzivni parser nad tokenima.

import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const FOLDER_LAUNCHD = ["deploy", "launchd"];
const PS1_PUTANJA = ["deploy", "windows", "instaliraj-zadatke.ps1"];

const IMENA_DANA = [
  "nedjeljom",
  "ponedjeljkom",
  "utorkom",
  "srijedom",
  "cetvrtkom",
  "petkom",
  "subotom",
];

// Osnovni entiteti koji se realno pojavljuju u ovim plistovima (najcesce &amp;&amp; u
// bash komandi). Ostatak XML entiteta ovdje nije potreban, radije ostaviti prazninu u
// pokrivenosti eksplicitnom listom nego pogadjati generickim dekoderom.
function dekodirajEntitete(tekst) {
  return tekst
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// Tokenizer svodi XML na plitku listu otvaranja, zatvaranja i teksta. Atributi na
// tagovima (npr. version="1.0" na <plist>) se namjerno ne parsiraju jer parseru ne
// trebaju, dovoljno je znati ime taga.
function tokenizuj(xmlBezKomentara) {
  const tokeni = [];
  const re = /<(\/)?([A-Za-z][\w:.-]*)((?:\s+[^<>]*)?)(\/)?>|([^<]+)/g;
  let m;
  while ((m = re.exec(xmlBezKomentara)) !== null) {
    if (m[5] !== undefined) {
      const tekst = dekodirajEntitete(m[5]).trim();
      if (tekst) tokeni.push({ vrsta: "tekst", tekst });
      continue;
    }
    const zatvara = m[1] === "/";
    const ime = m[2];
    const samozatvoren = m[4] === "/";
    if (zatvara) tokeni.push({ vrsta: "zatvori", ime });
    else if (samozatvoren) tokeni.push({ vrsta: "sam", ime });
    else tokeni.push({ vrsta: "otvori", ime });
  }
  return tokeni;
}

// Parsira JEDNU plist vrijednost pocevsi od tokeni[i]. Vraca [vrijednost, sljedeciIndeks].
// Podrzava tacno one tipove koje ovih 11 fajlova stvarno koristi: string, integer,
// true/false, array i dict. Nepoznat tip pada odmah umjesto da tiho vrati prazninu, jer
// bi tiho preskakanje ovdje znacilo pogresan raspored posla koji niko ne bi primijetio.
function parsirajVrijednost(tokeni, i, imeFajlaZaGresku) {
  const t = tokeni[i];
  if (!t) throw new Error(`Neocekivan kraj plista u ${imeFajlaZaGresku}`);

  if (t.vrsta === "sam") {
    if (t.ime === "true") return [true, i + 1];
    if (t.ime === "false") return [false, i + 1];
    throw new Error(`Nepodrzan samozatvoreni tag <${t.ime}/> u ${imeFajlaZaGresku}`);
  }

  if (t.vrsta !== "otvori") {
    throw new Error(`Ocekivan pocetak vrijednosti u ${imeFajlaZaGresku}, dobijeno ${t.vrsta}`);
  }

  const ime = t.ime;
  let j = i + 1;

  if (ime === "string" || ime === "integer") {
    let tekst = "";
    if (tokeni[j] && tokeni[j].vrsta === "tekst") {
      tekst = tokeni[j].tekst;
      j += 1;
    }
    if (!(tokeni[j] && tokeni[j].vrsta === "zatvori" && tokeni[j].ime === ime)) {
      throw new Error(`Neuparen tag <${ime}> u ${imeFajlaZaGresku}`);
    }
    j += 1;
    return [ime === "integer" ? Number.parseInt(tekst, 10) : tekst, j];
  }

  if (ime === "dict") {
    const objekat = {};
    while (!(tokeni[j] && tokeni[j].vrsta === "zatvori" && tokeni[j].ime === "dict")) {
      if (!(tokeni[j] && tokeni[j].vrsta === "otvori" && tokeni[j].ime === "key")) {
        throw new Error(`Ocekivan <key> u dict u ${imeFajlaZaGresku}`);
      }
      j += 1;
      let kljuc = "";
      if (tokeni[j] && tokeni[j].vrsta === "tekst") {
        kljuc = tokeni[j].tekst;
        j += 1;
      }
      if (!(tokeni[j] && tokeni[j].vrsta === "zatvori" && tokeni[j].ime === "key")) {
        throw new Error(`Neuparen <key> u ${imeFajlaZaGresku}`);
      }
      j += 1;
      const [vrijednost, sljedeci] = parsirajVrijednost(tokeni, j, imeFajlaZaGresku);
      objekat[kljuc] = vrijednost;
      j = sljedeci;
    }
    j += 1;
    return [objekat, j];
  }

  if (ime === "array") {
    const niz = [];
    while (!(tokeni[j] && tokeni[j].vrsta === "zatvori" && tokeni[j].ime === "array")) {
      const [vrijednost, sljedeci] = parsirajVrijednost(tokeni, j, imeFajlaZaGresku);
      niz.push(vrijednost);
      j = sljedeci;
    }
    j += 1;
    return [niz, j];
  }

  throw new Error(`Nepodrzan tip <${ime}> u ${imeFajlaZaGresku}`);
}

// Vraca korijenski dict plista (ono sto sjedi unutar <plist> ... </plist>).
function parsirajPlist(sirovi, imeFajlaZaGresku) {
  const bezKomentara = sirovi.replace(/<!--[\s\S]*?-->/g, "");
  const tokeni = tokenizuj(bezKomentara);

  let i = 0;
  while (i < tokeni.length && !(tokeni[i].vrsta === "otvori" && tokeni[i].ime === "plist")) {
    i += 1;
  }
  if (i >= tokeni.length) throw new Error(`Nema <plist> u ${imeFajlaZaGresku}`);
  i += 1;

  if (!(tokeni[i] && tokeni[i].vrsta === "otvori" && tokeni[i].ime === "dict")) {
    throw new Error(`Ocekivan korijenski <dict> u ${imeFajlaZaGresku}`);
  }
  const [korijenskiDict] = parsirajVrijednost(tokeni, i, imeFajlaZaGresku);
  return korijenskiDict;
}

// Svaki od 11 sablona pokrece stvarnu komandu kroz "/bin/bash -lc cd KORIJEN && <komanda>"
// radi PATH-a (claude/node dolaze iz login profila). Taj omotac je identican u svima i ne
// nosi informaciju o samom poslu, pa se uklanja da komanda ostane citljiva i uporediva.
const OMOTAC_RE = /^\/bin\/bash -lc cd\s+(?:KORIJEN|__KORIJEN__)\s*&&\s*/;

// Bezbjednosna mreza za slucaj da neko doda sablon sa stvarnom apsolutnom putanjom
// umjesto placeholdera "KORIJEN": izlaz mora ostati identican bez obzira na masinu ili
// korisnicko ime, jer se poredi u testu koji se vrti i na klijentskim klonovima.
function svedNaRelativno(tekst, korijenApsolutni) {
  let rezultat = tekst;
  if (korijenApsolutni) {
    const bjezeci = korijenApsolutni.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rezultat = rezultat.replace(new RegExp(`${bjezeci}/?`, "g"), "");
  }
  rezultat = rezultat.replace(/__KORIJEN__\/?/g, "");
  rezultat = rezultat.replace(/\bKORIJEN\/?/g, "");
  rezultat = rezultat.replace(/\/\S*\/olx-mcp-api(?:-[\w.-]+)?\//g, "");
  return rezultat;
}

function izvuciKomandu(programArguments, korijenApsolutni, imeFajlaZaGresku) {
  if (!Array.isArray(programArguments) || programArguments.length === 0) {
    throw new Error(`Nema ProgramArguments u ${imeFajlaZaGresku}`);
  }
  let spojeno = programArguments.join(" ");
  spojeno = spojeno.replace(OMOTAC_RE, "");
  spojeno = svedNaRelativno(spojeno, korijenApsolutni);
  return spojeno.trim();
}

function dvocifreno(broj) {
  return String(broj).padStart(2, "0");
}

// Jedan StartCalendarInterval dict u citljiv bosanski opis termina.
function formatirajKalendarskiTermin(dict, imeFajlaZaGresku) {
  const { Hour, Minute, Weekday } = dict;
  if (Hour !== undefined && Minute !== undefined) {
    const vrijeme = `${dvocifreno(Hour)}:${dvocifreno(Minute)}`;
    if (Weekday !== undefined) {
      const imeDana = IMENA_DANA[Weekday];
      if (!imeDana) throw new Error(`Nepoznat Weekday ${Weekday} u ${imeFajlaZaGresku}`);
      return `${imeDana} ${vrijeme}`;
    }
    return `svaki dan ${vrijeme}`;
  }
  if (Hour === undefined && Minute !== undefined) {
    return `svakog sata u :${dvocifreno(Minute)}`;
  }
  throw new Error(`Ne mogu procitati StartCalendarInterval u ${imeFajlaZaGresku}`);
}

// Odredjuje termin i da li je posao stalan (dize se pri prijavi i drzi ga KeepAlive),
// po redoslijedu koji sam plist propisuje: kalendarski raspored ima prednost nad
// intervalom, a intervalni nad "stalno zivim" oblikom.
function izracunajTermin(dict, imeFajlaZaGresku) {
  if (dict.StartCalendarInterval !== undefined) {
    const stavke = Array.isArray(dict.StartCalendarInterval)
      ? dict.StartCalendarInterval
      : [dict.StartCalendarInterval];
    const termin = stavke.map((d) => formatirajKalendarskiTermin(d, imeFajlaZaGresku)).join(", ");
    return { termin, stalni: false };
  }
  if (dict.StartInterval !== undefined) {
    const sekunde = dict.StartInterval;
    const termin =
      sekunde % 60 === 0 ? `svakih ${sekunde / 60} minuta` : `svakih ${sekunde} sekundi`;
    return { termin, stalni: false };
  }
  if (dict.KeepAlive !== undefined || dict.RunAtLoad === true) {
    return { termin: "stalno, dize se pri prijavi", stalni: true };
  }
  throw new Error(`Ne mogu odrediti raspored za ${imeFajlaZaGresku}`);
}

// Trazi se DOSLOVAN trag registracije, `Registruj -Sufiks "<sufiks>"`, a ne bilo kakvo pominjanje
// sufiksa. Razlika je bitna: zaglavlje te skripte u komentaru nabraja sve poslove, pa bi obicna
// pretraga podstringa javila blizanca i za posao koji je iz skripte uklonjen a ostao u komentaru.
// To je i dalje samo pronalazenje doslovnog niza znakova, ne pokusaj razumijevanja PowerShell
// logike: ne zanima nas pod kojim uslovom se poziv izvrsava, samo da li postoji.
function imaWindowsBlizanca(sufiks, sadrzajPs1) {
  return sadrzajPs1.includes(`Registruj -Sufiks "${sufiks}"`);
}

export function skupiPoslove(korijen) {
  const folderLaunchd = join(korijen, ...FOLDER_LAUNCHD);
  const imenaFajlova = readdirSync(folderLaunchd)
    .filter((f) => f.endsWith(".plist"))
    .sort();

  const putanjaPs1 = join(korijen, ...PS1_PUTANJA);
  const sadrzajPs1 = readFileSync(putanjaPs1, "utf8");

  const poslovi = imenaFajlova.map((imeFajla) => {
    const punaPutanja = join(folderLaunchd, imeFajla);
    const sirovi = readFileSync(punaPutanja, "utf8");
    const dict = parsirajPlist(sirovi, imeFajla);

    const oznaka = dict.Label;
    if (!oznaka) throw new Error(`Nema Label u ${imeFajla}`);

    const dijelovi = oznaka.split(".");
    const sufiks = dijelovi[dijelovi.length - 1];
    const strana = dijelovi[dijelovi.length - 2];

    const fajl = relative(korijen, punaPutanja).split(sep).join("/");
    const komanda = izvuciKomandu(dict.ProgramArguments, korijen, imeFajla);
    const { termin, stalni } = izracunajTermin(dict, imeFajla);

    const windowsBlizanac =
      strana === "KLIJENT" ? imaWindowsBlizanca(sufiks, sadrzajPs1) : null;

    return { oznaka, sufiks, strana, fajl, komanda, termin, stalni, windowsBlizanac };
  });

  poslovi.sort((a, b) => (a.oznaka < b.oznaka ? -1 : a.oznaka > b.oznaka ? 1 : 0));
  return poslovi;
}

export function klijentskiBezBlizanca(poslovi) {
  return poslovi
    .filter((p) => p.strana === "KLIJENT" && p.windowsBlizanac === false)
    .map((p) => p.sufiks);
}
