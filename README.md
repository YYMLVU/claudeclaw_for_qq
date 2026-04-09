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

<p align="center"><b>Transform your Claude Code into a QQ Bot that runs persistently in the background — just like OpenClaw, but free, local, and fully under your control.</b></p>

---

## What is this?

This is a fork of [ClaudeClaw](https://github.com/moazbuilds/ClaudeClaw) with QQ Official Bot API integration. It allows you to:

- **Connect Claude Code to QQ** — Chat with your AI assistant directly from QQ (C2C private messages, group @mentions, guild channels)
- **Run 24/7 in the background** — As a daemon process, always listening for your messages
- **No API overhead** — Uses your existing Claude Code / Claude Max subscription directly
- **Multi-channel** — QQ + Telegram + Discord, all at once

## How it works

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

ClaudeClaw connects to Tencent's QQ Official Bot API via WebSocket gateway, receives messages in real time, and invokes Claude Code CLI with `--resume` to maintain conversation context across messages.

## QQ Bot Features

| Feature | Status |
|---------|--------|
| C2C (Private) Messages | Supported |
| Group @Mention Messages | Supported |
| Guild Channel @Mention Messages | Supported |
| Guild DM Messages | Supported |
| Slash Commands (/start, /reset) | Supported |
| Image Attachments | Supported |
| Message Splitting (>2000 chars) | Auto |
| Typing Indicators | Auto |
| Auto-Reconnect | Yes (exponential backoff) |
| User Whitelist (union_openid) | Supported |
| Group Listen Mode (no @mention needed) | Supported |

## Quick Start

### Prerequisites

1. **Bun** runtime — [install](https://bun.sh)
2. **Claude Code** CLI — [install](https://docs.anthropic.com/en/docs/claude-code)
3. **QQ Official Bot** — Register at [q.qq.com](https://q.qq.com/)

### Step 1: Clone & Install

```bash
git clone https://github.com/YYMLVU/claudeclaw_for_qq.git
cd claudeclaw_for_qq
bun install
```

### Step 2: Configure QQ Bot

Create a settings file at `.claude/claudeclaw/settings.json` in your project directory:

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

**QQ Config Fields:**
- `appId` — Your QQ Bot's App ID from [q.qq.com](https://q.qq.com/)
- `clientSecret` — Your QQ Bot's Client Secret
- `allowedUserIds` — Array of `union_openid` values to whitelist. Empty = allow all users.
- `groupOpenIds` — Array of group `open_id` values where the bot responds to ALL messages (no @mention needed)

### Step 3: Run as QQ Bot

**Standalone QQ mode:**
```bash
bun run src/index.ts qq
```

**Full daemon mode (QQ + Telegram + Discord + Web UI + Cron):**
```bash
bun run src/index.ts start
```

### Step 4: Chat on QQ

Send a message to your QQ Bot — it will respond using Claude!

## Architecture

### QQ Adapter (`src/commands/qq.ts`)

The QQ adapter implements the full QQ Official Bot Gateway protocol:

- **Authentication** — Obtains access tokens via `https://bots.qq.com/app/getAppAccessToken`
- **WebSocket Gateway** — Connects to `wss://` endpoint with heartbeat/identify/resume
- **Event Dispatch** — Routes `C2C_MESSAGE_CREATE`, `GROUP_AT_MESSAGE_CREATE`, `AT_MESSAGE_CREATE`, `DIRECT_MESSAGE_CREATE`, `INTERACTION_CREATE`
- **Message Sending** — REST API calls to `/v2/users/{openid}/messages`, `/v2/groups/{openid}/messages`, `/v2/channels/{id}/messages`
- **Reconnection** — Exponential backoff with fatal close code detection (4004, 4010-4014, 4914, 4915)

### Session Management

Claude Code sessions are maintained via `--resume <session_id>`:
- First message creates a new session
- Subsequent messages resume the existing session
- `/reset` slash command clears the session for a fresh start
- Auto-compact when context grows too large

## Configuration

### Security Levels

| Level | Description |
|-------|-------------|
| `locked` | Read-only: can only read files and search |
| `strict` | No Bash, no WebSearch — safe for sensitive environments |
| `moderate` | All tools, scoped to project directory |
| `unrestricted` | Full system access |

### Agentic Model Routing

Enable automatic model selection based on message content:

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

### Task Model Override

Use `/task <model>` to temporarily override the model for a single message. The override is only applied to that specific request — the next message automatically reverts to the default or agentic routing.

**Supported models**: `opus`, `sonnet`, `haiku`

**Usage**:
- `/task opus Explain this complex architecture` — Use Opus for this request only
- `/task sonnet Fix this bug in the code` — Use Sonnet for this request only
- `/task haiku Summarize this` — Use Haiku for a quick summary

**Priority**: `/task` override takes highest priority, above agentic routing and global config.

### Cron Jobs

Create jobs in `.claude/claudeclaw/jobs/*.md`:

```markdown
---
schedule: "0 9 * * 1-5"
recurring: true
notify: true
---

Review pending tasks, check for any blockers, and summarize the current project status.
```

## Comparison: ClaudeClaw vs OpenClaw

| | ClaudeClaw for QQ | OpenClaw |
|---|---|---|
| Cost | Uses your Claude subscription | API costs add up fast |
| QQ Support | Native Official Bot API | No QQ support |
| Privacy | Runs locally, your machine | Cloud-hosted |
| Setup Time | ~5 minutes | Complex |
| Customization | Full source code, modify anything | Limited |
| Reliability | Simple, few moving parts | 600k+ LOC |
| Multi-Channel | QQ + Telegram + Discord | Telegram + Discord |

## Running as a System Service (Optional)

For production 24/7 uptime, run with PM2 or systemd:

```bash
# PM2
pm2 start "bun run src/index.ts start" --name claudeclaw

# Or as a standalone QQ bot
pm2 start "bun run src/index.ts qq" --name claudeclaw-qq
```

## Troubleshooting

### QQ Bot not receiving messages
- Ensure your bot is approved and published on [q.qq.com](https://q.qq.com/)
- Check that intents are enabled: `PUBLIC_GUILD_MESSAGES`, `DIRECT_MESSAGE`, `GUILDS`
- Verify `appId` and `clientSecret` are correct

### WebSocket keeps disconnecting
- ClaudeClaw auto-reconnects with exponential backoff
- Fatal codes (4004, 4010-4014) mean configuration issues — check your credentials
- Non-fatal disconnects are handled automatically

### Messages not sending
- QQ has a 2000 character limit — ClaudeClaw auto-splits long responses
- Group messages require the bot to be @mentioned (unless `groupOpenIds` is configured)
- Check logs in `.claude/claudeclaw/logs/`

## Credits

Based on [ClaudeClaw](https://github.com/moazbuilds/ClaudeClaw) by [moazbuilds](https://github.com/moazbuilds).

QQ Bot integration uses Tencent's [QQ Official Bot API v2](https://q.qq.com/).

## License

MIT
