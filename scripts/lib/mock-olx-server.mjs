// Lazni OLX API za testove pogona: pravi HTTP server na slucajnom portu, koji CLI gadja preko
// OLX_BASE_URL. Nije mock biblioteka nego pravi server, jer se testira CLI kao poseban proces:
// on ima svoj Node i svoj fetch, pa se u njega ne moze ubaciti stub.
//
// Pored odgovora, server vodi i evidenciju poziva. To je sustina ovih testova: orkestracija u
// src/cli/index.ts nema izvezenu funkciju koja bi se pozvala direktno, pa je jedini nacin da se
// provjeri redoslijed i broj poziva to sto je ostalo na zici.

import { createServer } from "node:http";

// fixture:
//   me                 objekat korisnika za GET /me
//   limits             objekat za GET /listing/refresh/limits
//   aktivni            niz oglasa za GET /users/:user/listings (jedna stranica)
//   istekli            niz oglasa za GET /users/:user/listings/expired (default prazno)
//   refreshOdgovori    { [id]: 500 | {...} } gdje broj znaci HTTP status greske
//   getListingOdgovori { [id]: 500 | {...} } isto, za GET /listings/:id
export function pokreniMockOlx(fixture = {}) {
  const pozivi = {
    redoslijed: [],
    refresh: [],
    getListing: [],
  };

  const me = fixture.me ?? { id: 1, username: "testni-shop", new_questions_count: 0 };
  const limits = fixture.limits ?? { free_count: 10, free_limit: 30 };
  const aktivni = fixture.aktivni ?? [];
  const istekli = fixture.istekli ?? [];
  const refreshOdgovori = fixture.refreshOdgovori ?? {};
  const getListingOdgovori = fixture.getListingOdgovori ?? {};

  const stranica = (niz) => ({
    data: niz,
    meta: { current_page: 1, last_page: 1, per_page: Math.max(niz.length, 1), total: niz.length },
  });

  const server = createServer((req, res) => {
    const putanja = new URL(req.url, "http://localhost").pathname;
    pozivi.redoslijed.push({ metod: req.method, putanja });

    const posalji = (status, tijelo) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(tijelo));
    };

    if (putanja === "/me") return posalji(200, me);
    if (putanja === "/listing/refresh/limits") return posalji(200, limits);

    const refresh = putanja.match(/^\/listings\/(\d+)\/refresh$/);
    if (refresh) {
      const id = Number(refresh[1]);
      pozivi.refresh.push({ id, ts: Date.now() });
      const odgovor = refreshOdgovori[id];
      if (typeof odgovor === "number") return posalji(odgovor, { message: "greska iz fixture" });
      return posalji(200, odgovor ?? { message: "Osvjezeno" });
    }

    const oglas = putanja.match(/^\/listings\/(\d+)$/);
    if (oglas) {
      const id = Number(oglas[1]);
      pozivi.getListing.push({ id, ts: Date.now() });
      const odgovor = getListingOdgovori[id];
      if (typeof odgovor === "number") return posalji(odgovor, { message: "greska iz fixture" });
      return posalji(200, odgovor ?? aktivni.find((l) => l.id === id) ?? { id, title: `Oglas ${id}`, views: 0 });
    }

    if (/^\/users\/[^/]+\/listings\/expired$/.test(putanja)) return posalji(200, stranica(istekli));
    if (/^\/users\/[^/]+\/listings$/.test(putanja)) return posalji(200, stranica(aktivni));

    // Nepoznata ruta je greska testa, ne tiha nula: bolje da test padne na 404 nego da prodje
    // zato sto je CLI dobio prazan odgovor na nesto sto fixture nije predvidio.
    return posalji(404, { message: `Mock nema rutu ${req.method} ${putanja}` });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        pozivi,
        close: () =>
          new Promise((gotovo) => {
            server.closeAllConnections?.();
            server.close(() => gotovo());
          }),
      });
    });
  });
}

// Pomocna: indeks prvog poziva koji odgovara putanji, ili -1.
export function prviIndeks(pozivi, obrazac) {
  return pozivi.redoslijed.findIndex((p) => obrazac.test(p.putanja));
}
