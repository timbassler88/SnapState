/**
 * Compute a structural JSON diff between two arbitrary objects.
 * Returns JSONPath-style descriptors for added, removed, and changed paths.
 *
 * @param {object|null} prev - Previous state (null if no prior checkpoint)
 * @param {object} next - New state
 * @returns {{ added: string[], removed: string[], changed: string[] }}
 */
export function diffState(prev, next) {
  const added = [];
  const removed = [];
  const changed = [];

  if (prev === null || prev === undefined) {
    // Everything in next is "added"
    collectPaths(next, '', added);
    return { added, removed, changed };
  }

  walk(prev, next, '', added, removed, changed);
  return { added, removed, changed };
}

function walk(prev, next, prefix, added, removed, changed) {
  const prevIsObj = isObject(prev);
  const nextIsObj = isObject(next);

  if (prevIsObj && nextIsObj) {
    const prevKeys = new Set(Object.keys(prev));
    const nextKeys = new Set(Object.keys(next));

    for (const key of nextKeys) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (!prevKeys.has(key)) {
        collectPaths(next[key], path, added);
      } else {
        walk(prev[key], next[key], path, added, removed, changed);
      }
    }

    for (const key of prevKeys) {
      if (!nextKeys.has(key)) {
        const path = prefix ? `${prefix}.${key}` : key;
        collectPaths(prev[key], path, removed);
      }
    }
    return;
  }

  const prevIsArr = Array.isArray(prev);
  const nextIsArr = Array.isArray(next);

  if (prevIsArr && nextIsArr) {
    const maxLen = Math.max(prev.length, next.length);
    for (let i = 0; i < maxLen; i++) {
      const path = `${prefix}[${i}]`;
      if (i >= prev.length) {
        collectPaths(next[i], path, added);
      } else if (i >= next.length) {
        collectPaths(prev[i], path, removed);
      } else {
        walk(prev[i], next[i], path, added, removed, changed);
      }
    }
    return;
  }

  // Scalar comparison (or type mismatch)
  if (!deepEqual(prev, next)) {
    if (prefix) changed.push(prefix);
  }
}

function collectPaths(value, prefix, bucket) {
  if (isObject(value)) {
    for (const key of Object.keys(value)) {
      collectPaths(value[key], prefix ? `${prefix}.${key}` : key, bucket);
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectPaths(value[i], `${prefix}[${i}]`, bucket);
    }
  } else {
    if (prefix) bucket.push(prefix);
  }
}

function isObject(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val);
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  return false;
}
