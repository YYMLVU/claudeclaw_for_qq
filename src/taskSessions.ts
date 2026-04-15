import { join } from "path";

const HEARTBEAT_DIR = join(process.cwd(), ".claude", "claudeclaw");
const TASK_SESSIONS_FILE = join(HEARTBEAT_DIR, "task-sessions.json");

export interface TaskSessionRecord {
  sessionId: string;
  taskSessionKey: string;
  channel: "qq";
  targetType: "private" | "group" | "channel";
  targetId: string;
  model: string;
  createdAt: string;
  lastUsedAt: string;
  turnCount: number;
  compactWarned: boolean;
}

interface TaskSessionsData {
  tasks: Record<string, TaskSessionRecord>;
}

let taskSessionsCache: TaskSessionsData | null = null;

function normalizeTaskSessionsData(raw: unknown): TaskSessionsData {
  if (!raw || typeof raw !== "object") return { tasks: {} };
  const tasks = (raw as { tasks?: unknown }).tasks;
  if (!tasks || typeof tasks !== "object") return { tasks: {} };
  return { tasks: tasks as Record<string, TaskSessionRecord> };
}

async function loadTaskSessions(): Promise<TaskSessionsData> {
  if (taskSessionsCache) return taskSessionsCache;
  try {
    taskSessionsCache = normalizeTaskSessionsData(await Bun.file(TASK_SESSIONS_FILE).json());
    return taskSessionsCache;
  } catch {
    taskSessionsCache = { tasks: {} };
    return taskSessionsCache;
  }
}

export async function loadTaskSessionsForTests(): Promise<TaskSessionsData> {
  clearTaskSessionsCacheForTests();
  return await loadTaskSessions();
}

async function saveTaskSessions(data: TaskSessionsData): Promise<void> {
  taskSessionsCache = data;
  await Bun.write(TASK_SESSIONS_FILE, JSON.stringify(data, null, 2) + "\n");
}

export async function getTaskSession(taskSessionKey: string): Promise<{ sessionId: string; turnCount: number; compactWarned: boolean } | null> {
  const data = await loadTaskSessions();
  const session = data.tasks[taskSessionKey];
  if (!session) return null;

  if (typeof session.turnCount !== "number") session.turnCount = 0;
  if (typeof session.compactWarned !== "boolean") session.compactWarned = false;

  session.lastUsedAt = new Date().toISOString();
  await saveTaskSessions(data);
  return {
    sessionId: session.sessionId,
    turnCount: session.turnCount,
    compactWarned: session.compactWarned,
  };
}

export async function createTaskSession(input: {
  taskSessionKey: string;
  sessionId: string;
  channel: "qq";
  targetType: "private" | "group" | "channel";
  targetId: string;
  model: string;
}): Promise<void> {
  const data = await loadTaskSessions();
  data.tasks[input.taskSessionKey] = {
    ...input,
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    turnCount: 0,
    compactWarned: false,
  };
  await saveTaskSessions(data);
}

export async function incrementTaskSessionTurn(taskSessionKey: string): Promise<number> {
  const data = await loadTaskSessions();
  const session = data.tasks[taskSessionKey];
  if (!session) return 0;
  if (typeof session.turnCount !== "number") session.turnCount = 0;
  session.turnCount += 1;
  await saveTaskSessions(data);
  return session.turnCount;
}

export async function markTaskSessionCompactWarned(taskSessionKey: string): Promise<void> {
  const data = await loadTaskSessions();
  const session = data.tasks[taskSessionKey];
  if (!session) return;
  session.compactWarned = true;
  await saveTaskSessions(data);
}

export async function removeTaskSession(taskSessionKey: string): Promise<void> {
  const data = await loadTaskSessions();
  if (!data.tasks[taskSessionKey]) return;
  delete data.tasks[taskSessionKey];
  await saveTaskSessions(data);
}

export async function resetTaskSessionsForTests(): Promise<void> {
  taskSessionsCache = { tasks: {} };
  await Bun.write(TASK_SESSIONS_FILE, JSON.stringify(taskSessionsCache, null, 2) + "\n");
}

export function clearTaskSessionsCacheForTests(): void {
  taskSessionsCache = null;
}
