import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { procitajPrijedlog, spisakPrijedloga } from "./prijedlozi.js";

function mapaSaFajlovima(fajlovi: { ime: string; sadrzaj: string; dana?: number }[]): string {
  const mapa = join(mkdtempSync(join(tmpdir(), "olx-prijedlozi-")), "prijedlozi");
  mkdirSync(mapa, { recursive: true });
  for (const f of fajlovi) {
    const p = join(mapa, f.ime);
    writeFileSync(p, f.sadrzaj, "utf8");
    if (f.dana) {
      const kada = new Date(Date.now() - f.dana * 86_400_000);
      utimesSync(p, kada, kada);
    }
  }
  return mapa;
}

test("bez mape prijedloga spisak je prazan, ne greska", () => {
  // Runda jos nije radila na novom klonu; bot to ne smije prijaviti kao pad.
  assert.deepEqual(spisakPrijedloga(join(tmpdir(), "ne-postoji-olx-xyz")), []);
  assert.equal(procitajPrijedlog(undefined, join(tmpdir(), "ne-postoji-olx-xyz")), null);
});

test("spisak vraca najnoviji prvi i ignorise sve sto nije md", () => {
  const mapa = mapaSaFajlovima([
    { ime: "runda-2026-07-01.md", sadrzaj: "staro", dana: 20 },
    { ime: "runda-2026-07-28.md", sadrzaj: "novo", dana: 1 },
    { ime: "biljeska.txt", sadrzaj: "ne racuna se" },
  ]);
  const s = spisakPrijedloga(mapa);
  assert.equal(s.length, 2, "samo md fajlovi");
  assert.equal(s[0]?.ime, "runda-2026-07-28.md", "najnoviji je prvi");
});

test("bez imena se cita najnoviji, jer se u praksi trazi upravo to", () => {
  const mapa = mapaSaFajlovima([
    { ime: "runda-2026-07-01.md", sadrzaj: "staro", dana: 20 },
    { ime: "runda-2026-07-28.md", sadrzaj: "novo", dana: 1 },
  ]);
  assert.equal(procitajPrijedlog(undefined, mapa)?.sadrzaj, "novo");
});

test("trazeno ime se cita, a nepoznato ime daje jasnu gresku sa popisom", () => {
  const mapa = mapaSaFajlovima([{ ime: "runda-2026-07-28.md", sadrzaj: "novo" }]);
  assert.equal(procitajPrijedlog("runda-2026-07-28.md", mapa)?.sadrzaj, "novo");
  assert.throws(() => procitajPrijedlog("runda-2020-01-01.md", mapa), /Nema prijedloga/);
});

test("ime sa putanjom se odbija, jer ga model prima iz covjekove poruke", () => {
  const mapa = mapaSaFajlovima([{ ime: "runda-2026-07-28.md", sadrzaj: "novo" }]);
  for (const zlo of ["../../.env", "..\\..\\.env", "podmapa/fajl.md", "a/../b.md"]) {
    assert.throws(() => procitajPrijedlog(zlo, mapa), /putanju|Nema prijedloga/, `ime "${zlo}" je proslo`);
  }
});
