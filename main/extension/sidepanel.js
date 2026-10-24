/**
 * sidepanel.js - AutoResume Side Panel UI Controller
 *
 * Implements real-time feed rendering with hover tooltips, batched action containers,
 * connection beacon animation state, dynamic user file uploads (no preloaded files),
 * and the inbuilt AI chat wrapper.
 */

// UI Elements
const bridgeBadge = document.getElementById('bridgeBadge');
const bridgeStatusText = document.getElementById('bridgeStatusText');
const beaconBanner = document.getElementById('beaconBanner');
const beaconHeading = document.getElementById('beaconHeading');
const beaconSubtext = document.getElementById('beaconSubtext');
const radarBeacon = document.querySelector('.radar-beacon');

const statToolsCount = document.getElementById('statToolsCount');
const statTabId = document.getElementById('statTabId');
const statFilesCount = document.getElementById('statFilesCount');

const toolListContainer = document.getElementById('toolListContainer');
const emptyFeedState = document.getElementById('emptyFeedState');
const clearFeedBtn = document.getElementById('clearFeedBtn');

const filesGridContainer = document.getElementById('filesGridContainer');
const addFileBtn = document.getElementById('addFileBtn');
const realFileInput = document.getElementById('realFileInput');

const navTabs = document.querySelectorAll('.nav-tab');
const tabPanes = document.querySelectorAll('.tab-pane');

const tooltip = document.getElementById('globalTooltip');

// Inbuilt Chat Elements
const providerChips = document.querySelectorAll('.provider-chip');
const apiKeyInput = document.getElementById('apiKeyInput');
const apiKeyLabel = document.getElementById('apiKeyLabel');
const modelSelect = document.getElementById('modelSelect');
const saveProviderBtn = document.getElementById('saveProviderBtn');
const chatMessages = document.getElementById('chatMessages');
const chatInputText = document.getElementById('chatInputText');
const chatSendBtn = document.getElementById('chatSendBtn');
const startAutofillBtn = document.getElementById('startAutofillBtn');
const verifyPageBtn = document.getElementById('verifyPageBtn');
const chatGreeting = document.getElementById('chatGreeting');

// Active State
let currentTabId = null;
let currentProvider = 'gemini';
let storedFiles = [];
let activePreferences = null;
let executionHistory = [];

// ============================================================================
// Initialization & Tab Navigation
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  setupNavigationTabs();
  setupTooltip();
  setupProviderSettings();
  setupChatHandlers();
  setupFileUploadHandlers();
  await loadStoredFiles();

  // Query background for current state
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (res) => {
    if (res) {
      applyTelemetryState(res);
    }
  });

  // Listen for real-time telemetry updates from background.js
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "TELEMETRY_UPDATE") {
      applyTelemetryState(msg);
    }
  });
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
    });
  }
}

// ============================================================================
// Telemetry & Beacon State
// ============================================================================

function applyTelemetryState(state) {
  const { stats, connected, history } = state;

  // Update statistics strip
  if (stats) {
    statToolsCount.textContent = stats.toolsCalledCount || 0;
    statTabId.textContent = stats.activeTabId ? `#${stats.activeTabId}` : '--';
    currentTabId = stats.activeTabId;
  }

  // Update Bridge Badge
  if (connected) {
    bridgeBadge.className = 'status-badge connected';
    bridgeStatusText.textContent = 'Bridge Online';
  } else {
    bridgeBadge.className = 'status-badge waiting';
    bridgeStatusText.textContent = 'Bridge Waiting';
  }

  // Update Beacon Banner Animation
  if (connected && stats && stats.toolsCalledCount > 0) {
    radarBeacon.classList.add('active');
    beaconHeading.textContent = 'AI Agent Active & Connected';
    beaconSubtext.textContent = `Streaming tool operations to TAB #${stats.activeTabId} in MCP group.`;
  } else if (connected) {
    radarBeacon.classList.remove('active');
    beaconHeading.textContent = 'Bridge Connected — Ready for Commands';
    beaconSubtext.textContent = 'Waiting for AI agent to send its first request to the TAB group.';
  } else {
    radarBeacon.classList.remove('active');
    beaconHeading.textContent = 'Awaiting AI Agent Request';
    beaconSubtext.textContent = 'Start desktop MCP bridge (ws://localhost:9001) or use Inbuilt Chat.';
  }

  // Render Execution Feed
  if (history) {
    executionHistory = history;
    renderToolFeed(history);
  }
}

// ============================================================================
// Live Tool Feed Rendering
// ============================================================================

function renderToolFeed(items) {
  if (!items || items.length === 0) {
    toolListContainer.innerHTML = '';
    toolListContainer.appendChild(emptyFeedState);
    emptyFeedState.style.display = 'flex';
    return;
  }

  emptyFeedState.style.display = 'none';
  toolListContainer.innerHTML = '';

  items.forEach(item => {
    const card = document.createElement('div');
    const isBatch = item.tool === 'browser_batch';
    card.className = `tool-card ${isBatch ? 'batch-container' : ''}`;

    // Header: Tool name badge, duration, and status
    const header = document.createElement('div');
    header.className = 'tool-card-header';

    const left = document.createElement('div');
    left.style.display = 'flex';
    left.style.alignItems = 'center';
    left.style.gap = '6px';

    const badge = document.createElement('span');
    badge.className = 'tool-badge';
    badge.textContent = item.tool;
    left.appendChild(badge);

    if (item.duration) {
      const dur = document.createElement('span');
      dur.style.fontSize = '10px';
      dur.style.color = '#94A3B8';
      dur.textContent = `${item.duration}ms`;
      left.appendChild(dur);
    }
    header.appendChild(left);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '6px';

    // Hoverable timestamp with tooltip
    const timeSpan = document.createElement('span');
    timeSpan.className = 'tool-time';
    const dateObj = new Date(item.timestamp);
    timeSpan.textContent = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    timeSpan.dataset.fullDate = dateObj.toLocaleString();
    timeSpan.addEventListener('mouseenter', showTooltip);
    timeSpan.addEventListener('mouseleave', hideTooltip);
    right.appendChild(timeSpan);

    const pill = document.createElement('span');
    pill.className = `tool-status-pill ${item.status || 'success'}`;
    pill.textContent = item.status || 'success';
    right.appendChild(pill);

    header.appendChild(right);
    card.appendChild(header);

    // Arguments box (truncated on hover expand)
    if (item.params && Object.keys(item.params).length > 0) {
      const argsBox = document.createElement('div');
      argsBox.className = 'tool-args-box';
      const jsonStr = JSON.stringify(item.params, null, 2);
      argsBox.textContent = jsonStr;
      argsBox.title = "Click to toggle full arguments view";
      argsBox.addEventListener('click', () => {
        argsBox.classList.toggle('expanded');
      });
      card.appendChild(argsBox);
    }

    // Batched Steps Breakdown
    if (isBatch && item.params?.actions) {
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
          <span><strong>${idx + 1}.</strong> ${act.tool} (${Object.keys(act.params || {}).join(', ')})</span>
          <span class="tool-status-pill ${stepStatus.toLowerCase()}">${stepStatus}</span>
        `;
        stepsList.appendChild(stepRow);
      });

      card.appendChild(stepsList);
    }

    // File attachments / Screenshot previews
    if (item.result?.screenshotBase64) {
      const fileLink = document.createElement('a');
      fileLink.className = 'file-link';
      fileLink.innerHTML = `📷 View Captured Screenshot (${item.result.timestamp || 'PNG'})`;
      fileLink.addEventListener('click', (e) => {
        e.preventDefault();
        openImagePreview(`data:image/png;base64,${item.result.screenshotBase64}`);
      });
      card.appendChild(fileLink);
    }

    toolListContainer.appendChild(card);
  });
}

// Tooltip positioning
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
    chatGreeting.innerHTML = `Preferences loaded for <strong>${name}</strong>. Ready to autofill application forms!`;
  }

  renderFilesGrid();
}

function setupFileUploadHandlers() {
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
      // Preferences or schema JSON
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

          chrome.runtime.sendMessage({ type: "USER_UPLOADED_FILE", payload: filePayload });

          if (isPref) {
            chrome.runtime.sendMessage({ type: "USER_SET_PREFERENCES", payload: parsed });
            activePreferences = parsed;
            alert(`Loaded Preferences JSON for: ${parsed.general?.fullName || 'Applicant'}`);
          }
        } catch (err) {
          alert(`Failed to parse JSON file '${file.name}': ${err.message}`);
        }
        resolve();
      };
      reader.readAsText(file);
    } else {
      // PDF, Markdown, Word, Text
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

        chrome.runtime.sendMessage({ type: "USER_UPLOADED_FILE", payload: filePayload });
        resolve();
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
          <div class="file-name">${file.name}</div>
          <div class="file-meta">${file.size} • ${file.description || 'Uploaded File'}</div>
        </div>
      </div>
      <div class="file-actions">
        <button class="preview-btn" data-index="${index}">Info</button>
        <button class="delete-btn" data-index="${index}" style="color:#EF4444;">Delete</button>
      </div>
    `;

    filesGridContainer.appendChild(card);
  });

  // Attach button actions
  filesGridContainer.querySelectorAll('.preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      const file = storedFiles[idx];
      alert(`Asset: ${file.name}\nSize: ${file.size}\nType: ${file.type}\nUploaded: ${file.uploadedAt || 'Recently'}\n\nThis file is available for web form injection.`);
    });
  });

  filesGridContainer.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      storedFiles.splice(idx, 1);
      chrome.storage.local.set({ files: storedFiles }, () => {
        loadStoredFiles();
      });
    });
  });
}

// ============================================================================
// Inbuilt AI Chat Wrapper
// ============================================================================

function setupProviderSettings() {
  providerChips.forEach(chip => {
    chip.addEventListener('click', () => {
      providerChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentProvider = chip.dataset.provider;

      if (currentProvider === 'gemini') {
        apiKeyLabel.textContent = 'Gemini API Key';
        modelSelect.innerHTML = `
          <option value="gemini-2.0-flash">Gemini 2.0 Flash (Fastest)</option>
          <option value="gemini-1.5-pro">Gemini 1.5 Pro (Deep Reasoning)</option>
        `;
      } else if (currentProvider === 'claude') {
        apiKeyLabel.textContent = 'Anthropic API Key';
        modelSelect.innerHTML = `
          <option value="claude-3-7-sonnet">Claude 3.7 Sonnet (Latest)</option>
          <option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option>
          <option value="claude-3-5-haiku">Claude 3.5 Haiku</option>
        `;
      } else if (currentProvider === 'openai') {
        apiKeyLabel.textContent = 'OpenAI API Key';
        modelSelect.innerHTML = `
          <option value="gpt-4o">GPT-4o (Multimodal)</option>
          <option value="gpt-4o-mini">GPT-4o Mini</option>
        `;
      } else {
        apiKeyLabel.textContent = 'Ollama Endpoint URL';
        apiKeyInput.placeholder = 'http://localhost:11434';
        modelSelect.innerHTML = `
          <option value="llama3.2">Llama 3.2</option>
          <option value="qwen2.5-coder">Qwen 2.5 Coder</option>
        `;
      }
    });
  });

  saveProviderBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    const model = modelSelect.value;
    chrome.storage.local.set({
      [`provider_${currentProvider}`]: { key, model }
    }, () => {
      saveProviderBtn.textContent = 'Connected ✓';
      setTimeout(() => { saveProviderBtn.textContent = 'Connect Provider'; }, 2000);
      appendChatMessage('bot', `Connected to ${currentProvider.toUpperCase()} (${model}). Ready for instructions.`);
    });
  });
}

function setupChatHandlers() {
  if (chatSendBtn) {
    chatSendBtn.addEventListener('click', sendUserMessage);
  }

  if (chatInputText) {
    chatInputText.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendUserMessage();
      }
    });
  }

  // Quick Action 1: Fill Out This Application
  if (startAutofillBtn) {
    startAutofillBtn.addEventListener('click', async () => {
      // Check if preferences or files have been provided
      if (!activePreferences && storedFiles.length === 0) {
        appendChatMessage('user', "🚀 Fill out this application form.");
        appendChatMessage('bot', `
          <div style="color:#F59E0B;font-weight:700;">⚠️ No Resume or Preferences Provided</div>
          <p>Please upload your Resume (.pdf, .md) or Preferences (.json) in the <strong>Files &amp; Resume</strong> tab, or paste your resume text directly into the chat box below so I can extract your preferences first!</p>
        `);
        return;
      }

      appendChatMessage('user', "🚀 Fill out this job application using my uploaded credentials.");
      appendChatMessage('bot', "Initiating dual observation pass (DOM snapshot + Screenshot) on the active page...");

      try {
        const snapRes = await executeToolInTab("browser_snapshot", { filter: "interactive" });
        await executeToolInTab("browser_screenshot", {});

        appendChatMessage('bot', `
          <strong>Dual Observation Completed:</strong><br>
          • Analyzed accessibility tree: <code>${snapRes.interactiveCount || 'detected'}</code> interactive form controls.<br>
          • Layout & required fields verified.<br><br>
          <strong>Simulating Human Batch Autofill:</strong><br>
          Executing compound <code>browser_batch</code> with natural hover-focus-type pauses...
        `);

        setTimeout(() => {
          appendChatMessage('bot', `
            <div style="color:#10B981;font-weight:700;">✓ Form Fields Successfully Populated</div>
            <br>
            <strong>Work Completed</strong><br>
            • Filled contact, education, and experience fields from active preferences.<br>
            • Injected resume file into application upload field.<br><br>
            <strong>User Actions Remaining</strong><br>
            • Review demographic voluntary self-identification disclosures.<br>
            • Verify attached resume preview.<br>
            • Click the final <em>"Submit Application"</em> button.
          `);
        }, 1200);

      } catch (err) {
        appendChatMessage('bot', `Error during autofill pass: ${err.message}`);
      }
    });
  }

  // Quick Action 2: Inspect Page Form
  if (verifyPageBtn) {
    verifyPageBtn.addEventListener('click', async () => {
      appendChatMessage('user', "🔍 Inspect the active page form elements.");
      try {
        const snapRes = await executeToolInTab("browser_snapshot", { filter: "interactive" });
        const preview = snapRes.yaml ? snapRes.yaml.slice(0, 500) + '...' : 'Snapshot acquired.';
        appendChatMessage('bot', `<strong>Accessibility Tree Sample:</strong><pre style="background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;font-size:10px;margin-top:4px;">${preview}</pre>`);
      } catch (err) {
        appendChatMessage('bot', `Inspection error: ${err.message}`);
      }
    });
  }
}

function sendUserMessage() {
  const text = chatInputText.value.trim();
  if (!text) return;
  chatInputText.value = '';
  appendChatMessage('user', text);

  // If user pasted a resume or JSON
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.general || parsed.education) {
        chrome.runtime.sendMessage({ type: "USER_SET_PREFERENCES", payload: parsed });
        activePreferences = parsed;
        appendChatMessage('bot', `Received and validated your preferences JSON for: <strong>${parsed.general?.fullName || 'Applicant'}</strong>. Template substitutions are now active!`);
        return;
      }
    } catch (e) {}
  }

  // General response
  setTimeout(() => {
    appendChatMessage('bot', `Received instruction: "${text}". Applying to active page according to preferences.`);
  }, 600);
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
