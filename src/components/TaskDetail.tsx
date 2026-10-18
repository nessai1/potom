import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileText,
  List,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type {
  ChecklistItem,
  Priority,
  Status,
  TaskDetailProps,
  TaskNote,
} from "../types";
import { exportMarkdown } from "../lib/storage";
import Dialog, { useModalFocus } from "./Dialog";
import MarkdownEditor, {
  markdownToHtml,
  type MarkdownEditorHandle,
} from "./MarkdownEditor";

const statusNames: Record<Status, string> = {
  created: "Создана",
  progress: "Выполняется",
  deferred: "Отложено",
  done: "Выполнено",
};
const statusColors: Record<Status, string> = {
  created: "gray",
  progress: "pink",
  deferred: "yellow",
  done: "green",
};
const dateFormat = new Intl.DateTimeFormat("ru", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
function shortDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}
function dayWord(value: number) {
  const n = Math.abs(value) % 100;
  return n >= 11 && n <= 14
    ? "дней"
    : n % 10 === 1
      ? "день"
      : n % 10 >= 2 && n % 10 <= 4
        ? "дня"
        : "дней";
}
function renderedHeadings(text: string, selector: string) {
  const root = document.createElement("div");
  root.innerHTML = markdownToHtml(text);
  return Array.from(root.querySelectorAll(selector)).map((heading) => ({
    level: Number(heading.tagName.slice(1)),
    text: heading.textContent || "Без названия",
  }));
}
export function noteOutline(text: string) {
  return renderedHeadings(text, "h1,h2,h3");
}
export function noteTitle(note: TaskNote) {
  return (
    note.title ||
    renderedHeadings(note.text, "h1,h2,h3,h4,h5,h6")[0]?.text ||
    note.text
      .replace(/[*_`#]/g, "")
      .split("\n")
      .find((line) => line.trim())
      ?.slice(0, 42) ||
    "Без названия"
  );
}
export function wordCount(value: string) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function ChecklistRow({
  item,
  index,
  onText,
  onToggle,
  onDelete,
}: {
  item: ChecklistItem;
  index: number;
  onText: (index: number, value: string) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(item.text);
  const ref = useRef({ text, original: item.text, index, onText });
  ref.current = { text, original: item.text, index, onText };
  useEffect(() => {
    setText(item.text);
  }, [item.text]);
  const commit = () => {
    const current = ref.current;
    const value = current.text.trim();
    if (value && value !== current.original)
      current.onText(current.index, value);
    else if (!value) setText(current.original);
  };
  useEffect(() => {
    document.addEventListener("potom:flush-editors", commit);
    return () => document.removeEventListener("potom:flush-editors", commit);
  }, []);
  return (
    <div className={`checklist-line ${item.done ? "checked" : ""}`}>
      <button
        className={`checkbox ${item.done ? "checked" : ""}`}
        role="checkbox"
        aria-checked={item.done}
        aria-label={item.text}
        onClick={onToggle}
      >
        {item.done && <Check className="icon" />}
      </button>
      <input
        className="checklist-text-input"
        aria-label={`Пункт чеклиста ${index + 1}`}
        value={text}
        maxLength={500}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <button
        className="icon-btn remove-check"
        aria-label={`Удалить пункт «${item.text}»`}
        onClick={onDelete}
      >
        <X className="icon" />
      </button>
    </div>
  );
}

export default function TaskDetail({
  task,
  projects,
  cleanLanguage,
  saveState,
  onUpdate,
  onClose,
  onDuplicate,
  onDelete,
  onEvent,
}: TaskDetailProps) {
  const [tab, setTab] = useState<"overview" | "notes">("overview");
  const [selectedNote, setSelectedNote] = useState<number | null>(
    task.notes[0]?.id ?? null,
  );
  const [source, setSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [menu, setMenu] = useState<"task" | "note" | null>(null);
  const [confirm, setConfirm] = useState<"task" | "note" | null>(null);
  const [addChecklist, setAddChecklist] = useState(false);
  const [checkText, setCheckText] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);
  const editor = useRef<MarkdownEditorHandle>(null);
  const modal = useRef<HTMLDivElement>(null);
  const titleElement = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const props = useRef({ task, onUpdate, onClose });
  props.current = { task, onUpdate, onClose };
  const flush = useCallback(() => {
    document.dispatchEvent(new Event("potom:flush-editors"));
    return editor.current?.flush();
  }, []);
  const close = useCallback(() => {
    document.dispatchEvent(new Event("potom:flush-editors"));
    props.current.onClose();
  }, []);
  useModalFocus(modal, close);

  useEffect(() => {
    setTitle(task.title);
  }, [task.title]);
  useEffect(() => {
    setTab("overview");
    setSelectedNote(task.notes[0]?.id ?? null);
    setSource(false);
    setFullscreen(false);
    setNotice("");
  }, [task.id]);
  useEffect(() => {
    if (titleElement.current) {
      titleElement.current.style.height = "auto";
      titleElement.current.style.height = `${titleElement.current.scrollHeight}px`;
    }
  }, [title, tab]);

  const project =
    projects.find((value) => value.id === task.project) ?? projects[0];
  const note =
    task.notes.find((value) => value.id === selectedNote) ?? task.notes[0];
  const outline = note ? noteOutline(note.text) : [];
  const finished = task.checklist.filter((item) => item.done).length;
  const percent = task.checklist.length
    ? Math.round((finished / task.checklist.length) * 100)
    : 0;
  const days = task.due
    ? Math.round(
        (new Date(`${task.due}T12:00:00`).getTime() -
          new Date(`${today()}T12:00:00`).getTime()) /
          86400000,
      )
    : null;
  const deadlineTitle =
    days === null
      ? "Срока нет"
      : task.status === "done"
        ? "Выполнено"
        : days < 0
          ? `Просрочено на ${Math.abs(days)} ${dayWord(days)}`
          : days === 0
            ? "Дедлайн сегодня"
            : `Осталось ${days} ${dayWord(days)}`;
  const deadlineText =
    days === null
      ? "Дата не назначена. Хрустальный шар тоже."
      : task.status === "done"
        ? "Эту задачу уже можно не носить в голове."
        : days < 0
          ? "Задача уже не горит. Она обуглилась."
          : days === 0
            ? cleanLanguage
              ? "Пора собраться и закончить."
              : "«Успею» — тоже стратегия. Хреновая, но стратегия."
            : "Пока это срок, а не причина дёргаться.";
  const savedLabel =
    editorDirty || saveState === "saving"
      ? "Сохраняем…"
      : saveState === "error"
        ? "Ошибка сохранения"
        : saveState === "loading"
          ? "Загрузка…"
          : "Сохранено";

  function changeTab(value: "overview" | "notes") {
    flush();
    setTab(value);
    setNotice("");
  }
  function update(fields: Partial<typeof task>) {
    onUpdate(task.id, (current) => ({ ...current, ...fields }));
  }
  function createNote() {
    flush();
    const id = Math.max(Date.now(), ...task.notes.map((value) => value.id + 1));
    const newNote = { id, text: "# Новая заметка\n\n", date: today() };
    onUpdate(task.id, (current) => ({
      ...current,
      notes: [...current.notes, newNote],
    }));
    onEvent("note");
    setSelectedNote(id);
    setSource(false);
    setTab("notes");
    setNotice("");
  }
  function updateNote(id: number, text: string) {
    onUpdate(task.id, (current) => ({
      ...current,
      notes: current.notes.map((value) =>
        value.id === id ? { ...value, text, title: undefined } : value,
      ),
    }));
  }
  function openNotes() {
    if (!task.notes.length) createNote();
    else changeTab("notes");
  }
  function copyNote() {
    const text = flush();
    if (!note) return;
    const id = Math.max(Date.now(), ...task.notes.map((value) => value.id + 1));
    onUpdate(task.id, (current) => ({
      ...current,
      notes: [
        ...current.notes,
        {
          ...(current.notes.find((value) => value.id === note.id) ?? note),
          text: text ?? note.text,
          id,
          date: today(),
          title: undefined,
        },
      ],
    }));
    onEvent("note");
    setSelectedNote(id);
    setSource(false);
    setMenu(null);
    setNotice("Копия документа создана.");
  }
  function deleteNote() {
    if (!note) return;
    flush();
    onUpdate(task.id, (current) => ({
      ...current,
      notes: current.notes.filter((value) => value.id !== note.id),
    }));
    setSelectedNote(
      task.notes.find((value) => value.id !== note.id)?.id ?? null,
    );
    setSource(false);
    setConfirm(null);
    setMenu(null);
  }
  async function downloadNote() {
    if (!note || exporting) return;
    const text = flush() ?? note.text;
    setExporting(true);
    setNotice("");
    try {
      const path = await exportMarkdown(
        noteTitle({ ...note, text }).replace(/[/\\:*?"<>|]/g, "-") + ".md",
        text,
      );
      setNotice(path ? "Документ сохранён в Markdown." : "Экспорт отменён.");
    } catch (error) {
      setNotice(`Не удалось экспортировать документ: ${String(error)}`);
    } finally {
      setExporting(false);
    }
  }
  function scrollToHeading(index: number) {
    flush();
    if (source) {
      setSource(false);
      requestAnimationFrame(() => editor.current?.scrollToHeading(index));
    } else editor.current?.scrollToHeading(index);
  }

  return createPortal(
    <div
      className="task-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        className={`task-dialog ${fullscreen ? "fullscreen" : ""}`}
        ref={modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 className="sr-only" id={titleId}>
          {task.title}
        </h2>
        <div className="task-dialog-header">
          <div className="task-path">
            <span
              className="project-dot"
              style={{ background: project?.color ?? "#b691a2" }}
            />
            {project?.name ?? "Без проекта"}
            <span>/</span>
            <strong>PT–{String(task.id).padStart(3, "0")}</strong>
          </div>
          <div className="task-header-actions">
            <button
              className="icon-btn"
              aria-label="Действия с задачей"
              onClick={() => {
                flush();
                setMenu("task");
              }}
            >
              <MoreHorizontal className="icon" />
            </button>
            <button
              className="icon-btn"
              aria-label={fullscreen ? "Свернуть окно" : "Развернуть окно"}
              onClick={() => {
                flush();
                setFullscreen((value) => !value);
              }}
            >
              {fullscreen ? (
                <Minimize2 className="icon" />
              ) : (
                <Maximize2 className="icon" />
              )}
            </button>
            <button
              className="icon-btn"
              data-autofocus
              aria-label="Закрыть задачу"
              onClick={close}
            >
              <X className="icon" />
            </button>
          </div>
        </div>
        <div
          className="task-dialog-tabs"
          role="tablist"
          aria-label="Раздел задачи"
        >
          <button
            className={`task-tab ${tab === "overview" ? "active" : ""}`}
            role="tab"
            aria-selected={tab === "overview"}
            onClick={() => changeTab("overview")}
          >
            <List className="icon" />
            Задача
          </button>
          <button
            className={`task-tab ${tab === "notes" ? "active" : ""}`}
            role="tab"
            aria-selected={tab === "notes"}
            onClick={() => changeTab("notes")}
          >
            <FileText className="icon" />
            Заметки <small>{task.notes.length}</small>
          </button>
          <span
            className={`task-save-indicator ${saveState === "error" ? "save-error" : ""}`}
            role="status"
          >
            <span className="online-dot" />
            {savedLabel}
          </span>
        </div>
        <div className="task-dialog-body">
          {tab === "overview" ? (
            <div className="task-overview">
              <div className="task-main-content">
                <div className="task-kicker">
                  <span className={`badge ${statusColors[task.status]}`}>
                    <span className="status-dot" />
                    {statusNames[task.status]}
                  </span>
                  <span className="task-id">
                    PT–{String(task.id).padStart(3, "0")}
                  </span>
                </div>
                <textarea
                  ref={titleElement}
                  className="task-title-input"
                  aria-label="Название задачи"
                  maxLength={160}
                  rows={1}
                  value={title}
                  onChange={(event) => {
                    const value = event.target.value;
                    setTitle(value);
                    if (value.trim()) update({ title: value.trim() });
                  }}
                  onBlur={() => {
                    if (!title.trim()) setTitle(task.title);
                  }}
                />
                <section className="task-section">
                  <div className="task-section-heading">
                    <h3>Описание</h3>
                    <small>Выдели текст — появится форматирование</small>
                  </div>
                  <MarkdownEditor
                    key={`description-${task.id}`}
                    ref={editor}
                    value={task.description}
                    label="Описание задачи"
                    description
                    placeholder={
                      cleanLanguage
                        ? "Что нужно сделать?"
                        : "Что нужно сделать и какого чёрта это опять срочно?"
                    }
                    onChange={(value) =>
                      onUpdate(task.id, (current) => ({
                        ...current,
                        description: value,
                      }))
                    }
                    onBold={() => onEvent("bold")}
                    onDirtyChange={setEditorDirty}
                  />
                </section>
                <section className="task-section">
                  <div className="task-section-heading">
                    <h3>Чеклист</h3>
                    <small>
                      {finished} из {task.checklist.length} · {percent}%
                    </small>
                  </div>
                  <div className="checklist-progress">
                    <div
                      className="progress-track"
                      role="progressbar"
                      aria-label="Прогресс чеклиста"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                    >
                      <div
                        className={`progress-fill ${percent === 100 ? "complete" : ""}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                  <div className="checklist-items">
                    {task.checklist.map((item, index) => (
                      <ChecklistRow
                        key={index}
                        item={item}
                        index={index}
                        onText={(itemIndex, text) =>
                          onUpdate(task.id, (current) => ({
                            ...current,
                            checklist: current.checklist.map((value, i) =>
                              i === itemIndex ? { ...value, text } : value,
                            ),
                          }))
                        }
                        onToggle={() => {
                          flush();
                          onUpdate(task.id, (current) => ({
                            ...current,
                            checklist: current.checklist.map((value, i) =>
                              i === index
                                ? {
                                    ...value,
                                    done: !value.done,
                                    wasUnchecked:
                                      value.done || value.wasUnchecked,
                                  }
                                : value,
                            ),
                          }));
                        }}
                        onDelete={() => {
                          flush();
                          onUpdate(task.id, (current) => ({
                            ...current,
                            checklist: current.checklist.filter(
                              (_, i) => i !== index,
                            ),
                          }));
                        }}
                      />
                    ))}
                  </div>
                  <button
                    className="checklist-add"
                    onClick={() => {
                      flush();
                      setCheckText("");
                      setAddChecklist(true);
                    }}
                  >
                    <Plus className="icon" />
                    Добавить пункт
                  </button>
                </section>
                <section className="task-section">
                  <div className="task-section-heading">
                    <h3>Заметки и документы</h3>
                    <small>{task.notes.length} документов</small>
                  </div>
                  <button
                    className="task-note-preview editor-note-preview"
                    onClick={openNotes}
                  >
                    <FileText className="icon" />
                    <span>
                      <strong>
                        {task.notes.length
                          ? noteTitle(task.notes[0])
                          : "Записать, пока помнишь"}
                      </strong>
                      <small>
                        {task.notes.length
                          ? `${wordCount(task.notes[0].text)} слов · открыть документ`
                          : "Полноценный документ, без лимита на мысли"}
                      </small>
                    </span>
                    <ChevronRight className="icon" />
                  </button>
                </section>
              </div>
              <aside className="task-sidebar">
                <div
                  className={`task-deadline-card ${days === null ? "no-deadline" : task.status === "done" ? "done" : days < 0 ? "overdue" : ""}`}
                >
                  {days === null ? (
                    <Calendar className="icon" />
                  ) : (
                    <Clock className="icon" />
                  )}
                  <h3>{deadlineTitle}</h3>
                  <p>{deadlineText}</p>
                </div>
                <div className="task-property">
                  <label
                    className="task-property-label"
                    htmlFor="detail-status"
                  >
                    Статус
                  </label>
                  <select
                    className="task-property-control"
                    id="detail-status"
                    value={task.status}
                    onChange={(event) => {
                      flush();
                      update({ status: event.target.value as Status });
                    }}
                  >
                    {Object.entries(statusNames).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="task-property">
                  <label className="task-property-label" htmlFor="detail-date">
                    Крайний срок
                  </label>
                  <div className="task-date-control">
                    <input
                      className="task-property-control"
                      type="date"
                      id="detail-date"
                      value={task.due}
                      onChange={(event) => {
                        flush();
                        update({ due: event.target.value });
                      }}
                    />
                    {task.due && (
                      <button
                        className="icon-btn"
                        aria-label="Убрать срок"
                        onClick={() => {
                          flush();
                          update({ due: "" });
                        }}
                      >
                        <X className="icon" />
                      </button>
                    )}
                  </div>
                  {!task.due && (
                    <span className="task-no-date-label">Срока нет</span>
                  )}
                </div>
                <div className="task-property">
                  <label
                    className="task-property-label"
                    htmlFor="detail-priority"
                  >
                    Приоритет
                  </label>
                  <select
                    className="task-property-control"
                    id="detail-priority"
                    value={task.priority}
                    onChange={(event) =>
                      update({ priority: event.target.value as Priority })
                    }
                  >
                    <option value="high">↗ Высокий</option>
                    <option value="normal">→ Обычный</option>
                    <option value="low">↘ Низкий</option>
                  </select>
                </div>
                <div className="task-property">
                  <label
                    className="task-property-label"
                    htmlFor="detail-project"
                  >
                    Проект
                  </label>
                  <select
                    className="task-property-control"
                    id="detail-project"
                    value={task.project}
                    onChange={(event) => {
                      flush();
                      update({ project: event.target.value });
                    }}
                  >
                    {projects.map((value) => (
                      <option key={value.id} value={value.id}>
                        {value.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="task-property">
                  <span className="task-property-label">Создана</span>
                  <span className="task-created-date">
                    {shortDate(task.created)}
                  </span>
                </div>
                <div className="task-sidebar-footer task-cat-card">
                  <img src="/assets/cat-maine-coon.png" alt="" />
                  <p>
                    «Там на пять минут».
                    <br />
                    {cleanLanguage
                      ? "Мяу, ну конечно."
                      : "Мяу, блядь, конечно."}
                  </p>
                </div>
                <button
                  className={`task-complete-button ${task.status === "done" ? "completed" : ""}`}
                  onClick={() => {
                    flush();
                    update({
                      status: task.status === "done" ? "created" : "done",
                    });
                  }}
                >
                  {task.status === "done" ? (
                    <RotateCcw className="icon" />
                  ) : (
                    <Check className="icon" />
                  )}
                  {task.status === "done"
                    ? "Вернуть в задачи"
                    : cleanLanguage
                      ? "Выполнено. Можно выдохнуть."
                      : "Выполнено. Слава богу."}
                </button>
              </aside>
            </div>
          ) : (
            <div className="notes-workspace">
              <aside className="notes-rail">
                <div className="notes-rail-header">
                  <span>Документы</span>
                  <button
                    className="icon-btn"
                    aria-label="Новый документ"
                    onClick={createNote}
                  >
                    <Plus className="icon" />
                  </button>
                </div>
                {task.notes.map((value) => (
                  <button
                    key={value.id}
                    className={`note-document-item ${value.id === note?.id ? "active" : ""}`}
                    onClick={() => {
                      flush();
                      setSelectedNote(value.id);
                      setSource(false);
                      setNotice("");
                    }}
                  >
                    <FileText className="icon" />
                    <span>
                      <strong>{noteTitle(value)}</strong>
                      <small>
                        {wordCount(value.text)} слов · {shortDate(value.date)}
                      </small>
                    </span>
                  </button>
                ))}
                {note && (
                  <div className="document-outline">
                    <span>В этом документе</span>
                    {outline.map((heading, index) => (
                      <button
                        key={index}
                        className={`outline-item level-${heading.level}`}
                        onClick={() => scrollToHeading(index)}
                      >
                        {heading.text}
                      </button>
                    ))}
                    {!outline.length && (
                      <p>Добавь заголовки — появится оглавление.</p>
                    )}
                  </div>
                )}
                <div className="notes-rail-bottom">
                  <img
                    className="note-syngonium"
                    src="/assets/plant-syngonium.png"
                    alt="Розовый сингониум"
                  />
                  Память — так себе база данных.
                  <br />
                  Зато тут всё записано.
                </div>
              </aside>
              <div className="notes-document-pane">
                {note ? (
                  <>
                    <div className="document-topline">
                      <span className="document-meta">
                        <FileText className="icon" />
                        Документ · {wordCount(note.text)} слов
                      </span>
                      <div className="document-controls">
                        <button
                          className={source ? "active" : ""}
                          aria-label={
                            source ? "Визуальный редактор" : "Исходный Markdown"
                          }
                          onClick={() => {
                            flush();
                            setSource((value) => !value);
                          }}
                        >
                          {source ? "↗ Редактор" : "⌘ Markdown"}
                        </button>
                        <button
                          disabled={exporting}
                          aria-label="Скачать Markdown"
                          title="Скачать .md"
                          onClick={() => void downloadNote()}
                        >
                          <Download className="icon" />
                          .md
                        </button>
                        <button
                          aria-label="Действия с документом"
                          onClick={() => {
                            flush();
                            setMenu("note");
                          }}
                        >
                          <MoreHorizontal className="icon" />
                        </button>
                      </div>
                    </div>
                    <div className="document-scroll">
                      <article className="document-paper">
                        <MarkdownEditor
                          key={`note-${task.id}-${note.id}`}
                          ref={editor}
                          value={note.text}
                          source={source}
                          label="Документ заметки"
                          placeholder="Пиши. Тут поместятся и ТЗ, и протокол, и все мысли."
                          onChange={(text) => updateNote(note.id, text)}
                          onBold={() => onEvent("bold")}
                          onDirtyChange={setEditorDirty}
                        />
                      </article>
                    </div>
                    <div className="document-bottomline">
                      <span>
                        <span className="online-dot" />
                        {savedLabel === "Сохранено"
                          ? "Изменения сохранены"
                          : savedLabel}
                      </span>
                      <span>Выдели текст — остальное покажем</span>
                    </div>
                  </>
                ) : (
                  <div className="task-empty-note">
                    <img
                      className="empty-cat"
                      src="/assets/cat-angora.png"
                      alt=""
                    />
                    <h2>Пока только в голове?</h2>
                    <p>После третьего созвона там останется белый шум.</p>
                    <button className="primary-btn" onClick={createNote}>
                      <Plus className="icon" />
                      Создать документ
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {notice && (
          <div className="task-notice" role="status">
            {notice}
            <button
              className="icon-btn"
              aria-label="Скрыть сообщение"
              onClick={() => setNotice("")}
            >
              <X className="icon" />
            </button>
          </div>
        )}
        <div className="task-bottomline">
          <span>ESC — закрыть окно</span>
          <span>Выделение → форматирование · ⌘ / Ctrl + B / I</span>
        </div>
      </div>
      {menu && (
        <Dialog
          title={menu === "task" ? "Действия с задачей" : "Этот документ"}
          onClose={() => setMenu(null)}
        >
          <p>{menu === "task" ? task.title : note ? noteTitle(note) : ""}</p>
          <button
            className="modal-menu-button"
            onClick={() => {
              if (menu === "task") {
                flush();
                onDuplicate(task.id);
                setMenu(null);
              } else copyNote();
            }}
          >
            <Copy className="icon" />
            Сделать копию
          </button>
          <button
            className="modal-menu-button danger"
            onClick={() => {
              if (menu === "task") {
                flush();
                setMenu(null);
                onDelete(task.id);
              } else {
                setConfirm("note");
                setMenu(null);
              }
            }}
          >
            <Trash2 className="icon" />
            {menu === "task" ? "Удалить задачу" : "Удалить документ"}
          </button>
        </Dialog>
      )}
      {confirm && (
        <Dialog
          title={confirm === "task" ? "Удалить задачу?" : "Удалить документ?"}
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm === "task"
              ? "Задача, чеклист и все документы будут удалены. Это действие нельзя отменить."
              : "Документ будет удалён. Это действие нельзя отменить."}
          </p>
          <div className="modal-actions">
            <button className="secondary-btn" onClick={() => setConfirm(null)}>
              Отмена
            </button>
            <button
              className="primary-btn danger-button"
              onClick={() => {
                if (confirm === "task") {
                  flush();
                  setConfirm(null);
                  onDelete(task.id);
                } else deleteNote();
              }}
            >
              Удалить
            </button>
          </div>
        </Dialog>
      )}
      {addChecklist && (
        <Dialog
          title="Декомпозиция подъехала"
          onClose={() => setAddChecklist(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const text = checkText.trim();
              if (!text) return;
              onUpdate(task.id, (current) => ({
                ...current,
                checklist: [...current.checklist, { text, done: false }],
              }));
              setAddChecklist(false);
            }}
          >
            <label htmlFor="checklist-new-text" className="form-label">
              Что нужно сделать?
            </label>
            <input
              autoFocus
              required
              id="checklist-new-text"
              className="form-input"
              value={checkText}
              maxLength={500}
              placeholder="Ещё один пункт, и точно всё"
              onChange={(event) => setCheckText(event.target.value)}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setAddChecklist(false)}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="primary-btn"
                disabled={!checkText.trim()}
              >
                Добавить пункт
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>,
    document.body,
  );
}
