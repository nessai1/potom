import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import Dialog from "./Dialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("modal focus and keyboard behavior", () => {
  it("keeps background inert, handles Escape only on the top dialog and restores its opener", () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      { width: 10, height: 10 },
    ] as unknown as DOMRectList);
    const background = document.createElement("button");
    background.textContent = "Background";
    document.body.append(background);
    background.focus();
    function Host() {
      const [outer, setOuter] = useState(true);
      const [inner, setInner] = useState(false);
      return (
        outer && (
          <Dialog title="Outer" onClose={() => setOuter(false)}>
            <button onClick={() => setInner(true)}>Open inner</button>
            {inner && (
              <Dialog title="Inner" onClose={() => setInner(false)}>
                <button>Inner action</button>
              </Dialog>
            )}
          </Dialog>
        )
      );
    }
    render(<Host />);
    expect(background.inert).toBe(true);
    const opener = screen.getByRole("button", { name: "Open inner" });
    opener.focus();
    fireEvent.click(opener);
    const inner = screen.getByRole("dialog", { name: "Inner" });
    expect(inner.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(inner, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Inner" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Outer" })).toBeTruthy();
    expect(document.activeElement).toBe(opener);
    expect(background.inert).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Outer" })).toBeNull();
    expect(background.inert).toBe(false);
    expect(document.activeElement).toBe(background);
    background.remove();
  });

  it("wraps Tab and Shift+Tab at the dialog boundaries", () => {
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      { width: 10, height: 10 },
    ] as unknown as DOMRectList);
    render(
      <Dialog title="Focus trap" onClose={() => {}}>
        <button>Last</button>
      </Dialog>,
    );
    const first = screen.getByRole("button", { name: "Закрыть окно" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
