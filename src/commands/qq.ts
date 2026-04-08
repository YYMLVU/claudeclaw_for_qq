/**
 * QQ Bot adapter — connects to Tencent's Official QQ Bot API v2.
 *
 * Protocol: QQ Official Bot (https://q.qq.com/), NOT OneBot v11.
 * Uses WebSocket gateway (wss://) for receiving events and
 * REST API (https://api.sgroup.qq.com) for sending messages.
 *
 * Supported message types:
 *   - C2C (private) messages
 *   - Group @mention messages
 *   - Guild channel @mention messages
 *   - Guild DM messages
 *   - Slash commands / interactions
 */

import { runUserMessage } from "../runner";
import { getSettings, loadSettings } from "../config";

// --- QQ Official API constants ---

const QQ_API_BASE = "https://api.sgroup.qq.com";
const QQ_TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const QQ_GATEWAY_URL = "https://api.sgroup.qq.com/gateway";

// Gateway op codes
const Op = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
} as const;

// Intents
const INTENTS =
  (1 << 25) | // PUBLIC_GUILD_MESSAGES
  (1 << 30) | // DIRECT_MESSAGE
  (1 << 0);   // GUILDS

// Fatal close codes — no reconnect
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014, 4914, 4915]);

// --- Types ---

interface QQConfig {
  appId: string;
  clientSecret: string;
  allowedUserIds: string[]; // union_openid values
  groupOpenIds: string[];   // groups where bot responds without mention
}

interface WSPayload {
  op: number;
  d?: unknown;
  s?: number;
  t?: string;
}

interface QQUser {
  id: string;
  user_openid: string;
  union_openid: string;
}

interface QQAttachment {
  content_type: string;
  height?: number;
  url: string;
  width?: number;
}

interface C2CMessage {
  id: string;
  author: QQUser;
  content: string;
  timestamp: string;
  attachments: QQAttachment[];
  msg_elements?: MsgElement[];
}

interface GroupMessage {
  id: string;
  group_id: string;
  group_openid: string;
  author: { member_openid: string };
  content: string;
  mentions: Array<{ is_you: boolean; member_openid: string }>;
  timestamp: string;
  attachments: QQAttachment[];
}

interface GuildMessage {
  id: string;
  channel_id: string;
  guild_id: string;
  author: QQUser;
  content: string;
  mentions: Array<{ id: string }>;
  timestamp: string;
  attachments: QQAttachment[];
}

interface InteractionData {
  id: string;
  type: number;
  data?: {
    name?: string;
    resolved?: Record<string, unknown>;
    options?: Array<{ name: string; value?: unknown }>;
  };
  guild_id?: string;
  channel_id?: string;
  user?: QQUser;
  member?: { user: QQUser };
}

// --- State ---

let running = false;
let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatIntervalMs = 0;
let heartbeatAcked = true;
let lastSequence: number | null = null;
let gatewaySessionId: string | null = null;
let accessToken: string | null = null;
let tokenExpiresAt = 0;
let botAppId: string | null = null;
let botUserId: string | null = null;
let qqDebug = false;

// --- Logging ---

function debugLog(msg: string): void {
  if (!qqDebug) return;
  console.log(`[QQ][DBG] ${msg}`);
}

// --- Token management ---

async function refreshAccessToken(appId: string, clientSecret: string): Promise<string> {
  if (accessToken && Date.now() < tokenExpiresAt - 60_000) {
    return accessToken;
  }

  debugLog("Refreshing access token...");
  const res = await fetch(QQ_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, clientSecret }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get access token: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  debugLog(`Token obtained, expires in ${data.expires_in}s`);
  return accessToken;
}

// --- REST API helpers ---

async function qqApi<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const config = getSettings();
  const token = await refreshAccessToken(config.qq.appId, config.qq.clientSecret);
  const url = `${QQ_API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `QQBot ${token}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QQ API ${method} ${path}: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

// --- Message sending ---

async function sendC2CMessage(openid: string, content: string, msgId?: string): Promise<void> {
  const body: Record<string, unknown> = { content, msg_type: 0 };
  if (msgId) body.msg_id = msgId;
  await qqApi(`/v2/users/${openid}/messages`, "POST", body);
}

async function sendGroupMessage(groupOpenid: string, content: string, msgId?: string): Promise<void> {
  const body: Record<string, unknown> = { content, msg_type: 0 };
  if (msgId) body.msg_id = msgId;
  await qqApi(`/v2/groups/${groupOpenid}/messages`, "POST", body);
}

async function sendGuildMessage(channelId: string, content: string, msgId?: string): Promise<void> {
  const body: Record<string, unknown> = { content, msg_type: 0 };
  if (msgId) body.msg_id = msgId;
  await qqApi(`/v2/channels/${channelId}/messages`, "POST", body);
}

async function sendTyping(channelId: string, endpoint: "user" | "group" | "channel"): Promise<void> {
  try {
    const url = endpoint === "user"
      ? `/v2/users/${channelId}/messages`
      : endpoint === "group"
        ? `/v2/groups/${channelId}/messages`
        : `/v2/channels/${channelId}/messages`;
    await qqApi(url, "POST", { content: "", msg_type: 6 });
  } catch {
    // Typing indicator is non-critical
  }
}

// --- WebSocket helpers ---

function sendWs(payload: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatAcked = true;
  heartbeatTimer = setInterval(() => {
    if (!heartbeatAcked) {
      debugLog("Heartbeat not acked, reconnecting...");
      ws?.close(4000, "Heartbeat not acked");
      return;
    }
    heartbeatAcked = false;
    sendWs({ op: Op.HEARTBEAT, d: lastSequence });
    debugLog("Heartbeat sent");
  }, heartbeatIntervalMs);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function sendIdentify(): void {
  if (!accessToken) return;
  sendWs({
    op: Op.IDENTIFY,
    d: {
      token: `QQBot ${accessToken}`,
      intents: INTENTS,
      shard: [0, 1],
    },
  });
  debugLog("Identify sent");
}

function sendResume(): void {
  if (!accessToken || !gatewaySessionId) return;
  sendWs({
    op: Op.RESUME,
    d: {
      token: `QQBot ${accessToken}`,
      session_id: gatewaySessionId,
      seq: lastSequence,
    },
  });
  debugLog("Resume sent");
}

function resetGatewayState(): void {
  heartbeatIntervalMs = 0;
  heartbeatAcked = true;
  lastSequence = null;
  gatewaySessionId = null;
}

// --- Message handling ---

function getUserIdentifier(msg: C2CMessage | GroupMessage | GuildMessage): string {
  const author = msg as C2CMessage | GuildMessage;
  if ("union_openid" in author.author) {
    return author.author.union_openid;
  }
  if ("member_openid" in msg.author) {
    return (msg as GroupMessage).author.member_openid;
  }
  return "unknown";
}

function getUsername(msg: C2CMessage | GroupMessage | GuildMessage): string {
  const author = msg as C2CMessage | GuildMessage;
  if ("user_openid" in author.author) {
    return `user:${author.author.user_openid?.slice(0, 8)}`;
  }
  if ("member_openid" in msg.author) {
    return `member:${(msg as GroupMessage).author.member_openid?.slice(0, 8)}`;
  }
  return "unknown";
}

function isAuthorized(userId: string, config: QQConfig): boolean {
  if (config.allowedUserIds.length === 0) return true;
  return config.allowedUserIds.includes(userId);
}

function isGroupMentioned(msg: GroupMessage): boolean {
  return msg.mentions?.some((m) => m.is_you) ?? false;
}

function isGroupListen(groupOpenid: string, config: QQConfig): boolean {
  return config.groupOpenIds.includes(groupOpenid);
}

function cleanContent(content: string): string {
  // Strip QQ face tags: <face id="N">text</face>
  return content.replace(/<face[^>]*>.*?<\/face>/g, "").trim();
}

function buildPrompt(label: string, content: string, imageUrl?: string): string {
  const parts = [`[QQ from ${label}]`];
  if (content.trim()) parts.push(`Message: ${content}`);
  if (imageUrl) {
    parts.push(`Image URL: ${imageUrl}`);
    parts.push("The user attached an image. You can describe what you see or ask about it.");
  }
  return parts.join("\n");
}

async function handleC2CMessage(msg: C2CMessage): Promise<void> {
  const config = getSettings().qq;
  const userId = msg.author.union_openid;
  const label = getUsername(msg);

  if (!isAuthorized(userId, config)) {
    debugLog(`Unauthorized C2C from ${label}`);
    return;
  }

  const content = cleanContent(msg.content);
  if (!content && msg.attachments.length === 0) return;

  const imageUrl = msg.attachments?.[0]?.url;
  console.log(`[${new Date().toLocaleTimeString()}] QQ C2C ${label}: "${content.slice(0, 60)}"`);

  try {
    await sendTyping(msg.author.user_openid, "user");
    const prompt = buildPrompt(label, content, imageUrl);
    const result = await runUserMessage("qq", prompt);

    if (result.exitCode !== 0) {
      await sendC2CMessage(msg.author.user_openid, `Error (exit ${result.exitCode}): ${result.stderr || result.stdout || "Unknown error"}`);
    } else {
      // QQ has a 2000 char limit for text messages; split if needed
      const text = (result.stdout || "").trim();
      if (!text) {
        await sendC2CMessage(msg.author.user_openid, "(empty response)");
      } else if (text.length <= 2000) {
        await sendC2CMessage(msg.author.user_openid, text, msg.id);
      } else {
        // Split into chunks
        const chunks = splitMessage(text, 2000);
        for (let i = 0; i < chunks.length; i++) {
          await sendC2CMessage(msg.author.user_openid, chunks[i], i === 0 ? msg.id : undefined);
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[QQ] C2C error for ${label}: ${errMsg}`);
    try {
      await sendC2CMessage(msg.author.user_openid, `Error: ${errMsg}`);
    } catch {}
  }
}

async function handleGroupMessage(msg: GroupMessage): Promise<void> {
  const config = getSettings().qq;
  const userId = msg.author.member_openid;
  const label = getUsername(msg);
  const groupLabel = `group:${msg.group_openid?.slice(0, 8)}`;

  if (!isAuthorized(userId, config)) {
    debugLog(`Unauthorized group msg from ${label} in ${groupLabel}`);
    return;
  }

  const shouldRespond = isGroupMentioned(msg) || isGroupListen(msg.group_openid, config);
  if (!shouldRespond) {
    debugLog(`Skip group msg (no mention/listen): ${content}`);
    return;
  }

  const content = cleanContent(msg.content);
  if (!content && msg.attachments.length === 0) return;

  const imageUrl = msg.attachments?.[0]?.url;
  console.log(`[${new Date().toLocaleTimeString()}] QQ Group ${groupLabel} ${label}: "${content.slice(0, 60)}"`);

  try {
    await sendTyping(msg.group_openid, "group");
    const prompt = buildPrompt(`${label} in ${groupLabel}`, content, imageUrl);
    const result = await runUserMessage("qq", prompt);

    if (result.exitCode !== 0) {
      await sendGroupMessage(msg.group_openid, `Error (exit ${result.exitCode}): ${result.stderr || result.stdout || "Unknown error"}`);
    } else {
      const text = (result.stdout || "").trim();
      if (!text) {
        await sendGroupMessage(msg.group_openid, "(empty response)");
      } else if (text.length <= 2000) {
        await sendGroupMessage(msg.group_openid, text, msg.id);
      } else {
        const chunks = splitMessage(text, 2000);
        for (let i = 0; i < chunks.length; i++) {
          await sendGroupMessage(msg.group_openid, chunks[i], i === 0 ? msg.id : undefined);
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[QQ] Group error for ${label}: ${errMsg}`);
    try {
      await sendGroupMessage(msg.group_openid, `Error: ${errMsg}`);
    } catch {}
  }
}

async function handleGuildMessage(msg: GuildMessage): Promise<void> {
  const config = getSettings().qq;
  const userId = msg.author.union_openid;
  const label = getUsername(msg);

  if (!isAuthorized(userId, config)) {
    debugLog(`Unauthorized guild msg from ${label}`);
    return;
  }

  const isMentioned = msg.mentions?.some((m) => m.id === botUserId) ?? false;
  if (!isMentioned) {
    debugLog(`Skip guild msg (no mention): ${msg.content.slice(0, 40)}`);
    return;
  }

  const content = cleanContent(msg.content);
  if (!content && msg.attachments.length === 0) return;

  const imageUrl = msg.attachments?.[0]?.url;
  console.log(`[${new Date().toLocaleTimeString()}] QQ Guild ch=${msg.channel_id} ${label}: "${content.slice(0, 60)}"`);

  try {
    await sendTyping(msg.channel_id, "channel");
    const prompt = buildPrompt(`${label} in guild:${msg.guild_id}`, content, imageUrl);
    const result = await runUserMessage("qq", prompt);

    if (result.exitCode !== 0) {
      await sendGuildMessage(msg.channel_id, `Error (exit ${result.exitCode}): ${result.stderr || result.stdout || "Unknown error"}`);
    } else {
      const text = (result.stdout || "").trim();
      if (!text) {
        await sendGuildMessage(msg.channel_id, "(empty response)");
      } else if (text.length <= 2000) {
        await sendGuildMessage(msg.channel_id, text, msg.id);
      } else {
        const chunks = splitMessage(text, 2000);
        for (let i = 0; i < chunks.length; i++) {
          await sendGuildMessage(msg.channel_id, chunks[i], i === 0 ? msg.id : undefined);
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[QQ] Guild error for ${label}: ${errMsg}`);
    try {
      await sendGuildMessage(msg.channel_id, `Error: ${errMsg}`);
    } catch {}
  }
}

async function handleInteraction(interaction: InteractionData): Promise<void> {
  const config = getSettings().qq;
  const user = interaction.user ?? interaction.member?.user;
  const userId = user?.union_openid;
  if (!userId || !isAuthorized(userId, config)) return;

  // Respond to slash commands
  if (interaction.type === 2 && interaction.data?.name) {
    const cmdName = interaction.data.name;
    let responseText = "";

    if (cmdName === "start") {
      responseText = "你好！给我发消息，我会用 Claude 来回复。\n使用 /reset 开始一个新会话。";
    } else if (cmdName === "reset") {
      const { resetSession } = await import("../sessions");
      await resetSession();
      responseText = "会话已重置。";
    } else {
      responseText = `未知命令: ${cmdName}`;
    }

    try {
      await qqApi(`/v2/interaction/${interaction.id}/callback`, "POST", { type: 0, data: { content: responseText } });
    } catch (err) {
      console.error(`[QQ] Failed to respond to interaction: ${err}`);
    }
  }
}

// --- Message splitting utility ---

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitIdx = remaining.lastIndexOf("\n", maxLen);
    if (splitIdx < maxLen * 0.5) {
      splitIdx = remaining.lastIndexOf(" ", maxLen);
    }
    if (splitIdx < maxLen * 0.3) {
      splitIdx = maxLen;
    }
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }
  return chunks;
}

// --- Gateway dispatch handler ---

function handleDispatch(eventName: string, data: unknown): void {
  debugLog(`Dispatch: ${eventName}`);

  switch (eventName) {
    case "READY":
      const ready = data as { session_id: string; user: { id: string } };
      gatewaySessionId = ready.session_id;
      botUserId = ready.user.id;
      console.log(`[QQ] Ready — appId: ${botAppId}, user: ${ready.user.id}`);
      break;

    case "RESUMED":
      console.log("[QQ] Session resumed");
      break;

    case "C2C_MESSAGE_CREATE":
      handleC2CMessage(data as C2CMessage).catch((err) =>
        console.error("[QQ] C2C_MESSAGE_CREATE unhandled:", err),
      );
      break;

    case "GROUP_AT_MESSAGE_CREATE":
      handleGroupMessage(data as GroupMessage).catch((err) =>
        console.error("[QQ] GROUP_AT_MESSAGE_CREATE unhandled:", err),
      );
      break;

    case "AT_MESSAGE_CREATE":
      handleGuildMessage(data as GuildMessage).catch((err) =>
        console.error("[QQ] AT_MESSAGE_CREATE unhandled:", err),
      );
      break;

    case "DIRECT_MESSAGE_CREATE":
      handleGuildMessage(data as GuildMessage).catch((err) =>
        console.error("[QQ] DIRECT_MESSAGE_CREATE unhandled:", err),
      );
      break;

    case "INTERACTION_CREATE":
      handleInteraction(data as InteractionData).catch((err) =>
        console.error("[QQ] INTERACTION_CREATE unhandled:", err),
      );
      break;

    default:
      debugLog(`Unhandled event: ${eventName}`);
  }
}

function handlePayload(payload: WSPayload): void {
  if (payload.s !== null && payload.s !== undefined) {
    lastSequence = payload.s;
  }

  switch (payload.op) {
    case Op.HELLO:
      heartbeatIntervalMs = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
      startHeartbeat();
      if (gatewaySessionId && lastSequence !== null) {
        sendResume();
      } else {
        sendIdentify();
      }
      break;

    case Op.HEARTBEAT_ACK:
      heartbeatAcked = true;
      break;

    case Op.HEARTBEAT:
      sendHeartbeat();
      break;

    case Op.RECONNECT:
      debugLog("Gateway requested reconnect");
      ws?.close(4000, "Reconnect requested");
      break;

    case Op.INVALID_SESSION: {
      const resumable = payload.d as boolean;
      debugLog(`Invalid session, resumable=${resumable}`);
      if (!resumable) {
        gatewaySessionId = null;
        lastSequence = null;
      }
      setTimeout(() => {
        if (resumable && gatewaySessionId) {
          sendResume();
        } else {
          sendIdentify();
        }
      }, 1000 + Math.random() * 4000);
      break;
    }

    case Op.DISPATCH:
      handleDispatch(payload.t!, payload.d);
      break;
  }
}

function sendHeartbeat(): void {
  sendWs({ op: Op.HEARTBEAT, d: lastSequence });
}

// --- Gateway connection ---

const RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000, 60000];
let reconnectAttempt = 0;

async function connectGateway(): Promise<void> {
  const config = getSettings().qq;

  // Refresh token before connecting
  await refreshAccessToken(config.appId, config.clientSecret);

  // Get gateway URL
  debugLog("Fetching gateway URL...");
  const gw = (await qqApi<{ url: string }>("/gateway"));
  const gatewayUrl = gw.url;
  debugLog(`Gateway URL: ${gatewayUrl}`);

  resetGatewayState();
  ws = new WebSocket(gatewayUrl);

  ws.onopen = () => {
    debugLog("Gateway WebSocket opened");
    reconnectAttempt = 0;
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as WSPayload;
      handlePayload(payload);
    } catch (err) {
      console.error(`[QQ] Failed to parse gateway payload: ${err}`);
    }
  };

  ws.onclose = (event) => {
    debugLog(`Gateway closed: code=${event.code} reason=${event.reason}`);
    stopHeartbeat();
    if (!running) return;

    if (FATAL_CLOSE_CODES.has(event.code)) {
      console.error(`[QQ] Fatal close code ${event.code} — not reconnecting`);
      return;
    }

    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    reconnectAttempt++;
    console.log(`[QQ] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})...`);
    setTimeout(() => connectGateway(), delay);
  };

  ws.onerror = (event) => {
    console.error(`[QQ] WebSocket error:`, event);
  };
}

// --- Public API ---

/** Send a message to a QQ user (C2C) by union_openid. */
export async function sendMessageToUser(token: string, openid: string, text: string): Promise<void> {
  await sendC2CMessage(openid, text);
}

/** Start the QQ bot gateway connection. */
export async function startQQBot(debug = false): Promise<void> {
  qqDebug = debug;
  const config = getSettings().qq;

  if (!config.appId || !config.clientSecret) {
    console.error("[QQ] appId and clientSecret are required. Set them in .claude/claudeclaw/settings.json under qq.");
    return;
  }

  if (ws) stopQQBot();

  running = true;
  botAppId = config.appId;

  console.log("QQ bot started (official API gateway)");
  console.log(`  AppId: ${config.appId.slice(0, 8)}...`);
  console.log(`  Allowed users: ${config.allowedUserIds.length === 0 ? "all" : config.allowedUserIds.join(", ")}`);
  if (config.groupOpenIds.length > 0) {
    console.log(`  Listen groups: ${config.groupOpenIds.join(", ")}`);
  }
  if (debug) console.log("  Debug: enabled");

  await connectGateway();
}

/** Stop the QQ bot gateway connection. */
export function stopQQBot(): void {
  running = false;
  stopHeartbeat();
  if (ws) {
    ws.close(1000, "Shutting down");
    ws = null;
  }
  accessToken = null;
  botAppId = null;
  botUserId = null;
  console.log("[QQ] Bot stopped");
}

/** Standalone entry point (bun run src/index.ts qq) */
export async function qq(): Promise<void> {
  await loadSettings();
  const config = getSettings().qq;

  if (!config.appId || !config.clientSecret) {
    console.error("QQ bot not configured. Set qq.appId and qq.clientSecret in .claude/claudeclaw/settings.json");
    process.exit(1);
  }

  console.log("QQ bot started (standalone)");
  console.log(`  AppId: ${config.appId.slice(0, 8)}...`);

  await startQQBot();

  // Keep alive
  process.on("SIGINT", () => stopQQBot());
  process.on("SIGTERM", () => stopQQBot());
}
