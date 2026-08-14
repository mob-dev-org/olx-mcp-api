// Oblikovanje popisa mogucnosti u markdown. Sakupljanje zivi u popis-podaci.mjs i njegovim
// sakupljacima; ovaj fajl samo slaze vec gotove podatke u citljiv tekst.
//
// Zasto poseban modul od sakupljaca: isti podaci hrane i markdown u repou i (kasnije) samostalan
// HTML, pa oblikovanje mora biti zamjenjivo bez diranja skupljanja. Mijesanje ta dva posla je
// tacno razilazenje koje je popis dosao da rijesi.
//
// Zasto izlaz mora biti deterministican: fajl koji ovaj modul proizvodi zavrsava u repou i
// poredi se znak po znak u testu koji se vrti i na klijentskim klonovima. Nijedna vrijednost
// ovdje zato ne smije zavisiti od trenutka pokretanja, korisnika ili masine; sve dolazi iz
// `podaci` argumenta, koji je vec deterministican jer sakupljaci sortiraju svoje nizove.

/** Bezbjedan sadrzaj celije tabele: `|` bi razbio kolone, novi red bi razbio red tabele. */
function celija(vrijednost) {
  if (vrijednost === undefined || vrijednost === null) return "";
  return String(vrijednost)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

/** Sastavlja markdown tabelu iz zaglavlja i redova; svaka vrijednost prolazi kroz `celija`. */
function tabela(zaglavlja, redovi) {
  const zaglavljeRed = `| ${zaglavlja.join(" | ")} |`;
  const razdvajac = `| ${zaglavlja.map(() => "---").join(" | ")} |`;
  const tijelo = redovi.map((red) => `| ${red.map(celija).join(" | ")} |`).join("\n");
  return `${zaglavljeRed}\n${razdvajac}\n${tijelo}`;
}

/**
 * Opis skraceno na prvu recenicu, ali samo kad je duzi od 140 znakova. Kratak opis se ne dira,
 * jer skracivanje kratke recenice ne bi nista postiglo osim gubitka sadrzaja.
 */
function opisKratak(opis) {
  if (!opis) return "";
  const cist = opis.trim();
  if (cist.length <= 140) return cist;
  const poklapanje = cist.match(/^.*?[.!?](?=\s|$)/s);
  return poklapanje ? poklapanje[0].trim() : `${cist.slice(0, 140).trim()}…`;
}

/** Prva tri okidaca pa broj preostalih, po pravilu odsijecanja dugih lista iz granica.md. */
function okidaciKratko(okidaci) {
  if (!okidaci || okidaci.length === 0) return "";
  const prva = okidaci.slice(0, 3).join(", ");
  const preostalo = okidaci.length - 3;
  return preostalo > 0 ? `${prva} i jos ${preostalo}` : prva;
}

/**
 * Podrazumijevana vrijednost postavke za tabelu. Tri posebna slucaja moraju ostati vidljivi umjesto
 * prazne celije, jer prazna celija ovdje ne znaci isto sto i "nema defaulta": moze znaciti i "zavisi
 * od procesa" i "generator to nije uspio izmjeriti".
 */
function formatPodrazumijevano(postavka) {
  if (postavka.zavisiOdProcesa) return "izvodi se iz pokrenutog procesa";
  if (!postavka.utvrdjeno) return "nije utvrdjeno";
  if (postavka.podrazumijevano === undefined) return "";
  if (typeof postavka.podrazumijevano === "boolean") return postavka.podrazumijevano ? "da" : "ne";
  return String(postavka.podrazumijevano);
}

function naslovProfila(alat) {
  return alat.profil === "admin" ? "samo admin" : "oba";
}

function sekcijaAlati(podaci) {
  const redovi = podaci.alati.map((a) => [
    a.uslov ? `${a.ime} (uslovno)` : a.ime,
    opisKratak(a.opis),
    naslovProfila(a),
    a.vrsta ?? "",
    a.traziPotvrdu ? "da" : "",
  ]);

  const dijelovi = [
    "## MCP alati",
    "",
    tabela(["Ime", "Sta radi", "Profil", "Vrsta", "Trazi potvrdu"], redovi),
  ];

  const uslovni = podaci.alati.filter((a) => a.uslov);
  if (uslovni.length > 0) {
    dijelovi.push("", "Uslovni alati (registruju se samo pod navedenim uslovom):");
    for (const a of uslovni) {
      dijelovi.push(`- **${a.ime}**: ${a.uslovOpis ?? ""}`);
    }
  }

  return dijelovi.join("\n");
}

function sekcijaResursi(podaci) {
  const stavke = podaci.resursi.map((r) => `- \`${r.uri}\` (${r.naslov}): ${r.opis ?? ""}`);
  return ["## MCP resursi", "", ...stavke].join("\n");
}

/** Prvi token putanje (npr. "category attributes" -> "category") je grupa u ovoj sekciji. */
function grupaCli(putanja) {
  return putanja.split(" ")[0];
}

function sekcijaCli(podaci) {
  const grupe = new Map();
  for (const komanda of podaci.cli) {
    const kljuc = grupaCli(komanda.putanja);
    if (!grupe.has(kljuc)) grupe.set(kljuc, []);
    grupe.get(kljuc).push(komanda);
  }

  const dijelovi = ["## CLI komande", ""];
  for (const [grupa, komande] of grupe) {
    dijelovi.push(`### ${grupa}`, "");
    for (const k of komande) {
      const argumenti = k.argumenti.length > 0 ? ` ${k.argumenti.join(" ")}` : "";
      const brojOpcija = k.opcije.length;
      let linija = `- \`${k.putanja}${argumenti}\``;
      if (k.opis) linija += `: ${k.opis}`;
      if (brojOpcija > 0) linija += ` (${brojOpcija} opcija)`;
      dijelovi.push(linija);
      for (const o of k.opcije) {
        dijelovi.push(`  - \`${o.zastava}\`${o.opis ? `: ${o.opis}` : ""}`);
      }
    }
    dijelovi.push("");
  }
  // Ne ostavljati dvostruki prazan red na kraju sekcije.
  while (dijelovi.length > 0 && dijelovi[dijelovi.length - 1] === "") dijelovi.pop();
  return dijelovi.join("\n");
}

function sekcijaPoslovi(podaci) {
  const redovi = podaci.poslovi.map((p) => [
    p.sufiks,
    p.strana,
    p.termin,
    `\`${p.komanda}\``,
    p.strana === "ADMIN" ? "nema (namjerno)" : p.windowsBlizanac ? "da" : "ne",
  ]);

  return [
    "## Zakazani poslovi",
    "",
    tabela(["Posao", "Strana", "Termin", "Komanda", "Windows blizanac"], redovi),
    "",
    "ADMIN poslovi nemaju Windows blizanca namjerno: admin masina na Windowsu nije upotrebljiva, " +
      "pa za te poslove blizanac ni ne postoji.",
  ].join("\n");
}

function sekcijaPostavke(podaci) {
  const { postavke, izvedena, upozorenja } = podaci.postavke;

  const redovi = postavke.map((p) => [
    p.varijabla,
    p.polja.join(", "),
    formatPodrazumijevano(p),
    p.opis ?? "",
  ]);

  const dijelovi = [
    "## Postavke",
    "",
    tabela(["Varijabla", "Polje", "Podrazumijevano", "Opis"], redovi),
  ];

  if (izvedena.length > 0) {
    const redoviIzvedena = izvedena.map((i) => [i.polje, String(i.podrazumijevano ?? ""), i.opis ?? ""]);
    dijelovi.push(
      "",
      "Polja bez posebne varijable (izvode se iz drugog izvora, npr. iz pokrenutog procesa):",
      "",
      tabela(["Polje", "Podrazumijevano", "Opis"], redoviIzvedena),
    );
  }

  if (upozorenja.length > 0) {
    dijelovi.push(
      "",
      "### Razilazenja za provjeru",
      "",
      "Prazna vrijednost varijable ovdje daje drugaciji rezultat nego kad varijabla uopste nije " +
        "postavljena. Ovo nije nuzno greska, ali vrijedi provjeriti da li je to namjera:",
      "",
      ...upozorenja.map((u) => `- ${u}`),
    );
  }

  return dijelovi.join("\n");
}

function sekcijaOkruzenje(podaci) {
  const okruzenje = podaci.okruzenje ?? {};
  const varijable = okruzenje.varijable ?? [];
  const uKoduANeUPrimjeru = okruzenje.uKoduANeUPrimjeru ?? [];
  const uPrimjeruAneUKodu = okruzenje.uPrimjeruAneUKodu ?? [];

  const dijelovi = [
    "## Varijable okruzenja u cijelom repou",
    "",
    `Ukupno ${varijable.length} varijabli okruzenja pominje se u kodu ili u \`.env.example\`, od toga ` +
      `${varijable.filter((v) => v.konfiguracija).length} cini konfiguraciju klona.`,
    "",
    "Ostale dolaze iz okoline (harness sesije, plugin loader, proxy) i u `.env.example` namjerno ne " +
      "stoje: klijent ih ne postavlja rukom. Zato se prazna kolona kod njih ne racuna kao propust.",
    "",
    "Varijable koje kod cita a kojih nema u `.env.example` (moguc propust u primjeru, klijent ne " +
      "vidi da postoje):",
    "",
    uKoduANeUPrimjeru.length > 0 ? uKoduANeUPrimjeru.map((v) => `- ${v}`).join("\n") : "Nema takvih.",
    "",
    "Varijable koje su u `.env.example` a kod ih nigdje ne cita (moguc visak ili zastarjela " +
      "varijabla):",
    "",
    uPrimjeruAneUKodu.length > 0 ? uPrimjeruAneUKodu.map((v) => `- ${v}`).join("\n") : "Nema takvih.",
    "",
    tabela(
      ["Varijabla", "Odakle", "Broj fajlova", "Fajlovi", "U .env.example"],
      varijable.map((v) => [
        v.ime,
        v.konfiguracija ? "konfiguracija klona" : "daje okolina",
        String(v.gdje.length),
        v.gdje.join(", "),
        v.uPrimjeru ? "da" : "",
      ]),
    ),
  ];

  return dijelovi.join("\n");
}

function sekcijaSkillovi(podaci) {
  const redovi = podaci.skillovi.map((s) => [
    s.ime,
    opisKratak(s.opis),
    okidaciKratko(s.okidaci),
    s.samoAdmin ? "da" : "",
  ]);

  return [
    "## Skillovi",
    "",
    tabela(["Ime", "Cemu sluzi", "Okidaci", "Samo admin"], redovi),
  ].join("\n");
}

function sekcijaAgenti(podaci) {
  const redovi = podaci.agenti.map((a) => [a.ime, opisKratak(a.opis), a.alati.join(", ")]);

  return [
    "## Podagenti",
    "",
    tabela(["Ime", "Cemu sluzi", "Koje alate smije zvati"], redovi),
  ].join("\n");
}

function sekcijaSazetak(podaci) {
  const klijentuDostupno = podaci.alati.filter((a) => a.profil === "oba").length;
  const cliKomandi = podaci.cli.filter((k) => !k.grupa).length;

  return [
    "## Sazetak",
    "",
    `- MCP alata: ${podaci.alati.length}, od toga klijentu dostupno: ${klijentuDostupno}`,
    `- MCP resursa: ${podaci.resursi.length}`,
    `- CLI komandi: ${cliKomandi}`,
    `- Zakazanih poslova: ${podaci.poslovi.length}`,
    `- Postavki: ${podaci.postavke.postavke.length}`,
    `- Skillova: ${podaci.skillovi.length}`,
    `- Podagenata: ${podaci.agenti.length}`,
  ].join("\n");
}

/**
 * Sastavlja cio sadrzaj `MOGUCNOSTI.md` iz vec skupljenih podataka (`skupiSve`). Vraca string;
 * pozivalac odlucuje gdje ga upisuje, ovaj fajl ne dira disk.
 */
export function uMarkdown(podaci) {
  const dijelovi = [
    "# Sta ovaj sistem moze",
    "",
    "Ovaj fajl je GENERISAN iz koda, pravi ga `node scripts/popis-mogucnosti.mjs`. Ne dira se " +
      "rukom: rucna izmjena ovdje nestaje na sljedecem pokretanju generatora. Za objasnjenje " +
      "obicnim jezikom procitaj `sta-sistem-radi.md` u istoj mapi.",
    "",
    sekcijaSazetak(podaci),
    "",
    sekcijaAlati(podaci),
    "",
    sekcijaResursi(podaci),
    "",
    sekcijaCli(podaci),
    "",
    sekcijaPoslovi(podaci),
    "",
    sekcijaPostavke(podaci),
    "",
    sekcijaOkruzenje(podaci),
    "",
    sekcijaSkillovi(podaci),
    "",
    sekcijaAgenti(podaci),
    "",
  ];

  return `${dijelovi.join("\n").replace(/\n+$/, "")}\n`;
}
