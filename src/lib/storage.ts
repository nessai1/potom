import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppData } from "../types";
import { createInitialData } from "../model/initial-data";

const KEY = "potom-ui-v1";
const BACKUP_KEY = "potom-backups-v1";
const MAX_BYTES = 50 * 1024 * 1024;
const BACKUP_INTERVAL = 15 * 60 * 1000;
let lastBackup = 0;

export const isDesktop = (): boolean => isTauri();
const object = (value: unknown, path: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Неверные данные: ${path} — ожидался объект.`);
  return value as Record<string, unknown>;
};
const list = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value))
    throw new Error(`Неверные данные: ${path} — ожидался список.`);
  return value;
};
const string = (value: unknown, path: string): string => {
  if (typeof value !== "string")
    throw new Error(`Неверные данные: ${path} — ожидалась строка.`);
  return value;
};
const flag = (value: unknown, path: string): void => {
  if (typeof value !== "boolean")
    throw new Error(`Неверные данные: ${path} — ожидался флаг true/false.`);
};
const id = (value: unknown, path: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new Error(`Неверные данные: ${path} — неверный идентификатор.`);
  return value;
};
const date = (value: unknown, path: string, allowEmpty = false): void => {
  const text = string(value, path);
  if (allowEmpty && text === "") return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text.startsWith("0000"))
    throw new Error(`Неверные данные: ${path} — ожидалась дата YYYY-MM-DD.`);
  const parsed = new Date(`${text}T12:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== text
  )
    throw new Error(`Неверные данные: ${path} — такой даты нет.`);
};
const unique = <T>(values: T[], path: string): void => {
  if (new Set(values).size !== values.length)
    throw new Error(`Неверные данные: ${path} — повторяющийся идентификатор.`);
};

/** Schema migration adds absent structural fields, preserving every existing user string. */
export function parseArchive(text: string): AppData {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES)
    throw new Error("Файл больше 50 МБ.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Не удалось прочитать JSON. Исходные данные не изменены.");
  }
  const data = object(parsed, "архив");
  const legacy = data.schema === undefined || data.schema === 1;
  if (typeof data.schema === "number" && data.schema > 2)
    throw new Error(
      "Эта резервная копия создана более новой версией приложения. Обновите приложение.",
    );
  if (!legacy && data.schema !== 2)
    throw new Error("Неподдерживаемая версия резервной копии.");
  if (legacy) {
    data.schema = 2;
    if (data.unlocked === undefined) data.unlocked = [];
    if (data.metrics === undefined) data.metrics = {};
    if (data.settings === undefined)
      data.settings = { theme: "light", cleanLanguage: false };
    const settings = object(data.settings, "settings");
    if (settings.theme === undefined) settings.theme = "light";
    if (settings.cleanLanguage === undefined) settings.cleanLanguage = false;
    for (const entry of list(data.tasks, "tasks")) {
      const task = object(entry, "task");
      for (const [key, value] of Object.entries({
        description: "",
        checklist: [],
        notes: [],
        due: "",
        priority: "normal",
      }))
        if (task[key] === undefined) task[key] = value;
    }
  }
  const projectIds = list(data.projects, "projects").map((entry, index) => {
    const project = object(entry, `projects[${index}]`);
    const projectId = string(project.id, "project.id");
    if (
      !projectId ||
      !string(project.name, "project.name").trim() ||
      !/^#[a-f0-9]{6}$/i.test(string(project.color, "project.color"))
    )
      throw new Error("Неверные данные проекта.");
    return projectId;
  });
  unique(projectIds, "projects");
  const taskIds = list(data.tasks, "tasks").map((entry, index) => {
    const path = `tasks[${index}]`;
    const task = object(entry, path);
    const taskId = id(task.id, `${path}.id`);
    if (!string(task.title, `${path}.title`).trim())
      throw new Error("У задачи нет названия.");
    if (!projectIds.includes(string(task.project, `${path}.project`)))
      throw new Error("Проект задачи не найден.");
    if (
      !["created", "progress", "deferred", "done"].includes(
        string(task.status, `${path}.status`),
      )
    )
      throw new Error("Неизвестный статус задачи.");
    if (
      !["high", "normal", "low"].includes(
        string(task.priority, `${path}.priority`),
      )
    )
      throw new Error("Неизвестный приоритет задачи.");
    string(task.description, `${path}.description`);
    date(task.due, `${path}.due`, true);
    date(task.created, `${path}.created`);
    if (task.completedAt !== undefined)
      date(task.completedAt, `${path}.completedAt`);
    list(task.checklist, `${path}.checklist`).forEach((entry) => {
      const item = object(entry, `${path}.checklist[]`);
      string(item.text, "checklist.text");
      flag(item.done, "checklist.done");
      if (item.wasUnchecked !== undefined)
        flag(item.wasUnchecked, "checklist.wasUnchecked");
    });
    const noteIds = list(task.notes, `${path}.notes`).map((entry) => {
      const note = object(entry, `${path}.notes[]`);
      string(note.text, "note.text");
      date(note.date, "note.date");
      if (note.title !== undefined) string(note.title, "note.title");
      return id(note.id, "note.id");
    });
    unique(noteIds, `${path}.notes`);
    return taskId;
  });
  unique(taskIds, "tasks");
  unique(
    list(data.unlocked, "unlocked").map((value) => string(value, "unlocked[]")),
    "unlocked",
  );
  const counter = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  Object.entries(object(data.metrics, "metrics")).forEach(([key, value]) => {
    if (
      !counter(value) &&
      !Object.values(object(value, `metrics.${key}`)).every(counter)
    )
      throw new Error(`Неверный счётчик metrics.${key}.`);
  });
  const settings = object(data.settings, "settings");
  if (settings.cleanLanguage === undefined) settings.cleanLanguage = false;
  if (!["light", "dark"].includes(string(settings.theme, "settings.theme")))
    throw new Error("Неизвестная тема оформления.");
  flag(settings.cleanLanguage, "settings.cleanLanguage");
  return data as unknown as AppData;
}

interface Backup {
  date: number;
  reason: string;
  text: string;
}
function backupBrowser(text: string, reason: string): void {
  const existing = localStorage.getItem(BACKUP_KEY);
  let backups: Backup[] = [];
  if (existing) {
    try {
      const value: unknown = JSON.parse(existing);
      if (!Array.isArray(value)) throw new Error();
      backups = value;
    } catch {
      throw new Error(
        "Повреждён список резервных копий браузера. Экспортируйте данные перед очисткой хранилища.",
      );
    }
  }
  const stamp = Date.now();
  backups.push({ date: stamp, reason, text });
  localStorage.setItem(BACKUP_KEY, JSON.stringify(backups.slice(-20)));
  lastBackup = stamp;
}

/** Synchronous browser-only flush for beforeunload; quota errors always propagate. */
export function flushBrowserData(data: AppData): void {
  const text = JSON.stringify(data);
  parseArchive(text);
  const previous = localStorage.getItem(KEY);
  if (previous) {
    parseArchive(previous); // Corrupted existing state can only be replaced by explicit import.
    if (previous === text) return;
    if (Date.now() - lastBackup >= BACKUP_INTERVAL)
      backupBrowser(previous, "autosave");
  } else {
    backupBrowser(text, "first-save");
  }
  localStorage.setItem(KEY, text);
}

export async function loadData(): Promise<AppData | null> {
  if (isDesktop()) return invoke<AppData | null>("load_data");
  const text = localStorage.getItem(KEY);
  if (text === null) return null;
  const data = parseArchive(text);
  const original = JSON.parse(text) as {
    schema?: unknown;
    settings?: { cleanLanguage?: boolean };
  };
  if (original.schema !== 2 || original.settings?.cleanLanguage === undefined) {
    backupBrowser(text, "migration");
    localStorage.setItem(KEY, JSON.stringify(data));
  }
  return data;
}

export async function saveData(data: AppData): Promise<void> {
  if (isDesktop()) return invoke<void>("save_data", { data });
  flushBrowserData(data);
}

export async function resetData(): Promise<AppData> {
  if (isDesktop()) return invoke<AppData>("reset_data");
  const empty = createInitialData();
  const previous = localStorage.getItem(KEY);
  if (previous !== null) backupBrowser(previous, "before-reset");
  localStorage.setItem(KEY, JSON.stringify(empty));
  lastBackup = 0;
  return empty;
}

function download(name: string, text: string, type: string): string {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}

export async function exportBackup(): Promise<string | null> {
  if (isDesktop()) return invoke<string | null>("export_backup");
  const data = await loadData();
  if (!data) throw new Error("Пока нет сохранённых данных.");
  return download(
    "potom-backup.json",
    JSON.stringify(data, null, 2),
    "application/json",
  );
}

export async function importBackup(): Promise<AppData | null> {
  if (isDesktop()) return invoke<AppData | null>("import_backup");
  const file = await new Promise<File | null>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), {
      once: true,
    });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
  if (!file) return null;
  if (file.size > MAX_BYTES) throw new Error("Файл больше 50 МБ.");
  const text = await file.text();
  const data = parseArchive(text);
  const previous = localStorage.getItem(KEY);
  if (previous !== null) backupBrowser(previous, "before-import");
  const original = JSON.parse(text) as {
    schema?: unknown;
    settings?: { cleanLanguage?: boolean };
  };
  if (original.schema !== 2 || original.settings?.cleanLanguage === undefined)
    backupBrowser(text, "import-before-migration");
  localStorage.setItem(KEY, JSON.stringify(data));
  return data;
}

export async function getStorageInfo(): Promise<{
  path: string;
  backupDirectory: string;
}> {
  if (isDesktop()) return invoke("get_storage_info");
  return {
    path: `localStorage: ${KEY}`,
    backupDirectory: `localStorage: ${BACKUP_KEY} (20 последних копий)`,
  };
}

export async function exportMarkdown(
  name: string,
  text: string,
): Promise<string | null> {
  if (isDesktop())
    return invoke<string | null>("export_markdown", { name, text });
  const safeName =
    name
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
      .trim()
      .slice(0, 100)
      .replace(/\.md$/i, "") || "Документ";
  return download(`${safeName}.md`, text, "text/markdown;charset=utf-8");
}

export async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("Разрешены только обычные HTTP и HTTPS ссылки.");
  if (isDesktop()) return invoke<void>("open_external", { url: parsed.href });
  window.open(parsed.href, "_blank", "noopener,noreferrer");
}
