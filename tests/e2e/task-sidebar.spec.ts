import { test, expect, type Locator, type Page } from "@playwright/test";

const STORAGE_KEY = "potom-ui-v1";
const TITLE = "Задача с длинным обсуждением";

function fixture() {
  return {
    schema: 2,
    projects: [
      { id: "primary", name: "Основной проект", color: "#dba4bd" },
      { id: "secondary", name: "Проект выпуска", color: "#a5b39c" },
    ],
    tasks: [
      {
        id: 1,
        title: TITLE,
        project: "primary",
        status: "created",
        due: "2030-11-01",
        priority: "normal",
        description: Array.from(
          { length: 36 },
          (_, index) =>
            `### Этап ${index + 1}\n\nНужно проверить сценарии приложения, уточнить детали и сохранить результат обсуждения. Описание намеренно длинное, чтобы работа со свойствами задачи не зависела от положения текста.`,
        ).join("\n\n"),
        checklist: [{ text: "Проверить поведение панели", done: false }],
        notes: Array.from({ length: 28 }, (_, index) => ({
          id: 200 + index,
          text: `**Комментарий ${index + 1}**\n\n${"Обсуждаем решение, фиксируем результат и следующие действия. ".repeat(6)}`,
          date: "2026-10-20",
        })),
        created: "2026-10-20",
      },
    ],
    unlocked: ["first"],
    metrics: {},
    settings: { theme: "light", cleanLanguage: true },
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

async function storedTask(page: Page) {
  return page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key)!).tasks.find(
        (task: { id: number }) => task.id === 1,
      ),
    STORAGE_KEY,
  );
}

async function openTask(page: Page) {
  await page.getByText(TITLE, { exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Название задачи", { exact: true }),
  ).toHaveValue(TITLE);
  await dialog
    .getByRole("button", { name: "Закрыть задачу", exact: true })
    .hover();
  return dialog;
}

async function insideBody(body: Locator, control: Locator) {
  await expect(control).toBeVisible();
  const bounds = await body.boundingBox();
  const box = await control.boundingBox();
  expect(bounds).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(bounds!.x - 2);
  expect(box!.y).toBeGreaterThanOrEqual(bounds!.y - 2);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    bounds!.x + bounds!.width + 2,
  );
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    bounds!.y + bounds!.height + 2,
  );
  return box!;
}

test("длинный текст прокручивается отдельно от свойств задачи в обеих темах", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const theme of ["light", "dark"]) {
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const dialog = await openTask(page);
    const body = dialog.locator(".task-dialog-body");
    const left = dialog.locator(".task-main-content");
    const title = dialog.getByLabel("Название задачи", { exact: true });
    const titleBefore = await title.boundingBox();
    expect(titleBefore).not.toBeNull();
    const names = ["Статус", "Крайний срок", "Приоритет", "Проект"];
    const positions = new Map<string, Awaited<ReturnType<typeof insideBody>>>();
    for (const name of names)
      positions.set(
        name,
        await insideBody(body, dialog.getByLabel(name, { exact: true })),
      );
    const firstComment = dialog
      .getByRole("list", { name: "Комментарии задачи", exact: true })
      .locator("li")
      .first();
    await firstComment.scrollIntoViewIfNeeded();
    const commentBefore = await insideBody(body, firstComment);
    const scrollBefore = await left.evaluate((node) => node.scrollTop);
    await left.hover();
    await page.mouse.wheel(0, 1_200);
    await expect
      .poll(() => left.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(scrollBefore + 900);
    const commentAfter = await firstComment.boundingBox();
    expect(commentAfter).not.toBeNull();
    expect(commentBefore.y - commentAfter!.y).toBeGreaterThan(800);
    const titleAfter = await title.boundingBox();
    expect(titleAfter).not.toBeNull();
    expect(titleBefore!.y - titleAfter!.y).toBeGreaterThan(800);
    for (const name of names) {
      const before = positions.get(name)!;
      const after = await insideBody(
        body,
        dialog.getByLabel(name, { exact: true }),
      );
      expect(Math.abs(after.x - before.x)).toBeLessThan(2);
      expect(Math.abs(after.y - before.y)).toBeLessThan(2);
    }

    const changes =
      theme === "light"
        ? {
            status: "progress",
            due: "2030-11-05",
            priority: "high",
            project: "secondary",
          }
        : {
            status: "created",
            due: "2030-11-06",
            priority: "low",
            project: "primary",
          };
    await dialog
      .getByLabel("Статус", { exact: true })
      .selectOption(changes.status);
    await dialog.getByLabel("Крайний срок", { exact: true }).fill(changes.due);
    await dialog
      .getByLabel("Приоритет", { exact: true })
      .selectOption(changes.priority);
    await dialog
      .getByLabel("Проект", { exact: true })
      .selectOption(changes.project);
    await dialog
      .getByRole("button", { name: "Закрыть задачу", exact: true })
      .click();
    await expect.poll(() => storedTask(page)).toMatchObject(changes);
    await page.reload();
    const reopened = await openTask(page);
    await expect(reopened.getByLabel("Статус", { exact: true })).toHaveValue(
      changes.status,
    );
    await expect(
      reopened.getByLabel("Крайний срок", { exact: true }),
    ).toHaveValue(changes.due);
    await expect(reopened.getByLabel("Приоритет", { exact: true })).toHaveValue(
      changes.priority,
    );
    await expect(reopened.getByLabel("Проект", { exact: true })).toHaveValue(
      changes.project,
    );
    await reopened
      .getByRole("button", { name: "Закрыть задачу", exact: true })
      .click();
    if (theme === "light")
      await page
        .getByRole("button", { name: /тёмную тему|Сменить тему/ })
        .click();
  }
});

test("в минимальном окне правая панель прокручивается, свойства доступны и в полном экране", async ({
  page,
}) => {
  await page.setViewportSize({ width: 980, height: 680 });
  const dialog = await openTask(page);
  const body = dialog.locator(".task-dialog-body");
  const left = dialog.locator(".task-main-content");
  const sidebar = dialog.locator(".task-sidebar");
  await insideBody(body, dialog.getByLabel("Статус", { exact: true }));
  await expect
    .poll(() =>
      sidebar.evaluate((node) => node.scrollHeight - node.clientHeight),
    )
    .toBeGreaterThan(80);
  const leftBefore = await left.evaluate((node) => node.scrollTop);
  await sidebar.hover();
  await page.mouse.wheel(0, 1_400);
  await expect
    .poll(() => sidebar.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(80);
  expect(await left.evaluate((node) => node.scrollTop)).toBe(leftBefore);
  const complete = dialog.getByRole("button", {
    name: "Выполнено. Можно выдохнуть.",
    exact: true,
  });
  await insideBody(body, complete);
  await complete.click();
  await expect.poll(async () => (await storedTask(page)).status).toBe("done");

  await dialog
    .getByRole("button", { name: "Развернуть окно", exact: true })
    .click();
  const restore = dialog.getByRole("button", {
    name: "Свернуть окно",
    exact: true,
  });
  await expect(restore).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Закрыть задачу", exact: true }),
  ).toBeInViewport();
  for (const name of ["Статус", "Крайний срок", "Приоритет", "Проект"]) {
    const control = dialog.getByLabel(name, { exact: true });
    await control.scrollIntoViewIfNeeded();
    await insideBody(body, control);
  }
  await expect(dialog.getByLabel("Статус", { exact: true })).toHaveValue(
    "done",
  );
  await restore.click();
  const returnToTasks = dialog.getByRole("button", {
    name: "Вернуть в задачи",
    exact: true,
  });
  await returnToTasks.scrollIntoViewIfNeeded();
  await insideBody(body, returnToTasks);
  const status = dialog.getByLabel("Статус", { exact: true });
  await status.scrollIntoViewIfNeeded();
  await insideBody(body, status);
  await status.selectOption("progress");
  await dialog
    .getByRole("button", { name: "Закрыть задачу", exact: true })
    .click();
  await expect
    .poll(async () => (await storedTask(page)).status)
    .toBe("progress");
  await page.reload();
  const reopened = await openTask(page);
  await insideBody(
    reopened.locator(".task-dialog-body"),
    reopened.getByLabel("Статус", { exact: true }),
  );
  await expect(reopened.getByLabel("Статус", { exact: true })).toHaveValue(
    "progress",
  );
});
