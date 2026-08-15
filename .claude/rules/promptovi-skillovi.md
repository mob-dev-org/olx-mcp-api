---
paths:
  - ".claude/skills/**"
  - ".claude/agents/**"
  - "runtime/**"
---

# Pravila za promptove, skillove i podagente

Ucitava se samo kad se diraju promptovi. Vazi za `runtime/SISTEM-*.md`, recepte, skillove i
podagente.

## Jedan izvor istine

- Tvrde granice zive SAMO u `olx-dokumentacija/granice.md` (ulazi u CLAUDE.md kroz `@`).
  Skillovi i prompt fajlovi ih ne prepisuju: kad se skill otvori, granice su vec u kontekstu.
- Brojevi (cijene, kvote, limiti) se ne pisu u promptove: pokazuje se na `olx://pravila-brojeva`
  i alate koji ih citaju. Broj u promptu je bug.
- `runtime/SISTEM-*.md` se cita doslovno (`--append-system-prompt-file` ne razrjesava `@`),
  pa u te fajlove ne ide nijedan `@` import.

## Higijena konteksta

- Opis skilla (description) je u kontekstu SVAKE sesije: jedna recenica namjene + okidaci,
  nista vise. Tijelo skilla se placa tek na otvaranje, tu smije biti detalja.
- Prompt promjena se mjeri: `bun run kontekst` prije i poslije, a `scripts/provjeri-prompt.sh`
  dokazuje da granice i dalje stizu u oba profila. Bez toga se prompt ne mijenja.
- Za posao preko mnogo oglasa: podagenti iz `.claude/agents/` (obrazac u skillu
  `olx-serijski-posao`), ne jedan dugacak razgovor. Podagent vraca par redova, ne payload.

## Tekst prema klijentu

- Sve sto klijent moze procitati (SISTEM-klijent, recepti ciji izlaz ide u njegovu grupu,
  fajlovi prijedloga): bez imena alata, fajlova, tehnickih pojmova; latinica, bosanski, bez
  emojija; kratko. Pravila iz SISTEM-klijent.md su granica i za te tekstove.
- Prompt nikad ne obecava ono sto platforma ne moze (pozicija u pretrazi, poruke kupcima,
  statistika po danu): lista je u granice.md, sekcija "Sta platforma ne moze".
