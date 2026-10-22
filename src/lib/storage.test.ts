import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { loadData, parseArchive, saveData } from "./storage";
import type { AppData } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}));
const key = "potom-ui-v1";
const fixture = (): AppData => ({
  schema: 2,
  tasks: [
    {
      id: 1,
      title: "Мой текст",
      project: "p",
      status: "created",
      due: "",
      priority: "normal",
      description: "  # Markdown\n\n<script>мой текст</script>  ",
      checklist: [],
      notes: [{ id: 1, text: "# Doc\n\n| A | B |", date: "2024-02-29" }],
      created: "2024-02-29",
    },
  ],
  projects: [{ id: "p", name: "Проект", color: "#eeaacc" }],
  unlocked: [],
  metrics: {},
  settings: { theme: "light", cleanLanguage: false },
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(invoke).mockReset();
});

describe("archive validation and safe storage", () => {
  it("returns null only for uninitialized data and preserves every saved Markdown byte", async () => {
    expect(await loadData()).toBeNull();
    const data = fixture();
    await saveData(data);
    expect(await loadData()).toEqual(data);
    expect(JSON.parse(localStorage.getItem("potom-backups-v1")!)).toHaveLength(
      1,
    );
  });

  it("backs up and normalizes original schema2 theme-only archives without changing user text", async () => {
    const data = fixture();
    const original = JSON.parse(JSON.stringify(data)) as Record<
      string,
      unknown
    >;
    original.settings = { theme: "dark" };
    const text = JSON.stringify(original);
    localStorage.setItem(key, text);
    const loaded = await loadData();
    expect(loaded?.settings).toEqual({ theme: "dark", cleanLanguage: false });
    expect(loaded?.tasks).toEqual(data.tasks);
    const backups = JSON.parse(localStorage.getItem("potom-backups-v1")!) as {
      reason: string;
      text: string;
    }[];
    expect(
      backups.some(
        (entry) => entry.reason === "migration" && entry.text === text,
      ),
    ).toBe(true);
  });

  it("migrates missing schema or schema1 and retains existing titles and documents", () => {
    for (const schema of [undefined, 1]) {
      const input = {
        ...fixture(),
        schema,
        settings: undefined,
        metrics: undefined,
        unlocked: undefined,
      };
      const data = parseArchive(JSON.stringify(input));
      expect(data.schema).toBe(2);
      expect(data.tasks).toEqual(fixture().tasks);
      expect(data.settings.cleanLanguage).toBe(false);
    }
  });

  it("rejects corrupt or future data and never overwrites it with a valid seed", async () => {
    for (const text of [
      "{broken",
      JSON.stringify({ ...fixture(), schema: 3 }),
    ]) {
      localStorage.setItem(key, text);
      await expect(loadData()).rejects.toThrow();
      await expect(saveData(fixture())).rejects.toThrow();
      expect(localStorage.getItem(key)).toBe(text);
    }
  });

  it("validates real dates, ids, referenced projects and metrics", () => {
    for (const due of [
      "2023-02-29",
      "1900-02-29",
      "0000-01-01",
      "2026-04-31",
      "2026-01-00",
    ]) {
      const data = fixture();
      data.tasks[0].due = due;
      expect(() => parseArchive(JSON.stringify(data))).toThrow();
    }
    const duplicate = fixture();
    duplicate.tasks.push({ ...duplicate.tasks[0] });
    expect(() => parseArchive(JSON.stringify(duplicate))).toThrow();
    const dangling = fixture();
    dangling.tasks[0].project = "missing";
    expect(() => parseArchive(JSON.stringify(dangling))).toThrow();
    const metric = fixture();
    metric.metrics.clicks = -1;
    expect(() => parseArchive(JSON.stringify(metric))).toThrow();
  });

  it("preserves optional archive and completion time fields while reading legacy tasks unchanged", () => {
    const legacy = fixture();
    expect(parseArchive(JSON.stringify(legacy))).toEqual(legacy);
    for (const time of [0, Date.now(), Number.MAX_SAFE_INTEGER]) {
      const archived = fixture();
      archived.tasks[0] = {
        ...archived.tasks[0],
        status: "done",
        archived: true,
        completedAtTime: time,
      };
      expect(parseArchive(JSON.stringify(archived))).toEqual(archived);
    }
    const active = fixture();
    active.tasks[0].archived = false;
    expect(parseArchive(JSON.stringify(active))).toEqual(active);
  });

  it("rejects invalid archive flags, unsafe completion timestamps and active tasks with done-only metadata", () => {
    for (const patch of [
      { archived: true },
      { status: "done", archived: 1 },
      { status: "done", archived: null },
      { completedAtTime: 0 },
      { status: "done", completedAtTime: -1 },
      { status: "done", completedAtTime: 1.5 },
      { status: "done", completedAtTime: Number.MAX_SAFE_INTEGER + 1 },
      { status: "done", completedAtTime: "1000" },
      { status: "done", completedAtTime: null },
    ]) {
      const invalid = fixture();
      Object.assign(invalid.tasks[0], patch);
      expect(() => parseArchive(JSON.stringify(invalid))).toThrow();
    }
  });

  it("propagates quota errors and retains the previously committed state", async () => {
    const data = fixture();
    await saveData(data);
    const saved = localStorage.getItem(key);
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      name: string,
      value: string,
    ) {
      if (name === key)
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      originalSet.call(this, name, value);
    });
    const updated = fixture();
    updated.tasks[0].title = "Не сохранилось";
    await expect(saveData(updated)).rejects.toThrow("Quota exceeded");
    expect(localStorage.getItem(key)).toBe(saved);
  });

  it("uses exact native command contracts and propagates backend failures", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValueOnce(fixture());
    expect(await loadData()).toEqual(fixture());
    expect(invoke).toHaveBeenCalledWith("load_data");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    await expect(saveData(fixture())).rejects.toThrow("disk full");
    expect(invoke).toHaveBeenLastCalledWith("save_data", { data: fixture() });
  });
});
