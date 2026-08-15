---
name: olx-izdanje
description: >-
  Zatvaranje posla i puštanje koda klijentima: testovi, CHANGELOG, verzija, tag, prekidač
  stabilno, ažuriranje flote, evidencija. Okidači: "završi posao", "zatvori ovo", "napravi
  izdanje", "podigni verziju", "tagiraj i pusti", "pusti u flotu", "objavi novu verziju",
  "vrati na prethodnu verziju", "zaostaje li klon". Samo admin sesija.
---

# Izdanje: od gotovog rada do flote

Rad na `main` ne stiže do klijenata sam. Stiže samo kroz izdanje, i to je kapija između radionice
i flote. Ovaj skill je izvršni tok kroz nju: kad se pozove, odradi ga do kraja, ne opisuj ga.

Nije za klijentski razgovor. Klijent ne zna da verzije postoje i ne treba da zna.

## Dva režima, prepoznaj koji je

- **Povratno** ("napravi izdanje", "podigni verziju", "tagiraj"): idi do taga i pusha, pa stani i
  reci šta ostaje. Do prekidača je sve povratno.
- **Do kraja** ("završi posao", "pusti u flotu", "do kraja", "objavi"): odradi i nepovratni dio,
  bez daljnjih pitanja. Korisnik je već rekao da ide u flotu; nemoj tražiti potvrdu po koraku.

Kad iz poruke nije jasno koji je režim, radi povratni i ponudi drugi jednom rečenicom.

## Tok

Radi korake redom. Ne preskači i ne mijenjaj red: svaki sljedeći pretpostavlja da je prethodni
prošao.

**1. Je li posao stvarno gotov.** `bun run test` i `bun run typecheck`. Ako su dirani promptovi ili
runtime, i `scripts/provjeri-prompt.sh` (troši tokene, pa samo tada). Ako nešto pada, izdanje se ne
pravi: popravi pa se vrati na ovaj korak.

**2. Šta je ušlo.** `git log --oneline <zadnji-tag>..HEAD` i `git diff --stat <zadnji-tag>..HEAD`.
Iz toga napiši sekciju u `CHANGELOG.md`: naslov `## <broj> — <datum>`, pa tri do pet redova. Samo
ono što se vidi u radu ili može pokvariti postojeće. Popis commitova nije changelog. Ton i format
prepiši iz postojećih unosa u tom fajlu.

**3. Koji broj.** Iz sadržaja izmjena, ne po osjećaju:

- **patch** kad se samo popravlja, bez nove radnje i bez izmjene ponašanja koje korisnik vidi.
- **minor** kad ima nova sposobnost, novi alat, novi posao u cronu, ili se ponašanje mijenja.
- **major** kad bi postojeći klon prestao raditi bez ručne intervencije (nova obavezna varijabla u
  `.env`, promijenjen oblik stanja u `.olx-pik/`). Do 1.0.0 se ne koristi.

Ako je sve necommitovano, prvo commituj rad (ne izdanje, sam rad), jer skripta odbija prljavu
radnu kopiju.

**4. Izdanje.** `bun scripts/izdanje.mjs <broj>`. Skripta provjeri granu, čistu kopiju, sinhron sa
remoteom, slobodan tag i sekciju u changelogu, pa pusti `bun pm version`: `preversion` vrti testove,
`version` prepiše `src/core/verzija.ts`, `postversion` izgradi. Ako stane, popravi ono što kaže i
ponovi; ništa nije tagirano dok ne prođe.

**5. Puštanje.** `bun scripts/pusti-u-flotu.mjs` gura commit i tagove na remote i tu stane. U
režimu "do kraja" dodaj `--pomjeri-stabilno`: tada pomjeri i prekidač i sam pokrene ažuriranje
flote. Redoslijed je u skripti i nije stvar ukusa; prekidač ide zadnji jer je jedini ref koji
klonovi prate.

**6. Provjera da je stvarno prošlo.** Ne tvrdi da je gotovo bez ovoga:

- `bun scripts/provjeri-klon.mjs` prva stavka pokazuje novi broj i izdanje.
- `git ls-remote --tags origin` pokazuje `stabilno` na novom `v` tagu.
- Ako flota ima klonova, zbir ažuriranja kaže na kojem su izdanju. "Izdanja se razilaze" znači da
  je neki klon ostao na starom i to je nalaz, ne šum.

**7. Evidencija.** Sastavi tri do pet redova: broj izdanja, šta je ušlo, šta je ostalo otvoreno.
Kopiraj u clipboard (`pbcopy` na macOS, `clip` na Windowsu) i reci korisniku da je kopirano. Ako je
dostupan alat za predviđeni kanal, ponudi da je pošalješ; ne šalji bez njegove riječi.

## Vraćanje na prethodno izdanje

```
git tag -l "v*"                                                   # koje je bilo prije
bun scripts/pusti-u-flotu.mjs --izdanje v0.3.0 --pomjeri-stabilno
```

Samo pomjeranje prekidača ne mijenja ništa ni na jednoj mašini, jer nema posla koji automatski
povlači; promjenu donese ažuriranje. Jedan rub: ažuriranje preskače klon sa lokalnim izmjenama, pa
i vraćanje može tiho ostaviti jedan klon na lošoj verziji. Zato korak 6 postoji.

## Klon koji zaostaje

Na pitanje "zaostaje li ovaj klon" ili kad hook pri pokretanju sesije javi zaostajanje:

```
bun scripts/provjeri-izdanje.mjs                    # gdje je klon, gdje je prekidac
bun scripts/azuriraj-ovaj-klon.mjs [--restart]      # povuci na prekidac
```

Ažuriranje jednog klona pri padu builda ili testova samo vraća klon na prethodno izdanje i ponovo
ga izgradi, pa klijent ne ostane na mješavini novog `src` i starog `dist`.

Bez `--restart` sesije i dalje drže stari kod u memoriji, i skripta ispiše tačnu komandu za
restart. **Ne pokreći restart iz sesije koja je taj posao**: ubila bi samu sebe usred posla. Ako si
klijentska ili admin bot sesija, predloži komandu i stani.

## Šta se ne radi

- Prekidač `stabilno` ne pokazuje na `main` ni na goli commit, nego na tag izdanja, uvijek.
- Tag izdanja se ne pomjera i ne briše. Pogrešno izdanje zamjenjuje sljedeći broj; nepomičan tag
  je jedini razlog zašto vraćanje ima na što pokazati.
- Broj verzije se ne mijenja ručno u `package.json` ni u `src/core/verzija.ts`. Test parnosti to
  hvata, ali problem je što ručna izmjena preskoči testove i changelog.
- Izdanje se ne pravi sa nesinhronizovanog klona ni sa feature grane. Skripta to odbija.
- Klijentska sesija ne pravi izdanja i ne ažurira klon. Tamo je ovaj skill nedostupan po profilu, a
  i da nije: klijent o verzijama ne treba znati.

## Gdje se vidi koja verzija radi

`olx --version`, MCP handshake, polje `version` u `.olx-pik/audit.jsonl`, i prva stavka
`bun scripts/provjeri-klon.mjs`. Na kojem izdanju klon stoji: `git describe --tags`. Šta je ušlo
u koje izdanje: `CHANGELOG.md`.

## Dalje

- Zašto dva taga i puna procedura: `olx-dokumentacija/arhitektura.md`, sekcija 7.
- Pravila za kod, verziju i granice slojeva: `.claude/rules/core-kod.md`.
- Pravila za pogon i zašto klon ne povlači sam: `.claude/rules/pogon.md`.
