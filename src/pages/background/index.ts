/**
 * Background Service Worker — TMT Hackathon Extension
 *
 * Responsibilities:
 *  1. Translate text via the TMT API (called by content script & popup)
 *  2. Context-menu "Translate selection" item
 *  3. Page-translation orchestration (content script sends batches of sentences)
 *  4. Forward settings-change events to active content scripts
 */

// ─── Types ────────────────────────────────────────────────────────────────────

type Lang = "en" | "ne" | "tmg";

type BgMessage =
  | { type: "TRANSLATE"; text: string; srcLang: Lang; tgtLang: Lang }
  | { type: "TRANSLATE_PAGE"; srcLang: Lang; tgtLang: Lang }
  | { type: "STOP_PAGE_TRANSLATION" }
  | { type: "RESTORE_PAGE_TRANSLATION" }
  | { type: "SETTINGS_CHANGED" };

type TranslateResult =
  | { success: true; output: string; raw?: unknown }
  | { success: false; error: string; status?: number; raw?: unknown };

interface TMTRequest {
  text: string;
  src_lang: string;
  tgt_lang: string;
}

const API_URL = "https://tmt.ilprl.ku.edu.np/lang-translate";

// Cross-browser runtime (Firefox uses `browser`, Chrome uses `chrome`)
const ext: typeof browser =
  (globalThis as any).browser ?? (globalThis as any).chrome;

const LANG_ALIASES: Record<string, Lang> = {
  english: "en",
  en: "en",
  eng: "en",
  nepali: "ne",
  ne: "ne",
  nep: "ne",
  tamang: "tmg",
  tmg: "tmg",
};

const normalizeLang = (value: string): string => {
  const key = value?.toLowerCase().trim();
  return LANG_ALIASES[key] ?? value;
};

// ─── Storage helper ───────────────────────────────────────────────────────────

type StoredState = {
  apiKey: string;
  srcLang: Lang;
  tgtLang: Lang;
  tooltipEnabled: boolean;
  tooltipFontSize: number;
  tooltipSize: "sm" | "md" | "lg";
  tooltipWidth: "auto" | "half" | "full";
  autoDetect: boolean;
  rememberLangs: boolean;
  pageTranslateActive: boolean;
};

const DEFAULT_STATE: StoredState = {
  apiKey: "",
  srcLang: "en",
  tgtLang: "ne",
  tooltipEnabled: true,
  tooltipFontSize: 12,
  tooltipSize: "md",
  tooltipWidth: "auto",
  autoDetect: false,
  rememberLangs: true,
  pageTranslateActive: false,
};

async function getStoredState(): Promise<StoredState> {
  try {
    const result = await ext.storage.local.get("tmtState");
    return { ...DEFAULT_STATE, ...(result?.tmtState ?? {}) };
  } catch {
    return DEFAULT_STATE;
  }
}

// ─── Core translation function ────────────────────────────────────────────────

async function translateText(
  text: string,
  srcLang: Lang,
  tgtLang: Lang,
): Promise<TranslateResult> {
  if (!text?.trim()) {
    return { success: false, error: "Text is required." };
  }

  if (srcLang === tgtLang) {
    return {
      success: false,
      error: "Source and target languages must be different.",
    };
  }

  const { apiKey } = await getStoredState();
  if (!apiKey) {
    return {
      success: false,
      error: "No API key set. Please add your team token in Settings.",
    };
  }

  const body: TMTRequest = {
    text: text.trim(),
    src_lang: normalizeLang(srcLang),
    tgt_lang: normalizeLang(tgtLang),
  };

  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { success: false, error: "Network error. Check your connection." };
  }

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    return {
      success: false,
      status: response.status,
      error:
        response.status === 429
          ? "Too Many Requests (60 per minute)."
          : "Invalid response from server.",
    };
  }

  if (response.ok && data?.message_type === "SUCCESS") {
    return { success: true, output: data?.output ?? "", raw: data };
  }

  return {
    success: false,
    status: response.status,
    error:
      (typeof data?.message === "string" && data.message) ||
      `Translation failed (${response.status}).`,
    raw: data,
  };
}

// ─── Send message to all active content scripts ───────────────────────────────

async function broadcastToContentScripts(message: object) {
  try {
    const tabs = await ext.tabs.query({ url: ["http://*/*", "https://*/*"] });
    for (const tab of tabs) {
      if (tab.id != null) {
        ext.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab may not have a content script — ignore silently
        });
      }
    }
  } catch {
    // Ignore if tabs permissions are limited
  }
}

const getActiveTabId = async (): Promise<number | null> => {
  try {
    const tabs = await ext.tabs?.query({ active: true, currentWindow: true });
    const tabId = tabs && tabs[0]?.id;
    return typeof tabId === "number" ? tabId : null;
  } catch {
    return null;
  }
};

// ─── Context menu setup ───────────────────────────────────────────────────────

if (ext?.contextMenus) {
  ext.runtime.onInstalled.addListener(() => {
    ext.contextMenus.create({
      id: "tmt-translate-selection",
      title: "Translate selection",
      contexts: ["selection"],
    });
  });

  ext.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "tmt-translate-selection") return;
    if (!info.selectionText || !tab?.id) return;

    const { srcLang, tgtLang } = await getStoredState();
    const result = await translateText(
      info.selectionText.trim(),
      srcLang,
      tgtLang,
    );

    ext.tabs
      .sendMessage(tab.id, {
        type: "CONTEXT_MENU_RESULT",
        original: info.selectionText.trim(),
        result,
      })
      .catch(() => {});
  });
}

// ─── Message handler ──────────────────────────────────────────────────────────

ext.runtime.onMessage.addListener(
  (message: BgMessage, sender, sendResponse) => {
    if (!message || typeof message.type !== "string") {
      return false;
    }

    switch (message.type) {
      // ── Single-text translation (tooltip / selection / popup) ───────────────
      case "TRANSLATE": {
        translateText(message.text, message.srcLang, message.tgtLang).then(
          sendResponse,
        );
        return true; // keep channel open for async response
      }

      // ── Page translation — content script asks background to orchestrate ────
      case "TRANSLATE_PAGE": {
        const targetTabId = sender.tab?.id;

        if (targetTabId != null) {
          ext.tabs
            .sendMessage(targetTabId, {
              type: "START_PAGE_TRANSLATION",
              srcLang: message.srcLang,
              tgtLang: message.tgtLang,
            })
            .catch(() => {});
        } else {
          getActiveTabId().then((tabId) => {
            if (tabId != null) {
              ext.tabs
                .sendMessage(tabId, {
                  type: "START_PAGE_TRANSLATION",
                  srcLang: message.srcLang,
                  tgtLang: message.tgtLang,
                })
                .catch(() => {});
            }
          });
        }

        sendResponse({ success: true });
        return false;
      }

      case "STOP_PAGE_TRANSLATION": {
        const targetTabId = sender.tab?.id;

        if (targetTabId != null) {
          ext.tabs
            .sendMessage(targetTabId, { type: "STOP_PAGE_TRANSLATION" })
            .catch(() => {});
        } else {
          getActiveTabId().then((tabId) => {
            if (tabId != null) {
              ext.tabs
                .sendMessage(tabId, { type: "STOP_PAGE_TRANSLATION" })
                .catch(() => {});
            }
          });
        }

        sendResponse({ success: true });
        return false;
      }

      case "RESTORE_PAGE_TRANSLATION": {
        const targetTabId = sender.tab?.id;

        if (targetTabId != null) {
          ext.tabs
            .sendMessage(targetTabId, { type: "RESTORE_PAGE_TRANSLATION" })
            .catch(() => {});
        } else {
          getActiveTabId().then((tabId) => {
            if (tabId != null) {
              ext.tabs
                .sendMessage(tabId, { type: "RESTORE_PAGE_TRANSLATION" })
                .catch(() => {});
            }
          });
        }

        sendResponse({ success: true });
        return false;
      }

      // ── Settings changed — push fresh state to all content scripts ──────────
      case "SETTINGS_CHANGED": {
        getStoredState().then((state) => {
          broadcastToContentScripts({ type: "SETTINGS_UPDATED", state });
        });
        sendResponse({ success: true });
        return false;
      }

      default:
        return false;
    }
  },
);

// ─── Storage change listener (Popup saves settings) ───────────────────────────

ext.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.tmtState) return;
  getStoredState().then((state) => {
    broadcastToContentScripts({ type: "SETTINGS_UPDATED", state });
  });
});

// ─── Tab activation: sync content script with current settings ───────────────

ext.tabs?.onActivated?.addListener(async ({ tabId }) => {
  const state = await getStoredState();
  ext.tabs.sendMessage(tabId, { type: "SETTINGS_UPDATED", state }).catch(() => {
    // ignore
  });
});

console.log("[TMT] background script loaded");
