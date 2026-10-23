# Assembles .release/: kepubify (the only tool Vera ships, byte-identical to the validated release) and the
# notices of every component. Used by GitHub (scripts/ci-windows.ps1); runs on any Windows with Python on PATH.
$ErrorActionPreference = 'Stop'
$kepubify = 'v4.0.4'
$expected = 'f3dee3ece063329661fef474262fe403812335bf1676eab35b672565bf195738'
$root = Split-Path $PSScriptRoot -Parent
$release = Join-Path $root '.release'
if (Test-Path $release) { throw "$release existe déjà : rien n'est remplacé." }
$notices = Join-Path $release 'notices'
New-Item -ItemType Directory -Force $notices | Out-Null

$exe = Join-Path $release 'kepubify.exe'
Write-Host "Téléchargement de kepubify $kepubify"
Invoke-WebRequest -Uri "https://github.com/pgaskin/kepubify/releases/download/$kepubify/kepubify-windows-64bit.exe" -OutFile $exe -UseBasicParsing
$hash = (Get-FileHash $exe).Hash.ToLower()
if ($hash -ne $expected) { throw "kepubify : empreinte $hash différente de la version validée." }

# Licence inventory of the Rust and npm dependencies, then every notice beside the installed application.
& python (Join-Path $root 'scripts\inventory-licenses.py')
if ($LASTEXITCODE -ne 0) { throw 'Inventaire des licences impossible.' }
Copy-Item (Join-Path $root 'licenses\*') $notices -Recurse -Force
Write-Host 'Outils et notices assemblés.'
