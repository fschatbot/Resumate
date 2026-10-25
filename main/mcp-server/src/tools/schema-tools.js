import { validatePreferences, PREFERENCE_SECTIONS } from '../../../preferences/validator.js';
import {
  setPreferences,
  getLoadedPreferences,
  hasPreferences,
  getNestedProperty,
  getPreferencesSource,
  clearPreferences
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
 * Clears applicant preferences from memory and notifies the extension.
 */
export function handleClearPreferences() {
  clearPreferences();
  if (syncCallback) {
    try {
      syncCallback('preferences_cleared', {});
    } catch (err) {}
  }
  return { success: true, message: "Preferences cleared from session memory." };
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
 * Deduplicates arrays to avoid duplicate entries when re-merging.
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
      // Deduplicate when appending to arrays
      const existing = current[section];
      for (const item of data) {
        let isDuplicate = false;
        if (typeof item === 'object' && item !== null) {
          if (section === 'experience' && item.company && item.role) {
            isDuplicate = existing.some(e => e.company?.toLowerCase() === item.company.toLowerCase() && e.role?.toLowerCase() === item.role.toLowerCase());
          } else if (section === 'education' && item.institution) {
            isDuplicate = existing.some(e => e.institution?.toLowerCase() === item.institution.toLowerCase());
          } else if ((section === 'projects' || section === 'awards') && item.title) {
            isDuplicate = existing.some(e => e.title?.toLowerCase() === item.title.toLowerCase());
          } else {
            isDuplicate = existing.some(e => JSON.stringify(e) === JSON.stringify(item));
          }
        } else {
          isDuplicate = existing.includes(item);
        }

        if (!isDuplicate) {
          existing.push(item);
        }
      }
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

  const activeSource = getPreferencesSource();
  setPreferences(current, activeSource);

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
 * Normalizes mimeType and type so both match across extension and server.
 * @param {object} args
 * @param {string} args.name - Filename (e.g. "Resume.pdf")
 * @param {string} [args.data] - Base64 encoded file content
 * @param {string} [args.mimeType] - MIME type
 * @param {string} [args.type] - Fallback MIME type from extension
 * @param {string} [args.description] - File description
 * @param {string} [args.size] - File size string
 * @returns {object}
 */
export function handleStoreFile(args = {}) {
  if (!args.name) {
    throw new Error("Missing required argument: 'name'");
  }

  const normalizedMime = args.mimeType || args.type || (args.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : (args.name.toLowerCase().endsWith('.json') ? 'application/json' : 'text/plain'));

  const fileEntry = {
    name: args.name,
    data: args.data || null,
    mimeType: normalizedMime,
    type: normalizedMime,
    size: args.size || (args.data ? `${Math.round(args.data.length * 0.75 / 1024)} KB` : 'Unknown'),
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
 * Deletes a file from session storage.
 * @param {string} fileName
 * @returns {object}
 */
export function handleDeleteFile(fileName) {
  if (!fileName) throw new Error("Missing fileName parameter.");
  const deleted = sessionFiles.delete(fileName);
  if (syncCallback) {
    try {
      syncCallback('file_deleted', { name: fileName });
    } catch (err) {}
  }
  return { success: deleted, message: deleted ? `File '${fileName}' deleted from session.` : `File '${fileName}' not found.` };
}

/**
 * Searches and retrieves a file from session storage.
 * If query is provided, performs exact, case-insensitive, or substring matches.
 * If query is omitted, prioritizes resume/CV documents, or defaults to the first available file.
 * @param {string} [query] - Optional filename or keyword
 * @returns {object|null}
 */
export function findSessionFile(query) {
  if (sessionFiles.size === 0) return null;

  if (query && typeof query === 'string') {
    const qTrim = query.trim();
    // 1. Exact match
    if (sessionFiles.has(qTrim)) return sessionFiles.get(qTrim);

    // 2. Case-insensitive match
    const lower = qTrim.toLowerCase();
    for (const [name, file] of sessionFiles.entries()) {
      if (name.toLowerCase() === lower) return file;
    }

    // 3. Substring / stem match
    for (const [name, file] of sessionFiles.entries()) {
      if (name.toLowerCase().includes(lower) || lower.includes(name.toLowerCase())) {
        return file;
      }
    }
  }

  // 4. Default / fallback: search for resume or cv
  for (const [name, file] of sessionFiles.entries()) {
    if (/resume|cv|curriculum/i.test(name)) {
      return file;
    }
  }

  // 5. If only one file exists, return it
  if (sessionFiles.size === 1) {
    return sessionFiles.values().next().value;
  }

  // 6. Otherwise return first file
  return sessionFiles.values().next().value || null;
}

/**
 * Lists all files currently available in session storage.
 * @returns {object}
 */
export function handleListFiles() {
  const files = Array.from(sessionFiles.values()).map(f => ({
    name: f.name,
    mimeType: f.mimeType,
    type: f.mimeType,
    size: f.size,
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

/**
 * Reads the text/data content of an uploaded or stored file.
 * Returns text extracts without dumping multi-megabyte base64 into agent context
 * unless explicitly requested via `includeBase64: true`.
 * @param {object} args
 * @param {string} args.name - Filename
 * @param {boolean} [args.includeBase64=false] - Whether to include raw base64 data
 * @returns {object}
 */
export function handleReadFile(args = {}) {
  if (!args.name) {
    throw new Error("Missing required argument: 'name'");
  }

  const file = sessionFiles.get(args.name);
  if (!file) {
    const available = Array.from(sessionFiles.keys()).join(', ') || 'none';
    throw new Error(`File '${args.name}' not found in session storage. Available files: ${available}`);
  }

  let textContent = null;
  let byteSize = 0;

  if (file.data) {
    try {
      let base64Clean = file.data.replace(/^data:[^;]+;base64,/, '').trim();
      base64Clean = base64Clean.replace(/-/g, '+').replace(/_/g, '/');
      while (base64Clean.length % 4) base64Clean += '=';
      const buf = Buffer.from(base64Clean, 'base64');
      byteSize = buf.length;

      if (file.name.endsWith('.md') || file.name.endsWith('.json') || file.name.endsWith('.txt') || file.mimeType?.includes('text') || file.mimeType?.includes('json')) {
        textContent = buf.toString('utf8');
      } else if (file.name.endsWith('.pdf') || file.mimeType?.includes('pdf')) {
        // Robust PDF text extraction (matching Tj, TJ arrays, and readable strings in BT...ET blocks)
        const raw = buf.toString('latin1');
        const extracted = [];

        // Match BT ... ET blocks
        const btBlocks = raw.match(/BT[\s\S]*?ET/g) || [];
        for (const block of btBlocks) {
          // Match (string) Tj
          const tjMatches = [...block.matchAll(/\(([^)]{1,})\)\s*Tj/g)].map(m => m[1]);
          if (tjMatches.length > 0) extracted.push(...tjMatches);

          // Match [(string) num (string)] TJ
          const arrayMatches = [...block.matchAll(/\[(.*?)\]\s*TJ/g)];
          for (const arr of arrayMatches) {
            const inner = [...arr[1].matchAll(/\(([^)]{1,})\)/g)].map(m => m[1]);
            if (inner.length > 0) extracted.push(inner.join(''));
          }
        }

        if (extracted.length > 0) {
          textContent = extracted.join(' ').replace(/\\([()\\])/g, '$1').replace(/\s+/g, ' ').trim();
        } else {
          // General ASCII fallback
          const asciiMatches = [...raw.matchAll(/\(([^)]{2,})\)/g)].map(m => m[1]).filter(s => /^[a-zA-Z0-9\s.,;:'"()@/\\-_]{3,}$/.test(s));
          if (asciiMatches.length > 0) {
            textContent = asciiMatches.join(' ').replace(/\s+/g, ' ').trim();
          } else {
            textContent = `[PDF Document: ${file.name} (${Math.round(byteSize / 1024)} KB). Binary content ready for file_upload.]`;
          }
        }
      }
    } catch (e) {
      textContent = `[Failed to decode file text: ${e.message}]`;
    }
  }

  const result = {
    success: true,
    name: file.name,
    mimeType: file.mimeType,
    description: file.description,
    hasData: Boolean(file.data),
    size: file.size || `${Math.round(byteSize / 1024)} KB`,
    text: textContent
  };

  // Only return base64 if explicitly requested to avoid overflowing LLM context window
  if (args.includeBase64) {
    result.data = file.data;
  }

  return result;
}
