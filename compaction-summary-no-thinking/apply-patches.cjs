#!/usr/bin/env node
/* compaction-summary-no-thinking (v3) — 官方压缩摘要调用对本地 home 模型思考降档到 "low"。
 * v3 起用 qreasonIds() 运行时白名单（同 qwen-thinking-no-replay）替代硬编码
 * target.provider === "home"。注入三处：aliased fs import + qreasonIds() 函数 +
 * summarizeWithLlm options 加 `...(qreasonIds().includes(target.provider) ? { reasoningEffort:"low" } : {})`。
 * 幂等；--dry-run 预览。Usage: node apply-patches.cjs [DSH_ROOT] [--dry-run] */
'use strict';
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicitRoot = args.find((a) => !a.startsWith('--'));
function findDshHome(){ const e=process.env.DASH_HOME||process.env.DSH_HOME; if(e&&fs.existsSync(path.join(e,'settings.yaml'))) return e; for(const d of ['/storage/Users/currentUser/AISpace/.devtools/dsh-home','/storage/Users/currentUser/.dsh']) if(fs.existsSync(path.join(d,'settings.yaml'))) return d; return null; }
function findDshRoot(explicit){ if(explicit){ if(!fs.existsSync(path.join(explicit,'node_modules'))){ console.error('not a DSH root: '+explicit); process.exit(1);} return explicit; } const home=findDshHome(); if(home){ let dj; try{ dj=JSON.parse(fs.readFileSync(path.join(home,'dsh.json'),'utf8')); }catch{} const prof=(dj&&dj.profiles&&(dj.profiles.web||dj.profiles.default))||{}; let p=prof.installPath||''; for(let i=0;i<4&&p&&p!=='/';i++){ if(fs.existsSync(path.join(p,'node_modules','@deepseek-ai'))) return p; p=path.dirname(p); } } const g='/storage/Users/currentUser/AISpace/.devtools/npm-global/lib/node_modules/@deepseek-ai/dsh'; if(fs.existsSync(path.join(g,'node_modules'))) return g; console.error('DSH root not found'); process.exit(1); }
const DSH_ROOT = findDshRoot(explicitRoot);
const target = path.join(DSH_ROOT, 'node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js');
let body; try { body = fs.readFileSync(target, 'utf8'); } catch (e) { console.error('MISSING: ' + target); process.exit(1); }

const MARKER = 'compaction-summary-no-thinking';
if (body.includes(MARKER)) { console.log('already applied — nothing to do.'); process.exit(0); }

const FS_IMPORT = `import { existsSync as qf_e, readFileSync as qf_r } from "node:fs";\n`;
const QREASON_FN = `function qreasonIds(){try{const e=typeof process!=='undefined'&&process.env?process.env.QREASON_PROVIDER_IDS:'';if(e)return e.split(',').map(s=>s.trim()).filter(Boolean);const h=(typeof process!=='undefined'&&process.env?(process.env.DSH_HOME||process.env.DASH_HOME||''):'')||'';const f=h?h+'/qwen-reason.json':'';if(f&&qf_e(f)){const v=JSON.parse(qf_r(f,'utf8'));if(v&&Array.isArray(v.providers))return v.providers.filter(x=>typeof x==='string'&&x.length>0);}}catch(_e){}return ['home']}`;
let fail = 0;

// 1. import
if (body.includes('existsSync as qf_e')) { console.log('import already present'); }
else { body = FS_IMPORT + body; console.log('import injected'); }

// 2. qreasonIds() before summarizeWithLlm
if (body.includes('function qreasonIds')) { console.log('qreasonIds already present'); }
else {
  const anchor = 'async function summarizeWithLlm(ctx, config, input, agent, signal)';
  const i = body.indexOf(anchor);
  if (i === -1) { console.error('ANCHOR NOT FOUND: summarizeWithLlm — patch manually.'); fail++; }
  else { body = body.slice(0, i) + QREASON_FN + '\n' + body.slice(i); console.log('qreasonIds injected'); }
}

// 3. reasoningEffort line before the signal spread
const re = /(purpose: "compaction",)(\r?\n)([ \t]*)(\.\.\.signal === void 0 \? \{\} : \{ signal \})/;
if (!re.test(body)) { console.error('ANCHOR NOT FOUND: purpose/signal — compaction-basic dist changed shape; patch manually.'); fail++; }
else {
  const comment = '$3// LOCAL PATCH (' + MARKER + '): cheapest supported reasoning effort "low" for the\n$3// local home compaction summarization call (full-strength thinking burns the\n$3// output budget -> "truncated at the token cap" / "no text summary content").\n$3// "none"/"off" are not declared levels of this model. Cloud stays untouched.\n';
  const insert = '$3...(qreasonIds().includes(target.provider) ? { reasoningEffort: "low" } : {}),';
  body = body.replace(re, '$1$2' + comment + insert + '$2$3$4');
  console.log('reasoningEffort line inserted');
}

if (fail) { console.error('aborted: ' + fail + ' step(s) failed, no write.'); process.exit(1); }
if (dryRun) { console.log('[dry-run] would patch ' + path.relative(DSH_ROOT, target)); process.exit(0); }
fs.writeFileSync(target, body);
console.log('patched: ' + path.relative(DSH_ROOT, target));
console.log('RESTART dsh web for the change to take effect.');
