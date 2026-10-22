import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import {
  Download,
  File,
  LoaderCircle,
  Paperclip,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { Task, TaskAttachment, UpdateTask } from "../types";
import { downloadAttachment, formatFileSize } from "../lib/attachments";
import Dialog from "./Dialog";

interface TaskAttachmentsProps {
  task: Task;
  onUpdate: UpdateTask;
  onAddAttachments: (id: number, files: File[]) => Promise<void>;
  onBeforeAction: () => unknown;
}
const FILE_LIMIT = 10 * 1024 * 1024;

export default function TaskAttachments({
  task,
  onUpdate,
  onAddAttachments,
  onBeforeAction,
}: TaskAttachmentsProps) {
  const headingId = useId();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [retryFiles, setRetryFiles] = useState<File[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [retryDownload, setRetryDownload] = useState<TaskAttachment | null>(
    null,
  );
  const [deleting, setDeleting] = useState<TaskAttachment | null>(null);
  const [notice, setNotice] = useState("");
  const activeTask = useRef(task.id);
  activeTask.current = task.id;
  useEffect(() => {
    setError("");
    setNotice("");
    setRetryFiles([]);
    setRetryDownload(null);
    setDeleting(null);
    setDragging(false);
    dragDepth.current = 0;
  }, [task.id]);

  async function add(files: File[]) {
    if (!files.length || adding) return;
    setError("");
    setNotice("");
    setRetryDownload(null);
    setRetryFiles([]);
    const oversized = files.find((file) => file.size > FILE_LIMIT);
    if (oversized) {
      setError(
        `Файл «${oversized.name}» больше 10 МБ. Выберите файл меньшего размера.`,
      );
      return;
    }
    const taskId = task.id;
    onBeforeAction();
    setAdding(true);
    try {
      await onAddAttachments(taskId, files);
      if (activeTask.current === taskId)
        setNotice(
          files.length === 1
            ? "Файл прикреплён"
            : `Файлы прикреплены: ${files.length}`,
        );
    } catch (cause) {
      if (activeTask.current === taskId) {
        setError(
          `Не удалось прикрепить файлы: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        setRetryFiles(files);
      }
    } finally {
      if (activeTask.current === taskId) setAdding(false);
    }
  }

  async function download(attachment: TaskAttachment) {
    if (downloading) return;
    setDownloading(attachment.id);
    setError("");
    setNotice("");
    setRetryDownload(null);
    setRetryFiles([]);
    const taskId = task.id;
    try {
      const path = await downloadAttachment(attachment);
      if (path && activeTask.current === taskId)
        setNotice(`Файл «${attachment.name}» сохранён`);
    } catch (cause) {
      if (activeTask.current === taskId) {
        setError(
          `Не удалось скачать файл: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        setRetryDownload(attachment);
      }
    } finally {
      if (activeTask.current === taskId) setDownloading(null);
    }
  }
  function hasFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  return (
    <section
      className="task-section task-attachments"
      aria-labelledby={headingId}
    >
      <div className="task-section-heading">
        <h3 id={headingId}>
          <Paperclip className="icon" />
          Файлы
        </h3>
        <small>{task.attachments?.length ?? 0}</small>
      </div>
      <div
        className={`task-file-zone ${dragging ? "is-dragging" : ""} ${adding ? "is-loading" : ""}`}
        role="region"
        aria-label="Файлы задачи"
        aria-busy={adding}
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = adding ? "none" : "copy";
        }}
        onDragLeave={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          event.stopPropagation();
          dragDepth.current = 0;
          setDragging(false);
          void add(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          ref={input}
          id={inputId}
          className="sr-only"
          type="file"
          multiple
          aria-label="Прикрепить файлы"
          disabled={adding}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void add(files);
          }}
        />
        <div className="task-file-drop-copy">
          <Paperclip className="icon" />
          <span>
            {dragging ? "Отпустите файлы здесь" : "Перетащите файлы сюда"}
            <small>До 10 МБ на файл · сохраняются вместе с задачей</small>
          </span>
          <button
            className="secondary-btn"
            type="button"
            disabled={adding}
            onClick={() => input.current?.click()}
          >
            {adding ? (
              <LoaderCircle className="icon spin" />
            ) : (
              <Plus className="icon" />
            )}
            {adding ? "Добавляем…" : "Добавить файлы"}
          </button>
        </div>
        {!!task.attachments?.length && (
          <ul className="task-file-list" aria-label="Прикреплённые файлы">
            {task.attachments.map((attachment) => (
              <li key={attachment.id} className="task-file-row">
                <span className="task-file-icon">
                  <File className="icon" />
                </span>
                <span className="task-file-meta">
                  <strong>{attachment.name}</strong>
                  <small>{formatFileSize(attachment.size)}</small>
                </span>
                <button
                  className="icon-btn"
                  aria-label={`Скачать файл ${attachment.name}`}
                  title="Скачать файл"
                  disabled={downloading !== null}
                  onClick={() => void download(attachment)}
                >
                  {downloading === attachment.id ? (
                    <LoaderCircle className="icon spin" />
                  ) : (
                    <Download className="icon" />
                  )}
                </button>
                <button
                  className="icon-btn"
                  aria-label={`Удалить файл ${attachment.name}`}
                  title="Удалить файл"
                  onClick={() => {
                    onBeforeAction();
                    setDeleting(attachment);
                  }}
                >
                  <Trash2 className="icon" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <div className="task-activity-error" role="alert">
          <span>{error}</span>
          {!!retryFiles.length && (
            <button
              className="secondary-btn"
              disabled={adding}
              onClick={() => void add(retryFiles)}
            >
              <RotateCcw className="icon" />
              Повторить загрузку
            </button>
          )}
          {retryDownload && (
            <button
              className="secondary-btn"
              disabled={downloading !== null}
              onClick={() => void download(retryDownload)}
            >
              <RotateCcw className="icon" />
              Повторить скачивание
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="task-activity-notice" role="status">
          {notice}
        </p>
      )}
      {deleting && (
        <Dialog title="Удалить файл?" onClose={() => setDeleting(null)}>
          <p>Файл «{deleting.name}» будет удалён из задачи.</p>
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
                  attachments: current.attachments?.filter(
                    (attachment) => attachment.id !== deleting.id,
                  ),
                }));
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
