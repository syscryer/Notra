param(
    [Parameter(Mandatory = $true)]
    [string]$Phase
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$progressPath = Join-Path $root "docs\progress.md"

Write-Output "Trellis phase: $Phase"
Write-Output "Workspace: $root"

switch ($Phase) {
    "00-product" {
        Write-Output "Goal: lock product principles, boundaries, and v0.1 scope."
        Write-Output "Output: docs/00-product.md"
    }
    "01-ui-prototype" {
        Write-Output "Goal: design the Catio/mxterm style workbench."
        Write-Output "Output: docs/01-ui-prototype.md"
    }
    "02-architecture" {
        Write-Output "Goal: define Rust native architecture boundaries."
        Write-Output "Output: docs/02-architecture.md"
    }
    "03-editor-core" {
        Write-Output "Goal: implement the editor core."
        Write-Output "Output: crates/notra-core"
    }
    "04-search-replace" {
        Write-Output "Goal: implement the core search and replace experience."
        Write-Output "Output: crates/notra-core/src/search.rs and app panel"
    }
    "05-performance" {
        Write-Output "Goal: verify performance targets."
        Write-Output "Output: docs/05-performance.md"
    }
    default {
        throw "Unknown phase: $Phase"
    }
}

Write-Output ""
Write-Output "Current progress:"
Get-Content -LiteralPath $progressPath -Encoding UTF8
