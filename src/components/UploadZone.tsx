import { useRef, useState } from 'react';
import { FileCode2, FolderUp, Monitor, Smartphone, Tv } from 'lucide-react';
import type { AnimationPreset, LanguageCode, UploadedSourceFile } from '../types';
import { getStrings } from '../utils/i18n';

interface UploadZoneProps {
  files: UploadedSourceFile[];
  presets: AnimationPreset[];
  activePresetId: string | null;
  onFilesSelected: (files: FileList | File[]) => void;
  onSelectPreset: (preset: AnimationPreset) => void;
  lang: LanguageCode;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

function getPresetIcon(category: AnimationPreset['category']) {
  if (category === '4k-vertical' || category === 'fhd-vertical') {
    return Smartphone;
  }
  if (category === 'ultrawide' || category === 'super-ultrawide') {
    return Tv;
  }
  return Monitor;
}

export function UploadZone({
  files,
  presets,
  activePresetId,
  onFilesSelected,
  onSelectPreset,
  lang,
  fileInputRef,
}: UploadZoneProps) {
  const t = getStrings(lang);
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesSelected(e.dataTransfer.files);
    }
  };

  return (
    <section aria-label={t.dropzoneTitle} className="space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".html,.htm,.css,.js,.mjs,.svg,.png,.jpg,.jpeg,.webp,.gif"
        className="sr-only"
        aria-label={t.chooseFiles}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFilesSelected(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {/* Drag & Drop Multi-file Zone */}
      <div
        onDragEnter={handleDragEnter}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-dashed px-5 py-4 transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-white/15 bg-[#12151C] hover:border-white/25'
        }`}
      >
        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#191D27] text-blue-400">
            <FolderUp className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-100">{t.dropzoneTitle}</p>
            <p className="mt-0.5 text-xs text-slate-400">{t.dropzoneHint}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-[#191D27] px-4 py-2 text-xs font-medium text-slate-100 transition-colors hover:border-white/25 hover:bg-[#202634] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <span>{t.chooseFiles}</span>
        </button>
      </div>

      {/* Uploaded Files Strip (clean unboxed text with separators) */}
      {files.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs text-slate-400">
          <span className="font-medium text-slate-300">{t.loadedFilesLabel}:</span>
          {files.map((f, idx) => (
            <span key={`${f.name}-${idx}`} className="inline-flex items-center gap-1.5 font-mono">
              <FileCode2 className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
              <span className="text-slate-200">{f.name}</span>
              <span className="text-slate-500">({Math.max(1, Math.round(f.size / 1024))} KB)</span>
              {idx < files.length - 1 && (
                <span aria-hidden="true" className="ml-2 text-slate-600">
                  ·
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Format Presets Strip */}
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <h2 className="text-xs font-medium text-slate-400">{t.presetsHeading}</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {presets.map((preset) => {
            const Icon = getPresetIcon(preset.category);
            const isSelected = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => onSelectPreset(preset)}
                className={`group flex flex-col items-start gap-1.5 rounded-xl border p-3.5 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  isSelected
                    ? 'border-blue-500/70 bg-blue-500/10'
                    : 'border-white/[0.08] bg-[#12151C] hover:border-white/20 hover:bg-[#161A23]'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <Icon
                    className={`h-4 w-4 shrink-0 ${
                      isSelected ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    {preset.width}×{preset.height}
                  </span>
                </div>
                <span className="text-sm font-semibold text-slate-100 leading-snug">
                  {lang === 'en' ? preset.title : preset.titleBn}
                </span>
                <span className="font-mono text-xs text-slate-400">
                  {lang === 'en' ? preset.subtitle : preset.subtitleBn}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
