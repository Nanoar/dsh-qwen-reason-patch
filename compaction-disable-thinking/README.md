# compaction-disable-thinking — 摘要关思考 + maxTokens 取模型配置（替换 compaction-summary-no-thinking）

替换旧的 `compaction-summary-no-thinking`（`reasoningEffort:"low"` 治标，无效）。

## 根因
home 模型（本地 llama.cpp Qwen3.8-27B）的 `compat.thinkingFormat` 是 `"openai"`——pi-ai 对它不发
`enable_thinking`，且本地模板 `enable_thinking` 缺省开、只认二值开关不认细粒度预算。所以旧的
`reasoningEffort:"low"` 只是发 `reasoning_effort:"low"`、实际仍思考全开，摘要把 maxTokens(默认8192)
打满 → `summarization truncated at the token cap (incomplete checkpoint)`（finish_reason=length → MAX_TOKENS）。

## 方案3（治本，非 home 不变）
| 文件 | 改动 |
|---|---|
| dsh-compaction-basic `lib/index.js` | 回滚旧 "low" 补丁；摘要 `maxTokens` 改为 `ctx.llm.resolveModelInfo(...).defaultMaxTokens`（即模型配置的 maxTokens，如 12288），回退 8192 |
| dsh-llm-pi-ai `lib/index.js` | 把 `options.purpose` 透传给 pi-ai 的 `streamSimple` |
| pi-ai `dist/api/openai-completions.js` | (1) `streamSimple` 透传 `purpose`；(2) thinking 分发新增：home + `purpose==="compaction"` → `chat_template_kwargs:{ enable_thinking:false }`（llama.cpp jinja 模板 kwargs 认得） |

## 依赖
- 依赖 `qwen-thinking-no-replay` 在 openai-completions.js 注入的 `qreasonIds()`（apply-all 顺序里排其前）。
- `chat_template_kwargs` 是 llama.cpp server 的 jinja 模板 kwargs（PR #13196），`enable_thinking:false` 关思考。

## 验证
- 长会话压缩不再报 `summarization truncated at the token cap`。
- 摘要请求体对 home 带 `chat_template_kwargs:{"enable_thinking":false}` 且 `max_completion_tokens`≈模型配置 maxTokens。

## 使用
```sh
node apply-patches.cjs [DSH_ROOT] [--dry-run]   # 幂等
```
应用后重启 dsh web。
