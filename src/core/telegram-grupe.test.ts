// Spisak grupa iz access.json: citanje oblika i idempotentne izmjene.
//
// Fajl dijelimo sa Telegram pluginom, pa je najvazniji test onaj koji cuva da izmjena ne pojede
// polja o kojima ovaj kod ne zna nista.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dodajGrupu,
  grupeIzPristupa,
  imaGrupu,
  normalizujPristup,
  putanjaPristupa,
  ukloniGrupu,
  type Pristup,
} from "./telegram-grupe.js";

function pristup(overrides: Partial<Pristup> = {}): Pristup {
  return normalizujPristup({
    dmPolicy: "allowlist",
    allowFrom: ["7061697037"],
    groups: { "-1001234": { requireMention: false, allowFrom: ["7061697037"] } },
    pending: {},
    ...overrides,
  });
}

test("grupeIzPristupa vraca id-eve grupa", () => {
  assert.deepEqual(grupeIzPristupa(pristup()), ["-1001234"]);
});

test("nevaljan oblik daje prazan spisak, nikad gresku", () => {
  assert.deepEqual(grupeIzPristupa(null), []);
  assert.deepEqual(grupeIzPristupa({}), []);
  assert.deepEqual(grupeIzPristupa({ groups: {} }), []);
  assert.deepEqual(grupeIzPristupa("smece"), []);
  // Niz umjesto objekta bi kroz Object.keys dao indekse "0","1" kao lazne grupe.
  assert.deepEqual(grupeIzPristupa({ groups: ["-100", "-200"] }), []);
});

test("pending nikad ne zavrsi medju grupama", () => {
  const p = pristup({ pending: { abc123: { chatId: "-1009999" } } });
  assert.deepEqual(grupeIzPristupa(p), ["-1001234"]);
});

test("normalizujPristup popunjava obavezna polja kad ih nema", () => {
  const p = normalizujPristup({});
  assert.equal(p.dmPolicy, "allowlist");
  assert.deepEqual(p.allowFrom, []);
  assert.deepEqual(p.groups, {});
  assert.deepEqual(p.pending, {});
});

test("nepoznata polja prezivljavaju normalizaciju", () => {
  // Telegram plugin smije upisati polja o kojima ovaj kod ne zna nista. Normalizacija koja ih
  // odbaci bi ih tiho obrisala pri prvoj izmjeni spiska grupa.
  const sirovo = {
    dmPolicy: "allowlist",
    allowFrom: ["1"],
    groups: { "-100": { requireMention: true, tudjePolje: 42 } },
    pending: {},
    nestoNovo: { verzija: 3 },
  };
  const p = normalizujPristup(sirovo);
  assert.deepEqual(p.nestoNovo, { verzija: 3 });
  assert.equal(p.groups["-100"]!.tudjePolje, 42);
});

test("dodajGrupu je idempotentan i ne dira postojecu grupu", () => {
  const prije = pristup();
  const poslije = dodajGrupu(prije, "-1001234");
  assert.deepEqual(poslije.groups, prije.groups, "postojeca grupa se ne prepisuje");
});

test("nova grupa nasljedjuje korijenski allowFrom", () => {
  const p = dodajGrupu(pristup(), "-1005678");
  assert.deepEqual(p.groups["-1005678"]!.allowFrom, ["7061697037"]);
  assert.equal(p.groups["-1005678"]!.requireMention, false, "klijentski bot ne trazi mention");
  assert.equal(Object.keys(p.groups).length, 2);
});

test("izricito zadano polje mijenja samo to polje na postojecoj grupi", () => {
  const p = dodajGrupu(pristup(), "-1001234", { requireMention: true });
  assert.equal(p.groups["-1001234"]!.requireMention, true);
  assert.deepEqual(p.groups["-1001234"]!.allowFrom, ["7061697037"], "allowFrom ostaje netaknut");
});

test("dodavanje ne dira korijenski allowFrom ni pending", () => {
  const prije = pristup({ pending: { kod: { ts: 1 } } });
  const poslije = dodajGrupu(prije, "-1005678");
  assert.deepEqual(poslije.allowFrom, prije.allowFrom);
  assert.deepEqual(poslije.pending, prije.pending);
});

test("prazan id grupe je greska, ne tiho dodavanje praznog kljuca", () => {
  assert.throws(() => dodajGrupu(pristup(), "   "));
});

test("ukloniGrupu radi i kad grupe nema", () => {
  const p = pristup();
  assert.deepEqual(ukloniGrupu(p, "-1009999"), p, "nepostojeca grupa nije greska");
  const bez = ukloniGrupu(p, "-1001234");
  assert.deepEqual(bez.groups, {}, "zadnja grupa daje prazan objekat, ne undefined");
  assert.deepEqual(bez.allowFrom, p.allowFrom, "uklanjanje grupe ne dira ko smije pisati botu");
});

test("imaGrupu tolerise razmake oko id-a", () => {
  assert.equal(imaGrupu(pristup(), " -1001234 "), true);
  assert.equal(imaGrupu(pristup(), "-1009999"), false);
});

test("putanja pristupa se moze pregaziti kroz okruzenje", () => {
  const env = { OLX_TELEGRAM_ACCESS_FILE: "/tmp/proba-access.json" } as NodeJS.ProcessEnv;
  assert.equal(putanjaPristupa("klijent", env), "/tmp/proba-access.json");
});

test("bez override-a putanja gadja klijentski runtime, ne admin", () => {
  const p = putanjaPristupa("klijent", {} as NodeJS.ProcessEnv);
  assert.match(p, /\.claude-runtime[/\\]channels[/\\]telegram[/\\]access\.json$/);
  assert.ok(!p.includes(".claude-runtime-admin"), "admin runtime nije izvor klijentskih odredista");
});
