// Enkripcija tokena za web onboarding: ECDH P-256 + HKDF-SHA256 + AES-256-GCM.
//
// Zasto ovako: ovo je jedina tajna koja putuje kroz tudju infrastrukturu (Cloudflare KV), pa
// mora biti sifrovana javnim kljucem ciji privatni par zivi ISKLJUCIVO na admin masini. Ni
// Cloudflare ni KV nikad ne vide token u citljivom obliku. Obrazac je standardni ECIES
// (sealed box): posiljalac napravi jednokratni (ephemeral) par, izvede zajednicku tajnu sa
// primaocevim javnim kljucem, i njome sifruje. Primalac istu tajnu izvede svojim privatnim
// kljucem. Ephemeral privatni kljuc se odbaci, pa se ni uz kasniju krajdu KV-a token ne moze
// desifrovati bez admin privatnog kljuca.
//
// Zasto WebCrypto a ne biblioteka: isti kod radi izvorno i u Cloudflare Workeru i u Node 20,
// bez ijedne zavisnosti. Worker ostaje minimalan i lak za reviziju, puller nema npm instalaciju.
//
// Format sifrata (JSON, sva polja base64): { v:1, epk, iv, ct }
//   epk  jednokratni javni kljuc posiljaoca (raw, 65 bajta)
//   iv   AES-GCM nonce (12 bajta)
//   ct   sifrat + GCM tag
//
// Provjera: `bun scripts/lib/ecies.mjs --self-test` uradi roundtrip i javi OK ili padne.

const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error("WebCrypto (crypto.subtle) nije dostupan u ovom runtimeu.");
}

const CURVE = { name: "ECDH", namedCurve: "P-256" };
const INFO = new TextEncoder().encode("pikgpt-onboarding-v1");

// ---- base64 nad bajtima, prenosivo (Node 20 i Workeri imaju globalni btoa/atob) ----

function bajtiUB64(bajti) {
  let s = "";
  for (const b of bajti) s += String.fromCharCode(b);
  return btoa(s);
}

function b64UBajte(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---- kljucevi ----

// Napravi admin par. Privatni ide u pkcs8, javni u raw. Oba base64. Javni se ugradi u Worker,
// privatni ostaje na masini (0600 fajl ili keychain), nikad u git.
export async function napraviPar() {
  const par = await subtle.generateKey(CURVE, true, ["deriveBits"]);
  const priv = new Uint8Array(await subtle.exportKey("pkcs8", par.privateKey));
  const pub = new Uint8Array(await subtle.exportKey("raw", par.publicKey));
  return { privatniB64: bajtiUB64(priv), javniB64: bajtiUB64(pub) };
}

async function uveziJavni(javniB64) {
  return subtle.importKey("raw", b64UBajte(javniB64), CURVE, false, []);
}

async function uveziPrivatni(privatniB64) {
  return subtle.importKey("pkcs8", b64UBajte(privatniB64), CURVE, false, ["deriveBits"]);
}

async function izvediAesKljuc(privatniKljuc, javniKljuc, namjene) {
  const tajnaBits = await subtle.deriveBits(
    { name: "ECDH", public: javniKljuc },
    privatniKljuc,
    256,
  );
  const hkdf = await subtle.importKey("raw", tajnaBits, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: INFO },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    namjene,
  );
}

// ---- sifrovanje / desifrovanje ----

// Sifruj tekst za primaoca sa datim javnim kljucem. Vraca JSON string spreman za KV.
export async function sifruj(tekst, primaocevJavniB64) {
  const primaoc = await uveziJavni(primaocevJavniB64);
  const eph = await subtle.generateKey(CURVE, true, ["deriveBits"]);
  const aes = await izvediAesKljuc(eph.privateKey, primaoc, ["encrypt"]);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv }, aes, new TextEncoder().encode(tekst)),
  );
  const epk = new Uint8Array(await subtle.exportKey("raw", eph.publicKey));
  return JSON.stringify({ v: 1, epk: bajtiUB64(epk), iv: bajtiUB64(iv), ct: bajtiUB64(ct) });
}

// Desifruj JSON string sa privatnim kljucem. Vraca originalni tekst.
export async function desifruj(jsonSifrat, privatniB64) {
  const { v, epk, iv, ct } = JSON.parse(jsonSifrat);
  if (v !== 1) throw new Error(`Nepoznata verzija sifrata: ${v}`);
  const priv = await uveziPrivatni(privatniB64);
  const eph = await uveziJavni(epk);
  const aes = await izvediAesKljuc(priv, eph, ["decrypt"]);
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: b64UBajte(iv) }, aes, b64UBajte(ct));
  return new TextDecoder().decode(plain);
}

// ---- self-test ----

if (
  typeof process !== "undefined" &&
  process.argv?.[1]?.endsWith("ecies.mjs") &&
  process.argv.includes("--self-test")
) {
  const par = await napraviPar();
  const tajna = "test-token-" + "x".repeat(300); // duz od RSA-OAEP granice, da se vidi da GCM nosi bilo koju duzinu
  const sifrat = await sifruj(tajna, par.javniB64);
  const nazad = await desifruj(sifrat, par.privatniB64);
  if (nazad !== tajna) {
    console.error("PAO: roundtrip se ne poklapa");
    process.exit(1);
  }
  // Pogresan kljuc mora pasti, ne tiho proci.
  const drugi = await napraviPar();
  let palo = false;
  try {
    await desifruj(sifrat, drugi.privatniB64);
  } catch {
    palo = true;
  }
  if (!palo) {
    console.error("PAO: desifrovanje pogresnim kljucem je proslo");
    process.exit(1);
  }
  console.log("OK: ECIES roundtrip radi, pogresan kljuc pada. Sifrat bajta:", sifrat.length);
}
