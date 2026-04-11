# QQ File Workspace Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize QQ multi-turn file workflows by moving all QQ files to `~/tmp/`, preserving files across turns, and keeping the current scan-and-send mechanism as a transition path.

**Architecture:** Incoming QQ files are downloaded into `~/tmp/` and are no longer deleted after each message. Claude is told to use `~/tmp/` and `~/` paths, while the bot continues using output-directory scanning for file sending in this phase. This avoids the current cross-turn file loss without requiring a custom Claude tool bridge in `runner.ts` yet.

**Tech Stack:** Bun, TypeScript, QQ Official Bot API v2, existing QQ adapter flow in `src/commands/qq.ts`

---

### Task 1: Normalize QQ file paths to `~/tmp/`

**Files:**
- Modify: `src/commands/qq.ts`

- [ ] **Step 1: Ensure file helper layer uses `homedir()` and `~/tmp/` semantics**

The file helpers should define:

```ts
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

- [ ] **Step 2: Ensure all C2C/Group/Guild incoming file downloads use `~/tmp/`**

Each handler should use:

```ts
const downloadDir = getDefaultDownloadDir();
await mkdir(downloadDir, { recursive: true });
const filename = buildDownloadedFilename(filePaths.length, att.content_type);
const destPath = join(downloadDir, filename);
await downloadFile(att.url, destPath);
```

- [ ] **Step 3: Build**

Run:

```bash
bun build "~/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/commands/qq.ts
git commit -m "refactor: normalize QQ file downloads to ~/tmp"
```

---

### Task 2: Stop deleting QQ files after each message

**Files:**
- Modify: `src/commands/qq.ts`

- [ ] **Step 1: Remove per-turn cleanup calls from C2C handler**

Delete the cleanup block in C2C:

```ts
// Cleanup temp directories
await cleanupDir(inputDir);
await cleanupDir(outputDir);
```

Since phase A keeps files across turns, these lines must not remain.

- [ ] **Step 2: Remove per-turn cleanup calls from Group handler**

Delete the cleanup block in Group:

```ts
// Cleanup temp directories
await cleanupDir(inputDir);
await cleanupDir(outputDir);
```

- [ ] **Step 3: Remove per-turn cleanup calls from Guild handler**

Delete the cleanup block in Guild:

```ts
// Cleanup temp directories
await cleanupDir(inputDir);
await cleanupDir(outputDir);
```

- [ ] **Step 4: Remove now-unused cleanup-only helper references if they become dead**

If `cleanupDir`, `inputDir`, `outputDir`, `getFilesDir`, `getOutputDir`, or `generateSessionId` become unused after this phase-A cleanup removal, remove the dead code only if the file still builds cleanly.

- [ ] **Step 5: Build**

Run:

```bash
bun build "~/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/commands/qq.ts
git commit -m "fix: preserve QQ files across turns"
```

---

### Task 3: Make prompts directory-based instead of per-turn-output-based

**Files:**
- Modify: `src/commands/qq.ts`

- [ ] **Step 1: Rewrite `buildPrompt` to describe `~/tmp/` and `~/`**

Replace the current outputDir-heavy wording with a directory-oriented prompt. It should state:
- QQ attachments are downloaded into `~/tmp/`
- Claude may inspect files under `~/`
- if the user wants a result file, Claude should write a real file under `~/tmp/` or another `~/` path
- do not merely say a file was created

Use this implementation shape:

```ts
function buildPrompt(label: string, content: string, imageUrl?: string, filePaths?: string[]): string {
  const parts = [`[QQ from ${label}]`];
  if (content.trim()) parts.push(`Message: ${content}`);

  parts.push("QQ file workspace: received QQ attachments are downloaded into ~/tmp/");
  parts.push("You may also read or write files anywhere under ~/ when needed.");
  parts.push("If the user wants a file as output, create a real file under ~/tmp/ or another ~/ path.");
  parts.push("Do not only describe the file — write the actual file to disk.");

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

- [ ] **Step 2: Update all callsites to stop passing `outputDir`**

Change all three callsites from the current form:

```ts
buildPrompt(label, effectiveContent, imageUrl, filePaths.length > 0 ? filePaths : undefined, outputDir)
```

to:

```ts
buildPrompt(label, effectiveContent, imageUrl, filePaths.length > 0 ? filePaths : undefined)
```

Apply equivalent changes in C2C, Group, and Guild handlers.

- [ ] **Step 3: Keep output scanning for now, but point it at `~/tmp/`**

In phase A, sending still uses scan-and-send. The scan target should be the same stable workspace Claude now knows about. Replace per-turn output directory usage with:

```ts
const outputDir = getDefaultDownloadDir();
```

This allows the bot to scan `~/tmp/` for files Claude created.

- [ ] **Step 4: Build**

Run:

```bash
bun build "~/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/commands/qq.ts
git commit -m "feat: switch QQ file prompts to persistent ~/tmp workspace"
```

---

### Task 4: Prevent repeated re-sending of old files in `~/tmp/`

**Files:**
- Modify: `src/commands/qq.ts`

- [ ] **Step 1: Add a lightweight per-handler snapshot before Claude runs**

Before the `streamUserMessage(...)` call in each handler, snapshot the current visible files in `~/tmp/`:

```ts
const outputDir = getDefaultDownloadDir();
await mkdir(outputDir, { recursive: true });
const beforeEntries = new Set((await readdir(outputDir)).filter((entry) => !entry.startsWith(".")));
```

- [ ] **Step 2: Change post-run scanning to send only newly created files**

Replace the current scan logic with:

```ts
const entries = await readdir(outputDir);
const visibleEntries = entries.filter((entry) => !entry.startsWith("."));
const newEntries = visibleEntries.filter((entry) => !beforeEntries.has(entry));
console.log(`[QQ] Output scan for user ${label}: dir=${toTildePath(outputDir)} entries=${visibleEntries.length} new=${newEntries.length}`);
```

Then send only `newEntries`, not all visible entries.

Apply the equivalent change in C2C, Group, and Guild handlers.

- [ ] **Step 3: Preserve current fallback text for empty output**

Keep the existing fallback behavior when the user asked for a file but no new file was produced, but base it on `newEntries.length === 0` instead of total entries.

- [ ] **Step 4: Build**

Run:

```bash
bun build "~/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/commands/qq.ts
git commit -m "fix: send only newly created QQ output files"
```

---

### Task 5: Update README for phase-A behavior

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the file workflow section**

Replace the current numbered workflow that ends with automatic cleanup. It should now say:
1. user sends QQ attachment + instructions
2. bot downloads files into `~/tmp/`
3. Claude reads files from `~/tmp/` or elsewhere under `~/`
4. Claude writes real result files into `~/tmp/` or another `~/` path
5. bot scans the workspace and sends newly created files
6. files are preserved for follow-up turns unless explicitly deleted

- [ ] **Step 2: Update user-facing path examples to prefer `~/...`**

Do not mention absolute home-directory paths in the README when describing normal usage.

- [ ] **Step 3: Build sanity check**

Run:

```bash
bun build "~/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: describe persistent QQ file workspace in ~/tmp"
```

---

### Task 6: Restart and manual verification

**Files:** none

- [ ] **Step 1: Restart the bot**

Run:

```bash
pm2 restart claudeclaw-qq --update-env
```

Expected: process is online

- [ ] **Step 2: Verify startup logs**

Run:

```bash
pm2 logs claudeclaw-qq --lines 10 --nostream 2>&1
```

Expected: contains `QQ bot started` and `[QQ] Ready`

- [ ] **Step 3: Manual QQ checks**

Verify these manual scenarios:
1. Ask the bot to generate a new text file and send it
2. Upload a file, then in a later turn ask to transform that same file
3. Ask the bot to delete a file under `~/tmp/`
4. Confirm previously existing files are not resent every turn

Expected:
- files persist across turns
- no per-turn cleanup deletes them
- only newly created files are sent

- [ ] **Step 4: Push changes**

Run:

```bash
git push origin main
```
