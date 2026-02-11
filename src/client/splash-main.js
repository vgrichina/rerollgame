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
      <div style="display:flex; gap:8px; margin-bottom:4px;">
        <div class="slot-teaser" style="width:48px; height:48px; background:#141414; border:1px solid #2a2a2a; border-radius:10px; display:flex; align-items:center; justify-content:center; box-shadow:inset 0 2px 6px rgba(0,0,0,0.5); animation:slotPulse 2s ease-in-out infinite;">
          <span style="color:#ff4500; font-size:20px; font-weight:bold;">?</span>
        </div>
        <div class="slot-teaser" style="width:48px; height:48px; background:#141414; border:1px solid #2a2a2a; border-radius:10px; display:flex; align-items:center; justify-content:center; box-shadow:inset 0 2px 6px rgba(0,0,0,0.5); animation:slotPulse 2s ease-in-out 0.3s infinite;">
          <span style="color:#ff4500; font-size:20px; font-weight:bold;">?</span>
        </div>
        <div class="slot-teaser" style="width:48px; height:48px; background:#141414; border:1px solid #2a2a2a; border-radius:10px; display:flex; align-items:center; justify-content:center; box-shadow:inset 0 2px 6px rgba(0,0,0,0.5); animation:slotPulse 2s ease-in-out 0.6s infinite;">
          <span style="color:#ff4500; font-size:20px; font-weight:bold;">?</span>
        </div>
      </div>
      <h1 style="font-size:22px; font-weight:bold; color:#ff4500;">rerollgame</h1>
      <p style="color:#888; font-size:13px; text-align:center; max-width:300px;">
        Roll your own AI-powered game
      </p>
      <button id="create-btn" style="background:#ff4500; color:#fff; border:none; border-radius:24px; padding:14px 40px; font-size:17px; font-weight:bold; cursor:pointer; transition:transform 0.1s;">
        CREATE
      </button>
    </div>
    <style>
      @keyframes slotPulse { 0%,100% { border-color:#2a2a2a; } 50% { border-color:#ff450044; } }
      #create-btn:active { transform: scale(0.96); }
    </style>
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
