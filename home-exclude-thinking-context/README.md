# home-exclude-thinking-context — 本地 Qwen 思考不计入上下文估算（A+B 治本）

替代旧的 `max-tokens-floor`（治标）补丁。根因修复"1-token 停摆"与"retainRatio 被思考吃掉"。

## 根因
home Qwen 的思考（DSH `reasoning` = pi-ai `thinking`）既不回放上 wire（`qwen-thinking-no-replay` 已挡），
也不该计入上下文占用，但两处估算器仍把它当正文计价：
- **A（pi-ai）** `clampMaxTokensToContext` 用 `estimateContextTokens`（含 thinking）算剩余空间
  → 会话一长 `available<=1` → `maxTokens` 被 `Math.max(1, available)` 钳到 1 → 只吐 1 token 即
  `finish_reason=length`。
- **B（dsh-token-meter）** `estimateContent` 把 `reasoning` 与 `text` 同价 → 表面节点 token 含思考
  → compaction 的 `selectCompactableRange` 保留边界 + surface 压力被思考吃掉。

## 补丁（白名单 qreasonIds，缺省 home；非白名单行为不变）
| 文件 | 改动 |
|---|---|
| pi-ai `dist/utils/estimate.js` | `estimateMessageTokens` 加 `countThinking` 参数；新增 `estimateContextTokensExcludingThinking`（全量估、剔除 thinking） |
| pi-ai `dist/api/simple-options.js` | 注入 `qreasonIds()`；`clampMaxTokensToContext` 对白名单改用剔除版估算 |
| dsh-token-meter `lib/index.js` | `analyzeNode` 计 `reasoningTokens`；`priceSurface` 加 `countReasoning`；`measure()` 对 home 从节点/表面 token 中扣思考 |

## 与其它补丁的关系
- 依赖 `qwen-thinking-no-replay`（home 不回放思考）作为正确性前提——"不回放就不该计数"。
- 与 `token-meter-exclude-thinking` 互补：那个修 usage 基线/触发阈值，这个修 pi-ai 的 maxTokens
  钳制（A）与 surface/retain 边界（B）。
- 复用同一 `qreasonIds()` 运行时白名单（env `QREASON_PROVIDER_IDS` / `$DSH_HOME/qwen-reason.json` / 缺省 `["home"]`）。

## 使用
```sh
node apply-patches.cjs [DSH_ROOT] [--dry-run]   # 幂等
```
应用后必须重启 dsh web。

## 验证
- 长会话请求体 `max_completion_tokens` 不再被钳到 1（应稳定在模型配置的 12288 附近）。
- 右下角 surface 压力与 retain 保留边界不再包含思考（思考不计入估算）。
