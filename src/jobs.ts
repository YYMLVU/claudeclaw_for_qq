import { mkdir, readdir } from "fs/promises";
import { join } from "path";

const JOBS_DIR = join(process.cwd(), ".claude", "claudeclaw", "jobs");

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

function parseFrontmatterValue(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "");
}

export function parseJobFile(name: string, content: string): Job | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    console.error(`Invalid job file format: ${name}`);
    return null;
  }

  const frontmatter = match[1];
  const prompt = match[2].trim();
  const lines = frontmatter.split("\n").map((l) => l.trim());

  const scheduleLine = lines.find((l) => l.startsWith("schedule:"));
  if (!scheduleLine) {
    return null;
  }

  const schedule = parseFrontmatterValue(scheduleLine.replace("schedule:", ""));

  const modeLine = lines.find((l) => l.startsWith("mode:"));
  const modeRaw = modeLine ? parseFrontmatterValue(modeLine.replace("mode:", "")).toLowerCase() : "";
  const mode: "poll" | "launch" = modeRaw === "launch" ? "launch" : "poll";

  const recurringLine = lines.find((l) => l.startsWith("recurring:"));
  const dailyLine = lines.find((l) => l.startsWith("daily:")); // legacy alias
  const recurringRaw = recurringLine
    ? parseFrontmatterValue(recurringLine.replace("recurring:", "")).toLowerCase()
    : dailyLine
    ? parseFrontmatterValue(dailyLine.replace("daily:", "")).toLowerCase()
    : "";
  const recurring = recurringRaw === "true" || recurringRaw === "yes" || recurringRaw === "1";

  const notifyLine = lines.find((l) => l.startsWith("notify:"));
  const notifyRaw = notifyLine
    ? parseFrontmatterValue(notifyLine.replace("notify:", "")).toLowerCase()
    : "";
  const notify: true | false | "error" =
    notifyRaw === "false" || notifyRaw === "no" ? false
    : notifyRaw === "error" ? "error"
    : true;

  const targetChannelLine = lines.find((l) => l.startsWith("targetChannel:"));
  const targetTypeLine = lines.find((l) => l.startsWith("targetType:"));
  const targetIdLine = lines.find((l) => l.startsWith("targetId:"));
  const createdFromLine = lines.find((l) => l.startsWith("createdFrom:"));

  const targetChannel = targetChannelLine
    ? parseFrontmatterValue(targetChannelLine.replace("targetChannel:", "")) === "qq" ? "qq" : undefined
    : undefined;
  const targetType = targetTypeLine
    ? (() => {
        const value = parseFrontmatterValue(targetTypeLine.replace("targetType:", ""));
        return value === "private" || value === "group" ? value : undefined;
      })()
    : undefined;
  const targetId = targetIdLine
    ? parseFrontmatterValue(targetIdLine.replace("targetId:", ""))
    : undefined;
  const createdFrom = createdFromLine
    ? parseFrontmatterValue(createdFromLine.replace("createdFrom:", "")) === "qq" ? "qq" : undefined
    : undefined;

  return { name, mode, schedule, prompt, recurring, notify, targetChannel, targetType, targetId, createdFrom };
}

export async function loadJobs(): Promise<Job[]> {
  const jobs: Job[] = [];
  let files: string[];
  try {
    files = await readdir(JOBS_DIR);
  } catch {
    return jobs;
  }

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const content = await Bun.file(join(JOBS_DIR, file)).text();
    const job = parseJobFile(file.replace(/\.md$/, ""), content);
    if (job) jobs.push(job);
  }
  return jobs;
}

export async function loadJobByName(jobName: string): Promise<Job | null> {
  const path = join(JOBS_DIR, `${jobName}.md`);
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return parseJobFile(jobName, await file.text());
}

export async function writeJobFile(job: Job): Promise<void> {
  await mkdir(JOBS_DIR, { recursive: true });
  const lines = [
    `mode: "${job.mode}"`,
    `schedule: "${job.schedule}"`,
    `recurring: ${job.recurring ? "true" : "false"}`,
    `notify: ${job.notify === true ? "true" : job.notify === false ? "false" : "error"}`,
  ];
  if (job.targetChannel) lines.push(`targetChannel: "${job.targetChannel}"`);
  if (job.targetType) lines.push(`targetType: "${job.targetType}"`);
  if (job.targetId) lines.push(`targetId: "${job.targetId}"`);
  if (job.createdFrom) lines.push(`createdFrom: "${job.createdFrom}"`);
  const content = `---\n${lines.join("\n")}\n---\n${job.prompt.trim()}\n`;
  await Bun.write(join(JOBS_DIR, `${job.name}.md`), content);
}

export async function clearJobSchedule(jobName: string): Promise<void> {
  const path = join(JOBS_DIR, `${jobName}.md`);
  const content = await Bun.file(path).text();
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return;

  const filteredFrontmatter = match[1]
    .split("\n")
    .filter((line) => !line.trim().startsWith("schedule:"))
    .join("\n")
    .trim();

  const body = match[2].trim();
  const next = `---\n${filteredFrontmatter}\n---\n${body}\n`;
  await Bun.write(path, next);
}
