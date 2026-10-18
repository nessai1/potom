import { describe, expect, it } from "vitest";
import { noteOutline, noteTitle, wordCount } from "./TaskDetail";

describe("document metadata", () => {
  it("uses rendered headings, excluding code, with inline markup removed", () => {
    const text =
      "```md\n# Example, not a heading\n```\n\n# Actual **title**\n\n## Second `step`\n\n### Third\n\n#### Outside outline";
    expect(noteOutline(text)).toEqual([
      { level: 1, text: "Actual title" },
      { level: 2, text: "Second step" },
      { level: 3, text: "Third" },
    ]);
    expect(noteTitle({ id: 1, date: "2026-10-17", text })).toBe("Actual title");
    expect(
      noteTitle({ id: 1, date: "2026-10-17", text: "#### Smaller heading" }),
    ).toBe("Smaller heading");
  });
  it("handles empty documents and counts text separated by Unicode whitespace", () => {
    expect(noteTitle({ id: 1, date: "2026-10-17", text: "" })).toBe(
      "Без названия",
    );
    expect(wordCount("  один\nдва\tтри  ")).toBe(3);
    expect(wordCount("   ")).toBe(0);
  });
});
