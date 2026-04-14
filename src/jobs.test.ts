import { describe, expect, it } from "bun:test";
import { parseJobFile } from "./jobs";

describe("parseJobFile", () => {
  it("parses launch job metadata", () => {
    const job = parseJobFile("daily-report", `---
mode: "launch"
schedule: "0 9 * * *"
recurring: true
notify: true
targetChannel: "qq"
targetType: "private"
targetId: "user-123"
createdFrom: "qq"
---
Generate report`);

    expect(job).toEqual({
      name: "daily-report",
      mode: "launch",
      schedule: "0 9 * * *",
      prompt: "Generate report",
      recurring: true,
      notify: true,
      targetChannel: "qq",
      targetType: "private",
      targetId: "user-123",
      createdFrom: "qq",
    });
  });

  it("defaults missing mode to poll for legacy jobs", () => {
    const job = parseJobFile("legacy", `---
schedule: "0 9 * * *"
---
Legacy prompt`);
    expect(job?.mode).toBe("poll");
  });
});
