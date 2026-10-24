import fs from 'node:fs';
import path from 'node:path';

// In-memory preferences state (not preloaded from disk)
let activePreferences = null;
let preferencesSource = 'none'; // 'memory', 'file', 'extension', 'agent'

/**
 * Checks whether preferences have been initialized / provided.
 * @returns {boolean}
 */
export function hasPreferences() {
  return activePreferences !== null && typeof activePreferences === 'object' && Object.keys(activePreferences).length > 0;
}

/**
 * Gets the currently loaded preferences.
 * @returns {object|null}
 */
export function getLoadedPreferences() {
  return activePreferences;
}

/**
 * Gets the source of the loaded preferences.
 * @returns {string}
 */
export function getPreferencesSource() {
  return preferencesSource;
}

/**
 * Sets or initializes preferences provided by the AI agent, user upload, or extension.
 * @param {object} preferencesData - The preferences object
 * @param {string} [source='agent'] - Where preferences came from ('agent', 'extension_upload', 'user')
 * @param {string} [persistPath] - Optional path if user explicitly wants to save to disk
 * @returns {object} The active preferences
 */
export function setPreferences(preferencesData, source = 'agent', persistPath = null) {
  if (!preferencesData || typeof preferencesData !== 'object') {
    throw new Error("Preferences payload must be a non-null object.");
  }

  activePreferences = preferencesData;
  preferencesSource = source;

  if (persistPath) {
    try {
      fs.writeFileSync(persistPath, JSON.stringify(preferencesData, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[TemplateResolver] Note: Preferences not persisted to disk (${err.message}). Active in memory.`);
    }
  }

  return activePreferences;
}

/**
 * Clears active preferences.
 */
export function clearPreferences() {
  activePreferences = null;
  preferencesSource = 'none';
}

/**
 * Traverses an object using dot or bracket notation.
 * e.g. "general.phone.formatted" or "education[0].institution"
 * @param {object} obj
 * @param {string} propPath
 * @returns {any}
 */
export function getNestedProperty(obj, propPath) {
  if (!obj || !propPath) return undefined;

  const normalized = propPath
    .replace(/^preferences\./i, '')
    .replace(/\[(\w+)\]/g, '.$1')
    .replace(/^\./, '');

  const segments = normalized.split('.');
  let curr = obj;
  for (const seg of segments) {
    if (curr === null || curr === undefined) return undefined;
    curr = curr[seg];
  }
  return curr;
}

/**
 * Recursively resolves template placeholders (${preferences.xxx}) inside strings, objects, or arrays.
 * If preferences have not been initialized yet, leaves placeholders intact and logs a warning.
 * @param {any} input
 * @param {object} [overridePrefs]
 * @returns {any}
 */
export function resolveTemplateVariables(input, overridePrefs = null) {
  const prefs = overridePrefs || activePreferences;

  if (!prefs) {
    // Preferences not yet provided - do not crash, return input intact
    return input;
  }

  if (typeof input === 'string') {
    // Exact token match: return raw data type if possible
    const exactMatch = input.trim().match(/^\$\{preferences\.([^}]+)\}$/);
    if (exactMatch) {
      const resolved = getNestedProperty(prefs, exactMatch[1]);
      if (resolved !== undefined) return resolved;
    }

    // Substring interpolation
    return input.replace(/\$\{preferences\.([^}]+)\}/g, (match, pathKey) => {
      const resolved = getNestedProperty(prefs, pathKey);
      if (resolved === undefined || resolved === null) {
        return match; // preserve if unresolvable
      }
      if (typeof resolved === 'object') {
        return JSON.stringify(resolved);
      }
      return String(resolved);
    });
  }

  if (Array.isArray(input)) {
    return input.map(item => resolveTemplateVariables(item, prefs));
  }

  if (input !== null && typeof input === 'object') {
    const output = {};
    for (const [k, v] of Object.entries(input)) {
      output[k] = resolveTemplateVariables(v, prefs);
    }
    return output;
  }

  return input;
}
