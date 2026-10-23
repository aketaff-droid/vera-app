# What GitHub runs to make the Windows installer: tools, every automated test, the build, and for a v* tag (or
# « publier ») the release, with latest.json for updates from Vera. The log always goes to the ci-logs branch (ci-logs/windows.log), readable with git alone.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$log = Join-Path ([IO.Path]::GetTempPath()) 'windows.log'
Start-Transcript -Path $log -Force | Out-Null
$ok = $false
function Step($name, [scriptblock]$action) {
    Write-Host "`n=== $name ==="
    # Native programs write around the transcript: their output is relayed so the log keeps every test result.
    & $action 2>&1 | ForEach-Object { "$_" } | Out-Host
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "$name : échec (code $LASTEXITCODE)." }
}
try {
    Step 'Outils embarqués' { & (Join-Path $PSScriptRoot 'fetch-runtime.ps1') }
    Step 'Dépendances' { npm ci --ignore-scripts }
    Step 'Types' { npm run typecheck }
    Step 'Interface' { npm test }
    Step 'Moteur et simulateur Kobo (vera-core)' { cargo test --locked --manifest-path core/Cargo.toml }
    Step 'Application (Tauri)' { cargo test --locked --manifest-path src-tauri/Cargo.toml }
    # Updates from Vera (DECISIONS.md, section O): with the signing key (a secret of the repository, never a file),
    # the installer gets its signature (.sig), which Vera checks before installing an update.
    $signed = [bool]$env:TAURI_SIGNING_PRIVATE_KEY
    if ($signed) {
        Set-Content -Path signing.json -Value '{"bundle":{"createUpdaterArtifacts":true}}' -Encoding ascii
        Step 'Fabrication signée' { npm run tauri -- build --config signing.json }
    } else {
        Step 'Fabrication' { npm run tauri -- build }
    }
    $installer = Get-ChildItem src-tauri\target\release\bundle\nsis -Filter '*-setup.exe' | Select-Object -First 1
    $hash = (Get-FileHash $installer.FullName).Hash.ToLower()
    Write-Host "Installateur : $($installer.Name) ($([math]::Round($installer.Length / 1MB)) Mo) sha256 $hash"
    # Published for a v* tag, or by hand with « publier » (Actions › Run workflow): the tag is then made from the version.
    $version = (Get-Content src-tauri\tauri.conf.json -Raw | ConvertFrom-Json).version
    $tag = if ($env:GITHUB_REF_TYPE -eq 'tag') { $env:GITHUB_REF_NAME } elseif ($env:VERA_PUBLISH -eq 'true') { "v$version" } else { $null }
    if ($tag) {
        if ($tag.TrimStart('v') -ne $version) { throw "L'étiquette $tag ne correspond pas à la version $version." }
        $notes = "Installateur Windows de Vera $version, fabriqué et testé par GitHub.`n`nEmpreinte SHA-256 : ``$hash```n`nDéjà installée ? Vera propose elle-même la mise à jour. Sinon, à lancer depuis l'Explorateur."
        $assets = @($installer.FullName)
        # A test version (v2.0.0-essai1…) is published as a pre-release, never as the latest version, and is never
        # offered as an update.
        $pre = if ($tag -match 'essai') { '--prerelease' } else { '--latest' }
        if ($signed -and $tag -notmatch 'essai') {
            $sig = Get-Content "$($installer.FullName).sig" -Raw
            $latest = [ordered]@{
                version   = $version
                notes     = if ($env:VERA_NOTES) { $env:VERA_NOTES } else { "Vera $version" }
                pub_date  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
                platforms = @{ 'windows-x86_64' = @{
                        signature = $sig.Trim()
                        url       = "https://github.com/$env:GITHUB_REPOSITORY/releases/download/$tag/$($installer.Name)"
                    } }
            }
            $json = Join-Path ([IO.Path]::GetTempPath()) 'latest.json'
            $latest | ConvertTo-Json -Depth 5 | Set-Content -Path $json -Encoding utf8NoBOM
            $assets += $json
        }
        Step 'Publication' { gh release create $tag @assets --target $env:GITHUB_SHA --title "Vera $version" --notes $notes $pre }
    }
    $ok = $true
}
catch { Write-Host "ÉCHEC : $_" }
finally {
    Write-Host "`nRésultat : $(if ($ok) { 'réussite' } else { 'échec' }) — $env:GITHUB_REF_NAME $env:GITHUB_SHA"
    Stop-Transcript | Out-Null
    # Publish the log on its own branch, without touching the code branches.
    $logs = Join-Path ([IO.Path]::GetTempPath()) 'ci-logs'
    git clone --quiet --no-checkout --depth 1 "https://x-access-token:$env:GH_TOKEN@github.com/$env:GITHUB_REPOSITORY.git" $logs 2>$null
    Push-Location $logs
    git checkout --quiet --orphan ci-logs 2>$null
    git rm -r --quiet --cached . 2>$null
    Get-ChildItem -Force | Where-Object Name -ne '.git' | Remove-Item -Recurse -Force
    New-Item -ItemType Directory 'ci-logs' | Out-Null
    Copy-Item $log 'ci-logs\windows.log'
    git add ci-logs
    git -c user.name='Vera CI' -c user.email='ci@vera.invalid' commit --quiet -m "Windows $(if ($ok) { 'OK' } else { 'ÉCHEC' }) $env:GITHUB_REF_NAME"
    git push --quiet --force origin ci-logs
    Pop-Location
}
if (-not $ok) { exit 1 }
