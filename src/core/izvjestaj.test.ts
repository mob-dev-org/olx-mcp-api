// Testovi kapije za jutarnju poruku: salje se samo kad ima sta korisno reci, jer prazan
// "sve isto" izvjestaj svako jutro trenira klijenta da poruke ignorise.

import assert from "node:assert/strict";
import { test } from "node:test";
import { dnevniVrijedanSlanja, type DnevniPodaci } from "./izvjestaj.js";

function podaci(overrides: Partial<DnevniPodaci> = {}): DnevniPodaci {
  return {
    username: "test",
    plan: { kvota: 1800, preostalo: 1500, dana_do_kraja_mjeseca: 10, cilj_danas: 0, kandidata: 0, za_obnovu: 0 },
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

test("obnovljeni oglasi, pitanja, alarmi ili rast pregleda cine poruku vrijednom", () => {
  assert.equal(dnevniVrijedanSlanja(podaci({ obnovljeno: 3 })), true);
  assert.equal(dnevniVrijedanSlanja(podaci({ nova_pitanja: 1 })), true);
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
    dnevniVrijedanSlanja(podaci({ obnovljeno: 0, plan: { kvota: 1800, preostalo: 1500, dana_do_kraja_mjeseca: 10, cilj_danas: 5, kandidata: 5, za_obnovu: 5 } })),
    true,
  );
  assert.equal(dnevniVrijedanSlanja(podaci({ neuspjelih_obnova: 2 })), true);
});

test("probni rezim (obnovljeno null) bez icega drugog nije vrijedan slanja", () => {
  assert.equal(dnevniVrijedanSlanja(podaci({ obnovljeno: null })), false);
});
