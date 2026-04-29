import React, { useState, useEffect, useRef } from 'react';

type Tab = 'translate' | 'settings';
type TranslationMode = 'tooltip' | 'page' | 'selection';
type Lang = 'en' | 'ne' | 'tmg';

interface PopupState {
  srcLang: Lang;
  tgtLang: Lang;
  mode: TranslationMode;
  tooltipEnabled: boolean;
  autoDetect: boolean;
  rememberLangs: boolean;
  pageTranslateActive: boolean;
  apiKey: string;
}

const DEFAULT_STATE: PopupState = {
  srcLang: 'en',
  tgtLang: 'ne',
  mode: 'tooltip',
  tooltipEnabled: true,
  autoDetect: false,
  rememberLangs: true,
  pageTranslateActive: false,
  apiKey: '',
};

const LANG_LABELS: Record<Lang, string> = {
  en: 'English',
  ne: 'Nepali',
  tmg: 'Tamang',
};

const LANGS: Lang[] = ['en', 'ne', 'tmg'];

// ── Storage (Firefox uses browser.storage.local; falls back to chrome) ───────
// We deliberately use .local — Firefox doesn't support sync without a paid
// Mozilla account, and local is fine for extension preferences.

const storage = (() => {
  // webextension-polyfill exposes `browser`; raw Firefox also has it globally.
  // If neither exists we fall back to chrome (Chrome/Edge).
  const api =
    typeof browser !== 'undefined'
      ? browser.storage.local
      : typeof chrome !== 'undefined'
      ? chrome.storage.local
      : null;

  return {
    async load(): Promise<PopupState> {
      if (!api) return DEFAULT_STATE;
      try {
        const result = await api.get('tmtState');
        return { ...DEFAULT_STATE, ...(result?.tmtState ?? {}) };
      } catch {
        return DEFAULT_STATE;
      }
    },
    save(state: PopupState): void {
      if (!api) return;
      api.set({ tmtState: state }).catch(() => {/* ignore */});
    },
  };
})();

// ── Icons ─────────────────────────────────────────────────────────────────────

const GlobeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);
const TranslateIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m5 8 6 6" /><path d="m4 14 6-6 2-3" /><path d="M2 5h12" /><path d="M7 2h1" />
    <path d="m22 22-5-10-5 10" /><path d="M14 18h6" />
  </svg>
);
const SettingsIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);
const SwapIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 16V4m0 0L3 8m4-4l4 4" /><path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
  </svg>
);
const TooltipIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);
const SelectionIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
  </svg>
);

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="flex-shrink-0 relative cursor-pointer rounded-full transition-colors duration-200"
      style={{ width: 34, height: 18, background: checked ? '#2d3748' : '#cbd5e0' }}
    >
      <div
        className="absolute top-0.5 rounded-full bg-white transition-all duration-200"
        style={{ width: 14, height: 14, left: checked ? 18 : 2, boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}
      />
    </div>
  );
}

// ── Shared select styles ──────────────────────────────────────────────────────

const chevronBg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%232d3748' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E")`;

const selectCls =
  'text-xs font-medium text-slate-700 rounded-lg cursor-pointer outline-none border border-slate-200 bg-slate-50 focus:border-slate-600';

const selectStyle: React.CSSProperties = {
  padding: '7px 26px 7px 10px',
  appearance: 'none',
  backgroundImage: chevronBg,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 8px center',
  width: '100%',
};

// ── Main Component ────────────────────────────────────────────────────────────

export default function Popup() {
  // Start with DEFAULT_STATE immediately — no loading screen ever shown
  const [tab, setTab] = useState<Tab>('translate');
  const [s, setS] = useState<PopupState>(DEFAULT_STATE);
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  // True once we've done the initial storage read (suppresses the first save)
  const hydrated = useRef(false);

  // Load persisted state once on mount, silently update UI
  useEffect(() => {
    storage.load().then((loaded) => {
      setS(loaded);
      hydrated.current = true;
    });
  }, []);

  // Persist on every state change AFTER hydration (avoids overwriting with defaults)
  useEffect(() => {
    if (hydrated.current) {
      storage.save(s);
    }
  }, [s]);

  const update = (patch: Partial<PopupState>) =>
    setS((prev) => ({ ...prev, ...patch }));

  // Prevent same→same: auto-swap the other side
  const handleSrcChange = (lang: Lang) => {
    update(lang === s.tgtLang
      ? { srcLang: lang, tgtLang: s.srcLang }
      : { srcLang: lang });
  };

  const handleTgtChange = (lang: Lang) => {
    update(lang === s.srcLang
      ? { srcLang: s.tgtLang, tgtLang: lang }
      : { tgtLang: lang });
  };

  const swapLangs = () => update({ srcLang: s.tgtLang, tgtLang: s.srcLang });

  const handleSaveSettings = () => {
    storage.save(s);
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{
        width: 320,
        minHeight: 360,
        fontFamily: "'DM Sans','Segoe UI',sans-serif",
        fontSize: 13,
        color: '#1a202c',
        background: '#fff',
        border: '1px solid #e2e8f0',
      }}
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3" style={{ background: '#2d3748' }}>
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center rounded-md"
            style={{ width: 26, height: 26, background: 'rgba(255,255,255,0.15)', color: '#fff' }}
          >
            <GlobeIcon />
          </div>
          <span className="font-semibold text-white" style={{ fontSize: 14, letterSpacing: '0.02em' }}>
            TMT Translate
          </span>
        </div>

        <div className="flex gap-1">
          {(['translate', 'settings'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex items-center gap-1.5 rounded-md border-none cursor-pointer transition-all duration-150"
              style={{
                padding: '5px 11px',
                fontSize: 11,
                fontWeight: tab === t ? 600 : 400,
                background: tab === t ? 'rgba(255,255,255,0.18)' : 'transparent',
                color: tab === t ? '#fff' : 'rgba(255,255,255,0.55)',
              }}
            >
              {t === 'translate' ? <TranslateIcon /> : <SettingsIcon />}
              {t === 'translate' ? 'Translate' : 'Settings'}
            </button>
          ))}
        </div>
      </div>

      {/* ══ TRANSLATE TAB ══ */}
      {tab === 'translate' && (
        <div className="flex flex-col flex-1">

          {/* Language pair */}
          <div className="px-4 pt-3.5 pb-3" style={{ borderBottom: '1px solid #edf2f7' }}>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <select
                  value={s.srcLang}
                  onChange={(e) => handleSrcChange(e.target.value as Lang)}
                  className={selectCls}
                  style={selectStyle}
                >
                  {LANGS.map((l) => (
                    <option key={l} value={l}>{LANG_LABELS[l]}</option>
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
                    <option key={l} value={l}>{LANG_LABELS[l]}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Mode selector */}
          <div className="px-4 py-3" style={{ borderBottom: '1px solid #edf2f7' }}>
            <p className="mb-2 font-semibold text-slate-500 uppercase tracking-widest" style={{ fontSize: 11 }}>
              Mode
            </p>
            <div className="flex gap-1.5">
              {([
                { id: 'tooltip' as TranslationMode, label: 'Tooltip',   icon: <TooltipIcon /> },
                { id: 'page'    as TranslationMode, label: 'Full Page', icon: <GlobeIcon /> },
                { id: 'selection' as TranslationMode, label: 'Selection', icon: <SelectionIcon /> },
              ]).map(({ id, label, icon }) => (
                <button
                  key={id}
                  onClick={() => update({ mode: id })}
                  className="flex flex-1 items-center justify-center gap-1 rounded-lg cursor-pointer transition-all duration-150"
                  style={{
                    padding: '7px 6px',
                    fontSize: 11,
                    fontWeight: 500,
                    border: s.mode === id ? '1.5px solid #2d3748' : '1.5px solid #e2e8f0',
                    background: s.mode === id ? '#2d3748' : '#f7fafc',
                    color: s.mode === id ? '#fff' : '#4a5568',
                  }}
                >
                  {icon}{label}
                </button>
              ))}
            </div>
          </div>

          {/* Mode content */}
          <div className="px-4 py-3.5 flex-1">
            {s.mode === 'tooltip' && (
              <div className="flex flex-col gap-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-700" style={{ margin: 0, fontSize: 12 }}>Hover Tooltip</p>
                    <p className="text-slate-400" style={{ margin: '2px 0 0', fontSize: 11 }}>Show translation on hover</p>
                  </div>
                  <Toggle checked={s.tooltipEnabled} onChange={(v) => update({ tooltipEnabled: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-700" style={{ margin: 0, fontSize: 12 }}>Auto-detect Language</p>
                    <p className="text-slate-400" style={{ margin: '2px 0 0', fontSize: 11 }}>Detect source automatically</p>
                  </div>
                  <Toggle checked={s.autoDetect} onChange={(v) => update({ autoDetect: v })} />
                </div>
              </div>
            )}

            {s.mode === 'page' && (
              <div>
                <p className="text-slate-600 mb-2.5 leading-relaxed" style={{ fontSize: 12 }}>
                  Translate the entire page from <strong>{LANG_LABELS[s.srcLang]}</strong> to <strong>{LANG_LABELS[s.tgtLang]}</strong>.
                </p>
                <button
                  onClick={() => update({ pageTranslateActive: !s.pageTranslateActive })}
                  className="w-full rounded-lg border-none font-semibold cursor-pointer transition-colors duration-150"
                  style={{
                    padding: 9,
                    fontSize: 12,
                    background: s.pageTranslateActive ? '#e53e3e' : '#2d3748',
                    color: '#fff',
                    letterSpacing: '0.02em',
                  }}
                >
                  {s.pageTranslateActive ? 'Stop Page Translation' : 'Translate This Page'}
                </button>
              </div>
            )}

            {s.mode === 'selection' && (
              <div>
                <p className="text-slate-600 mb-2.5 leading-relaxed" style={{ fontSize: 12 }}>
                  Select any text and a translate button will appear inline.
                </p>
                <div
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50"
                  style={{ padding: '9px 12px' }}
                >
                  <div className="rounded-full flex-shrink-0" style={{ width: 7, height: 7, background: '#48bb78' }} />
                  <span className="text-slate-500" style={{ fontSize: 11 }}>Selection mode is always active</span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between px-4 py-2.5 bg-slate-50"
            style={{ borderTop: '1px solid #edf2f7' }}
          >
            <span className="text-slate-400" style={{ fontSize: 10 }}>Google TMT Hackathon 2026</span>
            <span className="text-slate-400 font-medium" style={{ fontSize: 10 }}>
              {LANG_LABELS[s.srcLang]} → {LANG_LABELS[s.tgtLang]}
            </span>
          </div>
        </div>
      )}

      {/* ══ SETTINGS TAB ══ */}
      {tab === 'settings' && (
        <div className="flex flex-col flex-1">

          {/* Default Languages */}
          <div className="px-4 py-3.5" style={{ borderBottom: '1px solid #edf2f7' }}>
            <p className="mb-2 font-semibold text-slate-500 uppercase tracking-widest" style={{ fontSize: 11 }}>
              Default Languages
            </p>
            <div className="flex gap-2">
              <div className="flex-1">
                <p className="mb-1 text-slate-500" style={{ fontSize: 11 }}>From</p>
                <select
                  value={s.srcLang}
                  onChange={(e) => handleSrcChange(e.target.value as Lang)}
                  className={selectCls}
                  style={selectStyle}
                >
                  {LANGS.map((l) => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <p className="mb-1 text-slate-500" style={{ fontSize: 11 }}>To</p>
                <select
                  value={s.tgtLang}
                  onChange={(e) => handleTgtChange(e.target.value as Lang)}
                  className={selectCls}
                  style={selectStyle}
                >
                  {LANGS.map((l) => <option key={l} value={l}>{LANG_LABELS[l]}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Behavior */}
          <div className="px-4 py-3.5 flex-1" style={{ borderBottom: '1px solid #edf2f7' }}>
            <p className="mb-2 font-semibold text-slate-500 uppercase tracking-widest" style={{ fontSize: 11 }}>
              Behavior
            </p>
            <div className="flex flex-col gap-3.5">
              {([
                { label: 'Show tooltip on hover',   sub: 'Display translation popup',  key: 'tooltipEnabled' },
                { label: 'Auto-detect language',    sub: 'Detect source language',     key: 'autoDetect' },
                { label: 'Remember last languages', sub: 'Persist language preference', key: 'rememberLangs' },
              ] as { label: string; sub: string; key: keyof PopupState }[]).map(({ label, sub, key }) => (
                <div key={key} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-slate-700" style={{ margin: 0, fontSize: 12 }}>{label}</p>
                    <p className="text-slate-400" style={{ margin: '1px 0 0', fontSize: 11 }}>{sub}</p>
                  </div>
                  <Toggle
                    checked={s[key] as boolean}
                    onChange={(v) => update({ [key]: v })}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Save */}
          <div className="px-4 py-3 bg-slate-50">
            <button
              onClick={handleSaveSettings}
              className="w-full rounded-lg border-none font-semibold cursor-pointer transition-all duration-200"
              style={{
                padding: 9,
                fontSize: 12,
                background: saved ? '#276749' : '#2d3748',
                color: '#fff',
                letterSpacing: '0.02em',
              }}
            >
              {saved ? '✓ Saved' : 'Save Settings'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
