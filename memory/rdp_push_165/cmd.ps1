Copy-Item \\tsclient\share\apply.ps1 C:\cloudinit\apply.ps1 -Force
$item = Get-Item C:\cloudinit\apply.ps1
$h = (Get-FileHash C:\cloudinit\apply.ps1 -Algorithm SHA256).Hash
Write-Output "pushed size=$($item.Length) sha256=$h"
$errs = $null
[void][System.Management.Automation.PSParser]::Tokenize((Get-Content C:\cloudinit\apply.ps1 -Raw), [ref]$errs)
Write-Output "syntax_errors=$($errs.Count)"
if ($errs.Count -gt 0) { $errs | ForEach-Object { Write-Output ("  line {0}: {1}" -f $_.Token.StartLine, $_.Message) } }
