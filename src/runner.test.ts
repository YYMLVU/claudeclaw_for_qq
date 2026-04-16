import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { homedir } from "os";
import { join } from "path";
import { reloadSettings } from "./config";
import { createSession, getSession, resetSession } from "./sessions";
import { createTaskSession, getTaskSession, resetTaskSessionsForTests } from "./taskSessions";
import { resolveTaskWorkDir, runUserMessage, streamUserMessage, type SessionScope } from "./runner";

const originalSpawn = Bun.spawn;
const settingsFile = join(process.cwd(), ".claude", "claudeclaw", "settings.json");
let originalSettingsText = "";

function createTextStream(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

function installSpawnMock(options: { stdout: string; stderr?: string; exitCode?: number }) {
  const calls: string[][] = [];
  const spawnMock = mock((args: string[]) => {
    calls.push([...args]);
    return {
      stdout: createTextStream(options.stdout),
      stderr: createTextStream(options.stderr ?? ""),
      exited: Promise.resolve(options.exitCode ?? 0),
      exitCode: options.exitCode ?? 0,
      kill: () => {},
    };
  });
  (Bun as typeof Bun & { spawn: typeof Bun.spawn }).spawn = spawnMock as unknown as typeof Bun.spawn;
  return { calls, spawnMock };
}

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

  test("falls back to home directory when task cwd is blank", () => {
    expect(resolveTaskWorkDir("   ")).toBe(homedir());
  });
});

test("falls back to home directory for child work when no task cwd is provided", async () => {
  const originalText = await Bun.file(settingsFile).text();
  await Bun.write(settingsFile, JSON.stringify({
    model: "sonnet",
    api: "",
    fallback: { model: "", api: "" },
    security: { level: "moderate", allowedTools: [], disallowedTools: [] },
    qq: { appId: "", clientSecret: "", allowedUserIds: [], groupOpenIds: [] },
  }, null, 2) + "\n");
  await reloadSettings();

  const spawnMock = mock((_args: string[], options?: { cwd?: string }) => {
    expect(options?.cwd).toBe(homedir());
    return {
      stdout: createTextStream(JSON.stringify({ result: "ok" })),
      stderr: createTextStream(""),
      exited: Promise.resolve(0),
      exitCode: 0,
      kill: () => {},
    };
  });

  (Bun as typeof Bun & { spawn: typeof Bun.spawn }).spawn = spawnMock as unknown as typeof Bun.spawn;

  try {
    const result = await runUserMessage("qq", "hello");
    expect(result.exitCode).toBe(0);
    expect(spawnMock).toHaveBeenCalled();
  } finally {
    Bun.spawn = originalSpawn;
    await Bun.write(settingsFile, originalText);
    await reloadSettings();
  }
});

test("uses configured Claude binary path instead of relying on PATH", async () => {
  const originalText = await Bun.file(settingsFile).text();
  await Bun.write(settingsFile, JSON.stringify({
    model: "sonnet",
    api: "",
    claudeBinPath: "/tmp/fake-claude",
    fallback: { model: "", api: "" },
    security: { level: "moderate", allowedTools: [], disallowedTools: [] },
    qq: { appId: "", clientSecret: "", allowedUserIds: [], groupOpenIds: [] },
  }, null, 2) + "\n");
  await reloadSettings();
  await resetSession();

  const { calls } = installSpawnMock({
    stdout: JSON.stringify({ session_id: "configured-binary-session", result: "ok" }),
  });

  try {
    const result = await runUserMessage("qq", "hello");
    expect(result.exitCode).toBe(0);
    expect(calls[0]?.[0]).toBe("/tmp/fake-claude");
  } finally {
    Bun.spawn = originalSpawn;
    await Bun.write(settingsFile, originalText);
    await reloadSettings();
  }
});


test("defaults to a stable claude binary path when settings omit it", async () => {
  const originalText = await Bun.file(settingsFile).text();
  await Bun.write(settingsFile, JSON.stringify({
    model: "sonnet",
    api: "",
    fallback: { model: "", api: "" },
    security: { level: "moderate", allowedTools: [], disallowedTools: [] },
    qq: { appId: "", clientSecret: "", allowedUserIds: [], groupOpenIds: [] },
  }, null, 2) + "\n");
  await reloadSettings();
  await resetSession();

  const { calls } = installSpawnMock({
    stdout: JSON.stringify({ session_id: "default-binary-session", result: "ok" }),
  });

  try {
    const result = await runUserMessage("qq", "hello");
    expect(result.exitCode).toBe(0);
    expect(calls[0]?.[0]).toBe(join(homedir(), ".bun", "bin", "claude"));
  } finally {
    Bun.spawn = originalSpawn;
    await Bun.write(settingsFile, originalText);
    await reloadSettings();
  }
});
describe("task-scoped runner sessions", () => {
  const taskScope: SessionScope = {
    kind: "task",
    taskSessionKey: "qq:private:user-openid:haiku",
    channel: "qq",
    targetType: "private",
    targetId: "user-openid",
    model: "haiku",
  };

  beforeEach(async () => {
    mock.restore();
    Bun.spawn = originalSpawn;
    originalSettingsText = await Bun.file(settingsFile).text();
    await Bun.write(settingsFile, JSON.stringify({
      model: "sonnet",
      api: "",
      fallback: { model: "", api: "" },
      security: { level: "moderate", allowedTools: [], disallowedTools: [] },
      qq: { appId: "", clientSecret: "", allowedUserIds: [], groupOpenIds: [] },
    }, null, 2) + "\n");
    await reloadSettings();
    await resetSession();
    await resetTaskSessionsForTests();
  });

  afterEach(async () => {
    Bun.spawn = originalSpawn;
    if (originalSettingsText) {
      await Bun.write(settingsFile, originalSettingsText);
      await reloadSettings();
    }
  });

  test("resumes an existing task session even when the prompt includes a /task model override", async () => {
    await createTaskSession({
      taskSessionKey: taskScope.taskSessionKey,
      sessionId: "task-session-123",
      channel: taskScope.channel,
      targetType: taskScope.targetType,
      targetId: taskScope.targetId,
      model: taskScope.model,
    });

    const { calls } = installSpawnMock({
      stdout: [
        JSON.stringify({ type: "system", subtype: "init" }),
        JSON.stringify({ type: "result", result: "ok" }),
        "",
      ].join("\n"),
    });

    const onChunk = mock((_text: string) => {});
    const onUnblock = mock(() => {});

    const exitCode = await streamUserMessage(
      "qq",
      "/task haiku find logs",
      onChunk,
      onUnblock,
      undefined,
      undefined,
      undefined,
      "/home/xiao/claudeclaw_for_qq/.worktrees/qq-task-subsessions",
      taskScope,
    );

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("--resume");
    expect(calls[0]).toContain("task-session-123");
  });

  test("creates a task session after a successful run when none exists yet", async () => {
    installSpawnMock({
      stdout: JSON.stringify({ session_id: "session-created-for-task", result: "done" }),
    });

    const result = await runUserMessage(
      "qq",
      "summarize this",
      undefined,
      "/home/xiao/claudeclaw_for_qq/.worktrees/qq-task-subsessions",
      taskScope,
    );

    expect(result.exitCode).toBe(0);
    expect(await getTaskSession(taskScope.taskSessionKey)).toEqual({
      sessionId: "session-created-for-task",
      turnCount: 0,
      compactWarned: false,
    });
  });

  test("keeps global override behavior unchanged for normal messages", async () => {
    await createSession("global-session-123");
    const { calls } = installSpawnMock({
      stdout: [
        JSON.stringify({ type: "system", subtype: "init" }),
        JSON.stringify({ type: "result", result: "ok" }),
        "",
      ].join("\n"),
    });

    const onChunk = mock((_text: string) => {});
    const onUnblock = mock(() => {});

    const exitCode = await streamUserMessage(
      "qq",
      "normal message",
      onChunk,
      onUnblock,
      undefined,
      undefined,
      "haiku",
      "/home/xiao/claudeclaw_for_qq/.worktrees/qq-task-subsessions",
    );

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("--resume");
  });

  test("uses the scoped task model when the prompt does not include /task", async () => {
    const { calls } = installSpawnMock({
      stdout: JSON.stringify({ session_id: "scoped-model-session", result: "done" }),
    });

    const result = await runUserMessage(
      "qq",
      "find logs",
      undefined,
      "/home/xiao/claudeclaw_for_qq/.worktrees/qq-task-subsessions",
      taskScope,
    );

    expect(result.exitCode).toBe(0);
    expect(calls[0]).toContain("--model");
    expect(calls[0]).toContain("haiku");
    expect(await getTaskSession(taskScope.taskSessionKey)).toEqual({
      sessionId: "scoped-model-session",
      turnCount: 0,
      compactWarned: false,
    });
  });

  test("removes an invalid task session and retries as a new session", async () => {
    await createTaskSession({
      taskSessionKey: taskScope.taskSessionKey,
      sessionId: "stale-task-session",
      channel: taskScope.channel,
      targetType: taskScope.targetType,
      targetId: taskScope.targetId,
      model: taskScope.model,
    });
    await createSession("global-session-should-stay");

    const { calls } = installSpawnMock({
      stdout: JSON.stringify({ session_id: "fresh-task-session", result: "done" }),
      stderr: "No conversation found with session ID: stale-task-session",
      exitCode: 0,
    });

    const result = await runUserMessage(
      "qq",
      "/task haiku retry task",
      undefined,
      "/home/xiao/claudeclaw_for_qq/.worktrees/qq-task-subsessions",
      taskScope,
    );

    expect(result.exitCode).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--resume");
    expect(calls[1]).not.toContain("--resume");
    expect(await getTaskSession(taskScope.taskSessionKey)).toEqual({
      sessionId: "fresh-task-session",
      turnCount: 1,
      compactWarned: false,
    });
    expect(await getSession()).toEqual({
      sessionId: "global-session-should-stay",
      turnCount: 0,
      compactWarned: false,
    });
  });

  test("uses the effective task cwd in the appended scope prompt", async () => {
    const { calls } = installSpawnMock({
      stdout: [
        JSON.stringify({ type: "system", subtype: "init", session_id: "task-session-789" }),
        JSON.stringify({ type: "result", result: "ok" }),
        "",
      ].join("\n"),
    });

    const onChunk = mock((_text: string) => {});
    const onUnblock = mock(() => {});
    const taskCwd = "/home/xiao/claudeclaw_for_qq/.worktrees/qq-task-subsessions";

    const exitCode = await streamUserMessage(
      "qq",
      "/task haiku check cwd",
      onChunk,
      onUnblock,
      undefined,
      undefined,
      undefined,
      taskCwd,
      taskScope,
    );

    expect(exitCode).toBe(0);
    const appendPrompt = calls[0][calls[0].indexOf("--append-system-prompt") + 1];
    expect(appendPrompt).toContain(`CRITICAL SECURITY CONSTRAINT: You are scoped to the working directory: ${taskCwd}`);
  });

  test("recovers an invalid streamed task session and retries without resume", async () => {
    await createTaskSession({
      taskSessionKey: taskScope.taskSessionKey,
      sessionId: "stale-stream-session",
      channel: taskScope.channel,
      targetType: taskScope.targetType,
      targetId: taskScope.targetId,
      model: taskScope.model,
    });

    const calls: string[][] = [];
    const spawnMock = mock((args: string[]) => {
      calls.push([...args]);
      const attempt = calls.length;
      return {
        stdout: createTextStream(attempt === 1
          ? [
              JSON.stringify({ type: "result", result: "" }),
              "",
            ].join("\n")
          : [
              JSON.stringify({ type: "system", subtype: "init", session_id: "fresh-stream-session" }),
              JSON.stringify({ type: "result", result: "ok" }),
              "",
            ].join("\n")),
        stderr: createTextStream(attempt === 1 ? "No conversation found with session ID: stale-stream-session" : ""),
        exited: Promise.resolve(0),
        exitCode: 0,
        kill: () => {},
      };
    });
    (Bun as typeof Bun & { spawn: typeof Bun.spawn }).spawn = spawnMock as unknown as typeof Bun.spawn;

    const onChunk = mock((_text: string) => {});
    const onUnblock = mock(() => {});

    const exitCode = await streamUserMessage(
      "qq",
      "/task haiku check stream recovery",
      onChunk,
      onUnblock,
      undefined,
      undefined,
      undefined,
      "/home/xiao/claudeclaw_for_qq/.worktrees/qq-task-subsessions",
      taskScope,
    );

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--resume");
    expect(calls[1]).not.toContain("--resume");
    expect(await getTaskSession(taskScope.taskSessionKey)).toEqual({
      sessionId: "fresh-stream-session",
      turnCount: 1,
      compactWarned: false,
    });
  });

  test("increments task turn count after a successful streamed resume", async () => {
    await createTaskSession({
      taskSessionKey: taskScope.taskSessionKey,
      sessionId: "task-session-456",
      channel: taskScope.channel,
      targetType: taskScope.targetType,
      targetId: taskScope.targetId,
      model: taskScope.model,
    });

    installSpawnMock({
      stdout: [
        JSON.stringify({ type: "result", result: "ok" }),
        "",
      ].join("\n"),
    });

    const onChunk = mock((_text: string) => {});
    const onUnblock = mock(() => {});

    const exitCode = await streamUserMessage(
      "qq",
      "/task haiku continue task",
      onChunk,
      onUnblock,
      undefined,
      undefined,
      undefined,
      "/home/xiao/claudeclaw_for_qq/.worktrees/qq-task-subsessions",
      taskScope,
    );

    expect(exitCode).toBe(0);
    expect(await getTaskSession(taskScope.taskSessionKey)).toEqual({
      sessionId: "task-session-456",
      turnCount: 1,
      compactWarned: false,
    });
  });

  test("emits only the incremental delta when stream-json repeats assistant snapshots", async () => {
    installSpawnMock({
      stdout: [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "你好" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "你好，世界" }] },
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "你好，世界" }] },
        }),
        JSON.stringify({ type: "result", result: "你好，世界" }),
        "",
      ].join("\n"),
    });

    const chunks: string[] = [];
    const onUnblock = mock(() => {});

    const exitCode = await streamUserMessage(
      "qq",
      "/task haiku say hello",
      (text) => { chunks.push(text); },
      onUnblock,
      undefined,
      undefined,
      undefined,
      "/home/xiao/claudeclaw_for_qq/.worktrees/qq-task-subsessions",
      taskScope,
    );

    expect(exitCode).toBe(0);
    expect(chunks).toEqual(["你好", "，世界"]);
  });
});
