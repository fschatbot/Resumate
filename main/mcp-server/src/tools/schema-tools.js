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

/**
 * Initializes or sets the applicant preferences.
 * Call this after the AI agent parses the user's resume or when the user uploads a preference JSON.
 * @param {object} args
 * @param {object} args.preferences - The preferences object matching preferences.schema.json
 * @param {string} [args.source="agent"] - Source origin ("agent", "extension_upload", "user")
 * @returns {object}
 */
export function handleSetPreferences(args = {}) {
  const { preferences, source = "agent" } = args;

  if (!preferences || typeof preferences !== 'object') {
    return {
      success: false,
      error: "INVALID_ARGUMENT",
      message: "Missing required argument: 'preferences' (must be an object matching preferences.schema.json)."
    };
  }

  // Validate against schema
  const validation = validatePreferences(preferences);
  if (!validation.valid) {
    return {
      success: false,
      error: "SCHEMA_VALIDATION_FAILED",
      errors: validation.errors,
      message: `Provided preferences failed schema validation with ${validation.errors.length} error(s).`
    };
  }

  setPreferences(preferences, source);

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
    return {
      valid: false,
      error: "PREFERENCES_NOT_PROVIDED",
      message: "No preferences provided to validate. Please provide 'preferences' in the tool arguments or call set_preferences first."
    };
  }

  const result = validatePreferences(data, section);
  return {
    valid: result.valid,
    section: section || "all",
    errors: result.errors,
    message: result.valid
      ? `Preferences schema validation succeeded for ${section ? `section '${section}'` : 'entire document'}.`
      : `Preferences schema validation failed with ${result.errors.length} error(s).`
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
    return {
      success: false,
      error: "MISSING_SECTION",
      message: "Missing required argument: 'section'"
    };
  }

  let current = getLoadedPreferences();
  if (!current) {
    current = {};
  } else {
    current = JSON.parse(JSON.stringify(current)); // clone
  }

  const { section, data, overwrite = false } = args;

  if (Array.isArray(current[section]) && Array.isArray(data)) {
    if (overwrite) {
      current[section] = data;
    } else {
      current[section].push(...data);
    }
  } else if (typeof current[section] === 'object' && typeof data === 'object' && data !== null) {
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
    return {
      success: false,
      section,
      errors: validation.errors,
      message: `Failed to update section '${section}' because the resulting data violates schema.`
    };
  }

  setPreferences(current, getPreferencesSource() || 'agent');

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
    return {
      success: false,
      error: "PREFERENCES_NOT_INITIALIZED",
      message: "Preferences have not been provided yet. The AI agent must process the user's resume first or the user must upload their resume/preferences in the extension."
    };
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
  return {
    success: val !== undefined,
    path: args.path,
    data: val !== undefined ? val : null,
    message: val !== undefined ? `Retrieved value for '${args.path}'` : `Path '${args.path}' not found in preferences.`
  };
}

/**
 * Stores or registers a file (e.g. resume PDF/MD) into the session file storage.
 * @param {object} args
 * @param {string} args.name - Filename (e.g. "Resume.pdf")
 * @param {string} [args.data] - Base64 encoded file content
 * @param {string} [args.mimeType] - MIME type (e.g. "application/pdf")
 * @param {string} [args.description] - File description
 * @returns {object}
 */
export function handleStoreFile(args = {}) {
  if (!args.name) {
    return { success: false, error: "MISSING_NAME", message: "Argument 'name' is required." };
  }

  sessionFiles.set(args.name, {
    name: args.name,
    data: args.data || null,
    mimeType: args.mimeType || (args.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain'),
    description: args.description || 'User provided file',
    uploadedAt: new Date().toISOString()
  });

  return {
    success: true,
    message: `File '${args.name}' successfully stored in session storage for web form injection.`,
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
    uploadedAt: f.uploadedAt,
    hasContent: Boolean(f.data)
  }));

  return {
    success: true,
    totalFiles: files.length,
    files
  };
}
