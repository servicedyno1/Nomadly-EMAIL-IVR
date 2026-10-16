#!/usr/bin/env node
// One-shot live patch: swap the addFundsTo SIP-unblock hook block in _index.js.
// Usage: node patch_sip_lowbalance.js <_index.js path> <old_block.txt> <new_block.txt>
const fs = require('fs')
const [file, oldFile, newFile] = process.argv.slice(2)
if (!file || !oldFile || !newFile) { console.error('args: <file> <old_block> <new_block>'); process.exit(2) }
const OLD = fs.readFileSync(oldFile, 'utf8')
const NEW = fs.readFileSync(newFile, 'utf8')
const src = fs.readFileSync(file, 'utf8')
if (src.includes(NEW.replace(/\n$/, '')) && !src.includes(OLD)) { console.log('ALREADY-PATCHED', file); process.exit(0) }
const occ = src.split(OLD).length - 1
if (occ !== 1) { console.error(`ABORT ${file}: found ${occ} occurrences of old block`); process.exit(3) }
fs.writeFileSync(file + '.bak_sipfix_' + Date.now(), src)
fs.writeFileSync(file, src.replace(OLD, NEW))
console.log('PATCHED', file)
