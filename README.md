# qwen-reason-patch — 本地 Qwen（可访问自身思考链）优化补丁合集

目标模型：经 llm provider **home** 路由的本地 llama.cpp/Qwen3.8-27B-APEX-I-Mini
（65K 窗口、思考链长、串行）。四组改动全部只作用于 home 源；云端 deepseek 不受影响。

## 包含的子补丁（顺序即依赖顺序）
| 子补丁 | 文件 | 作用 |
|---|---|---|
| qwen-thinking-no-replay | pi-ai `dist/api/openai-completions.js` | 旧思考不再回放上 wire（省上下文） |
| compaction-summary-no-thinking | dsh-compaction-basic `lib/index.js` | 压缩摘要思考降档 `reasoningEffort:"low"`（原 none 不被该模型声明） |
| max-tokens-floor | pi-ai `dist/api/openai-completions.js` | ≤256 的病态输出上限改写为模型声明值（修 1-token 停摆） |
| token-meter-skip-reasoning-home | dsh-token-meter 5 文件 | home 会话计价跳过未回放 reasoning（含历史重放钳制） |

每个子目录含幂等 `apply-patches.cjs`（`--dry-run` 可预览）与 README。

## 使用
```sh
node apply-all.cjs [--dry-run]   # 一键检查/应用全部
# 或单个: node <子目录>/apply-patches.cjs [--dry-run]
# 应用后必须重启 dsh web
```

## provider 白名单（重要）
当前各子补丁的判断写死为 `home`（因为全部适配只针对该路由）。要扩展到其它 provider：
- 每个子 `apply-patches.cjs` 里的 `"home"`/`'home'` 字面量就是判断点，可改成目标 id；
- 或让本包支持“配置化”：见仓库讨论/PR 建议（把字面量改为读取
  `$DSH_HOME` 下配置或 `process.env.QREASON_PROVIDERS` 的成员判断，一处改动即可覆盖 4 个补丁；
  若要进 DSH 设置面板，则需要一个小插件注册 `settings` namespace 并让各补丁读取——成本高，尚未实现）。

## 重打
任何 dsh/node_modules 升级会覆盖上述 core 文件 → 重跑 `node apply-all.cjs` 后重启。

### 用环境变量切换 provider（无需改代码）
```sh
QREASON_PROVIDER_IDS=home2 node apply-all.cjs   # 应用时把所有判断字面量换成 home2
```
> 现仅支持单个目标 id；多 id 需要把判断改成“成员列表”，可作为后续 PR。

### v3：provider 白名单运行时化（env / 配置文件 / settings 命名空间）
- 六处判断点已从字面量改为 `qreasonIds()` 读取：
  1) `QREASON_PROVIDER_IDS=home,llm2`（多 id，逗号分隔，最优先）
  2) `$DSH_HOME/qwen-reason.json` → `{"providers":["home"]}`（次优先）
  3) 缺省 `["home"]`
- 随包插件 `qwen-reason-settings-plugin/`：把 `qwenReason.providers` 注册进 DSH settings
  并在变更时镜像到 `$DSH_HOME/qwen-reason.json`（安装见其 README-install.md）。
- GUI 设置面板客户端半部（settings.section）计划按 force-compact 模式二期补上并推送。

### 重打/升级后
1) `node apply-all.cjs`  2) 安装插件（可选）  3) 重启 dsh web
