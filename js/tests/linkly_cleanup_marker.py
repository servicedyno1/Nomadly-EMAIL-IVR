#!/usr/bin/env python3
# Cleanup helper: list Linkly links matching a marker (one list call) and delete them. Never touches 2y2V3.
# usage: linkly_cleanup_marker.py <marker>
import sys, re, requests
key = next(l.split("=", 1)[1].strip().strip('"') for l in open("/app/backend/.env") if l.startswith("LINKLY_API_KEY="))
H = {"Authorization": f"Bearer {key}", "Accept": "application/json"}
B = "https://api.linklyhq.com/api/v1/workspace/414714"
r = requests.get(f"{B}/list_links", params={"search": sys.argv[1]}, headers=H, timeout=20)
print("list:", r.status_code)
data = r.json()
links = data.get("links", data) if isinstance(data, dict) else data
for l in links:
    full, url = l.get("full_url", ""), l.get("url", "")
    print("found:", l.get("id"), full, url)
    if full.endswith("/2y2V3") or sys.argv[1] not in url:
        print("  skip"); continue
    d = requests.delete(f"{B}/links/{l['id']}", headers=H, timeout=20)
    print("  delete:", d.status_code)
