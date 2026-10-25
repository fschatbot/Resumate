/**
 * sidepanel.js - AutoResume Side Panel UI Controller
 *
 * Implements shadcn Lyra styling (preset b2CRCnflY), Lucide icon rendering,
 * compact animated live tool execution stream, 2-tab layout, and dynamic configuration.
 */

// Global State
let isConnected = false;
let executionHistory = [];
let storedFiles = [];
let activePreferences = null;

// DOM Elements
const bridgeBadge = document.getElementById('bridgeBadge');
const bridgeStatusText = document.getElementById('bridgeStatusText');
const statToolsCount = document.getElementById('statToolsCount');
const statFilesCount = document.getElementById('statFilesCount');
const statTabId = document.getElementById('statTabId');
const statTabContainer = document.getElementById('statTabContainer');
const toolListContainer = document.getElementById('toolListContainer');
const clearFeedBtn = document.getElementById('clearFeedBtn');
const tooltip = document.getElementById('globalTooltip');
const filesGridContainer = document.getElementById('filesGridContainer');
const addFileBtn = document.getElementById('addFileBtn');
const realFileInput = document.getElementById('realFileInput');
const navTabs = document.querySelectorAll('.tabs-trigger');
const tabPanes = document.querySelectorAll('.tab-content');

// Controls
const chatGreeting = document.getElementById('chatGreeting');
const startAutofillBtn = document.getElementById('startAutofillBtn');
const verifyPageBtn = document.getElementById('verifyPageBtn');
const setActiveTabBtn = document.getElementById('setActiveTabBtn');

// Lucide Icon Set
const LUCIDE_ICONS = {
  browser_navigate: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  browser_go_back: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
  browser_go_forward: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
  browser_snapshot: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>',
  read_page: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  browser_screenshot: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  find: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  get_page_text: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  browser_click: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 5.1"/><path d="m5.1 8-2.9-.8"/><path d="M14 4.1 12 6"/><path d="m6 12-1.9 2"/></svg>',
  browser_hover: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>',
  browser_type: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="8" x2="6" y2="8"/><line x1="10" y1="8" x2="10" y2="8"/><line x1="14" y1="8" x2="14" y2="8"/><line x1="18" y1="8" x2="18" y2="8"/><line x1="6" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="18" y2="12"/><line x1="7" y1="16" x2="17" y2="16"/></svg>',
  browser_press_key: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>',
  browser_select_option: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  form_input: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  file_upload: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
  browser_wait: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>',
  browser_batch: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  set_preferences: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/></svg>',
  update_preferences_section: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/></svg>',
  get_preferences: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
  store_file: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
  list_files: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  read_file: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>',
  tabs_context: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>',
  tabs_context_mcp: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><path d="M8 2v4"/><path d="M16 2v4"/></svg>',
  tabs_create: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>',
  browser_double_click: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 5.1"/><path d="m5.1 8-2.9-.8"/></svg>',
  browser_triple_click: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 9 5 12 1.8-5.2L21 14Z"/><path d="M7.2 2.2 8 5.1"/><path d="M14 4.1 12 6"/></svg>',
  browser_drag: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>',
  tabs_target: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="2" y2="12"/><line x1="12" y1="6" x2="12" y2="2"/><line x1="12" y1="22" x2="12" y2="18"/></svg>',
  tabs_untarget: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
  tabs_close: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="10" y1="12" x2="14" y2="16"/><line x1="14" y1="12" x2="10" y2="16"/></svg>',
  javascript_exec: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  default: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/></svg>'
};

const CHEVRON_ICON = '<svg class="chevron-indicator" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// Initialization & 2-Tab Navigation
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigationTabs();
  setupTooltip();
  setupFileUpload();
  setupQuickActions();
  setupActiveTabButtons();
  setupProviderSettings();

  // Listen for local storage changes so files & preferences always sync dynamically
  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && (changes.files || changes.preferences)) {
        loadStoredFiles();
      }
    });
  }

  // Query background for initial telemetry state and active tab
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (state) applyTelemetryState(state);
  });

  // Make bridge badge clickable for immediate manual reconnect
  if (bridgeBadge) {
    bridgeBadge.style.cursor = 'pointer';
    bridgeBadge.title = 'Click to reconnect bridge';
    bridgeBadge.addEventListener('click', () => {
      if (bridgeStatusText) bridgeStatusText.textContent = 'Connecting...';
      chrome.runtime.sendMessage({ type: "RECONNECT_BRIDGE" }, () => {
        chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
          if (state) applyTelemetryState(state);
        });
      });
    });
  }

  // Periodic polling interval to keep background active and automatically reconnect when offline
  setInterval(() => {
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
      if (chrome.runtime.lastError) return;
      if (state) applyTelemetryState(state);
    });
  }, 2500);

  // Load dynamically stored files and preferences
  await loadStoredFiles();
});

// Listen for telemetry updates broadcast by background.js
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TELEMETRY_UPDATE") {
    applyTelemetryState(msg);
    loadStoredFiles();
  }
});

function setupNavigationTabs() {
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetPane = document.getElementById(tab.dataset.tab);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  if (clearFeedBtn) {
    clearFeedBtn.addEventListener('click', () => {
      executionHistory = [];
      renderToolFeed([]);
      chrome.runtime.sendMessage({ type: "CLEAR_FEED" });
    });
  }
}

let activeTargetTabId = null;

async function updateTargetButtonState() {
  if (!setActiveTabBtn) return;
  try {
    const [currentTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!currentTab) return;

    const isTargeted = activeTargetTabId !== null && currentTab.id === activeTargetTabId;
    if (isTargeted) {
      setActiveTabBtn.disabled = true;
      setActiveTabBtn.classList.add('targeted');
      setActiveTabBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Targeted</span>
      `;
      setActiveTabBtn.title = "Current browser tab is targeted by AutoResume MCP";
    } else {
      setActiveTabBtn.disabled = false;
      setActiveTabBtn.classList.remove('targeted');
      setActiveTabBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="22" y1="12" x2="18" y2="12"/>
          <line x1="6" y1="12" x2="2" y2="12"/>
          <line x1="12" y1="6" x2="12" y2="2"/>
          <line x1="12" y1="22" x2="12" y2="18"/>
        </svg>
        <span>Target</span>
      `;
      setActiveTabBtn.title = "Target visible browser tab with AutoResume MCP";
    }
  } catch (e) {}
}

function setupActiveTabButtons() {
  async function handleSetActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) {
        alert("Please click on the browser tab you wish to autofill first.");
        return;
      }

      chrome.runtime.sendMessage({
        type: "SET_ACTIVE_TAB",
        tabId: tab.id
      }, (res) => {
        if (res && res.success) {
          activeTargetTabId = res.tabId;
          if (statTabId) statTabId.textContent = `#${res.tabId}`;
          updateTargetButtonState();
        } else {
          alert(`Failed to set active tab: ${res?.error || 'Unknown error'}`);
        }
      });
    } catch (e) {
      alert(`Error setting active tab: ${e.message}`);
    }
  }

  if (setActiveTabBtn) setActiveTabBtn.addEventListener('click', handleSetActiveTab);
  if (statTabContainer) statTabContainer.addEventListener('click', handleSetActiveTab);

  if (chrome.tabs && chrome.tabs.onActivated) {
    chrome.tabs.onActivated.addListener(() => updateTargetButtonState());
  }
  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener(() => updateTargetButtonState());
  }
  updateTargetButtonState();
}

// ============================================================================
// Telemetry & Badge State
// ============================================================================

function applyTelemetryState(state) {
  const { stats, connected, history } = state;

  if (stats) {
    if (statToolsCount) statToolsCount.textContent = stats.toolsCalledCount || 0;
    if (statFilesCount) statFilesCount.textContent = (stats.filesExportedCount || 0) + (stats.filesImportedCount || 0);

    if (statTabId) {
      statTabId.textContent = stats.activeTabId ? `#${stats.activeTabId}` : '--';
      if (stats.activeTabTitle) statTabId.title = `${stats.activeTabTitle}\n${stats.activeTabUrl}`;
    }

    if (stats.activeTabId !== undefined) {
      activeTargetTabId = stats.activeTabId;
      updateTargetButtonState();
    }
  }

  // Update connection badge
  isConnected = Boolean(connected);
  if (bridgeBadge && bridgeStatusText) {
    if (isConnected) {
      bridgeBadge.className = 'status-pill connected';
      bridgeStatusText.textContent = 'Bridge Live';
    } else {
      bridgeBadge.className = 'status-pill waiting';
      bridgeStatusText.textContent = 'Bridge Offline';
    }
  }

  // Update tool feed
  if (history && Array.isArray(history)) {
    executionHistory = history;
    renderToolFeed(executionHistory);
  }
}

// ============================================================================
// Live Execution Feed Rendering (Compact with Expand-on-Click)
// ============================================================================

function renderToolFeed(items) {
  if (!items || items.length === 0) {
    if (!toolListContainer.querySelector('.empty-state')) {
      toolListContainer.innerHTML = '';
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'empty-state';
      emptyNotice.innerHTML = `
        <svg class="empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        <p class="empty-title">Awaiting Agent Actions</p>
        <span class="empty-desc">Tool calls executed by external desktop AI (Claude, Cursor, agy) will stream live here.</span>
      `;
      toolListContainer.appendChild(emptyNotice);
    }
    return;
  }

  // Remove empty notice if present
  const emptyNotice = toolListContainer.querySelector('.empty-state');
  if (emptyNotice) {
    emptyNotice.remove();
  }

  // Reconcile items incrementally without wiping the container
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemId = String(item.id || `item_${item.timestamp || i}`);
    let card = toolListContainer.querySelector(`[data-tool-id="${itemId}"]`);

    if (!card) {
      if (item.tool === 'browser_batch') {
        card = createBatchContainer(item, itemId);
      } else {
        card = createRegularToolCard(item, itemId);
      }

      // Maintain order (newest first)
      const nextItem = items[i + 1];
      const nextEl = nextItem ? toolListContainer.querySelector(`[data-tool-id="${String(nextItem.id || `item_${nextItem.timestamp || (i + 1)}`)}"]`) : null;
      if (nextEl) {
        toolListContainer.insertBefore(card, nextEl);
      } else {
        toolListContainer.appendChild(card);
      }
    } else {
      if (item.tool === 'browser_batch') {
        updateBatchContainer(card, item);
      } else {
        updateRegularToolCard(card, item);
      }
    }
  }
}

function createBatchContainer(item, itemId) {
  const container = document.createElement('div');
  const statusClass = (item.status || 'running').toLowerCase();
  const statusLabel = (item.status || 'RUNNING').toUpperCase();

  container.className = `batch-group-container ${statusClass} expanded`;
  container.setAttribute('data-tool-id', itemId);

  const timestamp = new Date(item.timestamp);
  const fullDate = timestamp.toLocaleString();

  let durationText = '';
  if (item.duration !== undefined) {
    durationText = item.duration < 1000 ? `${item.duration}ms` : `${(item.duration / 1000).toFixed(1)}s`;
  }

  const actions = item.params?.actions || [];
  const batchStepCount = actions.length;

  container.innerHTML = `
    <div class="batch-group-header">
      <div class="batch-group-left">
        <span class="batch-icon-badge">${LUCIDE_ICONS.browser_batch || LUCIDE_ICONS.default}</span>
        <div class="batch-title-wrapper">
          <span class="batch-main-label">BATCH</span>
          <span class="batch-step-count-pill">${batchStepCount} ${batchStepCount === 1 ? 'CALL' : 'CALLS'}</span>
        </div>
      </div>
      <div class="batch-group-right">
        <span class="duration-badge">${durationText}</span>
        <span class="status-badge ${escapeHtml(statusClass)}">${statusLabel}</span>
        <span class="batch-chevron-toggle">${CHEVRON_ICON}</span>
      </div>
    </div>
    <div class="batch-group-body">
      <div class="batch-timestamp">${escapeHtml(fullDate)}</div>
      <div class="batch-error-placeholder"></div>
      <div class="batch-inner-tools-list"></div>
    </div>
  `;

  // Toggle container collapse on header click
  const header = container.querySelector('.batch-group-header');
  header.addEventListener('click', () => {
    container.classList.toggle('expanded');
  });

  const innerToolsList = container.querySelector('.batch-inner-tools-list');

  actions.forEach((act, idx) => {
    const stepIcon = LUCIDE_ICONS[act.tool] || LUCIDE_ICONS.default;
    const innerCard = document.createElement('div');
    innerCard.className = `batch-inner-card queued`;
    innerCard.setAttribute('data-step-idx', String(idx));

    innerCard.innerHTML = `
      <div class="batch-inner-card-header">
        <div class="batch-inner-card-left">
          <span class="step-num">#${idx + 1}</span>
          <span class="tool-icon-wrapper">${stepIcon}</span>
          <span class="tool-name">${escapeHtml(act.tool)}</span>
        </div>
        <div class="batch-inner-card-right">
          <span class="duration-badge"></span>
          <span class="status-badge queued">QUEUED</span>
          ${CHEVRON_ICON}
        </div>
      </div>
      <div class="batch-inner-card-body">
        <div class="code-box">${escapeHtml(JSON.stringify(act.params || {}, null, 2))}</div>
        <div class="step-error-container"></div>
        <div class="step-result-container"></div>
      </div>
    `;

    innerCard.addEventListener('click', (e) => {
      e.stopPropagation();
      innerCard.classList.toggle('expanded');
    });

    innerToolsList.appendChild(innerCard);
  });

  updateBatchContainer(container, item);
  return container;
}

function updateBatchContainer(container, item) {
  const statusClass = (item.status || 'running').toLowerCase();
  const statusLabel = (item.status || 'RUNNING').toUpperCase();

  container.classList.remove('running', 'success', 'error');
  container.classList.add(statusClass);

  const statusBadge = container.querySelector('.batch-group-header .status-badge');
  if (statusBadge) {
    statusBadge.className = `status-badge ${escapeHtml(statusClass)}`;
    statusBadge.textContent = statusLabel;
  }

  const durationBadge = container.querySelector('.batch-group-header .duration-badge');
  if (durationBadge) {
    if (item.duration !== undefined) {
      durationBadge.textContent = item.duration < 1000 ? `${item.duration}ms` : `${(item.duration / 1000).toFixed(1)}s`;
      durationBadge.style.display = 'inline-block';
    } else {
      durationBadge.textContent = '';
      durationBadge.style.display = 'none';
    }
  }

  const errorPlaceholder = container.querySelector('.batch-error-placeholder');
  if (errorPlaceholder) {
    if (item.error) {
      errorPlaceholder.innerHTML = `<div class="error-banner"><strong>Batch Error:</strong> ${escapeHtml(item.error)}</div>`;
    } else {
      errorPlaceholder.innerHTML = '';
    }
  }

  const actions = item.params?.actions || [];
  const stepResults = item.stepReports || item.result?.steps || [];
  const currentStepIdx = item.currentStep !== undefined ? item.currentStep : stepResults.length;

  actions.forEach((act, idx) => {
    const innerCard = container.querySelector(`.batch-inner-card[data-step-idx="${idx}"]`);
    if (!innerCard) return;

    const stepRes = stepResults[idx];
    let stepStatus = 'QUEUED';
    if (stepRes) {
      stepStatus = (stepRes.status || 'SUCCESS').toUpperCase();
    } else if (item.status === 'running') {
      if (idx === currentStepIdx) {
        stepStatus = 'RUNNING';
      } else if (idx < currentStepIdx) {
        stepStatus = 'SUCCESS';
      } else {
        stepStatus = 'QUEUED';
      }
    } else if (item.status === 'error') {
      stepStatus = idx < stepResults.length ? (stepResults[idx]?.status || 'SUCCESS') : 'FAILED';
    } else if (item.status === 'success') {
      stepStatus = 'SUCCESS';
    }

    const stepClass = stepStatus.toLowerCase();
    innerCard.classList.remove('running', 'success', 'error', 'failed', 'queued');
    innerCard.classList.add(stepClass);

    const innerBadge = innerCard.querySelector('.status-badge');
    if (innerBadge) {
      innerBadge.className = `status-badge ${escapeHtml(stepClass)}`;
      innerBadge.textContent = stepStatus;
    }

    const innerDur = innerCard.querySelector('.duration-badge');
    if (innerDur) {
      if (stepRes && stepRes.duration !== undefined) {
        innerDur.textContent = stepRes.duration < 1000 ? `${stepRes.duration}ms` : `${(stepRes.duration / 1000).toFixed(1)}s`;
        innerDur.style.display = 'inline-block';
      } else {
        innerDur.textContent = '';
        innerDur.style.display = 'none';
      }
    }

    const errBox = innerCard.querySelector('.step-error-container');
    if (errBox) {
      if (stepRes && stepRes.error) {
        errBox.innerHTML = `<div class="error-banner"><strong>Error:</strong> ${escapeHtml(stepRes.error)}</div>`;
      } else {
        errBox.innerHTML = '';
      }
    }

    const resBox = innerCard.querySelector('.step-result-container');
    if (resBox) {
      if (stepRes && stepRes.result && typeof stepRes.result === 'object' && Object.keys(stepRes.result).length > 0) {
        resBox.innerHTML = `<div class="step-result-snippet"><strong>Result:</strong> ${escapeHtml(JSON.stringify(stepRes.result, null, 2))}</div>`;
      } else {
        resBox.innerHTML = '';
      }
    }
  });
}

function createRegularToolCard(item, itemId) {
  const card = document.createElement('div');
  const statusClass = (item.status || 'running').toLowerCase();
  const statusLabel = (item.status || 'RUNNING').toUpperCase();

  card.className = `tool-card ${statusClass}`;
  card.setAttribute('data-tool-id', itemId);

  const timestamp = new Date(item.timestamp);
  const fullDate = timestamp.toLocaleString();
  const toolIcon = LUCIDE_ICONS[item.tool] || LUCIDE_ICONS.default;

  card.innerHTML = `
    <div class="tool-card-header">
      <div class="tool-card-left">
        <span class="tool-icon-wrapper">${toolIcon}</span>
        <span class="tool-name">${escapeHtml(item.tool)}</span>
      </div>
      <div class="tool-card-right">
        <span class="duration-badge"></span>
        <span class="status-badge ${escapeHtml(statusClass)}">${statusLabel}</span>
        ${CHEVRON_ICON}
      </div>
    </div>
    <div class="tool-card-body">
      <div class="tool-timestamp">${escapeHtml(fullDate)}</div>
      <div class="code-box">${escapeHtml(JSON.stringify(item.params || {}, null, 2))}</div>
      <div class="tool-error-placeholder"></div>
      <div class="tool-screenshot-placeholder"></div>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.screenshot-preview-btn')) {
      e.preventDefault();
      openImagePreview(`data:image/png;base64,${item.result.screenshotBase64}`);
      return;
    }
    card.classList.toggle('expanded');
  });

  updateRegularToolCard(card, item);
  return card;
}

function updateRegularToolCard(card, item) {
  const statusClass = (item.status || 'running').toLowerCase();
  const statusLabel = (item.status || 'RUNNING').toUpperCase();

  card.classList.remove('running', 'success', 'error');
  card.classList.add(statusClass);

  const badge = card.querySelector('.tool-card-header .status-badge');
  if (badge) {
    badge.className = `status-badge ${escapeHtml(statusClass)}`;
    badge.textContent = statusLabel;
  }

  const dur = card.querySelector('.tool-card-header .duration-badge');
  if (dur) {
    if (item.duration !== undefined) {
      dur.textContent = item.duration < 1000 ? `${item.duration}ms` : `${(item.duration / 1000).toFixed(1)}s`;
      dur.style.display = 'inline-block';
    } else {
      dur.textContent = '';
      dur.style.display = 'none';
    }
  }

  const errBox = card.querySelector('.tool-error-placeholder');
  if (errBox) {
    if (item.error) {
      errBox.innerHTML = `<div class="error-banner"><strong>Error:</strong> ${escapeHtml(item.error)}</div>`;
    } else {
      errBox.innerHTML = '';
    }
  }

  const scBox = card.querySelector('.tool-screenshot-placeholder');
  if (scBox) {
    if (item.result?.screenshotBase64) {
      scBox.innerHTML = `
        <a class="screenshot-preview-btn" href="#">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          View Captured Screenshot
        </a>
      `;
    } else {
      scBox.innerHTML = '';
    }
  }
}

function showTooltip(e) {
  const fullText = e.target.dataset.fullDate;
  if (!fullText || !tooltip) return;
  tooltip.textContent = fullText;
  tooltip.style.display = 'block';
  const rect = e.target.getBoundingClientRect();
  tooltip.style.left = `${rect.left}px`;
  tooltip.style.top = `${rect.bottom + 4}px`;
}

function hideTooltip() {
  if (tooltip) tooltip.style.display = 'none';
}

function setupTooltip() {
  document.addEventListener('scroll', hideTooltip, true);
}

function openImagePreview(dataUrl) {
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(`<title>AutoResume Visual Capture</title><body style="margin:0;background:#090d16;display:flex;justify-content:center;align-items:center;height:100vh;"><img src="${dataUrl}" style="max-width:95%;max-height:95%;border:1px solid rgba(255,255,255,0.15);box-shadow:0 10px 40px rgba(0,0,0,0.8);" /></body>`);
  }
}

// ============================================================================
// User Files & Resume Management
// ============================================================================

async function loadStoredFiles() {
  const data = await chrome.storage.local.get(["files", "preferences"]);
  storedFiles = data.files || [];
  activePreferences = data.preferences || null;

  const totalCount = storedFiles.length + (activePreferences ? 1 : 0);
  if (statFilesCount) statFilesCount.textContent = totalCount;

  if (activePreferences && chatGreeting) {
    const name = activePreferences.general?.fullName || activePreferences.general?.firstName || "Applicant";
    chatGreeting.innerHTML = `Profile active for <strong>${escapeHtml(name)}</strong>. Forms will autofill with these credentials.`;
  } else if (chatGreeting) {
    chatGreeting.innerHTML = `<span>No preferences loaded yet. Upload your Resume (.pdf, .md) or Preferences (.json) to begin.</span>`;
  }

  renderFilesGrid();
}

function setupFileUpload() {
  if (addFileBtn && realFileInput) {
    addFileBtn.addEventListener('click', () => {
      realFileInput.click();
    });

    realFileInput.addEventListener('change', async (event) => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await processUserUploadedFile(file);
      }

      realFileInput.value = '';
      await loadStoredFiles();
    });
  }
}

async function processUserUploadedFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();

    if (file.name.endsWith('.json')) {
      reader.onload = async (e) => {
        try {
          const parsed = JSON.parse(e.target.result);
          const isPref = parsed.general || parsed.education || parsed.skills;

          const filePayload = {
            name: file.name,
            type: 'application/json',
            size: formatFileSize(file.size),
            data: btoa(unescape(encodeURIComponent(e.target.result))),
            description: isPref ? 'Applicant Preferences JSON' : 'JSON Document',
            uploadedAt: new Date().toISOString()
          };

          chrome.runtime.sendMessage({ type: "USER_UPLOADED_FILE", payload: filePayload }, () => {
            if (isPref) {
              chrome.runtime.sendMessage({ type: "USER_SET_PREFERENCES", payload: parsed }, () => {
                activePreferences = parsed;
                resolve();
              });
            } else {
              resolve();
            }
          });
        } catch (err) {
          alert(`Failed to parse JSON file '${file.name}': ${err.message}`);
          resolve();
        }
      };
      reader.readAsText(file);
    } else {
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const base64Content = dataUrl.split(',')[1] || '';

        const filePayload = {
          name: file.name,
          type: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'text/plain'),
          size: formatFileSize(file.size),
          data: base64Content,
          description: file.name.toLowerCase().includes('resume') ? 'Applicant Resume' : 'Document',
          uploadedAt: new Date().toISOString()
        };

        chrome.runtime.sendMessage({ type: "USER_UPLOADED_FILE", payload: filePayload }, () => {
          resolve();
        });
      };
      reader.readAsDataURL(file);
    }
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function renderFilesGrid() {
  if (!filesGridContainer) return;
  filesGridContainer.innerHTML = '';

  const hasPreferences = Boolean(activePreferences);
  const hasFiles = storedFiles && storedFiles.length > 0;

  if (!hasPreferences && !hasFiles) {
    const emptyNotice = document.createElement('div');
    emptyNotice.style.padding = '12px 8px';
    emptyNotice.style.fontSize = '11px';
    emptyNotice.style.color = 'var(--muted-foreground)';
    emptyNotice.style.textAlign = 'center';
    emptyNotice.style.border = '1px dashed var(--border)';
    emptyNotice.textContent = 'No documents stored. Upload Resume (.pdf, .md) or Preferences (.json).';
    filesGridContainer.appendChild(emptyNotice);
    return;
  }

  // 1. Render Active Preferences Profile Card if preferences exist in storage
  if (hasPreferences) {
    const prefCard = document.createElement('div');
    prefCard.className = 'file-card preference-card';

    const general = activePreferences.general || {};
    const name = general.fullName || `${general.firstName || ''} ${general.lastName || ''}`.trim() || 'Applicant Preferences';
    const email = general.email || general.emailAddress || '';

    const sections = [];
    if (activePreferences.education?.length) sections.push(`${activePreferences.education.length} schools`);
    if (activePreferences.experience?.length) sections.push(`${activePreferences.experience.length} jobs`);
    if (activePreferences.skills) sections.push('skills');
    const sectionsText = sections.length > 0 ? sections.join(' • ') : 'Candidate credentials';

    prefCard.innerHTML = `
      <div class="file-card-left">
        <svg class="file-icon pref-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <polyline points="16 11 18 13 22 9"/>
        </svg>
        <div class="file-info">
          <div class="file-name-row">
            <span class="file-name">${escapeHtml(name)}</span>
            <span class="pref-badge">JSON Profile</span>
          </div>
          <span class="file-meta">${escapeHtml(email ? `${email} • ` : '')}${escapeHtml(sectionsText)}</span>
        </div>
      </div>
      <div class="file-actions">
        <button class="file-delete-btn" id="deletePreferencesBtn" title="Remove stored preferences profile">Clear</button>
      </div>
    `;

    filesGridContainer.appendChild(prefCard);

    const deletePrefBtn = prefCard.querySelector('#deletePreferencesBtn');
    if (deletePrefBtn) {
      deletePrefBtn.addEventListener('click', async () => {
        if (confirm("Remove applicant preferences profile from storage?")) {
          activePreferences = null;
          await chrome.storage.local.set({ preferences: null });
          loadStoredFiles();
        }
      });
    }
  }

  // 2. Render each stored document file
  storedFiles.forEach((file, index) => {
    const card = document.createElement('div');
    card.className = 'file-card';

    let displaySize = file.size;
    if (!displaySize && file.data) {
      displaySize = formatFileSize(Math.round(file.data.length * 0.75));
    } else if (!displaySize) {
      displaySize = 'Saved';
    }

    const isPdf = file.name.toLowerCase().endsWith('.pdf');
    const isDoc = file.name.toLowerCase().endsWith('.md') || file.name.toLowerCase().endsWith('.txt');
    const fileIcon = isPdf
      ? '<svg class="file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
      : (isDoc
          ? '<svg class="file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>'
          : '<svg class="file-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="10 9 9 9 8 9"/></svg>'
        );

    card.innerHTML = `
      <div class="file-card-left">
        ${fileIcon}
        <div class="file-info">
          <span class="file-name">${escapeHtml(file.name)}</span>
          <span class="file-meta">${escapeHtml(displaySize)}</span>
        </div>
      </div>
      <div class="file-actions">
        <button class="file-delete-btn" data-index="${index}">Delete</button>
      </div>
    `;

    filesGridContainer.appendChild(card);
  });

  filesGridContainer.querySelectorAll('.file-delete-btn[data-index]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      storedFiles.splice(idx, 1);
      await chrome.storage.local.set({ files: storedFiles });
      loadStoredFiles();
    });
  });
}

// ============================================================================
// Quick Automation Triggers
// ============================================================================

function setupQuickActions() {
  if (startAutofillBtn) {
    startAutofillBtn.addEventListener('click', async () => {
      if (!activePreferences) {
        alert("⚠️ Please upload your resume or preferences in the 'Files & Config' tab before running autofill.");
        return;
      }

      startAutofillBtn.disabled = true;
      startAutofillBtn.textContent = "Analyzing...";

      try {
        const snap = await executeToolInTab("browser_snapshot", { filter: "interactive" });
        alert(`✓ Page analyzed: ${snap.interactiveCount || 0} interactive elements discovered. Agent is ready to batch autofill.`);
      } catch (err) {
        alert(`Autofill inspection error: ${err.message}`);
      } finally {
        startAutofillBtn.disabled = false;
        startAutofillBtn.innerHTML = `
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          <span>Autofill</span>
        `;
      }
    });
  }

  if (verifyPageBtn) {
    verifyPageBtn.addEventListener('click', async () => {
      verifyPageBtn.disabled = true;
      try {
        const snapRes = await executeToolInTab("browser_snapshot", { filter: "interactive" });
        alert(`✓ Page Verified: ${snapRes.interactiveCount || 0} fields mapped. Accessibility tree ready.`);
      } catch (err) {
        alert(`Inspection error: ${err.message}`);
      } finally {
        verifyPageBtn.disabled = false;
      }
    });
  }
}

function executeToolInTab(toolName, params) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: "EXECUTE_TOOL_FROM_PANEL",
      tool: toolName,
      params
    }, (res) => {
      if (res && res.success) {
        resolve(res.result);
      } else {
        reject(new Error(res?.error || "Tool failed."));
      }
    });
  });
}

// ============================================================================
// AI Provider Configuration & Extension Settings
// ============================================================================

function setupProviderSettings() {
  const providerChips = document.querySelectorAll('.provider-chip');
  const apiKeyLabel = document.getElementById('apiKeyLabel');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const modelSelect = document.getElementById('modelSelect');
  const saveProviderBtn = document.getElementById('saveProviderBtn');
  const wsPortInput = document.getElementById('wsPortInput');
  const reconnectWsBtn = document.getElementById('reconnectWsBtn');
  const humanTypingToggle = document.getElementById('humanTypingToggle');
  const visualOverlayToggle = document.getElementById('visualOverlayToggle');
  const failFastToggle = document.getElementById('failFastToggle');

  const providerModels = {
    gemini: [
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash (Fastest)" },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro (Reasoning)" }
    ],
    claude: [
      { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (Recommended)" },
      { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (Fast)" }
    ],
    openai: [
      { value: "gpt-4o", label: "GPT-4o (Omni)" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini (Fast)" }
    ],
    general: [
      { value: "llama3.2", label: "Ollama / LLaMA 3.2" },
      { value: "mistral", label: "Mistral 7B / Local" }
    ]
  };

  const providerLabels = {
    gemini: "Gemini API Key",
    claude: "Anthropic API Key",
    openai: "OpenAI API Key",
    general: "Local Endpoint / API Key"
  };

  let activeProvider = "gemini";

  // Load saved settings
  chrome.storage.local.get(["aiProvider", "aiApiKey", "aiModel", "wsPort", "behaviorSettings"], (data) => {
    if (data.aiProvider) {
      activeProvider = data.aiProvider;
      providerChips.forEach(c => c.classList.toggle('active', c.dataset.provider === activeProvider));
    }
    if (apiKeyLabel) apiKeyLabel.textContent = providerLabels[activeProvider] || "API Key";
    if (apiKeyInput && data.aiApiKey) apiKeyInput.value = data.aiApiKey;
    if (wsPortInput && data.wsPort) wsPortInput.value = data.wsPort;

    if (data.behaviorSettings) {
      if (humanTypingToggle && data.behaviorSettings.humanTyping !== undefined) humanTypingToggle.checked = data.behaviorSettings.humanTyping;
      if (visualOverlayToggle && data.behaviorSettings.visualOverlay !== undefined) visualOverlayToggle.checked = data.behaviorSettings.visualOverlay;
      if (failFastToggle && data.behaviorSettings.failFast !== undefined) failFastToggle.checked = data.behaviorSettings.failFast;
    }

    updateModelDropdown(activeProvider, data.aiModel);
  });

  function updateModelDropdown(prov, selectedModel) {
    if (!modelSelect) return;
    modelSelect.innerHTML = '';
    const models = providerModels[prov] || providerModels.gemini;
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.value;
      opt.textContent = m.label;
      if (m.value === selectedModel) opt.selected = true;
      modelSelect.appendChild(opt);
    });
  }

  providerChips.forEach(chip => {
    chip.addEventListener('click', () => {
      providerChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeProvider = chip.dataset.provider;
      if (apiKeyLabel) apiKeyLabel.textContent = providerLabels[activeProvider] || "API Key";
      updateModelDropdown(activeProvider);
    });
  });

  if (saveProviderBtn) {
    saveProviderBtn.addEventListener('click', async () => {
      const apiKey = apiKeyInput ? apiKeyInput.value.trim() : "";
      const model = modelSelect ? modelSelect.value : "";
      await chrome.storage.local.set({
        aiProvider: activeProvider,
        aiApiKey: apiKey,
        aiModel: model
      });
      const originalText = saveProviderBtn.textContent;
      saveProviderBtn.textContent = "✓ Config Saved";
      saveProviderBtn.style.backgroundColor = "oklch(0.845 0.143 164.978)";
      saveProviderBtn.style.color = "oklch(0.148 0.004 228.8)";
      setTimeout(() => {
        saveProviderBtn.textContent = originalText;
        saveProviderBtn.style.backgroundColor = "";
        saveProviderBtn.style.color = "";
      }, 1800);
    });
  }

  if (reconnectWsBtn && wsPortInput) {
    reconnectWsBtn.addEventListener('click', async () => {
      const port = parseInt(wsPortInput.value, 10) || 9001;
      await chrome.storage.local.set({ wsPort: port });
      chrome.runtime.sendMessage({ type: "RECONNECT_BRIDGE", port }, (res) => {
        alert(res?.success ? `Reconnecting to ws://127.0.0.1:${port}...` : "Failed to reconnect bridge.");
      });
    });
  }

  function saveBehaviorSettings() {
    const settings = {
      humanTyping: humanTypingToggle ? humanTypingToggle.checked : true,
      visualOverlay: visualOverlayToggle ? visualOverlayToggle.checked : true,
      failFast: failFastToggle ? failFastToggle.checked : true
    };
    chrome.storage.local.set({ behaviorSettings: settings });
    chrome.runtime.sendMessage({ type: "UPDATE_SETTINGS", settings });
  }

  if (humanTypingToggle) humanTypingToggle.addEventListener('change', saveBehaviorSettings);
  if (visualOverlayToggle) visualOverlayToggle.addEventListener('change', saveBehaviorSettings);
  if (failFastToggle) failFastToggle.addEventListener('change', saveBehaviorSettings);
}
