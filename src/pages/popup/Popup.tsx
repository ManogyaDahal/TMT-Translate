import React, { useEffect, useRef, useState } from "react";
import logo from "../../assets/img/logo.png";

type Tab = "translate" | "settings";
type TranslationMode = "tooltip" | "page";
type Lang = "en" | "ne" | "tmg";
type TooltipWidthMode = "auto" | "half" | "full";
type TooltipSize = "sm" | "md" | "lg";

type PageTranslationProgress = {
  translated: number;
  total: number;
  etaSeconds: number;
  running: boolean;
  updatedAt: number;
};

type PageTranslationMessage =
  | { type: "PAGE_TRANSLATION_PROGRESS"; payload: PageTranslationProgress }
  | { type: "PAGE_TRANSLATION_DONE"; translated: number; total: number };

interface PopupState {
  srcLang: Lang;
  tgtLang: Lang;
  mode: TranslationMode;
  tooltipEnabled: boolean;
  tooltipSize: TooltipSize;
  tooltipWidth: TooltipWidthMode;
  pageTranslateActive: boolean;
  apiKey: string;
}

const DEFAULT_STATE: PopupState = {
  srcLang: "en",
  tgtLang: "ne",
  mode: "tooltip",
  tooltipEnabled: true,
  tooltipSize: "md",
  tooltipWidth: "auto",
  pageTranslateActive: false,
  apiKey: "",
};

const LANG_LABELS: Record<Lang, string> = {
  en: "English",
  ne: "Nepali",
  tmg: "Tamang",
};

const LANGS: Lang[] = ["en", "ne", "tmg"];

const storage = (() => {
  const api =
    typeof browser !== "undefined"
      ? browser.storage.local
      : typeof chrome !== "undefined"
        ? chrome.storage.local
        : null;

  return {
    async load(): Promise<PopupState> {
      if (!api) return DEFAULT_STATE;
      try {
        const result = await api.get("tmtState");
        return { ...DEFAULT_STATE, ...(result?.tmtState ?? {}) };
      } catch {
        return DEFAULT_STATE;
      }
    },
    save(state: PopupState): void {
      if (!api) return;
      api.set({ tmtState: state }).catch(() => {});
    },
    async loadProgress(): Promise<PageTranslationProgress | null> {
      if (!api) return null;
      try {
        const result = await api.get("tmtPageProgress");
        return (result?.tmtPageProgress as PageTranslationProgress) ?? null;
      } catch {
        return null;
      }
    },
  };
})();

const runtime =
  typeof browser !== "undefined"
    ? browser.runtime
    : typeof chrome !== "undefined"
      ? chrome.runtime
      : null;

const sendRuntimeMessage = async (message: unknown) => {
  if (!runtime?.sendMessage) return undefined;
  try {
    const result = runtime.sendMessage(message as any);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      return await result;
    }
    return result;
  } catch {
    return undefined;
  }
};

// ── Icons ─────────────────────────────────────────────────────────────────────

const LogoIcon = ({ size = 13 }: { size?: number }) => (
  <img
    src={logo}
    alt="TMT Translate"
    style={{ width: size, height: size, objectFit: "contain" }}
  />
);

const TranslateIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m5 8 6 6" />
    <path d="m4 14 6-6 2-3" />
    <path d="M2 5h12" />
    <path d="M7 2h1" />
    <path d="m22 22-5-10-5 10" />
    <path d="M14 18h6" />
  </svg>
);

const SettingsIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const SwapIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 16V4m0 0L3 8m4-4l4 4" />
    <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);

const TooltipIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

// ── UI helpers ────────────────────────────────────────────────────────────────

const chevronBg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%232d3748' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`;

const selectCls =
  "text-xs font-medium text-slate-700 rounded-lg cursor-pointer outline-none border border-slate-200 bg-slate-50 focus:border-slate-600";

const selectStyle: React.CSSProperties = {
  padding: "7px 26px 7px 10px",
  appearance: "none",
  backgroundImage: chevronBg,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 8px center",
  width: "100%",
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function Popup() {
  const [tab, setTab] = useState<Tab>("translate");
  const [s, setS] = useState<PopupState>(DEFAULT_STATE);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pageProgress, setPageProgress] =
    useState<PageTranslationProgress | null>(null);
  const [progressNow, setProgressNow] = useState(Date.now());

  const hydrated = useRef(false);

  useEffect(() => {
    storage.load().then((loaded) => {
      setS(loaded);
      hydrated.current = true;
    });

    storage.loadProgress().then((progress) => {
      if (progress) setPageProgress(progress);
    });
  }, []);

  useEffect(() => {
    if (!runtime?.onMessage) return;

    const handleMessage = (message: PageTranslationMessage) => {
      if (message?.type === "PAGE_TRANSLATION_PROGRESS") {
        setPageProgress(message.payload);
      }
      if (message?.type === "PAGE_TRANSLATION_DONE") {
        const updatedAt = Date.now();
        setPageProgress((prev) =>
          prev
            ? {
                ...prev,
                translated: message.translated,
                total: message.total,
                etaSeconds: 0,
                running: false,
                updatedAt,
              }
            : {
                translated: message.translated,
                total: message.total,
                etaSeconds: 0,
                running: false,
                updatedAt,
              },
        );
      }
    };

    runtime.onMessage.addListener(handleMessage);
    return () => {
      runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setProgressNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (hydrated.current) {
      storage.save(s);
    }
  }, [s]);

  const update = (patch: Partial<PopupState>) =>
    setS((prev) => ({ ...prev, ...patch }));

  const handleSrcChange = (lang: Lang) => {
    update(
      lang === s.tgtLang
        ? { srcLang: lang, tgtLang: s.srcLang }
        : { srcLang: lang },
    );
  };

  const handleTgtChange = (lang: Lang) => {
    update(
      lang === s.srcLang
        ? { srcLang: s.tgtLang, tgtLang: lang }
        : { tgtLang: lang },
    );
  };

  const swapLangs = () => update({ srcLang: s.tgtLang, tgtLang: s.srcLang });

  const handleSaveSettings = () => {
    storage.save(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const formatEta = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getRemainingSeconds = (progress: PageTranslationProgress) => {
    const elapsed = Math.floor((progressNow - progress.updatedAt) / 1000);
    return Math.max(progress.etaSeconds - elapsed, 0);
  };

  const getEtaLabel = (progress: PageTranslationProgress) => {
    const remaining = getRemainingSeconds(progress);
    if (!progress.running && remaining > 0) {
      return `Paused (rate limit) — resumes in ${formatEta(remaining)}`;
    }
    if (progress.running && remaining > 0) {
      return `Estimated time: ${formatEta(remaining)} (60 calls/min)`;
    }
    return progress.running ? "Estimated time: calculating..." : "Paused";
  };

  const handlePageTranslationToggle = () => {
    const nextActive = !s.pageTranslateActive;
    update({ pageTranslateActive: nextActive });

    if (nextActive) {
      sendRuntimeMessage({
        type: "TRANSLATE_PAGE",
        srcLang: s.srcLang,
        tgtLang: s.tgtLang,
      });
      return;
    }

    sendRuntimeMessage({ type: "STOP_PAGE_TRANSLATION" });
    setPageProgress((prev) => (prev ? { ...prev, running: false } : prev));
  };

  const handleRestorePage = () => {
    update({ pageTranslateActive: false });
    sendRuntimeMessage({ type: "RESTORE_PAGE_TRANSLATION" });
    setPageProgress(null);
  };

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        width: 320,
        minHeight: tab === "settings" ? "auto" : 360,
        fontFamily: "'DM Sans','Segoe UI',sans-serif",
        fontSize: 13,
        color: "#1a202c",
        background: "#fff",
        border: "1px solid #e2e8f0",
      }}
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ background: "#2d3748" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center rounded-md"
            style={{
              width: 26,
              height: 26,
              background: "rgba(255,255,255,0.15)",
              color: "#fff",
            }}
          >
            <LogoIcon size={18} />
          </div>
          <span
            className="font-semibold text-white"
            style={{ fontSize: 14, letterSpacing: "0.02em" }}
          >
            TMT Translate
          </span>
        </div>

        <div className="flex gap-1">
          {(["translate", "settings"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex items-center gap-1.5 rounded-md border-none cursor-pointer transition-all duration-150"
              style={{
                padding: "5px 11px",
                fontSize: 11,
                fontWeight: tab === t ? 600 : 400,
                background:
                  tab === t ? "rgba(255,255,255,0.18)" : "transparent",
                color: tab === t ? "#fff" : "rgba(255,255,255,0.55)",
              }}
            >
              {t === "translate" ? <TranslateIcon /> : <SettingsIcon />}
              {t === "translate" ? "Translate" : "Settings"}
            </button>
          ))}
        </div>
      </div>

      {/* ══ TRANSLATE TAB ══ */}
      {tab === "translate" && (
        <div className="flex flex-col flex-1">
          {/* Language pair */}
          <div
            className="px-4 pt-3.5 pb-3"
            style={{ borderBottom: "1px solid #edf2f7" }}
          >
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <select
                  value={s.srcLang}
                  onChange={(e) => handleSrcChange(e.target.value as Lang)}
                  className={selectCls}
                  style={selectStyle}
                >
                  {LANGS.map((l) => (
                    <option key={l} value={l}>
                      {LANG_LABELS[l]}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={swapLangs}
                className="flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 cursor-pointer hover:bg-slate-50 transition-colors flex-shrink-0"
                style={{ width: 30, height: 30 }}
                title="Swap languages"
              >
                <SwapIcon />
              </button>

              <div className="flex-1">
                <select
                  value={s.tgtLang}
                  onChange={(e) => handleTgtChange(e.target.value as Lang)}
                  className={selectCls}
                  style={selectStyle}
                >
                  {LANGS.map((l) => (
                    <option key={l} value={l}>
                      {LANG_LABELS[l]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Mode selector */}
          <div
            className="px-4 py-3"
            style={{ borderBottom: "1px solid #edf2f7" }}
          >
            <p
              className="mb-2 font-semibold text-slate-500 uppercase tracking-widest"
              style={{ fontSize: 11 }}
            >
              Mode
            </p>
            <div className="flex gap-1.5">
              {[
                {
                  id: "tooltip" as TranslationMode,
                  label: "Tooltip",
                  icon: <TooltipIcon />,
                },
                {
                  id: "page" as TranslationMode,
                  label: "Full Page",
                  icon: <LogoIcon size={12} />,
                },
              ].map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => update({ mode: id })}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg cursor-pointer transition-all duration-150"
                  style={{
                    padding: "7px 6px",
                    fontSize: 11,
                    fontWeight: 500,
                    border:
                      s.mode === id
                        ? "1.5px solid #2d3748"
                        : "1.5px solid #e2e8f0",
                    background: s.mode === id ? "#2d3748" : "#f7fafc",
                    color: s.mode === id ? "#fff" : "#4a5568",
                  }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Mode content */}
          <div className="px-4 py-3.5 flex-1">
            {s.mode === "tooltip" && (
              <div className="flex flex-col gap-3.5">
                <div>
                  <p
                    className="font-medium text-slate-700"
                    style={{ margin: 0, fontSize: 12 }}
                  >
                    Tooltip size
                  </p>
                  <div className="flex gap-1.5 mt-2">
                    {[
                      { id: "sm", label: "Small" },
                      { id: "md", label: "Medium" },
                      { id: "lg", label: "Large" },
                    ].map(({ id, label }) => (
                      <button
                        key={id}
                        onClick={() =>
                          update({ tooltipSize: id as TooltipSize })
                        }
                        className="flex-1 rounded-lg cursor-pointer transition-all duration-150"
                        style={{
                          padding: "6px 8px",
                          fontSize: 11,
                          fontWeight: 500,
                          border:
                            s.tooltipSize === id
                              ? "1.5px solid #2d3748"
                              : "1.5px solid #e2e8f0",
                          background:
                            s.tooltipSize === id ? "#2d3748" : "#f7fafc",
                          color: s.tooltipSize === id ? "#fff" : "#4a5568",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p
                    className="font-medium text-slate-700"
                    style={{ margin: 0, fontSize: 12 }}
                  >
                    Tooltip width
                  </p>
                  <div className="flex gap-1.5 mt-2">
                    {[
                      { id: "auto", label: "Auto" },
                      { id: "half", label: "50%" },
                      { id: "full", label: "Full" },
                    ].map(({ id, label }) => (
                      <button
                        key={id}
                        onClick={() =>
                          update({ tooltipWidth: id as TooltipWidthMode })
                        }
                        className="flex-1 rounded-lg cursor-pointer transition-all duration-150"
                        style={{
                          padding: "6px 8px",
                          fontSize: 11,
                          fontWeight: 500,
                          border:
                            s.tooltipWidth === id
                              ? "1.5px solid #2d3748"
                              : "1.5px solid #e2e8f0",
                          background:
                            s.tooltipWidth === id ? "#2d3748" : "#f7fafc",
                          color: s.tooltipWidth === id ? "#fff" : "#4a5568",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p
                    className="text-slate-400"
                    style={{ margin: "6px 0 0", fontSize: 11 }}
                  >
                    Controls the tooltip max width
                  </p>
                </div>
              </div>
            )}

            {s.mode === "page" && (
              <div>
                <p
                  className="text-slate-600 mb-2.5 leading-relaxed"
                  style={{ fontSize: 12 }}
                >
                  Translate the entire page from{" "}
                  <strong>{LANG_LABELS[s.srcLang]}</strong> to{" "}
                  <strong>{LANG_LABELS[s.tgtLang]}</strong>.
                </p>
                <button
                  onClick={
                    pageProgress &&
                    pageProgress.total > 0 &&
                    pageProgress.translated >= pageProgress.total &&
                    !pageProgress.running
                      ? handleRestorePage
                      : handlePageTranslationToggle
                  }
                  className="w-full rounded-lg border-none font-semibold cursor-pointer transition-colors duration-150"
                  style={{
                    padding: 9,
                    fontSize: 12,
                    background:
                      pageProgress &&
                      pageProgress.total > 0 &&
                      pageProgress.translated >= pageProgress.total &&
                      !pageProgress.running
                        ? "#2d3748"
                        : s.pageTranslateActive
                          ? "#e53e3e"
                          : "#2d3748",
                    color: "#fff",
                    letterSpacing: "0.02em",
                  }}
                >
                  {pageProgress &&
                  pageProgress.total > 0 &&
                  pageProgress.translated >= pageProgress.total &&
                  !pageProgress.running
                    ? "Restore Original Page"
                    : s.pageTranslateActive
                      ? "Stop Page Translation"
                      : "Translate This Page"}
                </button>

                {pageProgress && (
                  <div className="mt-2 text-slate-500" style={{ fontSize: 11 }}>
                    <div>
                      Progress: {pageProgress.translated}/{pageProgress.total}{" "}
                      sentences •{" "}
                      {pageProgress.total > 0
                        ? Math.min(
                            100,
                            Math.round(
                              (pageProgress.translated / pageProgress.total) *
                                100,
                            ),
                          )
                        : 0}
                      %
                    </div>
                    <div>
                      Remaining:{" "}
                      {Math.max(
                        pageProgress.total - pageProgress.translated,
                        0,
                      )}{" "}
                      sentences
                    </div>
                    <div>{getEtaLabel(pageProgress)}</div>
                  </div>
                )}

                {!(
                  pageProgress &&
                  pageProgress.total > 0 &&
                  pageProgress.translated >= pageProgress.total &&
                  !pageProgress.running
                ) && (
                  <button
                    onClick={handleRestorePage}
                    className="w-full mt-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-600 cursor-pointer font-medium transition-colors duration-150 hover:bg-slate-100"
                    style={{ padding: 8, fontSize: 12 }}
                  >
                    Restore Original Page
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between px-4 py-2.5 bg-slate-50"
            style={{ borderTop: "1px solid #edf2f7" }}
          >
            <span className="text-slate-400" style={{ fontSize: 10 }}>
              Google TMT Hackathon 2026
            </span>
            <span
              className="text-slate-400 font-medium"
              style={{ fontSize: 10 }}
            >
              {LANG_LABELS[s.srcLang]} → {LANG_LABELS[s.tgtLang]}
            </span>
          </div>
        </div>
      )}

      {/* ══ SETTINGS TAB ══ */}
      {tab === "settings" && (
        <div className="flex flex-col flex-1">
          {/* API Key */}
          <div
            className="px-4 py-3.5"
            style={{ borderBottom: "1px solid #edf2f7" }}
          >
            <p
              className="mb-1.5 font-semibold text-slate-500 uppercase tracking-widest"
              style={{ fontSize: 11 }}
            >
              API Key
            </p>
            <div className="flex gap-1.5">
              <input
                type={showKey ? "text" : "password"}
                placeholder="team_xxxxxxxxxxxxxxxx"
                value={s.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 outline-none focus:border-slate-600"
                style={{
                  padding: "7px 10px",
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="rounded-lg border border-slate-200 bg-slate-50 text-slate-600 cursor-pointer font-medium"
                style={{ padding: "6px 10px", fontSize: 11 }}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
            <p className="mt-1 text-slate-400" style={{ fontSize: 10 }}>
              Stored locally. Never sent anywhere except the TMT API.
            </p>
          </div>

          {/* Save */}
          <div className="px-4 py-3 bg-slate-50">
            <button
              onClick={handleSaveSettings}
              className="w-full rounded-lg border-none font-semibold cursor-pointer transition-all duration-200"
              style={{
                padding: 9,
                fontSize: 12,
                background: saved ? "#276749" : "#2d3748",
                color: "#fff",
                letterSpacing: "0.02em",
              }}
            >
              {saved ? "✓ Saved" : "Save Settings"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
