# Zapis izdanja

Cemu sluzi: kad klijent kaze "od jucer ne radi", ovdje stoji sta je uslo izmedju dva izdanja.
Nije zapis svakog commita, nego samo onoga sto se vidi u radu ili moze pokvariti postojece.

Kako se cita broj verzije: `node dist/cli/index.js --version`, polje `version` u
`.olx-pik/audit.jsonl`, ili `node scripts/provjeri-klon.mjs`. Na kojem izdanju klon stoji:
`git describe --tags`. Procedura izdanja i vracanja: `olx-dokumentacija/arhitektura.md`,
sekcija 7.

## 0.5.0 — 2026-07-30

Upravljanje izdanjima prestaje biti popis koraka u dokumentu i postaje alat koji ne moze zaboraviti
redoslijed.

- `scripts/izdanje.mjs` i skill `olx-izdanje`: izdanje se odbija ako bi bilo polovicno (pogresna
  grana, prljava radna kopija, klon iza remotea, zauzet tag, nedostajuca sekcija u ovom fajlu).
- Klon sam javi da zaostaje: `SessionStart` hook zove `scripts/provjeri-izdanje.mjs`, poredi klon sa
  daljinskim prekidacem i da komandu. Ne povlaci nista sam, i tih je u klijentskoj bot sesiji da
  verzija ne dodje u kontekst bota.
- `scripts/azuriraj-ovaj-klon.mjs`: azuriranje jednog klona iz njega samog, na obje platforme. Pri
  padu builda ili testova VRACA klon na prethodno izdanje i ponovo ga izgradi, pa nema stanja sa
  novim `src` i starim `dist`.
- Agent `olx-dijagnostika` gleda izdanje rano, jer simptom "od jucer" na klonu koji zaostaje cesto
  ima popravku koja postoji ali nije dosla.

## 0.4.0 — 2026-07-30

Prvo oznaceno izdanje. Sve prije ovoga se u audit logu i u `--version` prijavljuje kao `0.1.0`,
jer broj verzije do sada nije bio vezan ni za jedno stvarno stanje koda.

- Verzioniranje sistema: `src/core/verzija.ts` je jedini izvor broja, `npm version` ga podize i
  tagira, a verzija se vidi u CLI-ju, MCP handshakeu, audit zapisu i provjeri klona.
- Popravljeno tiho neazuriranje flote: `git fetch --tags` bez `--force` je odbijao pomjeriti tag
  koji lokalno postoji, pa je klon mogao ostati na starom kodu dok skripta prijavljuje uspjeh.
  Oba azuriranja (macOS i Windows) sada prijavljuju i ime izdanja na kojem je flota.
- Test koji cuva granicu slojeva: `src/core` ne smije uvoziti iz `src/mcp` ni `src/cli`.
- Atomican upis snapshota pregleda i snimaka konkurenata.
- Backup klijentskog stanja u odvojen repo, grana po klijentu, sa bijelim spiskom fajlova.

## 0.3.0 — 2026-07-30

Stanje koje je nosio tag `stabilno` prije uvodjenja verzioniranja. Kod ovog izdanja sam sebe
prijavljuje kao `0.1.0`; to je i razlog zasto verzioniranje postoji.

- Telegram most bez kanala, Gemini za opis i generisanje slika, brana za tisinu bota.
- Pravilo o grupnim radnjama umjesto petlje pojedinacnih poziva, izmjereno na stvarnoj sesiji.
- Izuzeci od obnove i izdvajanja, i u dnevnom poslu, plus CSV za cijeli katalog.
- Brana troska i na objavi i na promjeni kategorije, prazan opis zaustavlja objavu.
- Link na oglas u odgovorima, jer ga API ne vraca a korisnik ga trazi odmah.
- Profil klijenta u promptu i pamcenje koje bot sam pise, pa sesija posle nocnog restarta zna ton
  i navike bez ijednog poziva alata.
- Prijedlozi AI runde kroz alat, i sablon opisa koji se cita iz kataloga umjesto da se izmislja.

## Prije verzioniranja

Bez tagova, jer nijedno od ovih stanja nije bilo propusteno kao izdanje. Popis je tu da se zna
kada je sta nastalo; tacne granice se citaju iz `git log`.

- **29.07.2026.** Preflight provjera klona (`provjeri-klon.mjs`), skill `olx-novi-klijent`, vision
  proxy `olx_opisi_sliku`, kanal saznanja iz prakse, Windows spremnost pogona, tajne nedostupne
  klijentskoj sesiji, i pravilo da se o pitanjima kupaca ne tvrdi nista.
- **28.07.2026.** Pogon klijenta: cuvari sesija, admin bot, AI runda i cron za obje platforme.
  Alat `olx_sponsor_plan`, pravila po slojevima, podagenti, dokumentovana arhitektura.
- **27.07.2026.** Agregacioni `stats` sloj i kompaktni izlazi alata.
- **25 i 26.07.2026.** Jedan nalog po klonu, audit log, planer izdvajanja, spajanje kataloga sa
  vanjskim sistemom, pravila brojeva, korpus zvanicne PIK pomoci, DeepSeek profil i mjerenje
  potrosnje, testovi spend-guarda, skillovi za SEO, klijent flow i dnevnu obnovu.
- **Jun 2026.** Jezgro (`OlxClient` sa throttleom, retryem i spend-guardom), CLI, MCP server,
  upload slika kroz multipart, CSV indeksi kategorija i lokacija, knowledgebase.
