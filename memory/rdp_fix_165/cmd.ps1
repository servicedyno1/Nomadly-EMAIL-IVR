$pub = @('1.1.1.1', '8.8.8.8')
Write-Output "=== applying public resolvers to all Up adapters ==="
Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | ForEach-Object {
    try {
        netsh interface ipv4 set dnsservers name="$($_.Name)" source=static address=1.1.1.1 register=none validate=no | Out-Null
        netsh interface ipv4 add dnsservers name="$($_.Name)" address=8.8.8.8 index=2 validate=no | Out-Null
        Write-Output "set DNS on $($_.Name)"
    } catch { Write-Output "failed on $($_.Name): $($_.Exception.Message)" }
}
Restart-Service Dnscache -Force -ErrorAction SilentlyContinue
Clear-DnsClientCache
Start-Sleep -Seconds 3
Write-Output "=== after fix: DNS per interface ==="
Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object InterfaceAlias, ServerAddresses | Format-Table -AutoSize | Out-String
Write-Output "=== resolve google.com (system default) ==="
try { (Resolve-DnsName google.com -ErrorAction Stop | Select-Object Name, IPAddress | Format-Table | Out-String) } catch { Write-Output "STILL FAILED: $($_.Exception.Message)" }
Write-Output "=== nslookup github.com (system default) ==="
nslookup github.com 2>&1
