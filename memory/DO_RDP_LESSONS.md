# DO Windows RDP — lessons learned (2026-09-22)

1. **Never snapshot a converted Windows droplet as the golden image.** DO keeps `distribution: Ubuntu`
   on the snapshot and *create/rebuild from it errors* every time (~45 s, droplet auto-deleted, `power_on` refused).
   Use Custom Images (`POST /v2/images`, `distribution: "Unknown"`, qcow2 served from the build droplet).
2. `certutil -f -decode` of a 900-char-per-line base64 file **silently produced nothing on WS2019** (fine on WS2022).
   apply.ps1 now ships on the answer ISO (`cloudinit\apply.ps1`) and FirstLogonCommands `copy` it from the CD.
3. Guest→host "marker" HTTP pings under QEMU slirp never arrived on any edition. Don't rely on in-guest
   telemetry; verify the disk offline (ntfs-3g ro mount) after the guest shuts itself down.
4. `dd` of 32 GB through the page cache can evict bash/curl → the post-copy `report`/reboot hangs and Ubuntu stays up
   forever. Use `iflag=direct oflag=direct`, sysrq `s`+`u` first, then only builtins (`echo b > /proc/sysrq-trigger`).
   Rescue for a stuck droplet: DO `power_cycle` (worked for WS2025 on 2026-09-22).
5. `gd-2vcpu-8gb` is regularly out of stock in nyc3 → fallback chain of 50 GB-disk sizes read from `GET /v2/regions`.
   `gd-2vcpu-8gb-intel` has a 60 GB disk → NOT a valid fallback (snapshot min_disk would exceed the Starter tier).
6. The FastAPI proxy re-serializes JSON (`{"ok": true}` with a space) — never string-match `"ok":true` in shell.
7. Reseller API key for sandbox tests: see memory/test_credentials.md (`golden e2e sandbox key`).
8. **WS2025 (24H2 Setup) appends a WinRE recovery partition AFTER the Windows partition** even with a
   single-partition answer file. The offline verify used to mount the *last* partition (`tail -1`) → the
   700 MB recovery partition → "apply.ps1 MISSING / no Panther logs" (2 failed ws2025 builds, 2026-09-22).
   Fix: locate the OS partition by content (`Windows/System32`), then `sfdisk --delete` every trailing
   partition so C: stays last and apply.ps1's `Resize-Partition` can grow it on 50–320 GB customer disks.
   Layout is now echoed in the verify messages (`Layout: sda1 31.3G ntfs ...`).
9. **The per-order password is NOT on `doRdpServers`** — it lives in `vpsPasswordSecrets` (secret store). Anything that
   builds user-data / autounattend from a server doc must call `getSecretPassword(server_id)` first. The bug shipped
   `ADMIN_PASSWORD=undefined` → Windows policy rejected it → RDP up but login impossible. Caught only by a real login
   check (`xfreerdp +auth-only`); the unit suite now asserts the real password is in the user-data.
10. **DO's VPC resolver (10.x.15.254 from metadata `dns.nameservers`) times out for 5+ min after a Windows boot** →
    "remote name could not be resolved" on every callback. apply.ps1 puts 67.207.67.2/3 + 1.1.1.1 first.
11. `net user Administrator <pw>` prompts (and fails non-interactively) for passwords > 14 chars → always pass `/y`.
12. Debugging a golden droplet from the sandbox: `Xvfb :98` + `xfreerdp /v:IP /u:Administrator /p:<build admin_password>
    /drive:share,/tmp/rdpshare` + `xdotool key super+r` → run a `.cmd` from `\\tsclient\share` (Run box truncates long
    commands) → copy `C:\cloudinit\apply.log` back to the share. Build-time password = `doRdpImageBuilds.admin_password`.
13. **DO custom-image imports can hang in `pending` forever after the download finished.** Check the build droplet's
    outbound bandwidth (`GET /v2/monitoring/metrics/droplet/bandwidth?host_id=..&interface=public&direction=outbound`,
    values in Mbps): a 6–14 min burst = DO fetched the qcow2; no `available` within ~2 h after that = stuck (ws2022 sat
    3h40m, ws2025 2h20m on 2026-09-22). `runBuild` now deletes the stuck entry and re-submits the same URL after
    `T.importRetryMin` (150 min, DB-based deadline, max `T.importRetries`=2); the build droplet keeps serving the qcow2
    until registration, so no rebuild is needed.

## 2026-09-24 — performance lessons (live 2vCPU/4GB WS2022 box)
6. `VisualFXSetting=2` alone does NOTHING — it is only the radio button the dialog shows. The effects live in `UserPreferencesMask` (+ MinAnimate/TaskbarAnimations/ListviewShadow/EnableAeroPeek...). `9012038012000000` = best performance with ClearType kept on.
7. Eval ISOs ship Defender signatures from 2020 and Windows Update is off → MsMpEng becomes the #1 CPU consumer. `Update-MpSignature -UpdateSource MMPC` works without WU (took <10 min on the live box).
8. No droplet has a GPU: Chrome/Edge "hardware acceleration" = SwiftShader on the CPU. Policy `HardwareAccelerationModeEnabled=0` + Memory Saver (`HighEfficiencyModeEnabled=1`, `MemorySaverModeSavings=2`) are the biggest wins on 4 GB.
9. DO Premium **Intel** (`s-*-intel`) is sold in nyc3/tor1/fra1 where Premium AMD is not, same price/disk. Never send the AMD slug to fra1 (422). Basic `s-2vcpu-4gb` = shared "DO-Regular" 2.3 GHz — visibly slower for a Windows desktop.
10. `reg load` of `C:\Users\Administrator\NTUSER.DAT` fails while that user is logged in — check `$LASTEXITCODE` and skip, otherwise every `reg add` on the hive prints "The parameter is incorrect".
11. Pagefile changes via `Win32_PageFileSetting` need a reboot; system-managed on a 4 GB box was only 1.4 GB.
