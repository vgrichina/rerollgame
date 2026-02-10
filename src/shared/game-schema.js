// Game validation for canvas-command games

export function validateGame(gameCode) {
  const errors = [];

  if (!gameCode || typeof gameCode !== 'string') {
    return { valid: false, errors: ['Game code must be a non-empty string'] };
  }

  // Check that the three required functions exist
  if (!/function\s+metadata\s*\(/.test(gameCode)) {
    errors.push('Missing metadata() function');
  }
  if (!/function\s+resources\s*\(/.test(gameCode)) {
    errors.push('Missing resources() function');
  }
  if (!/function\s+update\s*\(/.test(gameCode)) {
    errors.push('Missing update() function');
  }

  // Basic sanity checks
  if (gameCode.length > 200000) {
    errors.push('Game code exceeds 200KB limit');
  }

  // Check for dangerous patterns
  const forbidden = ['eval(', 'Function(', 'import(', 'require(', 'fetch(', 'XMLHttpRequest', 'WebSocket'];
  for (const pattern of forbidden) {
    if (gameCode.includes(pattern)) {
      errors.push(`Forbidden pattern: ${pattern}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateMetadata(meta) {
  const errors = [];
  if (!meta || typeof meta !== 'object') {
    return { valid: false, errors: ['Metadata must be an object'] };
  }
  if (!meta.title || typeof meta.title !== 'string') {
    errors.push('Title is required');
  }
  if (meta.width && (typeof meta.width !== 'number' || meta.width < 100 || meta.width > 800)) {
    errors.push('Width must be 100-800');
  }
  if (meta.height && (typeof meta.height !== 'number' || meta.height < 100 || meta.height > 800)) {
    errors.push('Height must be 100-800');
  }
  return { valid: errors.length === 0, errors };
}

export function validateResources(res) {
  const errors = [];
  if (!res || typeof res !== 'object') {
    return { valid: false, errors: ['Resources must be an object'] };
  }

  // Validate images
  if (res.images) {
    const imageKeys = Object.keys(res.images);
    if (imageKeys.length > 20) {
      errors.push('Max 20 images allowed');
    }
    for (const key of imageKeys) {
      const img = res.images[key];
      if (img.w > 512 || img.h > 512) {
        errors.push(`Image "${key}" exceeds 512x512 limit`);
      }
    }
  }

  // Validate sounds
  if (res.sounds) {
    const soundKeys = Object.keys(res.sounds);
    if (soundKeys.length > 20) {
      errors.push('Max 20 sounds allowed');
    }
  }

  return { valid: errors.length === 0, errors };
}
