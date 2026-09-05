# token-meter-exclude-thinking — 压缩触发阈值对 home 剔除瞬态思考（home 路由判定）

适用：DSH 经 llm provider **home** 连本地 llama.cpp/Qwen 带思考模型（65K 窗口、思考链长）。
修复官方 `dsh-compaction-basic` 把 **home 的瞬态思考**计入上下文压力、导致过早压缩的问题。
**只作用于 home**；云端（deepseek 等）思考仍计入（它们会回放思考，属真实持久上下文）。

## 症状
思考远大于输出的任务里，home 会话可见上下文才 ~27K 就触发压缩（阈值 = 0.8×contextWindow = 52.4K）。
根因：pi-ai 把 reasoning 折进 outputTokens，而 `dsh-token-meter` 的 `totalTokens` 优先用 provider
usage(inputTokens+outputTokens)，于是思考被当成"上下文占用"。

## 补丁（home 路由判定，注入/改动 8 处）
文件：`<DSH_ROOT>/node_modules/@deepseek-ai/dsh-token-meter/lib/index.js`
1. 顶部加 aliased fs import。
2. `estimateContent` 前加 `qreasonIds()`（env / `$DSH_HOME/qwen-reason.json` / 缺省 `["home"]`）。
3. 新增 `estimateReasoning()` 只累加 reasoning 块。
4. `_estimateProviderAssistant` 返回 `{tokens, reasoningTokens}`。
5. `_foldEvent` 在 usage 锚点存 `reasoningTokens`。
6. `measure()` 加 `isHome = qreasonIds().includes(provider)` 守卫，usage 路径仅在 isHome 时
   `tokens = max(0, usageTokens - reasoningTokens)`。

效果：home 的 `totalTokens` = 输入 + 回答 + 工具结果（可见上下文）；云端 `totalTokens` 不变（含思考）。
`dsh-compaction-basic` 无需改，它读的 totalTokens 已被按路由修正。

## 与其它补丁的一致性
home 路由判定与 `qwen-thinking-no-replay`、`compaction-summary-no-thinking` 共用同一个
`qreasonIds()` 运行时白名单，改目标 provider 设 env 或写 json 即可，无需改代码。

## 重打
```sh
node apply-patches.cjs --dry-run
node apply-patches.cjs   # 幂等，然后重启 dsh web
```
验证：home 会话压缩触发点从 ~27K 挪到 ~52K 可见上下文；云端会话右下角上下文计数不变（含思考）。
