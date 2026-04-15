# QQ Task Subsessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build persistent QQ `/task <model>` subsessions keyed by QQ target + model, while keeping normal QQ messages on the existing main session.

**Architecture:** Add a dedicated task-session store separate from the existing global session file, extend the runner to support an explicit task session scope, then route QQ `/task` messages through that scope. Reuse the existing streaming reply path and Claude `--resume` support instead of introducing long-lived Claude worker processes.

**Tech Stack:** Bun, TypeScript, Claude Code CLI `--resume`, QQ bot adapter, JSON-backed session persistence

---

## File Structure

- Create: `src/taskSessions.ts`
  - Owns persistent QQ task-session records keyed by `qq:<targetType>:<targetId>:<model>`
- Modify: `src/runner.ts`
  - Add explicit task-session scope support for `streamUserMessage` and `runUserMessage`
- Modify: `src/commands/qq.ts`
  - Build task-session keys for private/group/channel QQ messages and pass task scope into the runner
- Modify: `src/commands/qq.test.ts`
  - Add tests for QQ task-session key routing helpers
- Create: `src/taskSessions.test.ts`
  - Add store-level tests for create/read/update behavior
- Modify: `src/runner.test.ts`
  - Add runner-level tests for task-scope resume vs new-session behavior

### Task 1: Add task-session persistence

**Files:**
- Create: `src/taskSessions.ts`
- Test: `src/taskSessions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "bun:test";
import {
  createTaskSession,
  getTaskSession,
  incrementTaskSessionTurn,
  markTaskSessionCompactWarned,
  resetTaskSessionsForTests,
} from "./taskSessions";

describe("taskSessions", () => {
  beforeEach(async () => {
    await resetTaskSessionsForTests();
  });

  it("creates and reloads a task session by key", async () => {
    await createTaskSession({
      taskSessionKey: "qq:private:user-openid:haiku",
      sessionId: "session-123",
      channel: "qq",
      targetType: "private",
      targetId: "user-openid",
      model: "haiku",
    });

    expect(await getTaskSession("qq:private:user-openid:haiku")).toEqual({
      sessionId: "session-123",
      turnCount: 0,
      compactWarned: false,
    });
  });

  it("tracks turns and compact warning independently per key", async () => {
    await createTaskSession({
      taskSessionKey: "qq:group:group-openid:sonnet",
      sessionId: "session-456",
      channel: "qq",
      targetType: "group",
      targetId: "group-openid",
      model: "sonnet",
    });

    expect(await incrementTaskSessionTurn("qq:group:group-openid:sonnet")).toBe(1);
    await markTaskSessionCompactWarned("qq:group:group-openid:sonnet");

    expect(await getTaskSession("qq:group:group-openid:sonnet")).toEqual({
      sessionId: "session-456",
      turnCount: 1,
      compactWarned: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test /home/xiao/claudeclaw_for_qq/src/taskSessions.test.ts`
Expected: FAIL because `./taskSessions` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
import { join } from "path";

const HEARTBEAT_DIR = join(process.cwd(), ".claude", "claudeclaw");
const TASK_SESSIONS_FILE = join(HEARTBEAT_DIR, "task-sessions.json");

export interface TaskSessionRecord {
  sessionId: string;
  taskSessionKey: string;
  channel: "qq";
  targetType: "private" | "group" | "channel";
  targetId: string;
  model: string;
  createdAt: string;
  lastUsedAt: string;
  turnCount: number;
  compactWarned: boolean;
}

interface TaskSessionsData {
  tasks: Record<string, TaskSessionRecord>;
}

let taskSessionsCache: TaskSessionsData | null = null;

async function loadTaskSessions(): Promise<TaskSessionsData> {
  if (taskSessionsCache) return taskSessionsCache;
  try {
    taskSessionsCache = await Bun.file(TASK_SESSIONS_FILE).json();
    return taskSessionsCache!;
  } catch {
    taskSessionsCache = { tasks: {} };
    return taskSessionsCache;
  }
}

async function saveTaskSessions(data: TaskSessionsData): Promise<void> {
  taskSessionsCache = data;
  await Bun.write(TASK_SESSIONS_FILE, JSON.stringify(data, null, 2) + "\n");
}

export async function getTaskSession(taskSessionKey: string): Promise<{ sessionId: string; turnCount: number; compactWarned: boolean } | null> {
  const data = await loadTaskSessions();
  const session = data.tasks[taskSessionKey];
  if (!session) return null;
  session.lastUsedAt = new Date().toISOString();
  await saveTaskSessions(data);
  return {
    sessionId: session.sessionId,
    turnCount: session.turnCount,
    compactWarned: session.compactWarned,
  };
}

export async function createTaskSession(input: {
  taskSessionKey: string;
  sessionId: string;
  channel: "qq";
  targetType: "private" | "group" | "channel";
  targetId: string;
  model: string;
}): Promise<void> {
  const data = await loadTaskSessions();
  data.tasks[input.taskSessionKey] = {
    ...input,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    turnCount: 0,
    compactWarned: false,
  };
  await saveTaskSessions(data);
}

export async function incrementTaskSessionTurn(taskSessionKey: string): Promise<number> {
  const data = await loadTaskSessions();
  const session = data.tasks[taskSessionKey];
  if (!session) return 0;
  session.turnCount += 1;
  await saveTaskSessions(data);
  return session.turnCount;
}

export async function markTaskSessionCompactWarned(taskSessionKey: string): Promise<void> {
  const data = await loadTaskSessions();
  const session = data.tasks[taskSessionKey];
  if (!session) return;
  session.compactWarned = true;
  await saveTaskSessions(data);
}

export async function resetTaskSessionsForTests(): Promise<void> {
  taskSessionsCache = { tasks: {} };
  await Bun.write(TASK_SESSIONS_FILE, JSON.stringify(taskSessionsCache, null, 2) + "\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test /home/xiao/claudeclaw_for_qq/src/taskSessions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/xiao/claudeclaw_for_qq add src/taskSessions.ts src/taskSessions.test.ts
git -C /home/xiao/claudeclaw_for_qq commit -m "feat: persist QQ task subsessions"
```

### Task 2: Teach runner to use task-session scope

**Files:**
- Modify: `src/runner.ts`
- Test: `src/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, mock } from "bun:test";
import { streamUserMessage } from "./runner";

describe("streamUserMessage task scope", () => {
  it("resumes an existing task session for the same model key", async () => {
    const onChunk = mock(async (_text: string) => {});
    const onUnblock = mock(() => {});

    const exitCode = await streamUserMessage(
      "qq",
      "find logs",
      onChunk,
      onUnblock,
      undefined,
      {
        kind: "task",
        taskSessionKey: "qq:private:user-openid:haiku",
        channel: "qq",
        targetType: "private",
        targetId: "user-openid",
        model: "haiku",
      },
      "haiku",
      "/home/xiao/claudeclaw_for_qq"
    );

    expect(exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test /home/xiao/claudeclaw_for_qq/src/runner.test.ts`
Expected: FAIL because `streamUserMessage` does not yet accept a task-session scope object.

- [ ] **Step 3: Write minimal implementation**

```ts
export type SessionScope =
  | { kind: "global" }
  | {
      kind: "task";
      taskSessionKey: string;
      channel: "qq";
      targetType: "private" | "group" | "channel";
      targetId: string;
      model: string;
    };

async function getScopedSession(scope?: SessionScope) {
  if (!scope || scope.kind === "global") return await getSession();
  return await getTaskSession(scope.taskSessionKey);
}

async function createScopedSession(scope: SessionScope | undefined, sessionId: string): Promise<void> {
  if (!scope || scope.kind === "global") {
    await createSession(sessionId);
    return;
  }
  await createTaskSession({
    taskSessionKey: scope.taskSessionKey,
    sessionId,
    channel: scope.channel,
    targetType: scope.targetType,
    targetId: scope.targetId,
    model: scope.model,
  });
}

async function incrementScopedTurn(scope?: SessionScope): Promise<number> {
  if (!scope || scope.kind === "global") return await incrementTurn();
  return await incrementTaskSessionTurn(scope.taskSessionKey);
}

async function markScopedCompactWarned(scope?: SessionScope): Promise<void> {
  if (!scope || scope.kind === "global") {
    await markCompactWarned();
    return;
  }
  await markTaskSessionCompactWarned(scope.taskSessionKey);
}
```

Also update the `streamUserMessage` and `runUserMessage` signatures so the scope argument is accepted and used when choosing whether to append `--resume`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test /home/xiao/claudeclaw_for_qq/src/runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/xiao/claudeclaw_for_qq add src/runner.ts src/runner.test.ts
git -C /home/xiao/claudeclaw_for_qq commit -m "feat: add runner support for task session scopes"
```

### Task 3: Route QQ `/task` messages into persistent subsessions

**Files:**
- Modify: `src/commands/qq.ts`
- Test: `src/commands/qq.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "bun:test";
import { buildQqTaskSessionScope } from "./qq";

describe("buildQqTaskSessionScope", () => {
  it("builds a private task session key from user_openid and model", () => {
    expect(buildQqTaskSessionScope({
      targetType: "private",
      targetId: "user-openid-123",
      model: "haiku",
    })).toEqual({
      kind: "task",
      taskSessionKey: "qq:private:user-openid-123:haiku",
      channel: "qq",
      targetType: "private",
      targetId: "user-openid-123",
      model: "haiku",
    });
  });

  it("builds different keys for different models in the same target", () => {
    expect(buildQqTaskSessionScope({
      targetType: "group",
      targetId: "group-openid-123",
      model: "haiku",
    })?.taskSessionKey).not.toBe(buildQqTaskSessionScope({
      targetType: "group",
      targetId: "group-openid-123",
      model: "sonnet",
    })?.taskSessionKey);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.test.ts`
Expected: FAIL because `buildQqTaskSessionScope` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
function buildQqTaskSessionScope(input: {
  targetType: "private" | "group" | "channel";
  targetId: string;
  model: string | null;
}) {
  if (!input.model) return undefined;
  return {
    kind: "task" as const,
    taskSessionKey: `qq:${input.targetType}:${input.targetId}:${input.model}`,
    channel: "qq" as const,
    targetType: input.targetType,
    targetId: input.targetId,
    model: input.model,
  };
}
```

Then update QQ message handlers so:
- C2C `/task` passes `buildQqTaskSessionScope({ targetType: "private", targetId: msg.author.user_openid, model: taskModel })`
- Group `/task` passes `buildQqTaskSessionScope({ targetType: "group", targetId: msg.group_openid, model: groupTaskModel })`
- Guild `/task` passes `buildQqTaskSessionScope({ targetType: "channel", targetId: msg.channel_id, model: guildTaskModel })`
- Normal messages pass `undefined`

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test /home/xiao/claudeclaw_for_qq/src/commands/qq.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/xiao/claudeclaw_for_qq add src/commands/qq.ts src/commands/qq.test.ts
git -C /home/xiao/claudeclaw_for_qq commit -m "feat: route QQ task messages into model subsessions"
```

### Task 4: Run focused regression verification

**Files:**
- Modify: `src/taskSessions.test.ts`
- Modify: `src/runner.test.ts`
- Modify: `src/commands/qq.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("keeps normal QQ messages out of task scope", async () => {
  const scope = buildQqTaskSessionScope({
    targetType: "private",
    targetId: "user-openid-123",
    model: null,
  });

  expect(scope).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test /home/xiao/claudeclaw_for_qq/src/taskSessions.test.ts /home/xiao/claudeclaw_for_qq/src/runner.test.ts /home/xiao/claudeclaw_for_qq/src/commands/qq.test.ts`
Expected: FAIL because the regression coverage is incomplete.

- [ ] **Step 3: Write minimal implementation**

Add the missing focused assertions so the final regression suite covers:

```ts
expect(buildQqTaskSessionScope({
  targetType: "private",
  targetId: "user-openid-123",
  model: null,
})).toBeUndefined();

expect(buildQqTaskSessionScope({
  targetType: "private",
  targetId: "user-openid-123",
  model: "haiku",
})?.taskSessionKey).toBe("qq:private:user-openid-123:haiku");

expect(buildQqTaskSessionScope({
  targetType: "channel",
  targetId: "channel-123",
  model: "haiku",
})?.taskSessionKey).toBe("qq:channel:channel-123:haiku");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test /home/xiao/claudeclaw_for_qq/src/taskSessions.test.ts /home/xiao/claudeclaw_for_qq/src/runner.test.ts /home/xiao/claudeclaw_for_qq/src/commands/qq.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C /home/xiao/claudeclaw_for_qq add src/taskSessions.test.ts src/runner.test.ts src/commands/qq.test.ts
git -C /home/xiao/claudeclaw_for_qq commit -m "test: cover QQ task subsession regressions"
```
