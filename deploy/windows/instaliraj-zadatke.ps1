# Instalira Task Scheduler poslove za ovaj klon na Windowsu. Ekvivalent para
# scripts/instaliraj-cron.sh + launchd sablona sa macOS-a, sa istim terminima:
#
#   sesija    klijentski Telegram most (scripts/telegram-most.mjs), na prijavi korisnika,
#             samo kad je TELEGRAM_BOT_TOKEN popunjen u .env (uslovni)
#   admin-bot most u admin ulozi (scripts/telegram-most.mjs admin-bot), kao ODVOJEN zadatak, samo
#             kad .claude-runtime-admin postoji I jednobotni rezim NIJE ukljucen (uslovni; vidi
#             $AdminBotSpreman nize). U jednobotnom rezimu (OLX_MOST_ADMIN_TG_ID popunjen u .env)
#             admin poruke vozi ISTI proces kao zadatak "sesija", rutiranjem po poruci
#   snapshot  nocni snimak pregleda, svaki dan 02:40
#   dnevno    obnove i jutarnja poruka, svaki dan 07:20
#   sedmicno  sedmicni pregled, ponedjeljkom 07:40
#   backup    backup stanja 08:10, samo kad je OLX_STANJE_REPO podesen (uslovni)
#
# Preduslovi: bun i claude u PATH-u, .env sa OLX_TOKEN u korijenu klona.
#
# Zadaci se registruju za prijavljenog korisnika i rade dok je korisnik prijavljen (bez
# snimanja lozinke). StartWhenAvailable nadoknadjuje preskocen termin kad se racunar probudi,
# sto je ista uloga koju na macOS-u ima StartCalendarInterval.
#
# Pokretanje iz korijena klona:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\instaliraj-zadatke.ps1 [ime_klijenta]
# Bez argumenta se uzima ime foldera klona.

param([string]$Ime = "")

$ErrorActionPreference = "Stop"

$Korijen = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if ($Ime -eq "") { $Ime = Split-Path $Korijen -Leaf }

# Definisano ovdje (a ne dolje kod backup dijela) jer ga koristi i uslov za posao sesija
# odmah ispod.
$EnvFajl = Join-Path $Korijen ".env"

if (-not (Test-Path $EnvFajl)) {
  throw "Nema .env u $Korijen. Poslovi bi se pokretali bez tokena."
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  throw "bun nije u PATH-u. Instalacija: powershell -c `"irm bun.sh/install.ps1 | iex`""
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  throw "claude nije u PATH-u. Most bez njega ne moze dici sesiju."
}
if (-not (Test-Path (Join-Path $Korijen "dist\cli\index.js"))) {
  Write-Host "Nema dist\. Pokrecem build."
  Push-Location $Korijen
  try { bun run build } finally { Pop-Location }
}
New-Item -ItemType Directory -Force -Path (Join-Path $Korijen ".olx-pik") | Out-Null

function Registruj {
  param(
    [string]$Sufiks,
    [string]$Komanda,
    $Trigger,
    [bool]$Trajni = $false
  )

  $ImeZadatka = "ba.codefactory.olx.$Ime.$Sufiks"
  $Log = Join-Path $Korijen ".olx-pik\cron-$Sufiks.log"

  # cmd /c zbog preusmjeravanja izlaza u log; Task Scheduler sam ne pise logove.
  $Akcija = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c $Komanda >> `"$Log`" 2>&1" `
    -WorkingDirectory $Korijen

  # AllowStartIfOnBatteries + DontStop: Scheduler po defaultu NE pokrece zadatke na bateriji
  # i gasi ih kad se laptop iskljuci iz struje. Bez ovoga bi na laptopu nocni snapshot i
  # jutarnje obnove tiho preskakali, a bot sesija umirala cim se izvuce kabal.
  if ($Trajni) {
    # Most (trajni zadatak): bez vremenskog limita, a ako sam padne, Scheduler ga vrati.
    $Postavke = New-ScheduledTaskSettingsSet -StartWhenAvailable `
      -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
      -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
  } else {
    $Postavke = New-ScheduledTaskSettingsSet -StartWhenAvailable `
      -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  }

  Unregister-ScheduledTask -TaskName $ImeZadatka -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName $ImeZadatka -Action $Akcija -Trigger $Trigger -Settings $Postavke | Out-Null
  Write-Host "Instaliran: $ImeZadatka"
}

# Zadatak sesija (klijentski most) se registruje samo kad je runtime pripremljen I token
# dostupan: most bez .claude-runtime (nema access.json) ili bez ijednog bot tokena odmah izlazi
# kodom 2, pa bi Scheduler vrtio pad u nedogled (RestartCount 10).
#
# Token se prihvata iz OBA izvora, istim redom kojim ga most trazi: prvo .env klona, pa
# .claude-runtime\channels\telegram\.env. Samo .env NIJE dovoljan uslov, jer ga
# pripremi-runtime.mjs uopste ne pise: on token upisuje samo u runtime. Klon koji zivi na
# runtime tokenu bi sa provjerom nad samim .env tiho ostao bez zadatka sesija.
$TokenRuntime = Join-Path $Korijen ".claude-runtime\channels\telegram\.env"
$ImaToken = (Select-String -Path $EnvFajl -Pattern '^TELEGRAM_BOT_TOKEN=.+' -Quiet) -or
  ((Test-Path $TokenRuntime) -and (Select-String -Path $TokenRuntime -Pattern '^TELEGRAM_BOT_TOKEN=.+' -Quiet))
$SesijaSpremna = (Test-Path (Join-Path $Korijen ".claude-runtime")) -and $ImaToken
if ($SesijaSpremna) {
  Registruj -Sufiks "sesija" -Komanda "bun scripts\telegram-most.mjs" `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Trajni $true
} else {
  Write-Host "PRESKACEM zadatak sesija: nema .claude-runtime ili TELEGRAM_BOT_TOKEN nije popunjen ni u .env ni u .claude-runtime\channels\telegram\.env. Popravka: bun scripts\pripremi-runtime.mjs <bot_token> <id_grupe> <telegram_id>."
  # Preskocen zadatak NE smije ostaviti staru definiciju registrovanu: ona i dalje pokrece
  # komandu iz vremena registracije (do 0.18 cuvar-sesije.mjs, koji vise ne postoji), pa bi klon
  # vrtio pad umjesto da tiho nema bota. Bez efekta kad zadatak nikad nije ni registrovan.
  Unregister-ScheduledTask -TaskName "ba.codefactory.olx.$Ime.sesija" -Confirm:$false -ErrorAction SilentlyContinue
}

# Admin bot je opcion po klonu, i to na DVA nezavisna uslova koji se lako mijesaju:
#
# $AdminRuntimePostoji: samo Test-Path. .claude-runtime-admin postoji u OBA rezima (nosi
# CLAUDE_CONFIG_DIR, prompt i MCP profil admin sesije), pa kredencijali pretplate u njemu trebaju
# `claude login` bez obzira da li je jednobotni rezim ukljucen. Koristi ga SAMO UpozoriBezLogina
# nize, ne odlucuje da li se ODVOJEN zadatak admin-bot registruje.
#
# $AdminBotSpreman: runtime postoji I jednobotni rezim NIJE ukljucen (OLX_MOST_ADMIN_TG_ID nije
# popunjen u .env; prazna vrijednost kao OLX_MOST_ADMIN_TG_ID=, kakvu isporucuje .env.example,
# znaci NIJE popunjena, isto kao odsutna varijabla). Samo ovaj uslov registruje i pokrece ODVOJEN
# zadatak admin-bot: u jednobotnom rezimu admin poruke vozi ISTI proces kao zadatak "sesija"
# (rutiranje po poruci u scripts/telegram-most.mjs), a dva getUpdates konzumera na istom bot
# tokenu daju 409 Conflict, pa admin-bot mora ostati neregistrovan dok god je rezim ukljucen.
$AdminRuntimePostoji = Test-Path (Join-Path $Korijen ".claude-runtime-admin")
$ImaJednobotniId = (Test-Path $EnvFajl) -and (Select-String -Path $EnvFajl -Pattern '^OLX_MOST_ADMIN_TG_ID=.+' -Quiet)
$AdminBotSpreman = $AdminRuntimePostoji -and -not $ImaJednobotniId

if ($AdminBotSpreman) {
  Registruj -Sufiks "admin-bot" -Komanda "bun scripts\telegram-most.mjs admin-bot" `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Trajni $true
} else {
  # Isti razlog kao kod zadatka sesija: preskakanje ne smije ostaviti staru definiciju zivu. Ovo
  # takodje uklanja zaostao admin-bot zadatak ako se jednobotni rezim naknadno ukljuci na klonu
  # koji ga je ranije imao registrovanog.
  Unregister-ScheduledTask -TaskName "ba.codefactory.olx.$Ime.admin-bot" -Confirm:$false -ErrorAction SilentlyContinue
}

Registruj -Sufiks "snapshot" -Komanda "bun dist\cli\index.js stats snapshot" `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 02:40)

Registruj -Sufiks "dnevno" -Komanda "bun dist\cli\index.js posao dnevni" `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 07:20)

Registruj -Sufiks "sedmicno" -Komanda "bun dist\cli\index.js posao sedmicni" `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 07:40)

# Backup stanja u 08:10, poslije dnevnog posla, da uhvati sve sto je taj dan upisano.
# Instalira se samo kad je repo stanja podesen: inace bi posao svako jutro pao i slao alarm.
if ((Test-Path $EnvFajl) -and (Select-String -Path $EnvFajl -Pattern '^OLX_STANJE_REPO=.+' -Quiet)) {
  Registruj -Sufiks "backup" -Komanda "bun dist\cli\index.js posao backup" `
    -Trigger (New-ScheduledTaskTrigger -Daily -At 08:10)
} else {
  Write-Host "PRESKACEM posao backup: OLX_STANJE_REPO nije podesen u .env. Klijentsko stanje ostaje samo na ovom disku."
}

# Kredencijali pretplate zive u config diru runtime foldera; bez logina sesija na pretplati
# pada u krug (RestartCount 10) bez vidljive greske. Samo upozorenje: trag prijave je
# .credentials.json, a ime fajla nije nas ugovor pa odsustvo ne prekida instalaciju.
function UpozoriBezLogina {
  param([string]$Runtime, [string]$Naziv)
  if ((Test-Path (Join-Path $Korijen $Runtime)) -and -not (Test-Path (Join-Path $Korijen "$Runtime\.credentials.json"))) {
    Write-Host "UPOZORENJE: u $Runtime nema traga prijave. Ako $Naziv ide na pretplatu, uradi jednom:"
    Write-Host "            `$env:CLAUDE_CONFIG_DIR=`"$Runtime`" pa claude login"
  }
}
$KlijentAi = ""
if (Test-Path $EnvFajl) {
  $Red = Select-String -Path $EnvFajl -Pattern '^OLX_KLIJENT_AI=(.*)$' | Select-Object -Last 1
  if ($Red) { $KlijentAi = $Red.Matches[0].Groups[1].Value.Trim().ToLower() }
}
if ($KlijentAi -ne "deepseek") { UpozoriBezLogina -Runtime ".claude-runtime" -Naziv "klijentska sesija" }
# $AdminRuntimePostoji (ne $AdminBotSpreman): login u ovom config diru treba se god runtime
# postoji, bez obzira na rezim: admin sesija se stvarno pokrece i u jednobotnom rezimu, samo kroz
# zadatak "sesija" umjesto kroz odvojen "admin-bot", pa upozorenje ne smije zavisiti od toga je li
# odvojen zadatak registrovan.
if ($AdminRuntimePostoji) { UpozoriBezLogina -Runtime ".claude-runtime-admin" -Naziv "admin bot (uvijek pretplata)" }

# Sesije ne cekaju sljedecu prijavu korisnika, krecu odmah. Samo za zadatke koji su stvarno
# registrovani gore, inace Start-ScheduledTask pada na nepostojecem zadatku.
if ($SesijaSpremna) {
  Start-ScheduledTask -TaskName "ba.codefactory.olx.$Ime.sesija"
}
if ($AdminBotSpreman) {
  Start-ScheduledTask -TaskName "ba.codefactory.olx.$Ime.admin-bot"
}

Write-Host ""
Write-Host "Provjera:   Get-ScheduledTask -TaskName 'ba.codefactory.olx.$Ime.*'"
Write-Host "Rucno:      Start-ScheduledTask -TaskName 'ba.codefactory.olx.$Ime.dnevno'"
Write-Host "Logovi:     $Korijen\.olx-pik\cron-*.log"
Write-Host "Uklanjanje: Get-ScheduledTask -TaskName 'ba.codefactory.olx.$Ime.*' | Unregister-ScheduledTask -Confirm:`$false"
