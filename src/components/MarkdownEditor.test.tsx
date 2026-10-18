import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef, StrictMode, useState } from "react";
import MarkdownEditor, {
  cleanHtml,
  htmlToMarkdown,
  markdownToHtml,
  safeUrl,
  type MarkdownEditorHandle,
} from "./MarkdownEditor";

vi.mock("../lib/storage", () => ({ openExternal: vi.fn(async () => {}) }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Markdown codec", () => {
  it("removes active HTML, borrowed application classes and non-HTTP links", () => {
    const html = cleanHtml(
      '<script>alert(1)</script><p class="task-overlay" style="position:fixed" onclick="alert(2)">text <a href="javascript:alert(3)">bad</a><a href="https://example.com/">safe</a><img src="x" onerror="alert(4)"><iframe src="https://example.com"></iframe></p>',
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    expect(
      container.querySelector(
        "script,iframe,[style],[onclick],[onerror],[class]",
      ),
    ).toBeNull();
    expect(container.querySelector("a")?.hasAttribute("href")).toBe(false);
    expect(container.querySelectorAll("a")[1].getAttribute("href")).toBe(
      "https://example.com/",
    );
    expect(safeUrl("file:///private/test")).toBeNull();
    expect(safeUrl("data:text/html,hello")).toBeNull();
  });

  it("roundtrips GFM tables, nested lists, task lists, strike and fenced language code", () => {
    const source =
      "# Документ\n\n- первый\n  - вложенный\n\n- [x] готово\n- [ ] ещё нет\n\n~~лишнее~~\n\n| Слева | Справа |\n| --- | --- |\n| a \\| b | **да** |\n\n```typescript\nconst n = 42;\n```";
    const restored = htmlToMarkdown(markdownToHtml(source));
    expect(restored).toContain("# Документ");
    expect(restored).toMatch(/-\s+первый\n\s+-\s+вложенный/);
    expect(restored).toMatch(/\[x\]\s+готово/);
    expect(restored).toMatch(/\[ \]\s+ещё нет/);
    expect(restored).toContain("~~лишнее~~");
    expect(restored).toContain("a \\| b");
    expect(restored).toContain("```typescript\nconst n = 42;\n```");
    const parsed = document.createElement("div");
    parsed.innerHTML = markdownToHtml(restored);
    expect(parsed.querySelectorAll("table")).toHaveLength(1);
    expect(parsed.querySelectorAll("input[checked]")).toHaveLength(1);
    expect(parsed.querySelector("ul ul")).not.toBeNull();
  });
});

describe("Markdown editing persistence", () => {
  it("reports dirty state after the StrictMode cleanup replay", () => {
    const onDirtyChange = vi.fn();
    render(
      <StrictMode>
        <MarkdownEditor
          label="Документ"
          value="before"
          onChange={() => {}}
          onDirtyChange={onDirtyChange}
        />
      </StrictMode>,
    );
    fireEvent.input(screen.getByRole("textbox", { name: "Документ" }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("preserves original bytes on focus, blur and explicit flush without an edit", () => {
    const original = "\n# Heading\n\n\nparagraph  \nnext\n";
    const onChange = vi.fn();
    const ref = createRef<MarkdownEditorHandle>();
    render(
      <MarkdownEditor
        ref={ref}
        label="Документ"
        value={original}
        onChange={onChange}
      />,
    );
    const editor = screen.getByRole("textbox", { name: "Документ" });
    fireEvent.focus(editor);
    fireEvent.blur(editor);
    expect(ref.current?.flush()).toBe(original);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("flushes the latest buffer synchronously and clears the debounce", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <MarkdownEditor label="Документ" value="before" onChange={onChange} />,
    );
    const editor = screen.getByRole("textbox", { name: "Документ" });
    editor.innerHTML = "<p>latest <strong>text</strong></p>";
    fireEvent.input(editor);
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(new Event("potom:flush-editors"));
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("latest **text**");
    act(() => {
      vi.runAllTimers();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps the current DOM nodes after autosave so text selection survives", () => {
    vi.useFakeTimers();
    function Host() {
      const [value, setValue] = useState("before");
      return (
        <MarkdownEditor label="Документ" value={value} onChange={setValue} />
      );
    }
    render(<Host />);
    const editor = screen.getByRole("textbox", { name: "Документ" });
    editor.innerHTML = "<p>typed paragraph</p>";
    const text = editor.querySelector("p")?.firstChild;
    const range = document.createRange();
    range.setStart(text!, 5);
    range.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    fireEvent.input(editor);
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(editor.querySelector("p")?.firstChild).toBe(text);
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(5);
  });

  it("flushes pending changes even when the editor unmounts before the debounce", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const { unmount } = render(
      <MarkdownEditor label="Документ" value="before" onChange={onChange} />,
    );
    const editor = screen.getByRole("textbox", { name: "Документ" });
    editor.innerHTML = "<p>last keystroke</p>";
    fireEvent.input(editor);
    unmount();
    expect(onChange).toHaveBeenCalledExactlyOnceWith("last keystroke");
  });
});
