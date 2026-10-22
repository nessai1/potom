import { test, expect, type Page } from "@playwright/test";

const STORAGE_KEY = "potom-ui-v1";
const BACKUP_KEY = "potom-backups-v1";

function fixture() {
  return {
    schema: 2,
    projects: [
      { id: "reset-test", name: "Проект перед сбросом", color: "#dba4bd" },
    ],
    tasks: [
      {
        id: 1,
        title: "Активная задача перед сбросом",
        status: "progress",
        project: "reset-test",
        priority: "normal",
        due: "2026-10-18",
        description:
          "Пользовательское описание, которое должно попасть в резервную копию.",
        checklist: [
          { text: "Уточнить детали", done: true },
          { text: "Завершить работу", done: false },
        ],
        notes: [
          {
            id: 1,
            text: "# Исходный документ\n\nВажный пользовательский текст.",
            date: "2026-10-18",
          },
        ],
        created: "2026-10-18",
      },
      {
        id: 2,
        title: "Завершённая задача перед сбросом",
        status: "done",
        project: "reset-test",
        priority: "normal",
        due: "2026-10-18",
        description: "Завершённые задачи тоже сбрасываются.",
        checklist: [],
        notes: [],
        created: "2026-10-18",
        completedAt: "2026-10-18",
      },
    ],
    unlocked: ["first", "done"],
    metrics: { customCounter: 7 },
    settings: { theme: "dark", cleanLanguage: true },
  };
}

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(
    ({ key, data }) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify(data));
    },
    { key: STORAGE_KEY, data: fixture() },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
});

async function storedData(page: Page) {
  return page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    STORAGE_KEY,
  );
}

async function resetBackups(page: Page) {
  return page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key) || "[]")
        .filter((entry: { reason: string }) => entry.reason === "before-reset")
        .map((entry: { text: string }) => JSON.parse(entry.text)),
    BACKUP_KEY,
  );
}

function expectEmpty(data: Awaited<ReturnType<typeof storedData>>) {
  expect({
    tasks: data.tasks,
    projects: data.projects,
    unlocked: data.unlocked,
    metrics: data.metrics,
  }).toEqual({ tasks: [], projects: [], unlocked: [], metrics: {} });
}

async function openReset(page: Page) {
  await page.getByRole("button", { name: /Настройки/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сбросить данные", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Начать с чистого листа?",
      exact: true,
    }),
  ).toBeVisible();
  return dialog;
}

async function confirmReset(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("СБРОСИТЬ");
  await dialog
    .getByRole("button", { name: "Сбросить данные", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(async () => (await storedData(page)).tasks.length).toBe(0);
}

test("отмена сброса сохраняет проекты, задачи, награды и резервные копии", async ({
  page,
}) => {
  const before = await storedData(page);
  const backupsBefore = await resetBackups(page);
  const confirmation = await openReset(page);
  await expect(
    confirmation.getByRole("button", { name: "Сбросить данные", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: "Начать с чистого листа?", exact: true }),
  ).toHaveCount(0);
  expect(await storedData(page)).toEqual(before);
  expect(await resetBackups(page)).toEqual(backupsBefore);
  await page.reload();
  await expect(
    page.getByText("Активная задача перед сбросом", { exact: true }),
  ).toBeVisible();
  expect(await storedData(page)).toEqual(before);
});

test("подтверждённый сброс очищает данные, обновляет виджет и сохраняет архив", async ({
  context,
  page,
}) => {
  const before = await storedData(page);
  const widget = await context.newPage();
  await widget.setViewportSize({ width: 360, height: 440 });
  await widget.goto("/?widget=1");
  const compact = widget.getByRole("button", {
    name: "Показать задачи в работе",
    exact: true,
  });
  await expect(compact).toContainText("1");
  await compact.click();
  const list = widget.getByRole("region", {
    name: "Сейчас в работе",
    exact: true,
  });
  await expect(
    list.getByRole("button", {
      name: "Активная задача перед сбросом",
      exact: true,
    }),
  ).toBeVisible();

  const confirmation = await openReset(page);
  await confirmation.getByRole("textbox").fill("НЕ СБРАСЫВАТЬ");
  await expect(
    confirmation.getByRole("button", { name: "Сбросить данные", exact: true }),
  ).toBeDisabled();
  await confirmReset(page);
  expectEmpty(await storedData(page));
  await expect(page.locator(".task-row")).toHaveCount(0);
  await expect(page.locator("#projects .project-item")).toHaveCount(0);
  await expect(
    list.getByText("В работе пока пусто.", { exact: true }),
  ).toBeVisible();
  await expect(list.locator(".quick-task")).toHaveCount(0);
  await expect.poll(() => resetBackups(page)).toEqual([before]);
  await page.getByRole("button", { name: "Достижения", exact: true }).click();
  await expect(page.locator(".achievement-card.locked")).toHaveCount(26);
  await expect(page.locator(".achievement-overall")).toContainText(
    "0 / 26 в коллекции",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
  expectEmpty(await storedData(page));
  await widget.reload();
  await expect(compact).toContainText("0");
});

test("сброс архивирует свежий черновик комментария и отложенное сохранение не возвращает задачи", async ({
  page,
}) => {
  await page.clock.install();
  await page
    .getByText("Активная задача перед сбросом", { exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const markdown =
    "# Последние изменения\n\nЭтот буфер появился прямо перед сбросом.";
  await dialog
    .getByRole("textbox", { name: "Комментарий", exact: true })
    .fill(markdown);
  await page.keyboard.press("Escape");
  await openReset(page);
  await confirmReset(page);
  const backups = await resetBackups(page);
  expect(backups).toHaveLength(1);
  expect(
    backups[0].tasks.find((task: { id: number }) => task.id === 1).commentDraft,
  ).toBe(markdown);
  expectEmpty(await storedData(page));
  await page.clock.fastForward(2_000);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("potom:flush-editors")),
  );
  expectEmpty(await storedData(page));
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
  expectEmpty(await storedData(page));
});

test("ошибка резервной копии отменяет сброс и позволяет безопасно повторить его", async ({
  page,
}) => {
  const before = await storedData(page);
  const backupsBefore = await resetBackups(page);
  const originalSetItem = await page.evaluateHandle(
    () => Storage.prototype.setItem,
  );
  try {
    await page.evaluate((backupKey) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === backupKey)
          throw new DOMException(
            "Недостаточно места для резервной копии",
            "QuotaExceededError",
          );
        return original.call(this, key, value);
      };
    }, BACKUP_KEY);
    const confirmation = await openReset(page);
    await confirmation.getByRole("textbox").fill("СБРОСИТЬ");
    await confirmation
      .getByRole("button", { name: "Сбросить данные", exact: true })
      .click();
    await expect(confirmation.getByRole("alert")).toBeVisible();
    await expect(
      confirmation.getByRole("heading", {
        name: "Начать с чистого листа?",
        exact: true,
      }),
    ).toBeVisible();
    expect(await storedData(page)).toEqual(before);
    expect(await resetBackups(page)).toEqual(backupsBefore);
  } finally {
    await page.evaluate((original) => {
      Storage.prototype.setItem = original;
    }, originalSetItem);
    await originalSetItem.dispose();
  }
  await confirmReset(page);
  expectEmpty(await storedData(page));
  expect(await resetBackups(page)).toEqual([before]);
});

test("сброс с экрана ошибки сохраняет повреждённый архив без изменений", async ({
  page,
}) => {
  const damaged = "{broken";
  await page.evaluate(({ key, text }) => localStorage.setItem(key, text), {
    key: STORAGE_KEY,
    text: damaged,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Не удалось открыть данные",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(damaged);
  await page
    .getByRole("button", { name: "Сбросить данные", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("heading", {
      name: "Начать с чистого листа?",
      exact: true,
    }),
  ).toBeVisible();
  await confirmReset(page);
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
  expectEmpty(await storedData(page));
  const savedRaw = await page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key) || "[]")
        .filter((entry: { reason: string }) => entry.reason === "before-reset")
        .map((entry: { text: string }) => entry.text),
    BACKUP_KEY,
  );
  expect(savedRaw).toEqual([damaged]);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
  expectEmpty(await storedData(page));
});
