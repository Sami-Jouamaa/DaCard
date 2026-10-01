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

$nodeMajor = 24
$nodeCache = Join-Path $PSScriptRoot 'artifacts\node-cache'
New-Item -ItemType Directory -Force $nodeCache | Out-Null
$release = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') |
    Where-Object { $_.version -like "v$nodeMajor.*" -and $_.lts } | Select-Object -First 1
if (-not $release) { throw "No Node.js $nodeMajor LTS release found" }
$nodeName = "node-$($release.version)-win-x64"
$nodeZip = Join-Path $nodeCache "$nodeName.zip"
if (-not (Test-Path $nodeZip)) {
    Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$($release.version)/$nodeName.zip" -OutFile $nodeZip
}
$sums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt").Content
$expected = ($sums -split "`n" | Where-Object { $_ -match " $nodeName\.zip$" }) -replace '\s.*$', ''
$actual = (Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLowerInvariant()
if (-not $expected -or $expected -ne $actual) { Remove-Item $nodeZip -Force; throw "Node.js download checksum mismatch" }
$modStaging = Get-ChildItem $staging -Recurse -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'dashboard\server\main.mjs') } | Select-Object -First 1
if (-not $modStaging) { throw 'The dashboard was not built into the staging folder' }
$nodeTarget = Join-Path $modStaging.FullName 'dashboard\node'
New-Item -ItemType Directory -Force $nodeTarget | Out-Null
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$nodeArchive = [System.IO.Compression.ZipFile]::OpenRead($nodeZip)
try {
    foreach ($name in @('node.exe', 'LICENSE')) {
        $entry = $nodeArchive.Entries | Where-Object { $_.FullName -eq "$nodeName/$name" } | Select-Object -First 1
        if (-not $entry) { throw "$name is missing from $nodeName.zip" }
        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $nodeTarget $name), $true)
    }
} finally { $nodeArchive.Dispose() }
Write-Host "Bundled Node.js $($release.version)"

[xml]$props = Get-Content (Join-Path $PSScriptRoot 'Directory.Build.props')
$p = $props.Project.PropertyGroup[0]
$zip = Join-Path (Join-Path (Split-Path $PSScriptRoot -Parent) 'releases') "$($p.ModAuthor)-$($p.ModName)-$($p.Version).zip"

New-Item -ItemType Directory -Force (Split-Path $zip) | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }
$archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
try {
    Get-ChildItem $staging -Recurse -File | ForEach-Object {
        $entry = $_.FullName.Substring($staging.Length + 1).Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry) | Out-Null
    }
} finally { $archive.Dispose() }
Write-Host "Created $zip"
