#!/usr/bin/env node
/* home-exclude-thinking-context — 本地 Qwen 思考不计入上下文估算（A+B 治本）。
 *
 * 根因：home Qwen 的思考块（DSH `reasoning` = pi-ai `thinking`）既不回放上 wire
 * （qwen-thinking-no-replay 已挡），也不该被计进"上下文占用"，但两处估算器仍把它
 * 当正文计价：
 *   A. pi-ai `clampMaxTokensToContext` 用 `estimateContextTokens`（含 thinking）算
 *      剩余空间 → 会话长了 available<=1 → maxTokens 被钳到 1 → "1-token 停摆"。
 *   B. dsh-token-meter `estimateContent` 把 `reasoning` 与 `text` 同价 → 表面节点
 *      token 含思考 → compaction 的 retainTokens 边界与 surface 压力被思考吃掉。
 *
 * 本补丁对 whitelist（qreasonIds，缺省 home）：
 *   A. pi-ai estimate 剔除 thinking 块；simple-options 对白名单改用剔除版估算。
 *   B. token-meter 表面计价按 `reasoningTokens` 对白名单从节点/表面总 token 中扣除。
 * 非白名单 provider 行为不变。
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

const QREASON_FN = `function qreasonIds(){try{const e=typeof process!=='undefined'&&process.env?process.env.QREASON_PROVIDER_IDS:'';if(e)return e.split(',').map(s=>s.trim()).filter(Boolean);const h=(typeof process!=='undefined'&&process.env?(process.env.DSH_HOME||process.env.DASH_HOME||''):'')||'';const f=h?h+'/qwen-reason.json':'';if(f&&qf_e(f)){const v=JSON.parse(qf_r(f,'utf8'));if(v&&Array.isArray(v.providers))return v.providers.filter(x=>typeof x==='string'&&x.length>0);}}catch(_e){}return ['home']}`;

/** One edit: [label, idempotencyMarker, anchor, replacement]. */
function applyEdits(file, edits) {
  let body;
  try { body = fs.readFileSync(file, 'utf8'); }
  catch (e) { console.error('MISSING: ' + file); return 1; }
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

// ---- A: pi-ai estimate.js ------------------------------------------------
const ESTIMATE = path.join(DSH_ROOT, 'node_modules/@earendil-works/pi-ai/dist/utils/estimate.js');
const NEW_ESTIMATE_FN = `

/**
 * LOCAL PATCH (home-exclude-thinking-context): full-message estimate with the
 * thinking blocks excluded, mirroring the no-replay wire for whitelisted
 * providers. Home Qwen keeps its own thinking natively and never receives the
 * replayed chain, so counting it inflates the context and starves the answer
 * maxTokens down to 1 (finish_reason=length). Non-whitelisted providers keep
 * the normal counting path.
 */
export function estimateContextTokensExcludingThinking(context) {
    const messages = isMessageArray(context) ? context : context.messages;
    let tokens = 0;
    for (const message of messages)
        tokens += estimateMessageTokens(message, false);
    if (!isMessageArray(context)) {
        const prefixTokens = (context.systemPrompt ? estimateTextTokens(context.systemPrompt) : 0) + estimateToolsTokens(context.tools);
        tokens += prefixTokens;
    }
    return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
}
`;
let rc = applyEdits(ESTIMATE, [
  ['estimateMessageTokens signature', 'countThinking = true',
    'export function estimateMessageTokens(message) {',
    'export function estimateMessageTokens(message, countThinking = true) {'],
  ['estimateMessageTokens skip thinking', 'if (countThinking) chars += block.thinking.length;',
    '        else if (block.type === "thinking") {\n            chars += block.thinking.length;\n        }',
    '        else if (block.type === "thinking") {\n            if (countThinking) chars += block.thinking.length;\n        }'],
  ['estimateContextTokensExcludingThinking fn', 'estimateContextTokensExcludingThinking',
    '//# sourceMappingURL=estimate.js.map',
    NEW_ESTIMATE_FN + '//# sourceMappingURL=estimate.js.map'],
]);
if (rc !== 0) process.exit(1);

// ---- A: pi-ai simple-options.js ------------------------------------------
const SIMPLE = path.join(DSH_ROOT, 'node_modules/@earendil-works/pi-ai/dist/api/simple-options.js');
rc = applyEdits(SIMPLE, [
  ['fs import + estimate import', 'qf_e',
    'import { estimateContextTokens } from "../utils/estimate.js";',
    'import { existsSync as qf_e, readFileSync as qf_r } from "node:fs";\nimport { estimateContextTokens, estimateContextTokensExcludingThinking } from "../utils/estimate.js";'],
  ['qreasonIds() helper', 'function qreasonIds',
    'const MIN_MAX_TOKENS = 1;\nexport function clampMaxTokensToContext(model, context, maxTokens) {',
    'const MIN_MAX_TOKENS = 1;\n' + QREASON_FN + '\nexport function clampMaxTokensToContext(model, context, maxTokens) {'],
  ['clampMaxTokensToContext use excluded estimate', 'qreasonIds().includes(model.provider)',
    '    const available = model.contextWindow - estimateContextTokens(context).tokens - CONTEXT_SAFETY_TOKENS;',
    '    const estimate = qreasonIds().includes(model.provider) ? estimateContextTokensExcludingThinking(context) : estimateContextTokens(context);\n    const available = model.contextWindow - estimate.tokens - CONTEXT_SAFETY_TOKENS;'],
]);
if (rc !== 0) process.exit(1);

// ---- B: dsh-token-meter surface pricing ----------------------------------
const METER = path.join(DSH_ROOT, 'node_modules/@deepseek-ai/dsh-token-meter/lib/index.js');
rc = applyEdits(METER, [
  ['estimateReasoning helper (self-contained)', 'function estimateReasoning',
    'function estimateMessage(message) {\n\treturn estimateContent(message.content) + 4;\n}',
    '/**\n * LOCAL PATCH (home-exclude-thinking-context): price only reasoning blocks so\n * the surface can subtract thinking for whitelisted providers.\n */\nfunction estimateReasoning(blocks) {\n\tlet tokens = 0;\n\tfor (const block of blocks) switch (block.type) {\n\t\tcase "reasoning":\n\t\t\ttokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;\n\t\t\tbreak;\n\t\tcase "tool-result":\n\t\t\ttokens += estimateReasoning(block.content);\n\t\t\tbreak;\n\t}\n\treturn tokens;\n}\nfunction estimateMessage(message) {\n\treturn estimateContent(message.content) + 4;\n}'],
  ['analyzeNode null reasoningTokens', 'reasoningTokens: 0,\n\t\timages: []',
    '\tif (message === null) return {\n\t\tseq,\n\t\theuristicTokens: 0,\n\t\timageFreeTokens: 0,\n\t\timages: []\n\t};',
    '\tif (message === null) return {\n\t\tseq,\n\t\theuristicTokens: 0,\n\t\timageFreeTokens: 0,\n\t\treasoningTokens: 0,\n\t\timages: []\n\t};'],
  ['analyzeNode non-null reasoningTokens', 'reasoningTokens: estimateReasoning(message.content),',
    '\treturn {\n\t\tseq,\n\t\theuristicTokens,\n\t\timageFreeTokens: heuristicTokens - collectImages(message.content, images),\n\t\timages\n\t};',
    '\treturn {\n\t\tseq,\n\t\theuristicTokens,\n\t\timageFreeTokens: heuristicTokens - collectImages(message.content, images),\n\t\treasoningTokens: estimateReasoning(message.content),\n\t\timages\n\t};'],
  ['priceSurface signature', 'countReasoning = true',
    'function priceSurface(nodes, pricing) {',
    'function priceSurface(nodes, pricing, countReasoning = true) {'],
  ['priceSurface no-image branch subtract reasoning', 'countReasoning ? node.heuristicTokens',
    '\t\t\tnodes: nodes.map((node) => {\n\t\t\t\tsurfaceTokens += node.heuristicTokens;\n\t\t\t\treturn {\n\t\t\t\t\tseq: node.seq,\n\t\t\t\t\ttokens: node.heuristicTokens,\n\t\t\t\t\theuristicTokens: node.heuristicTokens\n\t\t\t\t};\n\t\t\t}),\n\t\t\tsurfaceTokens',
    '\t\t\tnodes: nodes.map((node) => {\n\t\t\t\tconst nodeTokens = countReasoning ? node.heuristicTokens : Math.max(0, node.heuristicTokens - (node.reasoningTokens ?? 0));\n\t\t\t\tsurfaceTokens += nodeTokens;\n\t\t\t\treturn {\n\t\t\t\t\tseq: node.seq,\n\t\t\t\t\ttokens: nodeTokens,\n\t\t\t\t\theuristicTokens: node.heuristicTokens,\n\t\t\t\t\treasoningTokens: node.reasoningTokens ?? 0\n\t\t\t\t};\n\t\t\t}),\n\t\t\tsurfaceTokens'],
  ['priceSurface image branch subtract reasoning', 'countReasoning ? tokens',
    '\t\t\tsurfaceTokens += tokens;\n\t\t\treturn {\n\t\t\t\tseq: node.seq,\n\t\t\t\ttokens,\n\t\t\t\theuristicTokens: node.heuristicTokens\n\t\t\t};\n\t\t}),\n\t\tsurfaceTokens',
    '\t\t\tconst nodeTokens = countReasoning ? tokens : Math.max(0, tokens - (node.reasoningTokens ?? 0));\n\t\t\tsurfaceTokens += nodeTokens;\n\t\t\treturn {\n\t\t\t\tseq: node.seq,\n\t\t\t\ttokens: nodeTokens,\n\t\t\t\theuristicTokens: node.heuristicTokens,\n\t\t\t\treasoningTokens: node.reasoningTokens ?? 0\n\t\t\t};\n\t\t}),\n\t\tsurfaceTokens'],
  ['measure() current-surface priceSurface countReasoning', 'priceSurface(state.surface, pricing, !isHome)',
    '\t\tconst surface = priceSurface(state.surface, pricing);',
    '\t\tconst surface = priceSurface(state.surface, pricing, !isHome);'],
  ['measure() anchor-surface priceSurface countReasoning', 'priceSurface(anchor.nodes, pricing, !isHome)',
    '\t\t\tconst anchorSurfaceTokens = priceSurface(anchor.nodes, pricing).surfaceTokens + anchor.assistantTokens;',
    '\t\t\tconst anchorSurfaceTokens = priceSurface(anchor.nodes, pricing, !isHome).surfaceTokens + anchor.assistantTokens;'],
]);
if (rc !== 0) process.exit(1);

console.log('home-exclude-thinking-context: applied. RESTART dsh web for it to take effect.');
