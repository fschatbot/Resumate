import { validatePreferences, PREFERENCE_SECTIONS } from '../../../preferences/validator.js';
import {
  setPreferences,
  getLoadedPreferences,
  hasPreferences,
  getNestedProperty,
  getPreferencesSource
} from '../utils/template-resolver.js';

// In-memory registry of files uploaded by the user or registered by the AI agent
const sessionFiles = new Map();

// Sync listener (e.g. WebSocket bridge to Chrome Extension)
let syncCallback = null;

/**
 * Registers a sync callback to broadcast state updates to the Chrome Extension.
 * @param {(type: string, payload: any) => void} fn
 */
export function setSyncCallback(fn) {
  syncCallback = fn;
}

/**
 * Initializes or sets the applicant preferences.
 * @param {object} args
 * @param {object} args.preferences - The preferences object matching preferences.schema.json
 * @param {string} [args.source="agent"] - Source origin ("agent", "extension_upload", "user")
 * @returns {object}
 */
export function handleSetPreferences(args = {}) {
  const { preferences, source = "agent" } = args;

  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    throw new Error("Missing required argument: 'preferences' (must be a valid JSON object matching preferences.schema.json).");
  }

  // Validate against schema
  const validation = validatePreferences(preferences);
  if (!validation.valid) {
    throw new Error(`Preferences failed schema validation (${validation.errors.length} error(s)): ${validation.errors.join('; ')}`);
  }

  setPreferences(preferences, source);

  // Sync to Chrome Extension if connected
  if (syncCallback) {
    try {
      syncCallback('preferences_sync', preferences);
    } catch (err) {
      console.error('[SchemaTools] Failed to sync preferences to extension:', err.message);
    }
  }

  return {
    success: true,
    source,
    message: `Preferences successfully initialized and validated from source: '${source}'. Template substitutions are now active.`,
    applicantName: preferences.general?.fullName || `${preferences.general?.firstName || ''} ${preferences.general?.lastName || ''}`.trim(),
    initializedSections: Object.keys(preferences)
  };
}

/**
 * Validates preferences structure against the schema.
 * @param {object} args
 * @param {object} [args.preferences] - Custom preferences payload to validate
 * @param {string} [args.section] - Specific section to validate
 * @returns {object} Validation result
 */
export function handleValidatePreferencesSchema(args = {}) {
  const data = args.preferences || getLoadedPreferences();
  const section = args.section || null;

  if (!data) {
    throw new Error("No preferences provided to validate. Please provide 'preferences' in the tool arguments or call set_preferences first.");
  }

  const result = validatePreferences(data, section);
  if (!result.valid) {
    return {
      valid: false,
      section: section || "all",
      errors: result.errors,
      message: `Preferences schema validation failed with ${result.errors.length} error(s): ${result.errors.join('; ')}`
    };
  }

  return {
    valid: true,
    section: section || "all",
    errors: [],
    message: `Preferences schema validation succeeded for ${section ? `section '${section}'` : 'entire document'}.`
  };
}

/**
 * Updates or merges new user data into a specific section of active preferences.
 * @param {object} args
 * @param {string} args.section - Target section (e.g. "customQA", "general", "education")
 * @param {any} args.data - Data payload to merge or set
 * @param {boolean} [args.overwrite=false] - Whether to overwrite or merge
 * @returns {object}
 */
export function handleUpdatePreferencesSection(args) {
  if (!args || !args.section) {
    throw new Error("Missing required argument: 'section'");
  }

  let current = getLoadedPreferences();
  if (!current) {
    current = {};
  } else {
    current = JSON.parse(JSON.stringify(current)); // deep clone
  }

  const { section, data, overwrite = false } = args;

  if (Array.isArray(current[section]) && Array.isArray(data)) {
    if (overwrite) {
      current[section] = data;
    } else {
      current[section].push(...data);
    }
  } else if (
    typeof current[section] === 'object' && current[section] !== null && !Array.isArray(current[section]) &&
    typeof data === 'object' && data !== null && !Array.isArray(data)
  ) {
    if (overwrite) {
      current[section] = data;
    } else {
      current[section] = { ...current[section], ...data };
    }
  } else {
    current[section] = data;
  }

  // Validate section post-update
  const validation = validatePreferences(current, section);
  if (!validation.valid) {
    throw new Error(`Failed to update section '${section}' because the resulting data violates schema: ${validation.errors.join('; ')}`);
  }

  setPreferences(current, getPreferencesSource() || 'agent');

  // Sync to Chrome Extension if connected
  if (syncCallback) {
    try {
      syncCallback('preferences_sync', current);
    } catch (err) {
      console.error('[SchemaTools] Failed to sync updated preferences to extension:', err.message);
    }
  }

  return {
    success: true,
    section,
    message: `Section '${section}' successfully updated and validated.`,
    updatedData: current[section]
  };
}

/**
 * Retrieves the current preferences or a specific dot-delimited path.
 * @param {object} [args]
 * @param {string} [args.path] - e.g. "general.phone" or "education[0]"
 * @returns {object}
 */
export function handleGetPreferences(args = {}) {
  if (!hasPreferences()) {
    throw new Error("Preferences have not been provided yet. The AI agent must process the user's resume first or the user must upload their resume/preferences in the extension.");
  }

  const current = getLoadedPreferences();
  if (!args.path) {
    return {
      success: true,
      data: current,
      source: getPreferencesSource()
    };
  }

  const val = getNestedProperty(current, args.path);
  if (val === undefined) {
    throw new Error(`Path '${args.path}' not found in active preferences.`);
  }

  return {
    success: true,
    path: args.path,
    data: val,
    message: `Retrieved value for '${args.path}'`
  };
}

/**
 * Stores or registers a file (e.g. resume PDF/MD) into the session file storage.
 * Synchronizes immediately with the Chrome Extension so file_upload can access it.
 * @param {object} args
 * @param {string} args.name - Filename (e.g. "Resume.pdf")
 * @param {string} [args.data] - Base64 encoded file content
 * @param {string} [args.mimeType] - MIME type (e.g. "application/pdf")
 * @param {string} [args.description] - File description
 * @returns {object}
 */
export function handleStoreFile(args = {}) {
  if (!args.name) {
    throw new Error("Missing required argument: 'name'");
  }

  const fileEntry = {
    name: args.name,
    data: args.data || null,
    mimeType: args.mimeType || (args.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain'),
    description: args.description || 'User provided file',
    uploadedAt: new Date().toISOString()
  };

  sessionFiles.set(args.name, fileEntry);

  // Sync file over to the Chrome Extension so file_upload can find it in storage
  if (syncCallback) {
    try {
      syncCallback('file_sync', fileEntry);
    } catch (err) {
      console.error('[SchemaTools] Failed to sync stored file to extension:', err.message);
    }
  }

  return {
    success: true,
    message: `File '${args.name}' successfully stored in session storage and synchronized to the browser extension.`,
    fileName: args.name
  };
}

/**
 * Lists all files currently available in session storage.
 * @returns {object}
 */
export function handleListFiles() {
  const files = Array.from(sessionFiles.values()).map(f => ({
    name: f.name,
    mimeType: f.mimeType,
    description: f.description,
    hasData: Boolean(f.data),
    uploadedAt: f.uploadedAt
  }));

  return {
    success: true,
    totalFiles: files.length,
    files
  };
}
