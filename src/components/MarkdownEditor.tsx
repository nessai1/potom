import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Link,
  List,
  Quote,
  Code,
} from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { openExternal } from "../lib/storage";
import Dialog from "./Dialog";

const tags = [
  "p",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "b",
  "em",
  "i",
  "s",
  "del",
  "strike",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
  "code",
  "pre",
  "hr",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "img",
  "input",
  "div",
  "span",
  "sup",
  "sub",
  "kbd",
];

export function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function cleanHtml(html: string): string {
  const fragment = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: tags,
    ALLOWED_ATTR: [
      "href",
      "title",
      "src",
      "alt",
      "align",
      "colspan",
      "rowspan",
      "type",
      "checked",
      "disabled",
      "start",
      "class",
    ],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  fragment.querySelectorAll("[class]").forEach((node) => {
    const language =
      node.tagName === "CODE"
        ? Array.from(node.classList).find((name) =>
            /^language-[\w.+#-]+$/.test(name),
          )
        : null;
    if (language) node.setAttribute("class", language);
    else node.removeAttribute("class");
  });
  fragment.querySelectorAll("a").forEach((node) => {
    const href = safeUrl(node.getAttribute("href") ?? "");
    if (href) {
      node.setAttribute("href", href);
      node.setAttribute("rel", "noopener noreferrer");
    } else node.removeAttribute("href");
  });
  fragment.querySelectorAll("img").forEach((node) => {
    if (!safeUrl(node.getAttribute("src") ?? "")) node.removeAttribute("src");
  });
  fragment.querySelectorAll("input").forEach((node) => {
    if (node.type !== "checkbox") node.remove();
    else {
      node.disabled = true;
      node.setAttribute("contenteditable", "false");
    }
  });
  const container = document.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  fence: "```",
  emDelimiter: "*",
  strongDelimiter: "**",
  linkStyle: "inlined",
});
turndown.use(gfm);
turndown.addRule("strike", {
  filter: (node) => ["DEL", "S", "STRIKE"].includes(node.nodeName),
  replacement: (content) => `~~${content}~~`,
});
turndown.addRule("tableCell", {
  filter: ["th", "td"],
  replacement: (content, node) => {
    const index = Array.prototype.indexOf.call(
      node.parentNode?.children ?? [],
      node,
    );
    return `${index === 0 ? "| " : " "}${content.trim().replace(/\|/g, "\\|").replace(/\n+/g, "<br>")} |`;
  },
});
turndown.addRule("tableBreak", {
  filter: (node) =>
    node.nodeName === "BR" && !!(node as HTMLElement).closest("td,th"),
  replacement: () => "<br>",
});
turndown.addRule("taskCheckbox", {
  filter: (node) =>
    node.nodeName === "INPUT" &&
    (node as HTMLInputElement).type === "checkbox" &&
    !!(node as HTMLElement).closest("li"),
  replacement: (_content, node) =>
    `${(node as HTMLInputElement).checked ? "[x]" : "[ ]"} `,
});

export function markdownToHtml(markdown: string): string {
  return cleanHtml(
    marked.parse(markdown, {
      gfm: true,
      breaks: false,
      async: false,
    }) as string,
  );
}
export function htmlToMarkdown(html: string | HTMLElement): string {
  return turndown
    .turndown(cleanHtml(typeof html === "string" ? html : html.innerHTML))
    .trim();
}

export interface MarkdownEditorHandle {
  flush: () => string;
  focus: () => void;
  scrollToHeading: (index: number) => void;
}
interface Props {
  value: string;
  onChange: (value: string) => void;
  source?: boolean;
  label: string;
  placeholder?: string;
  description?: boolean;
  onBold?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}
type Format =
  | "bold"
  | "italic"
  | "strike"
  | "h1"
  | "h2"
  | "link"
  | "list"
  | "quote"
  | "code";
const formats = [
  { name: "bold", label: "Жирный (⌘/Ctrl+B)", Icon: Bold },
  { name: "italic", label: "Курсив (⌘/Ctrl+I)", Icon: Italic },
  { name: "strike", label: "Зачёркнутый", Icon: Strikethrough },
  { name: "h1", label: "Заголовок первого уровня", Icon: Heading1 },
  { name: "h2", label: "Заголовок второго уровня", Icon: Heading2 },
  { name: "link", label: "Ссылка (⌘/Ctrl+K)", Icon: Link },
  { name: "list", label: "Маркированный список", Icon: List },
  { name: "quote", label: "Цитата", Icon: Quote },
  { name: "code", label: "Код", Icon: Code },
] as const;

const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(
  function MarkdownEditor(
    {
      value,
      onChange,
      source = false,
      label,
      placeholder,
      description,
      onBold,
      onDirtyChange,
    },
    forwardedRef,
  ) {
    const rich = useRef<HTMLDivElement>(null);
    const area = useRef<HTMLTextAreaElement>(null);
    const lastRich = useRef<HTMLDivElement | null>(null);
    const lastArea = useRef<HTMLTextAreaElement | null>(null);
    const callback = useRef(onChange);
    const dirtyCallback = useRef(onDirtyChange);
    callback.current = onChange;
    dirtyCallback.current = onDirtyChange;
    const committed = useRef(value);
    const mode = useRef(source);
    const dirty = useRef(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const range = useRef<Range | null>(null);
    const sourceSelection = useRef({ start: 0, end: 0 });
    const [toolbar, setToolbar] = useState<{
      left: number;
      top: number;
    } | null>(null);
    const [linkDialog, setLinkDialog] = useState(false);
    const pendingLink = useRef<string | null>(null);
    const [link, setLink] = useState("https://");
    const [linkError, setLinkError] = useState("");
    const [externalError, setExternalError] = useState("");

    const flush = useCallback(() => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (dirty.current) {
        const richNode = rich.current ?? lastRich.current;
        const sourceNode = area.current ?? lastArea.current;
        const next = mode.current
          ? (sourceNode?.value ?? committed.current)
          : richNode
            ? htmlToMarkdown(richNode)
            : committed.current;
        dirty.current = false;
        dirtyCallback.current?.(false);
        if (!mode.current && richNode) richNode.dataset.loadedValue = next;
        if (next !== committed.current) {
          committed.current = next;
          callback.current(next);
        }
      }
      return committed.current;
    }, []);

    // React must not reconcile contentEditable children while the user is typing.
    // Untouched Markdown stays byte-for-byte identical, including blank lines.
    useLayoutEffect(() => {
      const changedMode = source !== mode.current;
      if (changedMode) mode.current = source;
      if (rich.current) lastRich.current = rich.current;
      if (area.current) lastArea.current = area.current;
      if (!dirty.current && (changedMode || value !== committed.current))
        committed.current = value;
      if (!dirty.current) {
        if (source && area.current) area.current.value = committed.current;
        else if (
          rich.current &&
          rich.current.dataset.loadedValue !== committed.current
        ) {
          rich.current.innerHTML =
            markdownToHtml(committed.current) || "<p><br></p>";
          rich.current.dataset.loadedValue = committed.current;
        }
      }
    }, [value, source]);

    useEffect(() => {
      dirtyCallback.current = onDirtyChange;
      const handler = () => {
        flush();
      };
      document.addEventListener("potom:flush-editors", handler);
      return () => {
        dirtyCallback.current = undefined;
        flush();
        document.removeEventListener("potom:flush-editors", handler);
      };
    }, [flush]);

    useImperativeHandle(
      forwardedRef,
      () => ({
        flush,
        focus: () => (mode.current ? area.current : rich.current)?.focus(),
        scrollToHeading: (index) =>
          rich.current?.querySelectorAll("h1,h2,h3")[index]?.scrollIntoView({
            behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
              .matches
              ? "instant"
              : "smooth",
            block: "start",
          }),
      }),
      [flush],
    );

    useEffect(() => {
      if (linkDialog || !pendingLink.current) return;
      const url = pendingLink.current;
      pendingLink.current = null;
      // Wait until the nested dialog releases inert before restoring the range.
      const frame = requestAnimationFrame(() => format("link", url));
      return () => cancelAnimationFrame(frame);
    }, [linkDialog]);

    function changed() {
      dirty.current = true;
      dirtyCallback.current?.(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 350);
    }
    function capture() {
      const node = mode.current ? area.current : rich.current;
      if (!node) return;
      let rect: DOMRect;
      if (mode.current && area.current) {
        range.current = null;
        sourceSelection.current = {
          start: area.current.selectionStart,
          end: area.current.selectionEnd,
        };
        if (area.current.selectionStart === area.current.selectionEnd) {
          setToolbar(null);
          return;
        }
        rect = area.current.getBoundingClientRect();
      } else {
        const selection = window.getSelection();
        if (
          !selection?.rangeCount ||
          !node.contains(selection.anchorNode) ||
          !node.contains(selection.focusNode)
        ) {
          range.current = null;
          setToolbar(null);
          return;
        }
        // A caret is a valid current range. Keeping the previous noncollapsed
        // range here would make a shortcut overwrite text selected earlier.
        range.current = selection.getRangeAt(0).cloneRange();
        if (selection.isCollapsed) {
          setToolbar(null);
          return;
        }
        rect = range.current.getBoundingClientRect();
      }
      const width = Math.min(340, window.innerWidth - 24);
      setToolbar({
        left: Math.max(
          12,
          Math.min(
            window.innerWidth - width - 12,
            rect.left + rect.width / 2 - width / 2,
          ),
        ),
        top: Math.max(12, rect.top - 50),
      });
    }
    function restore() {
      const node = mode.current ? area.current : rich.current;
      node?.focus();
      if (!mode.current && range.current) {
        if (
          rich.current?.contains(range.current.commonAncestorContainer) &&
          range.current.startContainer.isConnected &&
          range.current.endContainer.isConnected
        ) {
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range.current);
        } else range.current = null;
      }
      if (mode.current && area.current)
        area.current.setSelectionRange(
          sourceSelection.current.start,
          sourceSelection.current.end,
        );
    }
    function format(command: Format, url?: string) {
      if (command === "link" && !url) {
        setToolbar(null);
        setLink("https://");
        setLinkError("");
        setLinkDialog(true);
        return;
      }
      restore();
      if (mode.current && area.current) {
        const node = area.current;
        const { start, end } = sourceSelection.current;
        const selected = node.value.slice(start, end);
        const wrappers: Record<Format, [string, string]> = {
          bold: ["**", "**"],
          italic: ["*", "*"],
          strike: ["~~", "~~"],
          h1: ["# ", ""],
          h2: ["## ", ""],
          link: ["[", `](${url})`],
          list: ["- ", ""],
          quote: ["> ", ""],
          code: ["`", "`"],
        };
        const [before, after] = wrappers[command];
        let replacement = `${before}${selected}${after}`;
        if (["h1", "h2", "quote", "list"].includes(command))
          replacement =
            (start > 0 && node.value[start - 1] !== "\n" ? "\n" : "") +
            selected
              .split("\n")
              .map((line) => before + line)
              .join("\n");
        node.setRangeText(replacement, start, end, "end");
        if (
          start === end &&
          ["bold", "italic", "strike", "link", "code"].includes(command)
        )
          node.setSelectionRange(start + before.length, start + before.length);
      } else if (rich.current) {
        if (command === "link") {
          if (window.getSelection()?.isCollapsed) {
            const anchor = document.createElement("a");
            anchor.href = url!;
            anchor.textContent = url!;
            document.execCommand("insertHTML", false, anchor.outerHTML);
          } else document.execCommand("createLink", false, url);
        } else if (command === "code") {
          const selected = window.getSelection()?.toString() ?? "";
          const code = document.createElement("code");
          code.textContent = selected;
          document.execCommand("insertHTML", false, code.outerHTML);
        } else {
          const commands = {
            bold: "bold",
            italic: "italic",
            strike: "strikeThrough",
            h1: "formatBlock",
            h2: "formatBlock",
            list: "insertUnorderedList",
            quote: "formatBlock",
          };
          document.execCommand(
            commands[command],
            false,
            command === "h1"
              ? "h1"
              : command === "h2"
                ? "h2"
                : command === "quote"
                  ? "blockquote"
                  : undefined,
          );
        }
        rich.current.dataset.loadedValue = "";
      }
      if (command === "bold") onBold?.();
      changed();
      setToolbar(null);
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && toolbar) {
        event.preventDefault();
        event.stopPropagation();
        setToolbar(null);
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        ["b", "i", "k"].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        capture();
        format(
          ({ b: "bold", i: "italic", k: "link" } as const)[
            event.key.toLowerCase() as "b" | "i" | "k"
          ],
        );
      }
      if (source && event.key === "Tab" && area.current) {
        event.preventDefault();
        const node = area.current;
        node.setRangeText("  ", node.selectionStart, node.selectionEnd, "end");
        changed();
      }
    }

    return (
      <div className="markdown-editor-shell" onKeyDown={keydown}>
        {source ? (
          <textarea
            ref={area}
            className="document-source"
            aria-label={`${label} — исходный Markdown`}
            spellCheck={false}
            defaultValue={value}
            onInput={changed}
            onBlur={flush}
            onSelect={capture}
            onMouseUp={capture}
            onKeyUp={capture}
          />
        ) : (
          <div
            ref={rich}
            className={`rich-editor ${description ? "description-rich-editor" : ""}`}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={label}
            data-placeholder={placeholder}
            spellCheck
            onInput={() => {
              if (rich.current) rich.current.dataset.loadedValue = "";
              changed();
            }}
            onBlur={flush}
            onMouseUp={capture}
            onKeyUp={capture}
            onPaste={(event) => {
              event.preventDefault();
              const html = markdownToHtml(
                event.clipboardData.getData("text/plain"),
              );
              document.execCommand("insertHTML", false, html);
              changed();
            }}
            onClick={(event) => {
              const anchor = (event.target as HTMLElement).closest("a[href]");
              if (anchor) {
                event.preventDefault();
                const href = safeUrl(anchor.getAttribute("href") ?? "");
                if (href)
                  void openExternal(href).catch((error) =>
                    setExternalError(String(error)),
                  );
              }
            }}
          />
        )}
        {toolbar && (
          <div
            className="selection-toolbar"
            role="toolbar"
            aria-label="Форматирование текста"
            style={{ left: toolbar.left, top: toolbar.top }}
            onMouseDown={(event) => event.preventDefault()}
          >
            {formats.map(({ name, label: title, Icon }) => (
              <button
                key={name}
                type="button"
                title={title}
                aria-label={title}
                onClick={() => format(name)}
              >
                <Icon className="icon" />
              </button>
            ))}
          </div>
        )}
        {externalError && (
          <p className="editor-error" role="alert">
            Не удалось открыть ссылку: {externalError}
            <button onClick={() => setExternalError("")}>Скрыть</button>
          </p>
        )}
        {linkDialog && (
          <Dialog title="Добавить ссылку" onClose={() => setLinkDialog(false)}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const url = safeUrl(link.trim());
                if (!url) {
                  setLinkError(
                    "Введи полный адрес, который начинается с https:// или http://.",
                  );
                  return;
                }
                pendingLink.current = url;
                setLinkDialog(false);
              }}
            >
              <label className="form-label" htmlFor="editor-link-url">
                Адрес ссылки
              </label>
              <input
                autoFocus
                id="editor-link-url"
                type="url"
                required
                value={link}
                onChange={(event) => setLink(event.target.value)}
                className="form-input"
              />
              {linkError && (
                <p role="alert" className="editor-error">
                  {linkError}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setLinkDialog(false)}
                >
                  Отмена
                </button>
                <button className="primary-btn" type="submit">
                  Добавить ссылку
                </button>
              </div>
            </form>
          </Dialog>
        )}
      </div>
    );
  },
);

export default MarkdownEditor;
