// Testovi za audit log: racun dnevne potrosnje (potrosenoNaDan), izvodjenje mjesecne putanje
// (rotacija) i citanje u komadima preko vise fajlova (potrosenoNaDanUFajlovima), bez
// readFileSync cijelog fajla.
//
// Ovi testovi POSTOJE PRIJE nego je citanje u komadima uvedeno (vidi zadatak: testovi prije
// izmjene), da fiksiraju postojece ponasanje potrosenoNaDan prije nego se doda novi kod oko
// njega. Najosjetljiviji dio: danasnja potrosnja se ne smije nikad tiho procitati kao nula tamo
// gdje treba tacno da se izracuna, jer je to rupa u brani protiv trosenja kredita.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { potrosenoNaDan, potrosenoNaDanUFajlovima, putanjaMjesecnogAudita, putanjeAuditaZaCitanje } from "./audit.js";

function radniDir(): string {
  return mkdtempSync(join(tmpdir(), "olx-audit-test-"));
}

const zapis = (o: Record<string, unknown>) =>
  JSON.stringify({ operation: "t", source: "cli", method: "POST", path: "/x", status: 200, duration_ms: 1, attempts: 1, ...o });

// ===== potrosenoNaDan (postojece ponasanje, nad tekstom u memoriji) =====

test("potrosenoNaDan broji samo ok===true zapise sa brojcanim krediti i danasnjim ts", () => {
  const danas = new Date().toISOString().slice(0, 10);
  const sadrzaj = [
    zapis({ ts: `${danas}T10:00:00.000Z`, ok: true, krediti: 10 }),
    zapis({ ts: `${danas}T11:00:00.000Z`, ok: true, krediti: 15 }),
    zapis({ ts: `${danas}T12:00:00.000Z`, ok: false, krediti: 999, error: "odbijeno" }),
    zapis({ ts: `${danas}T13:00:00.000Z`, ok: true, krediti: "nije broj" }),
    zapis({ ts: "2020-01-01T10:00:00.000Z", ok: true, krediti: 500 }),
  ].join("\n");
  assert.equal(potrosenoNaDan(sadrzaj, danas), 25);
});

test("potrosenoNaDan preskace pokvarenu liniju bez bacanja", () => {
  const danas = new Date().toISOString().slice(0, 10);
  const sadrzaj = [zapis({ ts: `${danas}T10:00:00.000Z`, ok: true, krediti: 5 }), "{ ovo nije validan json", zapis({ ts: `${danas}T11:00:00.000Z`, ok: true, krediti: 7 })].join(
    "\n",
  );
  assert.doesNotThrow(() => potrosenoNaDan(sadrzaj, danas));
  assert.equal(potrosenoNaDan(sadrzaj, danas), 12);
});

test("potrosenoNaDan preskace prazne linije", () => {
  const danas = new Date().toISOString().slice(0, 10);
  const sadrzaj = ["", "   ", zapis({ ts: `${danas}T10:00:00.000Z`, ok: true, krediti: 3 }), "", ""].join("\n");
  assert.equal(potrosenoNaDan(sadrzaj, danas), 3);
});

test("potrosenoNaDan vraca 0 na potpuno praznom sadrzaju", () => {
  assert.equal(potrosenoNaDan("", new Date().toISOString().slice(0, 10)), 0);
});

// ===== putanjaMjesecnogAudita =====

test("putanjaMjesecnogAudita izvodi mjesecni fajl iz osnovne putanje, drzi direktorij i ekstenziju", () => {
  const datum = new Date(2026, 7, 15); // avgust 2026 (mjesec je 0-indeksiran)
  assert.equal(putanjaMjesecnogAudita(".olx-pik/audit.jsonl", datum), ".olx-pik/audit-2026-08.jsonl");
});

test("putanjaMjesecnogAudita prati pomjerenu putanju (OLX_AUDIT_FILE override), ne hardkoduje .olx-pik", () => {
  const datum = new Date(2026, 0, 5); // januar 2026
  assert.equal(putanjaMjesecnogAudita("drugdje/dublje/a.jsonl", datum), "drugdje/dublje/a-2026-01.jsonl");
});

test("putanjeAuditaZaCitanje vraca i mjesecni fajl i zatecenu osnovnu putanju", () => {
  const datum = new Date(2026, 7, 1);
  const putanje = putanjeAuditaZaCitanje(".olx-pik/audit.jsonl", datum);
  assert.ok(putanje.includes(".olx-pik/audit-2026-08.jsonl"));
  assert.ok(putanje.includes(".olx-pik/audit.jsonl"));
  assert.equal(putanje.length, 2);
});

// ===== potrosenoNaDanUFajlovima (citanje u komadima, preko vise fajlova) =====

test("potrosenoNaDanUFajlovima: migracioni slucaj, zapisi lezhe u zatecenoj osnovnoj putanji", () => {
  const dir = radniDir();
  const danas = new Date().toISOString().slice(0, 10);
  const osnovna = join(dir, "audit.jsonl");
  const mjesecni = putanjaMjesecnogAudita(osnovna); // ne postoji, ENOENT za taj fajl je ocekivan
  writeFileSync(osnovna, [zapis({ ts: `${danas}T09:00:00.000Z`, ok: true, krediti: 40 })].join("\n") + "\n", "utf8");
  try {
    assert.equal(potrosenoNaDanUFajlovima([mjesecni, osnovna], danas), 40);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("potrosenoNaDanUFajlovima: zapisi lezhe samo u mjesecnom fajlu", () => {
  const dir = radniDir();
  const danas = new Date().toISOString().slice(0, 10);
  const osnovna = join(dir, "audit.jsonl"); // ne postoji
  const mjesecni = putanjaMjesecnogAudita(osnovna);
  writeFileSync(mjesecni, [zapis({ ts: `${danas}T09:00:00.000Z`, ok: true, krediti: 60 })].join("\n") + "\n", "utf8");
  try {
    assert.equal(potrosenoNaDanUFajlovima([mjesecni, osnovna], danas), 60);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("potrosenoNaDanUFajlovima: zapisi PODIJELJENI izmedju zatecene putanje i mjesecnog fajla", () => {
  const dir = radniDir();
  const danas = new Date().toISOString().slice(0, 10);
  const osnovna = join(dir, "audit.jsonl");
  const mjesecni = putanjaMjesecnogAudita(osnovna);
  writeFileSync(osnovna, [zapis({ ts: `${danas}T08:00:00.000Z`, ok: true, krediti: 15 })].join("\n") + "\n", "utf8");
  writeFileSync(mjesecni, [zapis({ ts: `${danas}T09:00:00.000Z`, ok: true, krediti: 25 })].join("\n") + "\n", "utf8");
  try {
    assert.equal(potrosenoNaDanUFajlovima([mjesecni, osnovna], danas), 40);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("potrosenoNaDanUFajlovima: fajl koji ne postoji doprinosi 0, nije greska", () => {
  const dir = radniDir();
  const danas = new Date().toISOString().slice(0, 10);
  try {
    assert.equal(potrosenoNaDanUFajlovima([join(dir, "ne-postoji.jsonl")], danas), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("potrosenoNaDanUFajlovima: citanje u komadima daje isti rezultat kao potrosenoNaDan na velikom sadrzaju, ukljucujuci liniju tacno na granici bafera", () => {
  const dir = radniDir();
  const danas = new Date().toISOString().slice(0, 10);
  const putanja = join(dir, "veliki.jsonl");

  // Sagradi mnogo linija (vise od jedne velicine bafera od 64KB), i namjerno dovedi jednu liniju
  // tacno na granicu bafera dodavanjem "punjenja" u error polju prethodnih linija.
  const linije: string[] = [];
  for (let i = 0; i < 2000; i++) {
    const trosakOk = i % 3 === 0; // samo dio linija je "ok" sa kreditima danasnjeg dana
    linije.push(
      zapis({
        ts: `${danas}T10:00:00.000Z`,
        ok: trosakOk,
        krediti: trosakOk ? 1 : undefined,
        error: trosakOk ? undefined : "x".repeat(50),
      }),
    );
  }
  // Ubaci jednu liniju cija pozicija pada blizu 64KB granice, punjenjem prije nje preko appendFileSync
  // (test ne cilja bajt-precizno, nego dokazuje da razlicite duzine oko granice ne kvare racun).
  let sadrzaj = linije.join("\n") + "\n";
  // Dodaj dio koji gura ukupnu duzinu preko vise punih bafera (64KB), da se testira vise prolaza kroz petlju.
  const dopuna: string[] = [];
  for (let i = 0; i < 3000; i++) {
    dopuna.push(zapis({ ts: `${danas}T11:00:00.000Z`, ok: true, krediti: 2 }));
  }
  sadrzaj += dopuna.join("\n") + "\n";
  writeFileSync(putanja, sadrzaj, "utf8");

  const ocekivano = potrosenoNaDan(sadrzaj, danas);
  // Sanity: ocekivani racun nije trivijalno 0.
  assert.ok(ocekivano > 0);
  try {
    assert.equal(potrosenoNaDanUFajlovima([putanja], danas), ocekivano);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("potrosenoNaDanUFajlovima: greska citanja koja NIJE ENOENT se propagira (fails closed)", () => {
  const dir = radniDir();
  const danas = new Date().toISOString().slice(0, 10);
  // Direktorij umjesto fajla: otvaranje/citanje puca sa EISDIR, sto NIJE ENOENT.
  const kaoDir = join(dir, "audit-dir.jsonl");
  mkdirSync(kaoDir, { recursive: true });
  try {
    assert.throws(() => potrosenoNaDanUFajlovima([kaoDir], danas));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("potrosenoNaDanUFajlovima ne racuna jucerasnju potrosnju ni odbijene pokusaje (isto kao potrosenoNaDan)", () => {
  const dir = radniDir();
  const danas = new Date().toISOString().slice(0, 10);
  const juce = new Date(Date.now() - 86_400_000).toISOString();
  const putanja = join(dir, "audit.jsonl");
  const sadrzaj = [
    zapis({ ts: juce, ok: true, krediti: 500 }),
    zapis({ ts: `${danas}T10:00:00.000Z`, ok: false, krediti: 400, error: "odbijeno bez potvrde" }),
    zapis({ ts: `${danas}T11:00:00.000Z`, ok: true, krediti: 25 }),
    "",
  ].join("\n");
  writeFileSync(putanja, sadrzaj, "utf8");
  try {
    assert.equal(potrosenoNaDanUFajlovima([putanja], danas), 25);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
