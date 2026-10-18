import { test, expect, type Page } from "@playwright/test";

const STORAGE_KEY = "potom-ui-v1";

async function storedData(page: Page) {
  return page.evaluate((key) => {
    const text = localStorage.getItem(key);
    return text === null ? null : JSON.parse(text);
  }, STORAGE_KEY);
}

async function openMain(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
  await expect.poll(() => storedData(page)).not.toBeNull();
}

test("чистая установка сохраняет пустые данные и все 26 достижений закрыты", async ({
  context,
  page,
}) => {
  await openMain(page);
  const initial = await storedData(page);
  expect(initial).toMatchObject({
    schema: 2,
    tasks: [],
    projects: [],
    unlocked: [],
    metrics: {},
  });
  expect(initial.metrics).toEqual({});
  await expect(page.locator(".task-row")).toHaveCount(0);
  await expect(page.locator("#projects .project-item")).toHaveCount(0);
  await expect(page.locator(".summary-item").first()).toContainText(
    "0 всего задач",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
  expect(await storedData(page)).toEqual(initial);

  await page.getByRole("button", { name: "Достижения", exact: true }).click();
  await expect(page.locator(".achievement-overall")).toContainText(
    "0 / 26 в коллекции",
  );
  await expect(page.locator(".achievement-card.locked")).toHaveCount(26);
  await expect(page.locator(".achievement-card:not(.locked)")).toHaveCount(0);
  const progress = page.getByRole("progressbar");
  await expect(progress).toHaveCount(26);
  for (const bar of await progress.all())
    await expect(bar).toHaveAttribute("aria-valuenow", "0");

  const widget = await context.newPage();
  await widget.setViewportSize({ width: 360, height: 440 });
  await widget.goto("/?widget=1");
  const compact = widget.getByRole("button", {
    name: "Показать задачи в работе",
    exact: true,
  });
  await expect(compact).toContainText("0");
  await compact.click();
  const list = widget.getByRole("region", {
    name: "Сейчас в работе",
    exact: true,
  });
  await expect(
    list.getByText("В работе пока пусто.", { exact: true }),
  ).toBeVisible();
  await expect(list.locator(".quick-task")).toHaveCount(0);
  expect(await storedData(page)).toEqual(initial);
});

test("первый проект и задача создаются с нуля и открывают первую награду", async ({
  page,
}) => {
  await openMain(page);
  expect((await storedData(page)).unlocked).toEqual([]);
  await page.getByRole("button", { name: "Новая задача", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Название задачи", { exact: true })
    .fill("Моя первая задача");
  await expect(
    dialog.getByRole("button", { name: "Создать задачу", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Название проекта", { exact: true })
    .fill("Мой первый проект");
  expect(await storedData(page)).toMatchObject({
    projects: [],
    tasks: [],
    unlocked: [],
  });
  await dialog
    .getByRole("button", { name: "Создать задачу", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Название задачи", { exact: true }),
  ).toHaveValue("Моя первая задача");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await storedData(page)).unlocked)
    .toEqual(["first"]);
  const saved = await storedData(page);
  expect(saved.projects).toHaveLength(1);
  expect(saved.projects[0].name).toBe("Мой первый проект");
  expect(saved.tasks).toHaveLength(1);
  expect(saved.tasks[0]).toMatchObject({
    id: 1,
    title: "Моя первая задача",
    project: saved.projects[0].id,
    status: "created",
    checklist: [],
    notes: [],
  });
  await page.reload();
  await expect(
    page.getByText("Моя первая задача", { exact: true }),
  ).toBeVisible();
  expect(await storedData(page)).toEqual(saved);
  await page.getByRole("button", { name: "Достижения", exact: true }).click();
  const first = page.locator(".achievement-card").filter({
    has: page.getByRole("heading", { name: "Развела сущностей", exact: true }),
  });
  await expect(first).not.toHaveClass(/locked/);
  await expect(first.getByText("В кармане", { exact: true })).toBeVisible();
  await expect(page.locator(".achievement-card.locked")).toHaveCount(25);
});

test("обновление сохраняет существующие пользовательские проекты, задачи и награды", async ({
  page,
}) => {
  const existing = {
    schema: 2,
    projects: [{ id: "personal", name: "Мои важные дела", color: "#dba4bd" }],
    tasks: [
      {
        id: 42,
        title: "Сохранённая пользовательская задача",
        project: "personal",
        status: "created",
        due: "",
        priority: "normal",
        description: "Этот текст нельзя заменять при обновлении приложения.",
        checklist: [],
        notes: [],
        created: "2026-10-17",
      },
    ],
    unlocked: ["first"],
    metrics: { customCounter: 7 },
    settings: { theme: "dark", cleanLanguage: true },
  };
  await page.addInitScript(
    ({ key, data }) => {
      if (localStorage.getItem(key) === null)
        localStorage.setItem(key, JSON.stringify(data));
    },
    { key: STORAGE_KEY, data: existing },
  );
  await openMain(page);
  await expect(
    page.getByText("Сохранённая пользовательская задача", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await storedData(page)).toEqual(existing);
  await page.reload();
  await expect(
    page.getByText("Сохранённая пользовательская задача", { exact: true }),
  ).toBeVisible();
  expect(await storedData(page)).toEqual(existing);
});
