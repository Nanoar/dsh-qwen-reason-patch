#!/usr/bin/env node
/* qwen-thinking-no-replay (v3 runtime whitelist) — 停用本地思考模型的历史思考回放。
 * v3 起用 qreasonIds() 运行时白名单（QREASON_PROVIDER_IDS env / $DSH_HOME/qwen-reason.json
 * / 缺省 ["home"]）替代硬编码 `model.provider !== "home"`，其它 provider（OpenRouter 等）
 * 不受影响。注入三处：aliased fs import + qreasonIds() 函数 + guard 加 `!qreasonIds().includes(...)`。
 * 幂等；--dry-run 预览。Usage: node apply-patches.cjs [DSH_ROOT] [--dry-run] */
'use strict';
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicitRoot = args.find((a) => !a.startsWith('--'));
function findDshHome(){ const e=process.env.DASH_HOME||process.env.DSH_HOME; if(e&&fs.existsSync(path.join(e,'settings.yaml'))) return e; for(const d of ['/storage/Users/currentUser/AISpace/.devtools/dsh-home','/storage/Users/currentUser/.dsh']) if(fs.existsSync(path.join(d,'settings.yaml'))) return d; return null; }
function findDshRoot(explicit){ if(explicit){ if(!fs.existsSync(path.join(explicit,'node_modules'))){ console.error('not a DSH root: '+explicit); process.exit(1);} return explicit; } const home=findDshHome(); if(home){ let dj; try{ dj=JSON.parse(fs.readFileSync(path.join(home,'dsh.json'),'utf8')); }catch{} const prof=(dj&&dj.profiles&&(dj.profiles.web||dj.profiles.default))||{}; let p=prof.installPath||''; for(let i=0;i<4&&p&&p!=='/';i++){ if(fs.existsSync(path.join(p,'node_modules','@deepseek-ai'))) return p; p=path.dirname(p); } } const g='/storage/Users/currentUser/AISpace/.devtools/npm-global/lib/node_modules/@deepseek-ai/dsh'; if(fs.existsSync(path.join(g,'node_modules'))) return g; console.error('DSH root not found'); process.exit(1); }
const DSH_ROOT = findDshRoot(explicitRoot);
const target = path.join(DSH_ROOT, 'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js');
let body; try { body = fs.readFileSync(target, 'utf8'); } catch (e) { console.error('MISSING: ' + target); process.exit(1); }

const GUARD_DONE = '!qreasonIds().includes(model.provider)';
if (body.includes(GUARD_DONE)) { console.log('already applied — nothing to do.'); process.exit(0); }

const FS_IMPORT = `import { existsSync as qf_e, readFileSync as qf_r } from "node:fs";\n`;
const QREASON_FN = `function qreasonIds(){try{const e=typeof process!=='undefined'&&process.env?process.env.QREASON_PROVIDER_IDS:'';if(e)return e.split(',').map(s=>s.trim()).filter(Boolean);const h=(typeof process!=='undefined'&&process.env?(process.env.DSH_HOME||process.env.DASH_HOME||''):'')||'';const f=h?h+'/qwen-reason.json':'';if(f&&qf_e(f)){const v=JSON.parse(qf_r(f,'utf8'));if(v&&Array.isArray(v.providers))return v.providers.filter(x=>typeof x==='string'&&x.length>0);}}catch(_e){}return ['home']}`;
let fail = 0;

// 1. import
if (body.includes('existsSync as qf_e')) { console.log('import already present'); }
else { body = FS_IMPORT + body; console.log('import injected'); }

// 2. qreasonIds() before buildParams
if (body.includes('function qreasonIds')) { console.log('qreasonIds already present'); }
else {
  const anchor = 'function buildParams(model, context, options, compat';
  const i = body.indexOf(anchor);
  if (i === -1) { console.error('ANCHOR NOT FOUND: buildParams — pi-ai dist changed shape; patch manually.'); fail++; }
  else { body = body.slice(0, i) + QREASON_FN + '\n' + body.slice(i); console.log('qreasonIds injected'); }
}

// 3. guard
const oldGuard = 'isOpenAICompletionsReasoningField(signature))';
const newGuard = 'isOpenAICompletionsReasoningField(signature) && !qreasonIds().includes(model.provider))';
if (body.includes('!qreasonIds().includes(model.provider)')) { console.log('guard already patched'); }
else {
  const n = body.split(oldGuard).length - 1;
  if (n !== 1) { console.error('guard anchor MISMATCH (' + n + ') — patch manually.'); fail++; }
  else { body = body.replace(oldGuard, newGuard); console.log('guard patched'); }
}

if (fail) { console.error('aborted: ' + fail + ' step(s) failed, no write.'); process.exit(1); }
if (dryRun) { console.log('[dry-run] would patch ' + path.relative(DSH_ROOT, target)); process.exit(0); }
fs.writeFileSync(target, body);
console.log('patched: ' + path.relative(DSH_ROOT, target));
console.log('RESTART dsh web for the change to take effect.');
