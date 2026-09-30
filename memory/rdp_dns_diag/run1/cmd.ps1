"=== OS ==="; (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion") | Select ProductName,DisplayVersion,CurrentBuild | Out-String
"=== adapters ==="; Get-NetAdapter | Select Name,ifIndex,Status,MacAddress,InterfaceDescription,LinkSpeed | Format-Table -AutoSize | Out-String -Width 200
"=== ip ==="; Get-NetIPAddress -AddressFamily IPv4 | Select InterfaceAlias,IPAddress,PrefixLength,PrefixOrigin | Format-Table -AutoSize | Out-String -Width 200
"=== ipv6 ==="; Get-NetIPAddress -AddressFamily IPv6 | Select InterfaceAlias,IPAddress,PrefixLength | Format-Table -AutoSize | Out-String -Width 200
"=== routes ==="; Get-NetRoute -AddressFamily IPv4 | Where-Object { $_.DestinationPrefix -eq '0.0.0.0/0' -or $_.DestinationPrefix -like '169.254*' } | Select ifIndex,DestinationPrefix,NextHop,RouteMetric,InterfaceMetric | Format-Table -AutoSize | Out-String -Width 200
"=== ipinterface ==="; Get-NetIPInterface -AddressFamily IPv4 | Select InterfaceAlias,ifIndex,Dhcp,InterfaceMetric,ConnectionState | Format-Table -AutoSize | Out-String -Width 200
"=== dns servers (v4) ==="; Get-DnsClientServerAddress -AddressFamily IPv4 | Select InterfaceAlias,InterfaceIndex,ServerAddresses | Format-Table -AutoSize | Out-String -Width 200
"=== dns servers (v6) ==="; Get-DnsClientServerAddress -AddressFamily IPv6 | Select InterfaceAlias,ServerAddresses | Format-Table -AutoSize | Out-String -Width 200
"=== dnsclient ==="; Get-DnsClient | Select InterfaceAlias,ConnectionSpecificSuffix,RegisterThisConnectionsAddress,UseSuffixWhenRegistering | Format-Table -AutoSize | Out-String -Width 200
"=== dns global ==="; Get-DnsClientGlobalSetting | Out-String
"=== NRPT ==="; Get-DnsClientNrptPolicy | Out-String
"=== Dnscache svc ==="; Get-Service Dnscache | Select Status,StartType | Out-String
"=== netsh dns ==="; netsh interface ipv4 show dnsservers | Out-String
"=== Resolve google.com (system) ==="; try { Resolve-DnsName google.com -ErrorAction Stop | Select Name,Type,IPAddress | Out-String } catch { "FAIL: " + $_.Exception.Message }
"=== Resolve google.com via 1.1.1.1 ==="; try { Resolve-DnsName google.com -Server 1.1.1.1 -ErrorAction Stop | Select Name,Type,IPAddress | Out-String } catch { "FAIL: " + $_.Exception.Message }
"=== Resolve google.com via 8.8.8.8 ==="; try { Resolve-DnsName google.com -Server 8.8.8.8 -ErrorAction Stop | Select Name,Type,IPAddress | Out-String } catch { "FAIL: " + $_.Exception.Message }
"=== Resolve google.com via 67.207.67.2 ==="; try { Resolve-DnsName google.com -Server 67.207.67.2 -ErrorAction Stop | Select Name,Type,IPAddress | Out-String } catch { "FAIL: " + $_.Exception.Message }
"=== Resolve google.com via 67.207.67.3 ==="; try { Resolve-DnsName google.com -Server 67.207.67.3 -ErrorAction Stop | Select Name,Type,IPAddress | Out-String } catch { "FAIL: " + $_.Exception.Message }
"=== Resolve via 1.1.1.1 TCP ==="; try { Resolve-DnsName google.com -Server 1.1.1.1 -TcpOnly -ErrorAction Stop | Select Name,Type,IPAddress | Out-String } catch { "FAIL: " + $_.Exception.Message }
"=== nslookup ==="; nslookup google.com 2>&1 | Out-String
"=== TCP 1.1.1.1:53 ==="; (Test-NetConnection 1.1.1.1 -Port 53 -WarningAction SilentlyContinue | Select RemoteAddress,TcpTestSucceeded,PingSucceeded | Out-String)
"=== TCP 142.250.80.46:443 (google) ==="; (Test-NetConnection 142.250.80.46 -Port 443 -WarningAction SilentlyContinue | Select RemoteAddress,TcpTestSucceeded,PingSucceeded | Out-String)
"=== HTTP to 1.1.1.1 ==="; try { (Invoke-WebRequest -UseBasicParsing -Uri "http://1.1.1.1/" -TimeoutSec 10).StatusCode } catch { "FAIL: " + $_.Exception.Message }
"=== HTTPS to google by name ==="; try { (Invoke-WebRequest -UseBasicParsing -Uri "https://www.google.com/" -TimeoutSec 10).StatusCode } catch { "FAIL: " + $_.Exception.Message }
"=== firewall profiles ==="; Get-NetFirewallProfile | Select Name,Enabled,DefaultInboundAction,DefaultOutboundAction | Format-Table -AutoSize | Out-String
"=== outbound block rules ==="; Get-NetFirewallRule -Direction Outbound -Action Block -Enabled True | Select DisplayName,Profile | Format-Table -AutoSize | Out-String -Width 200
"=== proxy (winhttp) ==="; netsh winhttp show proxy | Out-String
"=== proxy (user) ==="; try { Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" | Select ProxyEnable,ProxyServer,AutoConfigURL | Out-String } catch {}
"=== hosts ==="; Get-Content C:\Windows\System32\drivers\etc\hosts | Select-String -NotMatch '^#' | Out-String
"=== metadata dns ==="; try { (Invoke-WebRequest -UseBasicParsing -Uri "http://169.254.169.254/metadata/v1.json" -TimeoutSec 5).Content | ConvertFrom-Json | Select -Expand dns | Out-String } catch { "FAIL: " + $_.Exception.Message }
"=== apply.log ==="; Get-Content C:\cloudinit\apply.log -ErrorAction SilentlyContinue | Out-String
"=== apply.ps1 has safety-net? ==="; (Select-String -Path C:\cloudinit\apply.ps1 -Pattern 'safety-net' -SimpleMatch | Measure-Object).Count
