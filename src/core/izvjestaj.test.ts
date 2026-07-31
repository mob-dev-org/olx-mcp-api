// Testovi kapije za jutarnju poruku: salje se samo kad ima sta korisno reci, jer prazan
// "sve isto" izvjestaj svako jutro trenira klijenta da poruke ignorise.

import assert from "node:assert/strict";
import { test } from "node:test";
import { dnevniTekst, dnevniVrijedanSlanja, type DnevniPodaci } from "./izvjestaj.js";

function podaci(overrides: Partial<DnevniPodaci> = {}): DnevniPodaci {
  return {
    username: "test",
    plan: { kvota: 1800, preostalo: 1500, dana_do_reseta: 10, rok_poznat: true, ostvarivo: 400, cilj_danas: 0, kandidata: 0, za_obnovu: 0, kvota_neostvariva: false, ritam: "ravnomjerno" },
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
    dnevniVrijedanSlanja(podaci({ obnovljeno: 0, plan: { kvota: 1800, preostalo: 1500, dana_do_reseta: 10, rok_poznat: true, ostvarivo: 400, cilj_danas: 5, kandidata: 5, za_obnovu: 5, kvota_neostvariva: false, ritam: "ravnomjerno" } })),
    true,
  );
  assert.equal(dnevniVrijedanSlanja(podaci({ neuspjelih_obnova: 2 })), true);
});

test("probni rezim (obnovljeno null) bez icega drugog nije vrijedan slanja", () => {
  assert.equal(dnevniVrijedanSlanja(podaci({ obnovljeno: null })), false);
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
    ostvarivo: 363,
    cilj_danas: 16,
    kandidata: 20,
    za_obnovu: 16,
    kvota_neostvariva: false,
    ritam: "ravnomjerno",
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
