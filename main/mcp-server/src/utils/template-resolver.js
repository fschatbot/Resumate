import fs from 'node:fs';
import path from 'node:path';
import { getPreferenceByPath, resolvePreferenceTemplate } from '../../../preferences/validator.js';

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
  return (preferencesSource && preferencesSource !== 'none') ? preferencesSource : 'agent';
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
  preferencesSource = (source && source !== 'none') ? source : 'agent';

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
 * Traverses an object using dot or bracket notation safely.
 * @param {object} obj
 * @param {string} propPath
 * @returns {any}
 */
export function getNestedProperty(obj, propPath) {
  return getPreferenceByPath(obj, propPath);
}

/**
 * Recursively resolves template placeholders (${preferences.xxx}) inside strings, objects, or arrays.
 * If preferences have not been initialized yet, leaves placeholders intact.
 * When preferences are active, missing properties resolve to "" to avoid typing raw tokens.
 * @param {any} input
 * @param {object} [overridePrefs]
 * @returns {any}
 */
export function resolveTemplateVariables(input, overridePrefs = null) {
  const prefs = overridePrefs || activePreferences;
  if (!prefs) {
    return input;
  }
  return resolvePreferenceTemplate(input, prefs);
}
