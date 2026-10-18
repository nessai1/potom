import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const modalStack: HTMLElement[] = [];
const inertBefore = new Map<HTMLElement, boolean>();
let priorOverflow = "";

function syncModalInert() {
  const top = modalStack.at(-1);
  if (!top) {
    inertBefore.forEach((value, node) => {
      node.inert = value;
    });
    inertBefore.clear();
    document.body.style.overflow = priorOverflow;
    return;
  }
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (!inertBefore.has(child)) inertBefore.set(child, Boolean(child.inert));
    child.inert = !child.contains(top);
  }
}

export function useModalFocus(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const closeRef = useRef(onClose);
  const priorFocus = useRef(document.activeElement as HTMLElement | null);
  closeRef.current = onClose;
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previous = priorFocus.current;
    if (!modalStack.length) priorOverflow = document.body.style.overflow;
    modalStack.push(node);
    document.body.style.overflow = "hidden";
    syncModalInert();
    const observer = new MutationObserver(syncModalInert);
    observer.observe(document.body, { childList: true });
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button, input, select, textarea, a[href], [contenteditable="true"], [tabindex]',
        ),
      ).filter(
        (el) =>
          !el.hasAttribute("disabled") &&
          el.tabIndex !== -1 &&
          !el.closest("[inert]") &&
          el.getClientRects().length > 0,
      );
    const initial =
      node.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ??
      focusable()[0] ??
      node;
    initial.focus();
    function keydown(event: KeyboardEvent) {
      if (modalStack.at(-1) !== node || event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const items = focusable();
        const first = items[0] ?? node;
        const last = items.at(-1) ?? node;
        if (
          !node!.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    }
    function focusin(event: FocusEvent) {
      if (modalStack.at(-1) === node && !node!.contains(event.target as Node))
        (focusable()[0] ?? node!).focus();
    }
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    return () => {
      observer.disconnect();
      modalStack.splice(modalStack.indexOf(node), 1);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
      syncModalInert();
      if (previous?.isConnected && !previous.closest("[inert]"))
        previous.focus();
    };
  }, [ref]);
}

export interface DialogProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}

export default function Dialog({
  title,
  children,
  onClose,
  className = "",
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useModalFocus(ref, onClose);
  return createPortal(
    <div
      className="modal-backdrop potom-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal potom-dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
      >
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          <button
            className="icon-btn"
            aria-label="Закрыть окно"
            onClick={onClose}
          >
            <X className="icon" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
