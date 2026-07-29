// Pretvaranje izracunatih izvjestaja u tekst za covjeka.
//
// Ciste funkcije, bez mreze i bez fajlova, kao i stats.ts. Postoje da isti brojevi mogu otici i
// klijentu na Telegram (bez modela, dakle bez tokena) i u markdown koji se salje na uvid.
//
// Dva formata, jer im je publika razlicita:
//   markdown  = onboarding izvjestaj koji klijent cita jednom, moze biti dug
//   telegram  = dnevna i sedmicna poruka, mora stati u jednu poruku i biti citljiva na telefonu

import type { AlarmiNaloga, DnevniPlanObnova, OnboardingIzvjestaj, PromjenaPregleda } from "./stats.js";
import type { PlanSazetak } from "./plan.js";

// Telegram lomi poruke duze od 4096 znakova. Ciljamo znatno nize jer se duga poruka na telefonu
// ne cita, nego preskace.
export const TELEGRAM_MEKI_LIMIT = 1200;

function broj(n: number | null | undefined, ako = "nepoznato"): string {
  return n === null || n === undefined ? ako : String(n);
}

/** Skracuje naslov da red stane u jedan red na telefonu. */
export function skrati(tekst: string, maks = 45): string {
  const t = tekst.trim();
  return t.length <= maks ? t : `${t.slice(0, maks - 1).trimEnd()}...`;
}

/**
 * Cijepa dugu poruku na dijelove ispod limita, po granici reda.
 * Telegram bi je iscijepao svakako, ali nasumicno usred recenice.
 */
export function podijeli(tekst: string, limit = TELEGRAM_MEKI_LIMIT): string[] {
  if (tekst.length <= limit) return [tekst];
  const dijelovi: string[] = [];
  let tekuci = "";
  for (const red of tekst.split("\n")) {
    if (tekuci.length + red.length + 1 > limit && tekuci.length > 0) {
      dijelovi.push(tekuci.trimEnd());
      tekuci = "";
    }
    tekuci += `${red}\n`;
  }
  if (tekuci.trim().length > 0) dijelovi.push(tekuci.trimEnd());
  return dijelovi;
}

/**
 * Onboarding izvjestaj kao markdown. Ovo je dokument koji klijent dobija na pocetku saradnje,
 * pa smije biti dug. Namjerno bez procjena zarade: samo ono sto je izbrojano.
 */
export function onboardingMarkdown(i: OnboardingIzvjestaj): string {
  const r: string[] = [];
  const n = i.nalog;

  r.push(`# Pregled shopa ${n.username ?? ""}`.trimEnd(), "");

  r.push("## Nalog", "");
  r.push(`- Paket: ${n.paket ?? "nepoznat"}${n.paket_istice_za_dana !== null ? `, istice za ${n.paket_istice_za_dana} dana` : ""}`);
  r.push(
    `- Aktivnih oglasa: ${n.aktivnih_oglasa}` +
      (n.limit_oglasa !== null ? ` od ${n.limit_oglasa} koliko paket dozvoljava (${n.popunjenost_procenat}%)` : ""),
  );
  r.push(`- Krediti na nalogu: ${broj(n.krediti)}`);
  // nova_pitanja se NE iznosi: brojac new_questions_count sa API-ja nije potvrdjen u praksi
  // (na zivom nalogu pokazao 0 uz postojeca pitanja), pa se klijentu o pitanjima ne tvrdi nista.
  r.push("");

  const o = i.besplatne_obnove;
  r.push("## Besplatne obnove", "");
  if (o.kvota === 0) {
    r.push("- Kvota besplatnih obnova nije dostupna na ovom nalogu.");
  } else {
    r.push(`- Mjesecna kvota: ${o.kvota}`);
    r.push(`- Iskorisceno: ${o.iskorisceno}`);
    r.push(`- Neiskorisceno: ${o.preostalo} (${o.propusteno_procenat}% kvote)`);
    if (o.preostalo > 0) {
      r.push(
        `- Do kraja mjeseca je jos ${o.dana_do_kraja_mjeseca} dana, sto znaci oko ${o.preporuceno_dnevno} obnova dnevno da se kvota ne baci.`,
      );
    }
    r.push("");
    r.push("Obnova ne kosta nista i vraca oglas na vrh po svjezini. Neiskoristena kvota se ne prenosi u sljedeci mjesec.");
  }
  r.push("");

  if (i.higijena.length > 0) {
    r.push("## Sta treba popraviti na oglasima", "");
    for (const h of i.higijena) {
      r.push(`- **${h.broj} oglasa**: ${h.poruka}`);
      for (const p of (h.primjeri ?? []).slice(0, 3)) {
        r.push(`  - ${skrati(p.title, 60)}`);
      }
    }
    if (!i.higijena_provjerena) {
      r.push("");
      r.push(
        "Provjerene su samo stvari vidljive iz liste oglasa. Slike, podnaslov, opis i atributi nisu provjereni jer zadnji dnevni snimak jos ne nosi te podatke. Sljedeci snimak ih donosi.",
      );
    }
    r.push("");
  }

  const s = i.svjezina;
  r.push("## Svjezina", "");
  r.push(`- Nije obnovljeno vise od 7 dana: ${s.neobnovljeno_7} oglasa`);
  r.push(`- Vise od 14 dana: ${s.neobnovljeno_14}`);
  r.push(`- Vise od 30 dana: ${s.neobnovljeno_30}`);
  if ((s.najstariji ?? []).length > 0) {
    r.push("", "Najdulje bez obnove:");
    for (const p of (s.najstariji ?? []).slice(0, 5)) r.push(`- ${skrati(p.title, 60)}`);
  }
  r.push("");

  if (i.ucinak) {
    const u = i.ucinak;
    r.push("## Ucinak", "");
    r.push(
      `Mjereno na ${u.obuhvaceno} oglasa` +
        (u.podaci_stari_dana !== null ? `, podaci stari ${u.podaci_stari_dana} dana.` : "."),
    );
    r.push("");
    if (u.top.length > 0) {
      r.push("Najgledaniji po danu:", "");
      for (const t of u.top.slice(0, 5)) {
        r.push(`- ${skrati(t.title ?? String(t.id), 55)}: ${t.pregleda_dnevno ?? "?"} pregleda dnevno`);
      }
      r.push("");
    }
    if (u.bez_pregleda_30_dana.broj > 0) {
      r.push(`- ${u.bez_pregleda_30_dana.broj} oglasa nema nijedan pregled, a stariji su od 30 dana.`);
    }
    if (u.gledani_bez_upita.broj > 0) {
      r.push(`- ${u.gledani_bez_upita.broj} oglasa se dobro gleda ali ne donosi upite. Obicno je cijena ili opis.`);
    }
    r.push("");
  } else {
    r.push("## Ucinak", "");
    r.push("Nema jos podataka o pregledima. Prvi dnevni snimak ih donosi, a razlika izmedju dva snimka pokazuje sta stvarno raste.");
    r.push("");
  }

  const iz = i.izdvajanje;
  r.push("## Izdvajanje", "");
  r.push(`- Izdvojeno oglasa: ${iz.broj} (${iz.procenat}% aktivnih), od toga premium: ${iz.premium}`);
  r.push("");

  if (i.prvi_potezi.length > 0) {
    r.push("## Prvi potezi", "");
    for (const p of i.prvi_potezi) {
      r.push(`${p.redoslijed}. ${p.potez} (${p.kosta})`);
    }
    r.push("");
  }

  return r.join("\n");
}

/**
 * Isti izvjestaj sazet za jednu Telegram poruku. Samo ono sto trazi potez, bez pozadine.
 */
export function onboardingTelegram(i: OnboardingIzvjestaj): string {
  const r: string[] = [];
  const o = i.besplatne_obnove;
  r.push(`Pregled shopa ${i.nalog.username ?? ""}`.trimEnd(), "");
  r.push(`Aktivnih oglasa: ${i.nalog.aktivnih_oglasa}`);
  if (o.kvota > 0) {
    r.push(`Besplatnih obnova neiskorisceno: ${o.preostalo} od ${o.kvota}`);
    if (o.preostalo > 0) r.push(`Do kraja mjeseca ${o.dana_do_kraja_mjeseca} dana, oko ${o.preporuceno_dnevno} obnova dnevno.`);
  }
  const najveci = i.higijena[0];
  if (najveci) r.push("", `Najveci problem: ${najveci.broj} oglasa, ${najveci.poruka.toLowerCase()}`);
  if (i.svjezina.neobnovljeno_14 > 0) r.push(`Bez obnove preko 14 dana: ${i.svjezina.neobnovljeno_14} oglasa`);
  if (i.ucinak && i.ucinak.bez_pregleda_30_dana.broj > 0) {
    r.push(`Bez ijednog pregleda: ${i.ucinak.bez_pregleda_30_dana.broj} oglasa`);
  }
  if (i.prvi_potezi.length > 0) {
    r.push("", "Prvi potezi:");
    for (const p of i.prvi_potezi.slice(0, 3)) r.push(`- ${p.potez}`);
  }
  return r.join("\n");
}

// ===== dnevna poruka =====

export interface DnevniPodaci {
  username: string | null;
  plan: DnevniPlanObnova;
  // Koliko je stvarno obnovljeno u ovom prolazu. null kad je posao pokrenut u probnom rezimu.
  obnovljeno: number | null;
  neuspjelih_obnova: number;
  alarmi: AlarmiNaloga;
  nova_pitanja: number | null;
  promjena: PromjenaPregleda | null;
}

/**
 * Da li dnevna poruka uopste ima sta korisno reci. Kad nema (nista obnovljeno, nista nije
 * ni bilo dostupno, bez alarma i pomaka pregleda), poruka se NE salje: prazan
 * "sve isto kao juce" izvjestaj svako jutro trenira klijenta da poruke ignorise.
 */
export function dnevniVrijedanSlanja(d: DnevniPodaci): boolean {
  return (
    (d.obnovljeno ?? 0) > 0 ||
    d.neuspjelih_obnova > 0 ||
    d.alarmi.alarmi.length > 0 ||
    (d.promjena !== null && d.promjena.rastu.length > 0) ||
    // Kandidata ima a nista nije obnovljeno: to je kvar vrijedan poruke, ne tisina.
    (d.obnovljeno === 0 && d.plan.za_obnovu > 0)
  );
}

/**
 * Dnevna poruka klijentu. Sastavlja je kod, ne model, pa ne kosta nijedan token.
 * Pravilo: samo ono sto trazi potez ili potvrdjuje da je posao odradjen.
 */
export function dnevniTekst(d: DnevniPodaci): string {
  const r: string[] = [];
  r.push(`Dnevni pregled${d.username ? ` - ${d.username}` : ""}`, "");

  if (d.obnovljeno === null) {
    r.push(`Za obnovu danas: ${d.plan.za_obnovu} oglasa (probni rezim, nista nije obnovljeno).`);
  } else if (d.obnovljeno > 0) {
    r.push(`Obnovljeno danas: ${d.obnovljeno} oglasa, besplatno.`);
  } else if (d.plan.kandidata === 0) {
    r.push("Nijedan oglas danas nije bio dostupan za obnovu.");
  } else {
    r.push("Danas nije obnovljen nijedan oglas.");
  }
  if (d.neuspjelih_obnova > 0) r.push(`Nije uspjelo: ${d.neuspjelih_obnova}.`);

  if (d.plan.kvota > 0) {
    r.push(`Preostalo besplatnih obnova: ${d.plan.preostalo} od ${d.plan.kvota}.`);
    if (d.plan.preostalo > 0) {
      r.push(`Do kraja mjeseca ${d.plan.dana_do_kraja_mjeseca} dana, tempo oko ${d.plan.cilj_danas} dnevno.`);
    } else {
      r.push("Mjesecna kvota je potrosena do kraja.");
    }
    // Kandidata manje nego sto tempo trazi znaci da se kvota nece stici potrositi.
    if (d.plan.kandidata < d.plan.cilj_danas && d.plan.preostalo > 0) {
      r.push(`Napomena: danas je bilo dostupno samo ${d.plan.kandidata} oglasa za obnovu, manje nego sto tempo trazi.`);
    }
  }

  if (d.promjena && d.promjena.rastu.length > 0) {
    r.push("", `Pregledi u zadnjih ${d.promjena.dana} dana: ${d.promjena.ukupan_prirast} novih.`);
    r.push("Najvise rastu:");
    for (const p of d.promjena.rastu.slice(0, 3)) {
      r.push(`- ${skrati(p.title ?? String(p.id))}: ${p.prirast}`);
    }
  }

  const vazni = d.alarmi.alarmi.filter((a) => a.tip !== "kvota_obnova");
  if (vazni.length > 0) {
    r.push("", "Paznja:");
    for (const a of vazni) r.push(`- ${a.poruka}`);
  }

  return r.join("\n");
}

// ===== sedmicna poruka =====

export interface SedmicniPodaci {
  username: string | null;
  promjena: PromjenaPregleda | null;
  onboarding: OnboardingIzvjestaj;
  // Plan izdvajanja sa diska, kad postoji. Bez ovoga bi klijent napravio plan pa zaboravio na
  // njega, jer platforma nema zakazivanje i raspored vodi iskljucivo toolkit.
  plan?: PlanSazetak | null;
  // Termini koji su dospjeli a nisu izvrseni, do danasnjeg datuma.
  dospjelo?: number;
}

export function sedmicniTekst(s: SedmicniPodaci): string {
  const r: string[] = [];
  r.push(`Sedmicni pregled${s.username ? ` - ${s.username}` : ""}`, "");

  if (s.promjena) {
    r.push(`U zadnjih ${s.promjena.dana} dana: ${s.promjena.ukupan_prirast} novih pregleda na ${s.promjena.obuhvaceno} oglasa.`);
    if (s.promjena.rastu.length > 0) {
      r.push("", "Najbolje ide:");
      for (const p of s.promjena.rastu.slice(0, 5)) r.push(`- ${skrati(p.title ?? String(p.id))}: ${p.prirast}`);
    }
    if (s.promjena.miruju.length > 0) {
      r.push("", `Bez ijednog novog pregleda: ${s.promjena.miruju.length} oglasa.`);
      for (const p of s.promjena.miruju.slice(0, 3)) r.push(`- ${skrati(p.title ?? String(p.id))}`);
    }
  } else {
    r.push("Jos nema dva snimka za poredjenje, pa se prirast pregleda ne moze izracunati.");
  }

  const o = s.onboarding.besplatne_obnove;
  if (o.kvota > 0) {
    r.push("", `Besplatne obnove: iskorisceno ${o.iskorisceno} od ${o.kvota}.`);
    if (o.preostalo > 0) r.push(`Ostalo ${o.preostalo}, tempo ${o.preporuceno_dnevno} dnevno do kraja mjeseca.`);
  }

  const najveci = s.onboarding.higijena[0];
  if (najveci) r.push("", `Najveca stavka za popravku: ${najveci.broj} oglasa, ${najveci.poruka.toLowerCase()}`);

  if (s.plan) {
    const p = s.plan;
    r.push("", `Plan izdvajanja: izvrseno ${p.izvrseno} od ${p.termina}, ostalo ${p.planirano}.`);
    if (p.budzet > 0) r.push(`Potroseno ${p.potroseno} od ${p.budzet} kredita.`);
    if ((s.dospjelo ?? 0) > 0) {
      r.push(`PAZNJA: ${s.dospjelo} termina je dospjelo a nije izvrseno. Pokreni izvrsenje plana.`);
    }
    if (p.neuspjelo > 0) r.push(`Neuspjelih termina: ${p.neuspjelo}.`);
    if (p.preskoceno > 0) r.push(`${p.preskoceno} termina preskoceno (najcesce jer je poskupjelo).`);
  }

  if (s.onboarding.prvi_potezi.length > 0) {
    r.push("", "Prijedlog za ovu sedmicu:");
    for (const p of s.onboarding.prvi_potezi.slice(0, 3)) r.push(`- ${p.potez}`);
  }

  return r.join("\n");
}
