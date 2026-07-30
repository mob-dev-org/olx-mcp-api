# Oporavak klijenta na novoj masini

Kad disk strada, kad se klijent seli na drugu masinu, ili kad klon treba podici ispocetka.

Ovo je postavka novog klona sa jednim dodatnim korakom umetnutim prije zakazivanja poslova.
Redoslijed nije proizvoljan: vracanje stanja mora doci POSLIJE pripreme runtimea, jer
`access.json` ide preko onoga koji `pripremi-runtime.mjs` sam generise.

## Sta backup ima, a sta nema

Backup drzi ono sto se akumulira i sto se ne moze ponovo napraviti:

- pamcenje bota o klijentu, spisak izuzetaka
- audit trag i potrosnja
- snapshoti pregleda, koji su **nezamjenjivi retroaktivno**: OLX ne daje istorijske preglede, pa
  vremenska serija postoji samo u tim fajlovima
- snimci konkurenata, prijedlozi rundi, saznanja iz prakse
- `KLIJENT.md`, `KLIJENT-javno.md`, i `access.json` (ko smije pisati botu)

Backup NEMA nijedan token, namjerno. Svi se unose rucno, i svi su obnovljivi.

## Redoslijed

1. **Klon koda.** `git clone <url> ~/olx-klijenti/<ime>`, pa `git checkout --detach stabilno`.
   Tag, ne grana: klijenti nikad ne prate granu.

2. **`.env` u cijelosti.** Ovo je najveci rucni dio, jer git ovo namjerno nema:
   - `OLX_TOKEN` — generise se ponovo na OLX-u
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_ADMIN_CHAT_ID` — token od BotFathera
   - `OLX_MCP_PROFILE=klijent`, `OLX_MAX_SPEND_PER_DAY`
   - `OLX_KLIJENT`, `OLX_STANJE_REPO`, `OLX_STANJE_TOKEN` — bez njih nema ni novog backupa
   - `OLX_DEEPSEEK_*` ako klon vozi DeepSeek, `OLX_SLIKA_API_KEY` ako se generisu slike

3. **Build.** `npm ci && npm run build`.

4. **Telegram runtime.** `node scripts/pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>`,
   pa `pripremi-admin-runtime.mjs` ako klon ima admin bota. Na Windowsu i Linuxu jos i
   `claude login` sa `CLAUDE_CONFIG_DIR` po runtime folderu, jer kredencijali zive u config diru
   i ne mogu se prenijeti.

5. **Vracanje stanja.** Tek sada, kad runtime folderi postoje:

   ```
   node dist/cli/index.js posao backup --vrati --potvrdi
   ```

   Bez `--potvrdi` se odbija, jer vracanje u pogresan folder gazi dan rada. Postojeci fajlovi se
   NE prepisuju osim uz `--pregazi`.

6. **Zakazani poslovi.** `scripts/instaliraj-cron.sh` ili
   `deploy\windows\instaliraj-zadatke.ps1`. Posao `backup` se instalira samo kad je
   `OLX_STANJE_REPO` popunjen, pa provjeri da jeste prije ovog koraka.

7. **Popis flote.** Upisi putanju klona u `~/.olx-klijenti.txt`. Taj fajl zivi na masini, ne u
   klonu, i nijedan backup po klijentu ga ne pokriva. Ako masina strada, gubi se spisak flote.

8. **Provjera.** `node scripts/provjeri-klon.mjs` mora biti bez FALI, pa
   `node dist/cli/index.js posao backup --samo-provjeri` mora javiti nula razlika.

## Prvi backup za novog klijenta

Repo stanja se pravi jednom, rucno, na admin masini:

```
gh repo create <org>/olx-stanje --private
```

Grana klijenta se ne pravi rucno: prvi `posao backup` je sam napravi i posalje. Radna kopija je
van klona, u `~/olx-stanje/<grana>`, i sama se dovodi u red ako je nema ili je pokvarena.

## Kad backup kasni

`scripts/backup-nadzor.sh` na admin masini obilazi sve klonove i javlja svaki ciji je zadnji upis
stariji od tri dana. Pita daljinski repo, ne lokalni log, jer neinstaliran posao, ugasena masina
i istekao token lokalno izgledaju isto.

## Kad se javi sudar

Poruka "razilazenje na grani" znaci da su dvije masine pisale istu granu. Backup u tom slucaju
NE spaja i NE forsira, nego stanje spasi na `<grana>-sudar-<masina>-<datum>` i javi. Nista nije
izgubljeno. Rijesi tako sto ugasis poslove na masini koja vise ne vodi tog klijenta, pa rucno
odlucis koja verzija ostaje.
