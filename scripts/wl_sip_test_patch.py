import sys
W = sys.argv[1]


def patch(path, a, b):
    p = f"{W}/{path}"
    s = open(p).read()
    assert s.count(a) == 1, f"{path}: {a[:60]}"
    open(p, "w").write(s.replace(a, b))


patch("js/_index.js",
      "    const extra = n && planLifecycle.sipLoginOk(",
      "    if (!n) {\n"
      "      const t = await db.collection('testCredentials').findOne({ sipUsername: u, expired: { $ne: true } }, { projection: { sipPassword: 1 } })\n"
      "      return t?.sipPassword ? res.type('text/plain').send(String(t.sipPassword)) : res.sendStatus(404)\n"
      "    }\n"
      "    const extra = n && planLifecycle.sipLoginOk(")
T = "frontend/src/cloudivr/pages/landing/tryApi.js"
patch(T, "import { api } from '../../api';", "import { api } from '../../api';\nimport { startSipLine } from '../../sipClient';")
patch(T, "    import('@telnyx/webrtc')", "    if (call.webrtc?.wss) return sipCall(call, cur, setState, setMsg);\n    import('@telnyx/webrtc')")
fn = open("/tmp/wlsip/sipcall_fn.js").read()
patch(T, "// Browser call on the one-call test line", fn + "\n// Browser call on the one-call test line")
print("patched")
