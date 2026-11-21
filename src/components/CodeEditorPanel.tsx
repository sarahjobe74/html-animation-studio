import { useEffect, useState } from 'react';
import { Check, Code2 } from 'lucide-react';
import type { LanguageCode } from '../types';
import { getStrings } from '../utils/i18n';

interface CodeEditorPanelProps {
  html: string;
  entryFileName: string;
  onApplyHtml: (updatedHtml: string) => void;
  lang: LanguageCode;
}

export function CodeEditorPanel({
  html,
  entryFileName,
  onApplyHtml,
  lang,
}: CodeEditorPanelProps) {
  const t = getStrings(lang);
  const [draft, setDraft] = useState(html);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraft(html);
  }, [html]);

  const isDirty = draft !== html;

  const handleApply = () => {
    onApplyHtml(draft);
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 1800);
  };

  return (
    <section
      aria-label={t.navSource}
      className="rounded-xl border border-white/[0.08] bg-[#12151C] overflow-hidden"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-slate-300">
          <Code2 className="h-4 w-4 text-blue-400" aria-hidden="true" />
          <span className="font-medium text-slate-100">{t.navSource}</span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span className="font-mono text-slate-400">{entryFileName}</span>
        </div>

        <button
          type="button"
          onClick={handleApply}
          disabled={!draft.trim() || (!isDirty && !savedNotice)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:bg-white/10 disabled:text-slate-400 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {savedNotice && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
          <span>{t.applyCodeBtn}</span>
        </button>
      </div>

      <label htmlFor="html-source-editor" className="sr-only">
        HTML and CSS Source Editor
      </label>
      <textarea
        id="html-source-editor"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        rows={14}
        className="block w-full resize-y bg-[#0B0D11] p-4 font-mono text-xs leading-relaxed text-slate-200 focus:outline-none"
      />
    </section>
  );
}
