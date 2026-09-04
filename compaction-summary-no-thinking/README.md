# compaction-summary-no-thinking — 官方压缩摘要调用思考降档（仅 Home/本地模型）

适用：DSH 经 llm provider（`model.provider === "home"`）连本地 llama.cpp 部署的带思考模型
（Qwen3.8-27B-APEX-I-Mini 等）。修复官方 `dsh-compaction-basic` 自动压缩在本地模型上失败的问题。

## 症状（本机实证，2026-09-04，会话 fd348d60）
每次自动压缩触发后 ~170-190 秒，随后 `summarization truncated at the token cap` 或
`summarization produced no text summary content`；7 次压缩 6 败 1 中止，失败后上下文不缩小→死循环。

## 根因
官方压缩的摘要 LLM 调用不带 reasoning 控制，本地 Qwen APEX 全强度思考把输出预算（默认 8192）
吃光 → 截断/无文本。force-compact 卸载后官方路径没有这个能力。

## 补丁（1 处，仅 home）
`<DSH_ROOT>/node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js` `summarizeWithLlm` 的
stream options：当 `target.provider === "home"` 时附加 `reasoningEffort: "low"`（该模型声明的最低
思考档，pi-ai 会映射成 llama.cpp 认的 reasoning_effort）。云端 deepseek-official 不受影响。
> 演进备注：最早用 "none" 想关思考，被 llm-pi-ai 以 “does not support reasoning effort 'none'” 拒绝
> （该模型只声明 low/medium/xhigh）；"off" 亦未声明。故改 "low"（低档思考，快速且不烧光预算）。

## 重打（每次 dsh/node_modules 升级后）
```sh
node apply-patches.cjs --dry-run
node apply-patches.cjs   # 幂等，然后重启 dsh web
```

## 验证
重启后目标会话压缩应成功（日志出现 `compaction (step pressure): shadowed N surface nodes ...`），
耗时明显下降；错误信息不再出现。
