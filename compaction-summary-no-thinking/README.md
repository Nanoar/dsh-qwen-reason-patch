# compaction-summary-no-thinking — 官方压缩摘要调用思考降档（运行时白名单）

适用：DSH 经 llm provider 连本地 llama.cpp 部署的带思考模型（Qwen3.8-27B-APEX-I-Mini 等）。

## 症状（本机实证）
每次自动压缩触发后 ~170-190 秒，随后 `summarization truncated at the token cap` 或
`summarization produced no text summary content`；失败后上下文不缩小 → 死循环。

## 根因
官方 `dsh-compaction-basic` 的摘要 LLM 调用不带 reasoning 控制，本地 Qwen APEX 全强度思考
把输出预算（默认 8192）吃光 → 截断/无文本。

## 补丁（注入 3 处，仅白名单内 provider）
文件：`<DSH_ROOT>/node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js`
1. 顶部加 aliased fs import。
2. `summarizeWithLlm` 前加 `qreasonIds()`（env / `$DSH_HOME/qwen-reason.json` / 缺省 `["home"]`）。
3. options 加 `...(qreasonIds().includes(target.provider) ? { reasoningEffort: "low" } : {})`。
   `"low"` 是该模型声明的最低思考档（最早用 "none" 被 pi-ai 以未声明级别拒绝；"off" 也未声明）。
   云端 deepseek-official 不受影响。

## 重打
```sh
node apply-patches.cjs --dry-run
node apply-patches.cjs   # 幂等，然后重启 dsh web
```
验证：压缩成功（日志 `compaction (step pressure): shadowed N surface nodes ...`），耗时明显下降。
