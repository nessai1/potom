import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  attachmentName,
  downloadAttachment,
  MAX_ATTACHMENT_BYTES,
  readAttachmentFiles,
  validateAttachment,
} from "./attachments";
import { createInitialData } from "../model/initial-data";
import { parseArchive } from "./storage";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}));

const fixture = () => ({
  id: "e940098b-2664-4d46-a7e0-0158a11611ea",
  name: "Договор.pdf",
  size: 3,
  mime: "application/pdf",
  data: "AP+A",
  added: "2026-10-22",
});

beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(invoke).mockReset();
});

describe("portable task attachments", () => {
  it("copies every binary byte and accepts an empty file without depending on the source path", async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    const result = await readAttachmentFiles([
      new File([bytes], "Протокол.bin", { type: "application/octet-stream" }),
      new File([], "empty.txt", { type: "text/plain" }),
    ]);
    expect(result).toHaveLength(2);
    expect(
      Uint8Array.from(atob(result[0].data), (char) => char.charCodeAt(0)),
    ).toEqual(bytes);
    expect(result[1]).toMatchObject({ size: 0, data: "", name: "empty.txt" });
    expect(result[0].id).not.toBe(result[1].id);
    result.forEach((attachment) =>
      expect(() => validateAttachment(attachment)).not.toThrow(),
    );
  });

  it("rejects an oversized selection before reading any files", async () => {
    const reader = vi.spyOn(FileReader.prototype, "readAsDataURL");
    await expect(
      readAttachmentFiles([
        new File(["small"], "small.txt"),
        new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "big.bin"),
      ]),
    ).rejects.toThrow("big.bin");
    expect(reader).not.toHaveBeenCalled();
  });

  it("makes names portable between macOS and Windows, preserving Unicode and extensions", () => {
    for (const name of [
      "CON.txt",
      "lpt1",
      "../a:b?.txt",
      "Файл\u0085.txt",
      "...",
      " ",
      `${"😀".repeat(120)}.pdf`,
      `CON${" ".repeat(177)}x.txt`,
    ]) {
      const safe = attachmentName(name);
      expect(safe.length).toBeLessThanOrEqual(180);
      expect(() =>
        validateAttachment({ ...fixture(), name: safe }),
      ).not.toThrow();
    }
    expect(attachmentName("Расчёт (финал).xlsx")).toBe("Расчёт (финал).xlsx");
    expect(attachmentName(`${"😀".repeat(120)}.pdf`)).toMatch(/\.pdf$/);
  });

  it("rejects altered bytes, noncanonical padding, invalid dates and unsafe imported filenames", () => {
    for (const patch of [
      { data: "AP+A= " },
      { data: "AP+A", size: 2 },
      { data: "Zh==", size: 1 },
      { added: "2026-02-30" },
      { name: "../a.txt" },
      { name: "NUL.txt" },
      { name: "report." },
      { name: "bad\u0085.txt" },
      { mime: "text/plain\r\n" },
      { id: "bad-id" },
      { id: `${fixture().id}\n` },
    ])
      expect(() => validateAttachment({ ...fixture(), ...patch })).toThrow();
  });

  it("validates a full 10 MB file without regex stack overflow", () => {
    const data = "AAAA".repeat(Math.floor(MAX_ATTACHMENT_BYTES / 3)) + "AA==";
    expect(() =>
      validateAttachment({ ...fixture(), size: MAX_ATTACHMENT_BYTES, data }),
    ).not.toThrow();
  });

  it("keeps legacy notes, comment drafts and embedded files through JSON export/import and rejects duplicate IDs", () => {
    const data = createInitialData();
    data.projects.push({ id: "p", name: "Личное", color: "#aabbcc" });
    data.tasks.push({
      id: 1,
      title: "Задача",
      project: "p",
      status: "created",
      due: "",
      priority: "normal",
      description: "",
      checklist: [],
      created: "2026-10-22",
      notes: [
        {
          id: 1,
          title: "Старый заголовок",
          text: "# Был документ\n\n**Точный текст**",
          date: "2026-10-18",
        },
      ],
      commentDraft: "  Ещё не отправлено\n",
      attachments: [fixture()],
    });
    expect(parseArchive(JSON.stringify(data))).toEqual(data);
    data.tasks[0].attachments!.push(fixture());
    expect(() => parseArchive(JSON.stringify(data))).toThrow("повторяющийся");
  });

  it("uses the native save dialog contract and preserves cancellation and errors", async () => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(invoke).mockResolvedValueOnce(null);
    expect(await downloadAttachment(fixture())).toBeNull();
    expect(invoke).toHaveBeenCalledWith("save_attachment", {
      attachment: fixture(),
    });
    vi.mocked(invoke).mockRejectedValueOnce(new Error("Нет места на диске"));
    await expect(downloadAttachment(fixture())).rejects.toThrow("Нет места");
  });
});
