# scripts/dr — Disaster-recovery toolkit (installed on the DR droplet under /opt/dr/bin)

- Architecture & ops: `memory/DR_REPLICA_SETUP_2026-10-20.md`
- Restore any DB into a new database + restore drill: `memory/DR_RESTORE_RUNBOOK.md`
- Install/update on the droplet: `scp -i /root/.ssh/dr_replica <file> root@146.190.229.132:/opt/dr/bin/` (unit file → /etc/systemd/system/, logrotate-dr → /etc/logrotate.d/dr)
- No secrets here: connection strings live only in `/opt/dr/conf/*.conf` on the droplet; tokens in the vault.
