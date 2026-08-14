// Sve sto generator popisa zna o sistemu, na jednom mjestu i u jednom obliku.
//
// Zasto poseban modul: iz istih podataka nastaju TRI stvari (markdown u repou, samostalan HTML i
// provjera svjezine). Kad bi svaka od njih sama skupljala, razisle bi se, a upravo razilazenje je
// bolest koju popis lijeci. Sakupljanje je ovdje, oblikovanje je drugdje.

import { skupiMcp, skupiCli } from "./popis-kod.mjs";
import { skupiPostavke } from "./popis-config.mjs";
import { skupiPoslove, klijentskiBezBlizanca } from "./popis-poslovi.mjs";
import { skupiSkillove, skupiAgente } from "./popis-skillovi.mjs";
import { skupiOkruzenje } from "./popis-okruzenje.mjs";

export async function skupiSve(korijen) {
  const { alati, resursi, uslovi } = await skupiMcp(korijen);
  const cli = await skupiCli(korijen);
  const postavke = await skupiPostavke(korijen);
  const poslovi = skupiPoslove(korijen);

  return {
    alati,
    resursi,
    uslovi,
    cli,
    postavke,
    poslovi,
    poslovaBezBlizanca: klijentskiBezBlizanca(poslovi),
    skillovi: skupiSkillove(korijen),
    agenti: skupiAgente(korijen),
    okruzenje: skupiOkruzenje(korijen),
  };
}

/**
 * Imena koja rucna lista (`sta-sistem-radi.md`) mora pokriti, da nijedna sposobnost ne ostane
 * neopisana obicnim jezikom.
 *
 * Namjerno NISU sve pojedinacne CLI komande: njih je preko sedamdeset, a vecina je drugo lice iste
 * sposobnosti koju alat vec nosi. Trazi se pokrivenost onoga sto je stvarno posebna sposobnost:
 * svaki MCP alat, svaka GRUPA CLI komandi i svaki zakazani posao. Time nova podkomanda pod
 * postojecom grupom ne trazi nikakav rucni upis, a nov alat ili cijela nova grupa trazi odluku,
 * sto je i bila namjera.
 */
export function imenaZaPokrivanje(podaci) {
  return [
    ...podaci.alati.map((a) => a.ime),
    ...podaci.cli.filter((k) => k.grupa).map((k) => `cli:${k.putanja}`),
    ...podaci.poslovi.map((p) => `posao:${p.sufiks}`),
  ].sort();
}
