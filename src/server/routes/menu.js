import { Hono } from 'hono';
import { createPost } from '../core/post.js';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();
    return c.json({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json({ showToast: 'Failed to create post' }, 400);
  }
});
