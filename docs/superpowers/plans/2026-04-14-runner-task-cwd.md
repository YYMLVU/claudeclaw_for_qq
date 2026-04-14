# Runner Task CWD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow `claudeclaw_for_qq` to launch Claude child processes in a per-task project directory instead of always using the home directory.

**Architecture:** Add a small workdir-resolution helper in `src/runner.ts`, thread an optional `taskCwd` parameter through runner entrypoints, and pass the repository root from caller sites that know the intended project directory. Validate that any explicit `taskCwd` stays under `homedir()` before using it. This preserves the `/home/xiao` main-process startup model while giving child Claude/agent processes a git-repository cwd when needed.

**Tech Stack:** Bun, TypeScript, existing runner process spawning in `src/runner.ts`, QQ/Telegram/Discord command integrations

---

### Task 1: Add and test task workdir resolution in runner

**Files:**
- Modify: `src/runner.ts`
- Create: `src/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/runner.test.ts` with:

```ts
import { describe, expect, test } from "bun:test";
import { homedir } from "os";
import { resolveTaskWorkDir } from "./runner";

describe("resolveTaskWorkDir", () => {
  test("returns explicit task cwd when provided", () => {
    expect(resolveTaskWorkDir("/home/xiao/claudeclaw_for_qq")).toBe("/home/xiao/claudeclaw_for_qq");
  });

  test("falls back to home directory when no task cwd is provided", () => {
    expect(resolveTaskWorkDir()).toBe(homedir());
  });

  test("falls back to home directory when task cwd is outside home", () => {
    expect(resolveTaskWorkDir("/etc")).toBe(homedir());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/runner.test.ts
```

Expected: FAIL because `resolveTaskWorkDir` is not exported yet.

- [ ] **Step 3: Write minimal implementation**

In `src/runner.ts`, add:

```ts
function resolveTaskWorkDir(taskCwd?: string): string {
  const trimmed = taskCwd?.trim();
  if (!trimmed) return homedir();
  const home = homedir();
  return trimmed === home || trimmed.startsWith(`${home}/`) ? trimmed : home;
}
```

Export it, and replace the fixed `TASK_WORK_DIR` constant usage with a call to this helper at process-spawn time.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runner.ts src/runner.test.ts
git commit -m "test: cover runner task cwd resolution"
```

---

### Task 2: Thread optional taskCwd through runner APIs

**Files:**
- Modify: `src/runner.ts`
- Modify: `src/runner.test.ts`

- [ ] **Step 1: Write the failing test for whitespace fallback behavior**

Append to `src/runner.test.ts`:

```ts
describe("resolveTaskWorkDir", () => {
  test("falls back to home directory when task cwd is blank", () => {
    expect(resolveTaskWorkDir("   ")).toBe(homedir());
  });
});
```

- [ ] **Step 2: Run test to verify it fails for the expected reason**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/runner.test.ts
```

Expected: FAIL if the helper does not trim blanks yet.

- [ ] **Step 3: Update the helper and runner signatures**

In `src/runner.ts`:
- make `resolveTaskWorkDir` trim blanks before fallback and reject paths outside `homedir()`
- update `runClaudeOnce(...)` to accept `taskCwd?: string`
- update every internal `Bun.spawn(..., { cwd })` call in this file to use `resolveTaskWorkDir(taskCwd)`
- thread the same optional parameter through the public runner entrypoints that directly call `runClaudeOnce(...)` / `Bun.spawn(...)`, including `streamUserMessage(...)`

Use this helper body:

```ts
function resolveTaskWorkDir(taskCwd?: string): string {
  const trimmed = taskCwd?.trim();
  return trimmed ? trimmed : homedir();
}
```

- [ ] **Step 4: Run the runner tests**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/runner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run a build verification**

Run:

```bash
bun build /home/xiao/claudeclaw_for_qq/src/index.ts --target bun --outdir /tmp/claudeclaw-build-check
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/runner.ts src/runner.test.ts
git commit -m "refactor: allow per-task runner working directories"
```

---

### Task 3: Pass repository cwd from command integrations

**Files:**
- Modify: `src/commands/qq.ts`
- Modify: `src/commands/telegram.ts`
- Modify: `src/commands/discord.ts`

- [ ] **Step 1: Identify direct `streamUserMessage(...)` callsites in command integrations**

Update every command integration in this repository that directly calls `streamUserMessage(...)` to pass the repository root path explicitly. Use the fixed repository path for this project:

```ts
const projectDir = "/home/xiao/claudeclaw_for_qq";
```

and pass it via the new optional `taskCwd` parameter.

- [ ] **Step 2: Update the QQ integration**

For each `streamUserMessage(...)` call in `src/commands/qq.ts`, append the project dir argument in the new parameter position.

- [ ] **Step 3: Update Telegram and Discord integrations if they call the same runner API**

For each matching callsite in `src/commands/telegram.ts` and `src/commands/discord.ts`, pass the same project dir.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
bun test /home/xiao/claudeclaw_for_qq/src/runner.test.ts /home/xiao/claudeclaw_for_qq/src/commands/qq.send-files.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run the build verification**

Run:

```bash
bun build /home/xiao/claudeclaw_for_qq/src/index.ts --target bun --outdir /tmp/claudeclaw-build-check
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/runner.ts src/runner.test.ts src/commands/qq.ts src/commands/telegram.ts src/commands/discord.ts
git commit -m "fix: run Claude tasks in the project repository cwd"
```
