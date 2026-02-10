import { requestExpandedMode } from '@devvit/web/client';

const root = document.getElementById('root');

let postType = null; // 'starter' or 'game'
let gameMetadata = null;

async function init() {
  const res = await fetch('/api/init');
  const data = await res.json();

  postType = data.type || (data.gameCode ? 'game' : 'starter');
  gameMetadata = data.metadata;

  render();
}

function render() {
  if (postType === 'game') {
    renderGame();
  } else {
    renderStarter();
  }
}

function renderStarter() {
  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:16px; padding:20px;">
      <h1 style="font-size:22px; font-weight:bold; color:#ff4500;">rerollgame</h1>
      <p style="color:#888; font-size:13px; text-align:center; max-width:300px;">
        Roll your own game
      </p>
      <button id="create-btn" style="background:#ff4500; color:#fff; border:none; border-radius:24px; padding:14px 40px; font-size:17px; font-weight:bold; cursor:pointer;">
        CREATE
      </button>
    </div>
  `;

  document.getElementById('create-btn').addEventListener('click', (e) => {
    requestExpandedMode(e, 'creator');
  });
}

function renderGame() {
  const title = gameMetadata?.title || 'Untitled Game';
  const desc = gameMetadata?.description || '';

  root.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; gap:12px; padding:20px;">
      <h1 style="font-size:22px; font-weight:bold; color:#ff4500;">rerollgame</h1>
      <h2 style="font-size:18px; font-weight:600; color:#fff;">${escapeHtml(title)}</h2>
      ${desc ? `<p style="color:#aaa; font-size:13px; text-align:center; max-width:300px;">${escapeHtml(desc)}</p>` : ''}
      <button id="play-btn" style="background:#ff4500; color:#fff; border:none; border-radius:24px; padding:14px 40px; font-size:17px; font-weight:bold; cursor:pointer; margin-top:8px;">
        PLAY
      </button>
    </div>
  `;

  document.getElementById('play-btn').addEventListener('click', (e) => {
    requestExpandedMode(e, 'game');
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init();
