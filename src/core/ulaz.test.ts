import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pokrenutDirektno } from "./ulaz.js";

const OVAJ_FAJL = fileURLToPath(import.meta.url);

/** Postavi `process.argv[1]` za jedan potez i vrati ga kako je bio. */
function saUlazom<T>(ulaz: string | undefined, posao: () => T): T {
  const staro = process.argv[1];
  if (ulaz === undefined) process.argv.splice(1, 1);
  else process.argv[1] = ulaz;
  try {
    return posao();
  } finally {
    if (ulaz === undefined) process.argv.splice(1, 0, staro!);
    else process.argv[1] = staro!;
  }
}

test("modul pokrenut kao ulaz procesa se prepoznaje", () => {
  assert.equal(
    saUlazom(OVAJ_FAJL, () => pokrenutDirektno(import.meta.url)),
    true,
  );
});

test("uvezen modul nije ulaz procesa", () => {
  // Ulaz je neki drugi postojeci fajl (susjedni modul), dakle ovaj je samo uvezen.
  const drugi = join(OVAJ_FAJL, "..", "ulaz.js");
  assert.equal(
    saUlazom(drugi, () => pokrenutDirektno(import.meta.url)),
    false,
  );
});

// Ovo je slucaj zbog kojeg poredjenje ide preko realpath: `npm` bin veza (`node_modules/.bin/olx`)
// je na POSIX-u simbolicka veza, pa `process.argv[1]` pokazuje na nju a `import.meta.url` na pravi
// fajl. Bez razrjesavanja veze bi kapija ugasila CLI pozvan kao `olx`.
test("simbolicka veza na modul se i dalje racuna kao ulaz", { skip: process.platform === "win32" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "olx-ulaz-"));
  const veza = join(dir, "olx");
  try {
    symlinkSync(OVAJ_FAJL, veza);
    assert.equal(
      saUlazom(veza, () => pokrenutDirektno(import.meta.url)),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bez argv[1] nema ulaza", () => {
  assert.equal(
    saUlazom(undefined, () => pokrenutDirektno(import.meta.url)),
    false,
  );
});

test("nepostojeca putanja ulaza ne baca nego vraca false", () => {
  assert.equal(
    saUlazom(join(tmpdir(), "ovoga-fajla-nema-12345.js"), () => pokrenutDirektno(import.meta.url)),
    false,
  );
});
