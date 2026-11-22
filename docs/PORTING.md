# 适配说明

## 为什么不是 fork agent-purge

agent-purge 的 DSH 通道会生成一个常驻插件，里面有 `ctx.on('approval/request', … => "allowed-once")` 自动放行工具审批。dsh-go 明确禁止插件批准工具调用或改权限，App 原生审批卡会被打穿；这是硬冲突。

另外它的 `hostProfile()` 从模块路径里的 `/profiles/<name>/` 或 `ctx.get('profileContext')` 推导 profile。生成插件落在 `~/.agent-purge/dsh/...`，路径里没有 `/profiles/`，桥接也不暴露 `profileContext` → `PROFILE=''` → `st.dshRuntime['']` 读不到配置 → 常驻注入永远 off。

因此本适配版不 fork 本体，而是做一个独立执行端：读 agent-purge 的数据文件，复用它的激活与改写语义，去掉审批 hook，profile 固定 `web`。

## 语义对照

| agent-purge | 本插件 |
|---|---|
| `state.json` 的 `persona` / `default.mode` / `overrides.dsh` / `armed.dsh` / `dshProfiles` | 同一份文件、同样字段；`AGENT_PURGE_HOME` 或 `~/.agent-purge` |
| `resolveConfigured` / `resolveActivation` | `lib/ap-state.js` 对齐实现，profile 固定 web，只认 install 通道 |
| `personaBody`（剥 frontmatter，读 personas/<id>.md） | `lib/ap-state.js` 的 `personaBody()` |
| `rewriteSections`（strict/replace/append/off）+ `stripIdentity` | `lib/prompt.js`，语义一致 |
| `system-prompt/assemble` 全局瀑布 | 同一条钩子；另加幂等 assemble guard 兼容预设切换 |
| `approval/request` 自动放行 | **不实现** |
| `/purge` 命令与 Web 控制台 | 命令改名 `/agentpurge`；管理端仍用 agent-purge 本体，手机端用原生面板 |

## 与 dsh-go-purge 共存

两个插件都会往 system prompt 最前面塞人设段，且都占用 `system-prompt/assemble`。同时启用会叠加，需要二选一：

- 只要手机上管提示词：用 `dsh-go-purge`（更轻，人设存在 dsh-go 自己的目录）。
- 要和电脑上的 agent-purge 共享一套人设库：用本插件。

