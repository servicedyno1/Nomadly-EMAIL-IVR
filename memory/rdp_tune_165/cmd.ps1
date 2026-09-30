Copy-Item \\tsclient\share\apply.ps1 C:\cloudinit\apply.ps1 -Force
$errs = $null; [void][System.Management.Automation.PSParser]::Tokenize((Get-Content C:\cloudinit\apply.ps1 -Raw), [ref]$errs)
"pushed sha256=$((Get-FileHash C:\cloudinit\apply.ps1 -Algorithm SHA256).Hash.Substring(0,12)) size=$((Get-Item C:\cloudinit\apply.ps1).Length) syntax_errors=$($errs.Count)"
"task CloudInitApply: " + ((Get-ScheduledTask CloudInitApply -EA SilentlyContinue).State)
$os = Get-CimInstance Win32_OperatingSystem
"mem: total=$([int]($os.TotalVisibleMemorySize/1024))MB free=$([int]($os.FreePhysicalMemory/1024))MB commit=$([int]((Get-Counter '\Memory\Committed Bytes').CounterSamples[0].CookedValue/1MB))MB pages/s=$([int](Get-Counter '\Memory\Pages/sec').CounterSamples[0].CookedValue)"
"cpu: " + ((1..3 | % { [int](Get-Counter '\Processor(_Total)\% Processor Time').CounterSamples[0].CookedValue; Start-Sleep 1 }) -join "% ") + "%"
"chrome procs: $((Get-Process chrome -EA SilentlyContinue | Measure).Count)  chrome WS MB: $([int]((Get-Process chrome -EA SilentlyContinue | Measure WS -Sum).Sum/1MB))  MsMpEng WS MB: $([int]((Get-Process MsMpEng -EA SilentlyContinue).WS/1MB))"
"top cpu: " + ((Get-Process | Sort CPU -Desc | Select -First 6 | % { "$($_.Name)=$([int]$_.CPU)s" }) -join ", ")
"power: " + (powercfg /getactivescheme)
"services: " + ((Get-Service WSearch,SysMain,DiagTrack | % { "$($_.Name)=$($_.Status)/$($_.StartType)" }) -join " ")
$mp = Get-MpComputerStatus; "defender: sig=$($mp.AntivirusSignatureLastUpdated) ver=$($mp.AntivirusSignatureVersion) engine=$($mp.AMEngineVersion) rtp=$($mp.RealTimeProtectionEnabled)"
$pref = Get-MpPreference; "defender prefs: cpu=$($pref.ScanAvgCPULoadFactor) lowprio=$($pref.EnableLowCpuPriority) nocatchup=$($pref.DisableCatchupFullScan)/$($pref.DisableCatchupQuickScan) idleonly=$($pref.ScanOnlyIfIdleEnabled)"
$c = Get-ItemProperty HKLM:\SOFTWARE\Policies\Google\Chrome; "chrome policy: hwaccel=$($c.HardwareAccelerationModeEnabled) bg=$($c.BackgroundModeEnabled) memsaver=$($c.HighEfficiencyModeEnabled)/$($c.MemorySaverModeSavings)"
$e = Get-ItemProperty HKLM:\SOFTWARE\Policies\Microsoft\Edge; "edge policy: hwaccel=$($e.HardwareAccelerationModeEnabled) boost=$($e.StartupBoostEnabled) sleeping=$($e.SleepingTabsEnabled)/$($e.SleepingTabsTimeout)s"
"visualfx HKCU: mask=" + (((Get-ItemProperty "HKCU:\Control Panel\Desktop").UserPreferencesMask | % { $_.ToString("x2") }) -join "") + " MinAnimate=" + (Get-ItemProperty "HKCU:\Control Panel\Desktop\WindowMetrics").MinAnimate + " AeroPeek=" + (Get-ItemProperty HKCU:\Software\Microsoft\Windows\DWM).EnableAeroPeek
reg load HKU\NL_DEF C:\Users\Default\NTUSER.DAT 2>$null | Out-Null; "visualfx Default profile: mask=" + (((Get-ItemProperty "Registry::HKU\NL_DEF\Control Panel\Desktop" -EA SilentlyContinue).UserPreferencesMask | % { $_.ToString("x2") }) -join ""); [gc]::Collect(); reg unload HKU\NL_DEF 2>$null | Out-Null
"pagefile: auto=$((Get-CimInstance Win32_ComputerSystem).AutomaticManagedPagefile) " + ((Get-CimInstance Win32_PageFileSetting | % { "$($_.Name) $($_.InitialSize)-$($_.MaximumSize)MB" }) -join ",")
"tasks: " + ((Get-ScheduledTask -TaskPath "\Microsoft\Windows\Application Experience\","\Microsoft\Windows\Customer Experience Improvement Program\","\Microsoft\Windows\Defrag\" -EA SilentlyContinue | % { "$($_.TaskName)=$($_.State)" }) -join ", ")
"dns: " + ((Get-DnsClientServerAddress -AddressFamily IPv4 | ? ServerAddresses | % { $_.ServerAddresses -join "/" }) -join " ; ") + "  google.com=" + [int](Measure-Command { Resolve-DnsName google.com -EA SilentlyContinue }).TotalMilliseconds + "ms"
