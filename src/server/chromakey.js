// Chromakey background removal using CIEDE2000 color distance
// Detects background color from corner pixels, removes it with perceptual accuracy

import { PNG } from 'pngjs';

const DELTA_E_THRESHOLD = 10;

function rgbToLab(r, g, b) {
  // RGB → linear
  let rl = r / 255, gl = g / 255, bl = b / 255;
  rl = rl > 0.04045 ? ((rl + 0.055) / 1.055) ** 2.4 : rl / 12.92;
  gl = gl > 0.04045 ? ((gl + 0.055) / 1.055) ** 2.4 : gl / 12.92;
  bl = bl > 0.04045 ? ((bl + 0.055) / 1.055) ** 2.4 : bl / 12.92;
  // Linear RGB → XYZ (D65)
  let x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  let y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750);
  let z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;
  // XYZ → Lab
  const f = v => v > 0.008856 ? v ** (1 / 3) : 7.787 * v + 16 / 116;
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function ciede2000(lab1, lab2) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const avg_Lp = (L1 + L2) / 2;
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const avg_C = (C1 + C2) / 2;
  const avg_C7 = avg_C ** 7;
  const G = 0.5 * (1 - Math.sqrt(avg_C7 / (avg_C7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const avg_Cp = (C1p + C2p) / 2;
  let h1p = Math.atan2(b1, a1p) * 180 / Math.PI; if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) * 180 / Math.PI; if (h2p < 0) h2p += 360;
  let dHP = h2p - h1p;
  if (Math.abs(dHP) > 180) dHP += dHP > 0 ? -360 : 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dHP * Math.PI / 360);
  let avg_Hp;
  if (C1p === 0 || C2p === 0) { avg_Hp = h1p + h2p; }
  else if (Math.abs(h1p - h2p) <= 180) { avg_Hp = (h1p + h2p) / 2; }
  else { avg_Hp = (h1p + h2p + 360) / 2; if (avg_Hp >= 360) avg_Hp -= 360; }
  const T = 1
    - 0.17 * Math.cos((avg_Hp - 30) * Math.PI / 180)
    + 0.24 * Math.cos((2 * avg_Hp) * Math.PI / 180)
    + 0.32 * Math.cos((3 * avg_Hp + 6) * Math.PI / 180)
    - 0.20 * Math.cos((4 * avg_Hp - 63) * Math.PI / 180);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const SL = 1 + 0.015 * (avg_Lp - 50) ** 2 / Math.sqrt(20 + (avg_Lp - 50) ** 2);
  const SC = 1 + 0.045 * avg_Cp;
  const SH = 1 + 0.015 * avg_Cp * T;
  const avg_Cp7 = avg_Cp ** 7;
  const RT = -2 * Math.sqrt(avg_Cp7 / (avg_Cp7 + 25 ** 7))
    * Math.sin(60 * Math.exp(-(Math.pow((avg_Hp - 275) / 25, 2))) * Math.PI / 180);
  return Math.sqrt(
    (dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2
    + RT * (dCp / SC) * (dHp / SH)
  );
}

function sampleCornerColor(png) {
  const { width: w, height: h, data } = png;
  const corners = [
    [0, 0], [w - 1, 0],
    [0, h - 1], [w - 1, h - 1],
  ];
  let rSum = 0, gSum = 0, bSum = 0;
  for (const [x, y] of corners) {
    const i = (y * w + x) * 4;
    rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
  }
  return [Math.round(rSum / 4), Math.round(gSum / 4), Math.round(bSum / 4)];
}

export function removeBackground(pngBuffer) {
  const png = PNG.sync.read(pngBuffer);
  const [bgR, bgG, bgB] = sampleCornerColor(png);
  const bgLab = rgbToLab(bgR, bgG, bgB);
  console.log(`[chromakey] Detected bg color: rgb(${bgR},${bgG},${bgB})`);

  let removed = 0;
  const { data, width, height } = png;
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const off = i * 4;
    const lab = rgbToLab(data[off], data[off + 1], data[off + 2]);
    if (ciede2000(bgLab, lab) < DELTA_E_THRESHOLD) {
      data[off + 3] = 0;
      removed++;
    }
  }

  console.log(`[chromakey] Removed ${removed}/${total} pixels (${(100 * removed / total).toFixed(1)}%)`);
  return PNG.sync.write(png);
}
