# qwen-thinking-no-replay — 本地思考模型不回放历史思考链（运行时白名单）

适用：DSH 经 llm provider（`model.provider === "home"`）连本地 llama.cpp 部署的
**带思考模型**（Qwen3.8-27B-APEX-I-Mini 等，65K 窗口）。

## 问题
pi-ai 每轮把上一轮 assistant 的思考（reasoning_content）逐轮回放给模型，思考链文本进上下文
+ 模型重复输出长思考 → 上下文被撑爆、生成更慢。Qwen 的旧思考确实走 reasoning_content 签名
回传（已抓包证实）。

## 补丁（运行时白名单，注入 3 处）
文件：`<DSH_ROOT>/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`
1. 顶部加 `import { existsSync as qf_e, readFileSync as qf_r } from "node:fs";`
2. `buildParams` 前加 `qreasonIds()`（读 `QREASON_PROVIDER_IDS` env → `$DSH_HOME/qwen-reason.json`
   `{"providers":[...]}` → 缺省 `["home"]`）。
3. 回放 guard 改为 `if (signature && isOpenAICompletionsReasoningField(signature) && !qreasonIds().includes(model.provider)) {`。

只挡白名单内 provider 的回放，其它 provider（OpenRouter 等）不动。

## 白名单切换
```sh
QREASON_PROVIDER_IDS=home,llm2   # env 覆盖（多 id 逗号分隔）
# 或写 $DSH_HOME/qwen-reason.json: {"providers":["home"]}
```
可选的 settings 面板镜像见 `../qwen-reason-settings-plugin/`。

## 重打
```sh
node apply-patches.cjs --dry-run
node apply-patches.cjs   # 幂等，然后重启 dsh web
```
锚点按 `isOpenAICompletionsReasoningField(signature)` + `function buildParams` 定位，不依赖行号。
验证：多轮请求体 assistant 消息不再带 thinking 签名字段；上下文增长速率回到"只有新内容"。
