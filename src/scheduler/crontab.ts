import { mkdir } from "fs/promises";
import { join } from "path";
import { Bash } from "bun";
import type { Job } from "../jobs";

const MARKER_PREFIX = "# claudeclaw:launch:";

function shellQuote(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'`;
}

export function buildCrontabLine(input: {
  jobName: string;
  schedule: string;
  projectDir: string;
  bunPath: string;
}): string {
  const logPath = join(input.projectDir, ".claude", "claudeclaw", "logs", "jobs.log");
  return `${input.schedule} cd ${shellQuote(input.projectDir)} && ${shellQuote(input.bunPath)} run src/index.ts run-job ${shellQuote(input.jobName)} >> ${shellQuote(logPath)} 2>&1 ${MARKER_PREFIX}${input.jobName}`;
}

export function stripManagedCrontabLine(crontabText: string, jobName: string): string {
  const kept = crontabText
    .split("\n")
    .filter((line) => line.length > 0 && !line.includes(`${MARKER_PREFIX}${jobName}`));
  return kept.length > 0 ? `${kept.join("\n")}\n` : "";
}

export function ensureLinuxCrontabSupported(): void {
  if (process.platform !== "linux") {
    throw new Error("Launch jobs currently require Linux crontab.");
  }
}

async function commandExists(command: string): Promise<boolean> {
  const proc = Bun.spawn(["bash", "-lc", `command -v ${command}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const code = await proc.exited;
  return code === 0;
}

async function readCrontab(): Promise<string> {
  const proc = Bun.spawn(["bash", "-lc", "crontab -l 2>/dev/null || true"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout;
}

async function writeCrontab(content: string): Promise<void> {
  const escaped = content.replace(/'/g, `'"'"'`);
  const proc = Bun.spawn(["bash", "-lc", `printf '%s' '${escaped}' | crontab -`], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`Failed to write crontab: ${stderr.trim() || code}`);
  }
}

export async function ensureCrontabAvailable(): Promise<void> {
  ensureLinuxCrontabSupported();
  if (!(await commandExists("crontab"))) {
    throw new Error("crontab command not found.");
  }
}

export async function installLaunchJob(job: Pick<Job, "name" | "schedule">, projectDir = process.cwd(), bunPath = process.execPath): Promise<void> {
  await ensureCrontabAvailable();
  await mkdir(join(projectDir, ".claude", "claudeclaw", "logs"), { recursive: true });
  const current = await readCrontab();
  const next = `${stripManagedCrontabLine(current, job.name)}${buildCrontabLine({ jobName: job.name, schedule: job.schedule, projectDir, bunPath })}\n`;
  await writeCrontab(next);
}

export async function removeLaunchJob(jobName: string): Promise<void> {
  await ensureCrontabAvailable();
  const current = await readCrontab();
  await writeCrontab(stripManagedCrontabLine(current, jobName));
}
