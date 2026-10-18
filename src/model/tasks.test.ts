import { describe, expect, it } from "vitest";
import type { AppData, Task } from "../types";
import { createSeed } from "./seed";
import {
  achievementProgress,
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
    );
    expect(percent(d.tasks[0])).toBe(100);
    expect(d.tasks[0].completedAt).toBe(today);
    expect(d.metrics.onTime).toBe(1);
    expect(d.metrics.checked).toBeUndefined();
    d = updateTask(d, 1, (t) => ({ ...t, status: "progress" }), today);
    expect(d.tasks[0].status).toBe("progress");
    expect(d.tasks[0].completedAt).toBeUndefined();
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
  it("демо не выдаёт награды за клики, которых не было", () => {
    const seed = evaluateAchievements(createSeed());
    expect(seed.unlocked).not.toContain("markdown");
    expect(seed.unlocked).not.toContain("cat_pets");
    expect(seed.unlocked).not.toContain("train");
    expect(seed.unlocked).toContain("first");
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
