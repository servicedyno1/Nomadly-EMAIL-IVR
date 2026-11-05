// Merges re-translated 15-line pieces into the known-good fa.raw.js one at a time, keeping only those that stay valid JS.
const fs = require('fs')
const { execFileSync } = require('child_process')
const good = fs.readFileSync(process.argv[2], 'utf8').split('\n')
const cand = fs.readFileSync(process.argv[3], 'utf8').split('\n')
const out = process.argv[4]
const valid = lines => { fs.writeFileSync(out, lines.join('\n')); try { execFileSync('node', ['--check', out], { stdio: 'ignore' }); return true } catch { return false } }
let cur = good.slice(), kept = 0, dropped = 0
for (let s = 0; s < good.length; s += 15) {
  const a = good.slice(s, s + 15).join('\n'), b = cand.slice(s, s + 15).join('\n')
  if (a === b) continue
  const trial = cur.slice(); trial.splice(s, 15, ...cand.slice(s, s + 15))
  if (valid(trial)) { cur = trial; kept++ } else dropped++
}
valid(cur)
console.log(`kept ${kept}, dropped ${dropped}`)
