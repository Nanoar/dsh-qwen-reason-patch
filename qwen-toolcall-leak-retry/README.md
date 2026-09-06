# qwen-toolcall-leak-retry — 兜住"思考→工具调用"漏标签导致的静默停摆

## 症状
home 本地 Qwen3.8-27B-APEX 在长会话 / 多次工具调用后，某一步只输出 reasoning_content（思考），
思考流末尾把工具调用的闭合标签 `</parameter></function></tool_call>` 直接写进思考内容，随后发 EOS
（finish_reason="stop"，非 length），既无 text 也无 toolCall。DSH 记 `turn/end reason=completed`，
用户视角 = 助手执行到一半突然沉默。

## 根因
DSH 的 `dsh-llm-pi-ai` `mapStopReason()` 对 `stop` 只把「零内容」(`content.length===0`) 归
`EMPTY_RESPONSE`。模型漏标签时产出的是「只有 thinking 块」，被当成正常 `stop` → 不重试、静默结束。

## 修复
把判断扩为：`content.length===0` **或** 无 `text` 且无 `toolCall`（纯 thinking 完成态）也归
`EMPTY_RESPONSE` → 命中 `dsh-llm-retry` 的 retryableCodes，自动重试（home 默认 5 次）。

## 改动的文件
- `dsh-llm-pi-ai/lib/index.js` 的 `mapStopReason()` case "stop" 分支。

## 幂等 / 回滚
- 幂等：以 `qwen-toolcall-leak` 注释为 marker，已打则跳过。
- 回滚：把该 `if (message.content.length === 0 || !message.content.some(...))` 行改回
  `if (message.content.length === 0) return {`，并删掉上面的 `// LOCAL PATCH (qwen-toolcall-leak)` 注释即可。
