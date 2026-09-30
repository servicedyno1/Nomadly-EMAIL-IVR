Write-Output "=== DNS servers per interface ==="
Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object InterfaceAlias, ServerAddresses | Format-Table -AutoSize | Out-String
Write-Output "=== Net adapters (Up) ==="
Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object Name, ifIndex, InterfaceDescription, MacAddress, Status | Format-Table -AutoSize | Out-String
Write-Output "=== IPv4 addresses ==="
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object InterfaceAlias, IPAddress, PrefixLength | Format-Table -AutoSize | Out-String
Write-Output "=== Resolve google.com (Cloudflare 1.1.1.1) ==="
try { (Resolve-DnsName google.com -Server 1.1.1.1 -ErrorAction Stop | Select-Object Name, IPAddress | Format-Table | Out-String) } catch { Write-Output "RESOLVE via 1.1.1.1 FAILED: $($_.Exception.Message)" }
Write-Output "=== Resolve google.com (system default) ==="
try { (Resolve-DnsName google.com -ErrorAction Stop | Select-Object Name, IPAddress | Format-Table | Out-String) } catch { Write-Output "RESOLVE (default) FAILED: $($_.Exception.Message)" }
Write-Output "=== ping 1.1.1.1 (egress test) ==="
(Test-Connection -ComputerName 1.1.1.1 -Count 2 -Quiet)
Write-Output "=== apply.log tail 80 ==="
if (Test-Path C:\cloudinit\apply.log) { Get-Content C:\cloudinit\apply.log -Tail 80 } else { Write-Output "no apply.log" }
Write-Output "=== markers ==="
foreach ($f in @('applied.txt','callback_sent.txt','cfg.json')) { $p = "C:\cloudinit\$f"; if (Test-Path $p) { Write-Output "$f = $(Get-Content $p -Raw)" } else { Write-Output "$f MISSING" } }
