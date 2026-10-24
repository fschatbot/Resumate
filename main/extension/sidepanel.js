/**
 * sidepanel.js - AutoResume Side Panel UI Controller
 *
 * Provides real-time tool execution feed, connection beacon monitoring,
 * dynamic user resume & preferences file uploads, and AI chat interface.
 */

// Global State
let isConnected = false;
let executionHistory = [];
let storedFiles = [];
let activePreferences = null;

// DOM Elements
const beaconIndicator = document.getElementById('beaconIndicator');
const beaconText = document.getElementById('beaconText');
const activeTabPill = document.getElementById('activeTabPill');
const statToolsCount = document.getElementById('statToolsCount');
const statFilesCount = document.getElementById('statFilesCount');
const statGroupStatus = document.getElementById('statGroupStatus');
const toolListContainer = document.getElementById('toolListContainer');
const clearFeedBtn = document.getElementById('clearFeedBtn');
const tooltip = document.getElementById('tooltip');
const filesGridContainer = document.getElementById('filesGridContainer');
const uploadFileBtn = document.getElementById('uploadFileBtn');
const realFileInput = document.getElementById('realFileInput');
const navTabs = document.querySelectorAll('.nav-tab');
const tabPanes = document.querySelectorAll('.tab-pane');

// Chat DOM
const chatGreeting = document.getElementById('chatGreeting');
const chatMessages = document.getElementById('chatMessages');
const chatInputText = document.getElementById('chatInputText');
const sendChatBtn = document.getElementById('sendChatBtn');
const autofillCurrentPageBtn = document.getElementById('autofillCurrentPageBtn');
const verifyPageBtn = document.getElementById('verifyPageBtn');

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
// Initialization & Tab Navigation
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigationTabs();
  setupTooltip();
  setupFileUpload();
  setupChat();
  setupQuickActions();
  setupActiveTabButtons();

  // Query background for initial telemetry state and acquire active tab
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (state) applyTelemetryState(state);
  });

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

function setupActiveTabButtons() {
  const setActiveBtn = document.getElementById('setActiveTabBtn');
  const bannerBtn = document.getElementById('setActiveTabBannerBtn');
  const tabIdStat = document.getElementById('statTabId');

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
          if (tabIdStat) tabIdStat.textContent = `#${res.tabId}`;
          const beaconSubtext = document.getElementById('beaconSubtext');
          if (beaconSubtext) {
            beaconSubtext.textContent = `Target tab locked: "${res.title || tab.title}" (#${res.tabId})`;
          }
          const activeTabPill = document.getElementById('activeTabPill');
          if (activeTabPill) {
            activeTabPill.textContent = (res.title || tab.title).slice(0, 22);
            activeTabPill.title = `${res.title || tab.title}\n${res.url || tab.url}`;
          }
          alert(`✓ Tab #${res.tabId} ("${res.title || tab.title}") is now locked as the active AutoResume MCP tab.`);
        } else {
          alert(`Failed to set active tab: ${res?.error || 'Unknown error'}`);
        }
      });
    } catch (e) {
      alert(`Error setting active tab: ${e.message}`);
    }
  }

  if (setActiveBtn) setActiveBtn.addEventListener('click', handleSetActiveTab);
  if (bannerBtn) bannerBtn.addEventListener('click', handleSetActiveTab);
  if (tabIdStat) {
    tabIdStat.style.cursor = 'pointer';
    tabIdStat.title = 'Click to lock current tab as active MCP tab';
    tabIdStat.addEventListener('click', handleSetActiveTab);
  }
}

// ============================================================================
// Telemetry & Beacon State
// ============================================================================

function applyTelemetryState(state) {
  const { stats, connected, history } = state;

  if (stats) {
    const toolsCount = document.getElementById('statToolsCount');
    if (toolsCount) toolsCount.textContent = stats.toolsCalledCount || 0;

    const filesCount = document.getElementById('statFilesCount');
    if (filesCount) filesCount.textContent = (stats.filesExportedCount || 0) + (stats.filesImportedCount || 0);

    const tabIdStat = document.getElementById('statTabId');
    if (tabIdStat) {
      tabIdStat.textContent = stats.activeTabId ? `#${stats.activeTabId}` : '--';
      if (stats.activeTabTitle) tabIdStat.title = `${stats.activeTabTitle}\n${stats.activeTabUrl}`;
    }

    const activeTabPill = document.getElementById('activeTabPill');
    if (activeTabPill) {
      if (stats.activeTabTitle) {
        activeTabPill.textContent = stats.activeTabTitle.slice(0, 22) + (stats.activeTabTitle.length > 22 ? '...' : '');
        activeTabPill.title = `${stats.activeTabTitle}\n${stats.activeTabUrl}`;
      } else {
        activeTabPill.textContent = 'No tab isolated';
      }
    }

    const beaconSubtext = document.getElementById('beaconSubtext');
    if (beaconSubtext && stats.activeTabId) {
      beaconSubtext.textContent = `Target tab: "${stats.activeTabTitle}" (#${stats.activeTabId})`;
    }
  }

  // Update connection badge
  const bridgeBadge = document.getElementById('bridgeBadge') || document.getElementById('beaconIndicator');
  const bridgeStatusText = document.getElementById('bridgeStatusText') || document.getElementById('beaconText');

  isConnected = Boolean(connected);
  if (bridgeBadge && bridgeStatusText) {
    if (isConnected) {
      bridgeBadge.className = 'status-badge active';
      bridgeStatusText.textContent = 'Bridge Connected';
    } else {
      bridgeBadge.className = 'status-badge waiting';
      bridgeStatusText.textContent = 'Bridge Waiting';
    }
  }

  const groupStatus = document.getElementById('statGroupStatus');
  if (groupStatus) {
    groupStatus.textContent = state.groupId !== null ? 'Isolated' : 'Default';
  }

  // Update tool feed
  if (history && Array.isArray(history)) {
    executionHistory = history;
    renderToolFeed(executionHistory);
  }
}

// ============================================================================
// Live Execution Feed Rendering
// ============================================================================

function renderToolFeed(items) {
  toolListContainer.innerHTML = '';

  if (items.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'empty-feed';
    emptyNotice.innerHTML = `
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="1.5">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
      </svg>
      <p>No tool calls executed yet</p>
      <span>When an AI agent (Gemini, Claude, Cursor) calls browser automation tools, live actions will appear here in real-time.</span>
    `;
    toolListContainer.appendChild(emptyNotice);
    return;
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = `tool-card ${item.status || 'running'}`;

    const timestamp = new Date(item.timestamp);
    const timeStr = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const fullDate = timestamp.toLocaleString();

    let durationText = '';
    if (item.duration !== undefined) {
      durationText = item.duration < 1000 ? `${item.duration}ms` : `${(item.duration / 1000).toFixed(2)}s`;
    }

    const isBatch = item.tool === 'browser_batch' && item.params?.actions;
    const batchStepCount = isBatch ? item.params.actions.length : 0;

    card.innerHTML = `
      <div class="tool-header">
        <span class="tool-name">${escapeHtml(item.tool)}${isBatch ? ` <small style="color:#A78BFA;">[${batchStepCount} steps]</small>` : ''}</span>
        <div style="display:flex;align-items:center;">
          ${durationText ? `<span class="duration-badge">${durationText}</span>` : ''}
          <span class="tool-time" data-full-date="${escapeHtml(fullDate)}">${timeStr}</span>
        </div>
      </div>
      <div class="tool-body">
        <pre class="tool-params">${escapeHtml(JSON.stringify(item.params || {}, null, 2))}</pre>
        ${item.error ? `<div class="error-banner"><strong>Error:</strong> ${escapeHtml(item.error)}</div>` : ''}
      </div>
    `;

    // Tooltip for exact timestamp
    const timeElem = card.querySelector('.tool-time');
    timeElem.addEventListener('mouseenter', showTooltip);
    timeElem.addEventListener('mouseleave', hideTooltip);

    // Expandable batch steps container
    if (isBatch) {
      const stepsList = document.createElement('div');
      stepsList.className = 'batch-steps-list';

      const actions = item.params.actions;
      const stepResults = item.result?.steps || [];

      actions.forEach((act, idx) => {
        const stepRow = document.createElement('div');
        stepRow.className = 'batch-step-item';

        const stepRes = stepResults[idx];
        const stepStatus = stepRes ? stepRes.status : (item.status === 'running' ? 'RUNNING' : 'QUEUED');

        stepRow.innerHTML = `
          <span><strong>${idx + 1}.</strong> ${escapeHtml(act.tool)} (${escapeHtml(Object.keys(act.params || {}).join(', '))})</span>
          <span class="tool-status-pill ${escapeHtml(stepStatus.toLowerCase())}">${escapeHtml(stepStatus)}</span>
        `;
        stepsList.appendChild(stepRow);
      });

      card.appendChild(stepsList);
    }

    if (item.result?.screenshotBase64) {
      const fileLink = document.createElement('a');
      fileLink.className = 'file-link';
      fileLink.textContent = `📷 View Captured Screenshot (${item.result.timestamp || 'PNG'})`;
      fileLink.addEventListener('click', (e) => {
        e.preventDefault();
        openImagePreview(`data:image/png;base64,${item.result.screenshotBase64}`);
      });
      card.appendChild(fileLink);
    }

    toolListContainer.appendChild(card);
  });
}

function showTooltip(e) {
  const fullText = e.target.dataset.fullDate;
  if (!fullText) return;
  tooltip.textContent = `Executed at: ${fullText}`;
  tooltip.style.display = 'block';
  const rect = e.target.getBoundingClientRect();
  tooltip.style.left = `${rect.left - 40}px`;
  tooltip.style.top = `${rect.bottom + 6}px`;
}

function hideTooltip() {
  tooltip.style.display = 'none';
}

function setupTooltip() {
  document.addEventListener('scroll', hideTooltip, true);
}

function openImagePreview(dataUrl) {
  const win = window.open('', '_blank');
  if (win) {
    win.document.write(`<title>AutoResume Visual Capture</title><body style="margin:0;background:#0f172a;display:flex;justify-content:center;align-items:center;height:100vh;"><img src="${dataUrl}" style="max-width:95%;max-height:95%;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,0.5);" /></body>`);
  }
}

// ============================================================================
// Dynamic User File Uploads & Management (No Preloaded Files)
// ============================================================================

async function loadStoredFiles() {
  const data = await chrome.storage.local.get(["files", "preferences"]);
  storedFiles = data.files || [];
  activePreferences = data.preferences || null;

  statFilesCount.textContent = storedFiles.length;

  if (activePreferences && chatGreeting) {
    const name = activePreferences.general?.fullName || activePreferences.general?.firstName || "Applicant";
    chatGreeting.innerHTML = `Preferences loaded for <strong>${escapeHtml(name)}</strong>. Ready to autofill application forms!`;
  }

  renderFilesGrid();
}

function setupFileUpload() {
  if (uploadFileBtn && realFileInput) {
    uploadFileBtn.addEventListener('click', () => {
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
          description: file.name.toLowerCase().includes('resume') ? 'Applicant Resume' : 'Uploaded Document',
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
  filesGridContainer.innerHTML = '';

  if (storedFiles.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'empty-feed';
    emptyNotice.innerHTML = `
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#64748B" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="12" y1="18" x2="12" y2="12"></line>
        <line x1="9" y1="15" x2="15" y2="15"></line>
      </svg>
      <p>No resume or preferences uploaded yet</p>
      <span>Click <strong>+ Upload File</strong> above to upload your Resume (.pdf, .md) or Preferences (.json), or let the AI agent initialize it.</span>
    `;
    filesGridContainer.appendChild(emptyNotice);
    return;
  }

  storedFiles.forEach((file, index) => {
    const card = document.createElement('div');
    card.className = 'file-card';

    const icon = file.type?.includes('pdf') ? '📄' : (file.name.endsWith('.json') ? '⚙️' : '📝');

    card.innerHTML = `
      <div style="display:flex;align-items:center;">
        <span class="file-icon">${icon}</span>
        <div class="file-details">
          <div class="file-name">${escapeHtml(file.name)}</div>
          <div class="file-meta">${escapeHtml(file.size)} • ${escapeHtml(file.description || 'Uploaded File')}</div>
        </div>
      </div>
      <div class="file-actions">
        <button class="preview-btn" data-index="${index}">Info</button>
        <button class="delete-btn" data-index="${index}" style="color:#EF4444;">Delete</button>
      </div>
    `;

    filesGridContainer.appendChild(card);
  });

  filesGridContainer.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      const f = storedFiles[idx];
      alert(`File: ${f.name}\nType: ${f.type}\nSize: ${f.size}\nDescription: ${f.description || 'N/A'}\nUploaded: ${f.uploadedAt || 'N/A'}`);
    });
  });

  filesGridContainer.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      storedFiles.splice(idx, 1);
      await chrome.storage.local.set({ files: storedFiles });
      renderFilesGrid();
    });
  });
}

// ============================================================================
// AI Chat Interface & Form Automation
// ============================================================================

function setupChat() {
  if (sendChatBtn && chatInputText) {
    sendChatBtn.addEventListener('click', sendUserMessage);
    chatInputText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendUserMessage();
      }
    });
  }
}

function setupQuickActions() {
  if (autofillCurrentPageBtn) {
    autofillCurrentPageBtn.addEventListener('click', async () => {
      if (!activePreferences) {
        appendChatMessage('bot', "⚠️ Please upload or initialize your preferences/resume before autofilling.");
        return;
      }
      appendChatMessage('user', "🚀 Autofill the application form on the active page.");
      appendChatMessage('bot', "Analyzing page form structure and accessibility tree...");

      try {
        const snap = await executeToolInTab("browser_snapshot", { filter: "interactive" });
        appendChatMessage('bot', `Found interactive elements on page. Snapshot acquired (${snap.interactiveCount || 0} interactive nodes).`);
      } catch (err) {
        appendChatMessage('bot', `Automation error: ${escapeHtml(err.message)}`);
      }
    });
  }

  if (verifyPageBtn) {
    verifyPageBtn.addEventListener('click', async () => {
      appendChatMessage('user', "🔍 Inspect the active page form elements.");
      try {
        const snapRes = await executeToolInTab("browser_snapshot", { filter: "interactive" });
        const preview = snapRes.yaml ? snapRes.yaml.slice(0, 500) + '...' : 'Snapshot acquired.';
        appendChatMessage('bot', `<strong>Accessibility Tree Sample:</strong><pre style="background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;font-size:10px;margin-top:4px;">${escapeHtml(preview)}</pre>`);
      } catch (err) {
        appendChatMessage('bot', `Inspection error: ${escapeHtml(err.message)}`);
      }
    });
  }
}

function sendUserMessage() {
  const text = chatInputText.value.trim();
  if (!text) return;
  chatInputText.value = '';
  appendChatMessage('user', escapeHtml(text));

  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.general || parsed.education) {
        chrome.runtime.sendMessage({ type: "USER_SET_PREFERENCES", payload: parsed });
        activePreferences = parsed;
        appendChatMessage('bot', `Received and validated preferences JSON for: <strong>${escapeHtml(parsed.general?.fullName || 'Applicant')}</strong>.`);
        return;
      }
    } catch (e) {}
  }

  setTimeout(() => {
    appendChatMessage('bot', `Received instruction: "${escapeHtml(text)}". Ready to execute actions via MCP bridge.`);
  }, 400);
}

function appendChatMessage(sender, htmlContent) {
  const msg = document.createElement('div');
  msg.className = `chat-msg ${sender}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.textContent = sender === 'bot' ? '🤖' : '👤';

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.innerHTML = htmlContent;

  msg.appendChild(avatar);
  msg.appendChild(body);
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;
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
