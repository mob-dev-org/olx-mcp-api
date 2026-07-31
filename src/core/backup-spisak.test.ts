import assert from "node:assert/strict";
import { test } from "node:test";
import { bijeliSpisak, ciljUKopiji, nadjiSumnjive, odsijeciNepotpunuLiniju, razvrstaj } from "./backup-spisak.js";

test("bijeli spisak prati pomjerene putanje, ne prepisuje literale", () => {
  // Klon koji je pomjerio pamcenje kroz env dobio bi tih backup praznog mjesta da spisak nosi
  // ".olx-pik/pamcenje.json" kao literal.
  const env = { OLX_PAMCENJE_FILE: "drugdje/p.json", OLX_AUDIT_FILE: "drugdje/a.jsonl" } as NodeJS.ProcessEnv;
  const putanje = bijeliSpisak(env).map((s) => s.putanja);
  assert.ok(putanje.includes("drugdje/p.json"), "pamcenje mora pratiti env");
  assert.ok(putanje.includes("drugdje/a.jsonl"), "audit mora pratiti env");
  assert.ok(!putanje.includes(".olx-pik/pamcenje.json"), "stara putanja ne smije ostati");
});

test("spisak nosi ono sto se lako previdi: access.json i marker saznanja", () => {
  const putanje = bijeliSpisak({} as NodeJS.ProcessEnv).map((s) => s.putanja);
  assert.ok(putanje.includes(".claude-runtime/channels/telegram/access.json"));
  assert.ok(putanje.includes(".claude-runtime-admin/channels/telegram/access.json"));
  assert.ok(putanje.includes(".olx-pik/saznanja.pokupljeno"), "bez markera se saznanja pokupe ponovo");
  assert.ok(putanje.includes("KLIJENT-javno.md"));
});

test("tajne se preskacu, i to izricito a ne slucajno", () => {
  const r = razvrstaj(
    [
      ".env",
      ".claude-runtime/channels/telegram/.env",
      ".olx-pik/onboarding-stanje.md",
      ".olx-pik/proba-kanala/channels/telegram/.env",
    ],
    {} as NodeJS.ProcessEnv,
  );
  assert.equal(r.uzmi.length, 0, "nijedna tajna ne smije proci");
  assert.equal(r.nepoznato.length, 0, "tajne moraju biti IZRICITO crne, ne nepoznate");
  assert.equal(r.preskoci.length, 4);
  const onboarding = r.preskoci.find((p) => p.putanja.endsWith("onboarding-stanje.md"));
  assert.match(String(onboarding?.razlog), /token/, "razlog mora reci zasto, da ga niko ne vrati nazad");
});

test("veliko i prolazno se ne kopira", () => {
  const r = razvrstaj(
    [
      ".olx-pik/slike/slika-2026-07-30.png",
      ".claude-runtime/projects/x/sesija.jsonl",
      ".claude-runtime/channels/telegram/inbox/foto.jpg",
      ".olx-pik/test-audit.jsonl",
      ".olx-pik/cron-dnevno.log",
      ".olx-pik/pamcenje.json.tmp",
      ".olx-pik/cuvar-sesije.pid",
      ".olx-pik/bulk-price.lock",
      ".olx-pik/prompt-klijent.md",
      ".olx-pik/most-stanje.json",
    ],
    {} as NodeJS.ProcessEnv,
  );
  assert.equal(r.uzmi.length, 0);
  assert.equal(r.nepoznato.length, 0, "sve prolazno mora imati svoj razlog na crnom spisku");
});

test("stanje sa bijelog spiska prolazi, ukljucujuci mape sa obrascem", () => {
  const r = razvrstaj(
    [
      ".olx-pik/pamcenje.json",
      ".olx-pik/izuzeca.json",
      ".olx-pik/audit.jsonl",
      ".olx-pik/snapshots/views-2026-07-29.json",
      ".olx-pik/konkurenti/neko_ime-2026-07-29.json",
      ".olx-pik/prijedlozi/runda-2026-07-28.md",
      "KLIJENT.md",
    ],
    {} as NodeJS.ProcessEnv,
  );
  assert.equal(r.uzmi.length, 7, `sve je trebalo proci, a nepoznato je: ${r.nepoznato.join(", ")}`);
});

test("novo stanje se prijavljuje kao nepoznato, ne izostavlja tiho", () => {
  // Ovo je jedina zastita od ustajalog spiska: neko doda novi fajl, niko ne odluci ide li u
  // backup, i to se otkrije tek na dan oporavka.
  const r = razvrstaj([".olx-pik/nesto-novo.json"], {} as NodeJS.ProcessEnv);
  assert.deepEqual(r.nepoznato, [".olx-pik/nesto-novo.json"]);
  assert.equal(r.uzmi.length, 0);
});

test("fajl u dozvoljenoj mapi koji ne odgovara obrascu ne prolazi", () => {
  const r = razvrstaj([".olx-pik/snapshots/nesto.txt"], {} as NodeJS.ProcessEnv);
  assert.equal(r.uzmi.length, 0);
  assert.deepEqual(r.nepoznato, [".olx-pik/snapshots/nesto.txt"]);
});

test("Windows kose crte se razvrstavaju isto kao Unix", () => {
  const r = razvrstaj([".olx-pik\\snapshots\\views-2026-07-29.json", ".olx-pik\\slike\\a.png"], {} as NodeJS.ProcessEnv);
  assert.equal(r.uzmi.length, 1);
  assert.equal(r.preskoci.length, 1);
});

test("nepotpun zadnji red se odsijeca", () => {
  assert.equal(odsijeciNepotpunuLiniju('{"a":1}\n{"b":2}\n'), '{"a":1}\n{"b":2}\n');
  assert.equal(odsijeciNepotpunuLiniju('{"a":1}\n{"b":'), '{"a":1}\n');
  assert.equal(odsijeciNepotpunuLiniju('{"nepot'), "", "jedan nepotpun red daje prazan fajl");
  assert.equal(odsijeciNepotpunuLiniju(""), "");
});

test("obrasci tajni hvataju stvarne oblike kljuceva", () => {
  // Vrijednosti su izmisljene, samo im je OBLIK stvaran. Pravi token u testu bi bio tacno ono
  // sto ovaj alarm treba da sprijeci.
  assert.deepEqual(nadjiSumnjive("bezazlen tekst o oglasima"), []);
  assert.ok(nadjiSumnjive("token je 1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx").includes("Telegram bot token"));
  assert.ok(nadjiSumnjive("kljuc AQ.AbXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX").length > 0);
  assert.ok(nadjiSumnjive("-----BEGIN RSA PRIVATE KEY-----").includes("privatni kljuc"));
  assert.ok(nadjiSumnjive("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef").includes("JWT"));
});

test("obican broj i obicna rijec ne pale alarm", () => {
  // Lazni alarm znaci da se fajl NE posalje, pa je cijena greske stvarna.
  assert.deepEqual(nadjiSumnjive("oglas 78452167 ima 1240 pregleda, cijena 49 KM"), []);
  assert.deepEqual(nadjiSumnjive("dostava skladiste povrat placanje pouzecem"), []);
});

test("putanja pomjerena van klona ne izlazi iz radne kopije", () => {
  assert.equal(ciljUKopiji(".olx-pik/pamcenje.json"), ".olx-pik/pamcenje.json");
  assert.equal(ciljUKopiji("/var/olx/pamcenje.json"), "van-klona/pamcenje.json");
  assert.equal(ciljUKopiji("../izvan/p.json"), "van-klona/p.json");
  assert.equal(ciljUKopiji("C:/olx/p.json"), "van-klona/p.json");
});

test("prolazan zahtjev za restart sesije se ne salje u backup", () => {
  // Marker kojim onboarding puller trazi da cuvar restartuje sesiju zbog novog tokena. Zivi
  // sekundama i cuvar ga obrise; u backupu bi izazvao restart na masini gdje se stanje vraca.
  const r = razvrstaj([".olx-pik/restart-sesije", ".olx-pik/restart-admin-bota"]);
  assert.equal(r.uzmi.length, 0);
  assert.equal(r.nepoznato.length, 0, "ne smije se prijaviti kao nepoznato stanje");
  assert.equal(r.preskoci.length, 2);
  for (const p of r.preskoci) assert.match(p.razlog, /restart/);
});
