import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Job } from "./jobs";
import { runLaunchJob } from "./job-runner";

const launchJob: Job = {
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
};

describe("runLaunchJob", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("runs a launch job and sends success text", async () => {
    const send = mock(async () => {});
    const exec = mock(async () => ({ exitCode: 0, stdout: "report", stderr: "" }));

    const exitCode = await runLaunchJob({
      jobName: "daily-report",
      send,
      exec,
      loadJob: async () => launchJob,
    });

    expect(exitCode).toBe(0);
    expect(send).toHaveBeenCalled();
  });

  it("removes schedule and crontab for one-shot launch jobs", async () => {
    const clearSchedule = mock(async () => {});
    const removeLaunchSchedule = mock(async () => {});
    const send = mock(async () => {});
    const exec = mock(async () => ({ exitCode: 0, stdout: "done", stderr: "" }));

    await runLaunchJob({
      jobName: "one-shot",
      exec,
      send,
      clearSchedule,
      removeLaunchSchedule,
      loadJob: async () => ({ ...launchJob, name: "one-shot", recurring: false }),
    });

    expect(clearSchedule).toHaveBeenCalledWith("one-shot");
    expect(removeLaunchSchedule).toHaveBeenCalledWith("one-shot");
  });
});
