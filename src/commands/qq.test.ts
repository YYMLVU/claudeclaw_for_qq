import { describe, expect, it } from "bun:test";
import {
  buildQqTaskSessionScope,
  buildTaskResetReply,
  createInboundEventKey,
  createInboundEventStateStore,
  finalizeInboundEventNow,
  formatJobResultMessage,
  formatClaudeSessionError,
  parseLaunchJobDeclaration,
  resolveLaunchJobTargetId,
  shouldStartInboundEvent,
  updateInboundEventText,
} from "./qq";

describe("parseLaunchJobDeclaration", () => {
  it("accepts prompt on the same line", () => {
    expect(parseLaunchJobDeclaration(`before\n<qq-launch-job>\nname: daily-report\nschedule: 0 9 * * *\nrecurring: true\nprompt: 生成今日 AI 行业日报\n</qq-launch-job>\nafter`)).toEqual({
      name: "daily-report",
      schedule: "0 9 * * *",
      recurring: true,
      prompt: "生成今日 AI 行业日报",
    });
  });

  it("accepts prompt on following lines", () => {
    expect(parseLaunchJobDeclaration(`before\n<qq-launch-job>\nname: daily-report\nschedule: 0 9 * * *\nrecurring: true\nprompt:\n生成今日 AI 行业日报\n附带重点链接\n</qq-launch-job>\nafter`)).toEqual({
      name: "daily-report",
      schedule: "0 9 * * *",
      recurring: true,
      prompt: "生成今日 AI 行业日报\n附带重点链接",
    });
  });
});

describe("resolveLaunchJobTargetId", () => {
  it("uses user_openid for private targets", () => {
    expect(resolveLaunchJobTargetId("private", {
      user_openid: "user-openid-123",
      union_openid: "union-openid-456",
    })).toBe("user-openid-123");
  });

  it("rejects private targets without user_openid", () => {
    expect(() => resolveLaunchJobTargetId("private", {
      union_openid: "union-openid-456",
    })).toThrow("Missing user_openid for private launch job target.");
  });

  it("uses explicit group target id for group targets", () => {
    expect(resolveLaunchJobTargetId("group", {
      targetId: "group-openid-123",
      user_openid: "user-openid-123",
      union_openid: "union-openid-456",
    })).toBe("group-openid-123");
  });
});

describe("QQ job messages", () => {
  it("formats success messages", () => {
    expect(formatJobResultMessage("daily-report", { ok: true, text: "done" }))
      .toBe("[定时任务: daily-report]\n\ndone");
  });

  it("formats failure messages", () => {
    expect(formatJobResultMessage("daily-report", { ok: false, text: "exit=1" }))
      .toBe("[定时任务失败: daily-report]\n\nexit=1");
  });
});

describe("QQ inbound event state", () => {
  it("builds a stable event key from event name and message id", () => {
    expect(createInboundEventKey("C2C_MESSAGE_CREATE", { id: "msg-1" })).toBe("C2C_MESSAGE_CREATE:msg-1");
  });

  it("starts only one in-flight stream for the same event key", () => {
    const store = createInboundEventStateStore();
    expect(shouldStartInboundEvent(store, "C2C_MESSAGE_CREATE:msg-1")).toBe(true);
    expect(shouldStartInboundEvent(store, "C2C_MESSAGE_CREATE:msg-1")).toBe(false);
  });

  it("tracks accumulated streamed text", () => {
    const store = createInboundEventStateStore();
    shouldStartInboundEvent(store, "C2C_MESSAGE_CREATE:msg-1");
    expect(updateInboundEventText(store, "C2C_MESSAGE_CREATE:msg-1", "同意")).toBe("同意");
    expect(updateInboundEventText(store, "C2C_MESSAGE_CREATE:msg-1", "同意，开始处理")).toBe("同意，开始处理");
  });

  it("allows a later delivery after the finished event is cleared", () => {
    const store = createInboundEventStateStore();
    expect(shouldStartInboundEvent(store, "C2C_MESSAGE_CREATE:msg-1")).toBe(true);
    finalizeInboundEventNow(store, "C2C_MESSAGE_CREATE:msg-1", "done");
    store.delete("C2C_MESSAGE_CREATE:msg-1");
    expect(shouldStartInboundEvent(store, "C2C_MESSAGE_CREATE:msg-1")).toBe(true);
  });
});

it("does not start a second stream while the same inbound event is already running", () => {
  const store = createInboundEventStateStore();
  expect(shouldStartInboundEvent(store, "GROUP_AT_MESSAGE_CREATE:msg-2")).toBe(true);
  expect(shouldStartInboundEvent(store, "GROUP_AT_MESSAGE_CREATE:msg-2")).toBe(false);
});

describe("QQ task helpers", () => {
  it("formats Claude session errors with stderr details", () => {
    expect(formatClaudeSessionError(1, "permission denied\nsecond line")).toBe("Error (exit 1): permission denied");
  });

  it("falls back when stderr is empty", () => {
    expect(formatClaudeSessionError(1, "   ")).toBe("Error (exit 1): Claude session error");
  });

  it("builds a reset reply for an existing task scope", () => {
    expect(buildTaskResetReply({
      targetType: "private",
      targetId: "user-openid-123",
      model: "haiku",
    })).toEqual({
      reply: "已重置 /task haiku 子会话。下次会新开一个干净会话。",
      taskSessionKey: "qq:private:user-openid-123:haiku",
    });
  });

  it("rejects /task reset without a valid model", () => {
    expect(buildTaskResetReply({
      targetType: "private",
      targetId: "user-openid-123",
      model: null,
    })).toBeNull();
  });
});

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
    const left = buildQqTaskSessionScope({
      targetType: "group",
      targetId: "group-openid-123",
      model: "haiku",
    });
    const right = buildQqTaskSessionScope({
      targetType: "group",
      targetId: "group-openid-123",
      model: "sonnet",
    });
    expect(left?.kind).toBe("task");
    expect(right?.kind).toBe("task");
    expect(left && left.kind === "task" ? left.taskSessionKey : undefined).not.toBe(right && right.kind === "task" ? right.taskSessionKey : undefined);
  });

  it("separates private and group keys even when id and model match", () => {
    const left = buildQqTaskSessionScope({
      targetType: "private",
      targetId: "same-id",
      model: "haiku",
    });
    const right = buildQqTaskSessionScope({
      targetType: "group",
      targetId: "same-id",
      model: "haiku",
    });
    expect(left && left.kind === "task" ? left.taskSessionKey : undefined).not.toBe(right && right.kind === "task" ? right.taskSessionKey : undefined);
  });

  it("separates group and channel keys even when id and model match", () => {
    const left = buildQqTaskSessionScope({
      targetType: "group",
      targetId: "same-id",
      model: "haiku",
    });
    const right = buildQqTaskSessionScope({
      targetType: "channel",
      targetId: "same-id",
      model: "haiku",
    });
    expect(left && left.kind === "task" ? left.taskSessionKey : undefined).not.toBe(right && right.kind === "task" ? right.taskSessionKey : undefined);
  });

  it("reuses the same key for the same private target and model", () => {
    const left = buildQqTaskSessionScope({
      targetType: "private",
      targetId: "user-openid-123",
      model: "haiku",
    });
    const right = buildQqTaskSessionScope({
      targetType: "private",
      targetId: "user-openid-123",
      model: "haiku",
    });
    expect(left && left.kind === "task" ? left.taskSessionKey : undefined).toBe(right && right.kind === "task" ? right.taskSessionKey : undefined);
  });

  it("keeps normal QQ messages out of task scope", () => {
    expect(buildQqTaskSessionScope({
      targetType: "private",
      targetId: "user-openid-123",
      model: null,
    })).toBeUndefined();
  });

  it("builds a channel task session key from channel_id and model", () => {
    const scope = buildQqTaskSessionScope({
      targetType: "channel",
      targetId: "channel-123",
      model: "haiku",
    });
    expect(scope && scope.kind === "task" ? scope.taskSessionKey : undefined).toBe("qq:channel:channel-123:haiku");
  });
});
