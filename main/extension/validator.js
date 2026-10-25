/**
 * preferences/validator.js - Schema validation and template substitution for preferences.json
 *
 * NOTE: This file is a browser-compatible copy of preferences/validator.js required by the
 * Chrome Extension Service Worker (background.js). Both files must be kept in sync.
 * The mcp-server imports directly from preferences/validator.js (Node.js environment).
 */

export const PREFERENCE_SECTIONS = [
  "general",
  "education",
  "awards",
  "experience",
  "projects",
  "skills",
  "demographicsAndLegal",
  "workAuthorization",
  "customQA"
];

/**
 * Validates a preferences object or section against the standardized schema.
 * @param {object} data - Full preferences object or section data
 * @param {string} [section] - Optional specific section to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePreferences(data, section = null) {
  const errors = [];

  if (data === null || data === undefined) {
    return { valid: false, errors: ["Preferences payload must be provided."] };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const uriRegex = /^https?:\/\/[^\s$.?#].[^\s]*$/i;

  const validateGeneral = (gen) => {
    if (!gen || typeof gen !== "object" || Array.isArray(gen)) {
      errors.push("Missing or invalid 'general' section.");
      return;
    }
    if (!gen.firstName || typeof gen.firstName !== "string") errors.push("general.firstName is required.");
    if (!gen.lastName || typeof gen.lastName !== "string") errors.push("general.lastName is required.");
    if (!gen.fullName || typeof gen.fullName !== "string") errors.push("general.fullName is required.");
    if (!gen.email || !emailRegex.test(gen.email.trim())) {
      errors.push("general.email must be a valid email address (e.g. 'applicant@example.com').");
    }
    if (!gen.phone || typeof gen.phone !== "object" || Array.isArray(gen.phone)) {
      errors.push("general.phone object is required.");
    } else {
      if (!gen.phone.digits10 || !/^\d{7,15}$/.test(String(gen.phone.digits10).trim())) {
        errors.push("general.phone.digits10 must be a valid phone number (7 to 15 digits).");
      }
      if (!gen.phone.countryCode) errors.push("general.phone.countryCode is required.");
      if (!gen.phone.formatted) errors.push("general.phone.formatted is required.");
    }

    if (gen.links && typeof gen.links === "object" && !Array.isArray(gen.links)) {
      for (const [key, linkVal] of Object.entries(gen.links)) {
        if (linkVal && typeof linkVal === "string" && !uriRegex.test(linkVal.trim())) {
          errors.push(`general.links.${key} must be a valid HTTP/HTTPS URL.`);
        }
      }
    }

    if (gen.knownLanguages && Array.isArray(gen.knownLanguages)) {
      const validProficiencies = ["Native", "Fluent", "Professional", "Intermediate", "Basic"];
      gen.knownLanguages.forEach((kl, idx) => {
        if (!kl || typeof kl !== "object" || !kl.language) {
          errors.push(`general.knownLanguages[${idx}].language is required.`);
        }
        if (kl && kl.proficiency && !validProficiencies.includes(kl.proficiency)) {
          errors.push(`general.knownLanguages[${idx}].proficiency must be one of: ${validProficiencies.join(', ')}.`);
        }
      });
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

  const validateDemographicsAndLegal = (dem) => {
    if (!dem || typeof dem !== "object" || Array.isArray(dem)) {
      errors.push("demographicsAndLegal must be an object.");
      return;
    }
    const booleanFields = [
      "legallyAuthorizedToWork",
      "requiresVisaSponsorship",
      "authorizedInUS",
      "requiresSponsorship",
      "willRequireFutureSponsorship",
      "isOver18"
    ];
    for (const bf of booleanFields) {
      if (dem[bf] !== undefined && typeof dem[bf] !== "boolean") {
        errors.push(`demographicsAndLegal.${bf} must be a boolean.`);
      }
    }
    const stringFields = [
      "workAuthorizationType",
      "veteranStatus",
      "disabilityStatus",
      "gender",
      "raceOrEthnicity"
    ];
    for (const sf of stringFields) {
      if (dem[sf] !== undefined && typeof dem[sf] !== "string") {
        errors.push(`demographicsAndLegal.${sf} must be a string.`);
      }
    }
  };

  const validateCustomQA = (qa) => {
    if (!qa || typeof qa !== "object" || Array.isArray(qa)) {
      errors.push("customQA must be an object of key-value questions and answers.");
      return;
    }
    for (const [k, v] of Object.entries(qa)) {
      if (v === null || (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean")) {
        errors.push(`customQA['${k}'] must be a string, number, or boolean.`);
      }
    }
  };

  if (section) {
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
      case "workAuthorization":
        validateDemographicsAndLegal(sectionData);
        break;
      case "customQA":
        validateCustomQA(sectionData);
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
    if (data.demographicsAndLegal !== undefined) validateDemographicsAndLegal(data.demographicsAndLegal);
    if (data.workAuthorization !== undefined) validateDemographicsAndLegal(data.workAuthorization);
    if (data.customQA !== undefined) validateCustomQA(data.customQA);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Traverses an object using a dot/bracket notation path safely without prototype pollution.
 * Supports automatic alias resolution:
 * - general.location.* <-> general.address.*
 * - workAuthorization.authorizedInUS <-> demographicsAndLegal.legallyAuthorizedToWork
 * - workAuthorization.requiresSponsorship <-> demographicsAndLegal.requiresVisaSponsorship
 * @param {object} obj
 * @param {string} path
 * @returns {any}
 */
export function getPreferenceByPath(obj, path) {
  if (!obj || !path) return undefined;

  let cleanPath = path.replace(/^preferences\./i, "").trim();
  if (!cleanPath) return obj;

  function lookup(currentObj, targetPath) {
    const tokens = [];
    const regex = /(?:^|\.)([^\.\[\]]+)|\[['"]?([^'"\]]+)['"]?\]/g;
    let match;
    while ((match = regex.exec(targetPath)) !== null) {
      const prop = match[1] !== undefined ? match[1] : match[2];
      if (prop) tokens.push(prop);
    }

    let curr = currentObj;
    for (const token of tokens) {
      if (curr === null || curr === undefined) return undefined;
      if (token === '__proto__' || token === 'constructor' || token === 'prototype') {
        return undefined;
      }
      if (typeof curr !== 'object') return undefined;
      curr = curr[token];
    }
    return curr;
  }

  let result = lookup(obj, cleanPath);
  if (result !== undefined) return result;

  // Semantic Aliases
  if (cleanPath.startsWith("general.location.")) {
    const altPath = cleanPath.replace(/^general\.location\./, "general.address.");
    result = lookup(obj, altPath);
    if (result !== undefined) return result;
  } else if (cleanPath.startsWith("general.address.")) {
    const altPath = cleanPath.replace(/^general\.address\./, "general.location.");
    result = lookup(obj, altPath);
    if (result !== undefined) return result;
  } else if (cleanPath === "workAuthorization.authorizedInUS" || cleanPath === "demographicsAndLegal.authorizedInUS") {
    result = lookup(obj, "demographicsAndLegal.legallyAuthorizedToWork") ?? lookup(obj, "workAuthorization.authorizedInUS") ?? lookup(obj, "demographicsAndLegal.authorizedInUS");
    if (result !== undefined) return result;
  } else if (cleanPath === "workAuthorization.requiresSponsorship" || cleanPath === "demographicsAndLegal.requiresSponsorship") {
    result = lookup(obj, "demographicsAndLegal.requiresVisaSponsorship") ?? lookup(obj, "workAuthorization.requiresSponsorship") ?? lookup(obj, "demographicsAndLegal.requiresSponsorship");
    if (result !== undefined) return result;
  } else if (cleanPath === "demographicsAndLegal.legallyAuthorizedToWork") {
    result = lookup(obj, "workAuthorization.authorizedInUS") ?? lookup(obj, "demographicsAndLegal.authorizedInUS");
    if (result !== undefined) return result;
  } else if (cleanPath === "demographicsAndLegal.requiresVisaSponsorship") {
    result = lookup(obj, "workAuthorization.requiresSponsorship") ?? lookup(obj, "demographicsAndLegal.requiresSponsorship");
    if (result !== undefined) return result;
  }

  return undefined;
}

/**
 * Resolves template strings using the provided preferences object.
 * If a variable is unknown or missing from active preferences, raises an explicit
 * error or returns empty string for documented optional fields.
 * @param {any} input
 * @param {object} preferences
 * @returns {any}
 */
export function resolvePreferenceTemplate(input, preferences) {
  if (!preferences || typeof preferences !== "object") return input;

  function resolveToken(pathKey) {
    const val = getPreferenceByPath(preferences, pathKey);
    if (val !== undefined) {
      return val;
    }
    // Allow documented optional fields (e.g. social links, minor) to resolve to empty string
    if (
      pathKey.includes('.links.') ||
      pathKey.endsWith('.minor') ||
      pathKey.endsWith('.preferredName') ||
      pathKey.endsWith('.pointers')
    ) {
      return "";
    }
    // For required/legal fields, throw an explicit error to prevent silent blank submissions
    throw new Error(`Template variable '\${preferences.${pathKey}}' could not be resolved: property '${pathKey}' is missing or undefined in applicant preferences.`);
  }

  if (typeof input === "string") {
    const singleTokenMatch = input.trim().match(/^\$\{preferences\.([^}]+)\}$/);
    if (singleTokenMatch) {
      const resolved = resolveToken(singleTokenMatch[1]);
      if (resolved === undefined || resolved === null) return "";
      if (typeof resolved === "object") return resolved;
      if (typeof resolved === "boolean" || typeof resolved === "number") return resolved;
      return String(resolved);
    }

    return input.replace(/\$\{preferences\.([^}]+)\}/g, (match, pathKey) => {
      const val = resolveToken(pathKey);
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
