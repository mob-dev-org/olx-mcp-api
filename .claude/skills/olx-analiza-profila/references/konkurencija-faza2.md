# Konkurencija: analiza tudjih naloga i cijena (IMPLEMENTIRANO 27.07.2026.)

Faza 2 je implementirana kroz agregirane MCP alate. Podaci su zivo potvrdjeni: tudji oglasi,
njihove liste po stanjima (ukljucujuci finished) i PREGLEDI po tudjem oglasu su dostupni.
Ne izmisljaj podatke; sve ispod se dohvaca alatima.

## Alati

- `olx_competitor_report <username>` — izracunat izvjestaj u jednom pozivu: paket, kad je
  zadnji put bio aktivan, godine na platformi, ocjene, vrijeme odgovora, broj aktivnih i
  zavrsenih oglasa, cijene (min/median/max/prosjek, "na upit"), udio sponzorisanih (i premium),
  udio akcija, kadenca obnove (median dana od obnove, procenat obnovljenih u 48h).
  `top_views: N` (max 10) dodaje detaljne izvjestaje za N najskorije obnovljenih oglasa.
- `olx_listing_report <id>` — analiza JEDNOG tudjeg (ili naseg) oglasa: pregledi ukupno i
  dnevno, starost, dana od obnove, broj slika, popunjeni atributi, duzina naslova, akcija.
- `olx_user_profile <username>` — sirovi javni profil kad treba polje koje report ne nosi.
- CLI ekvivalent: `stats konkurent <username> --top-views N`, `stats oglas <id>`.

## Kako citati izvjestaj

- `zadnja_aktivnost_prije_dana` veliko (mjeseci) = mrtav shop; ne treba ga tretirati kao konkurenta.
- `procenat_48h` visok = konkurent aktivno obnavlja; nasa svjezina mora pratiti njegovu.
- `sponzorisano.procenat` pokazuje koliko se oslanja na placenu poziciju; nizak procenat uz
  dobre preglede znaci da mu naslovi rade posao.
- Pregledi dnevno naseg ekvivalentnog artikla naspram njihovog top oglasa su direktan benchmark
  vidljivosti.

## Granice (i dalje vaze)

- NEMA otkrivanja konkurenata po kategoriji ili kljucnoj rijeci: API nema search endpoint.
  Konkurenta zadaje korisnik po username-u, ili se uzima iz mjesecnih Excel snimaka shopova
  (skill olx-shopovi-snimci).
- Zavrseni tudji oglasi imaju cijenu 0 / "Na upit"; "zavrsen" ne znaci nuzno prodan.
- `sponsor_active` detalji (koliko je konkurent PLATIO) vidljivi su samo na vlastitim oglasima;
  na tudjim je javan samo flag sponzorisan 0/1/2.

## Eticke i pravne granice

- Samo javno dostupni podaci. Bez zaobilazenja autentifikacije ili scrapinga zasticenih dijelova.
- Postovati rate limite (toolkit vec ima throttle/retry).
- Ne logirati ni izvoziti licne podatke; fokus je na cijenama i pozicioniranju artikala, ne na ljudima.
