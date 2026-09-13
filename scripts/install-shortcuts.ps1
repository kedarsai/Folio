param([switch]$Remove)
# Start Menu + Desktop shortcuts that launch Folio from this folder.
#   powershell -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\install-shortcuts.ps1 -Remove
$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$icon = Join-Path $root 'assets\icon.ico'
$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'Folio.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Folio.lnk')
)

if ($Remove) {
  foreach ($t in $targets) { if (Test-Path $t) { Remove-Item $t; Write-Output "Removed $t" } }
  return
}

if (-not (Test-Path $electron)) { throw "Electron is not installed. Run 'npm install' in $root first." }

$shell = New-Object -ComObject WScript.Shell
foreach ($t in $targets) {
  $lnk = $shell.CreateShortcut($t)
  $lnk.TargetPath = $electron
  $lnk.Arguments = "`"$root`""
  $lnk.WorkingDirectory = $root
  $lnk.Description = 'Folio - reading companion'
  if (Test-Path $icon) { $lnk.IconLocation = $icon }
  $lnk.Save()
  Write-Output "Created $t"
}
