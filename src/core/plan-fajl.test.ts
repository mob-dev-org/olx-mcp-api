// Testovi kljuca protiv dvostrukog izvrsenja: samoizljecenje ostatka mrtvog procesa je
// jedina zastita klijentske sesije, kojoj je Bash zabranjen pa kljuc ne moze obrisati rucno.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { citajPlanAkoPostoji, upisiPlan, zauzmiKljuc } from "./plan-fajl.js";
import type { SponsorPlan } from "./plan.js";

function radniDir(ime: string): string {
  const dir = join(tmpdir(), `olx-plan-fajl-${ime}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("zauzmiKljuc preuzima kljuc mrtvog procesa umjesto da odbije", () => {
  const dir = radniDir("mrtav");
  const putanja = join(dir, "plan.json");
  try {
    // Pid koji sigurno ne postoji: maksimalni pid na macOS je 99998, na Linuxu 4194304.
    writeFileSync(`${putanja}.lock`, "99999999", "utf8");
    const otpusti = zauzmiKljuc(putanja);
    assert.equal(readFileSync(`${putanja}.lock`, "utf8"), String(process.pid), "kljuc je preuzet");
    otpusti();
    assert.equal(existsSync(`${putanja}.lock`), false, "kljuc je otpusten");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("zauzmiKljuc odbija kad vlasnik kljuca stvarno zivi", () => {
  const dir = radniDir("ziv");
  const putanja = join(dir, "plan.json");
  try {
    // Vlastiti pid: proces koji sigurno zivi dok test traje.
    writeFileSync(`${putanja}.lock`, String(process.pid), "utf8");
    assert.throws(() => zauzmiKljuc(putanja), /vec u toku/);
    assert.equal(readFileSync(`${putanja}.lock`, "utf8"), String(process.pid), "tudji kljuc nije diran");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("zauzmiKljuc normalno zauzima i otpusta kad kljuca nema", () => {
  const dir = radniDir("cist");
  const putanja = join(dir, "plan.json");
  try {
    const otpusti = zauzmiKljuc(putanja);
    assert.throws(() => zauzmiKljuc(putanja), /vec u toku/, "drugi poziv istog zivog procesa je odbijen");
    otpusti();
    const ponovo = zauzmiKljuc(putanja);
    ponovo();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upisiPlan pise atomicno i citajPlanAkoPostoji ga cita nazad", () => {
  const dir = radniDir("upis");
  const putanja = join(dir, "plan.json");
  try {
    const plan = { verzija: 1, termini: [] } as unknown as SponsorPlan;
    upisiPlan(plan, putanja);
    assert.equal(existsSync(`${putanja}.tmp`), false, "privremeni fajl ne ostaje");
    const procitan = citajPlanAkoPostoji(putanja);
    assert.ok(procitan && Array.isArray(procitan.termini));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
