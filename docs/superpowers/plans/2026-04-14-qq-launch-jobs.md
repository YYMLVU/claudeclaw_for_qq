# QQ Launch Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Linux crontab-backed launch jobs that can be created from QQ conversations and send success/failure text back to the originating QQ chat.

**Architecture:** Extend the existing markdown job format with launch-mode metadata, add a reusable one-shot job runner and QQ text sender, and manage Linux crontab entries as the scheduling backend. Keep current standalone QQ mode and do not migrate poll-mode scheduling in this phase.

**Tech Stack:** Bun, TypeScript, existing QQ official API integration, Linux crontab

---

## File Structure

- Modify: `src/jobs.ts` — extend job parsing/writing helpers for launch metadata and one-shot cleanup
- Modify: `src/index.ts` — add `run-job` CLI dispatch
- Modify: `src/commands/qq.ts` — extract or re-export reusable QQ text send capability without depending on the gateway loop
- Create: `src/job-runner.ts` — execute one launch job by name and send result back to QQ
- Create: `src/scheduler/crontab.ts` — install/update/remove Linux crontab entries for launch jobs
- Create: `src/job-service.ts` — create/update/delete launch jobs from structured inputs and coordinate file + crontab writes
- Test: `src/jobs.ts` adjacent tests or a new `src/jobs.test.ts`
- Test: new tests for `src/scheduler/crontab.ts`, `src/job-runner.ts`, and `src/job-service.ts`

### Task 1: Extend the job model for launch metadata

**Files:**
- Modify: `src/jobs.ts`
- Test: `src/jobs.test.ts`

- [ ] **Step 1: Write the failing parsing tests**

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/jobs.test.ts`
Expected: FAIL because `parseJobFile` is not exported and launch metadata is not parsed.

- [ ] **Step 3: Implement the extended job model**

```ts
export interface Job {
  name: string;
  mode: "poll" | "launch";
  schedule: string;
  prompt: string;
  recurring: boolean;
  notify: true | false | "error";
  targetChannel?: "qq";
  targetType?: "private" | "group";
  targetId?: string;
  createdFrom?: "qq";
}

export function parseJobFile(name: string, content: string): Job | null {
  // keep the current frontmatter parser
  // default mode to "poll"
  // parse launch-only metadata as optional fields
}
```

Also add a helper for writing launch job files and a helper for clearing `schedule` without losing launch metadata.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/jobs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/jobs.ts src/jobs.test.ts
git commit -m "feat: extend jobs for launch metadata"
```

### Task 2: Add Linux crontab backend helpers

**Files:**
- Create: `src/scheduler/crontab.ts`
- Test: `src/scheduler/crontab.test.ts`

- [ ] **Step 1: Write the failing scheduler tests**

```ts
import { describe, expect, it } from "bun:test";
import { buildCrontabLine, stripManagedCrontabLine } from "./scheduler/crontab";

describe("crontab helpers", () => {
  it("builds a managed cron line with marker", () => {
    const line = buildCrontabLine({
      jobName: "daily-report",
      schedule: "0 9 * * *",
      projectDir: "/home/xiao/claudeclaw_for_qq",
      bunPath: "/home/xiao/.bun/bin/bun",
    });

    expect(line).toContain("0 9 * * *");
    expect(line).toContain("run src/index.ts run-job daily-report");
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/scheduler/crontab.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement crontab helper module**

```ts
const MARKER_PREFIX = "# claudeclaw:launch:";

export function buildCrontabLine(input: {
  jobName: string;
  schedule: string;
  projectDir: string;
  bunPath: string;
}): string {
  const logPath = `${input.projectDir}/.claude/claudeclaw/logs/jobs.log`;
  return `${input.schedule} cd ${shellQuote(input.projectDir)} && ${shellQuote(input.bunPath)} run src/index.ts run-job ${shellQuote(input.jobName)} >> ${shellQuote(logPath)} 2>&1 ${MARKER_PREFIX}${input.jobName}`;
}

export function stripManagedCrontabLine(crontabText: string, jobName: string): string {
  return crontabText
    .split("\n")
    .filter((line) => !line.includes(`${MARKER_PREFIX}${jobName}`))
    .filter((line) => line.length > 0)
    .join("\n") + "\n";
}
```

Then add `installLaunchJob`, `removeLaunchJob`, and Linux/`crontab` availability checks.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/scheduler/crontab.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/scheduler/crontab.ts src/scheduler/crontab.test.ts
git commit -m "feat: add crontab backend for launch jobs"
```

### Task 3: Extract reusable QQ text sender

**Files:**
- Modify: `src/commands/qq.ts`
- Test: `src/commands/qq.test.ts`

- [ ] **Step 1: Write the failing QQ sender tests**

```ts
import { describe, expect, it } from "bun:test";
import { formatJobResultMessage } from "./commands/qq";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/commands/qq.test.ts`
Expected: FAIL because helper exports do not exist.

- [ ] **Step 3: Implement reusable sender exports**

```ts
export function formatJobResultMessage(
  jobName: string,
  result: { ok: boolean; text: string }
): string {
  return result.ok
    ? `[定时任务: ${jobName}]\n\n${result.text}`
    : `[定时任务失败: ${jobName}]\n\n${result.text}`;
}

export async function sendJobTextToQQ(target: {
  targetType: "private" | "group";
  targetId: string;
  text: string;
}): Promise<void> {
  if (target.targetType === "private") {
    await sendC2CMessage(target.targetId, target.text);
    return;
  }
  await sendGroupMessage(target.targetId, target.text);
}
```

Keep the sender independent from the gateway loop by relying only on shared settings/token refresh.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/commands/qq.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/qq.ts src/commands/qq.test.ts
git commit -m "feat: expose reusable QQ text sender"
```

### Task 4: Implement the one-shot job runner and CLI entry

**Files:**
- Create: `src/job-runner.ts`
- Modify: `src/index.ts`
- Test: `src/job-runner.test.ts`

- [ ] **Step 1: Write the failing runner tests**

```ts
import { describe, expect, it, mock } from "bun:test";
import { runLaunchJob } from "./job-runner";

describe("runLaunchJob", () => {
  it("runs a launch job and sends success text", async () => {
    const send = mock(async () => {});
    const exec = mock(async () => ({ exitCode: 0, stdout: "report", stderr: "" }));

    await runLaunchJob({
      jobName: "daily-report",
      send,
      exec,
    });

    expect(send).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/job-runner.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `src/job-runner.ts` and CLI dispatch**

```ts
export async function runLaunchJob(input: {
  jobName: string;
  send?: typeof sendJobTextToQQ;
  exec?: typeof run;
}): Promise<number> {
  const job = await loadJobByName(input.jobName);
  if (!job || job.mode !== "launch") {
    console.error(`Launch job not found: ${input.jobName}`);
    return 1;
  }

  const exec = input.exec ?? run;
  const send = input.send ?? sendJobTextToQQ;
  const result = await exec(job.name, job.prompt, undefined, process.cwd());
  const ok = result.exitCode === 0;
  const text = ok ? (result.stdout.trim() || "(empty response)") : `exit=${result.exitCode}\n${result.stderr || result.stdout || "Unknown error"}`;

  if (job.targetType && job.targetId) {
    await send({
      targetType: job.targetType,
      targetId: job.targetId,
      text: formatJobResultMessage(job.name, { ok, text }),
    });
  }

  return result.exitCode;
}
```

Then wire `src/index.ts`:

```ts
} else if (command === "run-job") {
  process.exit(await runLaunchJobCommand(args.slice(1)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/job-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/job-runner.ts src/job-runner.test.ts src/index.ts
git commit -m "feat: add one-shot launch job runner"
```

### Task 5: Add job service to create launch jobs from structured inputs

**Files:**
- Create: `src/job-service.ts`
- Test: `src/job-service.test.ts`

- [ ] **Step 1: Write the failing service tests**

```ts
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
    }, { install, write });

    expect(write).toHaveBeenCalled();
    expect(install).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/job-service.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the launch job service**

```ts
export async function createLaunchJob(input: LaunchJobInput, deps = defaultDeps): Promise<Job> {
  assertLinuxCrontabAvailable();
  const job = buildLaunchJob(input);
  const path = jobPath(job.name);

  await deps.write(path, serializeJob(job));
  try {
    await deps.install(job);
  } catch (error) {
    await deps.removeFile(path);
    throw error;
  }
  return job;
}
```

Also add update/delete helpers so the same module owns launch job lifecycle.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/job-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/job-service.ts src/job-service.test.ts
git commit -m "feat: add launch job service"
```

### Task 6: Handle one-shot launch job cleanup

**Files:**
- Modify: `src/job-runner.ts`
- Modify: `src/jobs.ts`
- Modify: `src/scheduler/crontab.ts`
- Test: `src/job-runner.test.ts`

- [ ] **Step 1: Write the failing cleanup test**

```ts
it("removes schedule and crontab for one-shot launch jobs", async () => {
  const clearSchedule = mock(async () => {});
  const remove = mock(async () => {});
  const exec = mock(async () => ({ exitCode: 0, stdout: "done", stderr: "" }));

  await runLaunchJob({
    jobName: "one-shot",
    exec,
    clearSchedule,
    removeSchedule: remove,
  });

  expect(clearSchedule).toHaveBeenCalledWith("one-shot");
  expect(remove).toHaveBeenCalledWith("one-shot");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/job-runner.test.ts`
Expected: FAIL because cleanup dependencies are not invoked.

- [ ] **Step 3: Implement cleanup for non-recurring launch jobs**

```ts
if (!job.recurring) {
  await removeLaunchJob(job.name);
  await clearJobSchedule(job.name);
}
```

Ensure cleanup runs after send attempts complete, and log failures without masking the original execution result.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/job-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/job-runner.ts src/jobs.ts src/scheduler/crontab.ts src/job-runner.test.ts
git commit -m "feat: clean up one-shot launch jobs"
```

### Task 7: Verify end-to-end Linux launch job behavior

**Files:**
- Modify: any files needed from previous tasks only
- Test: existing and new tests above

- [ ] **Step 1: Run the focused test suite**

```bash
bun test src/jobs.test.ts src/scheduler/crontab.test.ts src/commands/qq.test.ts src/job-runner.test.ts src/job-service.test.ts
```

Expected: PASS

- [ ] **Step 2: Manually verify one-shot runner on a sample launch job**

```bash
bun run src/index.ts run-job sample-launch-job
```

Expected: command exits cleanly, logs show runner path executed, and QQ target receives a text message.

- [ ] **Step 3: Manually verify crontab line generation without overwriting unrelated entries**

```bash
crontab -l
```

Expected: managed launch jobs include `# claudeclaw:launch:<job-name>` markers and unrelated cron entries remain unchanged.

- [ ] **Step 4: If issues appear, fix only the failing component and rerun the exact failing test/command**

```bash
bun test <failing-test>
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/jobs.ts src/commands/qq.ts src/job-runner.ts src/job-service.ts src/scheduler/crontab.ts src/*.test.ts
git commit -m "feat: add QQ launch jobs with crontab runner"
```

## Self-Review

- **Spec coverage:** Covers launch job model, Linux crontab backend, one-shot runner, QQ text sender reuse, rollback, and one-shot cleanup. Poll-mode migration is intentionally excluded per spec.
- **Placeholder scan:** No TBD/TODO placeholders remain; each task includes files, code shape, commands, and expected results.
- **Type consistency:** Uses `mode`, `targetChannel`, `targetType`, `targetId`, `createdFrom`, `run-job`, and `runLaunchJob` consistently across tasks.