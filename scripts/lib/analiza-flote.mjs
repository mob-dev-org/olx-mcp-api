// Analiza flote: cist modul bez I/O. Prima vec ucitane dnevne redove diska i masine (iz
// disk-YYYY-MM.jsonl / masina-YYYY-MM.jsonl) i vec izracunat memorijski agregat po klonu
// (povratna vrijednost postojece agregiraj() iz scripts/lib/resursi.mjs), i vraca strukturirane
// nalaze plus gotov tekst za fajl analiza-YYYY-MM-DD.md i kratak sazetak za Telegram.
//
// Orkestracija (citanje JSONL fajlova sa diska, odlucivanje kad je "svaka 3 dana" prosla, pisanje
// fajla, slanje Telegrama) NIJE dio ovog modula, radi je scripts/nadzor-flote.mjs. Ovaj modul ne
// zna nista o disku ni o mrezi, isti princip kao resursi.mjs: sve sto treba dolazi kao argument.
//
// Redoslijed nalaza je NAMJERNO fiksan (vidi analizirajFlotu): po klonu redom 1-6, pa nalazi na
// nivou flote (7, 9, 10, 11), pa 12 (zakazani poslovi po klonu) i na kraju 13 (fleetski sazetak
// poslova, koji se UNSHIFTUJE na sam pocetak niza, vidi analizirajFlotu). Izlaz postivi pravilo
// sazimanja iz olx-dokumentacija/granice.md ("Izlaz"): sazetak je odsjecen na 10 nalaza, tekst za
// fajl ne odsijeca (fajl smije biti pun), a kad nema nalaza ne pravi se ni tabela ni nabrajanje,
// samo jedna recenica.
//
// Opcioni ulazi `budjenja`, `masinaCpuUzorci` i `ugnijezdeneKopije` dolaze gotovi od orkestracije
// (izvuceni iz resursi-*.jsonl / cuvarevih uzoraka / skena diska); prazan niz je legitimno stanje
// za sva tri, ne obavezno prisustvo. `memorijaAgregat.cpuKlona` je opciono polje na vec postojecem
// agregiraj() izlazu: `null` znaci "klon jos nije nadogradjen na CPU telemetriju" (stariji cuvar,
// sema 1 redovi), NIJE greska, samo se taj klon tiho preskace u pravilu 9.

/**
 * Pocetna procjena pragova, NIJE izvedena iz stvarne serije mjerenja (flotni posao tek pocinje da
 * prikuplja dnevne zapise). Treba ih ponovo pogledati kad se skupi nekoliko sedmica stvarnih
 * podataka i po potrebi podesiti kroz `pragovi` parametar, ne mijenjajuci ovaj default naslijepo.
 */
export const PRAGOVI_DEFAULT = {
  rastDiskaApsolutniMb: 200, // MB rasta po klonu kroz period da bi bilo vrijedno pomena
  rastDiskaPostotak: 20, // ILI % rasta (koji god uslov prvi pogodi)
  rastTranskriptaMb: 50,
  padSlobodneMemorijeGb: 1, // pad prosjecne slobodne memorije izmedju prve i druge polovine perioda
  rastSwapaPostotakPoena: 15, // rast udjela iskoristenog swapa (postotni poeni, ne relativni %)
  udioSkokaZaJedanDan: 0.6, // ako JEDAN dan nosi >= 60% ukupne promjene perioda, to je "skok"
  cpuProsjekPostotak: 15, // prosjecan CPU% klona kroz period da bi bio vrijedan pomena
  novaKategorijaMinMb: 10, // ispod ovoga pojava kategorije nije vrijedna pomena (par stotina KB je normalan sum)
};

// Kategorije diska na koje se primjenjuje pravilo "bila prazna, sad ima sadrzaj". node_modules i
// dist su NAMJERNO izostavljeni: njihov rast/pad je normalan uz build, nije signal.
const KATEGORIJE_ZA_NOVU_KATEGORIJU = [
  "olx_pik_snapshots",
  "olx_pik_arhiva",
  "olx_pik_klijent_fajlovi",
  "olx_pik_slike",
  "olx_pik_konkurenti",
  "olx_pik_resursi",
  "olx_pik_ostalo",
  "transkripti",
  "telegram_inbox",
  "ostalo_klona",
];

const REDOSLIJED_KATEGORIJA = ["poslovi", "disk", "transkripti", "masina", "sesija"];
const NASLOV_KATEGORIJE = {
  poslovi: "Zakazani poslovi",
  disk: "Disk",
  transkripti: "Transkripti",
  masina: "Masina",
  sesija: "Sesija",
};

// ---- male pomocne funkcije formatiranja, bez I/O ----

function mb(bajta) {
  return bajta / 1024 ** 2;
}

function gb(bajta) {
  return bajta / 1024 ** 3;
}

/** Zaokruzi na jednu decimalu i vrati broj (ne string), da template literal ne ostavi visak nula. */
function z1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Citljiv prikaz velicine za nalaze: ispod 1 MB prikazuje u KB (cijeli broj), inace u MB na jednu
 * decimalu. Bez ovoga par stotina bajta zaokruzi na "0 MB" i nalaz postane besmislen (izmjereno
 * na kategoriji olx_pik_resursi, 12.08.2026). Koristiti na SVAKOM mjestu gdje se velicina u MB
 * ispisuje korisniku, ne samo ovdje.
 */
export function formatVelicina(bajta) {
  const megabajta = mb(bajta);
  if (Math.abs(megabajta) < 1) {
    return `${Math.round(bajta / 1024)} KB`;
  }
  return `${z1(megabajta)} MB`;
}

/** "2026-08-12T09:00:00.000Z" -> "2026-08-12". `null` na nevaljan ulaz. */
function datumIso(ts) {
  return typeof ts === "string" && ts.length >= 10 ? ts.slice(0, 10) : null;
}

function nalaz(kategorija, klon, tekst, ozbiljnost = "info") {
  return { kategorija, klon, tekst, ozbiljnost };
}

function periodDana(periodOd, periodDo) {
  const ms = Date.parse(periodDo) - Date.parse(periodOd);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.round(ms / 86_400_000);
}

// ---- zakazani poslovi (potpunost po klonu) ----
//
// scripts/provjeri-klon.mjs danas SAMO broji koliko poslova je registrovano naspram ocekivanog
// broja (>= prag) i na obje platforme vraca najvise "PAZNJA" kad je klon ispod praga - nikad ne
// kaze KOJI konkretno poslovi fale. Klon sa 2 od 4 obavezna posla prolazi identicno kao klon sa
// svih 4, dok god je iznad praga. Ovaj modul ide dalje: parsira SUFIKS svakog registrovanog posla
// (npr. "snapshot" iz TaskName/Label "ba.codefactory.olx.<klon>.snapshot") i vraca tacno koji
// sufiksi fale, po imenu. Namjerno NIJE reuse funkcije iz provjeri-klon.mjs: ona nikad ne izvlaci
// pojedinacne sufikse posla, samo broji retke, pa ne postoji sta ovdje pozvati.
//
// Orkestracija (execFileSync schtasks/launchctl, JEDNOM po pokretanju cijelog nadzora, ne po
// klonu - isti proces cita istu listu za sve klonove na toj masini) zivi u
// scripts/nadzor-flote.mjs. Ovaj modul dobija VEC procitane sirove redove teksta (ili `null` kad
// komanda taj dan nije uspjela) i sve racuna cisto, bez I/O, testabilno.

/** Cetiri posla koja MORAJU postojati na svakom klonu (isti skup kao instaliraj-cron.sh /
 * instaliraj-zadatke.ps1 bez uslovnih grana). ".claude-runtime" je vec FALI provjera u
 * provjeri-klon.mjs (sekcija 6), pa je "sesija" posao obavezan, ne uslovan. */
export const OBAVEZNI_POSLOVI = ["snapshot", "dnevno", "sedmicno", "sesija"];

/**
 * Ocekivani poslovi za jedan klon: 4 obavezna + uslovni "admin-bot" (samo kad postoji
 * `.claude-runtime-admin` I `jednobotni` NIJE ukljucen) + uslovni "backup" (samo kad je
 * `OLX_STANJE_REPO` popunjen u `.env` tog klona). Isti uslovi kao scripts/instaliraj-cron.sh i
 * deploy/windows/instaliraj-zadatke.ps1: prepisivanje uslovnog posla kao obaveznog bi ispravan
 * klon lazno prijavilo kao nepotpun.
 *
 * `jednobotni` (default false, isto ponasanje kao prije uvodjenja ovog parametra kad se izostavi
 * ili prosledi `undefined`): true znaci da JEDAN bot token vozi obje zive sesije kroz posao
 * "sesija" (OLX_MOST_ADMIN_TG_ID popunjen u .env klona, vidi scripts/lib/most.mjs). Takav klon IMA
 * `.claude-runtime-admin` (nosi prompt i profil admin sesije) ali NEMA odvojen posao "admin-bot"
 * (dva getUpdates konzumera na istom tokenu daju 409 Conflict), pa se admin-bot ovdje ne dodaje
 * ni kad `imaAdminRuntime` je true.
 */
export function ocekivaniPoslovi({ imaAdminRuntime = false, imaStanjeRepo = false, jednobotni = false } = {}) {
  const poslovi = [...OBAVEZNI_POSLOVI];
  if (imaAdminRuntime && !jednobotni) poslovi.push("admin-bot");
  if (imaStanjeRepo) poslovi.push("backup");
  return poslovi;
}

/**
 * Izvlaci sufiks posla (dio iza "ba.codefactory.olx.<klon>.") iz JEDNOG reda sirovog izlaza
 * `schtasks /fo csv` ili `launchctl list`. Poredjenje prefiksa je case-insensitive (isti ugovor
 * kao Windows grana u provjeri-klon.mjs), a sufiks se cita kao pocetni niz `[a-zA-Z0-9_-]`
 * poslije prefiksa - taj skup znakova pokriva sva postojeca imena poslova (snapshot, dnevno,
 * sedmicno, sesija, admin-bot, backup) i prirodno se zaustavlja na navodniku (schtasks CSV) ili
 * razmaku/tabu (launchctl Label), pa JEDAN parser radi na oba formata bez platformske grane.
 * Vraca lowercase sufiks, ili `null` ako red ne sadrzi prefiks ovog klona.
 */
export function izvuciSufiksPosla(red, imeKlona) {
  if (typeof red !== "string" || typeof imeKlona !== "string" || imeKlona === "") return null;
  const prefiks = `ba.codefactory.olx.${imeKlona}.`.toLowerCase();
  const i = red.toLowerCase().indexOf(prefiks);
  if (i === -1) return null;
  const poslije = red.slice(i + prefiks.length);
  const m = poslije.match(/^[a-zA-Z0-9_-]+/);
  return m ? m[0].toLowerCase() : null;
}

/** Skup registrovanih sufiksa posla za jedan klon, iz svih sirovih redova (schtasks/launchctl). */
export function registrovaniSufiksiPosla(redovi, imeKlona) {
  const skup = new Set();
  if (!Array.isArray(redovi)) return skup;
  for (const red of redovi) {
    const sufiks = izvuciSufiksPosla(red, imeKlona);
    if (sufiks) skup.add(sufiks);
  }
  return skup;
}

/**
 * Status zakazanih poslova jednog klona za dnevni uzorak (upisuje se u disk red kao `poslovi`
 * polje, vidi scripts/nadzor-flote.mjs). `redovi === null`/`undefined` znaci da schtasks/launchctl
 * upit TAJ DAN nije uspio (komanda nedostupna ili je pukla) - status je NEPOZNAT
 * (`poznato: false`), NIJE greska: obilazak flote ide dalje, samo se taj dan ne moze reci nista o
 * poslovima tog klona.
 */
export function izracunajStatusPoslova({ redovi, imeKlona, imaAdminRuntime = false, imaStanjeRepo = false, jednobotni = false } = {}) {
  if (redovi === null || redovi === undefined) return { poznato: false };
  const ocekivano = ocekivaniPoslovi({ imaAdminRuntime, imaStanjeRepo, jednobotni });
  const registrovano = registrovaniSufiksiPosla(redovi, imeKlona);
  const nedostaje = ocekivano.filter((p) => !registrovano.has(p));
  return {
    poznato: true,
    ocekivanoBroj: ocekivano.length,
    registrovanoBroj: ocekivano.length - nedostaje.length,
    nedostaje,
  };
}

/**
 * 12. Zakazani poslovi po klonu nepotpuni. Koristi ZADNJI (najnoviji) dnevni red diska iz perioda
 * - ovo je status NA DAN skeniranja, ne trend kao pravila 1-6, pa NIJE gatovano sa "bar dvije
 * tacke" uslovom (jedan dan je dovoljan da se kaze da li poslovi fale). `poslovi` polje dodaje
 * nadzor-flote.mjs u disk red; stariji redovi (prije ove izmjene) ga nemaju uopste, sto se tiho
 * preskace, isto kao i `poslovi.poznato === false` (upit tog dana nije uspio).
 */
function analizirajPoslove(klon, diskRedovi) {
  if (!Array.isArray(diskRedovi) || diskRedovi.length === 0) return null;
  const poslovi = diskRedovi[diskRedovi.length - 1]?.poslovi;
  if (!poslovi || poslovi.poznato !== true) return null;
  if (!Array.isArray(poslovi.nedostaje) || poslovi.nedostaje.length === 0) return null;
  return nalaz(
    "poslovi",
    klon,
    `${klon}: zakazani poslovi nepotpuni (${poslovi.registrovanoBroj}/${poslovi.ocekivanoBroj}), fali: ${poslovi.nedostaje.join(", ")}.`,
    "upozorenje",
  );
}

/**
 * 13. Fleetski sazetak: koliko klonova SA POZNATIM statusom ima nepotpune poslove. Ovo je broj
 * zbog kojeg cijeli ovaj nalaz postoji (mjerenje prije pooštravanja provjeri-klon.mjs kapije sa
 * PAZNJA na FALI, vidi zadatak), zato ga analizirajFlotu stavlja na SAM POCETAK sazetka
 * (unshift), ne na kraj gdje bi ga velika flota mogla odsjeci (pravilo "10 nalaza" u sazetku).
 */
function analizirajPotpunostPoslovaFlote(podaciPoKlonu) {
  let poznatih = 0;
  let nepotpunih = 0;
  for (const podaci of Object.values(podaciPoKlonu ?? {})) {
    const diskRedovi = podaci?.diskRedovi ?? [];
    if (diskRedovi.length === 0) continue;
    const poslovi = diskRedovi[diskRedovi.length - 1]?.poslovi;
    if (!poslovi || poslovi.poznato !== true) continue;
    poznatih += 1;
    if (Array.isArray(poslovi.nedostaje) && poslovi.nedostaje.length > 0) nepotpunih += 1;
  }
  if (poznatih === 0 || nepotpunih === 0) return null;
  return nalaz(
    "poslovi",
    null,
    `Zakazani poslovi: ${nepotpunih} od ${poznatih} klonova sa poznatim statusom ima nepotpune poslove.`,
    "upozorenje",
  );
}

// ---- nalazi po klonu (1-6) ----

/** 1. Rast diska ukupno, sa ocjenom da li je to skok u jednom danu ili ravnomjeran rast. */
function analizirajRastDiska(klon, diskRedovi, pragovi) {
  const prvi = diskRedovi[0];
  const zadnji = diskRedovi[diskRedovi.length - 1];
  const deltaBajta = zadnji.ukupno_bajta - prvi.ukupno_bajta;
  const deltaMb = mb(deltaBajta);
  const deltaPct = prvi.ukupno_bajta > 0 ? (deltaBajta / prvi.ukupno_bajta) * 100 : null;

  const pogadjaApsolutno = deltaMb >= pragovi.rastDiskaApsolutniMb;
  const pogadjaPostotak = deltaPct !== null && deltaPct >= pragovi.rastDiskaPostotak;
  if (!pogadjaApsolutno && !pogadjaPostotak) return null;

  let tekst = `${klon}: disk narastao ${formatVelicina(deltaBajta)}`;
  if (deltaPct !== null) tekst += ` (${z1(deltaPct)}%)`;
  tekst += ` u periodu, sa ${z1(gb(prvi.ukupno_bajta))} na ${z1(gb(zadnji.ukupno_bajta))} GB.`;

  let sumaDnevnihDelta = 0;
  let najveciPojedinacniDan = 0;
  let najveciDanTs = null;
  for (let i = 1; i < diskRedovi.length; i++) {
    const d = Math.abs(diskRedovi[i].ukupno_bajta - diskRedovi[i - 1].ukupno_bajta);
    sumaDnevnihDelta += d;
    if (d > najveciPojedinacniDan) {
      najveciPojedinacniDan = d;
      najveciDanTs = diskRedovi[i].ts;
    }
  }

  if (sumaDnevnihDelta === 0) {
    tekst += " Ravnomjeran rast kroz period.";
  } else if (najveciPojedinacniDan / sumaDnevnihDelta >= pragovi.udioSkokaZaJedanDan) {
    tekst += ` Skok u jednom danu (${datumIso(najveciDanTs)}), ne ravnomjeran rast.`;
  } else {
    tekst += " Ravnomjeran rast kroz period.";
  }

  return nalaz("disk", klon, tekst, "info");
}

/**
 * 2. Kategorija koja je bila prazna (0 bajta) na pocetku a ima sadrzaj na kraju perioda, i taj
 * sadrzaj je dovoljno velik (>= `pragovi.novaKategorijaMinMb`) da vrijedi pomena. Pojava od par
 * stotina bajta se desava rutinski (npr. jedan prazan log fajl) i tiho se preskace, nije nalaz.
 */
function analizirajNoveKategorije(klon, prvi, zadnji, pragovi) {
  const rezultat = [];
  const pragBajta = pragovi.novaKategorijaMinMb * 1024 ** 2;
  for (const k of KATEGORIJE_ZA_NOVU_KATEGORIJU) {
    const prviBajta = prvi.kategorije?.[k]?.bajta;
    const zadnjiBajta = zadnji.kategorije?.[k]?.bajta;
    if (prviBajta === 0 && typeof zadnjiBajta === "number" && zadnjiBajta >= pragBajta) {
      rezultat.push(
        nalaz("disk", klon, `${klon}: kategorija ${k} je bila prazna, sad ima ${formatVelicina(zadnjiBajta)}.`, "info"),
      );
    }
  }
  return rezultat;
}

/** 3. Sesija nijednom nije bila u strazi kroz period: glavni pokazatelj da strazar ne radi. */
function analizirajStrazu(klon, memorijaAgregat) {
  if (!memorijaAgregat) return null;
  if (memorijaAgregat.brojUzoraka > 0 && memorijaAgregat.vrijemeUStrazi.ms === 0) {
    return nalaz(
      "sesija",
      klon,
      `${klon}: nije bio u strazi nijednom u periodu, provjeri OLX_MOST_IDLE_MIN i da pogon radi.`,
      "upozorenje",
    );
  }
  return null;
}

/** 4. Rast transkripta kroz period (obim razgovora, ne trosak tokena). */
function analizirajTranskript(klon, prvi, zadnji, pragovi) {
  const prviBajta = prvi.kategorije?.transkripti?.bajta;
  const zadnjiBajta = zadnji.kategorije?.transkripti?.bajta;
  if (typeof prviBajta !== "number" || typeof zadnjiBajta !== "number") return null;
  const deltaBajta = zadnjiBajta - prviBajta;
  const deltaMb = mb(deltaBajta);
  if (deltaMb < pragovi.rastTranskriptaMb) return null;
  return nalaz(
    "transkripti",
    klon,
    `${klon}: transkripti narasli ${formatVelicina(deltaBajta)} u periodu (pokazatelj obima razgovora, ne mjera potrosnje tokena).`,
    "info",
  );
}

/** 5. Neuspjelo skeniranje diska za tog klona u periodu. */
function analizirajGreske(klon, diskRedovi) {
  const greske = diskRedovi.filter((r) => r.greska !== null && r.greska !== undefined);
  if (greske.length === 0) return null;
  const zadnjaGreska = greske[greske.length - 1].greska;
  return nalaz(
    "disk",
    klon,
    `${klon}: skeniranje nije uspjelo ${greske.length} od ${diskRedovi.length} dana (${zadnjaGreska}).`,
    "upozorenje",
  );
}

/** 6. Ucestali padovi sesije (isti prag kao postojeci agregiraj() savjet, ali eksplicitno po klonu). */
function analizirajPadove(klon, memorijaAgregat) {
  if (!memorijaAgregat || memorijaAgregat.padovi.broj <= 3) return null;
  return nalaz(
    "sesija",
    klon,
    `${klon}: ${memorijaAgregat.padovi.broj} padova sesije u periodu, provjeri cron-*.log.`,
    "upozorenje",
  );
}

// ---- nalazi na nivou flote (7) ----

function prosjekPolja(niz, polje) {
  const vrijednosti = niz.map((r) => r[polje]).filter((v) => typeof v === "number");
  if (vrijednosti.length === 0) return null;
  return vrijednosti.reduce((s, v) => s + v, 0) / vrijednosti.length;
}

function prosjekUdioSwapa(niz) {
  const udjeli = [];
  for (const r of niz) {
    if (
      typeof r.swap_ukupno_bajta === "number" &&
      r.swap_ukupno_bajta > 0 &&
      typeof r.swap_koristeno_bajta === "number"
    ) {
      udjeli.push(r.swap_koristeno_bajta / r.swap_ukupno_bajta);
    }
  }
  if (udjeli.length === 0) return null;
  return udjeli.reduce((s, v) => s + v, 0) / udjeli.length;
}

/** 7. Pad slobodne memorije i rast udjela swapa na nivou masine, prva vs druga polovina perioda. */
function analizirajMasinu(masinaRedovi, pragovi) {
  const rezultat = [];
  if (!Array.isArray(masinaRedovi) || masinaRedovi.length < 2) return rezultat;

  const pola = Math.floor(masinaRedovi.length / 2);
  const prvaPolovina = masinaRedovi.slice(0, pola);
  const drugaPolovina = masinaRedovi.slice(pola);

  const slobodnoPrva = prosjekPolja(prvaPolovina, "slobodno_bajta");
  const slobodnoDruga = prosjekPolja(drugaPolovina, "slobodno_bajta");
  if (slobodnoPrva !== null && slobodnoDruga !== null) {
    const padGb = (slobodnoPrva - slobodnoDruga) / 1024 ** 3;
    if (padGb >= pragovi.padSlobodneMemorijeGb) {
      rezultat.push(
        nalaz(
          "masina",
          null,
          `Masina: slobodna memorija pala ${z1(padGb)} GB u periodu, sa ${z1(gb(slobodnoPrva))} na ${z1(gb(slobodnoDruga))} GB prosjecno.`,
          "upozorenje",
        ),
      );
    }
  }

  const udioPrve = prosjekUdioSwapa(prvaPolovina);
  const udioDruge = prosjekUdioSwapa(drugaPolovina);
  if (udioPrve !== null && udioDruge !== null) {
    const rastPoena = (udioDruge - udioPrve) * 100;
    if (rastPoena >= pragovi.rastSwapaPostotakPoena) {
      rezultat.push(
        nalaz(
          "masina",
          null,
          `Masina: udio iskoristenog swapa porastao ${z1(rastPoena)} postotnih poena u periodu, sa ${z1(udioPrve * 100)}% na ${z1(udioDruge * 100)}%.`,
          "upozorenje",
        ),
      );
    }
  }

  return rezultat;
}

// 8. Hladni startovi u istoj minuti: prvobitno OSTAVLJENO ZA BUDUCU FAZU (agregiraj() je tada
// vracao hladniStartovi SAMO agregirano po klonu, bez vremenskih pecata pojedinacnih budjenja).
// Sada orkestracija priprema gotovu ravnu listu budjenja sa ts po dogadjaju, pa je ovo
// implementirano kao pravilo 10 ispod (analizirajBudjenjaKlaster).

/**
 * 9. Klon koji je u periodu prosjecno trosio najvise procesora, preko svih klonova koji IMAJU
 * `memorijaAgregat.cpuKlona` (ovo polje dodaje noviji cuvar; klon sa `cpuKlona: null` je stariji
 * build, sema 1 redovi, NIJE greska nego "nema sta reci", tiho se preskace). Ako nijedan klon
 * nema CPU podatak, nema ni nalaza ni greske: to je normalno stanje dok se flota ne nadogradi.
 */
function analizirajCpuKlona(podaciPoKlonu, periodOd, pragovi) {
  let najboljiKlon = null;
  let najboljiCpu = null;

  for (const [klon, podaci] of Object.entries(podaciPoKlonu ?? {})) {
    const cpu = podaci?.memorijaAgregat?.cpuKlona;
    if (!cpu || typeof cpu.prosjekPct !== "number") continue;
    if (najboljiCpu === null || cpu.prosjekPct > najboljiCpu.prosjekPct) {
      najboljiKlon = klon;
      najboljiCpu = cpu;
    }
  }

  if (najboljiKlon === null || najboljiCpu.prosjekPct < pragovi.cpuProsjekPostotak) return null;

  let tekst = `${najboljiKlon}: trosio najvise procesora u periodu, prosjek ${z1(najboljiCpu.prosjekPct)}%`;
  tekst += typeof najboljiCpu.peakPct === "number" ? ` (peak ${z1(najboljiCpu.peakPct)}%).` : ".";

  if (
    najboljiCpu.cpuPodaciOd &&
    periodOd &&
    Date.parse(najboljiCpu.cpuPodaciOd) > Date.parse(periodOd)
  ) {
    tekst += ` (CPU podaci dostupni tek od ${datumIso(najboljiCpu.cpuPodaciOd)}, prosjek ne pokriva cio period.)`;
  }

  return nalaz("sesija", najboljiKlon, tekst, "info");
}

/** "2026-08-12T09:15:32.000Z" -> "2026-08-12T09:15" (skrati na minutu, ignorisi sekunde). */
function skratiNaMinutu(ts) {
  return typeof ts === "string" && ts.length >= 16 ? ts.slice(0, 16) : null;
}

function prosjekMasinaCpu(niz) {
  const vrijednosti = (niz ?? []).map((u) => u?.zauzetoPct).filter((v) => typeof v === "number");
  if (vrijednosti.length === 0) return null;
  return vrijednosti.reduce((s, v) => s + v, 0) / vrijednosti.length;
}

// Odabir uslova za "vidljiv skok CPU-a" na masini oko trenutka klastera budjenja: relativni prag
// (>= 1.5x prosjeka niza) hvata skok na masini koja inace radi na niskom bazalu, gdje apsolutnih
// 50% rijetko dostigne; apsolutni prag (>= 50%) hvata slucaj kad je prosjek niza vec visok pa
// relativni prag postane neosjetljiv. Uzima se ono sto PRVO pogodi (OR), ne oba istovremeno.
const CPU_SKOK_RELATIVNI_FAKTOR = 1.5;
const CPU_SKOK_APSOLUTNI_PRAG = 50;

/** Najveci "znacajan" CPU uzorak masine unutar +/- 2 minute od pocetka `minuta`, ili `null`. */
function nadjiCpuSkok(minuta, masinaCpuUzorci, prosjekSvih) {
  if (!Array.isArray(masinaCpuUzorci) || masinaCpuUzorci.length === 0 || prosjekSvih === null) return null;
  const minutaMs = Date.parse(`${minuta}:00.000Z`);
  if (!Number.isFinite(minutaMs)) return null;
  const dozvoljenoMs = 2 * 60_000;

  let najbolji = null;
  for (const u of masinaCpuUzorci) {
    const t = Date.parse(u?.ts);
    if (!Number.isFinite(t) || typeof u?.zauzetoPct !== "number") continue;
    if (Math.abs(t - minutaMs) > dozvoljenoMs) continue;
    const znacajno = u.zauzetoPct >= prosjekSvih * CPU_SKOK_RELATIVNI_FAKTOR || u.zauzetoPct >= CPU_SKOK_APSOLUTNI_PRAG;
    if (znacajno && (najbolji === null || u.zauzetoPct > najbolji)) najbolji = u.zauzetoPct;
  }
  return najbolji;
}

/**
 * 10. Budjenja vise RAZLICITIH klonova unutar iste minute (nagovjestaj CPU stampeda). Budjenja
 * iz istog klona u istoj minuti NISU klaster (jedan klon se ne moze "stampedirati" sam sa sobom).
 * `masinaCpuUzorci` je samo DOPUNSKI dokaz: kad postoji podudaranje, dodaje se na kraj recenice,
 * ali klaster je i bez njega valjan nalaz.
 */
function analizirajBudjenjaKlaster(budjenja, masinaCpuUzorci) {
  const rezultat = [];
  if (!Array.isArray(budjenja) || budjenja.length === 0) return rezultat;

  const grupePoMinuti = new Map();
  for (const b of budjenja) {
    const minuta = skratiNaMinutu(b?.ts);
    if (!minuta || !b?.klon) continue;
    if (!grupePoMinuti.has(minuta)) grupePoMinuti.set(minuta, new Set());
    grupePoMinuti.get(minuta).add(b.klon);
  }

  const prosjekSvih = prosjekMasinaCpu(masinaCpuUzorci);

  for (const minuta of [...grupePoMinuti.keys()].sort()) {
    const klonovi = [...grupePoMinuti.get(minuta)].sort();
    if (klonovi.length < 2) continue;

    const datum = minuta.slice(0, 10);
    const vrijeme = minuta.slice(11);
    let tekst = `U ${vrijeme} ${datum} probudilo se ${klonovi.length} klonova istovremeno: ${klonovi.join(", ")}.`;

    const skok = nadjiCpuSkok(minuta, masinaCpuUzorci, prosjekSvih);
    if (skok !== null) tekst += ` Uz vidljiv skok CPU-a na masini (~${z1(skok)}%).`;

    rezultat.push(nalaz("sesija", null, tekst, "upozorenje"));
  }

  return rezultat;
}

/** 11. Ugnijezdena kopija klona (jedan klon slucajno kopiran unutar drugog). Bez praga: uvijek. */
function analizirajUgnijezdeneKopije(ugnijezdeneKopije) {
  const rezultat = [];
  for (const u of ugnijezdeneKopije ?? []) {
    if (!u?.klon || !u?.putanja) continue;
    rezultat.push(
      nalaz(
        "disk",
        u.klon,
        `${u.klon}: pronadjena ugnijezdena kopija kod ${u.putanja}, provjeri da se isti klon ne broji dvaput u nadzoru.`,
        "upozorenje",
      ),
    );
  }
  return rezultat;
}

// ---- sastavljanje teksta ----

function napraviPuniTekst(periodOd, periodDo, nalazi) {
  const odDatum = datumIso(periodOd);
  const doDatum = datumIso(periodDo);
  const dijelovi = [`# Analiza flote (${odDatum} do ${doDatum})`, ""];

  for (const kategorija of REDOSLIJED_KATEGORIJA) {
    const zaKategoriju = nalazi.filter((n) => n.kategorija === kategorija);
    if (zaKategoriju.length === 0) continue;
    dijelovi.push(`## ${NASLOV_KATEGORIJE[kategorija]}`);
    for (const n of zaKategoriju) dijelovi.push(`- ${n.tekst}`);
    dijelovi.push("");
  }

  return `${dijelovi.join("\n").trimEnd()}\n`;
}

function napraviSazetak(nalazi) {
  const prikazano = nalazi.slice(0, 10);
  const linije = prikazano.map((n) => n.tekst);
  if (nalazi.length > 10) linije.push(`I jos ${nalazi.length - 10}.`);
  return linije.join("\n");
}

// ---- glavna funkcija ----

/**
 * Analizira flotu za jedan period (obicno 3 dana). Cista funkcija, bez I/O: sve podatke prima
 * vec ucitane. Redoslijed nalaza je fiksan: po svakom klonu iz `podaciPoKlonu` (redoslijed
 * kljuceva objekta) redom pravila 1-6, pa na kraju nalazi na nivou flote (pravila 7, 9, 10, 11).
 *
 * Klon se preskace za sve nalaze 1-6 ako ima manje od dvije tacke u `diskRedovi` (jedna tacka ne
 * prica nista o trendu), ali `memorijaAgregat` NIJE uslovljen time (koristi se samo unutar tog
 * klona kad se klon inace obradjuje). Pravilo 9 (CPU po klonu) NIJE uslovljeno duzinom
 * `diskRedovi`: gleda SVE klonove iz `podaciPoKlonu` nezavisno, jer se oslanja samo na
 * `memorijaAgregat.cpuKlona`. Pravilo 12 (zakazani poslovi po klonu) je iz istog razloga NIJE
 * uslovljeno duzinom `diskRedovi` (samo >= 1 red): status poslova je stanje NA DAN skeniranja, ne
 * trend, pa i klon sa jednim danom podataka moze dobiti nalaz. Pravilo 13 (fleetski sazetak
 * poslova) se racuna na kraju i UNSHIFTUJE na pocetak `nalazi`, ispred svih ostalih pravila.
 */
export function analizirajFlotu({
  periodOd,
  periodDo,
  podaciPoKlonu = {},
  masinaRedovi = [],
  budjenja = [],
  masinaCpuUzorci = [],
  ugnijezdeneKopije = [],
  pragovi: pragoviOverride = {},
} = {}) {
  const pragovi = { ...PRAGOVI_DEFAULT, ...pragoviOverride };
  const nalazi = [];

  for (const [klon, podaci] of Object.entries(podaciPoKlonu ?? {})) {
    const diskRedovi = podaci?.diskRedovi ?? [];
    const memorijaAgregat = podaci?.memorijaAgregat ?? null;
    if (!Array.isArray(diskRedovi) || diskRedovi.length < 2) continue;

    const prvi = diskRedovi[0];
    const zadnji = diskRedovi[diskRedovi.length - 1];

    const nRast = analizirajRastDiska(klon, diskRedovi, pragovi);
    if (nRast) nalazi.push(nRast);

    for (const n of analizirajNoveKategorije(klon, prvi, zadnji, pragovi)) nalazi.push(n);

    const nStraza = analizirajStrazu(klon, memorijaAgregat);
    if (nStraza) nalazi.push(nStraza);

    const nTranskript = analizirajTranskript(klon, prvi, zadnji, pragovi);
    if (nTranskript) nalazi.push(nTranskript);

    const nGreske = analizirajGreske(klon, diskRedovi);
    if (nGreske) nalazi.push(nGreske);

    const nPadovi = analizirajPadove(klon, memorijaAgregat);
    if (nPadovi) nalazi.push(nPadovi);
  }

  for (const n of analizirajMasinu(masinaRedovi, pragovi)) nalazi.push(n);

  const nCpu = analizirajCpuKlona(podaciPoKlonu, periodOd, pragovi);
  if (nCpu) nalazi.push(nCpu);

  for (const n of analizirajBudjenjaKlaster(budjenja, masinaCpuUzorci)) nalazi.push(n);

  for (const n of analizirajUgnijezdeneKopije(ugnijezdeneKopije)) nalazi.push(n);

  for (const [klon, podaci] of Object.entries(podaciPoKlonu ?? {})) {
    const nPoslovi = analizirajPoslove(klon, podaci?.diskRedovi);
    if (nPoslovi) nalazi.push(nPoslovi);
  }

  const nPotpunostPoslova = analizirajPotpunostPoslovaFlote(podaciPoKlonu);
  if (nPotpunostPoslova) nalazi.unshift(nPotpunostPoslova);

  if (nalazi.length === 0) {
    const dana = periodDana(periodOd, periodDo);
    const bezNalazaTekst = dana === 1 ? "1 dan bez promjene koja trazi paznju." : `${dana} dana bez promjene koja trazi paznju.`;
    return { nalazi: [], tekst: bezNalazaTekst, sazetak: bezNalazaTekst };
  }

  return {
    nalazi,
    tekst: napraviPuniTekst(periodOd, periodDo, nalazi),
    sazetak: napraviSazetak(nalazi),
  };
}
