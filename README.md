<p align="center">
  <img src="images/claudeclaw-banner.svg" alt="ClaudeClaw Banner" />
</p>

<h1 align="center">ClaudeClaw for QQ</h1>

<p align="center">
  <img src="https://img.shields.io/badge/QQ-Official%20Bot%20API-blue?style=flat-square&logo=tencent-qq" alt="QQ Bot API" />
  <img src="https://img.shields.io/badge/Claude%20Code-Plugin-purple?style=flat-square" alt="Claude Code Plugin" />
  <img src="https://img.shields.io/badge/Runtime-Bun-black?style=flat-square" alt="Bun Runtime" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT License" />
</p>

<p align="center"><b>将你的 Claude Code 转换为在后台持久运行的 QQ 机器人 — 类似 OpenClaw，但免费、本地运行，且完全由你掌控。</b></p>

---

## 这是什么？

这是 [ClaudeClaw](https://github.com/moazbuilds/ClaudeClaw) 的一个分支，集成了 QQ 官方机器人 API。它允许你：

- **将 Claude Code 连接到 QQ** — 直接在 QQ 上与 AI 助手聊天（C2C 私信、群组 @提及、频道消息）
- **24/7 后台运行** — 作为守护进程，始终监听你的消息
- **无 API 额外开销** — 直接使用你现有的 Claude Code / Claude Max 订阅
- **多通道支持** — QQ + Telegram + Discord，全部同时支持

## 工作原理

```
┌─────────────┐     WebSocket      ┌──────────────────┐     CLI invoke     ┌─────────────┐
│  QQ Official │ ◄──────────────► │   ClaudeClaw      │ ◄────────────────► │ Claude Code │
│  Bot Gateway │   Events / Send   │   Daemon (Bun)   │   --resume mode   │   Session   │
└─────────────┘                    └──────────────────┘                    └─────────────┘
                                          │
                                    ┌─────┴─────┐
                                    │ Telegram   │
                                    │ Discord    │
                                    │ Web UI     │
                                    │ Cron Jobs  │
                                    └───────────┘
```

ClaudeClaw 通过 WebSocket 网关连接到腾讯 QQ 官方机器人 API，实时接收消息，并使用 `--resume` 调用 Claude Code CLI，在消息之间保持对话上下文。

## QQ 机器人功能

| 功能 | 状态 |
|---------|--------|
| C2C（私聊）消息 | 支持 |
| 群组 @提及 消息 | 支持 |
| 频道 @提及 消息 | 支持 |
| 频道私信 | 支持 |
| 斜杠命令（/start、/reset） | 支持 |
| 图片附件 | 支持 |
| 文件附件（接收） | 支持（所有场景） |
| 文件回传（发送） | C2C 全支持；群聊/频道仅限图片和视频 |
| 消息分割（>2000 字符） | 自动 |
| 正在输入指示器 | 自动 |
| 自动重连 | 是（指数退避）|
| 用户白名单（union_openid） | 支持 |
| 群组监听模式（无需 @提及）| 支持 |

### 文件处理

用户可以通过 QQ 向 Bot 发送文件，Claude 会读取并处理文件内容，处理结果文件会自动发送回 QQ。

**工作流程：**
1. 用户发送文件附件 + 文字说明（例如"帮我分析这个 PDF"）
2. Bot 下载文件到本地临时目录
3. Claude 读取文件内容并按用户要求处理
4. Claude 将结果文件保存到输出目录
5. Bot 上传并发送结果文件给用户
6. 自动清理临时文件

**QQ 官方频道机器人文件发送 API 限制：**

| 文件类型 | 支持格式 | C2C 私聊 | 群聊 | 频道 |
|---------|---------|----------|------|------|
| 图片 | png, jpg | 支持 | 支持 | 支持 |
| 视频 | mp4 | 支持 | 支持 | 支持 |
| 语音 | silk, wav, mp3, flac | 支持 | 不支持 | 不支持 |
| 文件 | pdf, doc, txt 等 | 支持 | **不支持** | **不支持** |

> **注意：** QQ 官方 Bot API 对群聊和频道场景**不支持**发送语音和通用文件（pdf/doc/txt 等）。在这些场景下，Bot 只能回传图片和视频。如需 Claude 返回文档类结果，请使用 C2C 私聊。

## 快速开始

### 前置要求

1. **Bun** 运行时 — [安装](https://bun.sh)
2. **Claude Code** CLI — [安装](https://docs.anthropic.com/en/docs/claude-code)
3. **QQ 官方机器人** — 在 [q.qq.com](https://q.qq.com/) 注册

### 第一步：克隆并安装

```bash
git clone https://github.com/YYMLVU/claudeclaw_for_qq.git
cd claudeclaw_for_qq
bun install
```

### 第二步：配置 QQ 机器人

在项目目录下创建设置文件 `.claude/claudeclaw/settings.json`：

```json
{
  "model": "",
  "api": "",
  "fallback": { "model": "", "api": "" },
  "agentic": { "enabled": false, "defaultMode": "implementation", "modes": [] },
  "timezone": "Asia/Shanghai",
  "timezoneOffsetMinutes": -480,
  "heartbeat": {
    "enabled": false,
    "interval": 15,
    "prompt": "",
    "excludeWindows": [],
    "forwardToTelegram": true
  },
  "telegram": { "token": "", "allowedUserIds": [] },
  "discord": { "token": "", "allowedUserIds": [], "listenChannels": [] },
  "qq": {
    "appId": "YOUR_QQ_BOT_APP_ID",
    "clientSecret": "YOUR_QQ_BOT_CLIENT_SECRET",
    "allowedUserIds": [],
    "groupOpenIds": []
  },
  "security": { "level": "moderate", "allowedTools": [], "disallowedTools": [] },
  "web": { "enabled": false, "host": "127.0.0.1", "port": 4632 },
  "stt": { "baseUrl": "", "model": "" }
}
```

**QQ 配置字段：**
- `appId` — 你的 QQ 机器人在 [q.qq.com](https://q.qq.com/) 的 App ID
- `clientSecret` — 你的 QQ 机器人的 Client Secret
- `allowedUserIds` — 白名单的 `union_openid` 值数组。留空 = 允许所有用户。
- `groupOpenIds` — 群组 `open_id` 值数组，机器人会响应所有消息（无需 @提及）

### 第三步：作为 QQ 机器人运行

**独立 QQ 模式：**
```bash
bun run src/index.ts qq
```

**完整守护进程模式（QQ + Telegram + Discord + Web UI + Cron）：**
```bash
bun run src/index.ts start
```

### 第四步：在 QQ 上聊天

给你的 QQ 机器人发送消息 — 它会用 Claude 回复！

## 架构

### QQ 适配器（`src/commands/qq.ts`）

QQ 适配器实现了完整的 QQ 官方机器人网关协议：

- **认证** — 通过 `https://bots.qq.com/app/getAppAccessToken` 获取访问令牌
- **WebSocket 网关** — 连接到 `wss://` 端点，支持心跳/识别/恢复
- **事件分发** — 路由 `C2C_MESSAGE_CREATE`、`GROUP_AT_MESSAGE_CREATE`、`AT_MESSAGE_CREATE`、`DIRECT_MESSAGE_CREATE`、`INTERACTION_CREATE`
- **消息发送** — REST API 调用 `/v2/users/{openid}/messages`、`/v2/groups/{openid}/messages`、`/v2/channels/{id}/messages`
- **重连** — 指数退避，检测致命关闭代码（4004、4010-4014、4914、4915）

### 会话管理

通过 `--resume <session_id>` 维护 Claude Code 会话：
- 第一条消息创建新会话
- 后续消息恢复现有会话
- `/reset` 斜杠命令清除会话以便重新开始
- 上下文过大时自动压缩

## 配置

### 安全级别

| 级别 | 描述 |
|-------|-------------|
| `locked` | 只读：只能读取文件和搜索 |
| `strict` | 禁用 Bash、禁用 WebSearch — 适合敏感环境 |
| `moderate` | 所有工具，限定在项目目录内 |
| `unrestricted` | 完全系统访问权限 |

### 智能模型路由

根据消息内容自动选择模型：

```json
{
  "agentic": {
    "enabled": true,
    "defaultMode": "implementation",
    "modes": [
      {
        "name": "planning",
        "model": "opus",
        "keywords": ["plan", "design", "architect", "research", "analyze"],
        "phrases": ["how to implement", "what's the best way"]
      },
      {
        "name": "implementation",
        "model": "sonnet",
        "keywords": ["implement", "code", "write", "fix", "debug", "deploy"]
      }
    ]
  }
}
```

### 单次任务模型覆盖

使用 `/task <model>` 临时覆盖单条消息的模型。覆盖仅应用于该特定请求 — 下一条消息会自动恢复默认或智能路由。

**支持的模型**：`opus`、`sonnet`、`haiku`

**使用方法**：
- `/task opus 解释这个复杂的架构` — 仅此请求使用 Opus
- `/task sonnet 修复代码中的这个 bug` — 仅此请求使用 Sonnet
- `/task haiku 总结这个` — 用 Haiku 快速总结

**优先级**：`/task` 覆盖拥有最高优先级，高于智能路由和全局配置。

### 定时任务

在 `.claude/claudeclaw/jobs/*.md` 中创建任务：

```markdown
---
schedule: "0 9 * * 1-5"
recurring: true
notify: true
---

审查待处理任务，检查是否有阻塞，并总结当前项目状态。
```

## 对比：ClaudeClaw vs OpenClaw

| | ClaudeClaw for QQ | OpenClaw |
|---|---|---|
| 成本 | 使用你的 Claude 订阅 | API 费用累积很快 |
| QQ 支持 | 原生官方机器人 API | 无 QQ 支持 |
| 隐私 | 本地运行，你的机器 | 云端托管 |
| 设置时间 | 约 5 分钟 | 复杂 |
| 定制化 | 完整源代码，可修改任何内容 | 有限 |
| 可靠性 | 简单，组件少 | 60万+ 行代码 |
| 多通道 | QQ + Telegram + Discord | Telegram + Discord |

## 作为系统服务运行（可选）

用于生产环境 24/7 运行，使用 PM2 或 systemd：

```bash
# PM2
pm2 start "bun run src/index.ts start" --name claudeclaw

# 或作为独立的 QQ 机器人
pm2 start "bun run src/index.ts qq" --name claudeclaw-qq
```

## 故障排查

### QQ 机器人未收到消息
- 确保你的机器人在 [q.qq.com](https://q.qq.com/) 上已审核并发布
- 检查 intents 是否已启用：`PUBLIC_GUILD_MESSAGES`、`DIRECT_MESSAGE`、`GUILDS`
- 验证 `appId` 和 `clientSecret` 是否正确

### WebSocket 不断断开
- ClaudeClaw 会使用指数退避自动重连
- 致命代码（4004、4010-4014）表示配置问题 — 检查你的凭据
- 非致命断开会自动处理

### 消息无法发送
- QQ 有 2000 字符限制 — ClaudeClaw 会自动分割长回复
- 群组消息需要 @提及机器人（除非配置了 `groupOpenIds`）
- 检查 `.claude/claudeclaw/logs/` 中的日志

## 致谢

基于 [moazbuilds](https://github.com/moazbuilds) 的 [ClaudeClaw](https://github.com/moazbuilds/ClaudeClaw)。

QQ 机器人集成使用腾讯的 [QQ 官方机器人 API v2](https://q.qq.com/)。

## 许可证

MIT
