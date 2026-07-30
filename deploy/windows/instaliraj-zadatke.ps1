# Instalira Task Scheduler poslove za ovaj klon na Windowsu. Ekvivalent para
# scripts/instaliraj-cron.sh + launchd sablona sa macOS-a, sa istim terminima:
#
#   sesija    cuvar klijentske Telegram sesije (scripts/cuvar-sesije.mjs), na prijavi korisnika
#   snapshot  nocni snimak pregleda, svaki dan 02:40
#   dnevno    obnove i jutarnja poruka, svaki dan 07:20
#   sedmicno  sedmicni pregled, ponedjeljkom 07:40
#
# Preduslovi: node i claude u PATH-u, .env sa OLX_TOKEN u korijenu klona.
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
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node nije u PATH-u."
}
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
  throw "claude nije u PATH-u. Cuvar sesije bez njega ne moze dici sesiju."
}
if (-not (Test-Path (Join-Path $Korijen "dist\cli\index.js"))) {
  Write-Host "Nema dist\. Pokrecem build."
  Push-Location $Korijen
  try { npm run build } finally { Pop-Location }
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

Registruj -Sufiks "sesija" -Komanda "node scripts\cuvar-sesije.mjs" `
  -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Trajni $true

# Admin bot je opcion po klonu: zadatak se registruje samo kad je runtime pripremljen
# (node scripts\pripremi-admin-runtime.mjs). Na Windowsu prije prvog starta treba i jednom
# claude login sa CLAUDE_CONFIG_DIR=.claude-runtime-admin (kredencijali zive u config diru).
if (Test-Path (Join-Path $Korijen ".claude-runtime-admin")) {
  Registruj -Sufiks "admin-bot" -Komanda "node scripts\cuvar-sesije.mjs admin-bot" `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Trajni $true
}

Registruj -Sufiks "snapshot" -Komanda "node dist\cli\index.js stats snapshot" `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 02:40)

Registruj -Sufiks "dnevno" -Komanda "node dist\cli\index.js posao dnevni" `
  -Trigger (New-ScheduledTaskTrigger -Daily -At 07:20)

Registruj -Sufiks "sedmicno" -Komanda "node dist\cli\index.js posao sedmicni" `
  -Trigger (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 07:40)

# Backup stanja u 08:10, poslije dnevnog posla, da uhvati sve sto je taj dan upisano.
# Instalira se samo kad je repo stanja podesen: inace bi posao svako jutro pao i slao alarm.
$EnvFajl = Join-Path $Korijen ".env"
if ((Test-Path $EnvFajl) -and (Select-String -Path $EnvFajl -Pattern '^OLX_STANJE_REPO=.+' -Quiet)) {
  Registruj -Sufiks "backup" -Komanda "node dist\cli\index.js posao backup" `
    -Trigger (New-ScheduledTaskTrigger -Daily -At 08:10)
} else {
  Write-Host "PRESKACEM posao backup: OLX_STANJE_REPO nije podesen u .env. Klijentsko stanje ostaje samo na ovom disku."
}

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
