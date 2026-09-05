# qwen-reason-patch — 本地 Qwen（可访问自身思考链）优化补丁合集

目标模型：经 llm provider **home** 路由的本地 llama.cpp / Qwen3.8-27B-APEX-I-Mini
（65K 窗口、Q8KV、思考链长、串行）。所有改动只作用于 home 源；云端 deepseek 不受影响。

## 包含的子补丁（4 个，均幂等）
| 子补丁 | 文件 | 作用 |
|---|---|---|
| qwen-thinking-no-replay | pi-ai `dist/api/openai-completions.js` | 旧思考不再回放上 wire（省上下文），运行时白名单 |
| compaction-summary-no-thinking | dsh-compaction-basic `lib/index.js` | 压缩摘要思考降档 `reasoningEffort:"low"` |
| max-tokens-floor | pi-ai `dist/api/openai-completions.js` | ≤256 病态输出上限改写为模型声明值（修 1-token 停摆） |
| token-meter-exclude-thinking | dsh-token-meter `lib/index.js` | 压缩触发阈值只算可见上下文，剔除瞬态思考 |

## 使用
```sh
node apply-all.cjs [DSH_ROOT] [--dry-run]   # 一键检查/应用全部
# 或单个: node <子目录>/apply-patches.cjs [DSH_ROOT] [--dry-run]
# 应用后必须重启 dsh web
```

## provider 运行时白名单（v3）
`qwen-thinking-no-replay` 与 `compaction-summary-no-thinking` 共用 `qreasonIds()` 运行时白名单，
不再把 provider id 硬编码进补丁。判定优先级：
1. `QREASON_PROVIDER_IDS=home,llm2`（多 id，逗号分隔，最优先）
2. `$DSH_HOME/qwen-reason.json` → `{"providers":["home"]}`
3. 缺省 `["home"]`

要改目标 provider：设 env 或写 json 即可，**无需改代码**。
（可选的 settings 面板镜像见 `qwen-reason-settings-plugin/`，非必需。）

## ⚠️ 关键前提：token-meter-exclude-thinking 依赖"思考不回放"
`token-meter-exclude-thinking` 把瞬态思考剔除出压缩阈值，其正确性建立在
**home 思考不回放**（由 `qwen-thinking-no-replay` 保证）之上。若将来改为回放历史思考
（让模型跨轮引用自身推理），思考会持久化进上下文，需同步**回退**该子补丁，否则会低估
真实占用、有溢出风险。

## 重打
任何 dsh / node_modules 升级会覆盖上述 core 文件 → 重跑 `node apply-all.cjs` 后重启 dsh web。
各子补丁锚点按语义定位（函数名/签名串），尽量容忍 dist 行号漂移；锚点失配时会报错并提示手工补。
