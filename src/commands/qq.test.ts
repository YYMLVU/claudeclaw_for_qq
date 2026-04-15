import { describe, expect, it } from "bun:test";
import { parseLaunchJobDeclaration, resolveLaunchJobTargetId, formatJobResultMessage } from "./qq";

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
