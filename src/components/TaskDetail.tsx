import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Calendar,
  Check,
  Clock,
  Copy,
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
} from "../types";
import Dialog, { useModalFocus } from "./Dialog";
import MarkdownEditor, { type MarkdownEditorHandle } from "./MarkdownEditor";
import TaskComments from "./TaskComments";
import TaskAttachments from "./TaskAttachments";
import "../styles/task-activity.css";

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
  onAddAttachments,
}: TaskDetailProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [menu, setMenu] = useState(false);
  const [addChecklist, setAddChecklist] = useState(false);
  const [checkText, setCheckText] = useState("");
  const [editorDirty, setEditorDirty] = useState(false);
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
    setFullscreen(false);
  }, [task.id]);
  useEffect(() => {
    if (titleElement.current) {
      titleElement.current.style.height = "auto";
      titleElement.current.style.height = `${titleElement.current.scrollHeight}px`;
    }
  }, [title]);

  const project =
    projects.find((value) => value.id === task.project) ?? projects[0];
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

  function update(fields: Partial<typeof task>) {
    onUpdate(task.id, (current) => ({ ...current, ...fields }));
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
                setMenu(true);
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
        <div className="task-activity-header">
          <span>Задача</span>
          <span
            className={`task-save-indicator ${saveState === "error" ? "save-error" : ""}`}
            role="status"
          >
            <span className="online-dot" />
            {savedLabel}
          </span>
        </div>
        <div className="task-dialog-body">
          <div className="task-overview">
            <div className="task-main-content">
              <div className="task-kicker">
                <span className={`badge ${statusColors[task.status]}`}>
                  <span className="status-dot" />
                  {statusNames[task.status]}
                </span>
                {task.archived && <span className="badge gray">В архиве</span>}
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
              <TaskAttachments
                task={task}
                onUpdate={onUpdate}
                onAddAttachments={onAddAttachments}
                onBeforeAction={flush}
              />
              <TaskComments
                task={task}
                onUpdate={onUpdate}
                onEvent={onEvent}
                onBeforeAction={flush}
              />
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
                <label className="task-property-label" htmlFor="detail-status">
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
                <label className="task-property-label" htmlFor="detail-project">
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
                  {cleanLanguage ? "Мяу, ну конечно." : "Мяу, блядь, конечно."}
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
        </div>
        <div className="task-bottomline">
          <span>ESC — закрыть окно</span>
          <span>Выделение → форматирование · ⌘ / Ctrl + B / I</span>
        </div>
      </div>
      {menu && (
        <Dialog title="Действия с задачей" onClose={() => setMenu(false)}>
          <p>{task.title}</p>
          <button
            className="modal-menu-button"
            onClick={() => {
              flush();
              onDuplicate(task.id);
              setMenu(false);
            }}
          >
            <Copy className="icon" />
            Сделать копию
          </button>
          <button
            className="modal-menu-button danger"
            onClick={() => {
              flush();
              setMenu(false);
              onDelete(task.id);
            }}
          >
            <Trash2 className="icon" />
            Удалить задачу
          </button>
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
