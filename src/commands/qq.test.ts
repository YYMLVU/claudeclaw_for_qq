import { describe, expect, it } from "bun:test";
import { formatJobResultMessage } from "./qq";

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
