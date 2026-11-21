import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { ALLOWED_BITRATES, MAX_RENDER_HEIGHT, MAX_RENDER_WIDTH } from './src/utils/htmlAnalyzer.ts';
import type { BitrateMbps, FrameRate, VideoContainerFormat } from './src/types.ts';
import { RenderManager } from './server/renderEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  const renderManager = new RenderManager();

  app.use(express.json({ limit: '64mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/render', async (req, res) => {
    try {
      const body = req.body ?? {};
      const html = typeof body.html === 'string' ? body.html : '';
      const width = Number(body.width);
      const height = Number(body.height);
      const durationSeconds = Number(body.durationSeconds);
      const startSecondsRaw = body.startSeconds !== undefined ? Number(body.startSeconds) : 0;
      const totalTimelineSecondsRaw =
        body.totalTimelineSeconds !== undefined ? Number(body.totalTimelineSeconds) : undefined;
      const bitrateMbps = Number(body.bitrateMbps) as BitrateMbps;
      const fpsRaw = Number(body.fps || 30);
      const format: VideoContainerFormat =
        body.format === 'webm' ? 'webm' : body.format === 'mov' ? 'mov' : 'mp4';
      const fileNameBase = typeof body.fileNameBase === 'string' ? body.fileNameBase : 'animation';

      if (!html.trim()) {
        res.status(400).json({ error: 'HTML content is required.' });
        return;
      }
      if (!Number.isFinite(width) || width < 16 || width > MAX_RENDER_WIDTH) {
        res.status(400).json({ error: `Width must be between 16 and ${MAX_RENDER_WIDTH}px.` });
        return;
      }
      if (!Number.isFinite(height) || height < 16 || height > MAX_RENDER_HEIGHT) {
        res.status(400).json({ error: `Height must be between 16 and ${MAX_RENDER_HEIGHT}px.` });
        return;
      }
      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 180) {
        res.status(400).json({ error: 'Duration must be between 0.1s and 180s.' });
        return;
      }
      if (!Number.isFinite(startSecondsRaw) || startSecondsRaw < 0 || startSecondsRaw > 180) {
        res.status(400).json({ error: 'Start time must be between 0s and 180s.' });
        return;
      }
      if (!ALLOWED_BITRATES.includes(bitrateMbps)) {
        res.status(400).json({ error: 'Bitrate must be 60, 80, 100, or 120 Mbps.' });
        return;
      }
      const fps: FrameRate = fpsRaw === 24 || fpsRaw === 60 ? fpsRaw : 30;
      const totalTimelineSeconds =
        totalTimelineSecondsRaw !== undefined &&
        Number.isFinite(totalTimelineSecondsRaw) &&
        totalTimelineSecondsRaw > 0
          ? totalTimelineSecondsRaw
          : undefined;

      const job = await renderManager.startJob({
        html,
        width: Math.round(width),
        height: Math.round(height),
        durationSeconds,
        startSeconds: startSecondsRaw,
        totalTimelineSeconds,
        bitrateMbps,
        fps,
        format,
        fileNameBase,
      });

      res.status(202).json(job);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to start render job.',
      });
    }
  });

  app.get('/api/render/:id', (req, res) => {
    const job = renderManager.getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'Render job not found.' });
      return;
    }
    res.json(job);
  });

  app.delete('/api/render/:id', (req, res) => {
    const ok = renderManager.cancelJob(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Render job not found.' });
      return;
    }
    res.json({ cancelled: true });
  });

  app.get('/api/render/:id/video', (req, res) => {
    const file = renderManager.getJobFile(req.params.id);
    if (!file) {
      res.status(404).json({ error: 'Rendered video is not available.' });
      return;
    }

    const stat = fs.statSync(file.outputPath);
    const total = stat.size;
    const contentType =
      file.format === 'webm'
        ? 'video/webm'
        : file.format === 'mov'
          ? 'video/quicktime'
          : 'video/mp4';

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', 'bytes');

    // Explicit chunked slice via query params (?start=0&end=8388607) for reliable
    // authenticated fetch() downloads inside iframes and Cloud Run (<32 MiB cap).
    if (req.query.start !== undefined && req.query.end !== undefined) {
      const start = Math.max(0, Number.parseInt(String(req.query.start), 10) || 0);
      const requestedEnd = Number.parseInt(String(req.query.end), 10);
      const end = Number.isFinite(requestedEnd)
        ? Math.min(total - 1, Math.max(start, requestedEnd))
        : Math.min(total - 1, start + 8 * 1024 * 1024 - 1);

      if (start >= total) {
        res.status(416).json({ error: 'Requested byte range out of bounds.' });
        return;
      }

      const chunkSize = end - start + 1;
      res.writeHead(200, {
        'Content-Length': chunkSize,
        'Content-Type': 'application/octet-stream',
        'X-Total-Size': String(total),
      });
      fs.createReadStream(file.outputPath, { start, end }).pipe(res);
      return;
    }

    const isDownload = req.query.download === '1';
    if (isDownload) {
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    }

    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = Math.max(0, Number.parseInt(parts[0], 10) || 0);
      const maxOpenChunk = 8 * 1024 * 1024; // Cap open-ended video ranges to 8 MiB
      const end = parts[1]
        ? Math.min(total - 1, Number.parseInt(parts[1], 10))
        : Math.min(total - 1, start + maxOpenChunk - 1);

      if (start >= total || end < start) {
        res.writeHead(416, { 'Content-Range': `bytes */${total}` });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      fs.createReadStream(file.outputPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(file.outputPath).pipe(res);
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FrameForge server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
