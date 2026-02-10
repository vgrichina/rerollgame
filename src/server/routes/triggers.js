import { Hono } from 'hono';
import { context } from '@devvit/web/server';
import { createPost } from '../core/post.js';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createPost();
    const input = await c.req.json();
    return c.json({
      status: 'success',
      message: `Post created in ${context.subredditName} with id ${post.id} (trigger: ${input.type})`,
    }, 200);
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json({ status: 'error', message: 'Failed to create post' }, 400);
  }
});
