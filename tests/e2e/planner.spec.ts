import { test, expect, type Page } from "@playwright/test";

function dateAt(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const task = (id: number, title: string, due: string, status = "created") => ({
  id,
  title,
  due,
  status,
  project: "test",
  priority: "normal",
  description: "Описание для проверки",
  checklist: [
    { text: "Пункт один", done: false },
    { text: "Пункт два", done: false },
  ],
  notes: [
    {
      id: 100 + id,
      text: "# Исходный документ\n\nТекст, который нужно сохранить.",
      date: dateAt(0),
    },
  ],
  created: dateAt(0),
});
const fixture = () => ({
  schema: 2,
  projects: [{ id: "test", name: "Тестовый проект", color: "#dba4bd" }],
  tasks: [
    task(1, "Без даты", ""),
    task(2, "Вчерашняя задача", dateAt(-1)),
    task(3, "Сегодняшняя задача", dateAt(0)),
    task(4, "Шестой день", dateAt(6)),
    task(5, "Седьмой день", dateAt(7)),
    {
      ...task(6, "Выполнено сегодня", dateAt(0), "done"),
      completedAt: dateAt(0),
    },
  ],
  unlocked: [],
  metrics: {},
  settings: { theme: "light", cleanLanguage: true },
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => {
    if (!sessionStorage.getItem("fixture-initialized")) {
      localStorage.setItem("potom-ui-v1", JSON.stringify(data));
      sessionStorage.setItem("fixture-initialized", "1");
    }
  }, fixture());
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeVisible();
});

async function openTask(page: Page, title: string) {
  await page.getByText(title, { exact: true }).first().click();
  return page.getByRole("dialog").last();
}
async function storedTask(page: Page, id: number) {
  return page.evaluate(
    (taskId) =>
      JSON.parse(localStorage.getItem("potom-ui-v1")!).tasks.find(
        (item: { id: number }) => item.id === taskId,
      ),
    id,
  );
}

function boardCard(page: Page, status: string, title: string) {
  return page
    .locator(`.board .kanban-col[data-status="${status}"] .kanban-card`)
    .filter({ hasText: title });
}

async function startCardDrag(page: Page, status: string, title: string) {
  const card = boardCard(page, status, title);
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  const origin = { x: box!.x + box!.width / 2, y: box!.y + 40 };
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 14, origin.y + 4, { steps: 5 });
  await expect(page.locator(".kanban-drag-preview")).toBeVisible();
}

async function moveDragToColumn(page: Page, status: string) {
  const column = page.locator(`.board .kanban-col[data-status="${status}"]`);
  const box = await column.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 100, {
    steps: 18,
  });
  await expect(column).toHaveClass(/dragover/);
}

async function dragCard(page: Page, title: string, from: string, to: string) {
  await startCardDrag(page, from, title);
  await moveDragToColumn(page, to);
  await page.mouse.up();
  await expect(boardCard(page, to, title)).toBeVisible();
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("задача без срока переживает перезагрузку и доступна на канбане", async ({
  page,
}) => {
  let dialog = await openTask(page, "Без даты");
  await expect(dialog.getByLabel("Крайний срок", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    dialog.getByText("Срока нет", { exact: true }).first(),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  dialog = await openTask(page, "Без даты");
  await expect(dialog.getByLabel("Крайний срок", { exact: true })).toHaveValue(
    "",
  );
  expect((await storedTask(page, 1)).due).toBe("");
});

test("статусы снимают срок, завершают чеклист и корректно возвращают задачу", async ({
  page,
}) => {
  const dialog = await openTask(page, "Сегодняшняя задача");
  await dialog.getByLabel("Статус", { exact: true }).selectOption("deferred");
  await expect(dialog.getByLabel("Крайний срок", { exact: true })).toHaveValue(
    "",
  );
  await dialog.getByLabel("Крайний срок", { exact: true }).fill(dateAt(2));
  await expect(dialog.getByLabel("Статус", { exact: true })).toHaveValue(
    "created",
  );
  await dialog.getByLabel("Статус", { exact: true }).selectOption("done");
  await expect(
    dialog.getByRole("progressbar", { name: "Прогресс чеклиста" }),
  ).toHaveAttribute("aria-valuenow", "100");
  await dialog.getByLabel("Статус", { exact: true }).selectOption("created");
  await expect(
    dialog.getByRole("progressbar", { name: "Прогресс чеклиста" }),
  ).toHaveAttribute("aria-valuenow", "100");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await storedTask(page, 3)).status)
    .toBe("created");
  expect((await storedTask(page, 3)).completedAt).toBeUndefined();
  await page.reload();
  const reopened = await openTask(page, "Сегодняшняя задача");
  await expect(
    reopened.getByRole("progressbar", { name: "Прогресс чеклиста" }),
  ).toHaveAttribute("aria-valuenow", "100");
});

test("семидневная повестка соблюдает границы и включает выполненные задачи", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Календарь", exact: true }).click();
  await page.getByRole("button", { name: "День", exact: true }).click();
  const main = page.getByRole("main");
  await expect(
    main.getByText("Сегодняшняя задача", { exact: true }),
  ).toBeVisible();
  await expect(main.getByText("Шестой день", { exact: true })).toBeVisible();
  await expect(
    main.getByText("Выполнено сегодня", { exact: true }),
  ).toBeVisible();
  await expect(main.getByText("Вчерашняя задача", { exact: true })).toHaveCount(
    0,
  );
  await expect(main.getByText("Седьмой день", { exact: true })).toHaveCount(0);
  await expect(main.getByText("Без даты", { exact: true })).toHaveCount(0);
});

test("черновик комментария сохраняется при закрытии и не публикуется сам", async ({
  page,
}) => {
  let dialog = await openTask(page, "Без даты");
  const before = await storedTask(page, 1);
  const source = dialog.getByRole("textbox", {
    name: "Комментарий",
    exact: true,
  });
  const markdown =
    "# Новая версия\n\nНесохранённый буфер\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
  await source.fill(markdown);
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await storedTask(page, 1)).commentDraft)
    .toBe(markdown);
  expect((await storedTask(page, 1)).notes).toEqual(before.notes);
  await page.reload();
  dialog = await openTask(page, "Без даты");
  await expect(
    dialog.getByRole("textbox", { name: "Комментарий", exact: true }),
  ).toHaveValue(markdown);
});

test("тема и режим лексики сохраняются без изменения пользовательского текста", async ({
  page,
}) => {
  const before = await storedTask(page, 1);
  await page.getByRole("button", { name: /тёмную тему|Сменить тему/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect((await storedTask(page, 1)).description).toBe(before.description);
});

test("создание, копирование и удаление задачи проходят через подтверждение", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Новая задача", exact: true }).click();
  const form = page.getByRole("dialog");
  await form
    .getByLabel("Название задачи", { exact: true })
    .fill("Новая задача из формы");
  await form
    .getByRole("button", { name: "Создать задачу", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Название задачи", { exact: true }),
  ).toHaveValue("Новая задача из формы");
  await page
    .getByRole("button", { name: "Действия с задачей", exact: true })
    .click();
  await page.getByRole("button", { name: /копию|Копировать/ }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Название задачи", { exact: true }),
  ).toHaveValue("Новая задача из формы — копия");
  await page
    .getByRole("button", { name: "Действия с задачей", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Удалить задачу", exact: true })
    .click();
  const confirmation = page.getByRole("dialog").last();
  await expect(
    confirmation.getByRole("heading", { name: "Удалить задачу?", exact: true }),
  ).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Оставить", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Название задачи", { exact: true }),
  ).toHaveValue("Новая задача из формы — копия");
  await page
    .getByRole("button", { name: "Действия с задачей", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Удалить задачу", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Удалить задачу", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Новая задача из формы", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Новая задача из формы — копия", { exact: true }),
  ).toHaveCount(0);
});

test("перетаскивание канбана сохраняет переход между всеми четырьмя колонками", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  let previous = "created";
  for (const status of ["progress", "deferred", "done", "progress"]) {
    await dragCard(page, "Сегодняшняя задача", previous, status);
    await expect
      .poll(async () => (await storedTask(page, 3)).status)
      .toBe(status);
    const saved = await storedTask(page, 3);
    expect(saved.due).toBe(
      status === "progress" && previous === "created" ? dateAt(0) : "",
    );
    expect(saved.checklist.every((item: { done: boolean }) => item.done)).toBe(
      status === "done" || previous === "done",
    );
    if (status === "done") expect(saved.completedAt).toBe(dateAt(0));
    else expect(saved.completedAt).toBeUndefined();
    previous = status;
  }
  await page.reload();
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  await expect(boardCard(page, "progress", "Сегодняшняя задача")).toBeVisible();
  expect((await storedTask(page, 3)).checklist).toEqual([
    { text: "Пункт один", done: true },
    { text: "Пункт два", done: true },
  ]);
});

test("канбан открывает карточку по клику и Enter, а короткое движение не запускает перенос", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  const card = boardCard(page, "created", "Сегодняшняя задача");
  await card.click();
  await expect(
    page.getByRole("dialog").getByLabel("Название задачи", { exact: true }),
  ).toHaveValue("Сегодняшняя задача");
  await page.keyboard.press("Escape");
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog").getByLabel("Название задачи", { exact: true }),
  ).toHaveValue("Сегодняшняя задача");
  await page.keyboard.press("Escape");

  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 40);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 3, box!.y + 42);
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect((await storedTask(page, 3)).status).toBe("created");
});

test("быстрый перенос одним движением мыши попадает в конечную колонку", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  const source = await boardCard(
    page,
    "created",
    "Сегодняшняя задача",
  ).boundingBox();
  const target = await page
    .locator('.board .kanban-col[data-status="progress"]')
    .boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + 40);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + 100);
  await page.mouse.up();
  await expect(boardCard(page, "progress", "Сегодняшняя задача")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await storedTask(page, 3)).status)
    .toBe("progress");
  await expect(page.locator('[id^="DndLiveRegion-"]')).toHaveText(
    "Задача перенесена в «Выполняется».",
  );
  expect(errors).toEqual([]);
});

test("перенос и отпускание в одном цикле событий завершают канбан без зависания", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>(
      '.board .kanban-col[data-status="created"] .kanban-card[data-task-id="3"]',
    )!;
    const target = document.querySelector<HTMLElement>(
      '.board .kanban-col[data-status="progress"]',
    )!;
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const pointer = {
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      bubbles: true,
      cancelable: true,
    };
    // Some native WebViews deliver these events before React commits activation.
    source.dispatchEvent(
      new PointerEvent("pointerdown", {
        ...pointer,
        buttons: 1,
        clientX: from.x + from.width / 2,
        clientY: from.y + 40,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        ...pointer,
        buttons: 1,
        clientX: to.x + to.width / 2,
        clientY: to.y + 100,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        ...pointer,
        buttons: 0,
        clientX: to.x + to.width / 2,
        clientY: to.y + 100,
      }),
    );
  });
  await expect(boardCard(page, "progress", "Сегодняшняя задача")).toBeVisible();
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await expect(page.locator(".board.is-dragging")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await storedTask(page, 3)).status)
    .toBe("progress");
});

test("Escape отменяет перенос канбана без изменения задачи", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  const before = await storedTask(page, 3);
  await startCardDrag(page, "created", "Сегодняшняя задача");
  await moveDragToColumn(page, "deferred");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await expect(boardCard(page, "created", "Сегодняшняя задача")).toBeVisible();
  await expect(page.locator(".kanban-col.dragover")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await storedTask(page, 3)).toEqual(before);
});

test("отпускание карточки за пределами канбана не меняет статус", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  const before = await storedTask(page, 3);
  await startCardDrag(page, "created", "Сегодняшняя задача");
  await moveDragToColumn(page, "done");
  const title = await page
    .getByRole("heading", { name: "Доска разруливания", exact: true })
    .boundingBox();
  expect(title).not.toBeNull();
  await page.mouse.move(title!.x + title!.width / 2, title!.y + 5, {
    steps: 18,
  });
  await expect(page.locator(".kanban-col.dragover")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await expect(boardCard(page, "created", "Сегодняшняя задача")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await storedTask(page, 3)).toEqual(before);
});

test("клавиатура переносит карточку между колонками и отменяет перенос", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  await boardCard(page, "created", "Сегодняшняя задача").focus();
  // Hold Space as a normal keypress while dnd-kit installs its keyboard sensor.
  await page.keyboard.press("Space", { delay: 50 });
  await expect(page.locator(".kanban-drag-preview")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.kanban-col[data-status="progress"]')).toHaveClass(
    /dragover/,
  );
  await page.keyboard.press("Space");
  await expect(boardCard(page, "progress", "Сегодняшняя задача")).toBeVisible();
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await storedTask(page, 3)).status)
    .toBe("progress");
  await expect(page.locator('[id^="DndLiveRegion-"]')).toHaveText(
    "Задача перенесена в «Выполняется».",
  );

  await boardCard(page, "progress", "Сегодняшняя задача").focus();
  await page.keyboard.press("Space", { delay: 50 });
  await expect(page.locator(".kanban-drag-preview")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.kanban-col[data-status="deferred"]')).toHaveClass(
    /dragover/,
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await expect(boardCard(page, "progress", "Сегодняшняя задача")).toBeVisible();
  expect((await storedTask(page, 3)).due).toBe(dateAt(0));
  expect((await storedTask(page, 3)).status).toBe("progress");
});

test("канбан сохраняет перенос при отключённой анимации движения", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Канбан", exact: true }).click();
  await startCardDrag(page, "created", "Сегодняшняя задача");
  const previewMotion = await page
    .locator(".kanban-drag-preview .kanban-card")
    .evaluate((card) => {
      const style = getComputedStyle(card);
      return {
        animationName: style.animationName,
        transitionDuration: style.transitionDuration,
      };
    });
  expect(previewMotion.animationName).toBe("none");
  expect(
    previewMotion.transitionDuration
      .split(",")
      .every((value) => parseFloat(value) === 0),
  ).toBe(true);
  await moveDragToColumn(page, "progress");
  await page.mouse.up();
  await expect(boardCard(page, "progress", "Сегодняшняя задача")).toBeVisible();
  await expect(page.locator(".kanban-drag-preview")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("экспорт и импорт JSON восстанавливают документы и настройки", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Настройки/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Экспорт JSON", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("potom-backup.json");
  const path = await download.path();
  expect(path).toBeTruthy();
  await page.getByRole("button", { name: "Импорт JSON", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Выбрать и восстановить JSON", exact: true })
    .click();
  await (await chooserPromise).setFiles(path!);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Без даты", { exact: true })).toBeVisible();
  expect((await storedTask(page, 1)).notes[0].text).toContain(
    "Исходный документ",
  );
});

test("ошибочный импорт оставляет текущее пространство и показывает ошибку", async ({
  page,
}) => {
  await page.getByRole("button", { name: /Настройки/ }).click();
  await page.getByRole("button", { name: "Импорт JSON", exact: true }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Выбрать и восстановить JSON", exact: true })
    .click();
  await (
    await chooserPromise
  ).setFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{broken"),
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Не удалось прочитать JSON",
  );
  expect((await storedTask(page, 1)).title).toBe("Без даты");
});

test("нативная компоновка сохраняет видимую рабочую область без имитации titlebar", async ({
  page,
}) => {
  await page
    .locator(".app-shell")
    .evaluate((node) => node.classList.add("native-shell"));
  const body = await page.locator(".app-body").boundingBox();
  expect(body?.height).toBeGreaterThan(700);
  await expect(
    page.getByRole("heading", { name: "Мои задачи", exact: true }),
  ).toBeInViewport();
  await expect(page.locator(".titlebar")).toBeHidden();
});
