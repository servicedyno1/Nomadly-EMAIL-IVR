import json, os, subprocess, sys

RTOK = os.environ["RTOK"]  # Railway account token for the DB projects (vault key RAILWAY_DB_ACCOUNT_TOKEN)


def gql(q, v=None):
    body = json.dumps({"query": q, "variables": v or {}})
    p = subprocess.run(["curl", "-s", "-X", "POST", "https://backboard.railway.app/graphql/v2",
                        "-H", "Content-Type: application/json", "-H", "Authorization: Bearer " + RTOK,
                        "--data", "@-"], input=body, capture_output=True, text=True)
    try:
        return json.loads(p.stdout)
    except Exception:
        return {"raw": p.stdout[:500]}


def projects():
    ws = gql("query{ me{ workspaces{ id } } }")["data"]["me"]["workspaces"]
    for w in ws:
        r = gql("""query($w:String){ projects(workspaceId:$w){ edges{ node{ id name
              environments{ edges{ node{ id name } } }
              services{ edges{ node{ id name serviceInstances{ edges{ node{ environmentId source{ image } } } } } } } } } } }""",
                {"w": w["id"]})
        for e in r["data"]["projects"]["edges"]:
            n = e["node"]
            envs = {x["node"]["id"]: x["node"]["name"] for x in n["environments"]["edges"]}
            print(f"PROJECT {n['name']}  projectId={n['id']}")
            for s in n["services"]["edges"]:
                s = s["node"]
                for i in s["serviceInstances"]["edges"]:
                    i = i["node"]
                    print(f"   SERVICE {s['name']}  serviceId={s['id']}  environmentId={i['environmentId']} ({envs.get(i['environmentId'])})  image={(i['source'] or {}).get('image')}")


def variables(pid, eid, sid):
    r = gql("query($p:String!,$e:String!,$s:String!){ variables(projectId:$p, environmentId:$e, serviceId:$s) }",
            {"p": pid, "e": eid, "s": sid})
    print(json.dumps(r.get("data", r), indent=1))


if __name__ == "__main__":
    # python3 rw.py projects                 → every project / service / environment id
    # python3 rw.py vars <projectId> <environmentId> <serviceId>   → that service's variables (incl. *_PUBLIC_URL)
    cmd = sys.argv[1] if len(sys.argv) > 1 else "projects"
    projects() if cmd == "projects" else variables(*sys.argv[2:5])
