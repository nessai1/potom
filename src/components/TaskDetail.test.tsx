import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import type { Task, TaskDetailProps } from "../types";
import TaskDetail from "./TaskDetail";
import { chronologicalComments } from "./TaskComments";
import { downloadAttachment } from "../lib/attachments";

vi.mock("../lib/storage", () => ({
  openExternal: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/attachments", () => ({
  downloadAttachment: vi.fn().mockResolvedValue("download.txt"),
  formatFileSize: (size: number) => `${size} Б`,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const baseTask = (fields: Partial<Task> = {}): Task => ({
  id: 1,
  title: "Проверить задачу",
  project: "test",
  status: "created",
  due: "",
  priority: "normal",
  description: "Описание **задачи**",
  checklist: [{ text: "Сделать", done: false }],
  notes: [],
  created: "2026-10-22",
  ...fields,
});

function mountTask(initial: Task, overrides: Partial<TaskDetailProps> = {}) {
  let latest = initial;
  const onEvent = vi.fn();
  const onClose = vi.fn();
  const onAddAttachments = vi.fn().mockResolvedValue(undefined);
  function Harness() {
    const [task, setTask] = useState(initial);
    const [open, setOpen] = useState(true);
    latest = task;
    return open ? (
      <TaskDetail
        task={task}
        projects={[{ id: "test", name: "Работа", color: "#dba4bd" }]}
        cleanLanguage
        saveState="saved"
        onUpdate={(_id, update) =>
          setTask((current) => {
            const next = update(current);
            latest = next;
            return next;
          })
        }
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onEvent={onEvent}
        onAddAttachments={onAddAttachments}
        {...overrides}
      />
    ) : null;
  }
  render(<Harness />);
  return { task: () => latest, onEvent, onClose, onAddAttachments };
}

describe("комментарии вместо документов", () => {
  it("показывает старые заметки полностью, сохраняя заголовок и хронологию", () => {
    const notes = [
      {
        id: 2,
        date: "2026-10-22",
        title: "Старый заголовок",
        text: "## Позднее\n\nПолный **текст**\n\n- первый\n- второй",
      },
      { id: 1, date: "2026-10-20", text: "Ранний комментарий" },
    ];
    const h = mountTask(baseTask({ notes }));
    const comments = Array.from(
      document.querySelectorAll(".task-comment-content"),
    );
    expect(comments[0].textContent).toContain("Ранний комментарий");
    expect(comments[1].textContent).toContain("Старый заголовок");
    expect(screen.getByText("Позднее").tagName).toBe("H2");
    expect(screen.getByText("текст").tagName).toBe("STRONG");
    expect(screen.getByText("второй")).toBeTruthy();
    expect(h.task().notes).toEqual(notes);
    expect(screen.queryByRole("tab", { name: /Заметки/ })).toBeNull();
    expect(document.querySelector(".notes-workspace")).toBeNull();
    expect(screen.queryByLabelText("Скачать Markdown")).toBeNull();
  });

  it("сохраняет черновик при закрытии, не публикуя комментарий", () => {
    const h = mountTask(baseTask());
    fireEvent.change(screen.getByLabelText("Комментарий", { exact: true }), {
      target: { value: "Ещё не отправлено\n\n**Черновик**" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Закрыть задачу" }));
    expect(h.onClose).toHaveBeenCalledOnce();
    expect(h.task().commentDraft).toBe("Ещё не отправлено\n\n**Черновик**");
    expect(h.task().notes).toEqual([]);
    expect(h.onEvent).not.toHaveBeenCalledWith("note");
    const saved = h.task();
    cleanup();
    mountTask(saved);
    expect(
      (
        screen.getByLabelText("Комментарий", {
          exact: true,
        }) as HTMLTextAreaElement
      ).value,
    ).toBe(saved.commentDraft);
  });

  it("публикует Markdown только по отправке и очищает черновик", () => {
    const h = mountTask(baseTask());
    const text = "**Смело**\n\n- уточнить\n- согласовать  ";
    fireEvent.change(screen.getByLabelText("Комментарий", { exact: true }), {
      target: { value: text },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Отправить комментарий" }),
    );
    expect(h.task().notes).toHaveLength(1);
    expect(h.task().notes[0].text).toBe(text);
    expect(h.task().commentDraft).toBe("");
    expect(h.onEvent).toHaveBeenCalledWith("note");
    expect(screen.getByText("Смело").tagName).toBe("STRONG");
  });

  it("редактирует комментарий по явному сохранению, удаляет с подтверждением", () => {
    const h = mountTask(
      baseTask({
        notes: [
          {
            id: 7,
            text: "Старый текст",
            title: "Заголовок из архива",
            date: "2026-10-20",
          },
        ],
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Редактировать комментарий 7" }),
    );
    fireEvent.change(screen.getByLabelText("Текст комментария"), {
      target: { value: "Новый **контекст**" },
    });
    expect(h.task().notes[0].text).toBe("Старый текст");
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить комментарий" }),
    );
    expect(h.task().notes[0]).toEqual({
      id: 7,
      text: "Новый **контекст**",
      title: "Заголовок из архива",
      date: "2026-10-20",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Удалить комментарий 7" }),
    );
    expect(h.task().notes).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "Удалить комментарий?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(h.task().notes).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Удалить комментарий 7" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Удалить$/ }));
    expect(h.task().notes).toEqual([]);
  });

  it("очищает опасный HTML в старых комментариях и не переставляет одинаковые даты", () => {
    const notes = [
      {
        id: 9,
        date: "2026-10-22",
        text: '<img src="x" onerror="alert(1)"><script>alert(2)</script>\n\n[опасно](javascript:alert(3))',
      },
      { id: 1, date: "2026-10-22", text: "Второй" },
    ];
    mountTask(baseTask({ notes }));
    expect(document.querySelector(".comment-markdown script")).toBeNull();
    expect(document.querySelector(".comment-markdown [onerror]")).toBeNull();
    expect(
      document.querySelector('.comment-markdown a[href^="javascript:"]'),
    ).toBeNull();
    expect(chronologicalComments(notes).map((note) => note.id)).toEqual([9, 1]);
  });
});

describe("файлы задачи", () => {
  const attachment = {
    id: "file-1",
    name: "brief.txt",
    size: 3,
    mime: "text/plain",
    data: "YWJj",
    added: "2026-10-22",
  };
  it("отправляет выбранные файлы, показывает ошибку и позволяет повторить", async () => {
    const add = vi
      .fn()
      .mockRejectedValueOnce(new Error("Диск заполнен"))
      .mockResolvedValueOnce(undefined);
    mountTask(baseTask(), { onAddAttachments: add });
    const first = new File(["hello"], "hello.txt", { type: "text/plain" });
    const second = new File(["second"], "second.txt");
    fireEvent.change(screen.getByLabelText("Прикрепить файлы"), {
      target: { files: [first, second] },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Диск заполнен"),
    );
    expect(add).toHaveBeenCalledWith(1, [first, second]);
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("не читает файл больше 10 МБ и не перехватывает текстовое перетаскивание", async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    mountTask(baseTask(), { onAddAttachments: add });
    const oversized = new File([], "huge.bin");
    Object.defineProperty(oversized, "size", { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(screen.getByLabelText("Прикрепить файлы"), {
      target: { files: [oversized] },
    });
    expect(screen.getByRole("alert").textContent).toContain("больше 10 МБ");
    expect(add).not.toHaveBeenCalled();
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { types: ["text/plain"], files: [] },
    });
    fireEvent(screen.getByRole("region", { name: "Файлы задачи" }), drop);
    expect(drop.defaultPrevented).toBe(false);
  });

  it("скачивает вложение и удаляет только после подтверждения", async () => {
    const h = mountTask(baseTask({ attachments: [attachment] }));
    expect(screen.getByText("3 Б")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Скачать файл brief.txt" }),
    );
    await waitFor(() =>
      expect(downloadAttachment).toHaveBeenCalledWith(attachment),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Удалить файл brief.txt" }),
    );
    expect(h.task().attachments).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Удалить файл?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Удалить$/ }));
    expect(h.task().attachments).toEqual([]);
  });
});
