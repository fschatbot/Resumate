import assert from 'node:assert/strict';
import { validatePreferences } from '../../preferences/validator.js';
import {
  handleSetPreferences,
  handleValidatePreferencesSchema,
  handleUpdatePreferencesSection,
  handleGetPreferences,
  handleStoreFile,
  handleListFiles
} from '../src/tools/schema-tools.js';
import { resolveTemplateVariables } from '../src/utils/template-resolver.js';

console.log('Running AutoResume MCP Server tests...');

// 1. Test Preferences Schema Validation
const samplePreferences = {
  general: {
    firstName: "Jane",
    lastName: "Doe",
    fullName: "Jane Doe",
    email: "jane.doe@example.com",
    phone: {
      countryCode: "+1",
      digits10: "5551234567",
      formatted: "+1 (555) 123-4567"
    }
  },
  education: [
    {
      institution: "Stanford University",
      degree: "B.S.",
      major: "Computer Science",
      graduationDate: "2024"
    }
  ],
  experience: [
    {
      company: "Acme Corp",
      role: "Software Engineer",
      startDate: "2022-06",
      endDate: "2024-05"
    }
  ],
  projects: [
    {
      title: "AutoResume",
      technologies: ["Node.js", "Chrome Extension", "MCP"]
    }
  ],
  skills: {
    languagesByProficiency: [{ language: "TypeScript", proficiency: "Expert" }],
    toolsAndFrameworks: ["React", "Node.js"],
    developerToolsAndInfra: ["Docker", "Git"]
  }
};

const validation = validatePreferences(samplePreferences);
assert.equal(validation.valid, true, `Validation should pass, but got: ${validation.errors.join(', ')}`);
console.log('✓ Full preferences validation passed.');

// 2. Test Single Section Validation
const generalValidation = validatePreferences(samplePreferences, 'general');
assert.equal(generalValidation.valid, true, 'Single section validation for general should pass.');
console.log('✓ Single section validation (general) passed.');

const educationValidation = validatePreferences(samplePreferences, 'education');
assert.equal(educationValidation.valid, true, 'Single section validation for education should pass.');
console.log('✓ Single section validation (education) passed.');

// 3. Test handleSetPreferences
const setRes = handleSetPreferences({ preferences: samplePreferences, source: 'test' });
assert.equal(setRes.success, true);
assert.equal(setRes.applicantName, 'Jane Doe');
console.log('✓ handleSetPreferences passed.');

// 4. Test Template Resolution
const resolved = resolveTemplateVariables("Applicant: ${preferences.general.fullName} (${preferences.general.email})");
assert.equal(resolved, "Applicant: Jane Doe (jane.doe@example.com)");
console.log('✓ Template variable resolution passed.');

// 5. Test Missing Optional Property Resolves Cleanly to Empty String
const missingResolved = resolveTemplateVariables("${preferences.general.links.github}");
assert.equal(missingResolved, "", "Missing optional link should resolve to empty string, not raw placeholder.");
console.log('✓ Missing template variable resolves to empty string safely.');

// 6. Test handleUpdatePreferencesSection
const updateRes = handleUpdatePreferencesSection({
  section: "customQA",
  data: { "willing-to-relocate": "Yes", "desiredSalary": "$150,000" }
});
assert.equal(updateRes.success, true);
console.log('✓ handleUpdatePreferencesSection passed.');

// 7. Test handleStoreFile and handleListFiles
const storeRes = handleStoreFile({
  name: "Resume.pdf",
  data: "JVBERi0xLjQK...",
  mimeType: "application/pdf",
  description: "Test Resume"
});
assert.equal(storeRes.success, true);

const listRes = handleListFiles();
assert.equal(listRes.totalFiles, 1);
assert.equal(listRes.files[0].name, "Resume.pdf");
console.log('✓ handleStoreFile & handleListFiles passed.');

console.log('\nAll AutoResume MCP tests passed successfully!');
