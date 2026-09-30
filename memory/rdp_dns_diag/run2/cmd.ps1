"=== time ==="; Get-Date -Format s
"=== Resolve google.com (system) ==="; try { Resolve-DnsName google.com -ErrorAction Stop | Select Name,Type,IPAddress | Out-String } catch { "FAIL: " + $_.Exception.Message }
"=== Resolve via 10.108.15.254 ==="; try { Resolve-DnsName google.com -Server 10.108.15.254 -ErrorAction Stop | Select Name,Type,IPAddress | Out-String } catch { "FAIL: " + $_.Exception.Message }
"=== HTTPS to google by name ==="; try { (Invoke-WebRequest -UseBasicParsing -Uri "https://www.google.com/" -TimeoutSec 10).StatusCode } catch { "FAIL: " + $_.Exception.Message }
"=== firewall profiles ==="; Get-NetFirewallProfile | Select Name,Enabled,DefaultInboundAction,DefaultOutboundAction | Format-Table -AutoSize | Out-String
"=== metadata dns ==="; try { ((Invoke-WebRequest -UseBasicParsing -Uri "http://169.254.169.254/metadata/v1.json" -TimeoutSec 5).Content | ConvertFrom-Json).dns | ConvertTo-Json -Compress } catch { "FAIL: " + $_.Exception.Message }
"=== apply.ps1 size / safety-net / pubdns lines ==="; (Get-Item C:\cloudinit\apply.ps1).Length; (Select-String -Path C:\cloudinit\apply.ps1 -Pattern 'safety-net' -SimpleMatch | Measure-Object).Count; Select-String -Path C:\cloudinit\apply.ps1 -Pattern 'dns' | ForEach-Object { "$($_.LineNumber): $($_.Line)" } | Out-String -Width 250
"=== cfg.json ==="; Get-Content C:\cloudinit\cfg.json -ErrorAction SilentlyContinue | Out-String
"=== apply.log ==="; Get-Content C:\cloudinit\apply.log -ErrorAction SilentlyContinue | Out-String
