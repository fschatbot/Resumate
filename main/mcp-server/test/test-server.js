import assert from 'node:assert/strict';
import { validatePreferences } from '../../preferences/validator.js';
import {
  handleSetPreferences,
  handleValidatePreferencesSchema,
  handleUpdatePreferencesSection,
  handleGetPreferences,
  handleStoreFile,
  handleListFiles,
  handleReadFile,
  handleDeleteFile,
  handleClearPreferences
} from '../src/tools/schema-tools.js';
import { resolveTemplateVariables } from '../src/utils/template-resolver.js';
import { AXTreeTracker } from '../src/utils/ax-tree-tracker.js';

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

// 8. Test handleReadFile (Markdown & PDF)
const storeMd = handleStoreFile({
  name: "Resume.md",
  data: Buffer.from("# Jane Doe\nSoftware Engineer").toString('base64'),
  mimeType: "text/markdown",
  description: "Markdown resume"
});
assert.equal(storeMd.success, true);

const readMdRes = handleReadFile({ name: "Resume.md" });
assert.equal(readMdRes.success, true);
assert.equal(readMdRes.text, "# Jane Doe\nSoftware Engineer");
console.log('✓ handleReadFile (Resume.md) passed.');

// 9. Test AXTreeTracker & Delta Diff Engine
const tracker = new AXTreeTracker();

// Initial snapshot establishes baseline
const initialSnapshot = {
  title: "Job Application",
  url: "https://careers.example.com/apply",
  interactiveCount: 3,
  totalNodes: 10,
  compactTree: [
    '@e10 -> textbox "First Name" [required]',
    '@e11 -> textbox "Last Name" [required]',
    '@e14 -> combobox "Shipping Method" [required, collapsed]'
  ].join('\n'),
  yaml: "- RootWebArea\n  - combobox id: @e14"
};

const initialDelta = tracker.updatePageState(initialSnapshot);
assert.equal(initialDelta.hasChanges, true);
assert.equal(initialDelta.addedCount, 3);
console.log('✓ AXTreeTracker initial baseline ingestion passed.');

// Mutated snapshot: @e14 value changed to "Express" and new options rendered
const mutatedSnapshot = {
  title: "Job Application",
  url: "https://careers.example.com/apply",
  interactiveCount: 5,
  totalNodes: 12,
  compactTree: [
    '@e10 -> textbox "First Name" [required]',
    '@e11 -> textbox "Last Name" [required]',
    '@e14 -> combobox "Shipping Method": "Express" [required, expanded]',
    '@e15 -> text "Calculated Total: $45.00"',
    '@e16 -> button "Continue to Payment"'
  ].join('\n')
};

const secondDelta = tracker.updatePageState(mutatedSnapshot);
assert.equal(secondDelta.hasChanges, true, 'Mutations should be detected');
assert.equal(secondDelta.addedCount, 2, 'Two new elements added (@e15, @e16)');
assert.ok(secondDelta.deltaText.includes('Shipping Method'), 'Delta text should mention modified element');
assert.ok(secondDelta.deltaText.includes('@e15'), 'Delta text should include added element');
console.log('✓ AXTreeTracker delta diff detection (+added, ~changed) passed.');

// Test minimal response formatting with delta
const formattedAction = tracker.formatActionResultWithDelta('browser_click', { success: true, message: 'Clicked @e14' }, secondDelta);
assert.ok(formattedAction.startsWith('Clicked @e14'));
assert.ok(formattedAction.includes('[DOM Mutation Delta |'), `Expected delta header, got: "${formattedAction}"`);
assert.ok(formattedAction.includes('Shipping Method'), 'Delta text should mention modified element');
console.log('✓ Minimal tool result formatting with delta passed.');

// Test clean status when no DOM mutations occur
const unmutatedDelta = tracker.updatePageState(mutatedSnapshot);
assert.equal(unmutatedDelta.hasChanges, false);
const cleanAction = tracker.formatActionResultWithDelta('browser_click', { success: true, message: 'Clicked @e14' }, unmutatedDelta);
assert.equal(cleanAction, 'Clicked @e14 [No DOM mutations]');
console.log('✓ Minimal tool result without DOM mutations passed.');

// Test MCP Resource text generation
const resourceText = tracker.getInteractiveElementsResource();
assert.ok(resourceText.includes('Job Application'));
assert.ok(resourceText.includes('@e10 -> textbox'));
console.log('✓ Interactive elements resource formatting passed.');

// 10. Test Preference Location & Legal Aliases
const sampleWithLegal = {
  ...samplePreferences,
  general: {
    ...samplePreferences.general,
    address: {
      city: "San Francisco",
      state: "CA",
      country: "United States"
    }
  },
  demographicsAndLegal: {
    workAuthorizationType: "US Citizen",
    authorizedInUS: true,
    requiresSponsorship: false
  }
};
handleSetPreferences({ preferences: sampleWithLegal, source: 'test' });

const aliasCity = resolveTemplateVariables("${preferences.general.location.city}");
assert.equal(aliasCity, "San Francisco", "general.location.city should resolve to general.address.city alias");

const aliasAuth = resolveTemplateVariables("${preferences.workAuthorization.authorizedInUS}");
assert.equal(aliasAuth, true, "workAuthorization.authorizedInUS should resolve to demographicsAndLegal alias");
console.log('✓ Preference template convenience aliases (location, workAuthorization) passed.');

// 11. Test Missing Critical/Legal Field Throws Error
assert.throws(() => {
  resolveTemplateVariables("${preferences.demographicsAndLegal.nonExistentField}");
}, /could not be resolved: property.*is missing or undefined/, "Missing legal/critical field should throw descriptive error instead of silently blanking.");
console.log('✓ Missing critical/legal preference property throws descriptive error.');

// 12. Test Array Deduplication in handleUpdatePreferencesSection
handleUpdatePreferencesSection({
  section: "education",
  data: [
    {
      institution: "Stanford University",
      degree: "B.S.",
      major: "Computer Science",
      graduationDate: "2024"
    },
    {
      institution: "MIT",
      degree: "M.S.",
      major: "AI",
      graduationDate: "2026"
    }
  ]
});
const updatedPrefs = handleGetPreferences();
assert.equal(updatedPrefs.data.education.length, 2, "Duplicate education entry should not be appended twice");
console.log('✓ Array deduplication in handleUpdatePreferencesSection passed.');

// 13. Test File Deletion
const deleteFileRes = handleDeleteFile("Resume.pdf");
assert.equal(deleteFileRes.success, true);
const remainingFiles = handleListFiles();
assert.equal(remainingFiles.files.some(f => f.name === "Resume.pdf"), false);
console.log('✓ handleDeleteFile passed.');

// 14. Test Preferences Clearing
const clearRes = handleClearPreferences();
assert.equal(clearRes.success, true);
assert.throws(() => handleGetPreferences(), /Preferences have not been provided yet/);
console.log('✓ handleClearPreferences passed.');

// 15. Test AXTreeTracker Per-Tab Isolation
const multiTabTracker = new AXTreeTracker();
multiTabTracker.updatePageState({
  title: "Tab 101 Page",
  url: "https://example.com/101",
  interactiveCount: 1,
  totalNodes: 5,
  compactTree: '@e1 -> textbox "Search 101"'
}, 101);

multiTabTracker.updatePageState({
  title: "Tab 202 Page",
  url: "https://example.com/202",
  interactiveCount: 2,
  totalNodes: 8,
  compactTree: '@e1 -> button "Submit 202"'
}, 202);

assert.ok(multiTabTracker.getInteractiveElementsResource(101).includes("Search 101"));
assert.ok(multiTabTracker.getInteractiveElementsResource(202).includes("Submit 202"));
assert.ok(!multiTabTracker.getInteractiveElementsResource(101).includes("Submit 202"));
console.log('✓ AXTreeTracker per-tab isolation passed.');

console.log('\nAll AutoResume MCP tests passed successfully!');
