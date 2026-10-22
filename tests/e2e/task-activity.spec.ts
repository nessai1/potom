import { readFile } from "node:fs/promises";
import { test, expect, type Download, type Page } from "@playwright/test";

const STORAGE_KEY = "potom-ui-v1";
const TASK_TITLE = "Согласовать выпуск планнера";
const LEGACY_MARKDOWN = `# Контекст выпуска

**Важное решение** и ~~устаревший вариант~~.

| Проверка | Результат |
| --- | --- |
| Архив | Сохранён |

\`\`\`ts
const release = "готов";
\`\`\`

[Референс](https://example.com/release)
`;
const legacyNotes = [
  {
    id: 101,
    title: "Документ из предыдущей версии",
    text: LEGACY_MARKDOWN,
    date: "2026-10-20",
  },
  { id: 102, text: "Второе обсуждение задачи.", date: "2026-10-21" },
];

function fixture() {
  return {
    schema: 2,
    projects: [{ id: "activity", name: "Выпуск приложения", color: "#dba4bd" }],
    tasks: [
      {
        id: 1,
        title: TASK_TITLE,
        project: "activity",
        status: "progress",
        due: "",
        priority: "normal",
        description:
          "Подготовить **релиз** и проверить сохранность материалов.",
        checklist: [{ text: "Проверить приложение", done: false }],
        notes: legacyNotes,
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
  await page.getByText(TASK_TITLE, { exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Название задачи", { exact: true }),
  ).toHaveValue(TASK_TITLE);
  return dialog;
}

async function downloadedBytes(download: Download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!);
}

async function removeFile(page: Page, name: string, confirm: boolean) {
  await page
    .getByRole("button", { name: `Удалить файл ${name}`, exact: true })
    .click();
  const confirmation = page.getByRole("dialog").last();
  await expect(
    confirmation.getByRole("heading", { name: "Удалить файл?", exact: true }),
  ).toBeVisible();
  await confirmation
    .getByRole("button", { name: confirm ? "Удалить" : "Отмена", exact: true })
    .click();
}

async function holdAttachmentReaders(page: Page) {
  return page.evaluateHandle(() => {
    const original = FileReader.prototype.readAsDataURL;
    const pending: Array<{ reader: FileReader; blob: Blob }> = [];
    FileReader.prototype.readAsDataURL = function (blob) {
      pending.push({ reader: this, blob });
    };
    return {
      count: () => pending.length,
      release: () => {
        FileReader.prototype.readAsDataURL = original;
        for (const entry of pending.splice(0))
          original.call(entry.reader, entry.blob);
      },
      fail: () => {
        FileReader.prototype.readAsDataURL = original;
        for (const entry of pending.splice(0))
          entry.reader.dispatchEvent(new ProgressEvent("error"));
      },
    };
  });
}

test("старые Markdown-заметки остаются в ленте, черновик не публикуется автоматически", async ({
  page,
}) => {
  let dialog = await openTask(page);
  const comments = dialog.getByRole("list", { name: "Комментарии задачи" });
  await expect(
    comments.getByText(legacyNotes[0].title!, { exact: true }),
  ).toBeVisible();
  await expect(
    comments.getByRole("heading", { name: "Контекст выпуска", exact: true }),
  ).toBeVisible();
  await expect(
    comments.locator("strong").filter({ hasText: "Важное решение" }),
  ).toBeVisible();
  await expect(comments.getByRole("table")).toContainText("Сохранён");
  await expect(comments.locator("pre code")).toHaveText(
    'const release = "готов";\n',
  );
  await expect(
    comments.getByRole("link", { name: "Референс" }),
  ).toHaveAttribute("href", "https://example.com/release");
  await expect(dialog.getByRole("tab")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Скачать Markdown", exact: true }),
  ).toHaveCount(0);
  const draft = "  Черновик без отправки\n\n**Вернуться к нему завтра.**\n";
  await dialog
    .getByRole("textbox", { name: "Комментарий", exact: true })
    .fill(draft);
  await page.keyboard.press("Escape");
  await page.reload();
  dialog = await openTask(page);
  await expect(
    dialog.getByRole("textbox", { name: "Комментарий", exact: true }),
  ).toHaveValue(draft);
  expect((await storedTask(page)).notes).toEqual(legacyNotes);
  expect((await storedTask(page)).commentDraft).toBe(draft);
  await expect(
    dialog.getByRole("list", { name: "Комментарии задачи" }).locator("li"),
  ).toHaveCount(2);
});

test("комментарии отправляются, редактируются и удаляются только после подтверждения", async ({
  page,
}) => {
  let dialog = await openTask(page);
  const original = "**Новый комментарий**\n\nНужно проверить совместимость.";
  await dialog
    .getByRole("textbox", { name: "Комментарий", exact: true })
    .fill(original);
  await dialog
    .getByRole("button", { name: "Отправить комментарий", exact: true })
    .click();
  await expect(
    dialog.getByRole("textbox", { name: "Комментарий", exact: true }),
  ).toHaveValue("");
  await expect.poll(async () => (await storedTask(page)).notes.length).toBe(3);
  const added = (await storedTask(page)).notes.find(
    (note: { text: string }) => note.text === original,
  );
  expect(added).toBeDefined();
  await dialog
    .getByRole("button", {
      name: `Редактировать комментарий ${added.id}`,
      exact: true,
    })
    .click();
  await dialog
    .getByRole("textbox", { name: "Текст комментария", exact: true })
    .fill("Эта правка отменена");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(
    (await storedTask(page)).notes.find(
      (note: { id: number }) => note.id === added.id,
    ).text,
  ).toBe(original);

  const edited = "**Проверено на двух платформах**\n\n- macOS\n- Windows";
  await dialog
    .getByRole("button", {
      name: `Редактировать комментарий ${added.id}`,
      exact: true,
    })
    .click();
  await dialog
    .getByRole("textbox", { name: "Текст комментария", exact: true })
    .fill(edited);
  await dialog
    .getByRole("button", { name: "Сохранить комментарий", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.reload();
  dialog = await openTask(page);
  await expect(
    dialog.getByText("Проверено на двух платформах", { exact: true }),
  ).toBeVisible();
  expect(
    (await storedTask(page)).notes.find(
      (note: { id: number }) => note.id === added.id,
    ).text,
  ).toBe(edited);
  await dialog
    .getByRole("button", {
      name: `Удалить комментарий ${added.id}`,
      exact: true,
    })
    .click();
  let confirmation = page.getByRole("dialog").last();
  await expect(
    confirmation.getByRole("heading", {
      name: "Удалить комментарий?",
      exact: true,
    }),
  ).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  expect((await storedTask(page)).notes).toHaveLength(3);
  await dialog
    .getByRole("button", {
      name: `Удалить комментарий ${added.id}`,
      exact: true,
    })
    .click();
  confirmation = page.getByRole("dialog").last();
  await confirmation
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
  await expect.poll(async () => (await storedTask(page)).notes.length).toBe(2);
  await page.reload();
  dialog = await openTask(page);
  await expect(
    dialog.getByText("Проверено на двух платформах", { exact: true }),
  ).toHaveCount(0);
  expect((await storedTask(page)).notes).toEqual(legacyNotes);
});

test("несколько вложений сохраняют двоичные байты и Unicode-имена после перезапуска", async ({
  page,
}) => {
  let dialog = await openTask(page);
  const files = [
    {
      name: "байты №1.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0, 1, 127, 128, 255, 0, 42]),
    },
    {
      name: "план 🐈.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("План выпуска\nНулевой байт: \0\n", "utf8"),
    },
  ];
  await dialog
    .getByLabel("Прикрепить файлы", { exact: true })
    .setInputFiles(files);
  await expect
    .poll(async () => (await storedTask(page)).attachments?.length)
    .toBe(2);
  const saved = (await storedTask(page)).attachments;
  for (const [index, file] of files.entries()) {
    expect(saved[index]).toMatchObject({
      name: file.name,
      mime: file.mimeType,
      size: file.buffer.length,
    });
    expect(saved[index].id).toMatch(/^[a-f0-9-]{36}$/i);
    expect(Buffer.from(saved[index].data, "base64")).toEqual(file.buffer);
  }
  await page.reload();
  dialog = await openTask(page);
  for (const file of files) {
    const pending = page.waitForEvent("download");
    await dialog
      .getByRole("button", { name: `Скачать файл ${file.name}`, exact: true })
      .click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(file.name);
    expect(await downloadedBytes(download)).toEqual(file.buffer);
  }
  await dialog
    .getByRole("region", { name: "Файлы задачи", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/potom-activity-task-light.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /тёмную тему|Сменить тему/ }).click();
  dialog = await openTask(page);
  await dialog
    .getByRole("region", { name: "Файлы задачи", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({ path: "/tmp/potom-activity-task-dark.png" });
  await removeFile(page, files[0].name, false);
  expect((await storedTask(page)).attachments).toEqual(saved);
  await removeFile(page, files[0].name, true);
  await expect
    .poll(async () => (await storedTask(page)).attachments.length)
    .toBe(1);
  await page.reload();
  dialog = await openTask(page);
  await expect(
    dialog.getByRole("button", {
      name: `Скачать файл ${files[0].name}`,
      exact: true,
    }),
  ).toHaveCount(0);
  expect((await storedTask(page)).attachments).toEqual([saved[1]]);
});

test("перетаскивание добавляет файлы, а превышение лимита отклоняет всю пачку", async ({
  page,
}) => {
  const dialog = await openTask(page);
  const zone = dialog.getByRole("region", {
    name: "Файлы задачи",
    exact: true,
  });
  const valid = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([0, 255, 12, 0])], "перетащенный.bin", {
        type: "application/octet-stream",
      }),
    );
    return transfer;
  });
  await zone.dispatchEvent("dragenter", { dataTransfer: valid });
  await expect(zone).toHaveClass(/is-dragging/);
  await zone.dispatchEvent("dragover", { dataTransfer: valid });
  await zone.dispatchEvent("drop", { dataTransfer: valid });
  await valid.dispose();
  await expect
    .poll(async () => (await storedTask(page)).attachments?.length)
    .toBe(1);
  const before = (await storedTask(page)).attachments;
  expect(Buffer.from(before[0].data, "base64")).toEqual(
    Buffer.from([0, 255, 12, 0]),
  );
  const oversized = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["маленький файл"], "не должен добавиться.txt", {
        type: "text/plain",
      }),
    );
    transfer.items.add(
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "слишком большой.bin", {
        type: "application/octet-stream",
      }),
    );
    return transfer;
  });
  await zone.dispatchEvent("drop", { dataTransfer: oversized });
  await oversized.dispose();
  await expect(dialog.getByRole("alert")).toContainText("больше 10 МБ");
  await expect(
    zone.getByText("не должен добавиться.txt", { exact: true }),
  ).toHaveCount(0);
  expect((await storedTask(page)).attachments).toEqual(before);
  await page.reload();
  await openTask(page);
  expect((await storedTask(page)).attachments).toEqual(before);
});

test("экспорт дожидается чтения файла, импорт возвращает вложения, комментарии и черновик", async ({
  page,
}) => {
  let dialog = await openTask(page);
  const bytes = Buffer.from([0, 255, 0, 128, 17]);
  const name = "договор.bin";
  await dialog
    .getByRole("textbox", { name: "Комментарий", exact: true })
    .fill("Черновик для резервной копии");
  const reader = await page.evaluateHandle(() => {
    const original = FileReader.prototype.readAsDataURL;
    const pending: Array<{ reader: FileReader; blob: Blob }> = [];
    FileReader.prototype.readAsDataURL = function (blob) {
      pending.push({ reader: this, blob });
    };
    return {
      count: () => pending.length,
      release: () => {
        FileReader.prototype.readAsDataURL = original;
        for (const entry of pending.splice(0))
          original.call(entry.reader, entry.blob);
      },
    };
  });
  let archive: Download;
  try {
    await dialog.getByLabel("Прикрепить файлы", { exact: true }).setInputFiles({
      name,
      mimeType: "application/octet-stream",
      buffer: bytes,
    });
    await expect
      .poll(() => reader.evaluate((control) => control.count()))
      .toBe(1);
    await page
      .getByRole("button", { name: "Закрыть задачу", exact: true })
      .click();
    await page.getByRole("button", { name: /Настройки/ }).click();
    const downloads: Download[] = [];
    page.on("download", (download) => downloads.push(download));
    const pending = page.waitForEvent("download");
    const exportButton = page.getByRole("button", {
      name: "Экспорт JSON",
      exact: true,
    });
    await exportButton.click();
    await expect(exportButton).toBeDisabled();
    expect(downloads).toHaveLength(0);
    await reader.evaluate((control) => control.release());
    archive = await pending;
  } finally {
    await reader.evaluate((control) => control.release());
    await reader.dispose();
  }
  const archiveData = JSON.parse(
    (await downloadedBytes(archive!)).toString("utf8"),
  );
  const exported = archiveData.tasks.find(
    (task: { id: number }) => task.id === 1,
  );
  expect(Buffer.from(exported.attachments[0].data, "base64")).toEqual(bytes);
  expect(exported.notes).toEqual(legacyNotes);
  expect(exported.commentDraft).toBe("Черновик для резервной копии");
  await page.keyboard.press("Escape");
  dialog = await openTask(page);
  await removeFile(page, name, true);
  await dialog
    .getByRole("textbox", { name: "Комментарий", exact: true })
    .fill("Лишний комментарий после экспорта");
  await dialog
    .getByRole("button", { name: "Отправить комментарий", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await storedTask(page)).attachments.length)
    .toBe(0);
  await page.getByRole("button", { name: /Настройки/ }).click();
  await page.getByRole("button", { name: "Импорт JSON", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "Выбрать и восстановить JSON", exact: true })
    .click();
  await (await chooser).setFiles((await archive!.path())!);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => storedTask(page)).toEqual(exported);
  await page.reload();
  dialog = await openTask(page);
  await expect(
    dialog.getByRole("textbox", { name: "Комментарий", exact: true }),
  ).toHaveValue(exported.commentDraft);
  const pendingDownload = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: `Скачать файл ${name}`, exact: true })
    .click();
  expect(await downloadedBytes(await pendingDownload)).toEqual(bytes);
});

test("завершившееся чтение не прикрепляет файл к новой задаче с повторно использованным ID", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dialog = await openTask(page);
  const reader = await holdAttachmentReaders(page);
  const newTitle = "Новая задача вместо удалённой";
  try {
    await dialog.getByLabel("Прикрепить файлы", { exact: true }).setInputFiles({
      name: "файл удалённой задачи.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0, 255, 19]),
    });
    await expect
      .poll(() => reader.evaluate((control) => control.count()))
      .toBe(1);
    await page
      .getByRole("button", { name: "Закрыть задачу", exact: true })
      .click();
    await openTask(page);
    await page
      .getByRole("button", { name: "Действия с задачей", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: "Удалить задачу", exact: true })
      .click();
    const confirmation = page.getByRole("dialog").last();
    await expect(
      confirmation.getByRole("heading", {
        name: "Удалить задачу?",
        exact: true,
      }),
    ).toBeVisible();
    await confirmation
      .getByRole("button", { name: "Удалить задачу", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Новая задача", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Название задачи", { exact: true })
      .fill(newTitle);
    await page
      .getByRole("button", { name: "Создать задачу", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByLabel("Название задачи", { exact: true }),
    ).toHaveValue(newTitle);
    await page
      .getByRole("button", { name: "Закрыть задачу", exact: true })
      .click();
    await expect
      .poll(async () => (await storedTask(page))?.title)
      .toBe(newTitle);
    expect((await storedTask(page)).id).toBe(1);
    await reader.evaluate((control) => control.release());
    const notice = page.locator(".toast.show");
    await expect(notice).toContainText("Файлы не прикреплены");
    await expect(notice).toContainText("Пространство изменилось");
    expect((await storedTask(page)).attachments ?? []).toEqual([]);
  } finally {
    await reader.evaluate((control) => control.release());
    await reader.dispose();
  }
  await page.reload();
  await expect(page.getByText(newTitle, { exact: true })).toBeVisible();
  expect((await storedTask(page)).title).toBe(newTitle);
  expect((await storedTask(page)).attachments ?? []).toEqual([]);
  expect(errors).toEqual([]);
});

test("ошибка чтения после закрытия задачи видна в основном окне и сохраняет старые файлы", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const dialog = await openTask(page);
  await dialog.getByLabel("Прикрепить файлы", { exact: true }).setInputFiles({
    name: "сохранённый.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([0, 255, 111]),
  });
  await expect
    .poll(async () => (await storedTask(page)).attachments?.length)
    .toBe(1);
  const before = (await storedTask(page)).attachments;
  const reader = await holdAttachmentReaders(page);
  const failedName = "ошибка чтения.bin";
  try {
    await dialog.getByLabel("Прикрепить файлы", { exact: true }).setInputFiles({
      name: failedName,
      mimeType: "application/octet-stream",
      buffer: Buffer.from([0, 1, 2, 255]),
    });
    await expect
      .poll(() => reader.evaluate((control) => control.count()))
      .toBe(1);
    await page
      .getByRole("button", { name: "Закрыть задачу", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await reader.evaluate((control) => control.fail());
    const notice = page.locator(".toast.show");
    await expect(notice).toContainText("Файлы не прикреплены");
    await expect(notice).toContainText("Не удалось прочитать");
    await expect(notice).toContainText(failedName);
    await expect(
      page.getByRole("heading", { name: "Мои задачи", exact: true }),
    ).toBeVisible();
    expect((await storedTask(page)).attachments).toEqual(before);
  } finally {
    await reader.evaluate((control) => control.release());
    await reader.dispose();
  }
  await page.reload();
  const reopened = await openTask(page);
  await expect(
    reopened.getByRole("button", {
      name: "Скачать файл сохранённый.bin",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    reopened.getByRole("button", {
      name: `Скачать файл ${failedName}`,
      exact: true,
    }),
  ).toHaveCount(0);
  expect((await storedTask(page)).attachments).toEqual(before);
  expect(errors).toEqual([]);
});

test("градиент виден в обеих темах, кот проходит 110 разных фраз без мата", async ({
  page,
}) => {
  const main = page.getByRole("main");
  async function expectMovingGradient() {
    const positions = await main.evaluate((node) => {
      const animation = node.getAnimations()[0];
      if (!animation) return null;
      animation.pause();
      animation.currentTime = 0;
      const from = getComputedStyle(node).backgroundPosition;
      animation.currentTime = 13_000;
      const to = getComputedStyle(node).backgroundPosition;
      return { from, to };
    });
    expect(positions).not.toBeNull();
    expect(positions!.to).not.toBe(positions!.from);
  }
  await expect(main).toHaveCSS("background-image", /radial-gradient/);
  await expectMovingGradient();
  const light = await main.evaluate(
    (node) => getComputedStyle(node).backgroundImage,
  );
  await page.screenshot({ path: "/tmp/potom-activity-main-light.png" });
  await page.getByRole("button", { name: /тёмную тему|Сменить тему/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(main).toHaveCSS("background-image", /radial-gradient/);
  const dark = await main.evaluate(
    (node) => getComputedStyle(node).backgroundImage,
  );
  expect(dark).not.toBe(light);
  await expectMovingGradient();
  await page.screenshot({ path: "/tmp/potom-activity-main-dark.png" });
  await expect(page.locator("html")).toHaveAttribute(
    "data-clean-language",
    "true",
  );
  const cat = page.getByTitle("Потыкать кота", { exact: true });
  const bubble = cat.locator(".cat-bubble");
  const first = await bubble.innerText();
  const phrases: string[] = [];
  for (let index = 0; index < 110; index++) {
    const text = await bubble.innerText();
    expect(text.trim()).not.toBe("");
    expect(text).not.toMatch(
      /пизд|бляд|сука|охуе|заеб|[её]бан|херн|жоп|сран/iu,
    );
    phrases.push(text);
    await cat.click();
  }
  expect(new Set(phrases).size).toBe(110);
  await expect(bubble).toHaveText(first);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(main).toHaveCSS("animation-name", "none");
});
