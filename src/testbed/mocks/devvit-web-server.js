// Mock @devvit/web/server for testbed mode (Hono-based)

import { createClient } from 'redis';
import { createServer as createServerHTTP } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.resolve(__dirname, '../../../dist/client');

// --- Real Redis client ---
let redisClient = null;

async function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('[TESTBED] Redis connection failed after 10 retries');
            return new Error('Redis connection failed');
          }
          return retries * 100;
        }
      }
    });

    redisClient.on('error', (err) => console.error('[TESTBED] Redis error:', err));
    redisClient.on('connect', () => console.log('[TESTBED] Redis connected'));

    await redisClient.connect();
  }
  return redisClient;
}

// --- Context (mutable, set per-request) ---
export const context = {
  postId: null,
  userId: 'testuser',
  subredditName: 'testbed',
};

// --- MIME types for static serving ---
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

// --- Fetch interception script for HTML pages ---
function getFetchInterceptionScript() {
  return `<script>
      // Testbed: intercept fetch to add postId to API calls
      const originalFetch = window.fetch;
      window.fetch = function(resource, init) {
        // Check URL path first (e.g., /r/testbed/comments/post_123)
        const pathMatch = window.location.pathname.match(/\\/comments\\/([^/]+)/);
        const postId = pathMatch ? pathMatch[1] : new URLSearchParams(window.location.search).get('postId');
        if (postId && typeof resource === 'string' && resource.startsWith('/api/')) {
          const separator = resource.includes('?') ? '&' : '?';
          resource = resource + separator + 'postId=' + encodeURIComponent(postId);
        }
        return originalFetch.apply(this, [resource, init]);
      };
      console.log('[TESTBED] Fetch interception installed');
    </script>`;
}

/**
 * Serve an HTML file from dist/client/ with fetch interception injected
 */
async function serveClientHTML(res, filename) {
  const filePath = path.join(clientPath, filename);
  try {
    let html = await fs.readFile(filePath, 'utf-8');
    html = html.replace('</head>', getFetchInterceptionScript() + '</head>');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error: ${err.message}`);
  }
}

/**
 * Generate subreddit feed HTML
 */
function generateSubredditHTML(games) {
  const escapeHtml = (text) => {
    if (!text) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
  };

  const formatTime = (dateStr) => {
    try {
      const diffMs = Date.now() - new Date(dateStr).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return `${diffDays}d ago`;
    } catch (e) { return dateStr; }
  };

  return `<!DOCTYPE html>
<html>
<head>
  <title>r/testbed - Reroll Games</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #030303; color: #d7dadc; }
    .container { max-width: 800px; margin: 0 auto; }
    .header { background: #1a1a1b; border-bottom: 1px solid #343536; padding: 16px 20px; position: sticky; top: 0; z-index: 100; }
    .header-top { display: flex; justify-content: space-between; align-items: center; }
    .subreddit-title { font-size: 18px; font-weight: 700; color: #e7e7e7; }
    .new-btn { background: #818384; color: #000; border: none; padding: 8px 16px; border-radius: 20px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
    .new-btn:hover { background: #a6a6a6; }
    .content { padding: 12px 0; }
    .post { background: #1a1a1b; border: 1px solid #343536; border-radius: 4px; margin: 12px 0; overflow: hidden; transition: all 0.2s; }
    .post:hover { border-color: #818384; background: #262626; }
    .post.pinned { background: #1a2a1b; border: 2px solid #00ff00; }
    .post.pinned:hover { background: #223326; }
    .post a { text-decoration: none; color: inherit; display: block; padding: 12px 16px; }
    .post-title { font-size: 18px; font-weight: 600; color: #d7dadc; margin-bottom: 8px; }
    .post-meta { font-size: 12px; color: #818384; }
    .post-meta strong { color: #d7dadc; }
    .pin-badge { display: inline-block; background: #00ff00; color: #000; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 700; margin-right: 8px; }
    .empty { text-align: center; padding: 60px 20px; color: #818384; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-top">
        <div class="subreddit-title">r/testbed</div>
        <a href="/r/testbed/comments/empty_new_game" class="new-btn">+ New Game</a>
      </div>
    </div>
    <div class="content">
      ${games.length === 0 ? '<div class="empty"><p>No games yet. Create your first game!</p></div>' :
        games.map(g => `
        <div class="post ${g.pinned ? 'pinned' : ''}">
          <a href="${g.url}">
            <div class="post-title">
              ${g.pinned ? '<span class="pin-badge">NEW</span>' : ''}${escapeHtml(g.title)}
            </div>
            <div class="post-meta">
              Posted by <strong>u/${escapeHtml(g.creator)}</strong> &bull; ${formatTime(g.created)}
            </div>
          </a>
        </div>`).join('')}
    </div>
  </div>
</body>
</html>`;
}

/**
 * createServer — wraps the Hono request listener.
 * Called by @hono/node-server's serve() as: createServer(serverOptions, requestListener)
 */
export function createServer(serverOptions, honoListener) {
  const server = createServerHTTP(serverOptions, async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Extract postId from URL path pattern /r/testbed/comments/:postId
    const pathMatch = url.pathname.match(/^\/r\/\w+\/comments\/([^/]+)/);
    if (pathMatch) {
      context.postId = pathMatch[1];
    }

    // Also extract postId from query params
    const queryPostId = url.searchParams.get('postId');
    if (queryPostId) {
      context.postId = queryPostId;
    }

    // --- Route: GET / → redirect to /r/testbed ---
    if (url.pathname === '/' && !queryPostId) {
      res.writeHead(302, { 'Location': '/r/testbed' });
      res.end();
      return;
    }

    // --- Route: GET /r/testbed → subreddit feed ---
    if (url.pathname === '/r/testbed') {
      try {
        const client = await getRedisClient();
        const postIds = await client.zRange('testbed:posts', 0, -1, { REV: true });

        const userGames = [];
        for (const postIdRaw of postIds) {
          const id = typeof postIdRaw === 'object' ? postIdRaw.value : postIdRaw;
          const [title, created, creator, metadataStr] = await Promise.all([
            client.get(`post:${id}:title`),
            client.get(`post:${id}:created`),
            client.get(`post:${id}:creator`),
            client.get(`game:${id}:metadata`)
          ]);
          if (title) {
            userGames.push({
              postId: id, title, created, creator: creator || 'unknown',
              url: `/r/testbed/comments/${id}`, pinned: false
            });
          }
        }

        // "Empty post" for testing creation flow
        const allGames = [
          {
            postId: 'empty_new_game',
            title: 'Create New Game',
            created: new Date().toISOString(),
            creator: 'system',
            url: '/r/testbed/comments/empty_new_game',
            pinned: true
          },
          ...userGames
        ];

        const html = generateSubredditHTML(allGames);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (err) {
        console.error('[TESTBED] Error loading feed:', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Error: ${err.message}`);
      }
      return;
    }

    // --- Route: GET /r/testbed/comments/:postId → serve splash.html ---
    if (pathMatch) {
      console.log(`[TESTBED] Loading post: ${context.postId}`);
      return serveClientHTML(res, 'splash.html');
    }

    // API requests → pass to Hono
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/')) {
      return honoListener(req, res);
    }

    // Try to serve static files from dist/client/
    let filePath = path.join(clientPath, url.pathname);

    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = await fs.readFile(filePath);

      // For HTML files, inject fetch interception script
      if (ext === '.html') {
        let html = content.toString('utf-8');
        html = html.replace('</head>', getFetchInterceptionScript() + '</head>');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // Fallback: pass to Hono (it may handle it)
        return honoListener(req, res);
      }
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Error: ${err.message}`);
    }
  });

  return server;
}

/**
 * Get server port from environment
 */
export function getServerPort() {
  return parseInt(process.env.PORT, 10) || 3000;
}

/**
 * Redis client wrapper to match Devvit Redis API
 */
export const redis = {
  async get(key) {
    const client = await getRedisClient();
    return await client.get(key);
  },

  async set(key, value, options) {
    const client = await getRedisClient();
    const opts = {};
    if (options?.EX) opts.EX = options.EX;
    if (options?.nx) opts.NX = true;
    if (options?.expiration) {
      const expirationSeconds = Math.floor((options.expiration.getTime() - Date.now()) / 1000);
      opts.EX = Math.max(1, expirationSeconds);
    }
    return await client.set(key, value, opts);
  },

  async del(...keys) {
    const client = await getRedisClient();
    return await client.del(...keys);
  },

  async expire(key, seconds) {
    const client = await getRedisClient();
    return await client.expire(key, seconds);
  },

  async hSet(key, fieldValues) {
    const client = await getRedisClient();
    return await client.hSet(key, fieldValues);
  },

  async hGet(key, field) {
    const client = await getRedisClient();
    return await client.hGet(key, field);
  },

  async hGetAll(key) {
    const client = await getRedisClient();
    return await client.hGetAll(key);
  },

  async hDel(key, fields) {
    const client = await getRedisClient();
    return await client.hDel(key, fields);
  },

  async zAdd(key, ...members) {
    const client = await getRedisClient();
    const zadd = members.map(m => ({
      score: m.score,
      value: m.member
    }));
    return await client.zAdd(key, zadd);
  },

  async zRange(key, start, stop, options) {
    const client = await getRedisClient();
    const redisOpts = {};
    if (options?.reverse || options?.REV) redisOpts.REV = true;
    if (options?.by === 'lex') redisOpts.BYLEX = true;
    if (options?.by === 'score') redisOpts.BYSCORE = true;

    const result = await client.zRangeWithScores(key, start, stop, redisOpts);
    if (Array.isArray(result)) {
      return result.map(item => ({
        member: item.value,
        score: item.score
      }));
    }
    return [];
  },

  async zRem(key, members) {
    const client = await getRedisClient();
    return await client.zRem(key, members);
  },

  async zCard(key) {
    const client = await getRedisClient();
    return await client.zCard(key);
  },

  async zScore(key, member) {
    const client = await getRedisClient();
    return await client.zScore(key, member);
  },

  async zIncrBy(key, member, value) {
    const client = await getRedisClient();
    return await client.zIncrBy(key, member, value);
  },

  async incrBy(key, value) {
    const client = await getRedisClient();
    return await client.incrBy(key, value);
  },

  async exists(...keys) {
    const client = await getRedisClient();
    return await client.exists(...keys);
  },
};

/**
 * Mock Reddit API
 */
export const reddit = {
  async getCurrentUsername() {
    return context.userId || 'testuser';
  },

  async submitCustomPost({ title }) {
    const postId = `post_${Date.now()}`;
    console.log('[TESTBED] Created post:', { postId, title });

    try {
      const client = await getRedisClient();
      await Promise.all([
        client.set(`post:${postId}:title`, title),
        client.set(`post:${postId}:created`, new Date().toISOString()),
        client.set(`post:${postId}:creator`, context.userId || 'testuser'),
        redis.zAdd('testbed:posts', { score: Date.now(), member: postId }),
      ]);
    } catch (err) {
      console.error('[TESTBED] Error storing post metadata:', err);
    }

    return { id: postId };
  },
};

/**
 * Mock settings — reads from environment variables
 */
export const settings = {
  async get(key) {
    const keyMappings = {
      'openaiKey': 'OPENAI_API_KEY',
      'geminiKey': 'GEMINI_API_KEY',
      'openaiModel': 'OPENAI_MODEL',
      'geminiModel': 'GEMINI_MODEL',
    };

    const envKey = keyMappings[key];
    if (envKey && process.env[envKey]) {
      return process.env[envKey];
    }
    return null;
  },
};
