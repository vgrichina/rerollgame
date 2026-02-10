// Game prompt for LLM game generation (canvas command API)
import bouncerCode from './test-games/bouncer.js?raw';

function getSystemPrompt() {
  return `You are a game developer AI. You create simple, fun HTML5 Canvas games.
Your output is a single JavaScript file with three global functions: metadata(), resources(), update(dt, input).
The game runs inside a sandbox - you cannot access DOM, fetch, or any browser APIs.
You return an array of draw commands that the host renders on a Canvas2D context.`;
}

function getAPIReference() {
  return `
<canvas-command-api>
## Draw Commands (returned as array from update)

Each command is an object with an "op" field:

### Basics
- {op:"clear", color:"#000"}                     - Fill entire canvas
- {op:"rect", x, y, w, h, fill, stroke, lineWidth} - Rectangle (fill and/or stroke)
- {op:"circle", x, y, r, fill, stroke, lineWidth}  - Circle
- {op:"line", x1, y1, x2, y2, color, lineWidth}    - Line segment
- {op:"text", x, y, text, fill, font, align, baseline} - Text (default font: "16px monospace")

### Advanced shapes
- {op:"poly", points:[[x,y],...], fill, stroke, close} - Polygon
- {op:"arc", x, y, r, start, end, fill, stroke}        - Arc
- {op:"path", d:[["moveTo",x,y],["lineTo",x,y],["bezierTo",cx1,cy1,cx2,cy2,x,y],["quadTo",cx,cy,x,y],["close"]], fill, stroke}

### Images (from resources)
- {op:"img", id:"name", x, y, w, h}              - Draw image from pool
- {op:"img", id:"name", x, y, w, h, sx, sy, sw, sh} - Sub-rectangle source
- {op:"img", id:"name", x, y, w, h, rotate, alpha}   - With transform

### Transform stack
- {op:"save"}                    - Save canvas state
- {op:"restore"}                 - Restore canvas state
- {op:"translate", x, y}        - Translate origin
- {op:"rotate", angle}          - Rotate (radians)
- {op:"scale", x, y}            - Scale
- {op:"alpha", value}           - Set global alpha (0-1)
- {op:"clip", x, y, w, h}      - Clip to rectangle

### Audio commands (mixed into same array)
- {op:"tone", ch:0, wave:"square", freq:440, vol:0.5, dur:0.2} - Play synth tone
- {op:"tone", ch:0, wave:"sine", note:"C4", vol:0.5, dur:0.2}  - Note shorthand (C0-B8)
- {op:"tone", ch:0, wave:"square", freq:440, sweep:880, dur:0.3} - Pitch bend
- {op:"tone", ch:0, wave:"square", note:"C4", dur:0.5, env:{a:0.01, d:0.1, s:0.6, r:0.2}} - ADSR envelope
- {op:"noise", ch:2, vol:0.3, dur:0.1, type:"white"}  - Noise (white/pink/brown)
- {op:"sample", id:"name", ch:6, vol:1, rate:1, loop:false} - Play preloaded sample
- {op:"stop", ch:0}             - Stop channel
- {op:"stopAll"}                - Stop all channels
- {op:"volume", value:0.5}      - Set master volume

### Meta commands
- {op:"score", value:100}       - Update score display
- {op:"gameOver"}               - End game

Waves: "sine", "square", "sawtooth", "triangle"
Channels: 0-7 (0-3 synth, 4-5 noise, 6-7 samples)
</canvas-command-api>`;
}

function getInputReference() {
  return `
<input-api>
## Input Object (passed to update)

Buttons (boolean, true while held):
- input.up, input.down, input.left, input.right - Directional
- input.a, input.b - Action buttons (keyboard: Z/Space, X)

Pressed (boolean, true only on first frame):
- input.upPressed, input.downPressed, input.leftPressed, input.rightPressed
- input.aPressed, input.bPressed

Pointer/touch:
- input.pointerDown - true while pointer is down
- input.pointerPressed - true only on first frame of press
- input.pointerX, input.pointerY - Coordinates in game space (0-width, 0-height)
</input-api>`;
}

function getResourcesReference() {
  return `
<resources-api>
## resources() return format

{
  images: {
    "player": {type:"pixels", w:16, h:16, data:["#ff0000", "#00ff00", null, ...]},
    "tileset": {type:"hex", w:8, h:8, palette:["#000","#fff",...], rows:["01100110","10011001",...]},
    "bg": {type:"procedural", w:400, h:400, draw:[{op:"rect",x:0,y:0,w:400,h:400,fill:"#228"}]},
    "enemy": {type:"generate", prompt:"pixel art red dragon 32x32", w:32, h:32}
  },
  sounds: {
    "explosion": {type:"generate", wave:"noise", dur:0.4, env:{a:0.01,d:0.3,s:0,r:0.1}},
    "coin": {type:"generate", wave:"square", notes:["E5","G5"], dur:0.1},
    "jump": {type:"generate", wave:"triangle", sweep:{from:200,to:600}, dur:0.15},
    "laser": {type:"pcm", rate:22050, data:[0.1, 0.5, -0.3, ...]}
  }
}

Image limits: max 20 images, max 512x512 pixels each.
Sound limits: max 20 sounds.
Image type "generate" is AI-generated at load time (requires server call).
</resources-api>`;
}

function getRequirements() {
  return `
<requirements>
- MUST implement metadata(), resources(), update(deltaTime, input) as global functions
- metadata() returns {title, description, controls:[], width, height} (default 400x400)
- resources() returns {images:{}, sounds:{}}
- update(dt, input) returns array of command objects
- Use module-level \`let state;\` for game state, initialize on first update call
- Always include score tracking: push {op:"score", value:N}
- Include win/lose conditions: push {op:"gameOver"} when game ends
- If implementing lives, game over when lives reach 0 (not below 0)
- Keep graphics simple but fun - use basic shapes (rect, circle, text)
- Cap deltaTime: const dt = Math.min(deltaTime, 0.05)
- No external dependencies, no DOM access, no fetch - pure logic only
- Return commands as a flat array mixing draw + audio + meta commands
</requirements>`;
}

export function buildPrompt(description) {
  return `${getSystemPrompt()}
${getAPIReference()}
${getInputReference()}
${getResourcesReference()}

<example-game>
\`\`\`javascript
${bouncerCode}
\`\`\`
</example-game>
${getRequirements()}

<task>
Create a complete, playable game for: "${description}"
Return ONLY a single JavaScript code block with the three functions.
</task>`;
}

export function buildEditPrompt(description, previousCode) {
  return `${getSystemPrompt()}
${getAPIReference()}
${getInputReference()}
${getResourcesReference()}
${getRequirements()}

<current-game>
\`\`\`javascript
${previousCode}
\`\`\`
</current-game>

<task>
Edit the existing game based on this request: "${description}"
Keep the same basic structure unless specifically asked to change it.
Return the COMPLETE modified game code as a single JavaScript code block.
</task>`;
}

export function parseResponse(text) {
  const match = text.match(/```(?:javascript|js)?\s*([\s\S]*?)\s*```/);
  if (!match) {
    throw new Error('No JavaScript code block found in response');
  }
  return match[1].trim();
}
