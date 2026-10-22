import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import type { AppData, Task } from "../../src/types";

const STORAGE_KEY = "potom-ui-v1";
const FILE_BYTES = Buffer.from([0, 1, 127, 128, 255, 10, 13]);
const FILE_NAME = "Материалы архива.bin";
const COMMENT =
  "**Решение сохранено.**\n\n| Этап | Статус |\n| --- | --- |\n| Архив | Готово |";

type ArchiveTask = Task & {
  archived?: boolean;
  completedAtTime?: number;
};

function dateAt(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function title(id: number) {
  return `Задача архива ${String(id).padStart(2, "0")}`;
}

function completedTasks(count: number): ArchiveTask[] {
  const time = Date.now() - (count + 1) * 10_000;
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    return {
      id,
      title: title(id),
      project: id % 2 ? "alpha" : "beta",
      status: "done",
      due: dateAt(),
      priority: "normal",
      description: "Контекст выполненной задачи.",
      checklist: [{ text: "Сохранить материалы", done: true }],
      notes: [{ id: 1000 + id, text: COMMENT, date: dateAt() }],
      commentDraft: "Неотправленный комментарий к выполненной задаче",
      attachments: [
        {
          id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
          name: FILE_NAME,
          size: FILE_BYTES.length,
          mime: "application/octet-stream",
          data: FILE_BYTES.toString("base64"),
          added: dateAt(),
        },
      ],
      created: dateAt(-30),
      completedAt: dateAt(),
      completedAtTime: time + id * 10_000,
    };
  });
}

function fixture(tasks: ArchiveTask[]): AppData {
  return {
    schema: 2,
    projects: [
      { id: "alpha", name: "Архив Альфа", color: "#dba4bd" },
      { id: "beta", name: "Архив Бета", color: "#9fa9c2" },
    ],
    tasks,
    unlocked: [],
    metrics: {},
    settings: { theme: "light", cleanLanguage: true },
  };
}

async function launch(page: Page, tasks: ArchiveTask[]) {
  await page.addInitScript(
    ({ key, data }) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify(data));
    },
    { key: STORAGE_KEY, data: fixture(tasks) },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
}

async function stored(page: Page): Promise<AppData & { tasks: ArchiveTask[] }> {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    STORAGE_KEY,
  );
}

async function storedTask(page: Page, id: number) {
  return (await stored(page)).tasks.find((task) => task.id === id)!;
}

async function archivedIds(page: Page) {
  return (await stored(page)).tasks
    .filter((task) => task.archived)
    .map((task) => task.id)
    .sort((a, b) => a - b);
}

async function archive(page: Page) {
  await page.getByRole("button", { name: "Архив", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Архив", exact: true }),
  ).toBeVisible();
}

async function openArchived(page: Page, id: number) {
  await page
    .getByRole("button", { name: `Открыть ${title(id)}`, exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Название задачи", { exact: true }),
  ).toHaveValue(title(id));
  return dialog;
}

test("одиннадцатая выполненная задача архивирует старейшую и скрывает её в основных представлениях", async ({
  page,
}) => {
  const tasks = completedTasks(10);
  tasks.push({
    ...completedTasks(11)[10],
    status: "progress",
    completedAt: undefined,
    completedAtTime: undefined,
  });
  await launch(page, tasks);
  await expect(
    page.getByRole("button", { name: "Архив", exact: true }).locator("b"),
  ).toHaveText("0");
  await page.getByRole("button", { name: "Архив", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Архив пока пуст", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  await page
    .getByRole("button", { name: `Открыть задачу ${title(11)}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Статус", { exact: true })
    .selectOption("done");
  await page.keyboard.press("Escape");
  await expect.poll(() => archivedIds(page)).toEqual([1]);
  expect((await stored(page)).tasks).toHaveLength(11);
  expect(await storedTask(page, 1)).toMatchObject({
    status: "done",
    notes: tasks[0].notes,
    attachments: tasks[0].attachments,
  });
  expect((await storedTask(page, 11)).completedAtTime).toBeGreaterThan(
    tasks[9].completedAtTime!,
  );
  await expect(
    page.getByRole("button", { name: "Архив", exact: true }).locator("b"),
  ).toHaveText("1");
  await page.getByRole("button", { name: /^Готово\s*10$/ }).click();
  await expect(page.locator(".task-row")).toHaveCount(10);
  await expect(page.getByText(title(1), { exact: true })).toHaveCount(0);
  await expect(page.getByText(title(11), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  await expect(
    page.locator('.kanban-col[data-status="done"] .kanban-card'),
  ).toHaveCount(10);
  await expect(page.getByText(title(1), { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  await page.getByRole("button", { name: "День", exact: true }).click();
  await expect(page.locator(".cal-task-card")).toHaveCount(10);
  await expect(page.getByText(title(1), { exact: true })).toHaveCount(0);
  await archive(page);
  await expect(
    page.getByRole("list", { name: "Архивные задачи" }).locator("li"),
  ).toHaveCount(1);
  await openArchived(page, 1);
});

test("загрузка старых данных без времени завершения архивирует избыток один раз и сохраняет все задачи", async ({
  page,
}) => {
  const tasks = completedTasks(13)
    .map((task) => {
      delete task.completedAtTime;
      task.completedAt = dateAt(task.id - 14);
      return task;
    })
    .reverse();
  await launch(page, tasks);
  await expect.poll(() => archivedIds(page)).toEqual([1, 2, 3]);
  const normalized = (await stored(page)).tasks;
  expect(normalized).toHaveLength(13);
  for (const original of tasks)
    expect(normalized.find((task) => task.id === original.id)).toMatchObject(
      original,
    );
  await archive(page);
  await expect(page.locator(".archive-task")).toHaveCount(3);
  await expect(page.locator(".archive-task").first()).toHaveAttribute(
    "data-task-id",
    "3",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await stored(page)).tasks).toEqual(normalized);
  await archive(page);
  await expect(page.locator(".archive-task")).toHaveCount(3);
});

test("архив объединяет поиск и фильтр проекта и показывает понятное пустое состояние", async ({
  page,
}) => {
  await launch(page, completedTasks(13));
  await archive(page);
  await expect(page.locator(".archive-task")).toHaveCount(3);
  const search = page.getByPlaceholder("Найти задачу");
  await search.fill(title(2));
  await expect(page.locator(".archive-task")).toHaveCount(1);
  await expect(page.locator(".archive-task")).toHaveAttribute(
    "data-task-id",
    "2",
  );
  await page
    .locator("#projects .project-item")
    .filter({ hasText: "Архив Альфа" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ничего не найдено", exact: true }),
  ).toBeVisible();
  await search.fill("");
  await expect(page.locator(".archive-task")).toHaveCount(2);
  await expect(page.locator('.archive-task[data-task-id="2"]')).toHaveCount(0);
  await page
    .locator("#projects .project-item")
    .filter({ hasText: "Архив Альфа" })
    .click();
  await expect(page.locator(".archive-task")).toHaveCount(3);
  await expect(
    page.getByRole("heading", { name: "Архив", exact: true }),
  ).toBeVisible();
});

test("возврат старой задачи очищает архив, повторное выполнение делает её новой для лимита", async ({
  page,
}) => {
  const tasks = completedTasks(11);
  await launch(page, tasks);
  await archive(page);
  await page
    .getByRole("button", { name: `Вернуть в работу: ${title(1)}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Архив пока пуст", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await storedTask(page, 1)).status)
    .toBe("progress");
  const restored = await storedTask(page, 1);
  expect(restored.archived).toBeFalsy();
  expect(restored.completedAt).toBeUndefined();
  expect(restored.completedAtTime).toBeUndefined();
  expect(restored.notes).toEqual(tasks[0].notes);
  expect(restored.attachments).toEqual(tasks[0].attachments);
  await page.getByRole("button", { name: "Мои задачи", exact: true }).click();
  await page
    .getByRole("button", { name: `Открыть задачу ${title(1)}`, exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Статус", { exact: true })
    .selectOption("done");
  await page.keyboard.press("Escape");
  await expect.poll(() => archivedIds(page)).toEqual([2]);
  const finished = await storedTask(page, 1);
  expect(finished.completedAtTime).toBeGreaterThan(tasks[10].completedAtTime!);
  expect(finished.archived).toBeFalsy();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
  await expect.poll(() => archivedIds(page)).toEqual([2]);
  await archive(page);
  const dialog = await openArchived(page, 2);
  await dialog
    .getByRole("button", { name: "Действия с задачей", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Сделать копию", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Название задачи", { exact: true }),
  ).toHaveValue(`${title(2)} — копия`);
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await stored(page)).tasks.length).toBe(12);
  const copy = (await stored(page)).tasks.find(
    (task) => task.title === `${title(2)} — копия`,
  )!;
  expect(copy).toMatchObject({
    status: "created",
    notes: tasks[1].notes,
    attachments: tasks[1].attachments,
  });
  expect(copy.archived).toBeFalsy();
  expect(copy.completedAt).toBeUndefined();
  expect(copy.completedAtTime).toBeUndefined();
  expect(await archivedIds(page)).toEqual([2]);
});

test("экспорт, импорт и перезапуск сохраняют архив, точное время, комментарии и байты файлов", async ({
  page,
}) => {
  await launch(page, completedTasks(11));
  await expect.poll(() => archivedIds(page)).toEqual([1]);
  await page.getByRole("button", { name: /Настройки/ }).click();
  const pendingExport = page.waitForEvent("download");
  await page.getByRole("button", { name: "Экспорт JSON", exact: true }).click();
  const backup = await pendingExport;
  const backupPath = await backup.path();
  expect(backupPath).toBeTruthy();
  const exported = JSON.parse(await readFile(backupPath!, "utf8"));
  const expected = exported.tasks.find((task: ArchiveTask) => task.id === 1);
  expect(expected.archived).toBe(true);
  expect(typeof expected.completedAtTime).toBe("number");
  expect(Buffer.from(expected.attachments[0].data, "base64")).toEqual(
    FILE_BYTES,
  );
  await page.keyboard.press("Escape");
  await archive(page);
  await page
    .getByRole("button", { name: `Вернуть в работу: ${title(1)}`, exact: true })
    .click();
  await expect
    .poll(async () => (await storedTask(page, 1)).archived)
    .toBeFalsy();
  await page.getByRole("button", { name: /Настройки/ }).click();
  await page.getByRole("button", { name: "Импорт JSON", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Выбрать и восстановить JSON", exact: true })
    .click();
  await (await chooser).setFiles(backupPath!);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => storedTask(page, 1)).toEqual(expected);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
  await archive(page);
  const dialog = await openArchived(page, 1);
  await expect(
    dialog
      .getByRole("list", { name: "Комментарии задачи" })
      .locator(".comment-markdown strong"),
  ).toHaveText("Решение сохранено.");
  await expect(
    dialog.getByRole("list", { name: "Комментарии задачи" }).getByRole("table"),
  ).toContainText("Готово");
  await expect(
    dialog.getByRole("textbox", { name: "Комментарий", exact: true }),
  ).toHaveValue(expected.commentDraft);
  const pendingFile = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: `Скачать файл ${FILE_NAME}`, exact: true })
    .click();
  const file = await pendingFile;
  expect(file.suggestedFilename()).toBe(FILE_NAME);
  expect(await readFile((await file.path())!)).toEqual(FILE_BYTES);
  expect(await storedTask(page, 1)).toEqual(expected);
});

test("достижения учитывают материалы задачи, попавшей в архив при загрузке", async ({
  page,
}) => {
  const tasks = completedTasks(11);
  tasks[0].description = "Требования к архиву. ".repeat(30);
  await launch(page, tasks);
  await expect.poll(() => archivedIds(page)).toEqual([1]);
  await expect
    .poll(async () => (await stored(page)).unlocked)
    .toContain("requirements");
  await page.getByRole("button", { name: "Достижения", exact: true }).click();
  const card = page.locator(".achievement-card").filter({
    has: page.getByRole("heading", { name: "Я вам не Ванга", exact: true }),
  });
  await expect(card).not.toHaveClass(/locked/);
  await expect(card).toContainText("В кармане");
});
