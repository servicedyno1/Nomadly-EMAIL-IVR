#!/bin/bash
set -uo pipefail
SRC="$(cat /opt/dr/conf/pg_source.conf)"
LOG=/opt/dr/logs/pg_subscriber.log
exec > >(tee -a "$LOG") 2>&1
echo "===== pg subscriber setup $(date -u) ====="
# 1) target db
sudo -u postgres psql -tAc "select 1 from pg_database where datname='dynopay_dr'" | grep -q 1 \
  || sudo -u postgres createdb dynopay_dr
# 2) schema copy (data comes via subscription initial COPY)
echo "[schema] dumping + loading schema..."
pg_dump --schema-only --no-owner --no-privileges "$SRC" | sudo -u postgres psql -q -d dynopay_dr
echo "[schema] tables now in target: $(sudo -u postgres psql -tAd dynopay_dr -c "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE';")"
# 3) subscription (idempotent)
if sudo -u postgres psql -tAd dynopay_dr -c "select 1 from pg_subscription where subname='dr_sub'" | grep -q 1; then
  echo "[sub] dr_sub already exists — refreshing"
  sudo -u postgres psql -d dynopay_dr -c "ALTER SUBSCRIPTION dr_sub REFRESH PUBLICATION;"
else
  sudo -u postgres psql -d dynopay_dr -c "CREATE SUBSCRIPTION dr_sub CONNECTION '$SRC' PUBLICATION dr_pub WITH (copy_data=true, create_slot=true, slot_name='dr_sub', enabled=true);"
fi
echo "===== done $(date -u) ====="
