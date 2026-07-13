param(
    [string]$Tag = "v0.20.0-rc.1"
)

$ErrorActionPreference = "Stop"

function Write-Utf8NoBom([string]$Path, [string]$Content) {
    [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$vendorRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "crates/notra-app/frontend/vendor/marktext-muya"))
$repoPrefix = $repoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $vendorRoot.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Vendor target is outside the repository: $vendorRoot"
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) "notra-marktext-muya-$PID"
$checkoutRoot = Join-Path $temporaryRoot "marktext"
$stagingRoot = "$vendorRoot.staging-$PID"
$backupRoot = "$vendorRoot.backup-$PID"

try {
    New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
    git clone --quiet --depth 1 --branch $Tag https://github.com/marktext/marktext.git $checkoutRoot
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to clone MarkText tag $Tag"
    }

    $commit = (git -C $checkoutRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $commit) {
        throw "Unable to resolve MarkText commit for $Tag"
    }
    $tagObject = (git ls-remote --tags --refs https://github.com/marktext/marktext.git $Tag).Split("`t")[0].Trim()

    New-Item -ItemType Directory -Path $stagingRoot | Out-Null
    Copy-Item -LiteralPath (Join-Path $checkoutRoot "packages/muya/src") -Destination $stagingRoot -Recurse
    Copy-Item -LiteralPath (Join-Path $checkoutRoot "packages/muya/package.json") -Destination (Join-Path $stagingRoot "upstream-package.json")
    Copy-Item -LiteralPath (Join-Path $checkoutRoot "LICENSE") -Destination (Join-Path $stagingRoot "LICENSE")

    $prismLoaderPath = Join-Path $stagingRoot "src/utils/prism/loadLanguage.ts"
    $prismLoader = [System.IO.File]::ReadAllText($prismLoaderPath)
    $upstreamPrismPath = "../../../node_modules/prismjs/components/prism-`${lang}.js"
    $notraPrismPath = "../../../../../node_modules/prismjs/components/prism-`${lang}.js"
    if (-not $prismLoader.Contains($upstreamPrismPath)) {
        throw "The MarkText Prism loader changed; review the Notra integration patch."
    }
    Write-Utf8NoBom $prismLoaderPath ($prismLoader.Replace($upstreamPrismPath, $notraPrismPath))

    $adapter = Get-Content -LiteralPath (Join-Path $vendorRoot "package.json") -Raw | ConvertFrom-Json
    $upstream = Get-Content -LiteralPath (Join-Path $stagingRoot "upstream-package.json") -Raw | ConvertFrom-Json
    $adapter.version = $upstream.version
    $adapter.engines = $upstream.engines
    $adapter.dependencies = $upstream.dependencies
    Write-Utf8NoBom (Join-Path $stagingRoot "package.json") (($adapter | ConvertTo-Json -Depth 20) + "`n")

    $metadata = [ordered]@{
        repository = "https://github.com/marktext/marktext.git"
        tag = $Tag
        tagObject = $tagObject
        commit = $commit
        packagePath = "packages/muya"
        integrationPatches = @(
            "Resolve Prism components from the Notra frontend node_modules directory"
        )
        syncedAt = (Get-Date -Format "yyyy-MM-dd")
    }
    Write-Utf8NoBom (Join-Path $stagingRoot "UPSTREAM.json") (($metadata | ConvertTo-Json -Depth 5) + "`n")

    Move-Item -LiteralPath $vendorRoot -Destination $backupRoot
    try {
        Move-Item -LiteralPath $stagingRoot -Destination $vendorRoot
    }
    catch {
        if (-not (Test-Path -LiteralPath $vendorRoot) -and (Test-Path -LiteralPath $backupRoot)) {
            Move-Item -LiteralPath $backupRoot -Destination $vendorRoot
        }
        throw
    }

    try {
        Remove-Item -LiteralPath $backupRoot -Recurse -Force
    }
    catch {
        Write-Warning "MarkText was updated, but the backup directory could not be removed: $backupRoot"
    }

    Write-Host "Synced MarkText $Tag ($commit). Run npm install in crates/notra-app/frontend."
}
finally {
    if (-not (Test-Path -LiteralPath $vendorRoot) -and (Test-Path -LiteralPath $backupRoot)) {
        Move-Item -LiteralPath $backupRoot -Destination $vendorRoot
    }
    if (Test-Path -LiteralPath $stagingRoot) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}
