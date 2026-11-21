import type {
  AnimationTimingEntry,
  BitrateMbps,
  DimensionDetectionResult,
  DurationDetectionResult,
  FormatCategory,
  HtmlAnalysisResult,
  UploadedSourceFile,
} from '../types';

export const ALLOWED_BITRATES: readonly BitrateMbps[] = [60, 80, 100, 120] as const;

export const MAX_RENDER_WIDTH = 7680;
export const MAX_RENDER_HEIGHT = 4320;

export function parseTimeToSeconds(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(ms|s)$/.exec(trimmed);
  if (!match) return null;
  const num = Number.parseFloat(match[1]);
  if (!Number.isFinite(num)) return null;
  return match[2] === 'ms' ? num / 1000 : num;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function getSimplifiedAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '16:9';
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.03) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.03) return '9:16';
  if (Math.abs(ratio - 21 / 9) < 0.08) return '21:9';
  if (Math.abs(ratio - 32 / 9) < 0.08) return '32:9';
  if (Math.abs(ratio - 4 / 3) < 0.03) return '4:3';
  if (Math.abs(ratio - 1) < 0.02) return '1:1';
  const divisor = gcd(width, height);
  const w = Math.round(width / divisor);
  const h = Math.round(height / divisor);
  if (w > 40 || h > 40) {
    return `${ratio.toFixed(2)}:1`;
  }
  return `${w}:${h}`;
}

export function classifyVideoFormat(width: number, height: number): {
  category: FormatCategory;
  formatLabel: string;
  formatLabelBn: string;
  aspectRatioLabel: string;
} {
  const ratio = width / Math.max(1, height);
  const aspectRatioLabel = getSimplifiedAspectRatio(width, height);

  // Super Ultrawide (32:9, e.g. 5120x1440, 3840x1080, 7680x2160)
  if (ratio >= 3.1) {
    return {
      category: 'super-ultrawide',
      formatLabel: 'Super Ultrawide (32:9)',
      formatLabelBn: 'সুপার আল্ট্রাওয়াইড (32:9)',
      aspectRatioLabel: '32:9',
    };
  }

  // Ultrawide (21:9, e.g. 3440x1440, 2560x1080, 3840x1600, 5120x2160)
  if (ratio >= 2.15) {
    return {
      category: 'ultrawide',
      formatLabel: 'Ultrawide (21:9)',
      formatLabelBn: 'আল্ট্রাওয়াইড (21:9)',
      aspectRatioLabel: '21:9',
    };
  }

  // 4K Horizontal (3840x2160, 4096x2160, or >=3840 wide 16:9/DCI)
  if (width >= 3840 && width > height && ratio >= 1.5 && ratio < 2.15) {
    return {
      category: '4k-horizontal',
      formatLabel: '4K Horizontal (16:9 UHD)',
      formatLabelBn: '4K হরিজন্টাল (16:9 UHD)',
      aspectRatioLabel,
    };
  }

  // 4K Vertical (2160x3840, 2160x4096, or >=3840 tall 9:16)
  if (height >= 3840 && height > width && ratio <= 0.7) {
    return {
      category: '4k-vertical',
      formatLabel: '4K Vertical (9:16 Portrait)',
      formatLabelBn: '4K ভার্টিক্যাল (9:16 পোর্ট্রেট)',
      aspectRatioLabel,
    };
  }

  if (width === 1920 && height === 1080) {
    return {
      category: 'fhd-horizontal',
      formatLabel: 'Full HD Horizontal (16:9)',
      formatLabelBn: 'ফুল HD হরিজন্টাল (16:9)',
      aspectRatioLabel: '16:9',
    };
  }

  if (width === 1080 && height === 1920) {
    return {
      category: 'fhd-vertical',
      formatLabel: 'Full HD Vertical (9:16)',
      formatLabelBn: 'ফুল HD ভার্টিক্যাল (9:16)',
      aspectRatioLabel: '9:16',
    };
  }

  return {
    category: 'custom',
    formatLabel: `Custom (${width}×${height})`,
    formatLabelBn: `কাস্টম সাইজ (${width}×${height})`,
    aspectRatioLabel,
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function bundleUploadedFiles(files: UploadedSourceFile[]): {
  bundledHtml: string;
  entryFileName: string;
} {
  if (files.length === 0) {
    return { bundledHtml: '', entryFileName: 'index.html' };
  }

  const htmlFiles = files.filter((f) => f.type === 'html');
  const cssFiles = files.filter((f) => f.type === 'css');
  const jsFiles = files.filter((f) => f.type === 'js');
  const assetFiles = files.filter((f) => f.type === 'asset');

  let entry =
    htmlFiles.find((f) => f.name.toLowerCase() === 'index.html') ||
    htmlFiles[0];

  if (!entry) {
    // Wrap standalone CSS/JS upload into a valid HTML shell
    const combinedCss = cssFiles.map((c) => c.content).join('\n');
    const combinedJs = jsFiles.map((j) => j.content).join('\n');
    return {
      entryFileName: files[0].name,
      bundledHtml: `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${combinedCss}
</style>
</head>
<body>
<script>
${combinedJs}
</script>
</body>
</html>`,
    };
  }

  let html = entry.content;

  // Replace matching local stylesheet links
  for (const cssFile of cssFiles) {
    const baseName = cssFile.name.split('/').pop() || cssFile.name;
    const linkPattern = new RegExp(
      `<link[^>]*href=["'](?:\\.\\/|\\/)?(?:[^"']*\\/)?${escapeRegExp(baseName)}["'][^>]*\\/?>`,
      'gi'
    );
    if (linkPattern.test(html)) {
      html = html.replace(linkPattern, `<style data-source="${baseName}">\n${cssFile.content}\n</style>`);
    } else if (!html.includes(`data-source="${baseName}"`)) {
      // Inject unreferenced CSS file into head or top
      const styleTag = `<style data-source="${baseName}">\n${cssFile.content}\n</style>`;
      if (/<\/head>/i.test(html)) {
        html = html.replace(/<\/head>/i, `${styleTag}\n</head>`);
      } else {
        html = `${styleTag}\n${html}`;
      }
    }
  }

  // Replace matching local script tags
  for (const jsFile of jsFiles) {
    const baseName = jsFile.name.split('/').pop() || jsFile.name;
    const scriptPattern = new RegExp(
      `<script[^>]*src=["'](?:\\.\\/|\\/)?(?:[^"']*\\/)?${escapeRegExp(baseName)}["'][^>]*>\\s*<\\/script>`,
      'gi'
    );
    if (scriptPattern.test(html)) {
      html = html.replace(scriptPattern, `<script data-source="${baseName}">\n${jsFile.content}\n</script>`);
    } else if (!html.includes(`data-source="${baseName}"`)) {
      const scriptTag = `<script data-source="${baseName}">\n${jsFile.content}\n</script>`;
      if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, `${scriptTag}\n</body>`);
      } else {
        html = `${html}\n${scriptTag}`;
      }
    }
  }

  // Replace asset references with data URLs
  for (const asset of assetFiles) {
    const baseName = asset.name.split('/').pop() || asset.name;
    const refPattern = new RegExp(
      `(["'\\(])(?:\\.\\/|\\/)?(?:[^"'\\)]*\\/)?${escapeRegExp(baseName)}(["'\\)])`,
      'gi'
    );
    html = html.replace(refPattern, `$1${asset.content}$2`);
  }

  return { bundledHtml: html, entryFileName: entry.name };
}

function stripCommentsAndStringsForCss(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface CandidateDimension {
  width: number;
  height: number;
  priority: number;
  source: string;
}

function parseAspectRatioValue(raw: string): number | null {
  const slashMatch = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/.exec(raw);
  if (slashMatch) {
    const a = Number.parseFloat(slashMatch[1]);
    const b = Number.parseFloat(slashMatch[2]);
    if (a > 0 && b > 0) return a / b;
  }
  const numMatch = /^(\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (numMatch) {
    const val = Number.parseFloat(numMatch[1]);
    if (val > 0) return val;
  }
  return null;
}

export function detectHtmlDimensions(html: string): DimensionDetectionResult {
  const candidates: CandidateDimension[] = [];

  // 1. Explicit HTML data-width / data-height or meta/comment tags
  const dataSizeMatch =
    /data-width\s*=\s*["'](\d+)["'][^>]*data-height\s*=\s*["'](\d+)["']|data-height\s*=\s*["'](\d+)["'][^>]*data-width\s*=\s*["'](\d+)["']/i.exec(
      html
    );
  if (dataSizeMatch) {
    const w = Number.parseInt(dataSizeMatch[1] || dataSizeMatch[4], 10);
    const h = Number.parseInt(dataSizeMatch[2] || dataSizeMatch[3], 10);
    if (w >= 16 && h >= 16) {
      candidates.push({ width: w, height: h, priority: 100, source: 'HTML data-width / data-height' });
    }
  }

  // CSS variables (--width / --canvas-width / --stage-width)
  const cssVarW = /--(?:canvas-|stage-|video-)?width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(html);
  const cssVarH = /--(?:canvas-|stage-|video-)?height\s*:\s*(\d+(?:\.\d+)?)px/i.exec(html);
  if (cssVarW && cssVarH) {
    const w = Math.round(Number.parseFloat(cssVarW[1]));
    const h = Math.round(Number.parseFloat(cssVarH[1]));
    if (w >= 16 && h >= 16) {
      candidates.push({ width: w, height: h, priority: 95, source: 'CSS custom properties' });
    }
  }

  // 2. Meta viewport numeric dimensions (ignoring device-width)
  const metaViewport = /<meta[^>]*name\s*=\s*["']viewport["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/i.exec(
    html
  );
  if (metaViewport) {
    const content = metaViewport[1];
    const vw = /\bwidth\s*=\s*(\d+)/i.exec(content);
    const vh = /\bheight\s*=\s*(\d+)/i.exec(content);
    if (vw && vh) {
      const w = Number.parseInt(vw[1], 10);
      const h = Number.parseInt(vh[1], 10);
      if (w >= 100 && h >= 100) {
        candidates.push({ width: w, height: h, priority: 85, source: '<meta name="viewport">' });
      }
    }
  }

  // 3. CSS rule blocks in <style> tags
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const combinedCss = stripCommentsAndStringsForCss(styleBlocks.join('\n'));
  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  const stageSelectors =
    /(?:^|[\s,.#_-])(?:html|body|:root|canvas|stage|scene|artboard|container|wrapper|frame|video|viewport|screen|workspace|root|player|display|overlay|poster|banner)(?:$|[\s,.#_-])/i;

  for (const match of combinedCss.matchAll(ruleRegex)) {
    const selector = match[1].trim();
    const body = match[2];

    const wMatch = /(?:^|;|\s)(?:width|min-width)\s*:\s*(\d+(?:\.\d+)?)px/i.exec(body);
    const hMatch = /(?:^|;|\s)(?:height|min-height)\s*:\s*(\d+(?:\.\d+)?)px/i.exec(body);
    const arMatch = /(?:^|;|\s)aspect-ratio\s*:\s*([^;]+)/i.exec(body);

    let w = wMatch ? Math.round(Number.parseFloat(wMatch[1])) : 0;
    let h = hMatch ? Math.round(Number.parseFloat(hMatch[1])) : 0;

    if (w > 0 && h === 0 && arMatch) {
      const ar = parseAspectRatioValue(arMatch[1]);
      if (ar) h = Math.round(w / ar);
    } else if (h > 0 && w === 0 && arMatch) {
      const ar = parseAspectRatioValue(arMatch[1]);
      if (ar) w = Math.round(h * ar);
    }

    if (w >= 200 && h >= 200) {
      const isStageSelector = stageSelectors.test(selector);
      // Outer canvas/stage CSS containers get higher priority (92) than inner sub-elements or icon svgs (78-82)
      const priority = isStageSelector ? 92 : 60;
      candidates.push({
        width: w,
        height: h,
        priority,
        source: `CSS selector "${selector.slice(0, 32)}"`,
      });
    }
  }

  // 4. Inline style on body or primary wrapper element
  const inlineStyleMatches = [...html.matchAll(/<(body|div|main|section|canvas|svg)\b([^>]*)>/gi)];
  for (const elMatch of inlineStyleMatches) {
    const tag = elMatch[1].toLowerCase();
    const attrs = elMatch[2];
    const styleAttr = /style\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (styleAttr) {
      const wMatch = /(?:^|;|\s)width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(styleAttr[1]);
      const hMatch = /(?:^|;|\s)height\s*:\s*(\d+(?:\.\d+)?)px/i.exec(styleAttr[1]);
      if (wMatch && hMatch) {
        const w = Math.round(Number.parseFloat(wMatch[1]));
        const h = Math.round(Number.parseFloat(hMatch[1]));
        if (w >= 200 && h >= 200) {
          candidates.push({
            width: w,
            height: h,
            priority: tag === 'body' ? 88 : 72,
            source: `Inline <${tag}> style`,
          });
        }
      }
    }

    // <canvas width="3840" height="2160"> or <svg width="3840" height="2160">
    if (tag === 'canvas' || tag === 'svg') {
      const attrW = /\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)(?:px)?["']?/i.exec(attrs);
      const attrH = /\bheight\s*=\s*["']?(\d+(?:\.\d+)?)(?:px)?["']?/i.exec(attrs);
      if (attrW && attrH) {
        const w = Math.round(Number.parseFloat(attrW[1]));
        const h = Math.round(Number.parseFloat(attrH[1]));
        if (w >= 200 && h >= 200) {
          candidates.push({ width: w, height: h, priority: 82, source: `<${tag}> attributes` });
        }
      }
      if (tag === 'svg') {
        const viewBox = /viewBox\s*=\s*["']\s*-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*["']/i.exec(
          attrs
        );
        if (viewBox) {
          const w = Math.round(Number.parseFloat(viewBox[1]));
          const h = Math.round(Number.parseFloat(viewBox[2]));
          if (w >= 200 && h >= 200) {
            candidates.push({ width: w, height: h, priority: 78, source: '<svg viewBox>' });
          }
        }
      }
    }
  }

  if (candidates.length > 0) {
    // Pick highest priority; on tie pick largest pixel area (outer stage canvas)
    candidates.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.width * b.height - a.width * a.height;
    });
    const best = candidates[0];
    const width = Math.min(MAX_RENDER_WIDTH, Math.max(16, best.width));
    const height = Math.min(MAX_RENDER_HEIGHT, Math.max(16, best.height));
    const classified = classifyVideoFormat(width, height);
    return {
      width,
      height,
      source: best.source,
      isExplicit: true,
      ...classified,
    };
  }

  // Fallback when HTML uses purely responsive 100vw/100vh without fixed pixel dimensions
  const fallbackWidth = 1920;
  const fallbackHeight = 1080;
  const classified = classifyVideoFormat(fallbackWidth, fallbackHeight);
  return {
    width: fallbackWidth,
    height: fallbackHeight,
    source: 'Responsive viewport fallback (1920×1080)',
    isExplicit: false,
    ...classified,
  };
}

function stripKeyframesBlocks(css: string): string {
  const regex = /@(?:-\w+-)?keyframes\b[^{]*\{/gi;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(css)) !== null) {
    result += css.slice(lastIndex, match.index);
    let depth = 1;
    let i = regex.lastIndex;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    lastIndex = i;
    regex.lastIndex = i;
  }

  result += css.slice(lastIndex);
  return result;
}

function extractCssCustomProperties(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  const varRegex = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;}\n]+)/g;
  for (const m of css.matchAll(varRegex)) {
    const key = m[1].trim();
    const val = m[2].trim();
    if (!vars.has(key)) {
      vars.set(key, val);
    }
  }
  return vars;
}

function resolveCssVars(raw: string, cssVars: Map<string, string>): string {
  let out = raw;
  for (let pass = 0; pass < 3; pass++) {
    if (!out.includes('var(')) break;
    const next = out.replace(
      /var\(\s*(--[a-zA-Z0-9_-]+)\s*(?:,\s*([^)]+))?\)/g,
      (_m, name: string, fallback?: string) => {
        const resolved = cssVars.get(name.trim());
        if (resolved !== undefined) return resolved;
        return fallback ? fallback.trim() : '';
      }
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

function parseFlexibleTimeValue(raw: string, preferSeconds = false): number | null {
  const trimmed = raw.trim();
  const explicit = parseTimeToSeconds(trimmed);
  if (explicit !== null) return explicit;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const n = Number.parseFloat(trimmed);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (preferSeconds) return n;
    return n >= 100 ? n / 1000 : n;
  }
  return null;
}

function parseCssAnimationShorthandItem(
  item: string,
  fallbackName: string,
  cssVars: Map<string, string>
): AnimationTimingEntry | null {
  const resolved = resolveCssVars(item, cssVars);
  const tokens = resolved
    .replace(/\([^)]*\)/g, ' ') // strip cubic-bezier(...) / steps(...)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return null;

  const times: number[] = [];
  let iterations: number | 'infinite' = 1;
  let name = fallbackName;

  const keywords = new Set([
    'normal',
    'reverse',
    'alternate',
    'alternate-reverse',
    'none',
    'forwards',
    'backwards',
    'both',
    'running',
    'paused',
    'ease',
    'ease-in',
    'ease-out',
    'ease-in-out',
    'linear',
    'step-start',
    'step-end',
    '!important',
  ]);

  for (const rawToken of tokens) {
    const token = rawToken.replace(/!important$/i, '');
    if (!token) continue;
    const timeVal = parseTimeToSeconds(token);
    if (timeVal !== null) {
      times.push(timeVal);
      continue;
    }
    if (token.toLowerCase() === 'infinite') {
      iterations = 'infinite';
      continue;
    }
    if (/^\d+(?:\.\d+)?$/.test(token)) {
      const iter = Number.parseFloat(token);
      if (iter > 0) iterations = iter;
      continue;
    }
    if (!keywords.has(token.toLowerCase())) {
      name = token;
    }
  }

  if (times.length === 0) return null;
  const durationSeconds = Math.max(0, times[0]);
  const delaySeconds = times.length > 1 ? times[1] : 0;
  if (durationSeconds <= 0) return null;

  // Treat pseudo-infinite iteration counts (e.g. 99, 999) as infinite 1-cycle loops
  if (typeof iterations === 'number' && iterations >= 20 && durationSeconds * iterations > 60) {
    iterations = 'infinite';
  }

  const totalSeconds =
    iterations === 'infinite'
      ? delaySeconds > 0
        ? delaySeconds + durationSeconds
        : durationSeconds
      : Math.max(0, delaySeconds + durationSeconds * iterations);

  return {
    name,
    durationSeconds,
    delaySeconds,
    iterations,
    totalSeconds,
    source: 'css',
  };
}

function extractRuleAnimations(
  selector: string,
  body: string,
  cssVars: Map<string, string>
): { entries: AnimationTimingEntry[]; maxTransitionSec: number } {
  const entries: AnimationTimingEntry[] = [];
  let maxTransitionSec = 0;

  // Ignore interactive pseudo-states (:hover, :active, :focus) that never run during video export
  if (/:(?:hover|active|focus|focus-visible|focus-within|visited)\b/i.test(selector)) {
    return { entries, maxTransitionSec };
  }

  // Longhand animation properties
  const durProp = /(?:^|;|\s)animation-duration\s*:\s*([^;]+)/i.exec(body);
  const delayProp = /(?:^|;|\s)animation-delay\s*:\s*([^;]+)/i.exec(body);
  const iterProp = /(?:^|;|\s)animation-iteration-count\s*:\s*([^;]+)/i.exec(body);
  const nameProp = /(?:^|;|\s)animation-name\s*:\s*([^;]+)/i.exec(body);

  if (durProp) {
    const durs = resolveCssVars(durProp[1], cssVars)
      .split(',')
      .map((s) => parseTimeToSeconds(s.replace(/!important/gi, '')) ?? 0);
    const delays = delayProp
      ? resolveCssVars(delayProp[1], cssVars)
          .split(',')
          .map((s) => parseTimeToSeconds(s.replace(/!important/gi, '')) ?? 0)
      : [0];
    const iters: Array<number | 'infinite'> = iterProp
      ? resolveCssVars(iterProp[1], cssVars)
          .split(',')
          .map((s) => {
            const t = s.replace(/!important/gi, '').trim().toLowerCase();
            if (t === 'infinite') return 'infinite';
            const n = Number.parseFloat(t);
            return Number.isFinite(n) && n > 0 ? n : 1;
          })
      : [1];
    const names = nameProp
      ? nameProp[1].split(',').map((s) => s.replace(/!important/gi, '').trim())
      : [selector.slice(0, 28)];

    for (let i = 0; i < durs.length; i++) {
      const durationSeconds = durs[i];
      if (durationSeconds <= 0) continue;
      const delaySeconds = delays[i % delays.length] ?? 0;
      let iterations = iters[i % iters.length] ?? 1;
      if (typeof iterations === 'number' && iterations >= 20 && durationSeconds * iterations > 60) {
        iterations = 'infinite';
      }
      const totalSeconds =
        iterations === 'infinite'
          ? delaySeconds > 0
            ? delaySeconds + durationSeconds
            : durationSeconds
          : Math.max(0, delaySeconds + durationSeconds * iterations);
      entries.push({
        name: names[i % names.length] || selector,
        durationSeconds,
        delaySeconds,
        iterations,
        totalSeconds,
        source: 'css',
      });
    }
  }

  // Shorthand `animation:`
  const shorthandMatches = [...body.matchAll(/(?:^|;|\s)animation\s*:\s*([^;]+)/gi)];
  for (const m of shorthandMatches) {
    const items = m[1].split(/,(?![^(]*\))/);
    for (const item of items) {
      const parsed = parseCssAnimationShorthandItem(item, selector.slice(0, 28), cssVars);
      if (parsed) entries.push(parsed);
    }
  }

  // Track CSS transitions (used to compute exact end time after JS setTimeout class toggles)
  const transDurProp = /(?:^|;|\s)transition-duration\s*:\s*([^;]+)/i.exec(body);
  const transDelayProp = /(?:^|;|\s)transition-delay\s*:\s*([^;]+)/i.exec(body);
  if (transDurProp) {
    const durs = resolveCssVars(transDurProp[1], cssVars)
      .split(',')
      .map((s) => parseTimeToSeconds(s.replace(/!important/gi, '')) ?? 0);
    const delays = transDelayProp
      ? resolveCssVars(transDelayProp[1], cssVars)
          .split(',')
          .map((s) => parseTimeToSeconds(s.replace(/!important/gi, '')) ?? 0)
      : [0];
    for (let i = 0; i < durs.length; i++) {
      const total = Math.max(0, durs[i] + (delays[i % delays.length] ?? 0));
      if (total > maxTransitionSec && total <= 30) {
        maxTransitionSec = total;
      }
    }
  }

  const transShorthandMatches = [...body.matchAll(/(?:^|;|\s)transition\s*:\s*([^;]+)/gi)];
  for (const m of transShorthandMatches) {
    const items = resolveCssVars(m[1], cssVars).split(/,(?![^(]*\))/);
    for (const item of items) {
      const tokens = item
        .replace(/\([^)]*\)/g, ' ')
        .trim()
        .split(/\s+/);
      const times: number[] = [];
      for (const tok of tokens) {
        const tv = parseTimeToSeconds(tok.replace(/!important/gi, ''));
        if (tv !== null) times.push(tv);
      }
      if (times.length > 0) {
        const total = Math.max(0, times[0] + (times[1] ?? 0));
        if (total > maxTransitionSec && total <= 30) {
          maxTransitionSec = total;
        }
      }
    }
  }

  return { entries, maxTransitionSec };
}

function extractSvgSmilAnimations(html: string): AnimationTimingEntry[] {
  const entries: AnimationTimingEntry[] = [];
  const tagRegex = /<(animate|animateTransform|animateMotion|set)\b([^>]+)>/gi;
  for (const m of html.matchAll(tagRegex)) {
    const tag = m[1];
    const attrs = m[2];
    const durMatch = /\bdur\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!durMatch) continue;
    const durSec = parseFlexibleTimeValue(durMatch[1], true);
    if (!durSec || durSec <= 0) continue;

    let delaySec = 0;
    const beginMatch = /\bbegin\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (beginMatch) {
      const beginParts = beginMatch[1].split(';');
      for (const part of beginParts) {
        const offsetMatch = /([+-]?\d+(?:\.\d+)?)(ms|s)\b/i.exec(part.trim());
        if (offsetMatch) {
          const parsed = parseTimeToSeconds(`${offsetMatch[1]}${offsetMatch[2]}`);
          if (parsed !== null && parsed > delaySec) {
            delaySec = parsed;
          }
        }
      }
    }

    const repeatMatch = /\brepeatCount\s*=\s*["']([^"']+)["']/i.exec(attrs);
    let iterations: number | 'infinite' = 1;
    if (repeatMatch) {
      const rawRep = repeatMatch[1].trim().toLowerCase();
      if (rawRep === 'indefinite') {
        iterations = 'infinite';
      } else {
        const repNum = Number.parseFloat(rawRep);
        if (Number.isFinite(repNum) && repNum > 0) iterations = repNum;
      }
    }

    const totalSeconds =
      iterations === 'infinite'
        ? delaySec + durSec
        : delaySec + durSec * iterations;

    entries.push({
      name: `SVG <${tag}>`,
      durationSeconds: Number(durSec.toFixed(2)),
      delaySeconds: Number(delaySec.toFixed(2)),
      iterations,
      totalSeconds: Number(totalSeconds.toFixed(2)),
      source: 'svg',
    });
  }
  return entries;
}

function extractBalancedParenArgs(src: string, openParenIdx: number): { args: string; endIdx: number } | null {
  if (src[openParenIdx] !== '(') return null;
  let depth = 1;
  let i = openParenIdx + 1;
  let inQuote: string | null = null;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (inQuote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inQuote) inQuote = null;
    } else {
      if (ch === '"' || ch === "'" || ch === '`') inQuote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    i++;
  }
  if (depth !== 0) return null;
  return { args: src.slice(openParenIdx + 1, i - 1), endIdx: i };
}

function splitTopLevelCommas(str: string): string[] {
  const parts: string[] = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inQuote: string | null = null;
  let start = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inQuote = ch;
    } else if (ch === '(') depthParen++;
    else if (ch === ')') depthParen--;
    else if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;
    else if (ch === '[') depthBracket++;
    else if (ch === ']') depthBracket--;
    else if (ch === ',' && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = str.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function extractGsapTimelinesAndTweens(combinedJs: string): AnimationTimingEntry[] {
  const entries: AnimationTimingEntry[] = [];
  if (!/gsap\b/i.test(combinedJs)) return entries;

  // 1. Identify GSAP timeline variable names (`const tl = gsap.timeline(...)`)
  const tlVars = new Set<string>();
  for (const m of combinedJs.matchAll(/\b(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*gsap\.timeline\s*\(/g)) {
    tlVars.add(m[1]);
  }

  const parseGsapStep = (
    method: string,
    argsStr: string,
    defaultDur: number,
    cursorSec: number,
    prevStartSec: number
  ): { startSec: number; endSec: number; durSec: number } => {
    const parts = splitTopLevelCommas(argsStr);
    const varsObj = method === 'fromTo' ? parts[2] || '' : parts[1] || '';
    const posArg = method === 'fromTo' ? parts[3] : parts[2];

    const durM = /\bduration\s*:\s*(\d+(?:\.\d+)?)/i.exec(varsObj);
    const durSec = durM ? Number.parseFloat(durM[1]) : method === 'set' ? 0 : defaultDur;
    const delayM = /\bdelay\s*:\s*(\d+(?:\.\d+)?)/i.exec(varsObj);
    const delaySec = delayM ? Number.parseFloat(delayM[1]) : 0;
    const repeatM = /\brepeat\s*:\s*(-1|\d+)/i.exec(varsObj);
    const finiteReps = repeatM && repeatM[1] !== '-1' ? Number.parseInt(repeatM[1], 10) + 1 : 1;

    let startSec = cursorSec;
    if (posArg) {
      const cleaned = posArg.trim().replace(/^['"`]|['"`]$/g, '');
      if (/^\d+(?:\.\d+)?$/.test(cleaned)) {
        startSec = Number.parseFloat(cleaned);
      } else if (/^\+=\s*(\d+(?:\.\d+)?)$/.test(cleaned)) {
        startSec = cursorSec + Number.parseFloat(cleaned.replace(/^\+=\s*/, ''));
      } else if (/^-=\s*(\d+(?:\.\d+)?)$/.test(cleaned)) {
        startSec = Math.max(0, cursorSec - Number.parseFloat(cleaned.replace(/^-=\s*/, '')));
      } else if (cleaned === '<') {
        startSec = prevStartSec;
      } else if (/^<\+?\s*(\d+(?:\.\d+)?)$/.test(cleaned)) {
        startSec = prevStartSec + Number.parseFloat(cleaned.replace(/^<\+?\s*/, ''));
      } else if (/^<-\s*(\d+(?:\.\d+)?)$/.test(cleaned)) {
        startSec = Math.max(0, prevStartSec - Number.parseFloat(cleaned.replace(/^<-\s*/, '')));
      }
    }

    const totalStepDur = delaySec + durSec * finiteReps;
    return { startSec, endSec: startSec + totalStepDur, durSec };
  };

  // Parse each timeline variable's sequential calls (`tl.to(...).from(...)` or separate statements)
  for (const varName of tlVars) {
    const tlInitMatch = new RegExp(
      `\\b${escapeRegExp(varName)}\\s*=\\s*gsap\\.timeline\\s*\\(([\\s\\S]{0,200}?)\\)`
    ).exec(combinedJs);
    let defaultDur = 0.5;
    let tlRepeat: number | 'infinite' = 1;
    if (tlInitMatch) {
      const defDurM = /\bduration\s*:\s*(\d+(?:\.\d+)?)/i.exec(tlInitMatch[1]);
      if (defDurM) defaultDur = Number.parseFloat(defDurM[1]);
      const repM = /\brepeat\s*:\s*(-1|\d+)/i.exec(tlInitMatch[1]);
      if (repM) {
        tlRepeat = repM[1] === '-1' ? 'infinite' : Number.parseInt(repM[1], 10) + 1;
      }
    }

    let cursorSec = 0;
    let prevStartSec = 0;
    let maxEndSec = 0;
    let stepCount = 0;

    // Scan only statements owned by this specific timeline variable (`tl.to(...).from(...)`)
    // so parallel timelines (`tl1` and `tl2`) never bleed into one another.
    const ownerCallRegex = new RegExp(
      `\\b${escapeRegExp(varName)}\\s*\\.(to|from|fromTo|set)\\s*\\(`,
      'g'
    );
    let match: RegExpExecArray | null;
    while ((match = ownerCallRegex.exec(combinedJs)) !== null) {
      let method = match[1];
      let openIdx = match.index + match[0].length - 1;
      while (true) {
        const extracted = extractBalancedParenArgs(combinedJs, openIdx);
        if (!extracted) break;
        const step = parseGsapStep(method, extracted.args, defaultDur, cursorSec, prevStartSec);
        prevStartSec = step.startSec;
        cursorSec = Math.max(cursorSec, step.endSec);
        maxEndSec = Math.max(maxEndSec, step.endSec);
        stepCount++;
        ownerCallRegex.lastIndex = extracted.endIdx;

        // Follow only immediately chained `.to/.from/.fromTo/.set(` calls
        const rest = combinedJs.slice(extracted.endIdx);
        const chained = /^\s*\.(to|from|fromTo|set)\s*\(/.exec(rest);
        if (!chained) break;
        method = chained[1];
        openIdx = extracted.endIdx + chained[0].length - 1;
      }
    }

    if (stepCount > 0 && maxEndSec > 0) {
      const totalSeconds =
        tlRepeat === 'infinite' ? maxEndSec : maxEndSec * tlRepeat;
      entries.push({
        name: `GSAP Timeline (${varName})`,
        durationSeconds: Number(maxEndSec.toFixed(2)),
        delaySeconds: 0,
        iterations: tlRepeat,
        totalSeconds: Number(totalSeconds.toFixed(2)),
        source: 'gsap',
      });
    }
  }

  // 2. Direct chained `gsap.timeline().to(...).to(...)` without variable assignment
  const directTlRegex = /gsap\.timeline\s*\(([\s\S]{0,160}?)\)/g;
  for (const tlM of combinedJs.matchAll(directTlRegex)) {
    const afterStart = (tlM.index ?? 0) + tlM[0].length;
    const slice = combinedJs.slice(afterStart, afterStart + 4000);
    if (!/^\s*\.(?:to|from|fromTo|set)\s*\(/.test(slice)) continue;
    const defDurM = /\bduration\s*:\s*(\d+(?:\.\d+)?)/i.exec(tlM[1]);
    const defaultDur = defDurM ? Number.parseFloat(defDurM[1]) : 0.5;
    let cursorSec = 0;
    let prevStartSec = 0;
    let maxEndSec = 0;
    let idx = 0;

    while (idx < slice.length) {
      const nextStep = /^\s*\.(to|from|fromTo|set)\s*\(/.exec(slice.slice(idx));
      if (!nextStep) break;
      const openIdx = idx + nextStep[0].length - 1;
      const extracted = extractBalancedParenArgs(slice, openIdx);
      if (!extracted) break;
      const step = parseGsapStep(nextStep[1], extracted.args, defaultDur, cursorSec, prevStartSec);
      prevStartSec = step.startSec;
      cursorSec = Math.max(cursorSec, step.endSec);
      maxEndSec = Math.max(maxEndSec, step.endSec);
      idx = extracted.endIdx;
    }

    if (maxEndSec > 0) {
      entries.push({
        name: 'GSAP Timeline',
        durationSeconds: Number(maxEndSec.toFixed(2)),
        delaySeconds: 0,
        iterations: 1,
        totalSeconds: Number(maxEndSec.toFixed(2)),
        source: 'gsap',
      });
    }
  }

  // 3. Standalone `gsap.to / from / fromTo`
  const standaloneRegex = /gsap\.(to|from|fromTo)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = standaloneRegex.exec(combinedJs)) !== null) {
    const openIdx = m.index + m[0].length - 1;
    const extracted = extractBalancedParenArgs(combinedJs, openIdx);
    if (!extracted) continue;
    const parts = splitTopLevelCommas(extracted.args);
    const opts = m[1] === 'fromTo' ? parts[2] || '' : parts[1] || '';
    const durM = /\bduration\s*:\s*(\d+(?:\.\d+)?)/i.exec(opts);
    if (!durM) continue;
    const durSec = Number.parseFloat(durM[1]);
    const delayM = /\bdelay\s*:\s*(\d+(?:\.\d+)?)/i.exec(opts);
    const delaySec = delayM ? Number.parseFloat(delayM[1]) : 0;
    const repeatM = /\brepeat\s*:\s*(-1|\d+)/i.exec(opts);
    const iterations: number | 'infinite' =
      repeatM && repeatM[1] === '-1'
        ? 'infinite'
        : repeatM
          ? Number.parseInt(repeatM[1], 10) + 1
          : 1;
    const totalSeconds =
      iterations === 'infinite' ? delaySec + durSec : delaySec + durSec * iterations;
    if (durSec > 0) {
      entries.push({
        name: 'GSAP Tween',
        durationSeconds: durSec,
        delaySeconds: delaySec,
        iterations,
        totalSeconds,
        source: 'gsap',
      });
    }
  }

  return entries;
}

function extractJsTimings(combinedJs: string, maxTransitionSec: number): AnimationTimingEntry[] {
  const entries: AnimationTimingEntry[] = [];
  if (!combinedJs.trim()) return entries;

  // Strip JS comments to avoid reading commented-out durations
  const cleanJs = combinedJs
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

  // 1. Anime.js timelines & standalone anime({...})
  if (/\banime\b/.test(cleanJs)) {
    const animeAddMatches = [...cleanJs.matchAll(/\.add\s*\(\s*\{([\s\S]{0,400}?)\}/g)];
    if (animeAddMatches.length > 0) {
      let totalMs = 0;
      for (const m of animeAddMatches) {
        const durM = /\bduration\s*:\s*(\d+(?:\.\d+)?)/.exec(m[1]);
        const delayM = /\bdelay\s*:\s*(\d+(?:\.\d+)?)/.exec(m[1]);
        totalMs += (durM ? Number.parseFloat(durM[1]) : 1000) + (delayM ? Number.parseFloat(delayM[1]) : 0);
      }
      if (totalMs > 0) {
        const sec = Number((totalMs / 1000).toFixed(2));
        entries.push({
          name: 'Anime.js Timeline',
          durationSeconds: sec,
          delaySeconds: 0,
          iterations: 1,
          totalSeconds: sec,
          source: 'js',
        });
      }
    } else {
      for (const m of cleanJs.matchAll(/\banime\s*\(\s*\{([\s\S]{0,500}?)\}\s*\)/g)) {
        const durM = /\bduration\s*:\s*(\d+(?:\.\d+)?)/.exec(m[1]);
        if (!durM) continue;
        const durSec = Number.parseFloat(durM[1]) / 1000;
        const delayM = /\bdelay\s*:\s*(\d+(?:\.\d+)?)/.exec(m[1]);
        const delaySec = delayM ? Number.parseFloat(delayM[1]) / 1000 : 0;
        const loopM = /\bloop\s*:\s*(true|\d+)/.exec(m[1]);
        const iterations: number | 'infinite' =
          loopM && loopM[1] === 'true'
            ? 'infinite'
            : loopM
              ? Math.max(1, Number.parseInt(loopM[1], 10))
              : 1;
        const totalSeconds =
          iterations === 'infinite' ? delaySec + durSec : delaySec + durSec * iterations;
        if (durSec > 0) {
          entries.push({
            name: 'Anime.js',
            durationSeconds: Number(durSec.toFixed(2)),
            delaySeconds: Number(delaySec.toFixed(2)),
            iterations,
            totalSeconds: Number(totalSeconds.toFixed(2)),
            source: 'js',
          });
        }
      }
    }
  }

  // 2. Explicit JS duration constants (e.g. `const DURATION = 12`, `const TOTAL_DURATION = 15000`, `durationMs = 8000`)
  const constDurRegex =
    /\b(?:const|let|var|window\.)\s*(TOTAL_DURATION|ANIMATION_DURATION|VIDEO_DURATION|LOOP_DURATION|CYCLE_DURATION|SCENE_DURATION|DURATION_MS|DURATION_SEC|DURATION|totalDuration|animationDuration|videoDuration|loopDuration|cycleDuration|durationMs|durationSec|totalTime|maxDuration)\s*=\s*(\d+(?:\.\d+)?(?:\s*\*\s*\d+(?:\.\d+)?)?)/g;
  for (const m of cleanJs.matchAll(constDurRegex)) {
    const varName = m[1];
    const expr = m[2];
    const parts = expr.split('*').map((s) => Number.parseFloat(s.trim()));
    const rawVal = parts.reduce((acc, n) => acc * n, 1);
    if (!Number.isFinite(rawVal) || rawVal <= 0) continue;

    let sec: number;
    if (/ms$/i.test(varName)) {
      sec = rawVal / 1000;
    } else if (/sec$/i.test(varName)) {
      sec = rawVal;
    } else {
      sec = rawVal >= 100 ? rawVal / 1000 : rawVal;
    }

    if (sec >= 0.5 && sec <= 600) {
      entries.push({
        name: `JS ${varName}`,
        durationSeconds: Number(sec.toFixed(2)),
        delaySeconds: 0,
        iterations: 1,
        totalSeconds: Number(sec.toFixed(2)),
        source: 'js',
      });
    }
  }

  // 3. Scene / step arrays with `duration` fields (`const scenes = [{ duration: 3000 }, { duration: 4000 }]`)
  const arrayRegex = /\b(?:scenes|steps|slides|timeline|phases|keyframes|acts|chapters)\s*=\s*\[([\s\S]{0,4000}?)\]/gi;
  for (const m of cleanJs.matchAll(arrayRegex)) {
    const body = m[1];
    const durs = [...body.matchAll(/\bduration\s*:\s*(\d+(?:\.\d+)?)/gi)].map((d) =>
      Number.parseFloat(d[1])
    );
    if (durs.length >= 2) {
      const sumRaw = durs.reduce((a, b) => a + b, 0);
      const isMs = durs.some((v) => v >= 100);
      const totalSec = isMs ? sumRaw / 1000 : sumRaw;
      if (totalSec >= 0.5 && totalSec <= 600) {
        entries.push({
          name: `JS Scene Timeline (${durs.length} scenes)`,
          durationSeconds: Number(totalSec.toFixed(2)),
          delaySeconds: 0,
          iterations: 1,
          totalSeconds: Number(totalSec.toFixed(2)),
          source: 'js',
        });
      }
    }
  }

  // 4. Total frames / fps calculation (`totalFrames = 300; fps = 30;`)
  const totalFramesM = /\b(?:totalFrames|TOTAL_FRAMES|frameCount|FRAME_COUNT)\s*=\s*(\d+)/.exec(cleanJs);
  const fpsM = /\b(?:fps|FPS|frameRate|FRAME_RATE)\s*=\s*(\d+(?:\.\d+)?)/.exec(cleanJs);
  if (totalFramesM && fpsM) {
    const frames = Number.parseInt(totalFramesM[1], 10);
    const fpsVal = Number.parseFloat(fpsM[1]);
    if (frames > 0 && fpsVal > 0) {
      const sec = frames / fpsVal;
      if (sec >= 0.5 && sec <= 600) {
        entries.push({
          name: `JS Frame Budget (${frames}f @ ${fpsVal}fps)`,
          durationSeconds: Number(sec.toFixed(2)),
          delaySeconds: 0,
          iterations: 1,
          totalSeconds: Number(sec.toFixed(2)),
          source: 'js',
        });
      }
    }
  }

  // 5. Cumulative `await sleep(ms)` / `await wait(ms)` / `await delay(ms)` choreography
  const sleepCalls = [...cleanJs.matchAll(/\bawait\s+(?:sleep|wait|delay)\s*\(\s*(\d+(?:\.\d+)?)\s*\)/gi)];
  if (sleepCalls.length > 0) {
    const vals = sleepCalls.map((m) => Number.parseFloat(m[1])).filter((v) => Number.isFinite(v) && v > 0);
    const isMs = vals.some((v) => v >= 100);
    const sumSec = vals.reduce((a, b) => a + (isMs ? b / 1000 : b), 0);
    if (sumSec >= 0.5 && sumSec <= 600) {
      // Do not blindly inflate an explicit sleep sequence with unrelated CSS transitions
      entries.push({
        name: `JS Async Sequence (${vals.length} steps)`,
        durationSeconds: Number(sumSec.toFixed(2)),
        delaySeconds: 0,
        iterations: 1,
        totalSeconds: Number(sumSec.toFixed(2)),
        source: 'js',
      });
    }
  }

  // 6. Staged `setTimeout(..., delayMs)` choreography
  const timeoutItems: Array<{ sec: number; isReplay: boolean }> = [];
  const timeoutRegex = /\bsetTimeout\s*\(/g;
  let tm: RegExpExecArray | null;
  while ((tm = timeoutRegex.exec(cleanJs)) !== null) {
    const openIdx = tm.index + tm[0].length - 1;
    const extracted = extractBalancedParenArgs(cleanJs, openIdx);
    if (!extracted) continue;
    const parts = splitTopLevelCommas(extracted.args);
    if (parts.length >= 2) {
      const cbExpr = parts[0].trim();
      const delayExpr = parts[1].trim();
      if (/^\d+(?:\.\d+)?(?:\s*\*\s*\d+(?:\.\d+)?)?$/.test(delayExpr)) {
        const ms = delayExpr
          .split('*')
          .map((s) => Number.parseFloat(s.trim()))
          .reduce((a, b) => a * b, 1);
        if (ms >= 150 && ms <= 600_000) {
          const isReplay =
            /\b(?:restart|replay|reset|loop|play|start|run|init|cycle|animate|begin)\b/i.test(
              cbExpr
            );
          timeoutItems.push({ sec: ms / 1000, isReplay });
        }
      }
    }
  }
  if (timeoutItems.length > 0) {
    const maxItem = timeoutItems.reduce((best, cur) => (cur.sec > best.sec ? cur : best), timeoutItems[0]);
    // Only add CSS transition duration when the final timer triggers a visual state change,
    // NOT when the final timer itself is the replay/restart boundary (e.g. `setTimeout(play, 10000)`).
    const total = maxItem.isReplay ? maxItem.sec : maxItem.sec + maxTransitionSec;
    entries.push({
      name: maxItem.isReplay
        ? `JS Replay Cycle (${maxItem.sec}s)`
        : `JS setTimeout Schedule (${timeoutItems.length} timers)`,
      durationSeconds: Number(total.toFixed(2)),
      delaySeconds: 0,
      iterations: maxItem.isReplay ? 'infinite' : 1,
      totalSeconds: Number(total.toFixed(2)),
      source: 'js',
    });
  }

  // 7. Canvas / requestAnimationFrame explicit cycle modulus (`elapsed % 10000`) or progress ratio (`progress = elapsed / 10000`)
  //    Avoids false-positive speed divisors like `Math.sin(now / 30000)`.
  if (/requestAnimationFrame/.test(cleanJs)) {
    // 7a. Explicit modulo wrap: `(now % 12000)` / `elapsed % 10000`
    const modMatches = [
      ...cleanJs.matchAll(
        /(?:\b(?:elapsed|elapsedMs|time|t|dt|now|timestamp|ts|clock|timer)|\))\s*%\s*(\d+(?:\.\d+)?)\b/g
      ),
    ];
    for (const m of modMatches) {
      const raw = Number.parseFloat(m[1]);
      if (!Number.isFinite(raw) || raw === 1000) continue;
      if (raw >= 1500 && raw <= 600_000) {
        const sec = raw / 1000;
        entries.push({
          name: `JS rAF Cycle (${raw}ms)`,
          durationSeconds: Number(sec.toFixed(2)),
          delaySeconds: 0,
          iterations: 1,
          totalSeconds: Number(sec.toFixed(2)),
          source: 'js',
        });
      }
    }

    // 7b. Explicit normalized progress variable (`const progress = elapsed / 10000` or `Math.min(1, elapsed / 10000)`)
    const progressMatches = [
      ...cleanJs.matchAll(
        /\b(?:progress|pct|ratio|frac|norm|normalized)\s*=\s*(?:Math\.min\s*\(\s*1\s*,\s*)?(?:\([^)]+\)|[a-zA-Z_$][\w$]*)\s*\/\s*(\d+(?:\.\d+)?)\b/g
      ),
    ];
    for (const m of progressMatches) {
      const raw = Number.parseFloat(m[1]);
      if (!Number.isFinite(raw) || raw === 1000) continue;
      const sec = raw >= 500 ? raw / 1000 : raw;
      if (sec >= 0.5 && sec <= 600) {
        entries.push({
          name: `JS rAF Progress (${sec.toFixed(2)}s)`,
          durationSeconds: Number(sec.toFixed(2)),
          delaySeconds: 0,
          iterations: 1,
          totalSeconds: Number(sec.toFixed(2)),
          source: 'js',
        });
      }
    }
  }

  return entries;
}

export function detectAnimationDuration(html: string): DurationDetectionResult {
  const breakdown: AnimationTimingEntry[] = [];

  // 1. Explicit total-video duration metadata (never hijacked by generic `--duration: 0.2s` UI tokens)
  const metaDurationMatch =
    /data-(?:total-|video-)?duration\s*=\s*["']([^"']+)["']|<!--\s*(?:total-)?duration\s*:\s*([^-]+?)\s*-->|<meta[^>]*name\s*=\s*["'](?:video-|animation-)?duration["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>|--(?:video|total|scene|timeline)-duration\s*:\s*([^;}\s]+)/i.exec(
      html
    );
  if (metaDurationMatch) {
    const raw = (
      metaDurationMatch[1] ||
      metaDurationMatch[2] ||
      metaDurationMatch[3] ||
      metaDurationMatch[4]
    ).trim();
    const parsed = parseFlexibleTimeValue(raw, false);
    if (parsed !== null && parsed > 0) {
      return {
        durationSeconds: Number(parsed.toFixed(2)),
        source: 'Explicit HTML duration metadata',
        breakdown: [
          {
            name: 'Explicit Duration',
            durationSeconds: Number(parsed.toFixed(2)),
            delaySeconds: 0,
            iterations: 1,
            totalSeconds: Number(parsed.toFixed(2)),
            source: 'meta',
          },
        ],
        hasInfiniteOnly: false,
        isFallback: false,
      };
    }
  }

  // 2. CSS <style> blocks (strip @keyframes cleanly so @media rules and selectors parse accurately)
  const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
  const rawCss = stripCommentsAndStringsForCss(styleBlocks.join('\n'));
  const cssVars = extractCssCustomProperties(rawCss);
  const cssWithoutKeyframes = stripKeyframesBlocks(rawCss);

  let maxTransitionSec = 0;
  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  for (const match of cssWithoutKeyframes.matchAll(ruleRegex)) {
    const selector = match[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    const body = match[2];
    const extracted = extractRuleAnimations(selector, body, cssVars);
    breakdown.push(...extracted.entries);
    if (extracted.maxTransitionSec > maxTransitionSec) {
      maxTransitionSec = extracted.maxTransitionSec;
    }
  }

  // 3. Inline style attributes
  const inlineStyles = [...html.matchAll(/style\s*=\s*["']([^"']+)["']/gi)];
  for (let i = 0; i < inlineStyles.length; i++) {
    const extracted = extractRuleAnimations(`inline-#${i + 1}`, inlineStyles[i][1], cssVars);
    breakdown.push(...extracted.entries);
    if (extracted.maxTransitionSec > maxTransitionSec) {
      maxTransitionSec = extracted.maxTransitionSec;
    }
  }

  // 4. SVG SMIL animations (<animate>, <animateTransform>, <animateMotion>, <set>)
  breakdown.push(...extractSvgSmilAnimations(html));

  // 5. Script animations: Web Animations API, GSAP timelines/tweens, Anime.js, JS timers & rAF constants
  const scriptBlocks = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const combinedJs = scriptBlocks.join('\n');

  // WAAPI: .animate(..., { duration: 4500, delay: 500, iterations: 1 })
  const waapiMatches = [
    ...combinedJs.matchAll(/\.animate\s*\([\s\S]{0,1200}?\{([\s\S]{0,350}?)\}\s*\)/gi),
  ];
  for (const m of waapiMatches) {
    const opts = m[1];
    const durM = /\bduration\s*:\s*(\d+(?:\.\d+)?)/i.exec(opts);
    if (durM) {
      const durSec = Number.parseFloat(durM[1]) / 1000;
      const delayM = /\bdelay\s*:\s*(\d+(?:\.\d+)?)/i.exec(opts);
      const delaySec = delayM ? Number.parseFloat(delayM[1]) / 1000 : 0;
      const iterM = /\biterations\s*:\s*(Infinity|\d+(?:\.\d+)?)/i.exec(opts);
      const iterations: number | 'infinite' =
        iterM && iterM[1].toLowerCase() === 'infinity'
          ? 'infinite'
          : iterM
            ? Math.max(1, Number.parseFloat(iterM[1]))
            : 1;
      const totalSeconds =
        iterations === 'infinite'
          ? delaySec > 0
            ? delaySec + durSec
            : durSec
          : Math.max(0, delaySec + durSec * iterations);
      if (durSec > 0) {
        breakdown.push({
          name: 'Web Animations API',
          durationSeconds: durSec,
          delaySeconds: delaySec,
          iterations,
          totalSeconds,
          source: 'waapi',
        });
      }
    }
  }

  // GSAP timelines & tweens
  breakdown.push(...extractGsapTimelinesAndTweens(combinedJs));

  // JS choreography, Anime.js, setTimeout, sleep, Canvas/rAF constants
  breakdown.push(...extractJsTimings(combinedJs, maxTransitionSec));

  if (breakdown.length > 0) {
    const finiteEntries = breakdown.filter((b) => b.iterations !== 'infinite');
    const infiniteEntries = breakdown.filter((b) => b.iterations === 'infinite');
    const maxFinite = finiteEntries.reduce((max, b) => Math.max(max, b.totalSeconds), 0);
    const maxInfiniteCycle = infiniteEntries.reduce(
      (max, b) => Math.max(max, b.totalSeconds),
      0
    );

    // Explicit JS replay cycle (e.g. `setTimeout(play, 10000)`) defines the exact loop boundary
    const replayEntry = infiniteEntries.find((b) => b.source === 'js' && b.name.startsWith('JS Replay Cycle'));

    const hasInfiniteOnly = finiteEntries.length === 0 && infiniteEntries.length > 0;
    // CRITICAL: When finite animations exist, NEVER let slower ambient infinite background loops
    // (e.g. `float 30s infinite` or `rotate 60s infinite`) stretch the finite timeline duration!
    const chosenSeconds = replayEntry
      ? replayEntry.totalSeconds
      : hasInfiniteOnly
        ? maxInfiniteCycle
        : maxFinite;
    const durationSeconds = Number(Math.max(0.5, chosenSeconds).toFixed(2));

    return {
      durationSeconds,
      source: replayEntry
        ? `Detected JS replay cycle (${durationSeconds}s)`
        : hasInfiniteOnly
          ? `Detected ${infiniteEntries.length} looping animation(s) — 1 full cycle`
          : `Detected ${finiteEntries.length} finite animation timeline(s)`,
      breakdown: breakdown.slice(0, 12),
      hasInfiniteOnly,
      isFallback: false,
    };
  }

  if (maxTransitionSec >= 0.5) {
    return {
      durationSeconds: Number(maxTransitionSec.toFixed(2)),
      source: 'Detected CSS transition duration',
      breakdown: [
        {
          name: 'CSS Transition',
          durationSeconds: Number(maxTransitionSec.toFixed(2)),
          delaySeconds: 0,
          iterations: 1,
          totalSeconds: Number(maxTransitionSec.toFixed(2)),
          source: 'css',
        },
      ],
      hasInfiniteOnly: false,
      isFallback: false,
    };
  }

  return {
    durationSeconds: 5.0,
    source: 'Static HTML fallback (5.0s default)',
    breakdown: [],
    hasInfiniteOnly: false,
    isFallback: true,
  };
}

export interface RuntimeDurationProbeResult {
  durationSeconds: number;
  source: string;
  breakdown: AnimationTimingEntry[];
  hasInfiniteOnly: boolean;
  confidence: 'high' | 'medium' | 'low';
  hadExactGsapTimeline?: boolean;
  hadDetectedLoopCycle?: boolean;
  hadFiniteRafStop?: boolean;
  hadDynamicDomAnimations?: boolean;
}

/**
 * Pure combiner that reconciles instant static analysis with live virtual-clock
 * runtime probing (which catches JS-staggered delays, GSAP runtime timelines,
 * setTimeout/async sleep/setInterval 1-cycle loops, and finite Canvas rAF loops).
 */
export function mergeStaticAndRuntimeDuration(
  staticResult: DurationDetectionResult,
  runtimeResult: RuntimeDurationProbeResult | null
): DurationDetectionResult {
  if (!runtimeResult || runtimeResult.durationSeconds <= 0) {
    return staticResult;
  }

  // Always preserve explicit user metadata (`data-duration`, `<!-- duration: ... -->`)
  if (staticResult.breakdown[0]?.source === 'meta') {
    return staticResult;
  }

  const rtSec = Number(Math.max(0.5, runtimeResult.durationSeconds).toFixed(2));
  const mergedBreakdown = [
    ...runtimeResult.breakdown,
    ...staticResult.breakdown,
  ].slice(0, 12);

  // 1. Live GSAP globalTimeline.totalDuration() is authoritative (whether shorter or longer than static)
  if (runtimeResult.hadExactGsapTimeline && rtSec > 0) {
    return {
      durationSeconds: rtSec,
      source: runtimeResult.source,
      breakdown: mergedBreakdown,
      hasInfiniteOnly: runtimeResult.hasInfiniteOnly,
      isFallback: false,
    };
  }

  // 2. Runtime explicitly detected a 1-cycle JS loop boundary (`setTimeout(play, 10s)`,
  //    `setInterval(restart, 10s)`, repeating DOM/sleep cycle) — authoritative over inflated static guesses
  if (runtimeResult.hadDetectedLoopCycle && rtSec >= 0.5) {
    return {
      durationSeconds: rtSec,
      source: runtimeResult.source,
      breakdown: mergedBreakdown,
      hasInfiniteOnly: runtimeResult.hasInfiniteOnly,
      isFallback: false,
    };
  }

  // 3. Static fell back to default 5.0s -> always trust runtime measurement
  if (staticResult.isFallback) {
    return {
      durationSeconds: rtSec,
      source: runtimeResult.source,
      breakdown: mergedBreakdown,
      hasInfiniteOnly: runtimeResult.hasInfiniteOnly,
      isFallback: false,
    };
  }

  // 4. Static only saw infinite loops, while runtime saw a concrete finite completion (e.g., rAF stopped or finite DOM)
  if (staticResult.hasInfiniteOnly && !runtimeResult.hasInfiniteOnly && rtSec >= 0.5) {
    return {
      durationSeconds: rtSec,
      source: runtimeResult.source,
      breakdown: mergedBreakdown,
      hasInfiniteOnly: false,
      isFallback: false,
    };
  }

  // 4b. When static analysis identified a high-confidence JS duration constant (e.g. TOTAL_DURATION = 10000ms / 20000ms),
  // NEVER let an ambient CSS loop (like dotPulse 1.2s or pulse 0.8s) from runtime probe downgrade or shorten it!
  const hasAuthoritativeJsConstant = staticResult.breakdown.some(
    (b) => b.source === 'js' && /^JS (?:TOTAL_|ANIMATION_|VIDEO_|LOOP_|CYCLE_|SCENE_|DURATION|totalDuration|animationDuration|videoDuration|durationMs|durationSec|rAF Cycle|rAF Progress)/i.test(b.name)
  );
  if (hasAuthoritativeJsConstant && runtimeResult.hasInfiniteOnly) {
    return staticResult;
  }

  // 5. High-confidence live runtime measurement (actual DOM animations, WAAPI, or finite rAF stop)
  //    supersedes static regex BOTH when longer (e.g., JS-staggered delays) AND when shorter
  //    (e.g., static matched unused CSS classes or over-added heuristic transitions).
  if (runtimeResult.confidence === 'high' && !runtimeResult.hasInfiniteOnly) {
    const hasExplicitJsConstant = hasAuthoritativeJsConstant || staticResult.breakdown.some(
      (b) => b.source === 'js' && /^JS (?:Scene Timeline|Frame Budget)/i.test(b.name)
    );
    if (!hasExplicitJsConstant || rtSec > staticResult.durationSeconds + 0.05) {
      return {
        durationSeconds: rtSec,
        source: runtimeResult.source,
        breakdown: mergedBreakdown,
        hasInfiniteOnly: false,
        isFallback: false,
      };
    }
  }

  // 6. Runtime found a longer timeline than static regex (e.g., JS-staggered CSS delays)
  if (rtSec > staticResult.durationSeconds + 0.05) {
    return {
      durationSeconds: rtSec,
      source: runtimeResult.source,
      breakdown: mergedBreakdown,
      hasInfiniteOnly: runtimeResult.hasInfiniteOnly && staticResult.hasInfiniteOnly,
      isFallback: false,
    };
  }

  return staticResult;
}

export function analyzeHtmlBundle(files: UploadedSourceFile[]): HtmlAnalysisResult {
  const { bundledHtml, entryFileName } = bundleUploadedFiles(files);
  const dimensions = detectHtmlDimensions(bundledHtml);
  const duration = detectAnimationDuration(bundledHtml);
  return {
    dimensions,
    duration,
    bundledHtml,
    entryFileName,
  };
}

export function estimateFileSizeMB(bitrateMbps: number, durationSeconds: number): number {
  if (bitrateMbps <= 0 || durationSeconds <= 0) return 0;
  return Number(((bitrateMbps * durationSeconds) / 8).toFixed(1));
}
