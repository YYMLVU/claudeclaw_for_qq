import { describe, expect, it } from "bun:test";
import { buildCrontabLine, stripManagedCrontabLine } from "./crontab";

describe("crontab helpers", () => {
  it("builds a managed cron line with marker", () => {
    const line = buildCrontabLine({
      jobName: "daily-report",
      schedule: "0 9 * * *",
      projectDir: "/home/xiao/claudeclaw_for_qq",
      bunPath: "/home/xiao/.bun/bin/bun",
    });

    expect(line).toContain("0 9 * * *");
    expect(line).toContain("run src/index.ts run-job");
    expect(line).toContain("# claudeclaw:launch:daily-report");
  });

  it("removes an existing managed line for a job", () => {
    const next = stripManagedCrontabLine(
      "0 9 * * * cmd # claudeclaw:launch:daily-report\n5 10 * * * other\n",
      "daily-report"
    );

    expect(next).toBe("5 10 * * * other\n");
  });
});
