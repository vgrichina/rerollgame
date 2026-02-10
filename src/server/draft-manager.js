import { randomUUID } from 'crypto';

const DRAFT_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const MAX_VERSIONS = 10;
const MAX_DRAFTS = 10;

export class DraftManager {
  constructor(redis) {
    this.redis = redis;
  }

  async createDraft(userId, data) {
    const draftId = randomUUID();
    const now = Date.now();

    let title = data.title || 'Untitled Game';
    if (data.gameData?.metadata?.title) {
      title = data.gameData.metadata.title;
    }

    const draft = {
      id: draftId,
      userId,
      title,
      description: data.description || '',
      status: data.status || 'draft',
      currentIndex: '0',
      postId: '',
      jobId: data.jobId || '',
      createdAt: now.toString(),
      updatedAt: now.toString(),
    };

    const draftKey = `draft:${userId}:${draftId}`;
    const versionsKey = `draft:${userId}:${draftId}:versions`;

    await this.redis.hSet(draftKey, draft);
    await this.redis.expire(draftKey, DRAFT_TTL);

    // Store initial version if game data provided
    if (data.gameData?.gameCode) {
      const version = {
        gameCode: data.gameData.gameCode,
        description: data.gameData.description || data.description || '',
        metadata: data.gameData.metadata || {},
        savedAt: now,
      };
      await this.redis.zAdd(versionsKey, { member: JSON.stringify(version), score: now });
      await this.redis.expire(versionsKey, DRAFT_TTL);
    }

    // Add to user's draft index
    await this.redis.zAdd(`draft_index:${userId}`, { member: draftId, score: now });

    await this.enforceMaxDrafts(userId);

    return { draftId, title, currentIndex: 0, createdAt: now };
  }

  async getDraft(userId, draftId) {
    const draftKey = `draft:${userId}:${draftId}`;
    const versionsKey = `draft:${userId}:${draftId}:versions`;

    const [draft, versionsRaw] = await Promise.all([
      this.redis.hGetAll(draftKey),
      this.redis.zRange(versionsKey, 0, -1, { by: 'rank' }),
    ]);

    if (!draft.id) return null;

    // Refresh TTL
    await Promise.all([
      this.redis.expire(draftKey, DRAFT_TTL),
      this.redis.expire(versionsKey, DRAFT_TTL),
    ]);

    const versions = versionsRaw.map(v => {
      try { return JSON.parse(v.member); } catch { return null; }
    }).filter(Boolean);

    return {
      id: draft.id,
      userId: draft.userId,
      title: draft.title,
      description: draft.description,
      status: draft.status,
      currentIndex: parseInt(draft.currentIndex),
      postId: draft.postId || null,
      jobId: draft.jobId || null,
      createdAt: parseInt(draft.createdAt),
      updatedAt: parseInt(draft.updatedAt),
      versions,
    };
  }

  async updateDraft(userId, draftId, data) {
    const draftKey = `draft:${userId}:${draftId}`;
    const versionsKey = `draft:${userId}:${draftId}:versions`;

    const existing = await this.redis.hGet(draftKey, 'userId');
    if (!existing || existing !== userId) throw new Error('DRAFT_NOT_FOUND');

    const now = Date.now();

    const updates = {
      updatedAt: now.toString(),
      currentIndex: data.currentIndex.toString(),
    };
    if (data.title) updates.title = data.title;
    if (data.status) {
      updates.status = data.status;
      if (data.status === 'draft') updates.jobId = '';
    }

    await this.redis.hSet(draftKey, updates);

    if (data.versions && Array.isArray(data.versions)) {
      const versionsToStore = data.versions.slice(-MAX_VERSIONS);
      await this.redis.del(versionsKey);
      for (let i = 0; i < versionsToStore.length; i++) {
        const version = { ...versionsToStore[i], savedAt: versionsToStore[i].savedAt || now };
        await this.redis.zAdd(versionsKey, { member: JSON.stringify(version), score: now + i });
      }
      await this.redis.expire(versionsKey, DRAFT_TTL);
    }

    await this.redis.expire(draftKey, DRAFT_TTL);
    await this.redis.zAdd(`draft_index:${userId}`, { member: draftId, score: now });

    return { updatedAt: now };
  }

  async listDrafts(userId, limit = 10) {
    const entries = await this.redis.zRange(`draft_index:${userId}`, 0, limit - 1, { reverse: true });
    if (!entries.length) return [];

    const drafts = await Promise.all(
      entries.map(async (entry) => {
        const draftKey = `draft:${userId}:${entry.member}`;
        const data = await this.redis.hGetAll(draftKey);
        if (!data.id) {
          await this.redis.zRem(`draft_index:${userId}`, [entry.member]);
          return null;
        }
        return {
          id: data.id,
          title: data.title,
          description: data.description?.substring(0, 100),
          status: data.status,
          jobId: data.jobId || null,
          createdAt: parseInt(data.createdAt),
          updatedAt: parseInt(data.updatedAt),
        };
      })
    );

    return drafts.filter(Boolean);
  }

  async deleteDraft(userId, draftId) {
    const draftKey = `draft:${userId}:${draftId}`;
    const versionsKey = `draft:${userId}:${draftId}:versions`;

    const existing = await this.redis.hGet(draftKey, 'userId');
    if (existing && existing !== userId) throw new Error('UNAUTHORIZED');

    await Promise.all([
      this.redis.del(draftKey),
      this.redis.del(versionsKey),
      this.redis.zRem(`draft_index:${userId}`, [draftId]),
    ]);

    return true;
  }

  async updateGenerationStatus(userId, draftId, { status, jobId }) {
    const draftKey = `draft:${userId}:${draftId}`;

    const existing = await this.redis.hGet(draftKey, 'userId');
    if (!existing || existing !== userId) throw new Error('DRAFT_NOT_FOUND');

    await this.redis.hSet(draftKey, {
      status,
      jobId: jobId || '',
      updatedAt: Date.now().toString(),
    });
    await this.redis.expire(draftKey, DRAFT_TTL);

    return true;
  }

  async markPublished(userId, draftId, postId) {
    const draftKey = `draft:${userId}:${draftId}`;
    await this.redis.hSet(draftKey, {
      status: 'published',
      postId,
      updatedAt: Date.now().toString(),
    });
    return true;
  }

  async enforceMaxDrafts(userId) {
    const indexKey = `draft_index:${userId}`;
    const count = await this.redis.zCard(indexKey);
    if (count > MAX_DRAFTS) {
      const toDeleteEntries = await this.redis.zRange(indexKey, 0, count - MAX_DRAFTS - 1, { by: 'rank' });
      for (const entry of toDeleteEntries) {
        await this.deleteDraft(userId, entry.member);
      }
    }
  }
}
