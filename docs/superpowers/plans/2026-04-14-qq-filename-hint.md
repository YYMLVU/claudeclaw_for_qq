# QQ Filename Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-visible filename hint message before each QQ file send so recipients can see the intended filename even when QQ does not display it on the file card.

**Architecture:** Keep the existing model-declared file send flow unchanged, and add one small formatting helper in `src/commands/qq.ts` that turns a local path into `文件名：<basename>`. After a declared file passes validation and before `uploadAndSendFile(...)`, each handler sends that text message through its existing text-message API.

**Tech Stack:** Bun, TypeScript, QQ Official Bot API v2, existing QQ adapter flow in `src/commands/qq.ts`

---

### Task 1: Add and test the filename hint formatter

**Files:**
- Modify: `src/commands/qq.ts`
- Modify: `src/commands/qq.send-files.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test block to `src/commands/qq.send-files.test.ts`:

```ts
describe("formatSendFileHint", () => {
  test("formats a basename hint for the outgoing file", () => {
    expect(formatSendFileHint("/home/xiao/tmp/report.pdf")).toBe("文件名：report.pdf");
  });
});
```

Also update the import line to import `formatSendFileHint` from `./qq`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: FAIL because `formatSendFileHint` is not exported yet.

- [ ] **Step 3: Write minimal implementation**

In `src/commands/qq.ts`, add the helper near the other file-send helpers:

```ts
function formatSendFileHint(filePath: string): string {
  return `文件名：${basename(filePath)}`;
}
```

Then export it with the other test exports:

```ts
export { buildPrompt, extractDeclaredSendFiles, formatSendFileHint, isAllowedSendFilePath, stripDeclaredSendFilesBlock };
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
git commit -m "test: cover QQ filename hint formatting"
```

---

### Task 2: Send filename hints in C2C, Group, and Guild flows

**Files:**
- Modify: `src/commands/qq.ts`
- Modify: `src/commands/qq.send-files.test.ts`

- [ ] **Step 1: Write the failing test for another concrete formatter case**

Append this test to `src/commands/qq.send-files.test.ts`:

```ts
describe("formatSendFileHint", () => {
  test("keeps the original extension in the hint", () => {
    expect(formatSendFileHint("/home/xiao/work/archive.tar.gz")).toBe("文件名：archive.tar.gz");
  });
});
```

- [ ] **Step 2: Run test to verify it fails or errors for the expected reason**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: If Task 1 is complete, this should PASS immediately because the formatter already preserves the basename. If it does, keep the test and continue — the red/green cycle was already established for the formatter in Task 1.

- [ ] **Step 3: Add the filename hint send to the C2C handler**

In `handleC2CMessage`, inside the declared-files loop, after the file has passed `isAllowedSendFilePath`, `stat`, and `isFile()` checks, and immediately before `uploadAndSendFile("user", ...)`, insert:

```ts
try {
  await sendC2CMessage(msg.author.user_openid, formatSendFileHint(filePath));
} catch {}
```

- [ ] **Step 4: Add the filename hint send to the Group handler**

In `handleGroupMessage`, in the equivalent location, insert:

```ts
try {
  await sendGroupMessage(msg.group_openid, formatSendFileHint(filePath));
} catch {}
```

- [ ] **Step 5: Add the filename hint send to the Guild handler**

In `handleGuildMessage`, in the equivalent location, insert:

```ts
try {
  await sendGuildMessage(msg.channel_id, formatSendFileHint(filePath));
} catch {}
```

- [ ] **Step 6: Run the focused tests**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run the build verification**

Run:

```bash
bun build /home/xiao/claudeclaw_for_qq/src/index.ts --target bun --outdir /tmp/claudeclaw-build-check
```

Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/commands/qq.ts src/commands/qq.send-files.test.ts
git commit -m "fix: announce QQ filenames before sending files"
```
