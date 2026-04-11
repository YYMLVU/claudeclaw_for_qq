# QQ File Send Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace output-directory scanning with an explicit QQ file-send tool that Claude can invoke using a file path under `~/`, while keeping received files in `~/tmp/` for multi-turn workflows.

**Architecture:** The QQ adapter will stop creating per-turn input/output directories and stop scanning output directories after each run. Instead, incoming QQ files will be downloaded into `~/tmp/`, prompts will tell Claude to use `~/tmp/` and `~/`, and a new explicit QQ send tool path will upload a requested file to the active QQ conversation after validating the path is inside the user's home directory.

**Tech Stack:** Bun, TypeScript, QQ Official Bot API v2, existing Claude CLI runner, existing QQ upload/send helpers

---

### Task 1: Refactor file path helpers to use `~/tmp/` and home-scoped paths

**Files:**
- Modify: `src/commands/qq.ts:244-289`

- [ ] **Step 1: Replace per-turn path helpers with home-based helpers**

Replace the current file workspace helpers:

```ts
const FILES_BASE_DIR = "~/.cache/claudeclaw";

function getFilesDir(sessionId: string): string {
  return join(FILES_BASE_DIR, "input", sessionId);
}

function getOutputDir(sessionId: string): string {
  return join(FILES_BASE_DIR, "output", sessionId);
}

function generateSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
```

with:

```ts
import { homedir } from "os";

const HOME_DIR = homedir();
const FILES_BASE_DIR = join(HOME_DIR, "tmp");

function getDefaultDownloadDir(): string {
  return FILES_BASE_DIR;
}

function expandHomePath(filePath: string): string {
  if (filePath === "~") return HOME_DIR;
  if (filePath.startsWith("~/")) return join(HOME_DIR, filePath.slice(2));
  return filePath;
}

function toTildePath(filePath: string): string {
  return filePath.startsWith(HOME_DIR) ? `~${filePath.slice(HOME_DIR.length)}` : filePath;
}

function isPathInsideHome(filePath: string): boolean {
  const resolved = expandHomePath(filePath);
  return resolved === HOME_DIR || resolved.startsWith(`${HOME_DIR}/`);
}

function buildDownloadedFilename(index: number, contentType: string): string {
  const ext = contentType.split("/").pop()?.split(";")[0] ?? "bin";
  return `qq-attachment-${Date.now()}-${index}.${ext}`;
}
```

- [ ] **Step 2: Update `downloadFile` callers to use `~/tmp/`**

Where the current handlers build `inputDir`/`outputDir`, remove those references and instead build download paths using:

```ts
const downloadDir = getDefaultDownloadDir();
await mkdir(downloadDir, { recursive: true });
const filename = buildDownloadedFilename(filePaths.length, att.content_type);
const destPath = join(downloadDir, filename);
```

- [ ] **Step 3: Run build to verify refactor compiles**

Run:

```bash
bun build "~/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/commands/qq.ts
git commit -m "refactor: move QQ file workspace to ~/tmp"
```

---

### Task 2: Add explicit QQ send tool plumbing in the QQ adapter

**Files:**
- Modify: `src/commands/qq.ts:291-356`
- Modify: `src/runner.ts` if needed for tool registration surface

- [ ] **Step 1: Add active QQ send context types and state**

Near the QQ file utilities section, add:

```ts
type QQSendEndpoint = "user" | "group" | "channel";

interface ActiveQQSendContext {
  endpoint: QQSendEndpoint;
  channelId: string;
  label: string;
}

let activeQQSendContext: ActiveQQSendContext | null = null;

function setActiveQQSendContext(context: ActiveQQSendContext | null): void {
  activeQQSendContext = context;
}
```

- [ ] **Step 2: Add path validation and explicit send function**

Below `uploadAndSendFile`, add:

```ts
async function sendFileToActiveQQConversation(filePath: string): Promise<void> {
  const context = activeQQSendContext;
  if (!context) throw new Error("QQ file send tool used outside an active QQ message");

  const expandedPath = expandHomePath(filePath.trim());
  if (!isPathInsideHome(expandedPath)) {
    throw new Error(`Refusing to send file outside ~/ : ${filePath}`);
  }

  const file = Bun.file(expandedPath);
  if (!(await file.exists())) {
    throw new Error(`File does not exist: ${toTildePath(expandedPath)}`);
  }

  console.log(`[QQ] Explicit send tool: ${context.label} -> ${toTildePath(expandedPath)}`);
  await uploadAndSendFile(context.endpoint, context.channelId, expandedPath);
}
```

- [ ] **Step 3: Decide tool exposure boundary**

If `runner.ts` already has a place to expose callable functions into Claude tool use, wire `sendFileToActiveQQConversation` into that path. If not, add the smallest possible bridge so QQ handlers can register a callable action while a request is running.

The implementation must preserve this behavior:
- Claude passes only a file path
- the active QQ endpoint and destination come from bot state, not the prompt

- [ ] **Step 4: Build to verify the new send path compiles**

Run:

```bash
bun build "~/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/commands/qq.ts src/runner.ts
git commit -m "feat: add explicit QQ file send tool"
```

---

### Task 3: Replace output scanning in C2C handler with explicit send-tool context

**Files:**
- Modify: `src/commands/qq.ts:491-649`

- [ ] **Step 1: Remove per-turn output dir logic from C2C handler**

Delete these concepts from `handleC2CMessage`:
- `fileSessionId`
- `inputDir`
- `outputDir`
- output scan
- cleanup of input/output dirs

Use `downloadDir = getDefaultDownloadDir()` instead.

- [ ] **Step 2: Set active send context around the Claude run**

Before calling `streamUserMessage`, set:

```ts
setActiveQQSendContext({
  endpoint: "user",
  channelId: msg.author.user_openid,
  label,
});
```

In a `finally` block around the Claude run, always reset:

```ts
setActiveQQSendContext(null);
```

- [ ] **Step 3: Update prompt construction**

Replace the current `buildPrompt(...)` call so it no longer passes `outputDir`. The prompt should instead describe `~/tmp/` and explicit sending. The function signature will be changed in a later task, but in this task update the handler callsite to match the planned prompt signature.

- [ ] **Step 4: Remove output scanning and directory cleanup**

Delete the entire post-run block that currently does:

```ts
// Send result files from output directory
...
// Cleanup temp directories
await cleanupDir(inputDir);
await cleanupDir(outputDir);
```

- [ ] **Step 5: Build to verify C2C handler compiles**

Run:

```bash
bun build "~/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/commands/qq.ts
git commit -m "refactor: remove QQ output scanning from C2C handler"
```

---

### Task 4: Replace output scanning in Group and Guild handlers

**Files:**
- Modify: `src/commands/qq.ts:653-976`

- [ ] **Step 1: Apply the same refactor to Group handler**

In `handleGroupMessage`:
- stop using `fileSessionId`, `inputDir`, `outputDir`
- download incoming files into `~/tmp/`
- set active send context to:

```ts
setActiveQQSendContext({
  endpoint: "group",
  channelId: msg.group_openid,
  label: `${label} in ${groupLabel}`,
});
```

- remove output scan and cleanup blocks
- reset context in `finally`

- [ ] **Step 2: Apply the same refactor to Guild handler**

In `handleGuildMessage`:
- stop using `fileSessionId`, `inputDir`, `outputDir`
- download incoming files into `~/tmp/`
- set active send context to:

```ts
setActiveQQSendContext({
  endpoint: "channel",
  channelId: msg.channel_id,
  label: `${label} in guild:${msg.guild_id}`,
});
```

- remove output scan and cleanup blocks
- reset context in `finally`

- [ ] **Step 3: Build to verify all QQ handlers compile**

Run:

```bash
bun build "~/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/commands/qq.ts
git commit -m "refactor: remove QQ output scanning from group and guild handlers"
```

---

### Task 5: Rewrite prompt instructions for `~/tmp/` and explicit send behavior

**Files:**
- Modify: `src/commands/qq.ts:463-489`

- [ ] **Step 1: Replace `buildPrompt` implementation**

Replace the current prompt builder with a version that:
- prefers `~/...` in all user-facing text
- tells Claude that QQ attachments are downloaded into `~/tmp/`
- tells Claude it may use any file under `~/`
- tells Claude that if it wants to send a file, it must call the QQ file-send tool with a path
- explicitly says not to merely describe sending a file

Use this implementation:

```ts
function buildPrompt(label: string, content: string, imageUrl?: string, filePaths?: string[]): string {
  const parts = [`[QQ from ${label}]`];
  if (content.trim()) parts.push(`Message: ${content}`);

  parts.push("QQ file workspace: received QQ attachments are usually downloaded into ~/tmp/");
  parts.push("You may also read or write other files under ~/ if needed.");
  parts.push("If you want to send a file back to the current QQ conversation, call the QQ file-send tool with the file path.");
  parts.push("Do not only say that you will send a file — call the tool.");

  if (imageUrl) {
    parts.push(`Image URL: ${imageUrl}`);
    parts.push("The user attached an image. You can describe what you see or ask about it.");
  }

  if (filePaths && filePaths.length > 0) {
    parts.push(`The user attached ${filePaths.length > 1 ? "files" : "a file"}:`);
    for (const p of filePaths) {
      parts.push(`  - ${toTildePath(p)}`);
    }
    parts.push("Read the file(s) and process them as requested by the user.");
  }

  return parts.join("\n");
}
```

- [ ] **Step 2: Update all callsites to use the new signature**

Change all three `buildPrompt(...)` callsites so they pass only:
- label
- content
- imageUrl
- filePaths (optional)

No `outputDir` argument should remain.

- [ ] **Step 3: Build to verify prompt refactor compiles**

Run:

```bash
bun build "~/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/commands/qq.ts
git commit -m "feat: switch QQ file prompts to explicit send tool model"
```

---

### Task 6: Remove obsolete cleanup/output helpers and update README

**Files:**
- Modify: `src/commands/qq.ts`
- Modify: `README.md`

- [ ] **Step 1: Delete obsolete helpers if they are unused**

Remove unused functions after the refactor if nothing references them anymore:
- `getFilesDir`
- `getOutputDir`
- `generateSessionId`
- `cleanupDir`
- any output-scanning-only helper logic

Keep `downloadFile`, `uploadAndSendFile`, path helpers, and send-context helpers.

- [ ] **Step 2: Update README file workflow section**

Replace the current description that says:
- files go to temporary directories
- Claude writes output directory files
- bot scans output directory
- temp files are auto-cleaned

with a description that says:
- incoming QQ attachments are downloaded into `~/tmp/`
- Claude may use files under `~/`
- Claude sends files explicitly through the QQ file-send capability
- files are not auto-deleted after each turn

Also update any absolute home-directory user-facing path references to `~/...`.

- [ ] **Step 3: Build to verify cleanup compiles**

Run:

```bash
bun build "~/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/commands/qq.ts README.md
git commit -m "docs: update QQ file workflow to explicit send tool design"
```

---

### Task 7: Manual verification and push

**Files:** none

- [ ] **Step 1: Restart the QQ bot**

Run:

```bash
pm2 restart claudeclaw-qq --update-env
```

Expected: process shows `online`

- [ ] **Step 2: Verify startup logs**

Run:

```bash
pm2 logs claudeclaw-qq --lines 10 --nostream 2>&1
```

Expected: contains `QQ bot started` and `[QQ] Ready`

- [ ] **Step 3: Manual scenario check**

Verify these scenarios manually in QQ:
1. Send a file, then ask Claude to process it and send a result file
2. Ask Claude to create a new text file and send it
3. In a later turn, ask Claude to reuse a file from `~/tmp/`
4. Ask Claude to delete a file under `~/tmp/`

Expected:
- no output-directory scan logs remain
- no auto-cleanup removes needed files
- Claude sends files explicitly by path

- [ ] **Step 4: Push to GitHub**

Run:

```bash
git push origin main
```
