import { Upload } from 'lucide-react';
import type { LanguageCode } from '../types';
import { getStrings } from '../utils/i18n';

export type WorkspaceSection = 'workbench' | 'presets' | 'source' | 'output';

interface TopBarProps {
  activeSection: WorkspaceSection;
  onSelectSection: (section: WorkspaceSection) => void;
  onTriggerUpload: () => void;
  lang: LanguageCode;
}

export function TopBar({
  activeSection,
  onSelectSection,
  onTriggerUpload,
  lang,
}: TopBarProps) {
  const t = getStrings(lang);

  const navItems: Array<{ id: WorkspaceSection; label: string }> = [
    { id: 'workbench', label: t.navWorkbench },
    { id: 'presets', label: t.navPresets },
    { id: 'source', label: t.navSource },
    { id: 'output', label: t.navOutput },
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#0B0D11]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
        {/* Zone 1: Single-line Brand Wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onSelectSection('workbench');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm"
        >
          FrameForge
        </a>

        {/* Zone 2: Clean single-line navigation links */}
        <nav aria-label="Primary" className="hidden md:flex items-center gap-6">
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={`relative py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-sm ${
                  isActive
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[15px] h-[2px] bg-blue-500"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single primary action button */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onTriggerUpload}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 active:bg-blue-700 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            <span>{t.uploadAction}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
