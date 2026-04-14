# QQ Model-Driven File Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace QQ's keyword-plus-new-file heuristic with an explicit Claude-declared file-send protocol that allows sending any file under `homedir()`.

**Architecture:** The QQ adapter will stop inferring file-send intent from user keywords and stop depending on newly created files in `~/tmp/`. Instead, the Claude response text will optionally contain a `<qq-send-files>` block listing absolute file paths, and the adapter will parse, validate, and send exactly those files after the text response is delivered.

**Tech Stack:** Bun, TypeScript, QQ Official Bot API v2, existing QQ adapter flow in `src/commands/qq.ts`

---

### Task 1: Add parser and path validation helpers

**Files:**
- Modify: `src/commands/qq.ts`

- [ ] **Step 1: Write the failing test as helper-level assertions in a temporary test file**

Create `src/commands/qq.send-files.test.ts` with:

```ts
import { describe, expect, test } from "bun:test";
import { homedir } from "os";
import { extractDeclaredSendFiles } from "./qq";

describe("extractDeclaredSendFiles", () => {
  test("returns absolute file paths from qq-send-files block", () => {
    const home = homedir();
    const result = extractDeclaredSendFiles(`done\n<qq-send-files>\n${home}/tmp/a.pdf\n${home}/work/b.txt\n</qq-send-files>`);
    expect(result).toEqual([`${home}/tmp/a.pdf`, `${home}/work/b.txt`]);
  });

  test("returns empty array when block is missing", () => {
    expect(extractDeclaredSendFiles("done")).toEqual([]);
  });

  test("ignores blank lines and trims whitespace", () => {
    const home = homedir();
    const result = extractDeclaredSendFiles(`\n<qq-send-files>\n  ${home}/tmp/a.pdf  \n\n ${home}/tmp/b.txt}\n</qq-send-files>\n`);
    expect(result).toEqual([`${home}/tmp/a.pdf`, `${home}/tmp/b.txt}`]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: FAIL because `extractDeclaredSendFiles` is not exported yet.

- [ ] **Step 3: Write minimal parser and validator helpers in `src/commands/qq.ts`**

Add imports and helpers near the file utility section:

```ts
import { join, dirname, basename, resolve } from "path";
import { mkdir, readFile, writeFile, readdir, stat } from "fs/promises";

function extractDeclaredSendFiles(text: string): string[] {
  const match = text.match(/<qq-send-files>\s*([\s\S]*?)\s*<\/qq-send-files>/i);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeDeclaredSendFile(filePath: string): string {
  return resolve(expandHomePath(filePath));
}

function isAllowedSendFilePath(filePath: string): boolean {
  return filePath === HOME_DIR || filePath.startsWith(`${HOME_DIR}/`);
}

export { extractDeclaredSendFiles };
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/qq.ts src/commands/qq.send-files.test.ts
git commit -m "feat: add QQ declared file send parser"
```

---

### Task 2: Add strict runtime validation for declared files

**Files:**
- Modify: `src/commands/qq.ts`
- Modify: `src/commands/qq.send-files.test.ts`

- [ ] **Step 1: Write the failing test for allowed home paths and disallowed external paths**

Append to `src/commands/qq.send-files.test.ts`:

```ts
import { isAllowedSendFilePath } from "./qq";

describe("isAllowedSendFilePath", () => {
  test("allows files under home directory", () => {
    const home = homedir();
    expect(isAllowedSendFilePath(`${home}/tmp/a.pdf`)).toBe(true);
  });

  test("rejects files outside home directory", () => {
    expect(isAllowedSendFilePath("/etc/passwd")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: FAIL because `isAllowedSendFilePath` is not exported yet.

- [ ] **Step 3: Export the minimal helper implementation**

Update `src/commands/qq.ts` exports to:

```ts
export { extractDeclaredSendFiles, isAllowedSendFilePath };
```

Keep `isAllowedSendFilePath` based on the normalized absolute path under `HOME_DIR` only.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/qq.ts src/commands/qq.send-files.test.ts
git commit -m "test: cover QQ declared file path validation"
```

---

### Task 3: Update prompt contract to require explicit send declarations

**Files:**
- Modify: `src/commands/qq.ts`

- [ ] **Step 1: Write the failing test for prompt text shape**

Add a prompt test to `src/commands/qq.send-files.test.ts`:

```ts
import { buildPrompt } from "./qq";

describe("buildPrompt", () => {
  test("instructs Claude to emit qq-send-files block with absolute paths", () => {
    const prompt = buildPrompt("user:test", "send me the report");
    expect(prompt).toContain("If you want QQ to send files, write the real file to disk first.");
    expect(prompt).toContain("Then append a <qq-send-files> block to your final response.");
    expect(prompt).toContain("Inside that block, put one absolute file path per line.");
    expect(prompt).toContain("Only list files that already exist under ~/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: FAIL because the prompt text does not include the new protocol yet.

- [ ] **Step 3: Update `buildPrompt` with the new contract**

In `src/commands/qq.ts`, add these lines inside `buildPrompt(...)` after the workspace lines:

```ts
parts.push("If you want QQ to send files, write the real file to disk first.");
parts.push("Then append a <qq-send-files> block to your final response.");
parts.push("Inside that block, put one absolute file path per line.");
parts.push("Only list files that already exist under ~/.");
parts.push("Do not mention a file-send block unless QQ should actually send those files.");
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/qq.ts src/commands/qq.send-files.test.ts
git commit -m "feat: document QQ declared file send protocol"
```

---

### Task 4: Replace C2C send logic with declared-file sending

**Files:**
- Modify: `src/commands/qq.ts`
- Modify: `src/commands/qq.send-files.test.ts`

- [ ] **Step 1: Write the failing test for declared file extraction from a completed response**

Add a protocol-oriented test:

```ts
describe("extractDeclaredSendFiles integration shape", () => {
  test("parses files from final response without relying on newEntries", () => {
    const home = homedir();
    const fullText = `Summary here\n<qq-send-files>\n${home}/tmp/report.pdf\n</qq-send-files>`;
    expect(extractDeclaredSendFiles(fullText)).toEqual([`${home}/tmp/report.pdf`]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes before handler wiring**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: PASS, confirming helper behavior before wiring.

- [ ] **Step 3: Replace C2C post-run scan logic with declared-file validation and sending**

In `handleC2CMessage`, replace the block beginning at `// Send result files from output directory` with logic shaped like this:

```ts
const declaredFiles = [...new Set(extractDeclaredSendFiles(fullText).map(normalizeDeclaredSendFile))];
console.log(`[QQ] Declared files for user ${label}: ${declaredFiles.length}`);
for (const filePath of declaredFiles) {
  if (!isAllowedSendFilePath(filePath)) {
    await sendC2CMessage(msg.author.user_openid, `Claude 请求发送的文件超出允许范围: ${toTildePath(filePath)}`);
    continue;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    await sendC2CMessage(msg.author.user_openid, `Claude 请求发送文件，但文件不存在: ${toTildePath(filePath)}`);
    continue;
  }

  if (!fileStat.isFile()) {
    await sendC2CMessage(msg.author.user_openid, `Claude 请求发送的路径不是普通文件: ${toTildePath(filePath)}`);
    continue;
  }

  try {
    await uploadAndSendFile("user", msg.author.user_openid, filePath);
  } catch (err) {
    console.error(`[QQ] Failed to send declared file ${filePath}: ${err instanceof Error ? err.message : err}`);
    await sendC2CMessage(msg.author.user_openid, `(文件发送失败: ${basename(filePath)})`);
  }
}
```

Delete the `beforeEntries` snapshot and `newEntries` logic from the C2C path.

- [ ] **Step 4: Build**

Run:

```bash
bun build "/home/xiao/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/commands/qq.ts src/commands/qq.send-files.test.ts
git commit -m "fix: use declared file sends for QQ C2C replies"
```

---

### Task 5: Replace Group and Guild send logic with declared-file sending

**Files:**
- Modify: `src/commands/qq.ts`

- [ ] **Step 1: Replace Group post-run scan logic**

In `handleGroupMessage`, remove `beforeEntries`, `visibleEntries`, `newEntries`, and keyword fallback logic. Use the same declared-file loop as C2C, but send errors with:

```ts
await sendGroupMessage(msg.group_openid, `Claude 请求发送文件，但文件不存在: ${toTildePath(filePath)}`);
```

and upload via:

```ts
await uploadAndSendFile("group", msg.group_openid, filePath);
```

- [ ] **Step 2: Replace Guild post-run scan logic**

In `handleGuildMessage`, remove `beforeEntries`, `visibleEntries`, `newEntries`, and keyword fallback logic. Use the same declared-file loop as C2C, but send errors with:

```ts
await sendGuildMessage(msg.channel_id, `Claude 请求发送文件，但文件不存在: ${toTildePath(filePath)}`);
```

and upload via:

```ts
await uploadAndSendFile("channel", msg.channel_id, filePath);
```

- [ ] **Step 3: Remove dead keyword helper if unused**

If `wantsFileOutput(...)` is no longer referenced after the handler changes, delete it.

- [ ] **Step 4: Build**

Run:

```bash
bun build "/home/xiao/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/commands/qq.ts
git commit -m "fix: use declared file sends for QQ group and guild replies"
```

---

### Task 6: Verify full behavior and clean up test coverage

**Files:**
- Modify: `src/commands/qq.send-files.test.ts`
- Modify: `src/commands/qq.ts`

- [ ] **Step 1: Add the final focused tests for parser and prompt contract**

Ensure the test file contains these final cases:
- parser returns empty array without block
- parser trims blank lines
- home-path validator allows home and rejects external paths
- prompt includes the `<qq-send-files>` protocol instructions

- [ ] **Step 2: Run the focused tests**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run a build verification**

Run:

```bash
bun build "/home/xiao/claudeclaw_for_qq/src/index.ts" --target bun --outdir "/tmp/claudeclaw-build-check"
```

Expected: build succeeds.

- [ ] **Step 4: Remove any dead imports or snapshot code left behind**

Delete any no-longer-used `readdir`, `wantsFileOutput`, or snapshot variables if the compiler shows them as unused.

- [ ] **Step 5: Commit**

```bash
git add src/commands/qq.ts src/commands/qq.send-files.test.ts
git commit -m "test: verify QQ model-driven file send flow"
```
