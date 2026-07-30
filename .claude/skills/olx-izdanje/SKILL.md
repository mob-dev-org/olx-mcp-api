---
name: olx-izdanje
description: >-
  Pravljenje novog izdanja toolkita i puštanje u flotu: verzija, CHANGELOG, tag, prekidač
  stabilno, ažuriranje klonova. Okidači: "napravi izdanje", "podigni verziju", "tagiraj ovo",
  "pusti u flotu", "objavi novu verziju", "vrati na prethodnu verziju". Samo admin sesija.
---

# Izdanje toolkita

Rad na `main` ne stiže do klijenata sam. Stiže samo kroz izdanje, i to je namjerno: kapija
između radionice i flote. Ovaj skill vodi kroz nju.

Nije za klijentski razgovor. Klijent ne zna ni da verzije postoje, i ne treba da zna.

## Kad se pravi izdanje

Kad je nešto **završeno i provjereno**, ne kad je napisano. Mjerilo: `npm test` i
`npm run typecheck` prolaze, a ako su dirani promptovi i `scripts/provjeri-prompt.sh`.

Ne pravi izdanje za svaki commit. Izdanje je jedinica koju klijent osjeti i na koju se vraća, pa
grupiši povezane izmjene. Više malih izdanja dnevno znači da rollback ne pokazuje ni na šta
smisleno.

## Postupak

Jedan potez radi sve provjere i podiže broj:

```
node scripts/izdanje.mjs 0.5.0 --suho    # samo provjere
node scripts/izdanje.mjs 0.5.0           # pravo izdanje
```

Skripta odbija izdanje koje bi bilo polovično: pogrešna grana, prljava radna kopija, klon iza
remotea, tag koji već postoji, ili nedostajuća sekcija u `CHANGELOG.md`. Testove vrti `preversion`
hook, pa se broj ne može podići na stanju koje pada.

**Prije nego je pozoveš**, napiši sekciju u `CHANGELOG.md`, jer skripta bez nje staje. Format i
ton se vide iz postojećih unosa: tri do pet redova, samo ono što se vidi u radu ili može
pokvariti postojeće. Popis commitova nije changelog.

Koji broj:

- **patch** kad se samo popravlja, bez nove radnje i bez izmjene ponašanja koje klijent vidi.
- **minor** kad ima nova sposobnost, novi alat, novi posao u cronu, ili se ponašanje mijenja.
- **major** kad bi postojeći klon prestao raditi bez ručne intervencije (nova obavezna varijabla
  u `.env`, promijenjen oblik stanja u `.olx-pik/`). Do 1.0.0 se to ne koristi.

Poslije skripte ostaju dva ručna poteza, i skripta ih sama ispiše. Redoslijed nije proizvoljan:
prvo `git push --follow-tags`, pa pomjeranje prekidača `stabilno`, pa ažuriranje flote. `stabilno`
je jedini ref koji klonovi prate, pa ide na remote zadnji.

## Vraćanje na prethodno izdanje

Prekidač se vrati na prethodni tag, pa se flota ažurira ponovo:

```
git tag -l "v*"                                        # koje izdanje je bilo prije
git tag -f stabilno v0.3.0 && git push -f origin stabilno
scripts/azuriraj-sve.sh
```

Samo pomjeranje taga ne mijenja ništa ni na jednoj mašini, jer nema posla koji automatski
povlači. Jedan rub: ažuriranje preskače klon sa lokalnim izmjenama, pa i vraćanje može tiho
ostaviti jedan klon na lošoj verziji. Provjeri zbir ažuriranja, tamo stoji na kojem je izdanju
flota i javlja se kad se izdanja razilaze.

## Šta se ne radi

- Ne pomjera se `stabilno` na `main` ni na commit. Prekidač pokazuje na tag izdanja, uvijek.
- Tag izdanja se ne pomjera i ne briše. Ako je izdanje pogrešno, sljedeći broj ga zamjenjuje;
  nepomičan tag je jedini razlog zašto rollback ima na što pokazati.
- Broj verzije se ne mijenja ručno u `package.json` ni u `src/core/verzija.ts`. Test parnosti to
  hvata, ali problem je što ručna izmjena preskoči testove i changelog.
- Ne pravi se izdanje sa nesinhronizovanog klona. Skripta to i odbija.

## Gdje se vidi koja verzija radi

`olx --version`, MCP handshake, polje `version` u `.olx-pik/audit.jsonl`, i prva stavka
`node scripts/provjeri-klon.mjs`. Na kojem izdanju klon stoji: `git describe --tags`.

Klon koji zaostaje to sam javi pri pokretanju sesije (`scripts/provjeri-izdanje.mjs`), a povlači
se sa `node scripts/azuriraj-ovaj-klon.mjs`. Sesija to nikad ne radi sama od sebe: zamjena koda
usred rada ostavlja MCP server na starom buildu.

## Dalje

- Puna procedura i zašto dva taga: `olx-dokumentacija/arhitektura.md`, sekcija 7.
- Šta je ušlo u koje izdanje: `CHANGELOG.md`.
- Pravila za kod i verziju: `.claude/rules/core-kod.md`.
