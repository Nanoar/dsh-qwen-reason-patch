# token-meter-skip-reasoning-home — home 源计价跳过 reasoning 块

背景：qwen-thinking-no-replay 补丁后，home(本地 Qwen) 路由的历史思考**不再上 wire**，
但 tokenMeter 仍按存储内容全量计价 → surfaceTokens 虚高（实测 70.5k vs 真实压力 58.1k，
差值≈未回放思考文本 12k），导致窗口假性超限、压缩/剩余预算计算病态（呼应 max_tokens=1 现象）。

补丁（仅 home，其余源不变）：
- `<DSH_ROOT>/node_modules/@deepseek-ai/dsh-token-meter/lib/index.js`（服务内联副本）
- `.../dsh-token-meter/lib/types/estimate.js`（投影共享副本）
- `estimateContent(blocks, skipReasoning)` 在 `skipReasoning` 时跳过 reasoning 块文本；
  `estimateMessage(message)` 依据 `message.source?.provider === 'home'` 自动置 skip。
  assistant 存储消息均带 source.provider（实测 home 会话 125/125 含 "home"）。

重打：`node apply-patches.cjs [--dry-run]`（幂等）→ 重启 dsh web。

存量会话修正（重要）：已持久化的投影缓存（projcache rows tokenUsage/contextPressure/
contextBreakdown）不会自动重算。对需要修正的会话（暂停后）删除这三行让其全量重放：
`<dsh-home>/storages/session_projcache/sessions/<id>.json`（先备份），再重启。

验证：重启后该会话右下角总量与“详细信息”应趋近（surface ≈ 压力值，差异仅图像等少量口径）。

## v2（2026-09-04，会话级判定，需完整重打/重启）
早期按 message.source 判定不可靠（部分行无 source）。改为会话级：
- estimate.js/index.js estimateMessage(message, skipOverride)
- surface-projection foldSurfaceProjection(claim,event,skipReasoning)
- breakdown(contextBreakdown v2→v3)/contextPressure(v4→v5) 状态加可选 `home`，
  request/header 时置位并把 home 传入 fold；服务 fold 用 state.header provider。
- 旧 shadow 价与新口径的差由两处 Math.max(0,·) 钳制兜底。
改动散在 5 个文件，apply-patches.cjs 只覆盖核心 estimate 部分；升级后请按上述清单手工重打
或对照本 README 补 projection 四处（schema home、stateVersion+1、apply headerHome、fold 传参）。
