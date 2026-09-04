# qwen-thinking-no-replay — 本地思考模型不回放历史思考链补丁

适用：DSH 经 llm provider（`model.provider === "home"`）连本地 llama.cpp 部署的
**带思考模型**（Qwen3.8-27B-APEX-I-Mini 等，~110K 上下文）。

## 问题
pi-ai 每轮会把上一轮 assistant 的 `thinkingSignature`（reasoning_content 签名串）
作为 assistant message 字段**逐轮回放**给模型。对本地小模型这是双重开销：
思考链文本本身进上下文 + 模型重复输出长思考 → 上下文被撑爆、生成更慢。
（Qwen 的旧思考确实走 reasoning_content 签名回传，已用请求体抓包证实，
见 dsh-replay-verification.md。）

## 补丁（1 处）
文件：`<DSH_ROOT>/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`
在 assistant 思考回放判断里加 provider 守卫——**只改本地 home provider，
不动 OpenRouter 等其他 provider**（它们可能真依赖该签名做 thinking 回传）：

```js
// 原
if (signature && isOpenAICompletionsReasoningField(signature)) {
// 补后
if (signature && isOpenAICompletionsReasoningField(signature) && model.provider !== "home") {
```

## 重打（每次 dsh/node_modules 升级后）
```sh
node apply-patches.cjs --dry-run    # 看当前状态
node apply-patches.cjs             # 实打（幂等），然后重启 dsh web
```
定位技巧：锚点文本在 dist 里随版本漂移（0.1.2 在 L1002 附近），脚本用
`isOpenAICompletionsReasoningField(signature)` + `assistantMsg[signature] = nonEmptyThinkingBlocks`
相邻关系自动定位，不依赖行号。

## 验证
补丁生效 = 多轮对话中请求体的 assistant messages 里不再出现 thinking 签名字段；
上下文增长速率回到"只有新内容"水平。抓包方法见 dsh-replay-verification.md。
