# Povlaci tag `stabilno` u sve klijentske klonove na ovoj Windows masini, gradi, testira i
# restartuje njihove dugozive poslove. Windows blizanac scripts/azuriraj-sve.sh (macOS/Linux).
#
# Zasto tag a ne grana main: los commit fizicki ne moze doci do klijenata dok ga ne propustis.
# Radis na main, testiras na svom klonu, pa pomjeris tag:
#   git tag -f stabilno && git push -f origin stabilno
#
# Zasto se klon preskace umjesto da se popravlja: klijent na staroj radnoj verziji je bolji od
# klijenta na polovicno azuriranoj. Ako build ili testovi padnu, zadaci tog klona se NE diraju.
#
# Popis klonova: %USERPROFILE%\.olx-klijenti.txt, jedna putanja po liniji, prazne linije i # se
# ignorisu. Drugi popis se moze dati kroz OLX_KLIJENTI_POPIS.
#
# Pokretanje:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\azuriraj.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\windows\azuriraj.ps1 -Suho

param([switch]$Suho)

# Bez Stop: skripta sama vodi greske po klonu, da pad jednog klona ne prekine ostale.
$ErrorActionPreference = "Continue"

$Popis = if ($env:OLX_KLIJENTI_POPIS) { $env:OLX_KLIJENTI_POPIS } else { Join-Path $env:USERPROFILE ".olx-klijenti.txt" }

if (-not (Test-Path $Popis)) {
  Write-Error "Nema popisa klonova: $Popis"
  Write-Host "Napravi ga, jedna putanja po liniji. Primjer:"
  Write-Host "  Add-Content -Path `"$Popis`" -Value 'C:\olx-klijenti\mixbox'"
  exit 1
}

# Pokrene komandu u folderu klona i vrati $true samo kad je izlazni kod 0.
function Pokreni([string]$Folder, [string]$Program, [string[]]$Argumenti) {
  Push-Location $Folder
  try {
    & $Program @Argumenti *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  } finally {
    Pop-Location
  }
}

$uspjeli = @()
$pali = @()

foreach ($linija in Get-Content $Popis) {
  $klon = ($linija -split "#")[0].Trim()
  if ($klon -eq "") { continue }

  Write-Host "=== $klon ==="

  if (-not (Test-Path (Join-Path $klon ".git"))) {
    $pali += "${klon}: nije git klon"
    Write-Host "  nije git klon, preskacem"
    continue
  }

  if ($Suho) {
    $trenutni = (& git -C $klon rev-parse --short HEAD 2>$null)
    if (-not $trenutni) { $trenutni = "nepoznat" }
    Write-Host "  proba: trenutno na $trenutni, ne diram nista"
    $uspjeli += "$klon (proba)"
    continue
  }

  # Lokalne izmjene u klijentskom klonu su znak da je neko rucno petljao. Bolje stati nego
  # pregaziti to sto je neko namjerno promijenio.
  $izmjene = (& git -C $klon status --porcelain --untracked-files=no 2>$null)
  if ($izmjene) {
    $pali += "${klon}: ima lokalne izmjene, ne diram"
    Write-Host "  ima lokalne izmjene, preskacem"
    continue
  }

  $greska = ""
  & git -C $klon fetch --tags --quiet origin 2>$null
  if ($LASTEXITCODE -ne 0) { $greska = "fetch" }
  if ($greska -eq "") {
    & git -C $klon checkout --detach --quiet stabilno 2>$null
    if ($LASTEXITCODE -ne 0) { $greska = "checkout tag stabilno" }
  }
  if ($greska -eq "" -and -not (Pokreni $klon "npm" @("ci", "--silent"))) { $greska = "npm ci" }
  if ($greska -eq "" -and -not (Pokreni $klon "npm" @("run", "build", "--silent"))) { $greska = "build" }
  if ($greska -eq "" -and -not (Pokreni $klon "npm" @("test", "--silent"))) { $greska = "testovi" }

  # Testovi pisu probni audit u radni folder; ne smije ostati u klijentovom .olx-pik.
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $klon ".olx-pik\test-audit.jsonl")

  if ($greska -ne "") {
    $pali += "${klon}: $greska"
    Write-Host "  PALO na koraku: $greska. Zadaci ovog klona nisu dirani."
    continue
  }

  # Tek sada, kad je sve proslo, restart DUGOZIVIH poslova (sesija, admin-bot): oni jedini drze
  # stari kod i stari prompt u memoriji. Kalendarski zadaci (snapshot/dnevno/sedmicno) se NE
  # diraju: Start-ScheduledTask bi ih IZVRSIO odmah, pa bi klijent dobio jutarnji izvjestaj
  # usred dana i potrosila bi se dnevna runda obnova van reda. Oni novi kod ionako uzmu na
  # sljedecem zakazanom terminu, jer su jednokratni node procesi.
  $ime = Split-Path $klon -Leaf
  foreach ($posao in @("sesija", "admin-bot")) {
    $oznaka = "ba.codefactory.olx.$ime.$posao"
    if (Get-ScheduledTask -TaskName $oznaka -ErrorAction SilentlyContinue) {
      Stop-ScheduledTask -TaskName $oznaka -ErrorAction SilentlyContinue
      Start-ScheduledTask -TaskName $oznaka -ErrorAction SilentlyContinue
      Write-Host "  restartovan posao: $posao"
    }
  }

  $verzija = (& git -C $klon rev-parse --short HEAD 2>$null)
  $uspjeli += "$klon @ $verzija"
  Write-Host "  ok"
}

Write-Host ""
Write-Host "=== zbir ==="
Write-Host "Proslo: $($uspjeli.Count)"
foreach ($u in $uspjeli) { Write-Host "  $u" }
if ($pali.Count -gt 0) {
  Write-Host "Palo: $($pali.Count)"
  foreach ($p in $pali) { Write-Host "  $p" }
}

# Izvjestaj administratoru. Klijenti ovo ne vide.
if ($env:TELEGRAM_BOT_TOKEN -and $env:TELEGRAM_ADMIN_CHAT_ID -and -not $Suho) {
  $poruka = "Azuriranje flote (Windows): proslo $($uspjeli.Count), palo $($pali.Count)"
  foreach ($p in $pali) { $poruka += "`n$p" }
  try {
    Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/sendMessage" `
      -Body @{ chat_id = $env:TELEGRAM_ADMIN_CHAT_ID; text = $poruka } | Out-Null
  } catch {
    Write-Host "  admin poruka nije prosla: $($_.Exception.Message)"
  }
}

if ($pali.Count -gt 0) { exit 1 }
exit 0
