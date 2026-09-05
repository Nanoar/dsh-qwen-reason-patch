#!/usr/bin/env node
/* token-meter-exclude-thinking (home-scoped) — 压缩触发阈值对 home 路由剔除瞬态思考。
 * 背景：pi-ai 把 reasoning 折进 outputTokens，导致 home 的可见上下文被思考顶过
 * compaction-basic 阈值(0.8×contextWindow)提前压缩。本补丁让 totalTokens 对 home
 * 只算可见上下文(输入+回答+工具结果)，云端(deepseek 等)思考仍计入(它们回放思考)。
 * 注入/改动：aliased fs import + qreasonIds() + estimateReasoning() +
 * _estimateProviderAssistant 返回对象 + _foldEvent 存 reasoningTokens +
 * measure() 加 isHome 守卫并只对 home 减 reasoning。幂等；--dry-run 预览。
 * Usage: node apply-patches.cjs [DSH_ROOT] [--dry-run] */
'use strict';
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicitRoot = args.find((a) => !a.startsWith('--'));
function findDshHome(){ const e=process.env.DASH_HOME||process.env.DSH_HOME; if(e&&fs.existsSync(path.join(e,'settings.yaml'))) return e; for(const d of ['/storage/Users/currentUser/AISpace/.devtools/dsh-home','/storage/Users/currentUser/.dsh']) if(fs.existsSync(path.join(d,'settings.yaml'))) return d; return null; }
function findDshRoot(explicit){ if(explicit){ if(!fs.existsSync(path.join(explicit,'node_modules'))){ console.error('not a DSH root: '+explicit); process.exit(1);} return explicit; } const home=findDshHome(); if(home){ let dj; try{ dj=JSON.parse(fs.readFileSync(path.join(home,'dsh.json'),'utf8')); }catch{} const prof=(dj&&dj.profiles&&(dj.profiles.web||dj.profiles.default))||{}; let p=prof.installPath||''; for(let i=0;i<4&&p&&p!=='/';i++){ if(fs.existsSync(path.join(p,'node_modules','@deepseek-ai'))) return p; p=path.dirname(p); } } const g='/storage/Users/currentUser/AISpace/.devtools/npm-global/lib/node_modules/@deepseek-ai/dsh'; if(fs.existsSync(path.join(g,'node_modules'))) return g; console.error('DSH root not found'); process.exit(1); }
const DSH_ROOT = findDshRoot(explicitRoot);
const target = path.join(DSH_ROOT, 'node_modules/@deepseek-ai/dsh-token-meter/lib/index.js');
let body; try { body = fs.readFileSync(target, 'utf8'); } catch (e) { console.error('MISSING: ' + target); process.exit(1); }

if (body.includes('exclude-thinking-from-meter')) { console.log('already applied — nothing to do.'); process.exit(0); }

const FS_IMPORT = `import { existsSync as qf_e, readFileSync as qf_r } from "node:fs";\n`;
const QREASON_FN = `function qreasonIds(){try{const e=typeof process!=='undefined'&&process.env?process.env.QREASON_PROVIDER_IDS:'';if(e)return e.split(',').map(s=>s.trim()).filter(Boolean);const h=(typeof process!=='undefined'&&process.env?(process.env.DSH_HOME||process.env.DASH_HOME||''):'')||'';const f=h?h+'/qwen-reason.json':'';if(f&&qf_e(f)){const v=JSON.parse(qf_r(f,'utf8'));if(v&&Array.isArray(v.providers))return v.providers.filter(x=>typeof x==='string'&&x.length>0);}}catch(_e){}return ['home']}`;
let fail = 0;
function step(fn, label) { try { const r = fn(); if (r !== undefined) console.log(label + ': ' + r); } catch (e) { console.error(label + ': ' + e.message); fail++; } }

// 1. fs import
if (body.includes('existsSync as qf_e')) console.log('fs import: already present');
else { body = FS_IMPORT + body; console.log('fs import: injected'); }

// 2. qreasonIds() before estimateContent
if (body.includes('function qreasonIds')) console.log('qreasonIds: already present');
else {
  const a = 'function estimateContent(blocks) {';
  if (body.split(a).length - 1 !== 1) { console.error('qreasonIds anchor mismatch'); fail++; }
  else { body = body.replace(a, QREASON_FN + '\n' + a); console.log('qreasonIds: injected'); }
}

// 3. estimateReasoning before estimateMessage
if (body.includes('function estimateReasoning')) console.log('estimateReasoning: already present');
else {
  const a = 'function estimateMessage(message) {\n\treturn estimateContent(message.content) + 4;\n}';
  const b = '/**\n * LOCAL PATCH (exclude-thinking-from-meter): price only reasoning blocks so the\n * usage-path baseline can subtract the current turn\'s thinking (pi-ai folds\n * reasoning into outputTokens) and leave the visible context as pressure.\n */\nfunction estimateReasoning(blocks) {\n\tlet tokens = 0;\n\tfor (const block of blocks) switch (block.type) {\n\t\tcase "reasoning":\n\t\t\ttokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;\n\t\t\tbreak;\n\t\tcase "tool-result":\n\t\t\ttokens += estimateReasoning(block.content);\n\t\t\tbreak;\n\t}\n\treturn tokens;\n}\n' + a;
  if (body.split(a).length - 1 !== 1) { console.error('estimateReasoning anchor mismatch'); fail++; }
  else { body = body.replace(a, b); console.log('estimateReasoning: injected'); }
}

// 4. _estimateProviderAssistant -> object
{
  const a = '\t\tif (sourceSeqs === void 0) return durableEventTokens;';
  const b = '\t\tif (sourceSeqs === void 0) return { tokens: durableEventTokens, reasoningTokens: 0 };';
  if (body.includes(b)) console.log('provider-assistant fallback: already object');
  else if (body.split(a).length - 1 !== 1) { console.error('provider-assistant fallback anchor mismatch'); fail++; }
  else { body = body.replace(a, b); console.log('provider-assistant fallback: object'); }
}
{
  const a = '\t\tconst providerContent = assembler.blocks();\n\t\treturn providerContent.length === 0 ? 0 : estimateContent(providerContent) + 4;';
  const b = '\t\tconst providerContent = assembler.blocks();\n\t\tif (providerContent.length === 0) return { tokens: 0, reasoningTokens: 0 };\n\t\treturn {\n\t\t\ttokens: estimateContent(providerContent) + 4,\n\t\t\treasoningTokens: estimateReasoning(providerContent)\n\t\t};';
  if (body.includes(b)) console.log('provider-assistant return: already object');
  else if (body.split(a).length - 1 !== 1) { console.error('provider-assistant return anchor mismatch'); fail++; }
  else { body = body.replace(a, b); console.log('provider-assistant return: object'); }
}

// 5. _foldEvent store reasoningTokens
{
  const a = '\t\t\tconst eventTokens = plan.tokens;\n\t\t\tif (event.data.usage !== void 0 && nextHeader !== void 0) nextAnchor = {\n\t\t\t\theader: nextHeader,\n\t\t\t\tnodes: stepStart.nodes,\n\t\t\t\tassistantTokens: this._estimateProviderAssistant(session, event, eventTokens),\n\t\t\t\tusage: event.data.usage\n\t\t\t};\n\t\t\telse nextAnchor = {\n\t\t\t\theader: nextHeader,\n\t\t\t\tnodes: stepStart.nodes,\n\t\t\t\tassistantTokens: eventTokens,\n\t\t\t\tusage: void 0\n\t\t\t};';
  const b = '\t\t\tconst eventTokens = plan.tokens;\n\t\t\tif (event.data.usage !== void 0 && nextHeader !== void 0) {\n\t\t\t\tconst providerAssistant = this._estimateProviderAssistant(session, event, eventTokens);\n\t\t\t\tnextAnchor = {\n\t\t\t\t\theader: nextHeader,\n\t\t\t\t\tnodes: stepStart.nodes,\n\t\t\t\t\tassistantTokens: providerAssistant.tokens,\n\t\t\t\t\treasoningTokens: providerAssistant.reasoningTokens,\n\t\t\t\t\tusage: event.data.usage\n\t\t\t\t};\n\t\t\t}\n\t\t\telse nextAnchor = {\n\t\t\t\theader: nextHeader,\n\t\t\t\tnodes: stepStart.nodes,\n\t\t\t\tassistantTokens: eventTokens,\n\t\t\t\treasoningTokens: 0,\n\t\t\t\tusage: void 0\n\t\t\t};';
  if (body.includes(b)) console.log('foldEvent: already stores reasoningTokens');
  else if (body.split(a).length - 1 !== 1) { console.error('foldEvent anchor mismatch'); fail++; }
  else { body = body.replace(a, b); console.log('foldEvent: stores reasoningTokens'); }
}

// 6. measure() isHome guard + subtraction
{
  const a = '\t\tconst header = requestHeader === void 0 ? state.header : canonicalHeader(requestHeader);';
  const b = '\t\tconst header = requestHeader === void 0 ? state.header : canonicalHeader(requestHeader);\n\t\tconst isHome = qreasonIds().includes(header?.config?.provider ?? "");';
  if (body.includes('const isHome = qreasonIds()')) console.log('isHome: already present');
  else if (body.split(a).length - 1 !== 1) { console.error('isHome anchor mismatch'); fail++; }
  else { body = body.replace(a, b); console.log('isHome: added'); }
}
{
  const a = '\t\t\t\ttokens: usageTokens(usage),';
  const b = '\t\t\t\ttokens: isHome ? Math.max(0, usageTokens(usage) - (anchor.reasoningTokens ?? 0)) : usageTokens(usage),';
  if (body.includes('isHome ? Math.max(0, usageTokens(usage)')) console.log('subtraction: already guarded');
  else if (body.split(a).length - 1 !== 1) { console.error('subtraction anchor mismatch'); fail++; }
  else { body = body.replace(a, b); console.log('subtraction: guarded by isHome'); }
}

if (fail) { console.error('aborted: ' + fail + ' step(s) failed, no write.'); process.exit(1); }
if (dryRun) { console.log('[dry-run] would patch ' + path.relative(DSH_ROOT, target)); process.exit(0); }
fs.writeFileSync(target, body);
console.log('patched: ' + path.relative(DSH_ROOT, target));
console.log('RESTART dsh web for the change to take effect.');
