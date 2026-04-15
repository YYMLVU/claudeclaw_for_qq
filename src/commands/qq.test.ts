import { describe, expect, it } from "bun:test";
import {
  buildQqTaskSessionScope,
  formatJobResultMessage,
  parseLaunchJobDeclaration,
  resolveLaunchJobTargetId,
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
