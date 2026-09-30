$ErrorActionPreference = 'SilentlyContinue'
"=== OS ==="; (Get-CimInstance Win32_OperatingSystem | Select Caption, Version, LastBootUpTime, TotalVisibleMemorySize, FreePhysicalMemory | Format-List | Out-String).Trim()
"=== CPU ==="; (Get-CimInstance Win32_Processor | Select Name, NumberOfCores, NumberOfLogicalProcessors, LoadPercentage, CurrentClockSpeed, MaxClockSpeed | Format-List | Out-String).Trim()
"=== CPU load (3 samples) ==="; 1..3 | % { (Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples[0].CookedValue; Start-Sleep 1 }
"=== Memory (MB) ==="; $os = Get-CimInstance Win32_OperatingSystem; "Total=$([int]($os.TotalVisibleMemorySize/1024)) Free=$([int]($os.FreePhysicalMemory/1024)) CommitUsed=$([int]((Get-Counter '\Memory\Committed Bytes').CounterSamples[0].CookedValue/1MB)) PagesPerSec=$((Get-Counter '\Memory\Pages/sec').CounterSamples[0].CookedValue)"
"=== Pagefile ==="; (Get-CimInstance Win32_PageFileUsage | Select Name, AllocatedBaseSize, CurrentUsage, PeakUsage | Format-Table -Auto | Out-String).Trim()
"=== Top 15 processes by CPU ==="; (Get-Process | Sort CPU -Desc | Select -First 15 Name, Id, @{n='CPUs';e={[int]$_.CPU}}, @{n='WS_MB';e={[int]($_.WS/1MB)}}, @{n='PM_MB';e={[int]($_.PM/1MB)}} | Format-Table -Auto | Out-String).Trim()
"=== Top 15 processes by WorkingSet ==="; (Get-Process | Sort WS -Desc | Select -First 15 Name, Id, @{n='WS_MB';e={[int]($_.WS/1MB)}} | Format-Table -Auto | Out-String).Trim()
"=== Disk ==="; (Get-PhysicalDisk | Select FriendlyName, MediaType, BusType, Size | Format-Table -Auto | Out-String).Trim()
(Get-Volume -DriveLetter C | Select DriveLetter, FileSystem, @{n='SizeGB';e={[int]($_.Size/1GB)}}, @{n='FreeGB';e={[int]($_.SizeRemaining/1GB)}} | Format-Table -Auto | Out-String).Trim()
"disk queue: $((Get-Counter '\PhysicalDisk(_Total)\Current Disk Queue Length').CounterSamples[0].CookedValue)  %busy: $((Get-Counter '\PhysicalDisk(_Total)\% Disk Time').CounterSamples[0].CookedValue)"
"=== Storage/Net drivers ==="; (Get-CimInstance Win32_PnPSignedDriver | ? { $_.DeviceClass -in 'SCSIADAPTER','NET','DISPLAY','SYSTEM' -and $_.DeviceName -match 'VirtIO|Red Hat|QEMU|Ethernet|Display|Balloon|Serial' } | Select DeviceName, DriverVersion, DeviceClass | Format-Table -Auto | Out-String).Trim()
"=== Display ==="; (Get-CimInstance Win32_VideoController | Select Name, DriverVersion, AdapterRAM, CurrentHorizontalResolution, CurrentVerticalResolution | Format-List | Out-String).Trim()
"=== Services of interest ==="; (Get-Service WSearch, SysMain, wuauserv, WinDefend, TrustedInstaller, UsoSvc, DiagTrack, Spooler, TermService | Select Name, Status, StartType | Format-Table -Auto | Out-String).Trim()
"=== Power plan ==="; powercfg /getactivescheme
"=== Defender ==="; (Get-MpComputerStatus | Select AMRunningMode, RealTimeProtectionEnabled, AntivirusSignatureLastUpdated, QuickScanStartTime, FullScanStartTime, IsTamperProtected | Format-List | Out-String).Trim(); (Get-MpPreference | Select ScanOnlyIfIdleEnabled, ScanAvgCPULoadFactor, DisableRealtimeMonitoring | Format-List | Out-String).Trim()
"=== Windows Update ==="; (Get-CimInstance -Namespace root\cimv2 -Class Win32_Service -Filter "Name='wuauserv'" | Select State, StartMode | Format-List | Out-String).Trim(); try { $s = New-Object -ComObject Microsoft.Update.Session; $r = $s.CreateUpdateSearcher(); $c = $r.GetTotalHistoryCount(); "history count: $c"; $r.QueryHistory(0, [Math]::Min(5,$c)) | Select Date, Title, ResultCode | Format-Table -Auto | Out-String } catch { "update history err: $_" }
(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired' 2>$null) -ne $null | % { "reboot required: $_" }
"=== Scheduled tasks running ==="; (Get-ScheduledTask | ? State -eq 'Running' | Select TaskName, TaskPath | Format-Table -Auto | Out-String).Trim()
"=== RDP session settings ==="; (Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services' | Out-String).Trim()
(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' | Select MaxCompressionLevel, ColorDepth, fDisableCam, SelectTransport, fInheritColorDepth | Out-String).Trim()
"=== Visual FX ==="; Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects' | Select VisualFXSetting | Out-String
"=== Browsers installed ==="; Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' | ? DisplayName -match 'Chrome|Edge|Firefox|Brave' | Select DisplayName, DisplayVersion | Format-Table -Auto | Out-String
"=== Edge/Chrome processes ==="; (Get-Process msedge, chrome, firefox -EA SilentlyContinue | Measure Name).Count
"=== IE ESC ==="; (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components\{A509B1A7-37EF-4b3f-8CFC-4F3A74704073}').IsInstalled; (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Active Setup\Installed Components\{A509B1A8-37EF-4b3f-8CFC-4F3A74704073}').IsInstalled
"=== Net adapter ==="; (Get-NetAdapter | Select Name, InterfaceDescription, LinkSpeed, Status | Format-Table -Auto | Out-String).Trim(); (Get-NetAdapterAdvancedProperty -Name * | ? DisplayName -match 'Offload|RSS|Interrupt|Jumbo' | Select Name, DisplayName, DisplayValue | Format-Table -Auto | Out-String).Trim()
"=== DNS ==="; (Get-DnsClientServerAddress -AddressFamily IPv4 | Select InterfaceAlias, ServerAddresses | Format-Table -Auto | Out-String).Trim(); Measure-Command { Resolve-DnsName google.com -EA SilentlyContinue | Out-Null } | % { "resolve google.com: $([int]$_.TotalMilliseconds) ms" }
"=== Latency ==="; Test-Connection 1.1.1.1 -Count 3 | Select Address, ResponseTime | Format-Table -Auto | Out-String
"=== Apply log tail ==="; Get-ChildItem C:\ProgramData\*apply*.log, C:\CloudInit\*.log, C:\Windows\Temp\*apply*.log -EA SilentlyContinue | % { "--- $($_.FullName)"; Get-Content $_.FullName -Tail 25 }
"=== DONE ==="
