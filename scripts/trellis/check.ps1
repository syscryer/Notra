$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")

Write-Output "Workspace: $root"
Write-Output ""
Write-Output "Trellis config:"
$config = Get-Item -LiteralPath (Join-Path $root "trellis.hjson")
Write-Output ("- {0} ({1} bytes)" -f $config.FullName, $config.Length)
Write-Output ""
Write-Output "Docs:"
Get-ChildItem -LiteralPath (Join-Path $root "docs") -File | ForEach-Object {
    Write-Output ("- {0} ({1} bytes)" -f $_.Name, $_.Length)
}
Write-Output ""
Write-Output "Git:"
git -C $root status --short
