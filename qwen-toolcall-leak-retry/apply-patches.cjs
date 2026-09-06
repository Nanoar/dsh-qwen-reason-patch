#!/usr/bin/env node
/* qwen-toolcall-leak-retry — 兜住"思考→工具调用"边界漏标签导致的静默停摆。
 *
 * 根因：本地 Qwen3.8-27B-APEX 在长上下文/多次工具调用后，偶尔在 reasoning_content（思考）
 * 还没结束时就把工具调用的闭合 XML 标签（</parameter></function></tool_call>）写进思考流，
 * 然后发 EOS（finish_reason="stop"）。该步因此只有 thinking 块、无 text 无 toolCall。
 * DSH 旧逻辑只把"零内容"归 EMPTY_RESPONSE，于是"只有思考"被当成正常 stop →
 * turn/end=completed，助手静默停摆（用户视角="执行中会话中断"）。
 *
 * 修复：dsh-llm-pi-ai 的 mapStopReason() case "stop" 分支，把
 * "content.length===0" 扩为 "content.length===0 || 无 text 且无 toolCall"，
 * 即纯 thinking 完成态也归 EMPTY_RESPONSE → 触发 dsh-llm-retry 自动重试（默认5次）。
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

function readFile(file) { try { return fs.readFileSync(file, 'utf8'); } catch (e) { console.error('MISSING: ' + file); process.exit(1); } }
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

const ADAPTER = path.join(DSH_ROOT, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js');
const OLD_STOP = '\t\tcase "stop":\n' +
  '\t\t\tif (message.content.length === 0) return {\n' +
  '\t\t\t\tkind: "error",\n' +
  '\t\t\t\tfailure: {\n' +
  '\t\t\t\t\tmessage: `model "${message.model}" returned a completed response with no content`,\n' +
  '\t\t\t\t\tcode: EMPTY_RESPONSE_CODE\n' +
  '\t\t\t\t}\n' +
  '\t\t\t};\n' +
  '\t\t\treturn { kind: "stop" };';
const NEW_STOP = '\t\tcase "stop":\n' +
  '\t\t\t// LOCAL PATCH (qwen-toolcall-leak): a completed response that carries\n' +
  '\t\t\t// only thinking blocks (no text, no tool call) is degenerate — the home\n' +
  '\t\t\t// Qwen occasionally leaks the tool-call XML closing tags into its thinking\n' +
  '\t\t\t// stream and stops without an answer. Classify it as EMPTY_RESPONSE so the\n' +
  '\t\t\t// retry policy re-issues the request instead of ending the turn silently.\n' +
  '\t\t\tif (message.content.length === 0 || !message.content.some((piece) => piece.type === "text" || piece.type === "toolCall")) return {\n' +
  '\t\t\t\tkind: "error",\n' +
  '\t\t\t\tfailure: {\n' +
  '\t\t\t\t\tmessage: `model "${message.model}" returned a completed response with no text or tool call`,\n' +
  '\t\t\t\t\tcode: EMPTY_RESPONSE_CODE\n' +
  '\t\t\t\t}\n' +
  '\t\t\t};\n' +
  '\t\t\treturn { kind: "stop" };';
const rc = applyEdits(ADAPTER, [
  ['classify reasoning-only stop as EMPTY_RESPONSE', 'qwen-toolcall-leak', OLD_STOP, NEW_STOP],
]);
if (rc !== 0) process.exit(1);

console.log('qwen-toolcall-leak-retry: applied. RESTART dsh web for it to take effect.');
