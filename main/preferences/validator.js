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
 * @param {object} data - Full preferences object or section data
 * @param {string} [section] - Optional specific section to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePreferences(data, section = null) {
  const errors = [];

  if (data === null || data === undefined) {
    return { valid: false, errors: ["Preferences payload must be provided."] };
  }

  const validateGeneral = (gen) => {
    if (!gen || typeof gen !== "object" || Array.isArray(gen)) {
      errors.push("Missing or invalid 'general' section.");
      return;
    }
    if (!gen.firstName) errors.push("general.firstName is required.");
    if (!gen.lastName) errors.push("general.lastName is required.");
    if (!gen.fullName) errors.push("general.fullName is required.");
    if (!gen.email || !gen.email.includes("@")) errors.push("general.email must be a valid email address.");
    if (!gen.phone || typeof gen.phone !== "object" || Array.isArray(gen.phone)) {
      errors.push("general.phone object is required.");
    } else {
      if (!gen.phone.digits10 || !/^\d{10}$/.test(gen.phone.digits10)) {
        errors.push("general.phone.digits10 must be exactly 10 digits.");
      }
      if (!gen.phone.countryCode) errors.push("general.phone.countryCode is required.");
      if (!gen.phone.formatted) errors.push("general.phone.formatted is required.");
    }
  };

  const validateEducation = (eduList) => {
    if (!Array.isArray(eduList)) {
      errors.push("'education' must be an array.");
      return;
    }
    eduList.forEach((edu, idx) => {
      if (!edu || typeof edu !== "object") {
        errors.push(`education[${idx}] must be an object.`);
        return;
      }
      if (!edu.institution) errors.push(`education[${idx}].institution is required.`);
      if (!edu.degree) errors.push(`education[${idx}].degree is required.`);
      if (!edu.major) errors.push(`education[${idx}].major is required.`);
      if (!edu.graduationDate) errors.push(`education[${idx}].graduationDate is required.`);
      if (edu.pointers !== undefined && !Array.isArray(edu.pointers)) {
        errors.push(`education[${idx}].pointers must be an array of strings.`);
      }
    });
  };

  const validateExperience = (expList) => {
    if (!Array.isArray(expList)) {
      errors.push("'experience' must be an array.");
      return;
    }
    expList.forEach((exp, idx) => {
      if (!exp || typeof exp !== "object") {
        errors.push(`experience[${idx}] must be an object.`);
        return;
      }
      if (!exp.company) errors.push(`experience[${idx}].company is required.`);
      if (!exp.role) errors.push(`experience[${idx}].role is required.`);
      if (!exp.startDate) errors.push(`experience[${idx}].startDate is required.`);
      if (exp.pointers !== undefined && !Array.isArray(exp.pointers)) {
        errors.push(`experience[${idx}].pointers must be an array of strings.`);
      }
    });
  };

  const validateProjects = (projList) => {
    if (!Array.isArray(projList)) {
      errors.push("'projects' must be an array.");
      return;
    }
    projList.forEach((proj, idx) => {
      if (!proj || typeof proj !== "object") {
        errors.push(`projects[${idx}] must be an object.`);
        return;
      }
      if (!proj.title) errors.push(`projects[${idx}].title is required.`);
      if (!Array.isArray(proj.technologies)) {
        errors.push(`projects[${idx}].technologies is required and must be an array.`);
      }
      if (proj.pointers !== undefined && !Array.isArray(proj.pointers)) {
        errors.push(`projects[${idx}].pointers must be an array of strings.`);
      }
    });
  };

  const validateAwards = (awardsList) => {
    if (!Array.isArray(awardsList)) {
      errors.push("'awards' must be an array.");
      return;
    }
    awardsList.forEach((award, idx) => {
      if (!award || typeof award !== "object") {
        errors.push(`awards[${idx}] must be an object.`);
        return;
      }
      if (!award.title) errors.push(`awards[${idx}].title is required.`);
      if (award.pointers !== undefined && !Array.isArray(award.pointers)) {
        errors.push(`awards[${idx}].pointers must be an array of strings.`);
      }
    });
  };

  const validateSkills = (skills) => {
    if (!skills || typeof skills !== "object" || Array.isArray(skills)) {
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
    // If caller passed root object containing the section, unwrap it; otherwise use payload directly
    const sectionData = (typeof data === "object" && data !== null && !Array.isArray(data) && section in data)
      ? data[section]
      : data;

    switch (section) {
      case "general": validateGeneral(sectionData); break;
      case "education": validateEducation(sectionData); break;
      case "experience": validateExperience(sectionData); break;
      case "projects": validateProjects(sectionData); break;
      case "skills": validateSkills(sectionData); break;
      case "awards": validateAwards(sectionData); break;
      case "demographicsAndLegal":
        if (typeof sectionData !== "object" || sectionData === null || Array.isArray(sectionData)) {
          errors.push("demographicsAndLegal must be an object.");
        }
        break;
      case "customQA":
        if (typeof sectionData !== "object" || sectionData === null || Array.isArray(sectionData)) {
          errors.push("customQA must be an object.");
        }
        break;
      default:
        errors.push(`Unknown preference section: '${section}'`);
    }
  } else {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return { valid: false, errors: ["Preferences payload must be a non-null object."] };
    }
    validateGeneral(data.general);
    validateEducation(data.education);
    validateExperience(data.experience);
    validateProjects(data.projects);
    validateSkills(data.skills);
    if (data.awards !== undefined) validateAwards(data.awards);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Traverses an object using a dot/bracket notation path safely without prototype pollution.
 * Supports: "general.phone.digits10", "education[0].institution", "customQA['willing-to-relocate']"
 * @param {object} obj
 * @param {string} path
 * @returns {any}
 */
export function getPreferenceByPath(obj, path) {
  if (!obj || !path) return undefined;
  
  const cleanPath = path.replace(/^preferences\./i, "").trim();
  if (!cleanPath) return obj;

  // Tokenize dot and bracket notations safely
  const tokens = [];
  const regex = /(?:^|\.)([^\.\[\]]+)|\[['"]?([^'"\]]+)['"]?\]/g;
  let match;
  while ((match = regex.exec(cleanPath)) !== null) {
    const prop = match[1] !== undefined ? match[1] : match[2];
    if (prop) tokens.push(prop);
  }

  let current = obj;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    // Guard against prototype pollution
    if (token === '__proto__' || token === 'constructor' || token === 'prototype') {
      return undefined;
    }
    if (typeof current !== 'object') return undefined;
    current = current[token];
  }
  return current;
}

/**
 * Resolves template strings using the provided preferences object.
 * When preferences are active, unresolvable tokens resolve to empty string rather than
 * sending raw "${preferences...}" into form fields.
 * @param {any} input
 * @param {object} preferences
 * @returns {any}
 */
export function resolvePreferenceTemplate(input, preferences) {
  if (!preferences || typeof preferences !== "object") return input;

  if (typeof input === "string") {
    const singleTokenMatch = input.trim().match(/^\$\{preferences\.([^}]+)\}$/);
    if (singleTokenMatch) {
      const resolved = getPreferenceByPath(preferences, singleTokenMatch[1]);
      if (resolved === undefined || resolved === null) return "";
      if (typeof resolved === "object") return resolved;
      return String(resolved);
    }

    return input.replace(/\$\{preferences\.([^}]+)\}/g, (match, pathKey) => {
      const val = getPreferenceByPath(preferences, pathKey);
      if (val === undefined || val === null) {
        return "";
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
