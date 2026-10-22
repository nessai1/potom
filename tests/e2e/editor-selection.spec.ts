import { expect, test, type Locator } from "@playwright/test";

const fixture = {
  schema: 2,
  projects: [{ id: "editor", name: "Редактор", color: "#dba4bd" }],
  tasks: [
    {
      id: 1,
      title: "Проверка каретки",
      project: "editor",
      status: "created",
      due: "",
      priority: "normal",
      description: "one two three",
      checklist: [],
      notes: [{ id: 2, text: "one two three", date: "2026-10-17" }],
      created: "2026-10-17",
    },
  ],
  unlocked: [],
  metrics: {},
  settings: { theme: "light", cleanLanguage: true },
};

async function selectFirstWord(editor: Locator) {
  await editor.evaluate((element) => {
    const text = element.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript((data) => {
    localStorage.setItem("potom-ui-v1", JSON.stringify(data));
  }, fixture);
  await page.goto("/");
  await page.getByText("Проверка каретки", { exact: true }).click();
});

test("после старого выделения Ctrl+B форматирует текст у текущей каретки", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Описание задачи",
    exact: true,
  });
  await editor.focus();
  await selectFirstWord(editor);
  await expect(
    page.getByRole("toolbar", { name: "Форматирование текста" }),
  ).toBeVisible();
  await editor.evaluate((element) => {
    const text = element.querySelector("p")!.firstChild!;
    const caret = document.createRange();
    caret.setStart(text, text.textContent!.length);
    caret.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(caret);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(
    page.getByRole("toolbar", { name: "Форматирование текста" }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+b");
  await page.keyboard.type("X");
  await expect(editor).toHaveText("one two threeX");
  await expect(editor.locator("strong,b")).toHaveText("X");
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("potom-ui-v1")!).tasks[0].description,
      ),
    )
    .toBe("one two three**X**");
});

test("изменение комментария сохраняет буквальный Markdown без окна документов", async ({
  page,
}) => {
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("tab", { name: /Заметки/ })).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Редактировать комментарий 2", exact: true })
    .click();
  const source = dialog.getByRole("textbox", {
    name: "Текст комментария",
    exact: true,
  });
  await source.focus();
  await source.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, 3);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await source.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(element.value.length, element.value.length);
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page.keyboard.type("**X**");
  await expect(source).toHaveValue("one two three**X**");
  await dialog
    .getByRole("button", { name: "Сохранить комментарий", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("potom-ui-v1")!).tasks[0].notes[0]
            .text,
      ),
    )
    .toBe("one two three**X**");
});
