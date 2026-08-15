// Samostalna HTML stranica sa istim sadrzajem kao markdown popis, uz pretragu i prekidac profila.
//
// Fajl je namjerno podijeljen na tri jasna dijela:
//   STIL     cist CSS blok, nista drugo. Izgled se mijenja OVDJE i nigdje drugdje, da se postojeci
//            uredjeni izgled moze prenijeti bez diranja sakupljaca i bez rizika po tacnost.
//   PONASANJE cist JS koji se izvrsava u pregledacu (pretraga i filter)
//   uHtml     slaganje podataka u stranicu
//
// Podaci se u stranicu ubacuju kao JEDAN JSON blok, a redovi se crtaju u pregledacu. Razlog je
// prakticni: fajl se ceka u gitu i regenerise pri svakoj izmjeni koda, pa ovako razlika ostane
// jedan red umjesto stotinu.
//
// Stranica ne smije traziti nijedan vanjski fajl, font ni skriptu: gleda se i van repoa, sa diska,
// bez mreze.

const STIL = `
:root {
  color-scheme: light dark;
  --pozadina: #ffffff;
  --povrsina: #f6f7f9;
  --ivica: #e2e5ea;
  --tekst: #14171c;
  --prigusen: #5d6572;
  --naglasak: #1d5fd0;
  --trosak: #b03a2e;
  --upis: #8a6d1f;
  --citanje: #1f7a4d;
}
@media (prefers-color-scheme: dark) {
  :root {
    --pozadina: #14171c;
    --povrsina: #1c2027;
    --ivica: #2c323b;
    --tekst: #e8eaed;
    --prigusen: #98a1ae;
    --naglasak: #6fa4ff;
    --trosak: #ef8a7d;
    --upis: #e0bd5f;
    --citanje: #6cc79a;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1.25rem 4rem;
  background: var(--pozadina);
  color: var(--tekst);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
}
main { max-width: 1080px; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 0 0 .35rem; letter-spacing: -.01em; }
h2 { font-size: 1.1rem; margin: 2.2rem 0 .75rem; padding-top: .9rem; border-top: 1px solid var(--ivica); }
p.uvod { color: var(--prigusen); margin: 0 0 1.5rem; max-width: 68ch; }
.trake { display: flex; flex-wrap: wrap; gap: .5rem; margin-bottom: 1.4rem; }
.brojka {
  background: var(--povrsina); border: 1px solid var(--ivica); border-radius: 7px;
  padding: .45rem .7rem; font-size: .82rem; color: var(--prigusen);
}
.brojka b { color: var(--tekst); font-size: 1rem; }
.alatke {
  position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: .6rem;
  padding: .8rem 0; background: var(--pozadina); border-bottom: 1px solid var(--ivica);
}
input[type=search] {
  flex: 1 1 260px; padding: .55rem .7rem; border-radius: 7px;
  border: 1px solid var(--ivica); background: var(--povrsina); color: var(--tekst); font: inherit;
}
.prekidac { display: flex; border: 1px solid var(--ivica); border-radius: 7px; overflow: hidden; }
.prekidac button {
  padding: .55rem .85rem; border: 0; background: var(--povrsina);
  color: var(--prigusen); font: inherit; cursor: pointer;
}
.prekidac button[aria-pressed=true] { background: var(--naglasak); color: #fff; }
table { width: 100%; border-collapse: collapse; font-size: .88rem; }
th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid var(--ivica); vertical-align: top; }
th { color: var(--prigusen); font-weight: 600; font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; }
td.ime { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: nowrap; }
.oznaka { font-size: .72rem; padding: .12rem .4rem; border-radius: 4px; border: 1px solid var(--ivica); white-space: nowrap; }
.vrsta-citanje { color: var(--citanje); }
.vrsta-upis { color: var(--upis); }
.vrsta-trosak { color: var(--trosak); }
.omot { overflow-x: auto; }
.prazno { color: var(--prigusen); padding: 1rem .2rem; }
footer { margin-top: 3rem; color: var(--prigusen); font-size: .82rem; }
`;

const PONASANJE = `
const PODACI = JSON.parse(document.getElementById("podaci").textContent);

function celija(sadrzaj, klasa) {
  const td = document.createElement("td");
  if (klasa) td.className = klasa;
  td.textContent = sadrzaj ?? "";
  return td;
}

function crtaj() {
  for (const tabela of document.querySelectorAll("table[data-izvor]")) {
    const izvor = PODACI[tabela.dataset.izvor];
    const tijelo = tabela.querySelector("tbody");
    tijelo.textContent = "";
    for (const red of izvor) {
      const tr = document.createElement("tr");
      tr.dataset.trazi = red.trazi;
      if (red.profil) tr.dataset.profil = red.profil;
      for (const c of red.celije) tr.appendChild(celija(c.tekst, c.klasa));
      tijelo.appendChild(tr);
    }
  }
  filtriraj();
}

let profil = "svi";

function filtriraj() {
  const upit = document.getElementById("pretraga").value.trim().toLowerCase();
  for (const tabela of document.querySelectorAll("table[data-izvor]")) {
    let vidljivih = 0;
    for (const tr of tabela.querySelectorAll("tbody tr")) {
      const poTekstu = !upit || tr.dataset.trazi.includes(upit);
      const poProfilu =
        profil === "svi" ||
        !tr.dataset.profil ||
        (profil === "klijent" ? tr.dataset.profil !== "admin" : tr.dataset.profil !== "klijent");
      const vidljiv = poTekstu && poProfilu;
      tr.hidden = !vidljiv;
      if (vidljiv) vidljivih += 1;
    }
    const poruka = tabela.parentElement.nextElementSibling;
    if (poruka && poruka.classList.contains("prazno")) poruka.hidden = vidljivih > 0;
  }
}

document.getElementById("pretraga").addEventListener("input", filtriraj);
for (const dugme of document.querySelectorAll(".prekidac button")) {
  dugme.addEventListener("click", () => {
    profil = dugme.dataset.profil;
    for (const d of document.querySelectorAll(".prekidac button")) {
      d.setAttribute("aria-pressed", String(d === dugme));
    }
    filtriraj();
  });
}

crtaj();
`;

// ---------------------------------------------------------------------------------------------
// Slaganje podataka. Ispod ove linije nema izgleda, iznad nje nema podataka.
// ---------------------------------------------------------------------------------------------

/** Tekst u kojem pretraga trazi: sve celije reda spojene i svedene na mala slova. */
function trazi(celije) {
  return celije
    .map((c) => c.tekst ?? "")
    .join(" ")
    .toLowerCase();
}

function red(celije, profil) {
  const c = celije.map((x) => (typeof x === "string" ? { tekst: x } : x));
  return { celije: c, trazi: trazi(c), ...(profil ? { profil } : {}) };
}

function klasaVrste(vrsta) {
  if (vrsta === "citanje") return "oznaka vrsta-citanje";
  if (vrsta === "upis") return "oznaka vrsta-upis";
  return "oznaka vrsta-trosak";
}

function redoviAlata(podaci) {
  return podaci.alati.map((a) =>
    red(
      [
        { tekst: a.ime, klasa: "ime" },
        { tekst: a.opis ?? "" },
        { tekst: a.profil === "admin" ? "samo admin" : a.profil === "klijent" ? "samo klijent" : "klijent i admin" },
        { tekst: a.vrsta, klasa: klasaVrste(a.vrsta) },
        { tekst: a.traziPotvrdu ? "da" : "" },
        { tekst: a.uslov ? a.uslovOpis ?? a.uslov : "" },
      ],
      a.profil,
    ),
  );
}

function redoviCli(podaci) {
  return podaci.cli.map((k) =>
    red([
      { tekst: `olx ${k.putanja}${k.argumenti.length ? ` ${k.argumenti.join(" ")}` : ""}`, klasa: "ime" },
      { tekst: k.opis ?? "" },
      { tekst: k.grupa ? "grupa komandi" : "" },
      { tekst: k.opcije.map((o) => o.zastava).join(", ") },
    ]),
  );
}

function redoviPoslova(podaci) {
  return podaci.poslovi.map((p) =>
    red([
      { tekst: p.sufiks, klasa: "ime" },
      { tekst: p.strana },
      { tekst: p.termin },
      { tekst: p.komanda, klasa: "ime" },
      { tekst: p.strana === "ADMIN" ? "nema (namjerno)" : p.windowsBlizanac ? "da" : "FALI" },
    ]),
  );
}

function redoviPostavki(podaci) {
  return podaci.postavke.postavke.map((p) =>
    red([
      { tekst: p.varijabla, klasa: "ime" },
      { tekst: p.polja.join(", ") },
      {
        tekst: p.zavisiOdProcesa
          ? "izvodi se iz pokrenutog procesa"
          : p.podrazumijevano === undefined
            ? "nije postavljeno"
            : String(p.podrazumijevano),
      },
      { tekst: p.opis ?? "" },
    ]),
  );
}

function redoviOkruzenja(podaci) {
  return podaci.okruzenje.varijable.map((v) =>
    red([
      { tekst: v.ime, klasa: "ime" },
      { tekst: v.konfiguracija ? "konfiguracija klona" : "daje okolina" },
      { tekst: String(v.gdje.length + (v.viseFajlova ?? 0)) },
      { tekst: v.gdje.join(", ") },
      { tekst: v.uPrimjeru ? "da" : "" },
    ]),
  );
}

function redoviResursa(podaci) {
  return podaci.resursi.map((r) => red([{ tekst: r.uri, klasa: "ime" }, { tekst: r.naslov ?? "" }, { tekst: r.opis ?? "" }]));
}

function redoviSkillova(podaci) {
  return podaci.skillovi.map((s) =>
    red([
      { tekst: s.ime, klasa: "ime" },
      { tekst: s.opis },
      { tekst: s.okidaci.slice(0, 3).join(", ") },
      { tekst: s.samoAdmin ? "samo admin" : "" },
    ]),
  );
}

function redoviAgenata(podaci) {
  return podaci.agenti.map((a) =>
    red([{ tekst: a.ime, klasa: "ime" }, { tekst: a.opis }, { tekst: a.alati.join(", ") }]),
  );
}

/** JSON bezbjedan za ubacivanje u <script>: zatvarajuci tag u nizu bi inace prekinuo blok. */
function uJson(objekat) {
  return JSON.stringify(objekat).replace(/<\//g, "<\\/");
}

function odjeljak(naslov, izvor, kolone) {
  return [
    `<h2>${naslov}</h2>`,
    '<div class="omot">',
    `<table data-izvor="${izvor}">`,
    `<thead><tr>${kolone.map((k) => `<th>${k}</th>`).join("")}</tr></thead>`,
    "<tbody></tbody>",
    "</table>",
    "</div>",
    '<p class="prazno" hidden>Nista ne odgovara pretrazi.</p>',
  ].join("\n");
}

export function uHtml(podaci) {
  const izvori = {
    alati: redoviAlata(podaci),
    resursi: redoviResursa(podaci),
    cli: redoviCli(podaci),
    poslovi: redoviPoslova(podaci),
    postavke: redoviPostavki(podaci),
    okruzenje: redoviOkruzenja(podaci),
    skillovi: redoviSkillova(podaci),
    agenti: redoviAgenata(podaci),
  };

  const brojke = [
    ["alata", podaci.alati.length],
    ["klijentu dostupno", podaci.alati.filter((a) => a.profil !== "admin").length],
    ["resursa", podaci.resursi.length],
    ["CLI komandi", podaci.cli.filter((k) => !k.grupa).length],
    ["zakazanih poslova", podaci.poslovi.length],
    ["postavki", podaci.postavke.postavke.length],
    ["skillova", podaci.skillovi.length],
    ["podagenata", podaci.agenti.length],
  ];

  return `<!doctype html>
<html lang="bs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sta ovaj sistem moze</title>
<style>${STIL}</style>
</head>
<body>
<main>
<h1>Sta ovaj sistem moze</h1>
<p class="uvod">Stranica je generisana iz koda (<code>bun scripts/popis-mogucnosti.mjs</code>) i ne dira se rukom. Za objasnjenje obicnim jezikom procitaj <code>sta-sistem-radi.md</code>.</p>
<div class="trake">
${brojke.map(([ime, broj]) => `<span class="brojka"><b>${broj}</b> ${ime}</span>`).join("\n")}
</div>
<div class="alatke">
<input type="search" id="pretraga" placeholder="Pretrazi po imenu, opisu, komandi...">
<div class="prekidac">
<button data-profil="svi" aria-pressed="true">Sve</button>
<button data-profil="klijent" aria-pressed="false">Klijentski profil</button>
<button data-profil="admin" aria-pressed="false">Samo admin</button>
</div>
</div>
${odjeljak("MCP alati", "alati", ["Ime", "Sta radi", "Profil", "Vrsta", "Trazi potvrdu", "Uslov"])}
${odjeljak("MCP resursi", "resursi", ["URI", "Naslov", "Opis"])}
${odjeljak("CLI komande", "cli", ["Komanda", "Sta radi", "", "Opcije"])}
${odjeljak("Zakazani poslovi", "poslovi", ["Posao", "Strana", "Termin", "Komanda", "Windows blizanac"])}
${odjeljak("Postavke", "postavke", ["Varijabla", "Polje", "Podrazumijevano", "Opis"])}
${odjeljak("Varijable okruzenja", "okruzenje", ["Varijabla", "Odakle", "Fajlova", "Gdje", "U .env.example"])}
${odjeljak("Skillovi", "skillovi", ["Ime", "Cemu sluzi", "Okidaci", ""])}
${odjeljak("Podagenti", "agenti", ["Ime", "Cemu sluzi", "Alati"])}
<footer>Prekidac profila djeluje na alate: klijentski bot vidi uzu listu od admin sesije.</footer>
</main>
<script type="application/json" id="podaci">${uJson(izvori)}</script>
<script>${PONASANJE}</script>
</body>
</html>
`;
}
