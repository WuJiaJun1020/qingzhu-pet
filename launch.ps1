$ErrorActionPreference = 'Stop'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$exe = Join-Path $PSScriptRoot 'runtime\electron.exe'
if (-not (Test-Path -LiteralPath $exe)) { $exe = Join-Path $PSScriptRoot 'node_modules\electron\dist\electron.exe' }
if (-not (Test-Path -LiteralPath $exe)) { throw 'Electron is missing. Run npm ci in the repository first.' }
Start-Process -FilePath $exe -ArgumentList ('"' + $PSScriptRoot + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
