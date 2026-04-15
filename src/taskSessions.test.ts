import { beforeEach, describe, expect, it } from "bun:test";
import { join } from "path";
import {
  clearTaskSessionsCacheForTests,
  createTaskSession,
  getTaskSession,
  incrementTaskSessionTurn,
  loadTaskSessionsForTests,
  markTaskSessionCompactWarned,
  resetTaskSessionsForTests,
} from "./taskSessions";

describe("taskSessions", () => {
  beforeEach(async () => {
    await resetTaskSessionsForTests();
  });

  it("creates and reads a task session by key", async () => {
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

  it("loads a task session from disk after cache reset", async () => {
    const taskSessionsFile = join(process.cwd(), ".claude", "claudeclaw", "task-sessions.json");
    await Bun.write(taskSessionsFile, JSON.stringify({
      tasks: {
        "qq:private:user-openid:haiku": {
          sessionId: "session-from-disk",
          taskSessionKey: "qq:private:user-openid:haiku",
          channel: "qq",
          targetType: "private",
          targetId: "user-openid",
          model: "haiku",
          createdAt: "2026-04-15T00:00:00.000Z",
          lastUsedAt: "2026-04-15T00:00:00.000Z",
          turnCount: 2,
          compactWarned: true,
        },
      },
    }, null, 2) + "\n");

    clearTaskSessionsCacheForTests();

    expect(await getTaskSession("qq:private:user-openid:haiku")).toEqual({
      sessionId: "session-from-disk",
      turnCount: 2,
      compactWarned: true,
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

  it("returns null for a non-existent key", async () => {
    expect(await getTaskSession("qq:private:nothing:haiku")).toBeNull();
  });

  it("falls back to an empty store for valid json with the wrong shape", async () => {
    const taskSessionsFile = join(process.cwd(), ".claude", "claudeclaw", "task-sessions.json");
    await Bun.write(taskSessionsFile, JSON.stringify({ nope: true }, null, 2) + "\n");

    expect(await loadTaskSessionsForTests()).toEqual({ tasks: {} });
    expect(await getTaskSession("qq:private:user-openid:haiku")).toBeNull();
  });

  it("returns 0 when incrementing a non-existent key", async () => {
    expect(await incrementTaskSessionTurn("qq:private:nothing:haiku")).toBe(0);
  });

  it("does nothing when marking compact warned on a non-existent key", async () => {
    // Should not throw
    await markTaskSessionCompactWarned("qq:private:nothing:haiku");
  });
});
