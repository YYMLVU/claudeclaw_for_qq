import { sendJobTextToQQ, formatJobResultMessage } from "./commands/qq";
import { loadSettings } from "./config";
import { clearJobSchedule, loadJobByName, type Job } from "./jobs";
import { homedir } from "os";
import { run, type RunResult } from "./runner";
import { removeLaunchJob } from "./scheduler/crontab";

const JOB_RUNNER_WORKDIR = homedir();

async function ensureRunnerSettingsLoaded(): Promise<void> {
  await loadSettings();
}

async function execLaunchPrompt(job: Job): Promise<RunResult> {
  await ensureRunnerSettingsLoaded();
  return run(job.name, job.prompt, undefined, JOB_RUNNER_WORKDIR);
}

type LaunchJobExecutor = (job: Job) => Promise<RunResult>;

export interface RunLaunchJobOptions {
  jobName: string;
  send?: typeof sendJobTextToQQ;
  exec?: LaunchJobExecutor;
  loadJob?: (jobName: string) => Promise<Job | null>;
  clearSchedule?: (jobName: string) => Promise<void>;
  removeLaunchSchedule?: (jobName: string) => Promise<void>;
}

export async function runLaunchJob(input: RunLaunchJobOptions): Promise<number> {
  const loadJob = input.loadJob ?? loadJobByName;
  const job = await loadJob(input.jobName);
  if (!job || job.mode !== "launch") {
    console.error(`Launch job not found: ${input.jobName}`);
    return 1;
  }

  const exec = input.exec ?? execLaunchPrompt;
  const send = input.send ?? sendJobTextToQQ;
  const clearSchedule = input.clearSchedule ?? clearJobSchedule;
  const removeLaunchSchedule = input.removeLaunchSchedule ?? removeLaunchJob;

  const result: RunResult = await exec(job);
  const ok = result.exitCode === 0;
  const text = ok
    ? (result.stdout.trim() || "(empty response)")
    : `exit=${result.exitCode}\n${result.stderr || result.stdout || "Unknown error"}`;

  if (job.targetType && job.targetId) {
    await send({
      targetType: job.targetType,
      targetId: job.targetId,
      text: formatJobResultMessage(job.name, { ok, text }),
    });
  }

  if (!job.recurring) {
    await removeLaunchSchedule(job.name);
    await clearSchedule(job.name);
  }

  return result.exitCode;
}

export async function runLaunchJobCommand(args: string[]): Promise<number> {
  const jobName = args[0]?.trim();
  if (!jobName) {
    console.error("Usage: claudeclaw run-job <job-name>");
    return 1;
  }
  return runLaunchJob({ jobName });
}
