// Testovi kapije za jutarnju poruku: salje se samo kad ima sta korisno reci, jer prazan
// "sve isto" izvjestaj svako jutro trenira klijenta da poruke ignorise.

import assert from "node:assert/strict";
import { test } from "node:test";
import { dnevniTekst, dnevniVrijedanSlanja, konkurentiTekst, konkurentiVrijedanSlanja, TELEGRAM_MEKI_LIMIT, type DnevniPodaci, type KonkurentiPodaci } from "./izvjestaj.js";

function podaci(overrides: Partial<DnevniPodaci> = {}): DnevniPodaci {
  return {
    username: "test",
    plan: { kvota: 1800, preostalo: 1500, dana_do_reseta: 10, rok_poznat: true, rok_izvor: "ciklus", ostvarivo: 400, cilj_danas: 0, kandidata: 0, za_obnovu: 0, kvota_neostvariva: false, ritam: "ravnomjerno", obnove_stanje: "auto" as const },
    obnovljeno: 0,
    neuspjelih_obnova: 0,
    alarmi: { ok: true, alarmi: [] },
    nova_pitanja: 0,
    promjena: null,
    ...overrides,
  };
}

test("dan bez icega novog se ne salje", () => {
  assert.equal(dnevniVrijedanSlanja(podaci()), false);
});

test("obnovljeni oglasi, alarmi ili rast pregleda cine poruku vrijednom", () => {
  assert.equal(dnevniVrijedanSlanja(podaci({ obnovljeno: 3 })), true);
  // nova_pitanja NE cini poruku vrijednom: brojac sa API-ja je neprovjeren (na zivom nalogu
  // pokazao 0 uz postojeca pitanja), pa se klijentu o pitanjima nista ne javlja.
  assert.equal(dnevniVrijedanSlanja(podaci({ nova_pitanja: 5 })), false);
  assert.equal(
    dnevniVrijedanSlanja(podaci({ alarmi: { ok: false, alarmi: [{ tip: "krediti", poruka: "x", vrijednost: 1 }] } })),
    true,
  );
  assert.equal(
    dnevniVrijedanSlanja(
      podaci({
        promjena: { od_ts: 1, do_ts: 2, dana: 2, obuhvaceno: 5, ukupan_prirast: 40, rastu: [{ id: 1, prirast: 40 }], miruju: [] } as never,
      }),
    ),
    true,
  );
});

test("kvar obnove (kandidata ima, nista obnovljeno) je vrijedan poruke, ne tisina", () => {
  assert.equal(
    dnevniVrijedanSlanja(podaci({ obnovljeno: 0, plan: { kvota: 1800, preostalo: 1500, dana_do_reseta: 10, rok_poznat: true, rok_izvor: "ciklus", ostvarivo: 400, cilj_danas: 5, kandidata: 5, za_obnovu: 5, kvota_neostvariva: false, ritam: "ravnomjerno", obnove_stanje: "auto" as const } })),
    true,
  );
  assert.equal(dnevniVrijedanSlanja(podaci({ neuspjelih_obnova: 2 })), true);
});

test("probni rezim (obnovljeno null) bez icega drugog nije vrijedan slanja", () => {
  assert.equal(dnevniVrijedanSlanja(podaci({ obnovljeno: null })), false);
});

test("dospio termin i danasnji trosak okidaju poruku; mrtvi i izuzeti ne", () => {
  // Dospio termin trazi potez, trosak se javlja isti dan. Mrtvi oglasi, izuzeti i oni koji
  // miruju su sadrzaj za poruku koja se ionako salje: da okidaju, klijent bi poruku dobijao
  // svaki dan i naucio je ignorisati.
  assert.equal(dnevniVrijedanSlanja(podaci({ dospjelo: 2 })), true);
  assert.equal(dnevniVrijedanSlanja(podaci({ potroseno_kredita: 54 })), true);
  assert.equal(dnevniVrijedanSlanja(podaci({ mrtvi: { broj: 8, dana: 30 }, izuzeti: 3 })), false);
});

// ---- tekst dnevne poruke ----
// Ovo je prvi test nad SADRZAJEM poruke. Do sada je pokriven bio samo `dnevniVrijedanSlanja`,
// pa je greska prijavljena 31.07.2026. (pogresan rok i pogresan razlog) prosla bez ijednog
// crvenog testa.

function plan(overrides: Partial<DnevniPodaci["plan"]> = {}): DnevniPodaci["plan"] {
  return {
    kvota: 1800,
    preostalo: 1482,
    dana_do_reseta: 24,
    rok_poznat: true,
    rok_izvor: "ciklus" as const,
    ostvarivo: 363,
    cilj_danas: 16,
    kandidata: 20,
    za_obnovu: 16,
    kvota_neostvariva: false,
    ritam: "ravnomjerno",
    obnove_stanje: "auto" as const,
    ...overrides,
  };
}

test("dnevni tekst govori o obnovi kvote, ne o kraju kalendarskog mjeseca", () => {
  const t = dnevniTekst(podaci({ plan: plan(), obnovljeno: 16 }));
  assert.match(t, /Kvota se obnavlja za 24 dana/);
  assert.ok(!/kraja mjeseca/i.test(t), "kraj kalendarskog mjeseca nije rok kvote");
  assert.match(t, /Tempo oko 16 dnevno/);
});

test("dnevni tekst ne izgovara rok kad ciklus pretplate nije poznat", () => {
  // Bez shop.ends_at je rok samo kraj kalendarskog mjeseca, dakle pretpostavka
  // (olx://pravila-brojeva: kada se kvota resetuje nije potvrdjeno). Broj se tada ne tvrdi.
  const t = dnevniTekst(podaci({ plan: plan({ rok_poznat: false }), obnovljeno: 16 }));
  assert.ok(!/obnavlja za/.test(t), "rok se ne izgovara kad nije poznat");
  assert.match(t, /Tempo oko 16 dnevno/, "tempo ostaje, jer on ne zavisi od tvrdnje o datumu");
});

test("kad kvota nije dostizna, tekst navodi PRAG kao razlog, ne broj oglasa", () => {
  // Stari tekst je govorio "jer nemate toliko oglasa". Uzrok je prag po oglasu: isti oglas se
  // besplatno obnavlja tek nakon nekoliko dana, pa katalog ne moze potrositi kvotu ni da ima
  // dvostruko vise oglasa.
  const t = dnevniTekst(podaci({ plan: plan({ kvota_neostvariva: true }), obnovljeno: 16 }));
  assert.match(t, /tek nakon nekoliko dana/, "razlog je prag platforme");
  assert.ok(!/nemate toliko oglasa/.test(t), "stari, pogresan razlog");
  assert.ok(!/Tempo oko/.test(t), "tempo se ne javlja kad se kvota ionako ne moze potrositi");
  assert.ok(!/ne prenosi/.test(t), "kvota koja propada je tvrdnja bez izvora");
});

test("dnevni tekst nikad ne kaze '1 dana'", () => {
  const t = dnevniTekst(podaci({ plan: plan({ dana_do_reseta: 1 }), obnovljeno: 3 }));
  assert.match(t, /za 1 dan\./);
  assert.ok(!/1 dana/.test(t), "broj mora biti sklonjen");
});

test("dnevni tekst ne obecava tempo veci od ostvarivog", () => {
  // Zastita od povratka greske: tempo dolazi iz plana koji se racuna na ostvarivo, pa ako se
  // ikad vrati racun po sirovoj kvoti, ovaj test pada.
  const p = plan({ cilj_danas: 16, ostvarivo: 363, dana_do_reseta: 24 });
  const najveciOdrzivi = Math.ceil(p.ostvarivo / p.dana_do_reseta) + 1;
  assert.ok(p.cilj_danas <= najveciOdrzivi, `tempo ${p.cilj_danas} preko odrzivog ${najveciOdrzivi}`);
  assert.match(dnevniTekst(podaci({ plan: p, obnovljeno: 5 })), /Tempo oko 16 dnevno/);
});

test("preostala kvota u poruci racuna i obnove iz ovog prolaza", () => {
  // Prijavljeno 01.08.2026: poruka je u istom dahu javljala "Obnovljeno danas: 59" i
  // "Preostalo besplatnih obnova: 1800 od 1800", jer je plan izracunat prije slanja obnova.
  const t = dnevniTekst(podaci({ plan: plan({ kvota: 1800, preostalo: 1800 }), obnovljeno: 59 }));
  assert.match(t, /Preostalo besplatnih obnova: 1741 od 1800\./);
  assert.ok(!/1800 od 1800/.test(t), "predobnovljeno stanje kvote");
});

test("kvota potrosena do kraja se prepozna i kad je potrosena bas danas", () => {
  const t = dnevniTekst(podaci({ plan: plan({ preostalo: 12, kvota_neostvariva: false }), obnovljeno: 12 }));
  assert.match(t, /Besplatna kvota je potrosena do kraja\./);
  assert.ok(!/Tempo oko/.test(t), "nema tempa kad nema sta trositi");
});

test("rast pregleda: pet stavki i ispravan oblik rijeci dan", () => {
  const rastu = [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: i, title: `Oglas ${i}`, prirast: 100 - i }));
  const t = dnevniTekst(
    podaci({
      obnovljeno: 5,
      promjena: { od_ts: 1, do_ts: 2, dana: 1, obuhvaceno: 7, ukupan_prirast: 405, rastu, miruju: [] },
    }),
  );
  assert.match(t, /Pregledi u zadnjih 1 dan: 405 novih\./);
  assert.ok(!/1 dana/.test(t), "broj mora biti sklonjen");
  assert.match(t, /- Oglas 5: 95/);
  assert.ok(!/Oglas 6/.test(t), "spisak staje na pet stavki");
});

test("razmak snimaka se u poruci izgovara cijelim brojem", () => {
  // Snimci ne padaju u istu sekundu svaki dan, pa promjenaPregleda racuna sa decimalom.
  // Na zivom nalogu 01.08.2026. to je dalo "Pregledi u zadnjih 1.6 dana".
  const t = dnevniTekst(
    podaci({
      obnovljeno: 3,
      promjena: { od_ts: 1, do_ts: 2, dana: 1.6, obuhvaceno: 5, ukupan_prirast: 583, rastu: [{ id: 1, prirast: 67 }], miruju: [] },
    }),
  );
  assert.match(t, /Pregledi u zadnjih 2 dana: 583 novih\./);
  assert.ok(!/1\.6/.test(t), "decimala ne ide u poruku klijentu");
});

test("dopune poruke: trosak, dospjeli termini, mrtvi, izuzeti i miruju", () => {
  const t = dnevniTekst(
    podaci({
      obnovljeno: 3,
      dospjelo: 2,
      potroseno_kredita: 54,
      mrtvi: { broj: 8, dana: 30 },
      izuzeti: 3,
      promjena: { od_ts: 1, do_ts: 2, dana: 2, obuhvaceno: 20, ukupan_prirast: 40, rastu: [{ id: 1, prirast: 40 }], miruju: [{ id: 2 }, { id: 3 }] },
    }),
  );
  assert.match(t, /Potroseno danas: 54 kredita\./);
  assert.match(t, /Plan izdvajanja: 2 termina je dospjelo a nije izvrseno\./);
  assert.match(t, /Bez ijednog novog pregleda vec 30 dana: 8 oglasa\./);
  assert.match(t, /Preskoceno po tvojoj listi izuzetaka: 3\./);
  assert.match(t, /Bez novog pregleda u istom periodu: 2 oglasa\./);
});

test("dopune se ne pominju kad ih nema", () => {
  const t = dnevniTekst(podaci({ obnovljeno: 3, dospjelo: 0, potroseno_kredita: 0, mrtvi: null, izuzeti: 0 }));
  assert.ok(!/Potroseno danas/.test(t));
  assert.ok(!/Plan izdvajanja/.test(t));
  assert.ok(!/novog pregleda/.test(t));
  assert.ok(!/izuzetaka/.test(t));
});

test("jedan dospio termin se izgovara u jednini", () => {
  const t = dnevniTekst(podaci({ obnovljeno: 3, dospjelo: 1 }));
  assert.match(t, /1 termin je dospio a nije izvrseno\./);
});

test("razmak manji od dana se ne izgovara kao nula", () => {
  const t = dnevniTekst(
    podaci({
      obnovljeno: 3,
      promjena: { od_ts: 1, do_ts: 2, dana: 0.4, obuhvaceno: 5, ukupan_prirast: 12, rastu: [{ id: 1, prirast: 12 }], miruju: [] },
    }),
  );
  assert.match(t, /Pregledi u zadnjih 1 dan: 12 novih\./);
});

test("prvo pitanje o obnovama okida slanje, podsjetnik ne", () => {
  // Uz pitanje plan uvijek nosi "ceka_odluku" (dnevniPlanObnova), pa i test: sa "auto" bi
  // poruka uz pitanje obecala i tempo, sto je bas ono sto se ovdje zabranjuje.
  const cekaPlan = { ...podaci().plan, obnove_stanje: "ceka_odluku" as const };
  const prvo = podaci({ plan: cekaPlan, obnove_pitanje: { kandidata: 14, naslovi: ["Patike Nike 42"], podsjetnik: false } });
  assert.equal(dnevniVrijedanSlanja(prvo), true, "puno pitanje se salje uvijek");
  const t = dnevniTekst(prvo);
  assert.match(t, /14 tvojih oglasa/);
  assert.match(t, /Patike Nike 42/);
  assert.match(t, /i jos 13/);
  assert.match(t, /nista ne obnavljam sam/i);
  assert.ok(!/Tempo oko/.test(t), "tempo se ne obecava dok odluke nema");

  const podsjetnik = podaci({ plan: cekaPlan, obnove_pitanje: { kandidata: 14, naslovi: [], podsjetnik: true } });
  assert.equal(dnevniVrijedanSlanja(podsjetnik), false, "podsjetnik nije okidac");
  assert.match(dnevniTekst(podsjetnik), /Podsjetnik: automatske obnove jos ne rade/);
});

test("iskljucene obnove se u tekstu kazu kao izbor klijenta, bez tempa", () => {
  const t = dnevniTekst(podaci({ obnovljeno: 0, plan: { ...podaci().plan, obnove_stanje: "iskljuceno" as const, ritam: "iskljuceno" as const } }));
  assert.match(t, /iskljucene po tvom izboru/);
  assert.ok(!/Tempo oko/.test(t));
});

// ===== poruka o konkurenciji =====

function konkPodaci(overrides: Partial<KonkurentiPodaci> = {}): KonkurentiPodaci {
  return { signali: [], pogodci: [], novi_kandidati: 0, gresaka: 0, ...overrides };
}

function signal(overrides: Record<string, unknown> = {}) {
  return {
    username: "Shop",
    od_ts: 0,
    do_ts: 1,
    cijene: [],
    obnovljeni: [],
    izdvajanje: { poceli: [], prestali: [] },
    novi: [],
    nestali: [],
    ima_promjena: true,
    ...overrides,
  };
}

test("konkurentiVrijedanSlanja: bez promjena se ne salje; promjena, pogodak ili kandidat salju", () => {
  assert.equal(konkurentiVrijedanSlanja(konkPodaci()), false);
  assert.equal(konkurentiVrijedanSlanja(konkPodaci({ gresaka: 3 })), false, "greske idu adminu, ne klijentu");
  assert.equal(konkurentiVrijedanSlanja(konkPodaci({ novi_kandidati: 1 })), true);
  assert.equal(
    konkurentiVrijedanSlanja(konkPodaci({ signali: [signal({ novi: [{ id: 1, title: "X" }] }) as never] })),
    true,
  );
  assert.equal(
    konkurentiVrijedanSlanja(
      konkPodaci({
        pogodci: [{ moj_id: 1, moj_naslov: "M", konkurent: "Shop", njihov_id: 2, njihov_naslov: "N", tip: "cijena", detalj: "d" }],
      }),
    ),
    true,
  );
});

test("konkurentiTekst: pogodci na uparenim prvi, sazetak po konkurentu, duga lista se sijece na 10", () => {
  const pogodci = Array.from({ length: 12 }, (_, i) => ({
    moj_id: i,
    moj_naslov: `Moj ${i}`,
    konkurent: "Shop",
    njihov_id: 100 + i,
    njihov_naslov: `Njihov ${i}`,
    tip: "cijena" as const,
    detalj: `Shop snizio "Njihov ${i}" sa 100 na 90 KM (-10%); tvoj artikal: Moj ${i}`,
  }));
  const t = konkurentiTekst(
    konkPodaci({
      pogodci,
      signali: [
        signal({
          cijene: [{ id: 1, title: "A", stara: 100, nova: 90, posto: -10 }],
          obnovljeni: [{ id: 2, title: "B" }],
          izdvajanje: { poceli: [{ id: 3, title: "C" }], prestali: [] },
          novi: [{ id: 4, title: "D" }],
        }) as never,
      ],
      novi_kandidati: 2,
    }),
  );
  assert.ok(t.indexOf("Na artiklima koje pratis") < t.indexOf("Po konkurentu"), "pogodci idu prije sazetka");
  assert.match(t, /… i jos 2\./);
  assert.match(t, /Shop: snizio 1 cijenu, obnovio 1, izdvojio 1, dodao 1 novih\./);
  assert.match(t, /2 artikala kod konkurencije/);
  assert.doesNotMatch(t, /gresaka|greska/i, "detalji gresaka ne idu klijentu");
});

test("konkurentiTekst bez icega vraca samo naslov i ne prelazi meki limit na tipicnom danu", () => {
  const prazan = konkurentiTekst(konkPodaci());
  assert.equal(prazan, "Konkurencija - promjene");

  const tipican = konkurentiTekst(
    konkPodaci({
      signali: Array.from({ length: 5 }, (_, i) => signal({ username: `Shop${i}`, obnovljeni: [{ id: i, title: "X" }] }) as never),
      novi_kandidati: 3,
    }),
  );
  assert.ok(tipican.length < TELEGRAM_MEKI_LIMIT, "tipicna poruka staje u meki limit");
});
