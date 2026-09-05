# token-meter-exclude-thinking — 压缩触发阈值剔除思考（visible-context-only 计量）

适用：DSH 经 llm provider **home** 连本地 llama.cpp/Qwen 带思考模型（65K 窗口、思考链长）。
修复官方 `dsh-compaction-basic` 把**瞬态思考**计入上下文压力、导致过早压缩的问题。

## 症状
思考远大于输出的任务里，可见上下文才 ~27K 就触发压缩（阈值 = 0.8×contextWindow = 52.4K）。
根因：pi-ai 把 reasoning 折进 outputTokens，而 `dsh-token-meter` 的 `totalTokens` 优先用
provider usage(inputTokens+outputTokens)，于是思考被当成"上下文占用"。

## 补丁（5 处，全部带 `exclude-thinking-from-meter` 标记）
文件：`<DSH_ROOT>/node_modules/@deepseek-ai/dsh-token-meter/lib/index.js`
1. `estimateContent` 的 `case "reasoning"` 改为不计价 → 表面/启发式路径自动排除思考。
2. 新增 `estimateReasoning()` 只累加 reasoning 块。
3. `_estimateProviderAssistant` 返回 `{tokens, reasoningTokens}`。
4. `_foldEvent` 在 usage 锚点存 `reasoningTokens`。
5. `measure()` usage 分支 `tokens = max(0, usageTokens - anchor.reasoningTokens)`。

效果：totalTokens = 输入 + 回答 + 工具结果（可见上下文）。`dsh-compaction-basic` 无需改，
它读的 totalTokens 已被修正。

## 前提（务必知道）
补丁正确性依赖 **home 思考不回放**（由 qwen-thinking-no-replay 保证）。若将来改成回放历史
思考，思考会持久化进上下文，本补丁会低估真实占用 → 有溢出风险，需同步回退本补丁。
保守性：4 字符/token 对中文思考低估 → 减的是下限 → 校正后略高于真实可见 → 压缩略早触发（安全）。

## 重打
```sh
node apply-patches.cjs --dry-run
node apply-patches.cjs   # 幂等，然后重启 dsh web
```
验证：重启后压缩触发点从 ~27K 挪到 ~52K 可见上下文；Web 上下文读数不再每轮随思考净涨。
