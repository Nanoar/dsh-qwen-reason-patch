#!/usr/bin/env node
/* compaction-summary-no-thinking apply-patches — the official compaction
 * summarization call for the local llm (home, llama.cpp / Qwen APEX) stamps
 * the CHEAPEST supported reasoning effort ("low") so the model does not burn
 * its whole output budget on full-strength thinking: without this, compaction
 * fails after ~3 min with "summarization truncated at the token cap" or
 * "summarization produced no text summary content".
 * Usage: node apply-patches.cjs [DSH_ROOT] [--dry-run]  (idempotent) */
'use strict';
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicitRoot = args.find((a) => !a.startsWith('--'));
function findDshHome(){ const e=process.env.DASH_HOME||process.env.DSH_HOME; if(e&&fs.existsSync(path.join(e,'settings.yaml'))) return e; for(const d of ['/storage/Users/currentUser/AISpace/.devtools/dsh-home','/storage/Users/currentUser/.dsh']) if(fs.existsSync(path.join(d,'settings.yaml'))) return d; return null; }
function findDshRoot(explicit){ if(explicit){ if(!fs.existsSync(path.join(explicit,'node_modules'))){ console.error('not a DSH root: '+explicit); process.exit(1);} return explicit; } const home=findDshHome(); if(home){ let dj; try{ dj=JSON.parse(fs.readFileSync(path.join(home,'dsh.json'),'utf8')); }catch{} const prof=(dj&&dj.profiles&&(dj.profiles.web||dj.profiles.default))||{}; let p=prof.installPath||''; for(let i=0;i<4&&p&&p!=='/';i++){ if(fs.existsSync(path.join(p,'node_modules','@deepseek-ai'))) return p; p=path.dirname(p); } } const g='/storage/Users/currentUser/AISpace/.devtools/npm-global/lib/node_modules/@deepseek-ai/dsh'; if(fs.existsSync(path.join(g,'node_modules'))) return g; console.error('DSH root not found'); process.exit(1); }
const DSH_ROOT=findDshRoot(explicitRoot);
const target=path.join(DSH_ROOT,'node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js');
let body; try{ body=fs.readFileSync(target,'utf8'); }catch(e){ console.error('MISSING: '+target); process.exit(1); }
const MARKER='compaction-summary-no-thinking';
if(body.includes(MARKER)){ console.log('already applied — nothing to do.'); process.exit(0); }
const re=/(purpose: "compaction",)(\r?\n)([ \t]*)(\.\.\.signal === void 0 \? \{\} : \{ signal \})/;
if(!re.test(body)){ console.error('ANCHOR NOT FOUND — patch manually: add `...(target.provider === "home" ? { reasoningEffort: "low" } : {})` in summarizeWithLlm options before the signal spread.'); process.exit(1); }
const comment='// LOCAL PATCH ('+MARKER+'): cheapest supported reasoning effort "low" for the\n$3// local home compaction summarization call (full-strength thinking burns the\n$3// output budget -> "truncated at the token cap" / "no text summary content";\n$3// "none"/"off" are not declared levels of this model). Cloud stays untouched.\n';
const insert='$3...(target.provider === "home" ? { reasoningEffort: "low" } : {}),';
const patched=body.replace(re,'$1$2'+comment+insert+'$2$4');
if(dryRun){ console.log('[dry-run] would patch '+path.relative(DSH_ROOT,target)); process.exit(0); }
fs.writeFileSync(target,patched);
console.log('patched: '+path.relative(DSH_ROOT,target));
console.log('RESTART dsh web for the change to take effect.');
