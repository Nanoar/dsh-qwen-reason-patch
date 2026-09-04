# max-tokens-floor — 本地 Qwen 请求输出上限末站兜底（1-token 停摆症状修复）

症状：dsh 某路径给本地 llama.cpp 请求发 `max_completion_tokens: 1`（预填 4万+
token 后只吐 1 个 token、finish_reason=length、UI 提示“已达输出上限…发送继续”，
连发“继续”会复现）。源头未继续深挖，用户要求改为“请求末端重新钳制”直接修复。

补丁位置：`<DSH_ROOT>/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`
`buildParams` 的 maxTokens 赋值处（wire 前最后一站）。逻辑：
- 传入 cap ≥ 256：原样透传（压缩 8192、标题等不受影响）；
- 传入 cap ≤ 256（病态小值）：改写为 `model.maxTokens`（缺省 32768）。

配套既有补丁：qwen-thinking-no-replay（同文件）+ compaction-summary-no-thinking（dsh-compaction-basic）。

重打：`node apply-patches.cjs [--dry-run]`（幂等），然后重启 dsh web。
验证：1-token 请求不再出现；该类请求 body 的 max_completion_tokens 应为 32768。
