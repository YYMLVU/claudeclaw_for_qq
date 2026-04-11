# QQ Bot File Handling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable QQ Bot users to send non-image files for Claude to process and receive result files back.

**Architecture:** Download received files to `/tmp/claudeclaw-files/<sessionId>/`, pass local paths to Claude in the prompt. Claude saves output files to `/tmp/claudeclaw-output/<sessionId>/`. After processing, upload result files via QQ rich media API (base64 `file_data`) and send as `msg_type: 7` messages. Clean up temp files after sending.

**Tech Stack:** Bun runtime, QQ Official Bot API v2 (rich media endpoints), existing `qqApi` helper

**Design spec:** `docs/superpowers/plans/2026-04-10-file-handling-design.md`

---

### Task 1: Add file utility functions to qq.ts

**Files:**
- Modify: `src/commands/qq.ts` (after line 240, after `editMessage` function)

- [ ] **Step 1: Add import for `homedir` and path utilities**

At the top of `src/commands/qq.ts`, add after the existing imports (after line 17):

```typescript
import { homedir } from "os";
```

- [ ] **Step 2: Add temp directory constants and helper functions**

After the `editMessage` function (around line 240), add:

```typescript
// --- File handling utilities ---

const FILES_BASE_DIR = join(homedir(), ".claude", "claudeclaw", "tmp");

function getFilesDir(sessionId: string): string {
  return join(FILES_BASE_DIR, "input", sessionId);
}

function getOutputDir(sessionId: string): string {
  return join(FILES_BASE_DIR, "output", sessionId);
}

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Download a file from URL to local path */
async function downloadFile(url: string, destPath: string): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = await res.arrayBuffer();
  await Bun.write(destPath, buf);
}

/** Get file_type number for QQ rich media API */
function getFileType(contentType: string, filename: string): number {
  if (contentType.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(filename)) return 1;
  if (contentType.startsWith("video/") || /\.mp4$/i.test(filename)) return 2;
  if (contentType.startsWith("audio/") || /\.(silk|wav|mp3|flac)$/i.test(filename)) return 3;
  return 4; // generic file (pdf, doc, txt, etc.)
}

/** Upload a local file and send it as a rich media message */
async function uploadAndSendFile(
  endpoint: "user" | "group" | "channel",
  channelId: string,
  filePath: string,
): Promise<void> {
  const fileData = await Bun.file(filePath).arrayBuffer();
  const base64 = Buffer.from(fileData).toString("base64");
  const filename = basename(filePath);
  const contentType = getContentType(filename);
  const fileType = getFileType(contentType, filename);

  // Upload
  const uploadPath = endpoint === "user"
    ? `/v2/users/${channelId}/files`
    : endpoint === "group"
      ? `/v2/groups/${channelId}/files`
      : `/v2/channels/${channelId}/messages`;

  // Group/Channel file_type 3 (voice) and 4 (file) are not supported — skip
  if (endpoint !== "user" && fileType >= 3) {
    console.log(`[QQ] Skipping file send: type ${fileType} not supported in ${endpoint}`);
    return;
  }

  const uploadBody: Record<string, unknown> = {
    file_type: fileType,
    file_data: `base64://${base64}`,
    srv_send_msg: false,
  };

  // Channels use a different upload mechanism — send directly with msg_type 7
  if (endpoint === "channel") {
    // For channels, we embed the file_data directly in the message
    const sendBody: Record<string, unknown> = {
      msg_type: 7,
      media: {
        file_info: JSON.stringify({ file_type: fileType, file_data: `base64://${base64}` }),
      },
    };
    await qqApi(`/v2/channels/${channelId}/messages`, "POST", sendBody);
    return;
  }

  const uploadRes = await qqApi<{ file_info: string; file_uuid: string }>(
    uploadPath, "POST", uploadBody,
  );

  // Send message with uploaded file
  const sendPath = endpoint === "user"
    ? `/v2/users/${channelId}/messages`
    : `/v2/groups/${channelId}/messages`;

  await qqApi(sendPath, "POST", {
    msg_type: 7,
    media: {
      file_uuid: uploadRes.file_uuid,
      file_info: uploadRes.file_info,
    },
  });
}

/** Infer content type from filename */
function getContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    mp4: "video/mp4",
    silk: "audio/silk", wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac",
    pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    txt: "text/plain", csv: "text/csv", json: "application/json",
    zip: "application/zip",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Recursively delete a directory */
async function cleanupDir(dir: string): Promise<void> {
  try {
    const proc = Bun.spawn(["rm", "-rf", dir], { stdout: "pipe", stderr: "pipe" });
    await proc.exited;
  } catch {
    // Cleanup is non-critical
  }
}
```

Also add `dirname` and `basename` to the path import at line 2:

Change: `import { join } from "path";`
To: `import { join, dirname, basename } from "path";`

- [ ] **Step 3: Commit**

```bash
git add src/commands/qq.ts
git commit -m "feat: add file download/upload/cleanup utilities for QQ bot"
```

---

### Task 2: Modify `buildPrompt` to support file paths

**Files:**
- Modify: `src/commands/qq.ts` — `buildPrompt` function (lines 347-355)

- [ ] **Step 1: Update `buildPrompt` signature and logic**

Replace the existing `buildPrompt` function:

```typescript
function buildPrompt(label: string, content: string, imageUrl?: string, filePaths?: string[], outputDir?: string): string {
  const parts = [`[QQ from ${label}]`];
  if (content.trim()) parts.push(`Message: ${content}`);
  if (imageUrl) {
    parts.push(`Image URL: ${imageUrl}`);
    parts.push("The user attached an image. You can describe what you see or ask about it.");
  }
  if (filePaths && filePaths.length > 0) {
    parts.push(`The user attached ${filePaths.length > 1 ? "files" : "a file"}:`);
    for (const p of filePaths) {
      parts.push(`  - ${p}`);
    }
    parts.push("Read the file(s) and process them as requested by the user.");
    if (outputDir) {
      parts.push(`If you need to return a file as a result, save it to: ${outputDir}`);
      parts.push("Supported return formats: images (png/jpg), documents (pdf/doc/txt), code files, data files (csv/json), etc.");
    }
  }
  return parts.join("\n");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/commands/qq.ts
git commit -m "feat: extend buildPrompt to support file paths and output directory"
```

---

### Task 3: Modify C2C handler for file support

**Files:**
- Modify: `src/commands/qq.ts` — `handleC2CMessage` function (lines 357-461)

- [ ] **Step 1: Update handleC2CMessage to download files and send results**

Replace the section from `const content = cleanContent(msg.content);` through the end of the try block in `handleC2CMessage`. The key changes:
1. Generate a session-specific file ID
2. Check attachments for non-image files
3. Download non-image files to `/tmp/` dir
4. Pass file paths to `buildPrompt`
5. After Claude finishes, scan output dir and send result files
6. Clean up temp directories

Replace from line 367 (`const content = cleanContent(msg.content);`) through the end of the try block. The new code:

```typescript
  const content = cleanContent(msg.content);
  if (!content && msg.attachments.length === 0) return;

  // Generate session ID for file temp directories
  const fileSessionId = generateSessionId();
  const inputDir = getFilesDir(fileSessionId);
  const outputDir = getOutputDir(fileSessionId);

  // Determine image vs file attachment
  const imageUrl = msg.attachments?.[0]?.url;
  const nonImageAttachments = msg.attachments.filter(
    (a) => !a.content_type.startsWith("image/"),
  );

  // Download non-image files
  const filePaths: string[] = [];
  for (const att of nonImageAttachments) {
    try {
      const ext = att.content_type.split("/").pop()?.split(";")[0] ?? "bin";
      const filename = `attachment-${filePaths.length}.${ext}`;
      const destPath = join(inputDir, filename);
      await downloadFile(att.url, destPath);
      filePaths.push(destPath);
    } catch (err) {
      console.error(`[QQ] Failed to download attachment: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`[${new Date().toLocaleTimeString()}] QQ C2C ${label}: "${content.slice(0, 60)}"${filePaths.length > 0 ? ` [+${filePaths.length} file(s)]` : ""}`);

  // Parse /task <model> override from raw content before buildPrompt wraps it
  const { model: taskModel, cleanPrompt: taskCleanContent } = parseTaskOverride(content);
  const effectiveContent = taskModel ? taskCleanContent : content;

  try {
    await sendTyping(msg.author.user_openid, "user");
    const prompt = buildPrompt(label, effectiveContent, imageUrl, filePaths.length > 0 ? filePaths : undefined, outputDir);
```

Then after the existing final-edit/fallback block (the `else if (!placeholderId)` section), before the `} catch (err) {` block, add result file sending:

```typescript
    // Send result files from output directory
    if (filePaths.length > 0) {
      try {
        await mkdir(outputDir, { recursive: true });
        const entries = await readdir(outputDir);
        for (const entry of entries) {
          if (entry.startsWith(".")) continue;
          const fullPath = join(outputDir, entry);
          const stat = await Bun.file(fullPath).stat?.();
          if (stat && stat.type === "file") {
            try {
              await uploadAndSendFile("user", msg.author.user_openid, fullPath);
            } catch (err) {
              console.error(`[QQ] Failed to send result file ${entry}: ${err instanceof Error ? err.message : err}`);
              // Fallback: notify user that file send failed
              try {
                await sendC2CMessage(msg.author.user_openid, `(文件发送失败: ${entry})`);
              } catch {}
            }
          }
        }
      } catch {
        // Output dir may not exist if Claude didn't create files — that's fine
      }
    }

    // Cleanup temp directories
    await cleanupDir(inputDir);
    await cleanupDir(outputDir);
```

- [ ] **Step 2: Commit**

```bash
git add src/commands/qq.ts
git commit -m "feat: C2C handler supports file receive and result file send"
```

---

### Task 4: Modify Group handler for file support

**Files:**
- Modify: `src/commands/qq.ts` — `handleGroupMessage` function (lines 464-566)

- [ ] **Step 1: Apply the same pattern as C2C, but using group endpoint**

Same changes as Task 3 but for the group handler:
- Replace `const imageUrl = msg.attachments?.[0]?.url;` section with file download logic
- Use `uploadAndSendFile("group", msg.group_openid, fullPath)` for result files
- Use `sendGroupMessage` for fallback error notifications

The group-specific differences from C2C:
- `endpoint` is `"group"`, `channelId` is `msg.group_openid`
- Result file sending: `uploadAndSendFile("group", msg.group_openid, fullPath)` — will auto-skip voice/file types not supported in groups

- [ ] **Step 2: Commit**

```bash
git add src/commands/qq.ts
git commit -m "feat: Group handler supports file receive and result file send"
```

---

### Task 5: Modify Guild handler for file support

**Files:**
- Modify: `src/commands/qq.ts` — `handleGuildMessage` function (lines 569-673)

- [ ] **Step 1: Apply the same pattern, using channel endpoint**

Same changes as Task 3 but for the guild handler:
- `endpoint` is `"channel"`, `channelId` is `msg.channel_id`
- Result file sending: `uploadAndSendFile("channel", msg.channel_id, fullPath)`

- [ ] **Step 2: Commit**

```bash
git add src/commands/qq.ts
git commit -m "feat: Guild handler supports file receive and result file send"
```

---

### Task 6: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add file handling row to the features table**

In the QQ 机器人功能 table (around line 47), add these rows after "图片附件 | 支持":

```markdown
| 文件附件（接收） | 支持（所有场景） |
| 文件回传（发送） | C2C 全支持；群聊/频道仅限图片和视频 |
```

- [ ] **Step 2: Add file handling section after "QQ 机器人功能" table**

After the table (around line 60), before "## 快速开始", add:

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document file handling feature and QQ API limitations"
```

---

### Task 7: Restart and test

**Files:** None (runtime only)

- [ ] **Step 1: Restart the service**

```bash
pm2 restart claudeclaw-qq
```

- [ ] **Step 2: Verify startup**

```bash
pm2 logs claudeclaw-qq --lines 10 --nostream
```

Expected: "QQ bot started" message, no errors

- [ ] **Step 3: Push all changes to GitHub**

```bash
git push origin main
```
