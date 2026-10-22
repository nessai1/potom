import type { AppData, Task, Status } from "../types";
import { dayDiff, todayKey, addDays } from "./dates";
import achievementData from "./achievement-data.json";
export const statusNames: Record<Status, string> = {
  created: "Создана",
  progress: "Выполняется",
  deferred: "Отложено",
  done: "Выполнено",
};
export const statusColors: Record<Status, string> = {
  created: "gray",
  progress: "pink",
  deferred: "yellow",
  done: "green",
};
export const statusColumns: [Status, string][] = [
  ["created", "Созданы"],
  ["progress", "Выполняется"],
  ["deferred", "Отложено"],
  ["done", "Выполнено"],
];
export const doneCount = (t: Task) => t.checklist.filter((c) => c.done).length;
export const percent = (t: Task) =>
  t.checklist.length
    ? Math.round((doneCount(t) / t.checklist.length) * 100)
    : 0;
export const taskId = (t: Task) => `PT–${String(t.id).padStart(3, "0")}`;
export const isUrgent = (t: Task, today = todayKey()) =>
  Boolean(t.due && t.status !== "done" && dayDiff(t.due, today) <= 2);
export function filterTasks(
  data: AppData,
  search = "",
  project = "",
  includeArchived = false,
): Task[] {
  const q = search.toLocaleLowerCase().trim();
  return data.tasks.filter(
    (t) =>
      (includeArchived || !t.archived) &&
      (!project || t.project === project) &&
      (!q ||
        `${t.title} ${t.description} ${data.projects.find((p) => p.id === t.project)?.name || ""}`
          .toLocaleLowerCase()
          .includes(q)),
  );
}

export const RECENT_COMPLETED_LIMIT = 10;

/** Legacy date-only completions start at local midnight, matching todayKey(). */
const completionTime = (task: Task): number =>
  task.completedAtTime ??
  new Date(`${task.completedAt || task.created}T00:00:00`).getTime();

/** Newest completion first, with stable ID ordering for legacy same-day ties. */
export function compareCompletedTasks(a: Task, b: Task): number {
  return (
    completionTime(b) - completionTime(a) ||
    Number(b.completedAtTime !== undefined) -
      Number(a.completedAtTime !== undefined) ||
    b.id - a.id
  );
}

/** Overflow is marked in place in the task collection; archived tasks never refill the recent ten. */
export function archiveCompletedTasks(data: AppData): AppData {
  const completed = data.tasks.filter(
    (task) => task.status === "done" && !task.archived,
  );
  if (completed.length <= RECENT_COMPLETED_LIMIT) return data;
  const overflow = new Set(
    completed
      .sort(compareCompletedTasks)
      .slice(RECENT_COMPLETED_LIMIT)
      .map((task) => task.id),
  );
  return {
    ...data,
    tasks: data.tasks.map((task) =>
      overflow.has(task.id) ? { ...task, archived: true } : task,
    ),
  };
}
export function tasksOnDate(tasks: Task[], key: string): Task[] {
  return tasks
    .filter((t) => t.due === key)
    .sort(
      (a, b) =>
        Number(a.status === "done") - Number(b.status === "done") ||
        Number(b.priority === "high") - Number(a.priority === "high") ||
        a.id - b.id,
    );
}
export function upcomingGroups(tasks: Task[], start = todayKey()) {
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(start, i);
    return { key, tasks: tasksOnDate(tasks, key) };
  }).filter((g) => g.tasks.length);
}
export const achievements = achievementData;
const count = (data: AppData, key: string) =>
  typeof data.metrics[key] === "number" ? (data.metrics[key] as number) : 0;
export function achievementProgress(
  data: AppData,
  id: string,
  today = todayKey(),
): number {
  const tasks = data.tasks,
    notes = tasks.flatMap((t) => t.notes),
    max = <T>(xs: T[], fn: (item: T) => number) => Math.max(0, ...xs.map(fn));
  const values: Record<string, number> = {
    first: tasks.length,
    done: tasks.filter((t) => t.status === "done").length,
    fire: tasks.filter((t) => t.status === "done" && t.completedAt === today)
      .length,
    free: tasks.length >= 3 && tasks.every((t) => t.status === "done") ? 1 : 0,
    requirements: max(tasks, (t) => t.description.length),
    final_final: Math.max(
      0,
      ...Object.values(data.metrics.descriptionEdits || {}),
    ),
    criteria: max(tasks, (t) =>
      /^#{1,6}\s+Критерии при[её]мки/im.test(t.description)
        ? (t.description.match(/^\s*[-*] /gm) || []).length
        : 0,
    ),
    evidence: max(
      tasks,
      (t) =>
        (
          [t.description, ...t.notes.map((n) => n.text)]
            .join("\n")
            .match(/\[[^\]]+\]\(https?:\/\//g) || []
        ).length,
    ),
    decomposition: max(tasks, (t) => t.checklist.length),
    clean: max(tasks, (t) => (percent(t) === 100 ? t.checklist.length : 0)),
    checklist_spree: count(data, "checked"),
    checklist_return: count(data, "rechecked"),
    meeting_note: max(notes, (n) => n.text.length),
    novel: max(notes, (n) => n.text.length),
    headings: max(notes, (n) => (n.text.match(/^#{1,6} /gm) || []).length),
    markdown: count(data, "bold"),
    no_deadline: tasks.filter((t) => !t.due).length,
    deadline_added: count(data, "deadline"),
    train: count(data, "onTime"),
    overdue_done: count(data, "lateDone"),
    aged: count(data, "deferred"),
    board_moves: count(data, "boardMove"),
    back_from_deferred: count(data, "revived"),
    wip_three: tasks.filter((t) => t.status === "progress").length,
    cat_pets: count(data, "catPets"),
    night_cat: count(data, "nightTheme"),
  };
  return values[id] || 0;
}
export function evaluateAchievements(data: AppData): AppData {
  return {
    ...data,
    unlocked: [
      ...new Set([
        ...data.unlocked,
        ...achievements
          .filter((a) => achievementProgress(data, a.id) >= a.goal)
          .map((a) => a.id),
      ]),
    ],
  };
}
export function recordEvent(data: AppData, event: string): AppData {
  const aliases: Record<string, string> = {
    kanbanMoves: "boardMove",
    catClicks: "catPets",
    returned: "revived",
  };
  const name = aliases[event] || event;
  return evaluateAchievements({
    ...data,
    metrics: { ...data.metrics, [name]: count(data, name) + 1 },
  });
}
/** Every task edit passes this reducer, so all views share the same transition rules. */
export function updateTask(
  data: AppData,
  id: number,
  update: (task: Task) => Task,
  today = todayKey(),
  now = Date.now(),
): AppData {
  const before = data.tasks.find((t) => t.id === id);
  if (!before) return data;
  let after = update(structuredClone(before));
  const metrics = { ...data.metrics };
  const bump = (name: string, n = 1) => {
    metrics[name] = Number(metrics[name] || 0) + n;
  };
  if (after.status !== before.status) {
    if (before.status === "done" && after.status !== "done") {
      delete after.completedAt;
    }
    if (before.status === "deferred" && after.status === "progress")
      bump("revived");
    if (after.status === "deferred") {
      after.due = "";
      bump("deferred");
    }
    if (after.status === "done") {
      if (!Number.isSafeInteger(now) || now < 0)
        throw new Error("Не удалось определить время завершения задачи.");
      after.completedAt = today;
      after.completedAtTime = now;
      delete after.archived;
      after.checklist = after.checklist.map((c) => ({ ...c, done: true }));
      if (after.due === today) bump("onTime");
      if (after.due && dayDiff(after.due, today) < 0) bump("lateDone");
    } else delete after.completedAt;
  }
  if (after.due && !before.due) {
    bump("deadline");
    if (after.status === "deferred") after.status = "created";
  }
  if (after.status === "deferred") after.due = "";
  if (after.status !== "done") {
    delete after.archived;
    delete after.completedAtTime;
  }
  if (after.description !== before.description)
    metrics.descriptionEdits = {
      ...metrics.descriptionEdits,
      [id]: (metrics.descriptionEdits?.[id] || 0) + 1,
    };
  if (
    !(after.status === "done" && before.status !== "done") &&
    before.checklist.length === after.checklist.length
  ) {
    after.checklist = after.checklist.map((c, i) => {
      const old = before.checklist[i];
      if (old.text !== c.text) return c;
      if (old.done && !c.done) return { ...c, wasUnchecked: true };
      if (c.done && !old.done) {
        bump("checked");
        if (c.wasUnchecked || old.wasUnchecked) bump("rechecked");
      }
      return c;
    });
  }
  return evaluateAchievements({
    ...data,
    tasks: data.tasks.map((t) => (t.id === id ? after : t)),
    metrics,
  });
}
