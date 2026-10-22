import { describe, expect, it } from "vitest";
import type { AppData, Task } from "../types";
import { createInitialData } from "./initial-data";
import {
  achievementProgress,
  achievements,
  archiveCompletedTasks,
  compareCompletedTasks,
  evaluateAchievements,
  filterTasks,
  percent,
  upcomingGroups,
  updateTask,
} from "./tasks";
const today = "2026-10-17";
const task = (patch: Partial<Task> = {}): Task => ({
  id: 1,
  title: "Задача",
  project: "test",
  status: "created",
  due: "",
  priority: "normal",
  description: "",
  checklist: [
    { text: "Один", done: false },
    { text: "Два", done: false },
  ],
  notes: [],
  created: today,
  ...patch,
});
const data = (tasks: Task[]): AppData => ({
  schema: 2,
  tasks,
  projects: [{ id: "test", name: "Проект искомый", color: "#dba4bd" }],
  unlocked: [],
  metrics: {},
  settings: { theme: "light", cleanLanguage: false },
});
describe("единые переходы статусов", () => {
  it("снимает срок при откладывании и возвращает в created при назначении срока", () => {
    let d = updateTask(
      data([task({ due: today })]),
      1,
      (t) => ({ ...t, status: "deferred" }),
      today,
    );
    expect(d.tasks[0].due).toBe("");
    expect(d.metrics.deferred).toBe(1);
    d = updateTask(d, 1, (t) => ({ ...t, due: today }), today);
    expect(d.tasks[0].status).toBe("created");
    expect(d.tasks[0].due).toBe(today);
    expect(d.metrics.deadline).toBe(1);
  });
  it("завершает весь чеклист, сохраняет дату и при возвращении сохраняет галочки", () => {
    let d = updateTask(
      data([task({ due: today })]),
      1,
      (t) => ({ ...t, status: "done" }),
      today,
      1234,
    );
    expect(percent(d.tasks[0])).toBe(100);
    expect(d.tasks[0].completedAt).toBe(today);
    expect(d.tasks[0].completedAtTime).toBe(1234);
    expect(d.metrics.onTime).toBe(1);
    expect(d.metrics.checked).toBeUndefined();
    d = updateTask(d, 1, (t) => ({ ...t, status: "progress" }), today);
    expect(d.tasks[0].status).toBe("progress");
    expect(d.tasks[0].completedAt).toBeUndefined();
    expect(d.tasks[0].completedAtTime).toBeUndefined();
    expect(percent(d.tasks[0])).toBe(100);
  });
  it("никогда не придумывает отсутствующий срок", () => {
    const d = updateTask(
      data([task()]),
      1,
      (t) => ({ ...t, title: "Новое название" }),
      today,
    );
    expect(d.tasks[0].due).toBe("");
  });
  it("не считает удаление пункта кликом по галочке", () => {
    const d = updateTask(
      data([
        task({
          checklist: [
            { text: "Один", done: false },
            { text: "Два", done: true },
          ],
        }),
      ]),
      1,
      (t) => ({ ...t, checklist: t.checklist.slice(1) }),
      today,
    );
    expect(d.metrics.checked).toBeUndefined();
    expect(d.metrics.rechecked).toBeUndefined();
  });
  it("считает снятие и повторное выполнение без потери флага", () => {
    let d = updateTask(
      data([task({ checklist: [{ text: "Один", done: true }] })]),
      1,
      (t) => ({ ...t, checklist: [{ ...t.checklist[0], done: false }] }),
      today,
    );
    expect(d.tasks[0].checklist[0].wasUnchecked).toBe(true);
    d = updateTask(
      d,
      1,
      (t) => ({ ...t, checklist: [{ ...t.checklist[0], done: true }] }),
      today,
    );
    expect(d.metrics.checked).toBe(1);
    expect(d.metrics.rechecked).toBe(1);
  });
});

describe("постоянный архив выполненных задач", () => {
  const completed = (id: number, patch: Partial<Task> = {}) =>
    task({ id, status: "done", completedAt: today, ...patch });

  it("сохраняет identity без переполнения и не возвращает старый архив в свободные места", () => {
    const initial = data([
      ...Array.from({ length: 10 }, (_, index) => completed(index + 1)),
      completed(11, { archived: true }),
      task({ id: 12 }),
    ]);
    expect(archiveCompletedTasks(initial)).toBe(initial);
    const fewerRecent = {
      ...initial,
      tasks: initial.tasks.filter((task) => task.id > 5),
    };
    expect(archiveCompletedTasks(fewerRecent)).toBe(fewerRecent);
    expect(fewerRecent.tasks.find((task) => task.id === 11)?.archived).toBe(
      true,
    );
  });

  it("оставляет десять последних завершений независимо от порядка задач и не удаляет данные", () => {
    const payload = {
      notes: [
        { id: 1, text: "  Точный комментарий\n\n**Markdown**  ", date: today },
      ],
      commentDraft: "  Черновик\n",
      attachments: [
        {
          id: "e940098b-2664-4d46-a7e0-0158a11611ea",
          name: "Файл.bin",
          size: 1,
          mime: "application/octet-stream",
          data: "AA==",
          added: today,
        },
      ],
    };
    const initial = data(
      Array.from({ length: 13 }, (_, index) =>
        completed(13 - index, {
          ...payload,
          completedAtTime: 13 - index,
        }),
      ),
    );
    initial.unlocked = ["done", "novel"];
    initial.metrics = { onTime: 13 };
    const archived = archiveCompletedTasks(initial);
    expect(archived.tasks).toHaveLength(13);
    expect(
      archived.tasks.filter((task) => task.archived).map((task) => task.id),
    ).toEqual([3, 2, 1]);
    expect(initial.tasks.every((task) => !task.archived)).toBe(true);
    expect(archived.tasks[0]).toBe(initial.tasks[0]);
    expect(archived.tasks.at(-1)?.notes).toBe(payload.notes);
    expect(archived.tasks.at(-1)?.attachments).toBe(payload.attachments);
    expect(archived.tasks.at(-1)?.commentDraft).toBe(payload.commentDraft);
    expect(archived.unlocked).toBe(initial.unlocked);
    expect(archived.metrics).toBe(initial.metrics);
    expect(achievementProgress(archived, "done")).toBe(13);
    expect(archiveCompletedTasks(archived)).toBe(archived);
  });

  it("ранжирует legacy по дате завершения, затем создания и ID при одинаковой дате", () => {
    const initial = data([
      completed(1, { completedAt: "2026-10-01", created: "2026-10-22" }),
      completed(2, { completedAt: "2026-10-22", created: "2000-01-01" }),
      ...Array.from({ length: 10 }, (_, index) =>
        completed(index + 3, { completedAt: undefined, created: "2026-10-20" }),
      ),
    ]);
    const archived = archiveCompletedTasks(initial);
    expect(
      archived.tasks.filter((task) => task.archived).map((task) => task.id),
    ).toEqual([1, 3]);
    expect(
      [...initial.tasks].sort(compareCompletedTasks).map((task) => task.id),
    ).toEqual([2, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 1]);
  });

  it("недавно завершённая старая задача остаётся среди десяти даже в начале локального дня", () => {
    const initial = data([
      task({ id: 1, created: "2000-01-01" }),
      ...Array.from({ length: 10 }, (_, index) => completed(index + 2)),
    ]);
    const now = new Date(`${today}T00:00:00`).getTime();
    const finished = updateTask(
      initial,
      1,
      (task) => ({ ...task, status: "done" }),
      today,
      now,
    );
    const archived = archiveCompletedTasks(finished);
    expect(archived.tasks.find((task) => task.id === 1)?.archived).not.toBe(
      true,
    );
    expect(archived.tasks.find((task) => task.id === 2)?.archived).toBe(true);
    expect([...archived.tasks].sort(compareCompletedTasks)[0].id).toBe(1);
  });

  it("timestamp отличает завершения в один день, редактирование не обновляет время и не разархивирует", () => {
    const initial = data([
      completed(1, { archived: true, completedAtTime: 200 }),
      completed(2, { completedAtTime: 100 }),
    ]);
    const edited = updateTask(
      initial,
      1,
      (task) => ({ ...task, title: "Обновлённое название" }),
      today,
      900,
    );
    expect(edited.tasks[0].completedAtTime).toBe(200);
    expect(edited.tasks[0].archived).toBe(true);
    expect(
      [...edited.tasks].sort(compareCompletedTasks).map((task) => task.id),
    ).toEqual([1, 2]);
    const reopened = updateTask(
      edited,
      1,
      (task) => ({ ...task, status: "progress" }),
      today,
      1000,
    );
    expect(reopened.tasks[0].archived).toBeUndefined();
    expect(reopened.tasks[0].completedAtTime).toBeUndefined();
    expect(reopened.tasks[0].completedAt).toBeUndefined();
    const finishedAgain = updateTask(
      reopened,
      1,
      (task) => ({ ...task, status: "done" }),
      today,
      1100,
    );
    expect(finishedAgain.tasks[0].completedAtTime).toBe(1100);
    expect(finishedAgain.tasks[0].archived).toBeUndefined();
  });

  it("обычные фильтры скрывают архив, а includeArchived сохраняет поиск и фильтр проекта", () => {
    const initial = data([
      completed(1, { archived: true, title: "Архивная задача" }),
      completed(2),
      task({ id: 3 }),
    ]);
    expect(filterTasks(initial).map((task) => task.id)).toEqual([2, 3]);
    expect(filterTasks(initial, "архивная")).toEqual([]);
    expect(
      filterTasks(initial, "архивная", "test", true).map((task) => task.id),
    ).toEqual([1]);
    expect(filterTasks(initial, "", "other", true)).toEqual([]);
  });
});
describe("календарь и фильтры", () => {
  it("включает сегодня и +6, включая done, исключает вчера/+7/пустой срок", () => {
    const list = [
      task({ id: 1, due: "2026-10-16" }),
      task({ id: 2, due: today }),
      task({ id: 3, due: "2026-10-23" }),
      task({ id: 4, due: "2026-10-24" }),
      task({ id: 5, due: "" }),
      task({ id: 6, due: today, status: "done" }),
    ];
    const groups = upcomingGroups(list, today);
    expect(groups.map((g) => g.key)).toEqual([today, "2026-10-23"]);
    expect(groups.flatMap((g) => g.tasks.map((t) => t.id))).toEqual([2, 6, 3]);
  });
  it("поиск учитывает название, описание и проект, не документы", () => {
    const d = data([
      task({
        description: "Описание контекст",
        notes: [{ id: 1, text: "секретдок", date: today }],
      }),
    ]);
    expect(filterTasks(d, "Контекст")).toHaveLength(1);
    expect(filterTasks(d, "искомый")).toHaveLength(1);
    expect(filterTasks(d, "секретдок")).toHaveLength(0);
    expect(filterTasks(d, "", "чужой")).toHaveLength(0);
  });
});
describe("достижения", () => {
  it("чистая установка не содержит задач, проектов или прогресса достижений", () => {
    const initial = evaluateAchievements(createInitialData());
    expect(initial.tasks).toEqual([]);
    expect(initial.projects).toEqual([]);
    expect(initial.metrics).toEqual({});
    expect(initial.unlocked).toEqual([]);
    for (const achievement of achievements)
      expect(achievementProgress(initial, achievement.id)).toBe(0);
  });
  it("уже полученная награда сохраняется при регрессе", () => {
    let d = evaluateAchievements(data([task({ status: "done" })]));
    expect(d.unlocked).toContain("done");
    d = evaluateAchievements({ ...d, tasks: [task()] });
    expect(d.unlocked).toContain("done");
  });
  it("считает Markdown и события по реальным данным", () => {
    const d = data([
      task({
        description: "# Критерии приёмки\n- раз\n- два\n- три",
        notes: [{ id: 1, text: "# 1\n## 2\n### 3", date: today }],
      }),
    ]);
    expect(achievementProgress(d, "criteria")).toBe(3);
    expect(achievementProgress(d, "headings")).toBe(3);
    expect(achievementProgress(d, "markdown")).toBe(0);
  });
});
