import { randomUUID } from 'crypto';

const DEFAULT_MODEL = 'gpt-5.3-codex';

export class JobManager {
  constructor(redis) {
    this.redis = redis;
  }

  async createJob(postId, description, userId, options = {}) {
    const jobId = randomUUID();

    const job = {
      id: jobId,
      postId,
      description,
      userId,
      model: options.model || DEFAULT_MODEL,
      status: 'queued',
      createdAt: Date.now().toString(),
    };

    if (options.previousCode) {
      job.previousCode = options.previousCode;
    }

    await this.redis.hSet(`job:${jobId}`, job);

    return { jobId, status: 'queued', model: job.model };
  }

  async getJob(jobId) {
    const job = await this.redis.hGetAll(`job:${jobId}`);
    if (!job.id) return null;

    if (job.gameDefinition) {
      try { job.gameDefinition = JSON.parse(job.gameDefinition); } catch (e) {}
    }

    if (job.status === 'polling') {
      job.progress = this.calculateProgress(job);
    }

    return job;
  }

  async updateJob(jobId, updates) {
    const processed = { ...updates };
    if (processed.gameDefinition && typeof processed.gameDefinition === 'object') {
      processed.gameDefinition = JSON.stringify(processed.gameDefinition);
    }
    await this.redis.hSet(`job:${jobId}`, processed);
  }

  async markPolling(jobId, openaiResponseId) {
    await this.updateJob(jobId, {
      status: 'polling',
      openaiResponseId,
      startedAt: Date.now().toString(),
    });
  }

  async markCompleted(jobId, gameDefinition) {
    await this.updateJob(jobId, {
      status: 'completed',
      gameDefinition,
      completedAt: Date.now().toString(),
    });
  }

  async markFailed(jobId, error) {
    await this.updateJob(jobId, {
      status: 'failed',
      error: error.message || error.toString(),
      completedAt: Date.now().toString(),
    });
  }

  calculateProgress(job) {
    const elapsed = Date.now() - parseInt(job.startedAt || job.createdAt);
    return Math.min(Math.floor((elapsed / 120000) * 100), 95); // ~2min estimate
  }
}
