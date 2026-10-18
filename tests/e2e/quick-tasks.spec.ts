import { test, expect, type BrowserContext, type Page } from "@playwright/test";

const STORAGE_KEY = "potom-ui-v1";
const project = {
  id: "widget-project",
  name: "Запуск планнера",
  color: "#dba4bd",
};

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fixture() {
  const createTask = (id: number, title: string, status: string) => ({
    id,
    title,
    status,
    project: project.id,
    priority: "normal",
    due: status === "deferred" ? "" : today(),
    description: "Проверка синхронизации быстрого доступа",
    checklist: [
      { text: "Уточнить детали", done: true },
      { text: "Согласовать результат", done: status === "done" },
    ],
    notes: [],
    created: today(),
    ...(status === "done" ? { completedAt: today() } : {}),
  });
  return {
    schema: 2,
    projects: [project],
    tasks: [
      createTask(1, "Согласовать прототип", "progress"),
      createTask(2, "Подготовить иллюстрации", "created"),
      createTask(3, "Отложенное исследование", "deferred"),
      createTask(4, "Опубликовать бриф", "done"),
    ],
    unlocked: [],
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

async function openWidget(context: BrowserContext) {
  const widget = await context.newPage();
  await widget.setViewportSize({ width: 360, height: 440 });
  await widget.goto("/?widget=1");
  await expect(
    widget.getByRole("button", {
      name: "Показать задачи в работе",
      exact: true,
    }),
  ).toBeVisible();
  return widget;
}

async function expandWidget(widget: Page) {
  await widget
    .getByRole("button", { name: "Показать задачи в работе", exact: true })
    .click();
  const list = widget.getByRole("region", {
    name: "Сейчас в работе",
    exact: true,
  });
  await expect(list).toBeVisible();
  return list;
}

async function openTask(page: Page, title: string) {
  await page.getByText(title, { exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Название задачи", { exact: true }),
  ).toHaveValue(title);
  return dialog;
}

test("виджет показывает только задачи в работе и сворачивает список", async ({
  context,
}) => {
  const widget = await openWidget(context);
  const compact = widget.getByRole("button", {
    name: "Показать задачи в работе",
    exact: true,
  });
  await expect(compact).toContainText("1");
  const list = await expandWidget(widget);
  await expect(list).toHaveCSS("display", "flex");
  await expect(list).toHaveCSS("flex-direction", "column");
  await expect(
    list.getByRole("heading", { name: "Сейчас в работе", exact: true }),
  ).toHaveCSS("font-size", "13px");
  await expect(list).toHaveCSS("font-family", /Golos Text/);
  await expect(
    list.getByRole("button", { name: "Согласовать прототип", exact: true }),
  ).toBeVisible();
  await expect(list).toContainText(project.name);
  for (const title of [
    "Подготовить иллюстрации",
    "Отложенное исследование",
    "Опубликовать бриф",
  ]) {
    await expect(list.getByText(title, { exact: true })).toHaveCount(0);
  }
  await widget
    .getByRole("button", { name: "Свернуть список задач", exact: true })
    .click();
  await expect(list).toBeHidden();
  await expect(compact).toBeVisible();
});

test("изменения названия, статуса и темы из основного окна обновляют виджет", async ({
  context,
  page,
}) => {
  const widget = await openWidget(context);
  let list = await expandWidget(widget);
  const dialog = await openTask(page, "Согласовать прототип");
  await dialog
    .getByLabel("Название задачи", { exact: true })
    .fill("Прототип готов к согласованию");
  await expect(
    list.getByRole("button", {
      name: "Прототип готов к согласованию",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByLabel("Статус", { exact: true }).selectOption("done");
  await expect(
    list.getByRole("button", {
      name: "Прототип готов к согласованию",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const next = await openTask(page, "Подготовить иллюстрации");
  await next.getByLabel("Статус", { exact: true }).selectOption("progress");
  await expect(
    list.getByRole("button", { name: "Подготовить иллюстрации", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /тёмную тему|Сменить тему/ }).click();
  await expect(widget.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(list).toHaveCSS("background-color", "rgb(51, 43, 56)");
  await expect(
    list.getByRole("button", { name: "Подготовить иллюстрации", exact: true }),
  ).toHaveCSS("background-color", "rgb(48, 40, 52)");
  await expect(
    page.locator(".task-row").filter({ hasText: "Подготовить иллюстрации" }),
  ).toHaveCSS("background-color", "rgb(51, 43, 56)");
  await widget.reload();
  list = await expandWidget(widget);
  await expect(
    list.getByRole("button", { name: "Подготовить иллюстрации", exact: true }),
  ).toBeVisible();
  await expect(widget.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(list).toHaveCSS("background-color", "rgb(51, 43, 56)");
});

test("выбор задачи в виджете открывает её в основном окне и сворачивает список", async ({
  context,
  page,
}) => {
  const widget = await openWidget(context);
  const list = await expandWidget(widget);
  await list
    .getByRole("button", { name: "Согласовать прототип", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Название задачи", { exact: true }),
  ).toHaveValue("Согласовать прототип");
  await expect(list).toBeHidden();
  await expect(
    widget.getByRole("button", {
      name: "Показать задачи в работе",
      exact: true,
    }),
  ).toBeVisible();
  await expect(widget.getByRole("dialog")).toHaveCount(0);
});

test("режим лексики сохраняет пользовательское название задачи в виджете", async ({
  context,
  page,
}) => {
  const title = "Разобрать херню перед релизом";
  const dialog = await openTask(page, "Согласовать прототип");
  await dialog.getByLabel("Название задачи", { exact: true }).fill(title);
  const widget = await openWidget(context);
  const list = await expandWidget(widget);
  await expect(
    list.getByRole("button", { name: title, exact: true }),
  ).toBeVisible();
  await expect(list.getByText(title, { exact: true })).toBeVisible();
  await list.getByRole("button", { name: title, exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Название задачи", { exact: true }),
  ).toHaveValue(title);
});

test("пустой виджет переживает перезагрузку и не изменяет сохранённые данные", async ({
  context,
  page,
}) => {
  const dialog = await openTask(page, "Согласовать прототип");
  await dialog.getByLabel("Статус", { exact: true }).selectOption("done");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).tasks[0].status,
        STORAGE_KEY,
      ),
    )
    .toBe("done");
  const before = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  const widget = await openWidget(context);
  await expect(
    widget.getByRole("button", {
      name: "Показать задачи в работе",
      exact: true,
    }),
  ).toContainText("0");
  let list = await expandWidget(widget);
  await expect(
    list.getByRole("button", { name: "Согласовать прототип", exact: true }),
  ).toHaveCount(0);
  await widget.reload();
  list = await expandWidget(widget);
  await expect(
    list.getByRole("button", { name: "Согласовать прототип", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(before);
});
