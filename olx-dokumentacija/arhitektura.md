# Arhitektura sistema

Mapa cijelog sistema na jednom mjestu: sta postoji, ko s kim prica, sta radi samo a sta se
pokrece rucno. Dijagrami su mermaid, render ih GitHub, Claude i vecina editora.

Kljucna ideja sistema u jednoj recenici: **sve sto se moze izracunati radi kod bez AI-ja i
kosta nula tokena; AI se poziva samo tamo gdje treba razumijevanje ili prosudba.**

## 1. Velika slika

Jedan klon repoa po klijentu, sve na admin masini. Po klonu DVIJE stalne sesije (klijentska i
admin bot), plus cron poslovi bez modela i sedmicna AI runda.

```mermaid
flowchart LR
    vlasnik["Vlasnik shopa"] <-->|"poruke i slike"| tg["Telegram grupa klijenta"]
    admin["Administrator"] <-->|"mention ili reply"| atg["Admin Telegram grupa ili DM<br/>botovi svih klonova, privacy ukljucen"]

    subgraph klon["Klon repoa za JEDNOG klijenta"]
        sesija["Klijentska Claude sesija<br/>SISTEM-klijent.md, profil klijent<br/>pogon: OLX_KLIJENT_AI iz .env<br/>(pretplata dok se testira, kasnije DeepSeek)"]
        asesija["Admin bot sesija (opcion)<br/>SISTEM-admin-bot.md, profil admin<br/>uvijek pretplata, bez Bash-a"]
        mcp["MCP server<br/>klijent 32 / admin 45 alata<br/>zastite u kodu: potvrda troska,<br/>dnevni plafon, nema brisanja"]
        cron["Cron poslovi BEZ modela<br/>CLI: snapshot, dnevni, sedmicni<br/>nula tokena"]
        disk[("Disk klona<br/>.olx-pik: audit, snapshoti, prijedlozi<br/>.claude-runtime i .claude-runtime-admin")]
    end

    cuvar["Cuvar sesija<br/>cuvar-sesije.mjs klijent i admin-bot"] -.->|"drzi zive, nocni restart 03h,<br/>idle restart: klijent 2h, admin 1h"| sesija
    cuvar -.-> asesija

    tg <--> sesija
    atg <--> asesija
    sesija --> mcp
    asesija --> mcp
    cron -->|"jutarnja 07:20 i<br/>sedmicna poruka pon 07:40"| tg
    cron --> disk
    mcp --> olx["OLX / PIK API"]
    cron --> olx

    runda["AI runda, nedjelja 21h<br/>admin Claude pretplata<br/>STROGO read-only"] -->|"analiza u grupu,<br/>prijedlozi na disk"| tg
    runda --> disk
    runda --> mcp
```

Granice pogona:

- Klijentsku sesiju pogoni ono sto kaze `OLX_KLIJENT_AI` u `.env` klona: `pretplata` dok prvih
  klijenata testira, kasnije `deepseek` (bez popunjenih OLX_DEEPSEEK_* varijabli sesija se ne
  pokrece). Nista se ne konfigurise globalno po masini, sve je u repou i `.env`.
- Admin bot i AI runda su iskljucivo vlasnikov kanal i uvijek idu na pretplatu. Klijent sa
  pretplatom nikad ne razgovara direktno.
- Admin botovi vise klonova zive u jednoj admin grupi: privacy u BotFatheru im OSTAJE ukljucen,
  pa svaki prima samo poruke u kojima je oznacen i odgovore na svoje poruke. Kontekst botova se
  ne mijesa, a reply radi kao obracanje.

## 2. Sta se desava kad klijent posalje poruku

```mermaid
sequenceDiagram
    participant V as Vlasnik shopa
    participant T as Telegram bot
    participant S as Claude sesija
    participant M as MCP server
    participant O as OLX API

    V->>T: "Stavi Golfa na 14.900"
    T->>S: poruka (slika ide na disk, u inbox)
    S->>M: nadji moj oglas "Golf"
    M->>O: citanje oglasa
    O-->>M: podaci
    M-->>S: kompaktan rezultat
    Note over S: besplatna izmjena: radi odmah.<br/>Trosak kredita: prvo cijena, pa pitanje.
    S->>M: izmjena cijene
    M->>O: upis
    M->>M: zapis u audit log
    S-->>T: "Golf je sada na 14.900 KM."
    T-->>V: odgovor
```

Za trosak kredita (izdvajanje, akcija, naplatna objava) alat u kodu ODBIJA izvrsenje bez
`confirm`; prompt trazi da se klijentu prvo kaze cijena. Dvije nezavisne brane.

## 3. Automatski poslovi: ko, kad i sta

Nista od ovoga ne poziva model osim AI runde. Termini su razmaknuti namjerno.

```mermaid
flowchart TB
    subgraph dan["Svaki dan"]
        s1["02:40 snapshot<br/>snimi preglede svih oglasa u fajl<br/>bez ovoga nema trendova"]
        s2["03:00 nocni restart sesije<br/>kontekst na nulu, ciscenje inboxa<br/>radi cuvar-sesije.mjs"]
        s3["07:20 dnevni posao<br/>obnove unutar besplatne kvote<br/>pa jutarnja poruka u grupu"]
    end
    subgraph sedmica["Sedmicno"]
        s4["ponedjeljak 07:40<br/>sedmicni pregled u grupu:<br/>sta raste, sta miruje"]
        s5["nedjelja 21:00 AI runda<br/>analiza + prijedlozi po klijentu<br/>admin pretplata, read-only"]
    end
    subgraph stalno["Stalno"]
        s6["cuvar klijentske sesije<br/>pao bot: digni ga<br/>5 brzih padova: javi adminu<br/>2h mirovanja: ocisti kontekst"]
        s7["cuvar admin bot sesije (opcion)<br/>ista mehanika, idle prag 1h<br/>jer se kontekst cisti cesce"]
    end

    s1 --> s3
    s1 --> s4
    s1 --> s5
```

Zakazivanje: macOS launchd (instalira `scripts/instaliraj-cron.sh`, po klonu), Windows Task
Scheduler (`deploy/windows/instaliraj-zadatke.ps1`). AI runda je izuzetak: jedan globalni posao
na admin masini (`deploy/launchd/ba.codefactory.olx.ADMIN.ai-runda.plist`, instalira se rucno
jednom), jer sama obilazi sve klonove.

## 4. AI runda i primjena prijedloga

```mermaid
sequenceDiagram
    participant L as launchd nedjelja 21h
    participant R as ai-runda.sh
    participant H as headless Claude sesija
    participant D as disk klona
    participant T as Telegram grupa
    participant V as Vlasnik shopa
    participant B as klijentski bot

    L->>R: pokreni rundu
    loop za svaki klon iz ~/.olx-klijenti.txt
        R->>H: claude -p sa receptom ai-runda.md<br/>mutirajuci alati ISKLJUCENI
        H->>H: analiza profila, SEO, trijaza,<br/>konkurenti (podagenti)
        H->>D: prijedlozi u .olx-pik/prijedlozi/
        H-->>R: gotova poruka za klijenta
        R->>T: posalji kroz bot tog klona
    end
    R->>R: zbir adminu u DM
    V->>B: "primijeni prijedloge"
    B->>D: procitaj najnoviji fajl prijedloga
    B->>V: pobroji stavke, trazi potvrdu po grupi
    V->>B: "moze"
    B->>B: primijeni postojecim alatima,<br/>trosak i dalje trazi cijenu pa potvrdu
```

Ako runda naleti na limit pretplate, prekida se odmah i javlja adminu, da ostali klijenti ne
dobiju polovicne analize.

## 5. Sta je automatski, a sta rucno

| Automatski, ne diras | Rucno, admin |
| --- | --- |
| dnevne obnove i jutarnja poruka | onboarding novog klijenta (lista ispod) |
| nocni snapshot pregleda | `azuriraj-sve.sh` kad izadje nova verzija |
| sedmicni pregled ponedjeljkom | `ai-runda.sh` dok se ne instalira plist |
| cuvari obje sesije: padovi, restarti, inbox | `provjeri-prompt.sh` poslije izmjene promptova |
| AI runda kad se plist instalira | serijski poslovi po zelji (SEO prolaz, ciscenje) |
| audit log svake izmjene i troska | pravo brisanje oglasa (`listings rm`) |
| admin bot: nadzor i rad preko Telegrama | priprema admin runtime-a (jednom po klonu) |
| biljezenje tokena u transkriptima sesija | `npm run tokeni -- --upisi` sedmicno (trajni dnevnik) |

## 6. Onboarding novog klijenta (rucni koraci, redom)

**Izvrsna verzija ove liste je skill `olx-novi-klijent`**: otvori Claude Code i reci
"postavi novog klijenta", sesija vodi kroz sve korake i sama izvrsava sto moze. Lista ispod
je referenca istog redoslijeda. Na kraju UVIJEK `node scripts/provjeri-klon.mjs`: dok ijedna
stavka FALI, sa klijentom se ne pocinje.

1. Kloniraj repo u novi folder (jedan klon = jedan nalog), pa `git checkout --detach stabilno`.
2. `.env`: `OLX_TOKEN`, `OLX_MCP_PROFILE=klijent`, `OLX_MAX_SPEND_PER_DAY`, Telegram varijable.
3. BotFather: novi bot, pa `/setprivacy` na Disable.
4. `scripts/pripremi-runtime.sh <bot_token> <id_grupe> <telegram_id>` — pravi izolovani
   runtime (svoj bot, svoj allowlist, bez globalnih servera).
5. `npm ci && npm run build && npm test`.
6. `scripts/instaliraj-cron.sh` (macOS) ili `deploy/windows/instaliraj-zadatke.ps1` (Windows):
   instalira sva 4 posla, ukljucujuci cuvara koji odmah digne sesiju.
7. Dodaj putanju klona u `~/.olx-klijenti.txt` (azuriranja i AI runda).
8. Test iz grupe: pitanje, objava sa slikom, i jedan trosak da se vidi tok potvrde.
9. Opcion, admin bot: novi bot u BotFatheru (privacy NE dirati, ostaje ukljucen), pa
   `node scripts/pripremi-admin-runtime.mjs <bot_token> <tvoj_id> [id_admin_grupe]`, pa ponovo
   instalater poslova iz koraka 6. Na Windowsu jos i jedan `claude login` sa
   `CLAUDE_CONFIG_DIR=.claude-runtime-admin` (na macOS-u ne treba, pretplata je u Keychainu).
