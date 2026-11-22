# dsh-go-agent-purge

agent-purge 的 **dsh-go 执行端**：读同一份 `~/.agent-purge/state.json` 和 `personas/*.md`，按 agent-purge 的 `strict / replace / append / off` 语义注入系统提示词，并提供 dsh-go 原生面板。

## 和 agent-purge 的关系

agent-purge 本体（CLI/Web 控制台）继续作为**管理端**：在电脑或手机本机终端里用它编辑人设、开关通道。本插件只做**执行端**：在 dsh-go 引擎里读那份配置并注入。电脑/手机两边共用一套人设库。

- 数据目录：`AGENT_PURGE_HOME` > `~/.agent-purge`（未安装 agent-purge 时首次启动会 seed 一个 `neutral` 人设和最小 `state.json`）。
- profile 固定 `web`——dsh-go 本机引擎用的就是它，绕开原生成器在手机上 profile 推导为空的问题。
- 只认 `install` 常驻通道，不注册 `approval/request`，不放行工具调用，不改权限。

## 安装

```sh
dsh plugin --profile web add /绝对路径/dsh-go-agent-purge
```

新开会话后输入框上方出现「状态 / 人设」胶囊和状态条；对话详情页「插件」页签有 Agent Purge 面板。

## 用法

| 命令 | 作用 |
|---|---|
| `/agentpurge status` | 看人设、模式、数据目录、未生效原因 |
| `/agentpurge list` | 列出人设 |
| `/agentpurge use <id>` | 切换人设（下一轮生效） |
| `/agentpurge mode strict\|replace\|append\|off` | 切模式 |
| `/agentpurge on` / `off` | 开关注入 |

工具 `agentpurge_status` / `agentpurge_use` 给模型调用，带原生卡片。

## 未生效排查

`status` 里会给出 `blockedBy`：`not-enabled`（没勾 install 通道）、`global-pause`（全局 mode=off）、`profile-off`（dshProfiles 不含 web）、`harness-off`（dsh 分家 off）。

## 验证

- `npm test`：6/6。
- dsh-go 官方 `check.mjs . --load`：退出码 0，2 胶囊 + 1 状态条 + 1 面板 + 1 对话操作，工具 2 个，视图中英双语可显示。

## 署名

注入语义（`stripIdentity` / `rewriteSections` / `resolveActivation`）对齐 [ZiChuanLan/agent-purge](https://github.com/ZiChuanLan/agent-purge)（MIT）。本适配版为独立执行端，未复制其 CLI/Web 代码；协议与 `sdk/plugin-kit` 来自 [ccch1mneyyy/dsh-Go](https://github.com/ccch1mneyyy/dsh-Go)（sdk/ 与 examples/ 为 MIT）。
