import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { menu } from './routes/menu.js';
import { triggers } from './routes/triggers.js';
import { generateImage as geminiImage } from './gemini.js';
import { removeBackground } from './chromakey.js';
import { createResponse, getResponse } from './openai-responses.js';
import { JobManager } from './job-manager.js';
import { DraftManager } from './draft-manager.js';
import { buildPrompt, buildEditPrompt, parseResponse } from '../shared/game-prompt.js';
import { validateGame } from '../shared/game-schema.js';
import { DEFAULT_OPENAI_MODEL } from '../shared/defaults.js';
import { PNG } from 'pngjs';

const app = new Hono();
const api = new Hono();

// Lazy-init managers (need redis from devvit context)
let jobManager = null;
let draftManager = null;

async function getManagers() {
  if (!jobManager) {
    const { redis } = await import('@devvit/web/server');
    jobManager = new JobManager(redis);
    draftManager = new DraftManager(redis);
  }
  return { jobManager, draftManager };
}

function extractMetadata(gameCode, description) {
  let metadata = { title: description.slice(0, 50) };
  const titleMatch = gameCode.match(/title:\s*['"]([^'"]+)['"]/);
  if (titleMatch) metadata.title = titleMatch[1];
  const descMatch = gameCode.match(/description:\s*['"]([^'"]+)['"]/);
  if (descMatch) metadata.description = descMatch[1];
  return metadata;
}

// Init — return game data for game posts, or starter type
api.get('/init', async (c) => {
  const { context, reddit, redis } = await import('@devvit/web/server');
  const username = await reddit.getCurrentUsername();
  const postId = context.postId;

  const gameCode = await redis.get(`game:${postId}:code`);

  if (gameCode) {
    const metaRaw = await redis.get(`game:${postId}:metadata`);
    const metadata = metaRaw ? JSON.parse(metaRaw) : null;
    const description = await redis.get(`game:${postId}:description`);
    return c.json({ type: 'game', postId, username, gameCode, metadata, description });
  }

  return c.json({ type: 'starter', postId, username });
});

// Start async game generation
api.post('/game/generate', async (c) => {
  const { context, reddit } = await import('@devvit/web/server');
  const { jobManager: jm, draftManager: dm } = await getManagers();
  const username = await reddit.getCurrentUsername();
  const postId = context.postId;

  const body = await c.req.json();
  const { description } = body;

  if (!description || typeof description !== 'string') {
    return c.json({ error: 'Description is required' }, 400);
  }

  try {
    const job = await jm.createJob(postId, description, username);

    const draft = await dm.createDraft(username, {
      description,
      status: 'generating',
      jobId: job.jobId,
    });

    return c.json({ jobId: job.jobId, draftId: draft.draftId });
  } catch (err) {
    console.error('Generate start error:', err);
    return c.json({ error: err.message }, 500);
  }
});

// Start async game edit
api.post('/game/edit', async (c) => {
  const { context, reddit } = await import('@devvit/web/server');
  const { jobManager: jm, draftManager: dm } = await getManagers();
  const username = await reddit.getCurrentUsername();
  const postId = context.postId;

  const body = await c.req.json();
  const { description, draftId, previousCode } = body;

  if (!description) return c.json({ error: 'Edit description is required' }, 400);
  if (!previousCode) return c.json({ error: 'Previous code is required' }, 400);

  try {
    const job = await jm.createJob(postId, description, username, { previousCode });

    if (draftId) {
      await dm.updateGenerationStatus(username, draftId, { status: 'generating', jobId: job.jobId });
    }

    return c.json({ jobId: job.jobId, draftId });
  } catch (err) {
    console.error('Edit start error:', err);
    return c.json({ error: err.message }, 500);
  }
});

// Poll job status — lazy-start pattern
api.get('/jobs/:jobId', async (c) => {
  const { settings } = await import('@devvit/web/server');
  const { jobManager: jm, draftManager: dm } = await getManagers();
  const jobId = c.req.param('jobId');

  try {
    const job = await jm.getJob(jobId);
    if (!job) return c.json({ error: 'Job not found' }, 404);

    // Lazy start: if queued, fire the OpenAI request now
    if (job.status === 'queued') {
      const openaiKey = await settings.get('openaiKey');
      if (!openaiKey) {
        console.error('Job', jobId, '- OpenAI API key not configured');
        await jm.markFailed(jobId, new Error('OpenAI API key not configured'));
        return c.json({ status: 'failed', error: 'OpenAI API key not configured' });
      }
      const model = await settings.get('openaiModel') || DEFAULT_OPENAI_MODEL;

      let prompt;
      if (job.previousCode) {
        prompt = buildEditPrompt(job.description, job.previousCode);
      } else {
        prompt = buildPrompt(job.description);
      }

      try {
        const openaiResp = await createResponse(openaiKey, prompt, model);
        await jm.markPolling(jobId, openaiResp.id);
        console.log('Job', jobId, '- OpenAI response created:', openaiResp.id);
        return c.json({ status: 'polling', progress: 5 });
      } catch (openaiErr) {
        console.error('Job', jobId, '- OpenAI create failed:', openaiErr.message);
        await jm.markFailed(jobId, openaiErr);
        return c.json({ status: 'failed', error: openaiErr.message });
      }
    }

    // Polling: check OpenAI status
    if (job.status === 'polling') {
      const elapsed = Date.now() - parseInt(job.startedAt || job.createdAt);
      const JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

      if (elapsed > JOB_TIMEOUT_MS) {
        console.error('Job', jobId, '- timed out after', Math.round(elapsed / 1000), 's');
        await jm.markFailed(jobId, new Error(`Job timed out after ${Math.round(elapsed / 1000)}s`));
        return c.json({ status: 'failed', error: `Generation timed out after ${Math.round(elapsed / 1000)}s` });
      }

      const openaiKey = await settings.get('openaiKey');
      if (!openaiKey) {
        await jm.markFailed(jobId, new Error('OpenAI API key not configured'));
        return c.json({ status: 'failed', error: 'OpenAI API key not configured' });
      }

      let result;
      try {
        result = await getResponse(openaiKey, job.openaiResponseId);
        console.log('Job', jobId, '- poll:', result.status, `(${Math.round(elapsed / 1000)}s elapsed, openaiId: ${job.openaiResponseId})`);
      } catch (networkErr) {
        console.error('Job', jobId, '- getResponse transient error:', networkErr.message, `(${Math.round(elapsed / 1000)}s elapsed)`);
        return c.json({ status: 'polling', progress: job.progress || 10, debug: { elapsed, error: networkErr.message, openaiResponseId: job.openaiResponseId } });
      }

      if (result.status === 'completed') {
        console.log('Job', jobId, '- completed in', Math.round(elapsed / 1000), 's, parsing response...');
        const gameCode = parseResponse(result.text);
        const validation = validateGame(gameCode);
        if (!validation.valid) {
          console.error('Job', jobId, '- validation failed:', validation.errors.join(', '));
          await jm.markFailed(jobId, new Error(`Validation failed: ${validation.errors.join(', ')}`));
          return c.json({ status: 'failed', error: `Validation failed: ${validation.errors.join(', ')}` });
        }

        const metadata = extractMetadata(gameCode, job.description);
        const gameDefinition = { gameCode, metadata, description: job.description };
        await jm.markCompleted(jobId, gameDefinition);
        console.log('Job', jobId, '- saved, title:', metadata.title);

        return c.json({ status: 'completed', gameDefinition });
      }

      if (result.status === 'failed') {
        console.error('Job', jobId, '- OpenAI failed:', result.error);
        await jm.markFailed(jobId, new Error(result.error));
        return c.json({ status: 'failed', error: result.error });
      }

      // Still in progress
      return c.json({ status: 'polling', progress: job.progress || 10, debug: { elapsed, openaiStatus: result.status, openaiResponseId: job.openaiResponseId } });
    }

    // Already completed or failed
    if (job.status === 'completed') {
      return c.json({ status: 'completed', gameDefinition: job.gameDefinition });
    }

    if (job.status === 'failed') {
      return c.json({ status: 'failed', error: job.error });
    }

    return c.json({ status: job.status });
  } catch (err) {
    console.error('Job poll error:', err);
    try { await jm.markFailed(jobId, err); } catch (_) {}
    return c.json({ status: 'failed', error: err.message }, 500);
  }
});

// Debug endpoint — full raw job state
api.get('/jobs/:jobId/debug', async (c) => {
  const { jobManager: jm } = await getManagers();
  const jobId = c.req.param('jobId');

  const job = await jm.getJob(jobId);
  if (!job) return c.json({ error: 'Job not found' }, 404);

  const now = Date.now();
  const createdAt = parseInt(job.createdAt || 0);
  const startedAt = parseInt(job.startedAt || 0);
  const completedAt = parseInt(job.completedAt || 0);

  return c.json({
    ...job,
    gameDefinition: job.gameDefinition ? '(present)' : null,
    _debug: {
      now,
      elapsedSinceCreated: createdAt ? `${Math.round((now - createdAt) / 1000)}s` : null,
      elapsedSinceStarted: startedAt ? `${Math.round((now - startedAt) / 1000)}s` : null,
      completionTime: completedAt && startedAt ? `${Math.round((completedAt - startedAt) / 1000)}s` : null,
    },
  });
});

// List user's drafts
api.get('/drafts', async (c) => {
  const { reddit } = await import('@devvit/web/server');
  const { draftManager: dm } = await getManagers();
  const username = await reddit.getCurrentUsername();

  const drafts = await dm.listDrafts(username);
  return c.json({ drafts });
});

// Get draft with versions
api.get('/drafts/:draftId', async (c) => {
  const { reddit } = await import('@devvit/web/server');
  const { draftManager: dm } = await getManagers();
  const username = await reddit.getCurrentUsername();
  const draftId = c.req.param('draftId');

  const draft = await dm.getDraft(username, draftId);
  if (!draft) return c.json({ error: 'Draft not found' }, 404);

  return c.json({ draft });
});

// Update draft
api.put('/drafts/:draftId', async (c) => {
  const { reddit } = await import('@devvit/web/server');
  const { draftManager: dm } = await getManagers();
  const username = await reddit.getCurrentUsername();
  const draftId = c.req.param('draftId');

  const body = await c.req.json();

  try {
    const result = await dm.updateDraft(username, draftId, body);
    return c.json(result);
  } catch (err) {
    if (err.message === 'DRAFT_NOT_FOUND') return c.json({ error: 'Draft not found' }, 404);
    return c.json({ error: err.message }, 500);
  }
});

// Delete draft
api.delete('/drafts/:draftId', async (c) => {
  const { reddit } = await import('@devvit/web/server');
  const { draftManager: dm } = await getManagers();
  const username = await reddit.getCurrentUsername();
  const draftId = c.req.param('draftId');

  try {
    await dm.deleteDraft(username, draftId);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Publish a draft as a new Reddit game post
api.post('/game/publish', async (c) => {
  const { redis, reddit } = await import('@devvit/web/server');
  const { draftManager: dm } = await getManagers();
  const username = await reddit.getCurrentUsername();

  const body = await c.req.json();
  const { draftId, gameCode, metadata, description } = body;

  if (!gameCode) return c.json({ error: 'Game code is required' }, 400);

  try {
    const title = metadata?.title || 'rerollgame';
    const post = await reddit.submitCustomPost({ title: `rerollgame: ${title}` });

    // Store game data on the new post
    await redis.set(`game:${post.id}:code`, gameCode);
    await redis.set(`game:${post.id}:metadata`, JSON.stringify(metadata || {}));
    if (description) await redis.set(`game:${post.id}:description`, description);

    // Mark draft as published
    if (draftId) {
      await dm.markPublished(username, draftId, post.id);
    }

    return c.json({ postId: post.id, url: `https://reddit.com/comments/${post.id}` });
  } catch (err) {
    console.error('Publish error:', err);
    return c.json({ error: err.message }, 500);
  }
});

// Load a test game
api.get('/game/test', async (c) => {
  const name = c.req.query('name') || 'bouncer';

  const testGames = {
    bouncer: () => import('../shared/test-games/bouncer.js?raw'),
  };

  const loader = testGames[name];
  if (!loader) return c.json({ error: `Unknown test game: ${name}` }, 404);

  try {
    const mod = await loader();
    const gameCode = mod.default;
    return c.json({ gameCode, metadata: { title: name } });
  } catch (err) {
    return c.json({ error: err.message }, 500);
  }
});

// Nearest-neighbor resize PNG buffer → new PNG buffer
function resizePng(srcBuf, targetW, targetH) {
  const src = PNG.sync.read(srcBuf);
  const dst = new PNG({ width: targetW, height: targetH });
  for (let y = 0; y < targetH; y++) {
    const sy = Math.floor(y * src.height / targetH);
    for (let x = 0; x < targetW; x++) {
      const sx = Math.floor(x * src.width / targetW);
      const si = (sy * src.width + sx) * 4;
      const di = (y * targetW + x) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return PNG.sync.write(dst);
}

// Upload data URI to Reddit CDN with retries
async function uploadToCdn(media, dataUri) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await media.upload({ url: dataUri, type: 'image' });
      return result.mediaUrl;
    } catch (err) {
      console.warn(`[img] Upload attempt ${attempt}/3 failed:`, err.message);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  return null;
}

// Image generation (Gemini) → resize → upload to Reddit CDN
// Two-tier cache: orig (prompt-only) + sized (prompt+WxH)
api.post('/image/generate', async (c) => {
  const { redis, settings, media } = await import('@devvit/web/server');

  const body = await c.req.json();
  const { prompt, w: reqW, h: reqH, remove_bg: removeBg } = body;

  if (!prompt) return c.json({ error: 'Prompt is required' }, 400);

  const w = reqW || 64;
  const h = reqH || 64;
  const bgFlag = removeBg ? 1 : 0;
  const promptHash = simpleHash(prompt);
  const sizedKey = `img3:${promptHash}:bg${bgFlag}:${w}x${h}`;
  const origKey = `img3:${promptHash}:bg${bgFlag}:orig`;
  const TTL = 30 * 24 * 60 * 60;

  console.log(`[img] Request: "${prompt.slice(0, 60)}" ${w}x${h}`);

  // 1. Sized cache hit
  const sizedUrl = await redis.get(sizedKey);
  if (sizedUrl) {
    console.log(`[img] Sized cache hit: ${sizedUrl}`);
    return c.json({ url: sizedUrl });
  }

  // 2. Original cache hit → resize from CDN
  const origUrl = await redis.get(origKey);
  if (origUrl) {
    console.log(`[img] Orig cache hit, resizing to ${w}x${h}...`);
    try {
      const origResp = await fetch(origUrl);
      const origBuf = Buffer.from(await origResp.arrayBuffer());
      const resizedBuf = resizePng(origBuf, w, h);
      const resizedUri = `data:image/png;base64,${resizedBuf.toString('base64')}`;
      const resizedUrl = await uploadToCdn(media, resizedUri);
      if (resizedUrl) {
        await redis.set(sizedKey, resizedUrl, { EX: TTL });
        console.log(`[img] Resized & uploaded: ${resizedUrl}`);
        return c.json({ url: resizedUrl });
      }
    } catch (resizeErr) {
      console.warn(`[img] Resize from cache failed, returning orig:`, resizeErr.message);
    }
    return c.json({ url: origUrl });
  }

  // 3. Miss both → generate, upload orig, resize, upload sized
  try {
    const geminiKey = await settings.get('geminiKey');
    if (!geminiKey) {
      console.error('[img] No geminiKey in settings');
      return c.json({ error: 'Gemini API key not configured' }, 500);
    }

    console.log('[img] Calling Gemini...');
    const t0 = Date.now();
    const result = await geminiImage(geminiKey, prompt, { w, h });
    console.log(`[img] Generated in ${((Date.now() - t0) / 1000).toFixed(1)}s (${(result.data.length / 1024).toFixed(0)}KB) [${result.mimeType}]`);

    // Optionally remove background (chromakey)
    const rawBuf = Buffer.from(result.data, 'base64');
    const processedBuf = removeBg ? removeBackground(rawBuf) : rawBuf;
    const transparentB64 = processedBuf.toString('base64');

    // Upload original
    const origDataUri = `data:image/png;base64,${transparentB64}`;
    const origMediaUrl = await uploadToCdn(media, origDataUri);
    if (!origMediaUrl) {
      return c.json({ error: 'Failed to upload image to Reddit CDN after 3 attempts' }, 500);
    }
    console.log(`[img] Original uploaded: ${origMediaUrl}`);
    await redis.set(origKey, origMediaUrl, { EX: TTL });

    // Resize + upload sized
    try {
      const resizedBuf = resizePng(processedBuf, w, h);
      const resizedUri = `data:image/png;base64,${resizedBuf.toString('base64')}`;
      const resizedUrl = await uploadToCdn(media, resizedUri);
      if (resizedUrl) {
        await redis.set(sizedKey, resizedUrl, { EX: TTL });
        console.log(`[img] Resized ${w}x${h} uploaded: ${resizedUrl}`);
        return c.json({ url: resizedUrl });
      }
    } catch (resizeErr) {
      console.warn(`[img] Resize failed, returning original:`, resizeErr.message);
    }

    return c.json({ url: origMediaUrl });
  } catch (err) {
    console.error('[img] Error:', err.message);
    return c.json({ error: err.message }, 500);
  }
});

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

app.route('/api', api);

// Internal routes (menu actions, triggers)
const internal = new Hono();
internal.route('/menu', menu);
internal.route('/triggers', triggers);
app.route('/internal', internal);

serve({
  fetch: app.fetch,
  createServer: createServer,
  port: getServerPort(),
});
