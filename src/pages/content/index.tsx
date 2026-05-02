type Lang = "en" | "ne" | "tmg";

type TranslateResult =
  | { success: true; output: string }
  | { success: false; error: string; status?: number };

type ContextMenuResultMessage = {
  type: "CONTEXT_MENU_RESULT";
  original: string;
  result: TranslateResult;
};

type SettingsUpdatedMessage = {
  type: "SETTINGS_UPDATED";
  state?: {
    tooltipFontSize?: number;
    tooltipSize?: "sm" | "md" | "lg";
    tooltipWidth?: "auto" | "half" | "full";
  };
};

type StartPageTranslationMessage = {
  type: "START_PAGE_TRANSLATION";
  srcLang: Lang;
  tgtLang: Lang;
};

type StopPageTranslationMessage = {
  type: "STOP_PAGE_TRANSLATION";
};

type RestorePageTranslationMessage = {
  type: "RESTORE_PAGE_TRANSLATION";
};

type PageTranslationProgressMessage = {
  type: "PAGE_TRANSLATION_PROGRESS";
  payload: {
    translated: number;
    total: number;
    etaSeconds: number;
    running: boolean;
    updatedAt: number;
  };
};

type PageTranslationDoneMessage = {
  type: "PAGE_TRANSLATION_DONE";
  translated: number;
  total: number;
};

type PageTranslationMessage =
  | StartPageTranslationMessage
  | StopPageTranslationMessage
  | RestorePageTranslationMessage;

const ext: typeof browser =
  (globalThis as any).browser ?? (globalThis as any).chrome;

const TOOLTIP_ID = "__tmt_tooltip";
const DEFAULT_TOOLTIP_FONT_SIZE = 12;
const DEFAULT_TOOLTIP_SIZE = "md";
const DEFAULT_TOOLTIP_WIDTH = "auto";
const TOOLTIP_SIZE_MAP: Record<"sm" | "md" | "lg", number> = {
  sm: 12,
  md: 14,
  lg: 16,
};

const RATE_LIMIT_MS = 1200;
const MAX_SENTENCES = Number.POSITIVE_INFINITY;

let currentTooltipSize: "sm" | "md" | "lg" = DEFAULT_TOOLTIP_SIZE;
let currentTooltipWidth: "auto" | "half" | "full" = DEFAULT_TOOLTIP_WIDTH;
let currentTooltipFontSize = DEFAULT_TOOLTIP_FONT_SIZE;

let activePageRunId = 0;
let pageTranslationRunning = false;
let lastRequestAt = 0;
const originalTextMap = new Map<Text, string>();
let currentTotalSentences = 0;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const enforceRateLimit = async () => {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastRequestAt);
  if (wait > 0) {
    await delay(wait);
  }
  lastRequestAt = Date.now();
};

const applySettings = (state?: {
  tooltipFontSize?: number;
  tooltipSize?: "sm" | "md" | "lg";
  tooltipWidth?: "auto" | "half" | "full";
}) => {
  if (!state) return;

  if (state.tooltipSize && state.tooltipSize in TOOLTIP_SIZE_MAP) {
    currentTooltipSize = state.tooltipSize;
    currentTooltipFontSize = TOOLTIP_SIZE_MAP[currentTooltipSize];
  } else if (
    typeof state.tooltipFontSize === "number" &&
    !Number.isNaN(state.tooltipFontSize)
  ) {
    currentTooltipFontSize = state.tooltipFontSize;
  }

  if (
    state.tooltipWidth === "auto" ||
    state.tooltipWidth === "half" ||
    state.tooltipWidth === "full"
  ) {
    currentTooltipWidth = state.tooltipWidth;
  }
};

const loadInitialSettings = async () => {
  try {
    const result = await ext.storage?.local?.get("tmtState");
    applySettings(result?.tmtState);
  } catch {
    // ignore
  }
};

const removeTooltip = () => {
  const existing = document.getElementById(TOOLTIP_ID);
  if (existing) existing.remove();
};

const getSelectionRect = (): DOMRect | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect && (rect.width || rect.height)) return rect;
  return null;
};

const showTooltip = (text: string, rect: DOMRect | null) => {
  removeTooltip();

  const tooltip = document.createElement("div");
  tooltip.id = TOOLTIP_ID;
  tooltip.textContent = text;

  const width =
    currentTooltipWidth === "full"
      ? "100vw"
      : currentTooltipWidth === "half"
        ? "50vw"
        : "auto";

  const maxWidth =
    currentTooltipWidth === "full"
      ? "100vw"
      : currentTooltipWidth === "half"
        ? "50vw"
        : "320px";

  Object.assign(tooltip.style, {
    position: "fixed",
    zIndex: "2147483647",
    maxWidth,
    width,
    padding: "8px 10px",
    borderRadius: "8px",
    background: "rgba(45,55,72,0.95)",
    color: "#fff",
    fontSize: `${currentTooltipFontSize}px`,
    lineHeight: "1.4",
    boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
    pointerEvents: "auto",
    whiteSpace: "pre-wrap",
  } as CSSStyleDeclaration);

  document.body.appendChild(tooltip);

  const margin = 8;
  const tooltipRect = tooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = margin;
  let top = margin;

  if (rect) {
    left = rect.left;
    top = rect.bottom + margin;
  } else {
    left = (viewportWidth - tooltipRect.width) / 2;
    top = viewportHeight - tooltipRect.height - margin;
  }

  if (left + tooltipRect.width + margin > viewportWidth) {
    left = viewportWidth - tooltipRect.width - margin;
  }
  if (left < margin) left = margin;

  if (top + tooltipRect.height + margin > viewportHeight) {
    top = (rect ? rect.top : viewportHeight / 2) - tooltipRect.height - margin;
  }
  if (top < margin) top = margin;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;

  if (currentTooltipWidth === "full") {
    tooltip.style.left = "0px";
    tooltip.style.right = "0px";
  }

  const handleOutsideClick = () => {
    removeTooltip();
    document.removeEventListener("mousedown", handleOutsideClick);
  };

  document.addEventListener("mousedown", handleOutsideClick);
};

const handleContextMenuResult = (message: ContextMenuResultMessage) => {
  const { result } = message;
  const text = result.success ? result.output : `Error: ${result.error}`;

  const rect = getSelectionRect();
  showTooltip(text, rect);
};

const shouldTranslateSentence = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  try {
    return /\p{L}/u.test(trimmed);
  } catch {
    return /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF\u0900-\u097F\u0F00-\u0FFF]/.test(
      trimmed,
    );
  }
};

const splitIntoParts = (text: string) => {
  const parts: { text: string; translate: boolean }[] = [];
  const sentenceRegex = /[^.!?\n]+[.!?]+|[^.!?\n]+$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sentenceRegex.exec(text))) {
    if (match.index > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, match.index),
        translate: false,
      });
    }

    const sentence = match[0];
    parts.push({
      text: sentence,
      translate: shouldTranslateSentence(sentence),
    });

    lastIndex = match.index + sentence.length;
  }

  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      translate: false,
    });
  }

  return parts;
};

const sendTranslate = async (
  text: string,
  srcLang: Lang,
  tgtLang: Lang,
): Promise<TranslateResult> => {
  if (!ext?.runtime?.sendMessage) {
    return { success: false, error: "Messaging unavailable" };
  }

  try {
    const response = await ext.runtime.sendMessage({
      type: "TRANSLATE",
      text,
      srcLang,
      tgtLang,
    });
    return response as TranslateResult;
  } catch {
    return { success: false, error: "Translation request failed" };
  }
};

const sendProgress = async (
  translated: number,
  total: number,
  running: boolean,
) => {
  if (!ext?.runtime?.sendMessage) return;
  const remaining = Math.max(total - translated, 0);
  const etaSeconds = Math.ceil((remaining * RATE_LIMIT_MS) / 1000);
  const updatedAt = Date.now();

  const payload = { translated, total, etaSeconds, running, updatedAt };

  try {
    await ext.runtime.sendMessage({
      type: "PAGE_TRANSLATION_PROGRESS",
      payload,
    } as PageTranslationProgressMessage);
  } catch {
    // ignore
  }

  try {
    await ext.storage?.local?.set({
      tmtPageProgress: payload,
    });
  } catch {
    // ignore
  }
};

const sendDone = async (translated: number, total: number) => {
  if (!ext?.runtime?.sendMessage) return;
  try {
    await ext.runtime.sendMessage({
      type: "PAGE_TRANSLATION_DONE",
      translated,
      total,
    } as PageTranslationDoneMessage);
  } catch {
    // ignore
  }
};

const translateParts = async (
  parts: { text: string; translate: boolean }[],
  srcLang: Lang,
  tgtLang: Lang,
  runId: number,
  startCount: number,
  originalText: string,
  node: Text,
  totalSentences: number,
) => {
  let count = startCount;
  let output = "";

  const getRemaining = (index: number) =>
    parts
      .slice(index + 1)
      .map((part) => part.text)
      .join("");

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];

    if (runId !== activePageRunId) {
      return { text: originalText, count, canceled: true };
    }

    if (!part.translate || count >= MAX_SENTENCES) {
      output += part.text;
      const remaining = getRemaining(i);
      if (node.isConnected) {
        node.textContent = output + remaining;
        await nextFrame();
      }
      continue;
    }

    let resolved = false;

    while (!resolved) {
      if (runId !== activePageRunId) {
        return { text: originalText, count, canceled: true };
      }

      await enforceRateLimit();
      const result = await sendTranslate(part.text, srcLang, tgtLang);

      if (!result.success && result.status === 429) {
        await sendProgress(count, totalSentences, false);
        await delay(60000);
        await sendProgress(count, totalSentences, true);
        continue;
      }

      count += 1;

      if (result.success && result.output.trim()) {
        output += result.output;
      } else {
        output += part.text;
      }

      const remaining = getRemaining(i);
      if (node.isConnected) {
        node.textContent = output + remaining;
        await nextFrame();
      }

      await sendProgress(count, totalSentences, true);
      resolved = true;
    }
  }

  return { text: output, count, canceled: false };
};

const BLOCKED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "IFRAME",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "BUTTON",
  "CODE",
  "PRE",
]);

const isTranslatableTextNode = (node: Text) => {
  const text = node.textContent ?? "";
  if (!text.trim()) return false;

  const parent = node.parentElement;
  if (!parent) return false;
  if (BLOCKED_TAGS.has(parent.tagName)) return false;
  if (parent.isContentEditable) return false;

  const style = window.getComputedStyle(parent);
  if (style.display === "none" || style.visibility === "hidden") return false;

  return true;
};

const collectTextNodes = () => {
  if (!document.body) return [] as Text[];

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
        return isTranslatableTextNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    },
  );

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
};

const countTranslatableSentences = (
  parts: { text: string; translate: boolean }[],
) => parts.reduce((acc, part) => acc + (part.translate ? 1 : 0), 0);

const startPageTranslation = async (srcLang: Lang, tgtLang: Lang) => {
  const runId = ++activePageRunId;
  pageTranslationRunning = true;

  let translatedCount = 0;
  currentTotalSentences = 0;

  const nodes = collectTextNodes();

  for (const node of nodes) {
    const text = node.textContent ?? "";
    const parts = splitIntoParts(text);
    currentTotalSentences += countTranslatableSentences(parts);
    if (currentTotalSentences >= MAX_SENTENCES) {
      currentTotalSentences = MAX_SENTENCES;
      break;
    }
  }

  await sendProgress(0, currentTotalSentences, true);

  for (const node of nodes) {
    if (runId !== activePageRunId) break;
    if (translatedCount >= MAX_SENTENCES) break;

    const originalText = node.textContent ?? "";
    if (!originalText.trim()) continue;

    if (!originalTextMap.has(node)) {
      originalTextMap.set(node, originalText);
    }

    const parts = splitIntoParts(originalText);
    const result = await translateParts(
      parts,
      srcLang,
      tgtLang,
      runId,
      translatedCount,
      originalText,
      node,
      currentTotalSentences,
    );

    if (result.canceled) break;
    translatedCount = result.count;

    if (result.text !== originalText) {
      node.textContent = result.text;
    }
  }

  if (runId === activePageRunId) {
    pageTranslationRunning = false;
    await sendDone(translatedCount, currentTotalSentences);
    await sendProgress(translatedCount, currentTotalSentences, false);
  }
};

const stopPageTranslation = () => {
  activePageRunId += 1;
  pageTranslationRunning = false;
};

const restoreOriginalPage = () => {
  stopPageTranslation();
  for (const [node, originalText] of originalTextMap.entries()) {
    if (node.isConnected) {
      node.textContent = originalText;
    }
  }
  originalTextMap.clear();
  currentTotalSentences = 0;
  sendProgress(0, 0, false);
};

ext.runtime.onMessage.addListener((message: any) => {
  if (message?.type === "CONTEXT_MENU_RESULT") {
    handleContextMenuResult(message as ContextMenuResultMessage);
    return;
  }

  if (message?.type === "SETTINGS_UPDATED") {
    applySettings((message as SettingsUpdatedMessage).state);
    return;
  }

  if (message?.type === "START_PAGE_TRANSLATION") {
    if (!pageTranslationRunning) {
      const payload = message as StartPageTranslationMessage;
      startPageTranslation(payload.srcLang, payload.tgtLang);
    }
    return;
  }

  if (message?.type === "STOP_PAGE_TRANSLATION") {
    stopPageTranslation();
    return;
  }

  if (message?.type === "RESTORE_PAGE_TRANSLATION") {
    restoreOriginalPage();
  }
});

loadInitialSettings();
console.log("[TMT] content script loaded");
