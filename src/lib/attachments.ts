import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TaskAttachment } from "../types";
import { todayKey } from "../model/dates";

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_WORKSPACE_BYTES = 50 * 1024 * 1024;
const reservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const unsafeName = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/;

export function attachmentName(name: string): string {
  let safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f-\u009f]/g, "_")
    .trim()
    .replace(/[. ]+$/, "");
  if (!safe) safe = "Файл";
  if (reservedName.test(safe)) safe = `_${safe}`;
  if (safe.length > 180) {
    const dot = safe.lastIndexOf(".");
    const extension = dot > 0 && safe.length - dot <= 20 ? safe.slice(dot) : "";
    safe =
      [...safe.slice(0, 180 - extension.length)]
        .filter((char) => !/^[\ud800-\udfff]$/.test(char))
        .join("")
        .replace(/[. ]+$/, "") + extension;
  }
  if (reservedName.test(safe)) safe = `_${safe}`;
  return safe;
}

export function validateAttachment(
  value: unknown,
): asserts value is TaskAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Неверные данные вложения.");
  const a = value as Record<string, unknown>;
  if (
    typeof a.id !== "string" ||
    a.id.length !== 36 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      a.id,
    )
  )
    throw new Error("Неверный идентификатор вложения.");
  if (
    typeof a.name !== "string" ||
    !a.name.trim() ||
    a.name === "." ||
    a.name === ".." ||
    a.name.length > 180 ||
    unsafeName.test(a.name) ||
    /[. ]$/.test(a.name) ||
    reservedName.test(a.name)
  )
    throw new Error("Неверное имя вложения.");
  if (
    typeof a.size !== "number" ||
    !Number.isSafeInteger(a.size) ||
    a.size < 0 ||
    a.size > MAX_ATTACHMENT_BYTES
  )
    throw new Error("Размер одного файла не должен превышать 10 МБ.");
  if (
    typeof a.mime !== "string" ||
    !a.mime.trim() ||
    a.mime.length > 255 ||
    /[^\x20-\x7e]/.test(a.mime)
  )
    throw new Error("Неверный тип вложения.");
  if (
    typeof a.added !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(a.added) ||
    a.added.startsWith("0000") ||
    Number.isNaN(new Date(`${a.added}T12:00:00Z`).getTime()) ||
    new Date(`${a.added}T12:00:00Z`).toISOString().slice(0, 10) !== a.added
  )
    throw new Error("Неверная дата вложения.");
  if (
    typeof a.data !== "string" ||
    a.data.length !== Math.ceil(a.size / 3) * 4 ||
    /[^A-Za-z0-9+/=]/.test(a.data)
  )
    throw new Error("Повреждены данные вложения.");
  let binary: string;
  try {
    binary = atob(a.data);
  } catch {
    throw new Error("Повреждены данные вложения.");
  }
  if (binary.length !== a.size || btoa(binary) !== a.data)
    throw new Error("Размер и содержимое вложения не совпадают.");
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString("ru", { maximumFractionDigits: 1 })} КБ`;
  return `${(bytes / 1024 / 1024).toLocaleString("ru", { maximumFractionDigits: 1 })} МБ`;
}

export async function readAttachmentFiles(
  files: File[],
): Promise<TaskAttachment[]> {
  // Reject the whole selection before reading any bytes; failed batches add no files.
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES)
      throw new Error(
        `«${file.name}» больше 10 МБ. Выберите файл меньшего размера.`,
      );
  }
  if (
    files.reduce((sum, file) => sum + Math.ceil(file.size / 3) * 4, 0) >
    MAX_WORKSPACE_BYTES
  )
    throw new Error(
      "Выбрано слишком много файлов: пространство ограничено 50 МБ.",
    );
  const result: TaskAttachment[] = [];
  for (const file of files) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = reader.result;
        if (typeof value !== "string" || !value.includes(",")) {
          reject(new Error(`Не удалось прочитать «${file.name}».`));
          return;
        }
        resolve(value.slice(value.indexOf(",") + 1));
      };
      reader.onerror = () =>
        reject(
          new Error(`Не удалось прочитать «${file.name}». Попробуйте ещё раз.`),
        );
      reader.onabort = () =>
        reject(new Error(`Чтение «${file.name}» отменено.`));
      reader.readAsDataURL(file);
    });
    const attachment: TaskAttachment = {
      id: crypto.randomUUID(),
      name: attachmentName(file.name),
      size: file.size,
      mime:
        file.type && !/[^\x20-\x7e]/.test(file.type)
          ? file.type.slice(0, 255)
          : "application/octet-stream",
      data,
      added: todayKey(),
    };
    validateAttachment(attachment);
    result.push(attachment);
  }
  return result;
}

export async function downloadAttachment(
  attachment: TaskAttachment,
): Promise<string | null> {
  validateAttachment(attachment);
  if (isTauri())
    return invoke<string | null>("save_attachment", { attachment });
  const binary = atob(attachment.data);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: attachment.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return attachment.name;
}
