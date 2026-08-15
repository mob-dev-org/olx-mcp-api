# Povlaci tag `stabilno` u sve klijentske klonove na ovoj Windows masini, gradi, testira i
# restartuje njihove dugozive poslove. Windows blizanac scripts/azuriraj-sve.sh (macOS/Linux).
#
# Zasto tag a ne grana main: los commit fizicki ne moze doci do klijenata dok ga ne propustis.
# Dva taga rade zajedno: `vX.Y.Z` je nepomican dokaz sta je izdanje, `stabilno` je prekidac koji
# kaze koje izdanje flota vozi. Procedura izdanja i vracanja: olx-dokumentacija/arhitektura.md
# sekcija 7. Vracanje je pomjeranje `stabilno` na prethodni `v` tag pa ponovo ova skripta.
#
# Fetch tagova IDE SA --force i to nije kozmetika: `git fetch --tags` bez toga odbija pomjeriti
# tag koji lokalno vec postoji ("would clobber existing tag"), pa bi klon ostao na starom
# commitu, a checkout, build i testovi bi prosli i skripta bi prijavila uspjeh. Tiho
# neazuriranje flote je najgori moguci ishod ove skripte (izmjereno 30.07.2026).
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
#   powershell -ExecutionPolicy Bypass -File deploy\windows\azuriraj.ps1 -Tag v0.3.0

# -Tag: ime taga stoji na jednom mjestu, jer se inace ova skripta i bash blizanac raziduju.
param([switch]$Suho, [string]$Tag = $(if ($env:OLX_TAG) { $env:OLX_TAG } else { "stabilno" }))

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
# Izdanja na koja su klonovi stvarno dosli. Sluzi da admin poruka moze reci "flota na v0.4.0"
# umjesto samo broja, jer je razilazenje izdanja unutar flote znak da nesto nije proslo.
$izdanja = @()

# Ime izdanja klona: anotiran `v` tag ako HEAD stoji na njemu, inace kratki sha. `--always` je
# tu da funkcija nikad ne vrati prazno, jer plitak klon ili klon bez `v` tagova nije greska.
function IzdanjeKlona([string]$Folder) {
  $ime = (& git -C $Folder describe --tags --always 2>$null)
  if (-not $ime) { return "nepoznato" }
  return $ime
}

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
    $trenutni = IzdanjeKlona $klon
    Write-Host "  proba: trenutno na $trenutni, ne diram nista"
    $uspjeli += "$klon (proba, $trenutni)"
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
  # --force: vidi napomenu u zaglavlju. Bez toga pomicni tag ostaje na starom commitu.
  & git -C $klon fetch --tags --force --quiet origin 2>$null
  if ($LASTEXITCODE -ne 0) { $greska = "fetch" }
  if ($greska -eq "") {
    & git -C $klon checkout --detach --quiet $Tag 2>$null
    if ($LASTEXITCODE -ne 0) { $greska = "checkout tag $Tag" }
  }
  if ($greska -eq "" -and -not (Pokreni $klon "bun" @("install", "--frozen-lockfile"))) { $greska = "bun install" }
  if ($greska -eq "" -and -not (Pokreni $klon "bun" @("run", "build"))) { $greska = "build" }
  # `bun run test` (skript), NE goli `bun test`: bun test je Bunov vlastiti test runner koji
  # zaobilazi scripts/testovi.mjs i njegovo pojedinacno-po-fajlu pokretanje (vidi napomenu tamo).
  if ($greska -eq "" -and -not (Pokreni $klon "bun" @("run", "test"))) { $greska = "testovi" }

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
  # sljedecem zakazanom terminu, jer su jednokratni bun procesi.
  $ime = Split-Path $klon -Leaf
  foreach ($posao in @("sesija", "admin-bot")) {
    $oznaka = "ba.codefactory.olx.$ime.$posao"
    if (Get-ScheduledTask -TaskName $oznaka -ErrorAction SilentlyContinue) {
      Stop-ScheduledTask -TaskName $oznaka -ErrorAction SilentlyContinue
      Start-ScheduledTask -TaskName $oznaka -ErrorAction SilentlyContinue
      Write-Host "  restartovan posao: $posao"
    }
  }

  $izdanje = IzdanjeKlona $klon
  $izdanja += $izdanje
  $uspjeli += "$klon @ $izdanje"
  Write-Host "  ok, $izdanje"
}

Write-Host ""
Write-Host "=== zbir ==="
Write-Host "Proslo: $($uspjeli.Count)"
foreach ($u in $uspjeli) { Write-Host "  $u" }
if ($pali.Count -gt 0) {
  Write-Host "Palo: $($pali.Count)"
  foreach ($p in $pali) { Write-Host "  $p" }
}

# Jedno izdanje za cijelu flotu je normalno stanje. Razilazenje znaci da je neki klon ostao na
# starom kodu, a to se lako previdi kad se gleda samo broj "proslo".
$izdanjaSazeto = ""
if ($izdanja.Count -gt 0) {
  $jedinstvena = @($izdanja | Sort-Object -Unique)
  if ($jedinstvena.Count -eq 1) {
    $izdanjaSazeto = "flota na $($jedinstvena[0])"
  } else {
    $izdanjaSazeto = "PAZNJA: izdanja se razilaze: $($jedinstvena -join ' ')"
  }
  Write-Host $izdanjaSazeto
}

# Izvjestaj administratoru. Klijenti ovo ne vide.
if ($env:TELEGRAM_BOT_TOKEN -and $env:TELEGRAM_ADMIN_CHAT_ID -and -not $Suho) {
  $poruka = "Azuriranje flote (Windows): proslo $($uspjeli.Count), palo $($pali.Count)"
  if ($izdanjaSazeto -ne "") { $poruka += "`n$izdanjaSazeto" }
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
