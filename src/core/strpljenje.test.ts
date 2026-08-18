// Testovi za `planStrpljenja` (cista funkcija) i scope `withStrpljenje429`/`trenutnoStrpljenje`.
// Mrezni test (429 stvarno prosiruje broj HTTP poziva) je u client.test.ts, uz stub fetch-a.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKOFF_MAX_MS, planStrpljenja, trenutnoStrpljenje, withStrpljenje429 } from "./strpljenje.js";

const POLITIKA = { pokusaja: 6, ukupnoMs: 600000 };

test("planStrpljenja: pokusaj unutar globalnog budzeta nije nasa grana", () => {
  // attempt <= maxRetries znaci da globalni retry u request() jos nije iscrpljen.
  assert.equal(planStrpljenja({ attempt: 1, maxRetries: 4, potroseno_ms: 0, politika: POLITIKA }), null);
  assert.equal(planStrpljenja({ attempt: 4, maxRetries: 4, potroseno_ms: 0, politika: POLITIKA }), null);
});

test("planStrpljenja: niz prosirenih pokusaja daje 5000, 10000, 20000, 40000, 45000, 45000", () => {
  const maxRetries = 4;
  const ocekivano = [5000, 10000, 20000, 40000, 45000, 45000];
  let potroseno = 0;
  for (let i = 0; i < ocekivano.length; i++) {
    const attempt = maxRetries + i + 1;
    const cekaj = planStrpljenja({ attempt, maxRetries, potroseno_ms: potroseno, politika: POLITIKA });
    assert.equal(cekaj, ocekivano[i], `prosireni pokusaj ${i + 1}`);
    potroseno += cekaj ?? 0;
  }
});

test("planStrpljenja: pokusaj iznad politika.pokusaja vraca null", () => {
  const maxRetries = 4;
  const politika = { pokusaja: 2, ukupnoMs: 600000 };
  assert.equal(planStrpljenja({ attempt: maxRetries + 1, maxRetries, potroseno_ms: 0, politika }), 5000);
  assert.equal(planStrpljenja({ attempt: maxRetries + 2, maxRetries, potroseno_ms: 5000, politika }), 10000);
  // treci prosireni pokusaj bi bio broj 3, a politika dozvoljava samo 2.
  assert.equal(planStrpljenja({ attempt: maxRetries + 3, maxRetries, potroseno_ms: 15000, politika }), null);
});

test("planStrpljenja: kumulativni plafon presijeca cekanje prije nego pokusaji istrpe", () => {
  const maxRetries = 4;
  const politika = { pokusaja: 6, ukupnoMs: 12000 };
  // Prvi prosireni pokusaj (5000ms) staje ispod plafona od 12000ms.
  assert.equal(planStrpljenja({ attempt: maxRetries + 1, maxRetries, potroseno_ms: 0, politika }), 5000);
  // Drugi bi trazio jos 10000ms, sto sa vec potrosenih 5000ms prelazi plafon od 12000ms.
  assert.equal(planStrpljenja({ attempt: maxRetries + 2, maxRetries, potroseno_ms: 5000, politika }), null);
});

test("planStrpljenja: krov cekanja je BACKOFF_MAX_MS, rast se ne nastavlja unedogled", () => {
  const maxRetries = 0;
  const politika = { pokusaja: 20, ukupnoMs: Number.MAX_SAFE_INTEGER };
  const cekaj = planStrpljenja({ attempt: 20, maxRetries, potroseno_ms: 0, politika });
  assert.equal(cekaj, BACKOFF_MAX_MS);
});

test("trenutnoStrpljenje: van scope-a je null", () => {
  assert.equal(trenutnoStrpljenje(), null);
});

test("trenutnoStrpljenje: unutar scope-a vraca politiku, potroseno_ms se sabira kroz scope", async () => {
  const politika = { pokusaja: 3, ukupnoMs: 60000 };
  await withStrpljenje429(politika, async () => {
    const prvi = trenutnoStrpljenje();
    assert.ok(prvi);
    assert.deepEqual(prvi?.politika, politika);
    assert.equal(prvi?.potroseno_ms, 0);

    prvi!.potroseno_ms += 5000;

    const drugi = trenutnoStrpljenje();
    assert.equal(drugi?.potroseno_ms, 5000, "isti mutabilni scope kroz vise poziva unutar istog pokretanja");
  });
});

test("withStrpljenje429: sekvencijalni scope-ovi ne cure jedan u drugi", async () => {
  await withStrpljenje429({ pokusaja: 1, ukupnoMs: 1000 }, async () => {
    trenutnoStrpljenje()!.potroseno_ms += 999;
  });
  await withStrpljenje429({ pokusaja: 9, ukupnoMs: 9000 }, async () => {
    // Nov scope pocinje od 0, iako je prethodni zavrsio sa potroseno_ms blizu svog plafona.
    assert.equal(trenutnoStrpljenje()?.potroseno_ms, 0);
  });
});

test("withStrpljenje429: ugnijezdeni scope ne cuje spoljasnji", async () => {
  await withStrpljenje429({ pokusaja: 1, ukupnoMs: 1000 }, async () => {
    trenutnoStrpljenje()!.potroseno_ms += 100;
    await withStrpljenje429({ pokusaja: 9, ukupnoMs: 9000 }, async () => {
      assert.equal(trenutnoStrpljenje()?.potroseno_ms, 0, "unutrasnji scope ima svoju politiku i svoj brojac");
      trenutnoStrpljenje()!.potroseno_ms += 500;
    });
    // Nakon povratka iz ugnijezdenog scope-a, vanjski se nastavlja bez promjene od unutrasnjeg.
    assert.equal(trenutnoStrpljenje()?.potroseno_ms, 100);
  });
});
