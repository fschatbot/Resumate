/**
 * preferences/validator.js - Schema validation and template substitution for preferences.json
 */

export const PREFERENCE_SECTIONS = [
  "general",
  "education",
  "awards",
  "experience",
  "projects",
  "skills",
  "demographicsAndLegal",
  "customQA"
];

/**
 * Validates a preferences object or section.
 * @param {object} data
 * @param {string} [section] - Optional specific section to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePreferences(data, section = null) {
  const errors = [];

  if (!data || typeof data !== "object") {
    return { valid: false, errors: ["Preferences payload must be a non-null object."] };
  }

  const validateGeneral = (gen) => {
    if (!gen || typeof gen !== "object") {
      errors.push("Missing or invalid 'general' section.");
      return;
    }
    if (!gen.firstName) errors.push("general.firstName is required.");
    if (!gen.lastName) errors.push("general.lastName is required.");
    if (!gen.fullName) errors.push("general.fullName is required.");
    if (!gen.email || !gen.email.includes("@")) errors.push("general.email must be a valid email address.");
    if (!gen.phone || typeof gen.phone !== "object") {
      errors.push("general.phone object is required.");
    } else {
      if (!gen.phone.digits10 || !/^\d{10}$/.test(gen.phone.digits10)) {
        errors.push("general.phone.digits10 must be exactly 10 digits.");
      }
      if (!gen.phone.countryCode) errors.push("general.phone.countryCode is required.");
    }
  };

  const validateEducation = (eduList) => {
    if (!Array.isArray(eduList) || eduList.length === 0) {
      errors.push("Missing or empty 'education' array.");
      return;
    }
    eduList.forEach((edu, idx) => {
      if (!edu.institution) errors.push(`education[${idx}].institution is required.`);
      if (!edu.degree) errors.push(`education[${idx}].degree is required.`);
      if (!edu.major) errors.push(`education[${idx}].major is required.`);
      if (!edu.graduationDate) errors.push(`education[${idx}].graduationDate is required.`);
      if (!Array.isArray(edu.pointers)) errors.push(`education[${idx}].pointers must be an array of strings.`);
    });
  };

  const validateExperience = (expList) => {
    if (!Array.isArray(expList)) {
      errors.push("'experience' must be an array.");
      return;
    }
    expList.forEach((exp, idx) => {
      if (!exp.company) errors.push(`experience[${idx}].company is required.`);
      if (!exp.role) errors.push(`experience[${idx}].role is required.`);
      if (!exp.startDate) errors.push(`experience[${idx}].startDate is required.`);
      if (!Array.isArray(exp.pointers)) errors.push(`experience[${idx}].pointers must be an array of strings.`);
    });
  };

  const validateProjects = (projList) => {
    if (!Array.isArray(projList)) {
      errors.push("'projects' must be an array.");
      return;
    }
    projList.forEach((proj, idx) => {
      if (!proj.title) errors.push(`projects[${idx}].title is required.`);
      if (!Array.isArray(proj.technologies)) errors.push(`projects[${idx}].technologies must be an array.`);
      if (!Array.isArray(proj.pointers)) errors.push(`projects[${idx}].pointers must be an array of strings.`);
    });
  };

  const validateSkills = (skills) => {
    if (!skills || typeof skills !== "object") {
      errors.push("Missing or invalid 'skills' section.");
      return;
    }
    if (!Array.isArray(skills.languagesByProficiency)) {
      errors.push("skills.languagesByProficiency must be an array.");
    }
    if (!Array.isArray(skills.toolsAndFrameworks)) {
      errors.push("skills.toolsAndFrameworks must be an array.");
    }
    if (!Array.isArray(skills.developerToolsAndInfra)) {
      errors.push("skills.developerToolsAndInfra must be an array.");
    }
  };

  if (section) {
    switch (section) {
      case "general": validateGeneral(data); break;
      case "education": validateEducation(data); break;
      case "experience": validateExperience(data); break;
      case "projects": validateProjects(data); break;
      case "skills": validateSkills(data); break;
      case "awards":
        if (!Array.isArray(data)) errors.push("awards must be an array.");
        break;
      case "demographicsAndLegal":
        if (typeof data !== "object") errors.push("demographicsAndLegal must be an object.");
        break;
      case "customQA":
        if (typeof data !== "object") errors.push("customQA must be an object.");
        break;
      default:
        errors.push(`Unknown preference section: '${section}'`);
    }
  } else {
    validateGeneral(data.general);
    validateEducation(data.education);
    validateExperience(data.experience);
    validateProjects(data.projects);
    validateSkills(data.skills);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Traverses an object using a dot/bracket notation path.
 * e.g. "general.phone.digits10" or "education[0].institution"
 * @param {object} obj
 * @param {string} path
 * @returns {any}
 */
export function getPreferenceByPath(obj, path) {
  if (!obj || !path) return undefined;
  
  // Normalize bracket notation: education[0].institution -> education.0.institution
  const cleanPath = path
    .replace(/^preferences\./i, "")
    .replace(/\[(\w+)\]/g, ".$1")
    .replace(/^\./, "");

  const parts = cleanPath.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Resolves template strings like "${preferences.general.firstName} ${preferences.general.lastName}"
 * using the provided preferences object.
 * @param {any} input - String or nested object/array
 * @param {object} preferences - Preferences data object
 * @returns {any} Resolved value or unchanged input
 */
export function resolvePreferenceTemplate(input, preferences) {
  if (!preferences || typeof preferences !== "object") return input;

  if (typeof input === "string") {
    // Check if the entire string is a single template token: "${preferences.xyz}"
    const singleTokenMatch = input.trim().match(/^\$\{preferences\.([^}]+)\}$/);
    if (singleTokenMatch) {
      const resolved = getPreferenceByPath(preferences, singleTokenMatch[1]);
      if (resolved !== undefined) return resolved;
    }

    // Replace all occurrences in template string
    return input.replace(/\$\{preferences\.([^}]+)\}/g, (match, path) => {
      const val = getPreferenceByPath(preferences, path);
      if (val === undefined || val === null) {
        return match; // preserve token if unresolved
      }
      if (typeof val === "object") {
        return JSON.stringify(val);
      }
      return String(val);
    });
  }

  if (Array.isArray(input)) {
    return input.map(item => resolvePreferenceTemplate(item, preferences));
  }

  if (input !== null && typeof input === "object") {
    const copy = {};
    for (const key of Object.keys(input)) {
      copy[key] = resolvePreferenceTemplate(input[key], preferences);
    }
    return copy;
  }

  return input;
}
