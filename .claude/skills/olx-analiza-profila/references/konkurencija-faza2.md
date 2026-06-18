# Konkurencija: analiza tudjih naloga i cijena (Faza 2)

Ovo jos nije potpuno podrzano u toolkitu. Dokument opisuje sta treba da bi radilo i kako pristupiti
oprezno. Ne izmisljaj podatke o konkurenciji; ako nesto ne mozes dohvatiti, reci to jasno.

## Sta je cilj

- Pregledati javne oglase konkurentskog shopa (naslovi, cijene, izdvojenost, svjezina).
- Cjenovno porediti nase artikle sa njihovim u istoj kategoriji.
- Izvuci prakticne zakljucke: gdje smo preskupi/prejeftini, gdje konkurent dominira izdvajanjem, gdje je prazan prostor.

## Tehnicki preduslovi (sta fali)

- Pristup tudjim oglasima: `GET /users/:username/listings` mozda vraca javne oglase i za tudji nalog,
  ali to je NEPOTVRDJENO. Treba provjeriti uzivo da li API to dozvoljava i sta tacno vraca za tudji username.
- Pretraga po kategoriji / kljucnoj rijeci: za cjenovno poredjenje treba search endpoint (npr. lista
  oglasa u kategoriji sa cijenama). Toolkit ga trenutno NEMA. Vjerovatno postoji javni search na API-ju,
  ali nije dokumentovan u nasem knowledgebase-u.

Dok se to ne potvrdi i ne doda u `src/core`, konkurentska analiza se ne moze raditi pouzdano kroz MCP.

## Predlozeni redoslijed kad se krene u Fazu 2

1. Potvrditi uzivo (sa radnim tokenom) da li `GET /users/:username/listings` vraca tudje javne oglase.
2. Ako da: dodati u core metodu npr. `competitorListings(username)` i izloziti je kao read-only CLI/MCP alat.
3. Provjeriti postoji li javni search po kategoriji; ako da, dodati `searchListings(...)` za cjenovno poredjenje.
4. Tek onda prosiriti ovaj skill da: dohvati nase + konkurentske oglase u istoj kategoriji, uporedi cijene
   (medijana, raspon, nasa pozicija), i izvuce preporuke.

## Eticke i pravne granice

- Samo javno dostupni podaci. Bez zaobilazenja autentifikacije ili scrapinga zasticenih dijelova.
- Postovati rate limite (toolkit vec ima throttle/retry).
- Ne logirati ni izvoziti licne podatke; fokus je na cijenama i pozicioniranju artikala, ne na ljudima.
