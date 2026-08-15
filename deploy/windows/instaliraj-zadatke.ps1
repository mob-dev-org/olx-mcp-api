# Instalira Task Scheduler poslove za ovaj klon na Windowsu. Ekvivalent para
# scripts/instaliraj-cron.sh + launchd sablona sa macOS-a, sa istim terminima:
#
#   sesija    cuvar klijentske Telegram sesije (scripts/cuvar-sesije.mjs), na prijavi korisnika
#   admin-bot cuvar admin sesije, samo kad .claude-runtime-admin postoji (uslovni)
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

if (-not (Test-Path (Join-Path $Korijen ".env"))) {
  throw "Nema .env u $Korijen. Poslovi bi se pokretali bez tokena."
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  throw "bun nije u PATH-u. Instalacija: powershell -c `"irm bun.sh/install.ps1 | iex`""
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  throw "claude nije u PATH-u. Cuvar sesije bez njega ne moze dici sesiju."
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
    # Cuvar sesije: bez vremenskog limita, a ako sam padne, Scheduler ga vrati.
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

Registruj -Sufiks "sesija" -Komanda "bun scripts\cuvar-sesije.mjs" `
  -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Trajni $true

# Admin bot je opcion po klonu: zadatak se registruje samo kad je runtime pripremljen
# (bun scripts\pripremi-admin-runtime.mjs). Na Windowsu prije prvog starta treba i jednom
# claude login po runtime folderu ($env:CLAUDE_CONFIG_DIR=".claude-runtime-admin" pa claude
# login), jer kredencijali zive u config diru. Isto vazi i za .claude-runtime kad klijentska
# sesija ide na pretplatu (OLX_KLIJENT_AI nije deepseek).
if (Test-Path (Join-Path $Korijen ".claude-runtime-admin")) {
  Registruj -Sufiks "admin-bot" -Komanda "bun scripts\cuvar-sesije.mjs admin-bot" `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Trajni $true
}

Registruj -Sufiks "snapshot" -Komanda "bun dist\cli\index.js stats snapshot" `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 02:40)

Registruj -Sufiks "dnevno" -Komanda "bun dist\cli\index.js posao dnevni" `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 07:20)

Registruj -Sufiks "sedmicno" -Komanda "bun dist\cli\index.js posao sedmicni" `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 07:40)

# Backup stanja u 08:10, poslije dnevnog posla, da uhvati sve sto je taj dan upisano.
# Instalira se samo kad je repo stanja podesen: inace bi posao svako jutro pao i slao alarm.
$EnvFajl = Join-Path $Korijen ".env"
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
UpozoriBezLogina -Runtime ".claude-runtime-admin" -Naziv "admin bot (uvijek pretplata)"

# Sesije ne cekaju sljedecu prijavu korisnika, krecu odmah.
Start-ScheduledTask -TaskName "ba.codefactory.olx.$Ime.sesija"
if (Test-Path (Join-Path $Korijen ".claude-runtime-admin")) {
  Start-ScheduledTask -TaskName "ba.codefactory.olx.$Ime.admin-bot"
}

Write-Host ""
Write-Host "Provjera:   Get-ScheduledTask -TaskName 'ba.codefactory.olx.$Ime.*'"
Write-Host "Rucno:      Start-ScheduledTask -TaskName 'ba.codefactory.olx.$Ime.dnevno'"
Write-Host "Logovi:     $Korijen\.olx-pik\cron-*.log"
Write-Host "Uklanjanje: Get-ScheduledTask -TaskName 'ba.codefactory.olx.$Ime.*' | Unregister-ScheduledTask -Confirm:`$false"
