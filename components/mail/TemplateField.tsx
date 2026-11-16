"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { VARIABLE_TOKENS } from "@/lib/customerMail";

const LABELS: Record<string, string> = {
  "{{Xung_ho}}": "Xưng hô đầu câu", "{{xung_ho}}": "Xưng hô giữa câu",
  "{{ten_goi}}": "Tên gọi", "{{ho_ten}}": "Họ tên", "{{nhom}}": "Nhóm",
};
const EXAMPLES: Record<string, string> = {
  "{{Xung_ho}}": "Bạn / Anh / Chị", "{{xung_ho}}": "bạn / anh / chị",
  "{{ten_goi}}": "Quỳnh", "{{ho_ten}}": "Lê Thị Như Quỳnh", "{{nhom}}": "PR",
};
const tokenPattern = /(\{\{(?:Xung_ho|xung_ho|ten_goi|ho_ten|nhom)\}\})/g;

/** Serialize only text and recognized template chips, never editable HTML. */
function readText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200b/g, "");
  if (node instanceof HTMLElement) {
    if (node.dataset.token && VARIABLE_TOKENS.includes(node.dataset.token as typeof VARIABLE_TOKENS[number])) return node.dataset.token;
    if (node.tagName === "BR") return "\n";
  }
  return Array.from(node.childNodes).map((child, i) => {
    const block = child instanceof HTMLElement && /^(DIV|P)$/.test(child.tagName);
    return `${block && i > 0 ? "\n" : ""}${readText(child)}`;
  }).join("");
}

function renderText(root: HTMLElement, text: string) {
  root.replaceChildren();
  for (const part of text.split(tokenPattern)) {
    if (!part) continue;
    if (!LABELS[part]) { root.append(document.createTextNode(part)); continue; }
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.token = part;
    chip.className = "inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 align-baseline text-sm font-medium text-zinc-900";
    chip.append(document.createTextNode(part.includes("xung_ho") || part.includes("Xung_ho") ? "Xưng hô" : LABELS[part]));
    chip.title = LABELS[part];
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.removeToken = "true";
    remove.setAttribute("aria-label", `Xóa ${LABELS[part].toLowerCase()}`);
    remove.className = "text-[10px] ml-0.5 rounded-full px-1 text-zinc-500 hover:bg-brand-200 focus-visible:outline-2";
    remove.textContent = "Xóa";
    chip.append(remove);
    root.append(chip);
  }
  // A trailing text node lets the caret move past the final noneditable chip.
  root.append(document.createTextNode(text.endsWith("\n") ? "\u200b" : ""));
}

export default function TemplateField({ id, label, value, onChange, maxLength, disabled, multiline = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  maxLength: number; disabled: boolean; multiline?: boolean;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const selection = useRef<Range | null>(null);
  const composing = useRef(false);
  const [open, setOpen] = useState(false);
  const [limitError, setLimitError] = useState(false);
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const history = useRef<string[]>([value]);
  const historyIndex = useRef(0);

  useLayoutEffect(() => {
    if (editor.current && readText(editor.current) !== value && !composing.current) renderText(editor.current, value);
    editor.current?.querySelectorAll<HTMLButtonElement>("[data-remove-token]").forEach((button) => { button.disabled = disabled; });
  }, [value, disabled]);

  useEffect(() => {
    function remember() {
      const current = window.getSelection();
      if (current?.rangeCount && editor.current?.contains(current.anchorNode) && editor.current.contains(current.focusNode)) selection.current = current.getRangeAt(0).cloneRange();
    }
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, []);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) { if (!wrapper.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function commit(next: string) {
    if (next.length > maxLength) {
      setLimitError(true);
      if (editor.current) renderText(editor.current, value);
      selection.current = null;
      return;
    }
    setLimitError(false);
    if (next !== value) {
      history.current = [...history.current.slice(0, historyIndex.current + 1), next].slice(-100);
      historyIndex.current = history.current.length - 1;
      onChange(next);
    }
  }

  function insert(text: string) {
    const root = editor.current;
    if (!root || disabled) return;
    const live = window.getSelection();
    const liveRange = live?.rangeCount && root.contains(live.anchorNode) && root.contains(live.focusNode) ? live.getRangeAt(0).cloneRange() : null;
    const remembered = selection.current && root.contains(selection.current.commonAncestorContainer) ? selection.current : null;
    const range = liveRange ?? remembered ?? document.createRange();
    if (!liveRange && !remembered) { range.selectNodeContents(root); range.collapse(false); }
    root.focus();
    const selectedLength = readText(range.cloneContents()).length;
    if (value.length - selectedLength + text.length > maxLength) { setLimitError(true); return; }
    range.deleteContents();
    const fragment = document.createElement("div");
    renderText(fragment, text);
    const nodes = document.createDocumentFragment();
    while (fragment.firstChild) nodes.append(fragment.firstChild);
    const end = nodes.lastChild!;
    range.insertNode(nodes);
    if (end.nodeType === Node.TEXT_NODE && end.textContent === "\u200b") range.setStart(end, 0);
    else range.setStartAfter(end);
    range.collapse(true);
    const current = window.getSelection(); current?.removeAllRanges(); current?.addRange(range);
    selection.current = range.cloneRange();
    commit(readText(root));
    setOpen(false);
  }

  return (
    <div ref={wrapper} className="relative min-w-0" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        const choices = Array.from(wrapper.current?.querySelectorAll<HTMLButtonElement>("[data-insert-token]") ?? []);
        const index = choices.indexOf(document.activeElement as HTMLButtonElement);
        choices[(index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
      }
    }}>
      <label id={`${id}-label`} className="tf-label" htmlFor={id} onClick={() => editor.current?.focus()}>{label}</label>
      <div className={`rounded-[12px] border bg-white focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-100 ${limitError ? "border-red-400" : "border-zinc-200"}`}>
        {multiline && <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 text-sm text-zinc-500"><span>Văn bản</span>{insertionButton()}</div>}
        <div className={`flex min-w-0 items-start gap-2 ${multiline ? "" : "px-3 py-2.5"}`}>
          <div ref={editor} id={id} role="textbox" aria-labelledby={`${id}-label`} aria-multiline={multiline}
            aria-readonly={disabled} aria-invalid={limitError} aria-describedby={limitError ? `${id}-error` : undefined}
            contentEditable={!disabled} suppressContentEditableWarning tabIndex={0}
            className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-900 outline-none ${multiline ? "min-h-[280px] px-4 py-3" : "min-h-7"}`}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; if (editor.current) commit(readText(editor.current)); }}
            onInput={() => { if (!composing.current && editor.current) commit(readText(editor.current)); }}
            onPaste={(event) => { event.preventDefault(); insert(event.clipboardData.getData("text/plain").replace(multiline ? /\r\n/g : /[\r\n]+/g, multiline ? "\n" : " ")); }}
            onCopy={(event) => {
              const current = window.getSelection();
              if (current?.rangeCount) { event.preventDefault(); event.clipboardData.setData("text/plain", readText(current.getRangeAt(0).cloneContents())); }
            }}
            onCut={(event) => {
              const current = window.getSelection();
              if (!disabled && current?.rangeCount) {
                event.preventDefault(); const range = current.getRangeAt(0);
                event.clipboardData.setData("text/plain", readText(range.cloneContents()));
                range.deleteContents(); commit(readText(editor.current!));
              }
            }}
            onDrop={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") { event.preventDefault(); if (multiline) insert("\n"); }
              if ((event.ctrlKey || event.metaKey) && ["b", "i", "u"].includes(event.key.toLowerCase())) event.preventDefault();
              if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
                event.preventDefault();
                const redo = event.key.toLowerCase() === "y" || event.shiftKey;
                historyIndex.current = Math.max(0, Math.min(history.current.length - 1, historyIndex.current + (redo ? 1 : -1)));
                const next = history.current[historyIndex.current];
                if (editor.current) renderText(editor.current, next);
                selection.current = null; onChange(next);
              }
            }}
            onClick={(event) => {
              const button = (event.target as HTMLElement).closest("[data-remove-token]");
              if (button && !disabled) { button.parentElement?.remove(); commit(readText(editor.current!)); editor.current?.focus(); }
            }} />
          {!multiline && insertionButton()}
        </div>
      </div>
      {limitError && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600">Tối đa {maxLength} ký tự.</p>}
      {open && <div id={menuId} role="group" aria-label={`Chèn vào ${label.toLowerCase()}`} className={`absolute right-0 z-30 mt-1 w-[min(360px,100%)] overflow-hidden rounded-[12px] border border-zinc-200 bg-white p-1 shadow-lg ${multiline ? "top-[76px]" : "top-full"}`}>
        {VARIABLE_TOKENS.map((token) => <button key={token} data-insert-token type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => insert(token)}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-brand-50 focus-visible:bg-brand-50 focus-visible:outline-none">
          <span className="flex-1 font-medium text-zinc-800">{LABELS[token]}</span><span className="text-xs text-zinc-500">{EXAMPLES[token]}</span><Plus size={15} className="text-brand-700" aria-hidden="true" />
        </button>)}
      </div>}
    </div>
  );

  function insertionButton() {
    return !disabled && <button ref={trigger} type="button" aria-expanded={open} aria-controls={menuId} aria-label={`Chèn thông tin vào ${label.toLowerCase()}`}
      onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(!open)}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-brand-500">
      <Plus size={14} aria-hidden="true" /><span className="hidden sm:inline">Chèn thông tin</span><ChevronDown size={12} aria-hidden="true" />
    </button>;
  }
}
