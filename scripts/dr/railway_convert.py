#!/usr/bin/env python3
# Convert a Railway Mongo service to a single-node replica set by setting a
# self-provisioning keyfile start command. Uses curl (Cloudflare blocks urllib).
import json, os, subprocess, sys

RTOK = os.environ["RTOK"]
PID = os.environ["PID"]; EID = os.environ["EID"]; SID = os.environ["SID"]
KB = os.environ["KB"]                      # base64(keyfile-content)
EXTRA = os.environ.get("EXTRA", "--ipv6 --bind_ip ::,0.0.0.0 --setParameter diagnosticDataCollectionEnabled=false")

START = ("bash -c 'set -e; KF=/data/db/rs.key; printf \"%s\" \"$MONGO_KEYFILE_B64\" | base64 -d > \"$KF\"; "
         "chmod 400 \"$KF\"; chown 999:999 \"$KF\" || true; "
         "exec docker-entrypoint.sh mongod --replSet rs0 --keyFile \"$KF\" " + EXTRA + "'")

def gql(query, variables):
    body = json.dumps({"query": query, "variables": variables})
    p = subprocess.run(["curl","-s","-X","POST","https://backboard.railway.app/graphql/v2",
        "-H","Content-Type: application/json","-H","Authorization: Bearer "+RTOK,
        "--data","@-"], input=body, capture_output=True, text=True)
    try: return json.loads(p.stdout)
    except Exception: return {"raw": p.stdout[:300]}

# 1) keyfile variable
r1 = gql("mutation($in: VariableUpsertInput!){ variableUpsert(input:$in) }",
    {"in":{"projectId":PID,"environmentId":EID,"serviceId":SID,"name":"MONGO_KEYFILE_B64","value":KB,"skipDeploys":True}})
print("variableUpsert:", json.dumps(r1)[:200])

# 2) start command
r2 = gql("mutation($sid:String!,$eid:String!,$in:ServiceInstanceUpdateInput!){ serviceInstanceUpdate(serviceId:$sid, environmentId:$eid, input:$in) }",
    {"sid":SID,"eid":EID,"in":{"startCommand":START}})
print("serviceInstanceUpdate:", json.dumps(r2)[:200])

# 3) redeploy
r3 = gql("mutation($sid:String!,$eid:String!){ serviceInstanceRedeploy(serviceId:$sid, environmentId:$eid) }",
    {"sid":SID,"eid":EID})
print("serviceInstanceRedeploy:", json.dumps(r3)[:200])
print("START_CMD:", START)
