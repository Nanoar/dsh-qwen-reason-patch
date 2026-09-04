#!/usr/bin/env node
/* qwen-reason-patch master — 依次执行全部 4 个子补丁（幂等）。
 * 用法:
 *   node apply-all.cjs [DSH_ROOT] [--dry-run]
 *   QREASON_PROVIDER_IDS=home2 node apply-all.cjs   # 目标 provider 白名单(单 id)
 * DSH_ROOT 缺省自动探测 npm-global/@deepseek-ai/dsh。 */
'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'); const path = require('node:path');
const os = require('node:os');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicit = args.find((a) => !a.startsWith('--'));
const DSH_ROOT = explicit || '/storage/Users/currentUser/AISpace/.devtools/npm-global/lib/node_modules/@deepseek-ai/dsh';
const HERE = __dirname;
const SUB = [
  'qwen-thinking-no-replay',
  'compaction-summary-no-thinking',
  'max-tokens-floor',
  'token-meter-skip-reasoning-home',
];
const retarget = (process.env.QREASON_PROVIDER_IDS || '').trim();
if (retarget && retarget.includes(',')) { console.error('QREASON_PROVIDER_IDS: 当前仅支持单个 provider id（多 id 需先改判断为成员列表）。'); process.exit(1); }
if (!fs.existsSync(path.join(DSH_ROOT, 'node_modules'))) { console.error('DSH root not found: ' + DSH_ROOT); process.exit(1); }
const tmpRoot = path.join(HERE, '.apply-run');
let failed = 0;
for (const name of SUB) {
  const scriptPath = path.join(HERE, name, 'apply-patches.cjs');
  if (!fs.existsSync(scriptPath)) { console.error('missing: ' + scriptPath); failed++; continue; }
  let runScript = scriptPath;
  if (retarget && retarget !== 'home') {
    let text = fs.readFileSync(scriptPath, 'utf8');
    const before = text;
    text = text.split('"home"').join('"' + retarget + '"').split("'home'").join("'" + retarget + "'");
    if (text === before) { console.error('retarget no-op for ' + name); }
    fs.mkdirSync(tmpRoot, { recursive: true });
    runScript = path.join(tmpRoot, name + '.apply-patches.cjs');
    fs.writeFileSync(runScript, text);
  }
  const argv = [runScript, DSH_ROOT, ...(dryRun ? ['--dry-run'] : [])];
  const r = spawnSync(process.execPath, argv, { stdio: 'inherit' });
  if (r.status !== 0) { console.error('FAILED: ' + name); failed++; }
}
if (fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
if (failed) { console.error('done with ' + failed + ' failure(s).'); process.exit(1); }
console.log('qwen-reason-patch: all sub-patches OK. RESTART dsh web.');
