import { useEffect, useId, useState, type MouseEvent } from "react";
import { Check, MessageCircle, Pencil, Send, Trash2, X } from "lucide-react";
import type { Task, TaskNote, UpdateTask } from "../types";
import { openExternal } from "../lib/storage";
import Dialog from "./Dialog";
import { markdownToHtml } from "./MarkdownEditor";

interface TaskCommentsProps {
  task: Task;
  onUpdate: UpdateTask;
  onEvent: (event: string) => void;
  onBeforeAction: () => unknown;
}

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function chronologicalComments(notes: TaskNote[]): TaskNote[] {
  return notes
    .map((note, index) => ({ note, index }))
    .sort((a, b) => a.note.date.localeCompare(b.note.date) || a.index - b.index)
    .map(({ note }) => note);
}

function commentDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
}

export default function TaskComments({
  task,
  onUpdate,
  onEvent,
  onBeforeAction,
}: TaskCommentsProps) {
  const headingId = useId();
  const draftId = useId();
  const [draft, setDraft] = useState(task.commentDraft ?? "");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [deleting, setDeleting] = useState<TaskNote | null>(null);
  const [linkError, setLinkError] = useState("");
  useEffect(() => {
    setDraft(task.commentDraft ?? "");
  }, [task.id, task.commentDraft]);
  useEffect(() => {
    setEditingId(null);
    setDeleting(null);
    setLinkError("");
  }, [task.id]);

  function publish() {
    if (!draft.trim()) return;
    onBeforeAction();
    const text = draft;
    onUpdate(task.id, (current) => ({
      ...current,
      commentDraft: "",
      notes: [
        ...current.notes,
        {
          id: Math.max(Date.now(), ...current.notes.map((note) => note.id + 1)),
          text,
          date: today(),
        },
      ],
    }));
    setDraft("");
    onEvent("note");
  }

  function saveEdit() {
    if (editingId === null || !editText.trim()) return;
    onBeforeAction();
    onUpdate(task.id, (current) => ({
      ...current,
      notes: current.notes.map((note) =>
        note.id === editingId ? { ...note, text: editText } : note,
      ),
    }));
    setEditingId(null);
  }

  function openLink(event: MouseEvent<HTMLElement>) {
    const anchor = (event.target as Element).closest(
      "a[href]",
    ) as HTMLAnchorElement | null;
    if (!anchor) return;
    event.preventDefault();
    setLinkError("");
    void openExternal(anchor.href).catch((error) =>
      setLinkError(
        `Не удалось открыть ссылку: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  return (
    <section className="task-section task-comments" aria-labelledby={headingId}>
      <div className="task-section-heading">
        <h3 id={headingId}>
          <MessageCircle className="icon" />
          Комментарии
        </h3>
        <small>{task.notes.length}</small>
      </div>
      {task.notes.length ? (
        <ol className="task-comment-list" aria-label="Комментарии задачи">
          {chronologicalComments(task.notes).map((note) => (
            <li className="task-comment" key={note.id}>
              <span className="comment-avatar" aria-hidden="true">
                Я
              </span>
              <article
                className="task-comment-content"
                aria-label={`Комментарий от ${commentDate(note.date)}`}
              >
                <header className="task-comment-meta">
                  <strong>Я</strong>
                  <time dateTime={note.date}>{commentDate(note.date)}</time>
                  <div className="task-comment-actions">
                    <button
                      className="icon-btn"
                      aria-label={`Редактировать комментарий ${note.id}`}
                      title="Редактировать комментарий"
                      onClick={() => {
                        onBeforeAction();
                        setEditingId(note.id);
                        setEditText(note.text);
                      }}
                    >
                      <Pencil className="icon" />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={`Удалить комментарий ${note.id}`}
                      title="Удалить комментарий"
                      onClick={() => {
                        onBeforeAction();
                        setDeleting(note);
                      }}
                    >
                      <Trash2 className="icon" />
                    </button>
                  </div>
                </header>
                {note.title && (
                  <h4 className="task-comment-title">{note.title}</h4>
                )}
                {editingId === note.id ? (
                  <form
                    className="comment-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveEdit();
                    }}
                  >
                    <label
                      className="sr-only"
                      htmlFor={`comment-edit-${note.id}`}
                    >
                      Текст комментария
                    </label>
                    <textarea
                      id={`comment-edit-${note.id}`}
                      aria-label="Текст комментария"
                      autoFocus
                      value={editText}
                      onChange={(event) => setEditText(event.target.value)}
                      rows={5}
                    />
                    <div className="comment-edit-actions">
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => setEditingId(null)}
                      >
                        <X className="icon" />
                        Отмена
                      </button>
                      <button
                        className="primary-btn"
                        type="submit"
                        disabled={!editText.trim()}
                      >
                        <Check className="icon" />
                        Сохранить комментарий
                      </button>
                    </div>
                  </form>
                ) : (
                  <div
                    className="comment-markdown"
                    onClick={openLink}
                    dangerouslySetInnerHTML={{
                      __html: markdownToHtml(note.text),
                    }}
                  />
                )}
              </article>
            </li>
          ))}
        </ol>
      ) : (
        <p className="task-activity-empty">
          Пока без комментариев. Здесь можно обсудить задачу и сохранить важный
          контекст.
        </p>
      )}
      <form
        className="task-comment-form"
        onSubmit={(event) => {
          event.preventDefault();
          publish();
        }}
      >
        <label htmlFor={draftId}>Комментарий</label>
        <textarea
          id={draftId}
          value={draft}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            onUpdate(task.id, (current) => ({
              ...current,
              commentDraft: text,
            }));
          }}
          rows={3}
          placeholder="Добавьте контекст, вопрос или результат. Markdown поддерживается."
        />
        <div className="task-comment-form-footer">
          <span>Черновик сохраняется автоматически</span>
          <button
            className="primary-btn"
            type="submit"
            disabled={!draft.trim()}
          >
            <Send className="icon" />
            Отправить комментарий
          </button>
        </div>
      </form>
      {linkError && (
        <p className="task-activity-error" role="alert">
          {linkError}
        </p>
      )}
      {deleting && (
        <Dialog title="Удалить комментарий?" onClose={() => setDeleting(null)}>
          <p>Комментарий будет удалён. Это действие нельзя отменить.</p>
          <div className="modal-actions">
            <button className="secondary-btn" onClick={() => setDeleting(null)}>
              Отмена
            </button>
            <button
              className="primary-btn danger-button"
              onClick={() => {
                onBeforeAction();
                onUpdate(task.id, (current) => ({
                  ...current,
                  notes: current.notes.filter(
                    (note) => note.id !== deleting.id,
                  ),
                }));
                if (editingId === deleting.id) setEditingId(null);
                setDeleting(null);
              }}
            >
              Удалить
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
