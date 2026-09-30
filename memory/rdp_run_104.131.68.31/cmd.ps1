
$pw = "QV*EA-)YMgpp+GWgn_"
try { $u = [ADSI]"WinNT://./Administrator,user"; $u.SetPassword([string]$pw); $u.SetInfo(); "ADSI OK" } catch { "ADSI FAIL: " + $_.Exception.Message }
"--- policy ---"
net accounts
"--- account ---"
net user Administrator | Select-String "active|Password"
(Get-LocalUser Administrator | Select Enabled,PasswordLastSet | Out-String)
"--- OS ---"
(Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion").DisplayVersion
Get-ScheduledTask CloudInitApply,CloudInitAgent | Select TaskName,State | Out-String

