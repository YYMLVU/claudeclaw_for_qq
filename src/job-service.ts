import { unlink } from "fs/promises";
import { join } from "path";
import {
  type Job,
  writeJobFile,
} from "./jobs";
import { ensureCrontabAvailable, installLaunchJob } from "./scheduler/crontab";

export interface LaunchJobInput {
  name: string;
  schedule: string;
  prompt: string;
  recurring: boolean;
  notify: true | false | "error";
  targetType: "private" | "group";
  targetId: string;
}

export interface LaunchJobDeps {
  ensureSupported: () => void | Promise<void>;
  install: (job: Job) => Promise<void>;
  writeJobFile: (job: Job) => Promise<void>;
  removeJobFile: (jobName: string) => Promise<void>;
}

const defaultDeps: LaunchJobDeps = {
  ensureSupported: ensureCrontabAvailable,
  install: (job) => installLaunchJob(job),
  writeJobFile,
  removeJobFile: async (jobName) => {
    await unlink(join(process.cwd(), ".claude", "claudeclaw", "jobs", `${jobName}.md`));
  },
};

function normalizeJobName(name: string): string {
  const value = String(name || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) {
    throw new Error("Invalid job name. Use 1-64 letters, numbers, underscore, or hyphen.");
  }
  if (value === "." || value === "..") {
    throw new Error("Invalid job name.");
  }
  return value;
}

export async function createLaunchJob(input: LaunchJobInput, deps: LaunchJobDeps = defaultDeps): Promise<Job> {
  await deps.ensureSupported();
  const job: Job = {
    name: normalizeJobName(input.name),
    mode: "launch",
    schedule: input.schedule,
    prompt: input.prompt,
    recurring: input.recurring,
    notify: input.notify,
    targetChannel: "qq",
    targetType: input.targetType,
    targetId: input.targetId,
    createdFrom: "qq",
  };

  await deps.writeJobFile(job);
  try {
    await deps.install(job);
  } catch (error) {
    await deps.removeJobFile(job.name);
    throw error;
  }
  return job;
}
