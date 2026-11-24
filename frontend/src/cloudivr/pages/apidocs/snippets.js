export const BASE = `${window.location.origin}/cloudivr-web`;
const KEY = 'civr_live_YOUR_KEY';
const pretty = (b) => JSON.stringify(b, null, 2);
const indent = (s, n) => s.split('\n').map((l, i) => (i ? ' '.repeat(n) + l : l)).join('\n');

// One request → cURL / Node.js / Python samples.
export function samples(method, path, body) {
  const url = `${BASE}${path}`;
  const curl = [`curl -X ${method} ${url}`, `  -H "Authorization: Bearer ${KEY}"`]
    .concat(body ? ['  -H "Content-Type: application/json"', `  -d '${indent(pretty(body), 6)}'`] : [])
    .join(' \\\n');
  const node = `const res = await fetch("${url}", {
  method: "${method}",
  headers: {
    Authorization: "Bearer ${KEY}",${body ? '\n    "Content-Type": "application/json",' : ''}
  },${body ? `\n  body: JSON.stringify(${indent(pretty(body), 2)}),` : ''}
});
console.log(res.status, await res.json());`;
  const py = (body ? pretty(body).replace(/\btrue\b/g, 'True').replace(/\bfalse\b/g, 'False').replace(/\bnull\b/g, 'None') : '');
  const python = `import requests

res = requests.${method.toLowerCase()}(
    "${url}",
    headers={"Authorization": "Bearer ${KEY}"},${body ? `\n    json=${indent(py, 4)},` : ''}
)
print(res.status_code, res.json())`;
  return { cURL: curl, 'Node.js': node, Python: python };
}
