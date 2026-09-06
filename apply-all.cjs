#!/usr/bin/env node
/* qwen-reason-patch master — 依次执行全部 4 个子补丁（幂等）。
 * 用法:
 *   node apply-all.cjs [DSH_ROOT] [--dry-run]
 * DSH_ROOT 缺省自动探测 npm-global/@deepseek-ai/dsh。 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicit = args.find((a) => !a.startsWith('--'));
const DSH_ROOT = explicit || '/storage/Users/currentUser/AISpace/.devtools/npm-global/lib/node_modules/@deepseek-ai/dsh';
const HERE = __dirname;
const SUB = [
  'qwen-thinking-no-replay',
  'compaction-disable-thinking',
  'home-exclude-thinking-context',
  'token-meter-exclude-thinking',
];
if (!fs.existsSync(path.join(DSH_ROOT, 'node_modules'))) { console.error('DSH root not found: ' + DSH_ROOT); process.exit(1); }
let failed = 0;
for (const name of SUB) {
  const scriptPath = path.join(HERE, name, 'apply-patches.cjs');
  if (!fs.existsSync(scriptPath)) { console.error('missing: ' + scriptPath); failed++; continue; }
  const argv = [scriptPath, DSH_ROOT, ...(dryRun ? ['--dry-run'] : [])];
  const r = spawnSync(process.execPath, argv, { stdio: 'inherit' });
  if (r.status !== 0) { console.error('FAILED: ' + name); failed++; }
}
if (failed) { console.error('done with ' + failed + ' failure(s).'); process.exit(1); }
console.log('qwen-reason-patch: all sub-patches OK. RESTART dsh web.');
