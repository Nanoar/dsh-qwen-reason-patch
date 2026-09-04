# qwen-reason-settings 插件（settings 命名空间 → $DSH_HOME/qwen-reason.json）

把 `qwenReason.providers`（默认 `["home"]`）注册进 DSH settings，
变更时自动写入 `$DSH_HOME/qwen-reason.json` —— 四个 qwen 补丁的运行时白名单。

## 安装（镜像 dsh-plugin-memory 的本地 link 模式）
1. 把本目录放到 `$DSH_HOME/plugins/qwen-reason-settings`（源码）。
2. `profiles/web/package.json` 的 dependencies 加
   `"@nanoar/dsh-qwen-reason-settings": "link:$DSH_HOME/plugins/qwen-reason-settings"`，
   并在 `dsh.profile.bundles` 数组追加同名包。
3. 若插件依赖无法从 plugins/ 解析，按 dsh-plugin-link-deps 的 shim 流程接线后重启。
4. 重启后 settings.yaml 出现 `qwenReason:\n  providers: [home]`，可直接编辑；
   运行时补丁读 `$DSH_HOME/qwen-reason.json`（env QREASON_PROVIDER_IDS 优先）。

## GUI 面板（二期）
本插件为宿主侧。设置页的“自定义 section 可视化编辑”需要配套 web client（仿 force-compact
web/client.js 的 settings.section 注册 + 组件）。计划按此模式补客户端半部后再推送到仓库。
