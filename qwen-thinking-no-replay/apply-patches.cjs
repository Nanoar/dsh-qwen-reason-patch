#!/usr/bin/env node
/* qwen-thinking-no-replay apply-patches — disables per-turn thinking replay for
 * the local llm (home) provider in pi-ai's OpenAI-completions path. Usage:
 *   node apply-patches.cjs [DSH_ROOT] [--dry-run]
 * Idempotent; anchor located by the isOpenAICompletionsReasoningField call site,
 * so dist line-number drift across releases is tolerated. */
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicitRoot = args.find((a) => !a.startsWith('--'));

function findDshHome() {
  const envVar = process.env.DASH_HOME || process.env.DASH_HOME_DIR;
  if (envVar && (fs.existsSync(path.join(envVar, 'dsh.json')) || fs.existsSync(path.join(envVar, 'settings.yaml')))) return envVar;
  for (const d of ['/storage/Users/currentUser/AISpace/.devtools/dsh-home', '/storage/Users/currentUser/.dsh']) {
    if (fs.existsSync(path.join(d, 'dsh.json')) || fs.existsSync(path.join(d, 'settings.yaml'))) return d;
  }
  return null;
}

function findDshRoot(explicit) {
  if (explicit) {
    if (!fs.existsSync(path.join(explicit, 'node_modules'))) { console.error('error: not a DSH root: ' + explicit); process.exit(1); }
    return explicit;
  }
  const home = findDshHome();
  if (home) {
    let dshJson;
    try { dshJson = JSON.parse(fs.readFileSync(path.join(home, 'dsh.json'), 'utf8')); } catch {}
    const profile = (dshJson && dshJson.profiles && (dshJson.profiles.web || dshJson.profiles.default)) || {};
    let p = profile.installPath || '';
    for (let i = 0; i < 4 && p !== '/' && p !== ''; i++) {
      if (fs.existsSync(path.join(p, 'node_modules', '@deepseek-ai'))) return p;
      p = path.dirname(p);
    }
  }
  const npmGlobal = '/storage/Users/currentUser/AISpace/.devtools/npm-global/lib/node_modules/@deepseek-ai/dsh';
  if (fs.existsSync(path.join(npmGlobal, 'node_modules'))) return npmGlobal;
  console.error('error: could not locate the DSH root. Pass it explicitly.');
  process.exit(1);
}

const DSH_ROOT = findDshRoot(explicitRoot);
console.log('DSH root: ' + DSH_ROOT);
const target = path.join(DSH_ROOT, 'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js');
let body;
try { body = fs.readFileSync(target, 'utf8'); } catch (e) { console.error('MISSING FILE: ' + target); process.exit(1); }

const DONE = 'isOpenAICompletionsReasoningField(signature) && model.provider !== "home"';
if (body.includes(DONE)) {
  console.log('already applied — nothing to do.');
  process.exit(0);
}

/* Locate the anchor: the guard line contains isOpenAICompletionsReasoningField(signature)
 * and is immediately followed by the assistantMsg[signature] replay assignment. */
const lines = body.split('\n');
let hit = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('isOpenAICompletionsReasoningField(signature)') &&
      /assistantMsg\[signature\] = nonEmptyThinkingBlocks/.test(lines[i + 1] || '')) { hit = i; break; }
}
if (hit === -1) {
  console.error('ANCHOR NOT FOUND — pi-ai dist changed shape in a newer release; patch manually: add `&& model.provider !== "home"` to the isOpenAICompletionsReasoningField(signature) guard above the assistantMsg[signature] replay line.');
  process.exit(1);
}
const patched = lines.slice();
patched[hit] = patched[hit].replace(/isOpenAICompletionsReasoningField\(signature\)\)/, 'isOpenAICompletionsReasoningField(signature) && model.provider !== "home")');
if (!patched[hit].includes('model.provider !== "home"')) { console.error('patch failed at line ' + (hit + 1)); process.exit(1); }
const out = patched.join('\n');

console.log('anchor found at line ' + (hit + 1) + ':');
console.log('  - ' + lines[hit].trim());
console.log('  + ' + patched[hit].trim());
if (dryRun) { console.log('[dry-run] no write.'); process.exit(0); }
fs.writeFileSync(target, out);
console.log('patched: ' + path.relative(DSH_ROOT, target));
console.log('done. RESTART dsh web for the patch to take effect.');
