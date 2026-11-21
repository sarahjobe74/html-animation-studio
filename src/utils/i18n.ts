import type { LanguageCode } from '../types';

export interface UiStrings {
  navWorkbench: string;
  navPresets: string;
  navSource: string;
  navOutput: string;
  uploadAction: string;
  heroSubtitle: string;
  dropzoneTitle: string;
  dropzoneHint: string;
  chooseFiles: string;
  presetsHeading: string;
  detectedSpecsHeading: string;
  resolutionLabel: string;
  formatLabel: string;
  aspectLabel: string;
  durationLabel: string;
  autoDetectedTag: string;
  manualOverrideToggle: string;
  resetToDetected: string;
  widthPx: string;
  heightPx: string;
  secondsUnit: string;
  timelineBreakdown: string;
  bitrateHeading: string;
  bitrateDesc: Record<60 | 80 | 100 | 120, string>;
  encodingHeading: string;
  fpsLabel: string;
  containerLabel: string;
  renderEngineLabel: string;
  engineLocalGpu: string;
  engineServer: string;
  gpuUnsupportedNote: string;
  localMp4Note: string;
  estimatedSizeLabel: string;
  renderStartBtn: string;
  renderAgainBtn: string;
  renderingBtn: string;
  cancelRenderBtn: string;
  statusInitializing: string;
  statusInitializingGpu: string;
  statusCapturing: string;
  statusEncoding: string;
  statusCompleted: string;
  statusFailed: string;
  statusCancelled: string;
  frameProgress: string;
  etaLabel: string;
  downloadVideoBtn: string;
  downloadingVideoBtn: string;
  verifiedBitrateLabel: string;
  actualSizeLabel: string;
  playLabel: string;
  pauseLabel: string;
  restartLabel: string;
  matteGridLabel: string;
  applyCodeBtn: string;
  loadedFilesLabel: string;
  emptyPreviewTitle: string;
  emptyPreviewHint: string;
  runtimeDurationNote: string;
  renderRangeHeading: string;
  trimStartLabel: string;
  trimEndLabel: string;
  setInTooltip: string;
  setOutTooltip: string;
  resetTrimBtn: string;
  selectedRenderDurationLabel: string;
  fullTimelineTag: string;
}

const BN: UiStrings = {
  navWorkbench: 'ওয়ার্কবেঞ্চ',
  navPresets: 'প্রিসেট',
  navSource: 'সোর্স কোড',
  navOutput: 'রেন্ডার আউটপুট',
  uploadAction: 'ফাইল আপলোড',
  heroSubtitle:
    'HTML, CSS ও JS অ্যানিমেশন আপলোড করুন — ফাইলের আসল সাইজ (4K হরিজন্টাল, 4K ভার্টিক্যাল, আল্ট্রাওয়াইড, সুপার আল্ট্রাওয়াইড) ও সময় অনুযায়ী 60–120 Mbps ভিডিও রেন্ডার করুন।',
  dropzoneTitle: 'HTML / CSS / JS অ্যানিমেশন ফাইল এখানে ড্রপ করুন',
  dropzoneHint: 'একসাথে .html, .css, .js, .svg বা ইমেজ ফাইল আপলোড করতে পারবেন',
  chooseFiles: 'ফাইল নির্বাচন করুন',
  presetsHeading: 'টেস্ট প্রিসেট লোড করুন',
  detectedSpecsHeading: '01. অটো-ডিটেক্টেড সাইজ ও সময়',
  resolutionLabel: 'রেজোলিউশন',
  formatLabel: 'ফরম্যাট',
  aspectLabel: 'অ্যাসপেক্ট রেশিও',
  durationLabel: 'অ্যানিমেশন সময়',
  autoDetectedTag: 'HTML থেকে স্বয়ংক্রিয়ভাবে শনাক্তকৃত',
  manualOverrideToggle: 'ম্যানুয়াল এডিট',
  resetToDetected: 'অটো সাইজে ফিরুন',
  widthPx: 'প্রস্থ (px)',
  heightPx: 'উচ্চতা (px)',
  secondsUnit: 'সেকেন্ড',
  timelineBreakdown: 'অ্যানিমেশন টাইমলাইন বিবরণ',
  bitrateHeading: '02. বিটরেট নির্বাচন করুন',
  bitrateDesc: {
    60: 'স্ট্যান্ডার্ড 4K মাস্টার',
    80: 'হাই ডিটেইল প্রডাকশন',
    100: 'ব্রডকাস্ট প্রো গ্রেড',
    120: 'আল্ট্রা হাই বিটরেট',
  },
  encodingHeading: '03. এনকোডিং ও আউটপুট',
  fpsLabel: 'ফ্রেম রেট (FPS)',
  containerLabel: 'ভিডিও ফরম্যাট',
  renderEngineLabel: 'রেন্ডার ইঞ্জিন',
  engineLocalGpu: 'লোকাল GPU (হার্ডওয়্যার · দ্রুততম)',
  engineServer: 'সার্ভার (FFmpeg · CPU)',
  gpuUnsupportedNote: 'এই ব্রাউজারে WebCodecs পাওয়া যায়নি — সার্ভার ইঞ্জিন ব্যবহৃত হচ্ছে',
  localMp4Note: 'লোকাল GPU হার্ডওয়্যার মোডে MP4 (H.264 Exact CBR) আউটপুট তৈরি হয়',
  estimatedSizeLabel: 'আনুমানিক ফাইল সাইজ',
  renderStartBtn: 'ভিডিও রেন্ডার শুরু করুন',
  renderAgainBtn: 'নতুন করে রেন্ডার করুন',
  renderingBtn: 'রেন্ডারিং চলছে...',
  cancelRenderBtn: 'রেন্ডার বাতিল করুন',
  statusInitializing: 'হেডলেস ব্রাউজার প্রস্তুত হচ্ছে...',
  statusInitializingGpu: 'লোকাল GPU এনকোডার প্রস্তুত হচ্ছে...',
  statusCapturing: 'ফ্রেম-বাই-ফ্রেম ক্যাপচার হচ্ছে',
  statusEncoding: 'ভিডিও ফাইল ফাইনাল হচ্ছে...',
  statusCompleted: 'ভিডিও রেন্ডার সম্পন্ন হয়েছে',
  statusFailed: 'রেন্ডার ব্যর্থ হয়েছে',
  statusCancelled: 'রেন্ডার বাতিল করা হয়েছে',
  frameProgress: 'ফ্রেম',
  etaLabel: 'বাকি সময়',
  downloadVideoBtn: 'ভিডিও ডাউনলোড করুন',
  downloadingVideoBtn: 'ডাউনলোড হচ্ছে...',
  verifiedBitrateLabel: 'প্রকৃত বিটরেট',
  actualSizeLabel: 'ফাইল সাইজ',
  playLabel: 'চালান',
  pauseLabel: 'বিরতি',
  restartLabel: 'শুরু থেকে',
  matteGridLabel: 'গ্রিড ব্যাকড্রপ',
  applyCodeBtn: 'কোড আপডেট ও রি-ডিটেক্ট',
  loadedFilesLabel: 'আপলোডকৃত ফাইলসমূহ',
  emptyPreviewTitle: 'কোনো HTML অ্যানিমেশন লোড করা নেই',
  emptyPreviewHint: 'উপর থেকে ফাইল আপলোড করুন অথবা নিচের যেকোনো 4K / Ultrawide প্রিসেট বেছে নিন।',
  runtimeDurationNote: 'লাইভ DOM অ্যানিমেশন থেকে সময় যাচাইকৃত',
  renderRangeHeading: 'রেন্ডার রেঞ্জ',
  trimStartLabel: 'শুরু',
  trimEndLabel: 'শেষ',
  setInTooltip: 'বর্তমান পজিশন থেকে শুরু করুন',
  setOutTooltip: 'বর্তমান পজিশনে শেষ করুন',
  resetTrimBtn: 'সম্পূর্ণ টাইমলাইন',
  selectedRenderDurationLabel: 'রেন্ডার সময়',
  fullTimelineTag: 'সম্পূর্ণ',
};

const EN: UiStrings = {
  navWorkbench: 'Workbench',
  navPresets: 'Presets',
  navSource: 'Source Code',
  navOutput: 'Output',
  uploadAction: 'Upload Files',
  heroSubtitle:
    'Upload HTML, CSS & JS animations — render at exact file dimensions (4K Horizontal, 4K Vertical, Ultrawide, Super Ultrawide) and exact animation duration from 60–120 Mbps.',
  dropzoneTitle: 'Drop HTML / CSS / JS animation files here',
  dropzoneHint: 'Supports multi-file bundles (.html, .css, .js, .svg, and local images)',
  chooseFiles: 'Browse Files',
  presetsHeading: 'Load Format Presets',
  detectedSpecsHeading: '01. Detected Canvas & Duration',
  resolutionLabel: 'Resolution',
  formatLabel: 'Classification',
  aspectLabel: 'Aspect Ratio',
  durationLabel: 'Duration',
  autoDetectedTag: 'Auto-detected from HTML',
  manualOverrideToggle: 'Override',
  resetToDetected: 'Reset to Auto',
  widthPx: 'Width (px)',
  heightPx: 'Height (px)',
  secondsUnit: 'seconds',
  timelineBreakdown: 'Animation Timeline Breakdown',
  bitrateHeading: '02. Select Video Bitrate',
  bitrateDesc: {
    60: 'Standard 4K Master',
    80: 'High Detail Production',
    100: 'Broadcast Pro Grade',
    120: 'Ultra Maximum Bitrate',
  },
  encodingHeading: '03. Encoding & Output',
  fpsLabel: 'Frame Rate',
  containerLabel: 'Container',
  renderEngineLabel: 'Render Engine',
  engineLocalGpu: 'Local GPU (Hardware · Fastest)',
  engineServer: 'Server (FFmpeg · CPU)',
  gpuUnsupportedNote: 'WebCodecs unavailable in this browser — using Server engine',
  localMp4Note: 'Local GPU hardware mode outputs MP4 (H.264 Exact CBR)',
  estimatedSizeLabel: 'Estimated Size',
  renderStartBtn: 'Start Video Render',
  renderAgainBtn: 'Render Again',
  renderingBtn: 'Rendering Video...',
  cancelRenderBtn: 'Cancel Render',
  statusInitializing: 'Initializing headless Chromium...',
  statusInitializingGpu: 'Initializing local GPU hardware encoder...',
  statusCapturing: 'Capturing deterministic frames',
  statusEncoding: 'Finalizing CBR video stream...',
  statusCompleted: 'Render Completed',
  statusFailed: 'Render Failed',
  statusCancelled: 'Render Cancelled',
  frameProgress: 'Frame',
  etaLabel: 'ETA',
  downloadVideoBtn: 'Download Video',
  downloadingVideoBtn: 'Downloading...',
  verifiedBitrateLabel: 'Measured Bitrate',
  actualSizeLabel: 'File Size',
  playLabel: 'Play',
  pauseLabel: 'Pause',
  restartLabel: 'Restart',
  matteGridLabel: 'Matte Grid',
  applyCodeBtn: 'Apply & Re-Detect',
  loadedFilesLabel: 'Loaded Source Files',
  emptyPreviewTitle: 'No HTML animation loaded',
  emptyPreviewHint: 'Upload your HTML/CSS files above or pick a 4K / Ultrawide preset below.',
  runtimeDurationNote: 'Verified against live DOM animations',
  renderRangeHeading: 'Render Range',
  trimStartLabel: 'Start',
  trimEndLabel: 'End',
  setInTooltip: 'Set render start to playhead',
  setOutTooltip: 'Set render end to playhead',
  resetTrimBtn: 'Full Timeline',
  selectedRenderDurationLabel: 'Render Length',
  fullTimelineTag: 'Full',
};

export function getStrings(lang: LanguageCode): UiStrings {
  return lang === 'en' ? EN : BN;
}
