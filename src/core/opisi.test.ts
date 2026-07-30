import assert from "node:assert/strict";
import { test } from "node:test";
import { nadjiSablon, ocistiOpis } from "./opisi.js";

const FOOTER = "Dostava po cijeloj BiH, placanje pouzecem, javite se za dostupnost.";

test("ocistiOpis skida HTML koji OLX vraca u opisu", () => {
  assert.equal(ocistiOpis("Prvi red<br><br>Drugi red"), "Prvi red Drugi red");
  assert.equal(ocistiOpis("<p><strong>Bold</strong></p>"), "Bold");
  assert.equal(ocistiOpis("a&nbsp;&nbsp;b"), "a b");
  assert.equal(ocistiOpis("   vise    razmaka   "), "vise razmaka");
});

test("sablon se prijavljuje samo kad se STVARNO ponavlja", () => {
  const opisi = Array.from({ length: 5 }, (_, i) => `Artikal broj ${i}, opis dovoljne duzine za provjeru. ${FOOTER}`);
  const r = nadjiSablon(opisi);
  assert.equal(r.uzorak, 5);
  assert.ok(r.zavrsni_blokovi.length > 0, "ponovljeni footer se mora naci");
  assert.equal(r.zavrsni_blokovi[0]?.pojava, 5);
  assert.equal(r.zavrsni_blokovi[0]?.procenat, 100);
  assert.ok(r.nalaz.includes("SAMO ako on potvrdi"), "nalaz mora traziti potvrdu klijenta");
});

test("dvije pojave od dvadeset pet NISU sablon, i to se mora reci", () => {
  // Tacno slucaj izmjeren na pravom shopu: footer u 2 od 25 opisa.
  const opisi = [
    ...Array.from({ length: 23 }, (_, i) => `Sasvim razlicit opis artikla numero ${i}, bez ikakvog zajednickog kraja teksta.`),
    `Neki artikal, dovoljno dugacak opis za provjeru. ${FOOTER}`,
    `Drugi artikal, takodjer dovoljno dugacak opis. ${FOOTER}`,
  ];
  const r = nadjiSablon(opisi);
  assert.equal(r.zavrsni_blokovi.length, 0, "dvije pojave su ispod praga i ne prijavljuju se");
  assert.ok(r.nalaz.includes("Sablon NE postoji"), `nalaz mora biti negativan, a bio je: ${r.nalaz}`);
  assert.ok(r.nalaz.includes("Ne izmisljaj"), "nalaz mora izricito zabraniti izmisljanje");
});

test("ista fraza ponovljena u JEDNOM opisu se ne racuna kao navika", () => {
  // Inace bi opis koji tri puta ponovi istu recenicu izgledao kao sablon kroz tri oglasa.
  const jedan = `${FOOTER} Nesto izmedju teksta. ${FOOTER} I opet nesto. ${FOOTER}`;
  const r = nadjiSablon([jedan, "Kratak drugi opis koji je ipak dovoljno dug za uzorak."], { minPojava: 2 });
  assert.equal(r.fraze.length, 0, "ponavljanje unutar jednog opisa nije ponavljanje kroz oglase");
});

test("prazni opisi se broje odvojeno i ne kvare procente", () => {
  const r = nadjiSablon(["", "   ", `Opis sa dovoljno teksta za uzorak. ${FOOTER}`, `Drugi opis isto dovoljno dug. ${FOOTER}`, `Treci opis dovoljno dug. ${FOOTER}`]);
  assert.equal(r.bez_opisa, 2);
  assert.equal(r.zavrsni_blokovi[0]?.pojava, 3);
  assert.equal(r.zavrsni_blokovi[0]?.procenat, 100, "procenat se racuna od upotrebljivih, ne od svih");
});

test("bez ijednog upotrebljivog opisa nalaz to kaze, bez prijedloga", () => {
  const r = nadjiSablon(["", "kratko", "<br>"]);
  assert.equal(r.zavrsni_blokovi.length, 0);
  assert.equal(r.fraze.length, 0);
  assert.ok(r.nalaz.includes("ne moze citati"));
});
