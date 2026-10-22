import { test, expect, type Locator, type Page } from "@playwright/test";

const STORAGE_KEY = "potom-ui-v1";
const LONG_TITLE =
  "Проверить длинное название задачи: переносы строк должны увеличивать карточку и колонку, сохраняя весь контекст без обрезки текста";

function fixture() {
  const task = (id: number, title: string, status: string) => ({
    id,
    title,
    status,
    project: "layout",
    priority: "normal",
    due: "",
    description: "Проверка канбана с разным количеством и размером карточек.",
    checklist: [],
    notes: [],
    created: "2026-10-20",
  });
  return {
    schema: 2,
    projects: [{ id: "layout", name: "Разный объём задач", color: "#dba4bd" }],
    tasks: [
      task(1, "Короткая задача", "created"),
      task(2, LONG_TITLE, "created"),
      task(3, "Ещё одна задача", "created"),
      task(4, "В работе", "progress"),
      { ...task(5, "Уже готово", "done"), completedAt: "2026-10-20" },
    ],
    unlocked: ["first", "done"],
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
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Доска разруливания", exact: true }),
  ).toBeVisible();
});

function column(page: Page, status: string) {
  return page.locator(`.board .kanban-col[data-status="${status}"]`);
}

function card(page: Page, status: string, id: number) {
  return column(page, status).locator(`.kanban-card[data-task-id="${id}"]`);
}

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function storedStatus(page: Page, id: number) {
  return page.evaluate(
    ({ key, taskId }) =>
      JSON.parse(localStorage.getItem(key)!).tasks.find(
        (task: { id: number }) => task.id === taskId,
      ).status,
    { key: STORAGE_KEY, taskId: id },
  );
}

async function keyboardMove(page: Page, from: string, through: string[]) {
  await card(page, from, 1).focus();
  await page.keyboard.press("Space", { delay: 50 });
  await expect(page.locator(".kanban-drag-preview")).toBeVisible();
  const statuses = ["created", "progress", "deferred", "done"];
  let current = from;
  for (const next of through) {
    await page.keyboard.press(
      statuses.indexOf(next) > statuses.indexOf(current)
        ? "ArrowRight"
        : "ArrowLeft",
    );
    await expect(column(page, next)).toHaveClass(/dragover/);
    current = next;
  }
  await page.keyboard.press("Space");
  await expect(card(page, current, 1)).toBeVisible();
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => storedStatus(page, 1)).toBe(current);
}

test("высота каждой колонки соответствует её карточкам в обеих темах", async ({
  page,
}) => {
  for (const theme of ["light", "dark"]) {
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const created = await bounds(column(page, "created"));
    const progress = await bounds(column(page, "progress"));
    const deferred = await bounds(column(page, "deferred"));
    const done = await bounds(column(page, "done"));
    expect(created.height).toBeGreaterThan(progress.height + 150);
    expect(progress.height).toBeLessThan(380);
    expect(deferred.height).toBeGreaterThanOrEqual(100);
    expect(deferred.height).toBeLessThan(progress.height);
    expect(done.height).toBeLessThan(created.height - 150);
    for (const box of [progress, deferred, done])
      expect(Math.abs(box.y - created.y)).toBeLessThan(2);

    const shortCard = await bounds(card(page, "created", 1));
    const longCard = await bounds(card(page, "created", 2));
    expect(longCard.height).toBeGreaterThan(shortCard.height + 30);
    const title = card(page, "created", 2).getByRole("heading", {
      name: LONG_TITLE,
      exact: true,
    });
    expect(
      await title.evaluate((node) => node.scrollHeight - node.clientHeight),
    ).toBeLessThanOrEqual(1);
    for (const status of ["created", "progress", "done"]) {
      const box = await bounds(column(page, status));
      const add = await bounds(column(page, status).locator(".kanban-add"));
      const gap = box.y + box.height - (add.y + add.height);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThan(32);
    }
    if (theme === "light")
      await page
        .getByRole("button", { name: /тёмную тему|Сменить тему/ })
        .click();
  }
});

test("компактная пустая колонка принимает карточку мышью и с клавиатуры", async ({
  page,
}) => {
  const emptyBefore = await bounds(column(page, "deferred"));
  const sourceBefore = await bounds(column(page, "created"));
  const source = await bounds(card(page, "created", 1));
  await page.mouse.move(source.x + source.width / 2, source.y + 40);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 14, source.y + 44, {
    steps: 5,
  });
  await expect(page.locator(".kanban-drag-preview")).toBeVisible();
  await page.mouse.move(
    emptyBefore.x + emptyBefore.width / 2,
    emptyBefore.y + emptyBefore.height / 2,
    { steps: 18 },
  );
  await expect(column(page, "deferred")).toHaveClass(/dragover/);
  await page.mouse.up();
  await expect(card(page, "deferred", 1)).toBeVisible();
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => storedStatus(page, 1)).toBe("deferred");
  expect((await bounds(column(page, "deferred"))).height).toBeGreaterThan(
    emptyBefore.height + 60,
  );
  expect((await bounds(column(page, "created"))).height).toBeLessThan(
    sourceBefore.height - 80,
  );

  await keyboardMove(page, "deferred", ["progress", "created"]);
  expect(
    Math.abs(
      (await bounds(column(page, "deferred"))).height - emptyBefore.height,
    ),
  ).toBeLessThan(2);
  await keyboardMove(page, "created", ["progress", "deferred"]);
  expect((await bounds(column(page, "deferred"))).height).toBeGreaterThan(
    emptyBefore.height + 60,
  );
  await page.reload();
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  await expect(card(page, "deferred", 1)).toBeVisible();
  expect((await bounds(column(page, "created"))).height).toBeLessThan(
    sourceBefore.height - 80,
  );
});
