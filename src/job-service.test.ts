import { describe, expect, it, mock } from "bun:test";
import { createLaunchJob } from "./job-service";

describe("createLaunchJob", () => {
  it("writes the job file and installs crontab", async () => {
    const install = mock(async () => {});
    const write = mock(async () => {});

    await createLaunchJob({
      name: "daily-report",
      schedule: "0 9 * * *",
      prompt: "Generate report",
      recurring: true,
      notify: true,
      targetType: "private",
      targetId: "user-123",
    }, {
      ensureSupported: () => {},
      install,
      writeJobFile: write,
      removeJobFile: async () => {},
    });

    expect(write).toHaveBeenCalled();
    expect(install).toHaveBeenCalled();
  });
});
