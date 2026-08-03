// Verzija toolkita: jedan izvor istine za CLI (`--version`), MCP handshake i audit zapis.
//
// Zasto konstanta a ne citanje `package.json`:
// - `import pkg from "../../package.json"` ne prolazi, jer je `package.json` van `rootDir` (src),
//   pa ga `tsc` odbija i pokvario bi strukturu `dist`.
// - `readFileSync` bi u `src/core` dirao disk, sto ovaj sloj ne smije osim u `audit.ts` i
//   `snapshoti.ts` (.claude/rules/core-kod.md), a verzija bi mogla tiho postati "nepoznato"
//   upravo kad je dijagnostika potrebna.
// - Konstanta je jedini oblik koji kompajler moze traziti kao obavezno polje audit zapisa.
//
// Broj se NE mijenja rucno usred rada. Mijenja ga `npm version <broj>`: npm podigne
// `package.json`, pa hook `version` pozove `scripts/upisi-verziju.mjs` koji prepise liniju nize,
// i oboje ulazi u isti commit. Parnost sa `package.json` cuva `verzija.test.ts`.
export const VERZIJA = "0.10.0";
