$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $repoRoot 'runtime\electron.exe'
if (-not (Test-Path -LiteralPath $exe)) { $exe = Join-Path $repoRoot 'node_modules\electron\dist\electron.exe' }
if (-not (Test-Path -LiteralPath $exe)) { throw 'Run npm ci before creating the shortcut.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $repoRoot '启动青竹桌宠.lnk'))
$shortcut.TargetPath = $exe
$shortcut.Arguments = '"' + $repoRoot + '"'
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = (Join-Path $repoRoot 'assets\app.ico') + ',0'
$shortcut.Description = '青竹桌宠 · 独立桌面动画与交互测试'
$shortcut.Save()
Write-Output 'Created 启动青竹桌宠.lnk in the repository.'
