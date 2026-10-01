$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$staging = Join-Path $PSScriptRoot 'artifacts\staging'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
Get-ChildItem (Join-Path $PSScriptRoot 'src') -Directory | ForEach-Object {
    $out = Join-Path $_.FullName 'bin\Release'
    if (Test-Path $out) { Remove-Item $out -Recurse -Force }
}

dotnet build DaCard.slnx -c Release
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }

[xml]$props = Get-Content (Join-Path $PSScriptRoot 'Directory.Build.props')
$p = $props.Project.PropertyGroup[0]
$zip = Join-Path (Join-Path (Split-Path $PSScriptRoot -Parent) 'releases') "$($p.ModAuthor)-$($p.ModName)-$($p.Version).zip"

New-Item -ItemType Directory -Force (Split-Path $zip) | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
    Get-ChildItem $staging -Recurse -File | ForEach-Object {
        $entry = $_.FullName.Substring($staging.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry) | Out-Null
    }
} finally { $archive.Dispose() }
Write-Host "Created $zip"
