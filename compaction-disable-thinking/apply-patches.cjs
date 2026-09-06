#!/usr/bin/env node
/* compaction-disable-thinking — 替换 compaction-summary-no-thinking（reasoningEffort:"low" 治标）。
 *
 * 根因：home 模型的 compat.thinkingFormat 是 "openai"（pi-ai 对它不发 enable_thinking），
 * 且本地 Qwen3.8-27B 模板 enable_thinking 缺省为开、只认二值开关不认细粒度预算。所以
 * 旧的 reasoningEffort:"low" 只是把 reasoning_effort:"low" 发过去、实际仍是思考全开，
 * 摘要把 maxTokens(默认8192) 打满 → "summarization truncated at the token cap"。
 *
 * 方案3（治本）：
 *   A. 摘要关思考：pi-ai 对 home + purpose==="compaction" 直接发
 *      chat_template_kwargs:{ enable_thinking:false }（经 jinja 模板 kwargs，llama.cpp 认）。
 *   B. 摘要 maxTokens 取模型配置的 maxTokens（12288）而非插件默认 8192。
 * 非 home（云端 deepseek 等）不变。
 *
 * 用法: node apply-patches.cjs [DSH_ROOT] [--dry-run]   幂等。
 */
'use strict';
const fs = require('node:fs'); const path = require('node:path');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const explicitRoot = args.find((a) => !a.startsWith('--'));

function findDshHome(){ const e=process.env.DASH_HOME||process.env.DSH_HOME; if(e&&fs.existsSync(path.join(e,'settings.yaml'))) return e; for(const d of ['/storage/Users/currentUser/AISpace/.devtools/dsh-home','/storage/Users/currentUser/.dsh']) if(fs.existsSync(path.join(d,'settings.yaml'))) return d; return null; }
function findDshRoot(explicit){ if(explicit){ if(!fs.existsSync(path.join(explicit,'node_modules'))){ console.error('not a DSH root: '+explicit); process.exit(1);} return explicit; } const home=findDshHome(); if(home){ let dj; try{ dj=JSON.parse(fs.readFileSync(path.join(home,'dsh.json'),'utf8')); }catch{} const prof=(dj&&dj.profiles&&(dj.profiles.web||dj.profiles.default))||{}; let p=prof.installPath||''; for(let i=0;i<4&&p&&p!=='/';i++){ if(fs.existsSync(path.join(p,'node_modules','@deepseek-ai'))) return p; p=path.dirname(p); } } const g='/storage/Users/currentUser/AISpace/.devtools/npm-global/lib/node_modules/@deepseek-ai/dsh'; if(fs.existsSync(path.join(g,'node_modules'))) return g; console.error('DSH root not found'); process.exit(1); }
const DSH_ROOT = findDshRoot(explicitRoot);

function readFile(file) {
  try { return fs.readFileSync(file, 'utf8'); }
  catch (e) { console.error('MISSING: ' + file); process.exit(1); }
}
function applyEdits(file, edits) {
  let body = readFile(file);
  let changed = false;
  for (const [label, marker, anchor, replacement] of edits) {
    if (body.includes(marker)) { console.log('  ok (already): ' + label); continue; }
    const n = body.split(anchor).length - 1;
    if (n === 0) { console.error('  ANCHOR NOT FOUND: ' + label); return 1; }
    if (n > 1) { console.error('  ANCHOR AMBIGUOUS (' + n + '): ' + label); return 1; }
    body = body.replace(anchor, replacement);
    changed = true;
    console.log('  patched: ' + label);
  }
  if (changed) {
    if (dryRun) { console.log('  [dry-run] would write ' + path.relative(DSH_ROOT, file)); }
    else fs.writeFileSync(file, body);
  }
  return 0;
}
/** Remove `anchor` when `presenceMarker` is present; idempotent. */
function revertIfPresent(file, label, presenceMarker, anchor) {
  let body = readFile(file);
  if (!body.includes(presenceMarker)) { console.log('  ok (absent): ' + label); return 0; }
  const n = body.split(anchor).length - 1;
  if (n !== 1) { console.error('  REVERT ANCHOR MISMATCH (' + n + '): ' + label); return 1; }
  body = body.replace(anchor, '');
  if (dryRun) { console.log('  [dry-run] would revert ' + label); }
  else { fs.writeFileSync(file, body); console.log('  reverted: ' + label); }
  return 0;
}

// ---- 1. dsh-compaction-basic: revert old "low" patch + summary maxTokens ----
const COMPACT = path.join(DSH_ROOT, 'node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js');
const OLD_LOW_BLOCK = '\t\t// LOCAL PATCH (compaction-summary-no-thinking): the local llm (home,\n' +
  '\t\t// llama.cpp / Qwen APEX) thinks at full strength by default when a\n' +
  '\t\t// summarization request carries no reasoning effort, so an official\n' +
  '\t\t// compaction call burns its whole output budget on reasoning and dies\n' +
  '\t\t// with "truncated at the token cap" / "no text summary content".\n' +
  '\t\t// Stamp the CHEAPEST supported wire level ("low", declared by the home\n' +
  '\t\t// model) for home only — cloud (deepseek-official) is untouched. "none"\n' +
  '\t\t// was rejected by the adapter (level not declared), and full "off" is\n' +
  '\t\t// not offered by this model, so low keeps a light thinking budget.\n' +
  '\t\t...(qreasonIds().includes(target.provider) ? { reasoningEffort: "low" } : {}),\n';
const UNPATCHED_OPTIONS = '\tconst options = {\n\t\tprovider: target.provider,\n\t\tmodel: target.model,\n\t\tmessages,\n' +
  '\t\t...input.system === void 0 ? {} : { system: input.system },\n' +
  '\t\t...input.tools === void 0 ? {} : { tools: [...input.tools] },\n' +
  '\t\tmaxTokens: config.maxTokens,\n\t\tsessionId: agent.session.id,\n\t\tpurpose: "compaction",\n' +
  '\t\t...signal === void 0 ? {} : { signal }\n\t};';
const NEW_OPTIONS = '\tlet summaryMaxTokens = config.maxTokens ?? 8192;\n' +
  '\ttry {\n' +
  '\t\tconst summaryInfo = await ctx.llm.resolveModelInfo(target.provider, target.model, signal);\n' +
  '\t\tif (summaryInfo.defaultMaxTokens !== void 0 && summaryInfo.defaultMaxTokens > 0) summaryMaxTokens = summaryInfo.defaultMaxTokens;\n' +
  '\t} catch { /* keep config/8192 fallback */ }\n' +
  '\tconst options = {\n\t\tprovider: target.provider,\n\t\tmodel: target.model,\n\t\tmessages,\n' +
  '\t\t...input.system === void 0 ? {} : { system: input.system },\n' +
  '\t\t...input.tools === void 0 ? {} : { tools: [...input.tools] },\n' +
  '\t\tmaxTokens: summaryMaxTokens,\n\t\tsessionId: agent.session.id,\n\t\tpurpose: "compaction",\n' +
  '\t\t...signal === void 0 ? {} : { signal }\n\t};';
let rc = revertIfPresent(COMPACT, 'old compaction-summary-no-thinking', 'reasoningEffort: "low"', OLD_LOW_BLOCK);
if (rc !== 0) process.exit(1);
rc = applyEdits(COMPACT, [
  ['summary maxTokens = model defaultMaxTokens', 'summaryMaxTokens', UNPATCHED_OPTIONS, NEW_OPTIONS],
]);
if (rc !== 0) process.exit(1);

// ---- 2. dsh-llm-pi-ai: forward purpose to pi-ai streamSimple ----
const ADAPTER = path.join(DSH_ROOT, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js');
rc = applyEdits(ADAPTER, [
  ['forward purpose to streamSimple', 'purpose: options.purpose',
    '\t\t\t\t\t...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },\n\t\t\t\t\tsignal: watchdog.signal,',
    '\t\t\t\t\t...options.sessionId === void 0 ? {} : { sessionId: String(options.sessionId) },\n\t\t\t\t\t...options.purpose === void 0 ? {} : { purpose: options.purpose },\n\t\t\t\t\tsignal: watchdog.signal,'],
]);
if (rc !== 0) process.exit(1);

// ---- 3. pi-ai openai-completions.js: forward purpose + disable thinking for compaction ----
const PIAI = path.join(DSH_ROOT, 'node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js');
rc = applyEdits(PIAI, [
  ['streamSimple forward purpose', 'purpose: options.purpose',
    '    return stream(model, context, {\n        ...base,\n        reasoningEffort,\n        thinkingBudgets: options?.thinkingBudgets,\n    });',
    '    return stream(model, context, {\n        ...base,\n        reasoningEffort,\n        thinkingBudgets: options?.thinkingBudgets,\n        ...options.purpose === void 0 ? {} : { purpose: options.purpose },\n    });'],
  ['disable thinking for home compaction', 'compaction-disable-thinking',
    '    else if (options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {\n        // OpenAI-style reasoning_effort\n        params.reasoning_effort = model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;\n    }',
    '    else if (compat.thinkingFormat === "openai" && model.reasoning && qreasonIds().includes(model.provider) && options?.purpose === "compaction") {\n        // LOCAL PATCH (compaction-disable-thinking): the local llama.cpp Qwen\n        // template defaults thinking ON and "low" effort is not honored, so a\n        // compaction summary burns its whole output budget on reasoning.\n        // Send enable_thinking:false through the jinja template kwargs instead.\n        params.chat_template_kwargs = { enable_thinking: false };\n    }\n    else if (options?.reasoningEffort && model.reasoning && compat.supportsReasoningEffort) {\n        // OpenAI-style reasoning_effort\n        params.reasoning_effort = model.thinkingLevelMap?.[options.reasoningEffort] ?? options.reasoningEffort;\n    }'],
]);
if (rc !== 0) process.exit(1);

console.log('compaction-disable-thinking: applied. RESTART dsh web for it to take effect.');
