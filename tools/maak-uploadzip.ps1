# maak-uploadzip.ps1 - bouwt de zip die naar de webserver gaat.
#
#     powershell -ExecutionPolicy Bypass -File tools\maak-uploadzip.ps1
#
# Let op: dit bestand bewust zonder speciale tekens (geen en-streepje, geen
# accenten). PowerShell leest .ps1 zonder BOM als ANSI, en dan breekt een
# UTF-8 teken de string-parsing.
#
# Wat het doet, en waarom:
#
#  - Laat .git en tools/ eruit. Dat is ontwikkelgereedschap en zou publiek
#    leesbaar zijn op /tools/.
#  - Laat .nojekyll eruit; dat bestand dient alleen GitHub Pages.
#  - Wisselt robots.txt om voor de productieversie. In de projectmap staat
#    bewust de testversie met "Disallow: /", omdat de GitHub-testomgeving niet
#    geindexeerd mag worden. Zou die versie op het echte domein belanden, dan
#    blokkeer je Google op je eigen site.
#  - Neemt het .htaccess WEL mee, als kant-en-klaar .htaccess. Tijdens de
#    verhuizing hoorde dat er nog niet in: de doorverwijzingen mochten pas
#    ingaan nadat WordPress weg was. Nu de site live staat is dat voorbij, en
#    scheelt het meeleveren een handmatige hernoemstap waarbij een spelfout
#    (een enkele s, of .txt erachter) ongemerkt alle doorverwijzingen uitzet.

$ErrorActionPreference = 'Stop'

$project = Split-Path -Parent $PSScriptRoot
$stamp   = Get-Date -Format 'yyyyMMdd-HHmm'
$dist    = Join-Path $env:TEMP "delphi-dist-$stamp"
$zip     = Join-Path (Split-Path -Parent $project) "delphi-upload-$stamp.zip"

Write-Host "Project : $project"

# 1. Kopieer alles behalve wat niet naar de server hoort.
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$uit = @('.git', 'tools', 'node_modules')

Get-ChildItem -Path $project -Force | Where-Object {
  $uit -notcontains $_.Name -and $_.Name -ne '.nojekyll'
} | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $dist -Recurse -Force
}

# 2. Productie-robots.txt erin, in plaats van de testversie.
$productie = Join-Path $PSScriptRoot 'robots-productie.txt'
if (-not (Test-Path $productie)) { throw "tools/robots-productie.txt ontbreekt" }
Copy-Item -Path $productie -Destination (Join-Path $dist 'robots.txt') -Force

# 3. Controle: de testversie mag er echt niet meer in zitten.
$robots = Get-Content (Join-Path $dist 'robots.txt') -Raw
if ($robots -match '(?m)^\s*Disallow:\s*/\s*$') {
  throw "AFGEBROKEN: robots.txt bevat nog Disallow-slash. Dat zou Google op het live domein blokkeren."
}
if ($robots -notmatch 'Sitemap:') { throw "AFGEBROKEN: robots.txt mist de Sitemap-regel." }

# 4. Het .htaccess meeleveren, meteen onder de juiste naam.
$htaccess = Join-Path $PSScriptRoot 'htaccess-productie.txt'
if (-not (Test-Path $htaccess)) { throw "tools/htaccess-productie.txt ontbreekt" }
Copy-Item -Path $htaccess -Destination (Join-Path $dist '.htaccess') -Force

# Controle: de doorverwijslus mag er niet meer in zitten. Het patroon
# ^en/privacy-?(policy|statement)?/?$ matchte ook en/privacy/ zelf, waardoor
# die pagina naar zichzelf verwees en onbereikbaar was.
$ht = Get-Content (Join-Path $dist '.htaccess') -Raw
if ($ht -match 'en/privacy-\?\(policy\|statement\)\?') {
  throw "AFGEBROKEN: .htaccess bevat nog het patroon dat /en/privacy/ naar zichzelf laat verwijzen."
}

# 5. Controle: staat index.html in de wortel?
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw "AFGEBROKEN: index.html ontbreekt in de wortel." }
if (-not (Test-Path (Join-Path $dist '404.html')))   { throw "AFGEBROKEN: 404.html ontbreekt." }

# 5. Zippen.
#
# BEWUST NIET Compress-Archive. Die schrijft in Windows PowerShell 5.1 de
# padscheiding als backslash ("contact\index.html"), terwijl het zipformaat een
# forward slash voorschrijft. Uitpakprogramma's op Linux, en dus ook de
# bestandsbeheerder van Plesk, zien dat niet als map maar als een bestandsnaam
# met een backslash erin. Je krijgt dan geen mappenstructuur maar een platte
# hoop bestanden. ZipFile.CreateFromDirectory doet het wel goed.
# Ook ZipFile.CreateFromDirectory schrijft in .NET Framework backslashes. We
# maken de ingangen daarom zelf aan, met een expliciete forward slash.
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $zip) { Remove-Item $zip -Force }

$archief = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
  foreach ($bestand in Get-ChildItem -Path $dist -Recurse -File -Force) {
    $relatief = $bestand.FullName.Substring($dist.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archief, $bestand.FullName, $relatief,
      [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally {
  $archief.Dispose()
}

# Controle: geen enkele ingang mag een backslash bevatten.
$controle = [System.IO.Compression.ZipFile]::OpenRead($zip)
$fout = $controle.Entries | Where-Object { $_.FullName -like '*\*' } | Select-Object -First 1
$aantalIngangen = $controle.Entries.Count
$controle.Dispose()
if ($fout) { throw "AFGEBROKEN: zip bevat backslash-paden, bijvoorbeeld $($fout.FullName)" }

$aantal = (Get-ChildItem $dist -Recurse -File).Count
$mb = [Math]::Round((Get-Item $zip).Length / 1MB, 1)

Remove-Item $dist -Recurse -Force

Write-Host ""
Write-Host "Klaar: $zip"
Write-Host "  $aantal bestanden, $mb MB"
Write-Host ""
Write-Host "Uitpakken in httpdocs. Daarna hoort index.html direct in httpdocs te staan."
