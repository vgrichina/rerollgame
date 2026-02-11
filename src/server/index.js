import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { menu } from './routes/menu.js';
import { triggers } from './routes/triggers.js';
import { generateImage as geminiImage } from './gemini.js';
import { createResponse, getResponse } from './openai-responses.js';
import { JobManager } from './job-manager.js';
import { DraftManager } from './draft-manager.js';
import { buildPrompt, buildEditPrompt, parseResponse } from '../shared/game-prompt.js';
import { validateGame } from '../shared/game-schema.js';

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
      const model = await settings.get('openaiModel') || 'gpt-5.3-codex';

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
      const openaiKey = await settings.get('openaiKey');
      if (!openaiKey) {
        await jm.markFailed(jobId, new Error('OpenAI API key not configured'));
        return c.json({ status: 'failed', error: 'OpenAI API key not configured' });
      }

      let result;
      try {
        result = await getResponse(openaiKey, job.openaiResponseId);
      } catch (networkErr) {
        console.error('Job', jobId, '- getResponse transient error:', networkErr.message);
        return c.json({ status: 'polling', progress: job.progress || 10 });
      }

      if (result.status === 'completed') {
        const gameCode = parseResponse(result.text);
        const validation = validateGame(gameCode);
        if (!validation.valid) {
          await jm.markFailed(jobId, new Error(`Validation failed: ${validation.errors.join(', ')}`));
          return c.json({ status: 'failed', error: `Validation failed: ${validation.errors.join(', ')}` });
        }

        const metadata = extractMetadata(gameCode, job.description);
        const gameDefinition = { gameCode, metadata, description: job.description };
        await jm.markCompleted(jobId, gameDefinition);

        return c.json({ status: 'completed', gameDefinition });
      }

      if (result.status === 'failed') {
        await jm.markFailed(jobId, new Error(result.error));
        return c.json({ status: 'failed', error: result.error });
      }

      // Still in progress
      return c.json({ status: 'polling', progress: job.progress || 10 });
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

// Image generation (Gemini)
api.post('/image/generate', async (c) => {
  const { redis, settings } = await import('@devvit/web/server');

  const body = await c.req.json();
  const { prompt, w, h } = body;

  if (!prompt) return c.json({ error: 'Prompt is required' }, 400);

  const cacheKey = `img:${simpleHash(prompt + w + h)}`;
  const cached = await redis.get(cacheKey);
  if (cached) return c.json({ image: cached });

  try {
    const geminiKey = await settings.get('geminiKey');
    if (!geminiKey) return c.json({ error: 'Gemini API key not configured' }, 500);

    const imageData = await geminiImage(geminiKey, prompt, { w: w || 256, h: h || 256 });

    await redis.set(cacheKey, imageData, { EX: 30 * 24 * 60 * 60 });

    return c.json({ image: imageData });
  } catch (err) {
    console.error('Image generation error:', err);
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
