#!/usr/bin/env node
/* token-meter-skip-reasoning-home (+clamp-history) —
 * (1) home 源计价跳过 reasoning 块（两份 estimate 副本，source.provider==='home'）；
 * (2) 历史重放钳制：旧压缩 shadow 价(含 reasoning)在新口径下会减过头 → 累加钳 >=0。
 * Usage: node apply-patches.cjs [DSH_ROOT] [--dry-run] 幂等。 */
'use strict';
const fs=require('fs'), path=require('path');
const args=process.argv.slice(2); const dryRun=args.includes('--dry-run');
const explicit=args.find(a=>!a.startsWith('--'));
const DSH_ROOT=explicit || '/storage/Users/currentUser/AISpace/.devtools/npm-global/lib/node_modules/@deepseek-ai/dsh';
const B=DSH_ROOT+'/node_modules/@deepseek-ai/dsh-token-meter/lib';
const MARK='token-meter-skip-reasoning-home'; const MARK2='token-meter-clamp-history';
const jobs=[
 {f:B+'/index.js', mark:null, repls:[
  ['function estimateContent(blocks) {','function estimateContent(blocks, skipReasoning = false) {'],
  ['\t\tcase "reasoning":\n\t\t\ttokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;\n\t\t\tbreak;',
   '\t\tcase "reasoning":\n\t\t\tif (!skipReasoning) tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;\n\t\t\tbreak;'],
  ['\t\tcase "text":\n\t\tcase "reasoning":','\t\tcase "text":'],
  ['\t\t\ttokens += estimateContent(block.content) + BLOCK_OVERHEAD;','\t\t\ttokens += estimateContent(block.content, skipReasoning) + BLOCK_OVERHEAD;'],
  ['function estimateMessage(message) {\n\treturn estimateContent(message.content) + 4;\n}',
   'function estimateMessage(message) {\n\tconst skipReasoning = message !== null && typeof message === \'object\' && message.source?.provider === \'home\';\n\treturn estimateContent(message.content, skipReasoning) + 4;\n}']
 ]},
 {f:B+'/types/estimate.js', mark:null, repls:[
  ['export function estimateContent(blocks) {','export function estimateContent(blocks, skipReasoning = false) {'],
  ["            case 'reasoning':\n                tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;\n                break;",
   "            case 'reasoning':\n                if (!skipReasoning)\n                    tokens += Math.ceil(block.text.length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;\n                break;"],
  ["            case 'text':\n            case 'reasoning':", "            case 'text':"],
  ['                tokens += estimateContent(block.content) + BLOCK_OVERHEAD;','                tokens += estimateContent(block.content, skipReasoning) + BLOCK_OVERHEAD;'],
  ['export function estimateMessage(message) {\n    return estimateContent(message.content) + ROLE_OVERHEAD;\n}',
   'export function estimateMessage(message) {\n    const skipReasoning = message?.source?.provider === \'home\';\n    return estimateContent(message.content, skipReasoning) + ROLE_OVERHEAD;\n}']
 ]},
 {f:B+'/types/breakdown-projection.js', mark:MARK2, repls:[
  ['messageTokens: state.messageTokens + fold.deltaTokens,','messageTokens: Math.max(0, state.messageTokens + fold.deltaTokens),'] ]},
 {f:B+'/types/usage-projection.js', mark:MARK2, repls:[
  ['next = { ...next, surfaceTokens: next.surfaceTokens + fold.deltaTokens };','next = { ...next, surfaceTokens: Math.max(0, next.surfaceTokens + fold.deltaTokens) };'] ]},
];
let any=false;
for (const job of jobs){ let body; try{ body=fs.readFileSync(job.f,'utf8'); }catch(e){ console.error('MISSING: '+job.f); process.exit(1); }
  const doneMark = (job.mark? body.includes(job.mark) : body.includes(MARK));
  if (doneMark){ console.log('already applied: '+path.basename(job.f)); continue; }
  try{ for (const [o,n] of job.repls){ if(!body.includes(o)) throw new Error('anchor missing: '+o.slice(0,70)); body=body.replace(o,n); } }
  catch(err){ console.error('PATCH FAILED in '+job.f+': '+err.message); process.exit(1); }
  if(dryRun){ console.log('[dry-run] would patch '+path.relative(DSH_ROOT,job.f)); continue; }
  fs.writeFileSync(job.f,body); console.log('patched: '+path.relative(DSH_ROOT,job.f)); any=true;
}
if(dryRun) console.log('[dry-run] no write.'); else if(!any) console.log('nothing to do.');
console.log('RESTART dsh web. Note: do NOT delete projection rows of long sessions (replay may clamp, stays valid).');
