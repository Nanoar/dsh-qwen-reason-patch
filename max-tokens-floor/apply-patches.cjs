#!/usr/bin/env node
/* max-tokens-floor — 本地 llama/Qwen 1-token 停摆的症状修复（末站兜底）。
 * pi-ai openai-completions buildParams：当请求带 <=256 的病态小输出上限时
 * （实测 =1，导致 prefill 4 万+ token 后只吐 1 token 即 length 截断），
 * 改写为模型声明 maxTokens（缺省 32768）；正常上限（压缩 8192 等）原样透传。
 * Usage: node apply-patches.cjs [DSH_ROOT] [--dry-run]  幂等。 */
'use strict';
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicitRoot = args.find(a => !a.startsWith('--'));
function home(){ for (const d of ['/storage/Users/currentUser/AISpace/.devtools/dsh-home','/storage/Users/currentUser/.dsh']) if (fs.existsSync(path.join(d,'settings.yaml'))) return d; return null; }
function root(explicit){ if (explicit){ if (!fs.existsSync(path.join(explicit,'node_modules'))) process.exit(1); return explicit; }
  const npmGlobal='/storage/Users/currentUser/AISpace/.devtools/npm-global/lib/node_modules/@deepseek-ai/dsh';
  if (fs.existsSync(path.join(npmGlobal,'node_modules'))) return npmGlobal;
  process.exit(1); }
const DSH_ROOT=root(explicitRoot);
const target=path.join(DSH_ROOT,'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js');
let body; try{ body=fs.readFileSync(target,'utf8'); }catch(e){ console.error('MISSING: '+target); process.exit(1); }
const MARKER='maxTokens-floor';
if (body.includes(MARKER)){ console.log('already applied — nothing to do.'); process.exit(0); }
const anchor='if (options?.maxTokens) {\n        if (compat.maxTokensField === "max_tokens") {\n            params.max_tokens = options.maxTokens;\n        }\n        else {\n            params.max_completion_tokens = options.maxTokens;\n        }\n    }';
if (!body.includes(anchor)){ console.error('ANCHOR NOT FOUND — pi-ai dist changed; patch buildParams max-tokens assignment manually.'); process.exit(1); }
const patched='/* LOCAL PATCH ('+MARKER+'): never send a <=256 output cap (local Qwen then\n'+
'         * emits 1 token and stops). Recompute to the model declared maxTokens;\n'+
'         * normal caps pass unchanged. Symptom fix at the last seam before the wire. */\n'+
'    if (options?.maxTokens) {\n        const cap = Number(options.maxTokens);\n'+
'        const sane = (Number.isFinite(model.maxTokens) && model.maxTokens >= 256) ? model.maxTokens : 32768;\n'+
'        const capOut = cap >= 256 ? cap : sane;\n        if (compat.maxTokensField === "max_tokens") {\n            params.max_tokens = capOut;\n        }\n        else {\n            params.max_completion_tokens = capOut;\n        }\n    }';
if (dryRun){ console.log('[dry-run] would patch '+path.relative(DSH_ROOT,target)); process.exit(0); }
fs.writeFileSync(target, body.replace(anchor, patched));
console.log('patched: '+path.relative(DSH_ROOT,target));
console.log('RESTART dsh web for it to take effect.');
