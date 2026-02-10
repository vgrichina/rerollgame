import { navigateTo } from '@devvit/web/client';

const root = document.getElementById('root');

// State
let state = 'drafts-list'; // drafts-list | describe | generating | preview | editing
let drafts = [];
let currentDraft = null;
let currentJobId = null;
let currentDraftId = null;
let currentVersionIndex = 0;
let pollTimer = null;
let progressValue = 0;

async function init() {
  await loadDrafts();
  render();
}

async function loadDrafts() {
  try {
    const res = await fetch('/api/drafts');
    const data = await res.json();
    drafts = data.drafts || [];
  } catch (err) {
    drafts = [];
  }
}

function render() {
  switch (state) {
    case 'drafts-list': renderDraftsList(); break;
    case 'describe': renderDescribe(); break;
    case 'generating': renderGenerating(); break;
    case 'preview': renderPreview(); break;
    case 'editing': renderEditing(); break;
  }
}

// --- Drafts List ---
function renderDraftsList() {
  const draftItems = drafts.map(d => {
    const statusBadge = d.status === 'generating'
      ? '<span style="color:#f90; font-size:11px;">generating...</span>'
      : d.status === 'published'
        ? '<span style="color:#4a4; font-size:11px;">published</span>'
        : '';
    return `
      <div class="draft-item" data-id="${d.id}" style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:#1a1a1a; border-radius:8px; cursor:pointer; border:1px solid #333;">
        <div>
          <div style="font-size:14px; font-weight:600; color:#fff;">${escapeHtml(d.title)}</div>
          <div style="font-size:12px; color:#888; margin-top:2px;">${escapeHtml(d.description || '')}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${statusBadge}
          <button class="delete-draft" data-id="${d.id}" style="background:none; border:none; color:#666; font-size:16px; cursor:pointer; padding:4px;">x</button>
        </div>
      </div>`;
  }).join('');

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; height:100vh; padding:20px; gap:12px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h1 style="font-size:20px; font-weight:bold; color:#ff4500;">rerollgame</h1>
      </div>
      <button id="new-game-btn" style="background:#ff4500; color:#fff; border:none; border-radius:12px; padding:14px; font-size:15px; font-weight:bold; cursor:pointer; width:100%;">
        + NEW GAME
      </button>
      <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px;">
        ${drafts.length > 0 ? draftItems : '<p style="color:#666; text-align:center; margin-top:40px;">No drafts yet. Create your first game!</p>'}
      </div>
    </div>
  `;

  document.getElementById('new-game-btn').addEventListener('click', () => {
    currentDraft = null;
    currentDraftId = null;
    currentVersionIndex = 0;
    state = 'describe';
    render();
  });

  // Draft click handlers
  root.querySelectorAll('.draft-item').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.closest('.delete-draft')) return;
      const draftId = el.dataset.id;
      await resumeDraft(draftId);
    });
  });

  // Delete handlers
  root.querySelectorAll('.delete-draft').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const draftId = btn.dataset.id;
      await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
      await loadDrafts();
      render();
    });
  });
}

async function resumeDraft(draftId) {
  const res = await fetch(`/api/drafts/${draftId}`);
  const data = await res.json();
  if (!data.draft) return;

  currentDraft = data.draft;
  currentDraftId = draftId;
  currentVersionIndex = data.draft.currentIndex || 0;

  if (data.draft.status === 'generating' && data.draft.jobId) {
    currentJobId = data.draft.jobId;
    state = 'generating';
    render();
    startPolling();
  } else if (data.draft.versions && data.draft.versions.length > 0) {
    state = 'preview';
    render();
  } else {
    state = 'describe';
    render();
  }
}

// --- Describe ---
function renderDescribe() {
  const savedDesc = currentDraft?.description || '';

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; padding:20px;">
      <h1 style="font-size:20px; font-weight:bold; color:#ff4500;">Describe Your Game</h1>
      <p style="color:#888; font-size:13px; text-align:center; max-width:320px;">
        What kind of game do you want to make?
      </p>
      <textarea id="game-desc" placeholder="e.g. a space invaders clone with powerups"
        style="width:100%; max-width:360px; height:100px; padding:12px; border-radius:8px; border:1px solid #333; background:#1a1a1a; color:#fff; font-size:14px; resize:none; font-family:system-ui,sans-serif;"
      >${escapeHtml(savedDesc)}</textarea>
      <button id="generate-btn" style="background:#ff4500; color:#fff; border:none; border-radius:20px; padding:12px 32px; font-size:15px; font-weight:bold; cursor:pointer;">
        GENERATE
      </button>
      <button id="back-btn" style="background:transparent; color:#888; border:none; font-size:13px; cursor:pointer; text-decoration:underline;">
        Back to drafts
      </button>
    </div>
  `;

  document.getElementById('generate-btn').addEventListener('click', () => {
    const desc = document.getElementById('game-desc').value.trim();
    if (desc) startGeneration(desc);
  });

  document.getElementById('back-btn').addEventListener('click', () => {
    state = 'drafts-list';
    render();
  });
}

async function startGeneration(description) {
  state = 'generating';
  progressValue = 0;
  render();

  try {
    const res = await fetch('/api/game/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    });
    const data = await res.json();

    if (data.error) {
      showError(data.error);
      return;
    }

    currentJobId = data.jobId;
    currentDraftId = data.draftId;
    startPolling();
  } catch (err) {
    showError(err.message);
  }
}

async function startEdit(description) {
  const versions = currentDraft?.versions || [];
  const currentVersion = versions[currentVersionIndex];
  if (!currentVersion?.gameCode) {
    showError('No game code to edit');
    return;
  }

  state = 'generating';
  progressValue = 0;
  render();

  try {
    const res = await fetch('/api/game/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        draftId: currentDraftId,
        previousCode: currentVersion.gameCode,
      }),
    });
    const data = await res.json();

    if (data.error) {
      showError(data.error);
      return;
    }

    currentJobId = data.jobId;
    startPolling();
  } catch (err) {
    showError(err.message);
  }
}

// --- Generating (polling) ---
function renderGenerating() {
  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; padding:20px;">
      <h1 style="font-size:20px; font-weight:bold; color:#ff4500;">rerollgame</h1>
      <div style="width:80%; max-width:300px; height:8px; background:#222; border-radius:4px; overflow:hidden;">
        <div id="progress-bar" style="height:100%; background:#ff4500; border-radius:4px; transition:width 0.5s; width:${progressValue}%;"></div>
      </div>
      <p style="color:#aaa; font-size:14px;">Generating your game...</p>
      <p id="progress-text" style="color:#666; font-size:12px;">${progressValue}%</p>
    </div>
  `;
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollJob, 3000);
  pollJob(); // immediate first poll
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollJob() {
  if (!currentJobId) return;

  try {
    const res = await fetch(`/api/jobs/${currentJobId}`);
    const data = await res.json();

    if (data.status === 'completed') {
      stopPolling();
      await onGenerationComplete(data.gameDefinition);
      return;
    }

    if (data.status === 'failed') {
      stopPolling();
      showError(data.error || 'Generation failed');
      return;
    }

    // Update progress
    if (data.progress != null) {
      progressValue = data.progress;
      const bar = document.getElementById('progress-bar');
      const text = document.getElementById('progress-text');
      if (bar) bar.style.width = `${progressValue}%`;
      if (text) text.textContent = `${progressValue}%`;
    }
  } catch (err) {
    // Silently retry on network errors
  }
}

async function onGenerationComplete(gameDefinition) {
  // Load the draft to get current versions
  if (currentDraftId) {
    const res = await fetch(`/api/drafts/${currentDraftId}`);
    const data = await res.json();
    if (data.draft) {
      currentDraft = data.draft;

      // Add the new version
      const versions = [...(currentDraft.versions || [])];
      versions.push({
        gameCode: gameDefinition.gameCode,
        description: gameDefinition.description || currentDraft.description,
        metadata: gameDefinition.metadata || {},
        savedAt: Date.now(),
      });

      currentVersionIndex = versions.length - 1;

      // Save back to draft
      await fetch(`/api/drafts/${currentDraftId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: gameDefinition.metadata?.title || currentDraft.title,
          status: 'draft',
          currentIndex: currentVersionIndex,
          versions,
        }),
      });

      // Reload draft
      const res2 = await fetch(`/api/drafts/${currentDraftId}`);
      const data2 = await res2.json();
      if (data2.draft) currentDraft = data2.draft;
    }
  }

  state = 'preview';
  render();
}

// --- Preview ---
function renderPreview() {
  const versions = currentDraft?.versions || [];
  const version = versions[currentVersionIndex];
  if (!version) {
    state = 'describe';
    render();
    return;
  }

  const title = version.metadata?.title || currentDraft?.title || 'Untitled Game';
  const desc = version.metadata?.description || '';
  const versionCount = versions.length;
  const versionLabel = versionCount > 1 ? `Version ${currentVersionIndex + 1} of ${versionCount}` : '';

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:12px; padding:20px;">
      <h1 style="font-size:20px; font-weight:bold; color:#ff4500;">Preview</h1>
      <h2 style="font-size:18px; font-weight:600; color:#fff;">${escapeHtml(title)}</h2>
      ${desc ? `<p style="color:#aaa; font-size:13px; text-align:center; max-width:300px;">${escapeHtml(desc)}</p>` : ''}
      ${versionLabel ? `<p style="color:#666; font-size:12px;">${versionLabel}</p>` : ''}
      ${versionCount > 1 ? `
        <div style="display:flex; gap:8px;">
          <button id="prev-ver" style="background:#222; color:#fff; border:1px solid #444; border-radius:8px; padding:6px 14px; font-size:13px; cursor:pointer;" ${currentVersionIndex <= 0 ? 'disabled style="opacity:0.4; background:#222; color:#fff; border:1px solid #444; border-radius:8px; padding:6px 14px; font-size:13px; cursor:default;"' : ''}>Prev</button>
          <button id="next-ver" style="background:#222; color:#fff; border:1px solid #444; border-radius:8px; padding:6px 14px; font-size:13px; cursor:pointer;" ${currentVersionIndex >= versionCount - 1 ? 'disabled style="opacity:0.4; background:#222; color:#fff; border:1px solid #444; border-radius:8px; padding:6px 14px; font-size:13px; cursor:default;"' : ''}>Next</button>
        </div>
      ` : ''}
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button id="publish-btn" style="background:#ff4500; color:#fff; border:none; border-radius:20px; padding:12px 28px; font-size:15px; font-weight:bold; cursor:pointer;">
          PUBLISH
        </button>
        <button id="edit-btn" style="background:transparent; color:#ff4500; border:1px solid #ff4500; border-radius:20px; padding:10px 20px; font-size:13px; cursor:pointer;">
          EDIT
        </button>
        <button id="reroll-btn" style="background:transparent; color:#888; border:1px solid #444; border-radius:20px; padding:10px 20px; font-size:13px; cursor:pointer;">
          REROLL
        </button>
      </div>
      <button id="back-btn" style="background:transparent; color:#888; border:none; font-size:13px; cursor:pointer; text-decoration:underline; margin-top:4px;">
        Back to drafts
      </button>
    </div>
  `;

  document.getElementById('publish-btn').addEventListener('click', publishGame);

  document.getElementById('edit-btn').addEventListener('click', () => {
    state = 'editing';
    render();
  });

  document.getElementById('reroll-btn').addEventListener('click', () => {
    const desc = currentDraft?.description || '';
    if (desc) {
      startGeneration(desc);
    } else {
      state = 'describe';
      render();
    }
  });

  document.getElementById('back-btn').addEventListener('click', async () => {
    await loadDrafts();
    state = 'drafts-list';
    render();
  });

  if (versionCount > 1) {
    const prevBtn = document.getElementById('prev-ver');
    const nextBtn = document.getElementById('next-ver');
    if (prevBtn && currentVersionIndex > 0) {
      prevBtn.addEventListener('click', () => {
        currentVersionIndex--;
        render();
      });
    }
    if (nextBtn && currentVersionIndex < versionCount - 1) {
      nextBtn.addEventListener('click', () => {
        currentVersionIndex++;
        render();
      });
    }
  }
}

async function publishGame() {
  const versions = currentDraft?.versions || [];
  const version = versions[currentVersionIndex];
  if (!version?.gameCode) return;

  const btn = document.getElementById('publish-btn');
  btn.textContent = 'Publishing...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/game/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftId: currentDraftId,
        gameCode: version.gameCode,
        metadata: version.metadata,
        description: version.description || currentDraft?.description,
      }),
    });

    const data = await res.json();
    if (data.error) {
      showError(data.error);
      return;
    }

    // Navigate to the new post
    if (data.url) {
      navigateTo(data.url);
    }
  } catch (err) {
    showError(err.message);
  }
}

// --- Editing ---
function renderEditing() {
  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; padding:20px;">
      <h1 style="font-size:20px; font-weight:bold; color:#ff4500;">Edit Game</h1>
      <p style="color:#888; font-size:13px; text-align:center; max-width:320px;">
        Describe what you want to change
      </p>
      <textarea id="edit-desc" placeholder="e.g. make the enemies faster and add a shield powerup"
        style="width:100%; max-width:360px; height:100px; padding:12px; border-radius:8px; border:1px solid #333; background:#1a1a1a; color:#fff; font-size:14px; resize:none; font-family:system-ui,sans-serif;"
      ></textarea>
      <button id="apply-btn" style="background:#ff4500; color:#fff; border:none; border-radius:20px; padding:12px 32px; font-size:15px; font-weight:bold; cursor:pointer;">
        APPLY
      </button>
      <button id="back-btn" style="background:transparent; color:#888; border:none; font-size:13px; cursor:pointer; text-decoration:underline;">
        Back to preview
      </button>
    </div>
  `;

  document.getElementById('apply-btn').addEventListener('click', () => {
    const desc = document.getElementById('edit-desc').value.trim();
    if (desc) startEdit(desc);
  });

  document.getElementById('back-btn').addEventListener('click', () => {
    state = 'preview';
    render();
  });
}

// --- Error ---
function showError(message) {
  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; padding:20px;">
      <h1 style="font-size:20px; font-weight:bold; color:#ff4500;">rerollgame</h1>
      <p style="color:#f44; font-size:14px; text-align:center; max-width:300px;">${escapeHtml(message)}</p>
      <button id="retry-btn" style="background:#ff4500; color:#fff; border:none; border-radius:20px; padding:10px 24px; font-size:15px; font-weight:bold; cursor:pointer;">
        TRY AGAIN
      </button>
    </div>
  `;

  document.getElementById('retry-btn').addEventListener('click', async () => {
    await loadDrafts();
    state = 'drafts-list';
    render();
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init();
