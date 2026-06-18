const INDENT = "  ";

const safeRegexCount = (value, regex) => (value.match(regex) || []).length;

const formatCode = (language, code = "") => {
  const lines = code.replace(/\t/g, INDENT).split(/\r?\n/);
  let indentLevel = 0;

  const formatted = lines.map((rawLine) => {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      return "";
    }

    const decreaseBefore = /^[}\])]/.test(trimmed);
    if (decreaseBefore && indentLevel > 0) {
      indentLevel -= 1;
    }

    const currentIndent = INDENT.repeat(indentLevel);
    const nextLine = `${currentIndent}${trimmed}`;

    const opening = safeRegexCount(trimmed, /[({[]/g);
    const closing = safeRegexCount(trimmed, /[)}\]]/g);
    indentLevel = Math.max(indentLevel + opening - closing, 0);

    return nextLine;
  });

  return formatted.join("\n").replace(/\s+$/, "");
};

const insertTextAtCursor = (textarea, text) => {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;

  textarea.value = `${value.slice(0, start)}${text}${value.slice(end)}`;
  const newPos = start + text.length;
  textarea.selectionStart = textarea.selectionEnd = newPos;
};

const getCurrentLine = (value, cursorIndex) => {
  const lineStart = value.lastIndexOf("\n", cursorIndex - 1) + 1;
  const lineEnd = value.indexOf("\n", cursorIndex);
  const safeLineEnd = lineEnd === -1 ? value.length : lineEnd;
  return value.slice(lineStart, safeLineEnd);
};

const handleEnterIndent = (textarea) => {
  const { selectionStart, selectionEnd, value } = textarea;
  const before = value.slice(0, selectionStart);
  const after = value.slice(selectionEnd);
  const currentLine = getCurrentLine(value, selectionStart);
  const baseIndent = currentLine.match(/^[ \t]*/)?.[0] ?? "";
  const trimmedLine = currentLine.trimEnd();
  const shouldIncrease = /[{[(]\s*$/.test(trimmedLine);
  const nextIndent = `${baseIndent}${shouldIncrease ? INDENT : ""}`;
  const insert = `\n${nextIndent}`;
  textarea.value = `${before}${insert}${after}`;
  const caretPos = before.length + insert.length;
  textarea.selectionStart = textarea.selectionEnd = caretPos;
};

const enhanceCodeEditor = (textarea, language, { onEdit } = {}) => {
  if (!textarea) return () => {};

  const notifyEdit = () => {
    if (typeof onEdit === "function") {
      onEdit();
    }
  };

  const formatEditorValue = () => {
    const formatted = formatCode(language, textarea.value);
    if (formatted !== textarea.value) {
      const cursor = textarea.selectionStart;
      textarea.value = formatted;
      textarea.selectionStart = textarea.selectionEnd = Math.min(cursor, formatted.length);
      notifyEdit();
    }
  };

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      insertTextAtCursor(textarea, INDENT);
      notifyEdit();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleEnterIndent(textarea);
      notifyEdit();
    }
  });

  textarea.addEventListener("blur", formatEditorValue);
  textarea.addEventListener("paste", () => setTimeout(formatEditorValue, 0));

  return formatEditorValue;
};

export { enhanceCodeEditor, formatCode };

