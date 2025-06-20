// --- DOM Element References ---
const setupSection = document.getElementById('setup-section');
const rcloneTransferSection = document.getElementById('rclone-transfer-section');
const webTerminalSection = document.getElementById('web-terminal-section');
const recentCommandsSection = document.getElementById('recent-commands-section');
const notepadSection = document.getElementById('notepad-section');

const navButtons = document.querySelectorAll('.nav-button');

// Rclone form elements
const modeSelect = document.getElementById('mode');
const modeDescription = document.getElementById('mode-description');
const sourceField = document.getElementById('source-field');
const sourceInput = document.getElementById('source');
const destinationField = document.getElementById('destination-field');
const destinationInput = document.getElementById('destination');
const urlField = document.getElementById('url-field');
const urlInput = document.getElementById('url');
const serveProtocolField = document.getElementById('serve-protocol-field');
const serveProtocolSelect = document.getElementById('serve_protocol');

const transfersInput = document.getElementById('transfers');
const checkersInput = document.getElementById('checkers');
const startRcloneBtn = document.getElementById('start-rclone-btn');
const stopRcloneBtn = document.getElementById('stop-rclone-btn');
const rcloneLiveOutput = document.getElementById('rcloneLiveOutput');
const rcloneMajorStepsOutput = document.getElementById('rclone-major-steps');
const rcloneSpinner = document.getElementById('rclone-spinner');
const rcloneSpinnerText = document.getElementById('rclone-spinner-text');

// Setup elements
const rcloneConfFileInput = document.getElementById('rclone_conf_file_input');
const rcloneConfFileNameDisplay = document.getElementById('rclone-conf-file-name');
const saZipFileInput = document.getElementById('sa_zip_file_input');
const saZipFileNameDisplay = document.getElementById('sa-zip-file-name');
const majorStepsOutput = document.getElementById('majorStepsOutput');

// Terminal elements
const terminalCommandInput = document.getElementById('terminalCommand');
const executeTerminalBtn = document.getElementById('execute-terminal-btn');
const stopTerminalBtn = document.getElementById('stop-terminal-btn');
const terminalOutput = document.getElementById('terminalOutput');
const terminalSpinner = document.getElementById('terminal-spinner');
const terminalSpinnerText = document.getElementById('terminal-spinner-text');
const terminalConfirmModal = document.getElementById('terminalConfirmModal');
const terminalConfirmMessage = document.getElementById('terminalConfirmMessage');
const confirmStopAndStartBtn = document.getElementById('confirmStopAndStartBtn');
const cancelStopAndStartBtn = document.getElementById('cancelStopAndStartBtn');

// --- Global State ---
let isRcloneProcessRunning = false;
let isTerminalProcessRunning = false;
let pendingTerminalCommand = null;

const RcloneModeDescriptions = {
    "sync": "Make source and destination identical.", "copy": "Copy files from source to destination.", "move": "Move files from source to destination.",
    "copyurl": "Copy a URL's content to a destination path.", "check": "Check files in source and destination match.", "cryptcheck": "Cryptcheck the vault.",
    "lsd": "List directories in a path.", "ls": "List all files in a path.", "tree": "List contents in a tree-like fashion.",
    "listremotes": "List all configured remotes.", "mkdir": "Create a new directory.", "size": "Count objects and their sizes.",
    "serve": "Serve a remote over a chosen protocol.", "dedupe": "Remove duplicate files.", "cleanup": "Clean up the remote.",
    "delete": "Remove files in a path.", "deletefile": "Remove a single file.", "purge": "Remove all content in a path.",
    "version": "Show Rclone version."
};
const modesNoArgs = ["listremotes", "version"];
const modesOneRemote = ["lsd", "ls", "tree", "mkdir", "size", "dedupe", "cleanup", "delete", "deletefile", "purge"];
const modesTwoRemotes = ["sync", "copy", "move", "check", "cryptcheck"];

// --- UI Management ---
function showSection(sectionId) {
    document.querySelectorAll('.content-section').forEach(s => s.classList.add('hidden'));
    navButtons.forEach(b => b.classList.remove('active'));
    document.getElementById(`${sectionId}-section`).classList.remove('hidden');
    document.querySelector(`.nav-button[onclick*="'${sectionId}'"]`).classList.add('active');
    if (sectionId === 'recent-commands') loadRecentCommands();
}

function showSpinner(spinner, textElement, message) {
    textElement.textContent = message;
    spinner.classList.remove('hidden');
}

function hideSpinner(spinner) {
    spinner.classList.add('hidden');
}

// --- Rclone Mode & Field Logic ---
function updateRcloneFormUI() {
    const mode = modeSelect.value;
    modeDescription.textContent = RcloneModeDescriptions[mode] || "";
    
    // Hide all special fields first
    [urlField, serveProtocolField, sourceField, destinationField].forEach(f => f.classList.add('hidden'));

    if (mode === 'copyurl') {
        urlField.classList.remove('hidden');
        destinationField.classList.remove('hidden');
    } else if (mode === 'serve') {
        serveProtocolField.classList.remove('hidden');
        sourceField.classList.remove('hidden');
        sourceInput.placeholder = "Path to serve";
    } else if (modesNoArgs.includes(mode)) {
        // No fields needed
    } else if (modesOneRemote.includes(mode)) {
        sourceField.classList.remove('hidden');
        sourceInput.placeholder = "Source Path";
    } else { // Default to two remotes
        sourceField.classList.remove('hidden');
        destinationField.classList.remove('hidden');
        sourceInput.placeholder = "Source Path";
    }
}

// --- File Uploads ---
async function uploadFile(fileInput, endpoint, outputEl) {
    const file = fileInput.files[0];
    if (!file) return;
    logMessage(outputEl, `Uploading ${file.name}...`, 'info');
    const formData = new FormData();
    formData.append(fileInput.name, file);
    try {
        const response = await fetch(endpoint, { method: 'POST', body: formData });
        const result = await response.json();
        logMessage(outputEl, result.message, result.status);
    } catch (error) {
        logMessage(outputEl, `Upload error: ${error.message}`, 'error');
    }
}
function uploadRcloneConf() { uploadFile(rcloneConfFileInput, '/upload-rclone-conf', majorStepsOutput); }
function uploadSaZip() { uploadFile(saZipFileInput, '/upload-sa-zip', majorStepsOutput); }

// --- Rclone Execution ---
async function startRcloneTransfer() {
    if (isRcloneProcessRunning) return;
    isRcloneProcessRunning = true;
    showSpinner(rcloneSpinner, rcloneSpinnerText, "Executing...");
    startRcloneBtn.classList.add('hidden');
    stopRcloneBtn.classList.remove('hidden');
    rcloneLiveOutput.textContent = '';
    
    const payload = {
        mode: modeSelect.value,
        source: sourceInput.value.trim(),
        destination: destinationInput.value.trim(),
        url: urlInput.value.trim(),
        serve_protocol: serveProtocolSelect.value,
        transfers: transfersInput.value,
        checkers: checkersInput.value,
        buffer_size: document.getElementById('buffer_size').value,
        order: document.getElementById('order').value,
        loglevel: document.getElementById('loglevel').value,
        additional_flags: document.getElementById('additional_flags').value.trim(),
        use_drive_trash: document.getElementById('use_drive_trash').checked,
        service_account: document.getElementById('service_account').checked,
        dry_run: document.getElementById('dry_run').checked
    };

    try {
        const response = await fetch('/execute-rclone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
            lines.forEach(line => {
                try {
                    const data = JSON.parse(line);
                    if (data.status === 'progress') appendOutput(rcloneLiveOutput, data.output);
                    else logMessage(rcloneMajorStepsOutput, data.message, data.status);
                } catch (e) { /* Ignore parsing errors for partial lines */ }
            });
        }
    } catch (error) {
        logMessage(rcloneMajorStepsOutput, `Execution error: ${error}`, 'error');
    } finally {
        isRcloneProcessRunning = false;
        hideSpinner(rcloneSpinner);
        startRcloneBtn.classList.remove('hidden');
        stopRcloneBtn.classList.add('hidden');
        saveRcloneTransferToHistory(payload.mode, payload.source || payload.url, payload.destination, 'Finished');
    }
}
async function stopRcloneTransfer() {
    try {
        const response = await fetch('/stop-rclone-process', { method: 'POST' });
        const result = await response.json();
        logMessage(rcloneMajorStepsOutput, result.message, result.status);
    } catch (error) {
        logMessage(rcloneMajorStepsOutput, `Error stopping process: ${error}`, 'error');
    }
}

// --- Terminal Execution ---
async function executeTerminalCommand(command = null) {
    const cmdToExecute = command || terminalCommandInput.value.trim();
    if (!cmdToExecute) return;
    if (isTerminalProcessRunning) {
        terminalConfirmMessage.innerHTML = `A command is running. Stop it and start this new one? <br><code class="bg-input-bg-color p-1 rounded-md text-sm">${cmdToExecute}</code>`;
        terminalConfirmModal.classList.remove('hidden');
        pendingTerminalCommand = cmdToExecute;
        return;
    }
    isTerminalProcessRunning = true;
    showSpinner(terminalSpinner, terminalSpinnerText, "Executing...");
    executeTerminalBtn.classList.add('hidden');
    stopTerminalBtn.classList.remove('hidden');
    
    try {
        const response = await fetch('/execute_terminal_command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: cmdToExecute })
        });
        const result = await response.json();
        if (result.status === 'success') {
            saveCommandToHistory(cmdToExecute);
            pollTerminalOutput();
        } else {
            appendOutput(terminalOutput, result.message, 'error');
            hideSpinner(terminalSpinner);
            isTerminalProcessRunning = false;
        }
    } catch (e) {
        appendOutput(terminalOutput, `Error: ${e}`, 'error');
        isTerminalProcessRunning = false;
    }
}

async function pollTerminalOutput() {
    if (!isTerminalProcessRunning) {
        hideSpinner(terminalSpinner);
        executeTerminalBtn.classList.remove('hidden');
        stopTerminalBtn.classList.add('hidden');
        return;
    }
    try {
        const response = await fetch('/get_terminal_output');
        const result = await response.json();
        terminalOutput.textContent = result.output;
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
        isTerminalProcessRunning = result.is_running;
        setTimeout(pollTerminalOutput, 1000);
    } catch (e) {
        appendOutput(terminalOutput, `Polling error: ${e}`, 'error');
        isTerminalProcessRunning = false;
    }
}

async function stopTerminalProcess() {
    try {
        await fetch('/stop_terminal_process', { method: 'POST' });
        isTerminalProcessRunning = false;
    } catch (e) {
        appendOutput(terminalOutput, `Error stopping: ${e}`, 'error');
    }
    terminalConfirmModal.classList.add('hidden');
}

// --- Output & Logging ---
function appendOutput(element, text, status) {
    const span = document.createElement('span');
    if (status) span.className = status;
    span.textContent = text + '\n';
    element.appendChild(span);
    element.scrollTop = element.scrollHeight;
}
function logMessage(element, message, type) {
    element.innerHTML = `<div class="${type}">${message}</div>`;
}
function clearRcloneOutput() { rcloneLiveOutput.textContent = ''; rcloneMajorStepsOutput.textContent = ''; }
function clearTerminalOutput() { terminalOutput.textContent = ''; }
async function downloadLogs() { window.location.href = '/download-logs'; }
async function downloadTerminalLogs() { window.location.href = '/download-terminal-logs'; }

// --- History & Notepad ---
function getHistory(key) { return JSON.parse(localStorage.getItem(key)) || []; }
function saveHistory(key, data, max = 20) { localStorage.setItem(key, JSON.stringify(data.slice(0, max))); }
function saveCommandToHistory(command) {
    const commands = getHistory('terminalCommands');
    commands.unshift({ command, timestamp: new Date().toLocaleString() });
    saveHistory('terminalCommands', commands);
}
function saveRcloneTransferToHistory(mode, source, destination, status) {
    const transfers = getHistory('rcloneTransfers');
    transfers.unshift({ mode, source, destination, status, timestamp: new Date().toLocaleString() });
    saveHistory('rcloneTransfers', transfers);
}
function loadRecentCommands() {
    const render = (key, containerId, formatter) => {
        const items = getHistory(key);
        const container = document.getElementById(containerId);
        container.innerHTML = items.length ? items.map(formatter).join('') : '<p>No history.</p>';
    };
    render('rcloneTransfers', 'recentRcloneTransfers', item => `<div class="history-item"><p>${item.mode}: ${item.source || ''} -> ${item.destination || ''}</p><small>${item.status} - ${item.timestamp}</small></div>`);
    render('terminalCommands', 'recentTerminalCommands', item => `<div class="history-item"><p>${item.command}</p><small>${item.timestamp}</small></div>`);
}
function clearAllRecentCommands() { if (confirm("Clear all history?")) { localStorage.removeItem('terminalCommands'); localStorage.removeItem('rcloneTransfers'); loadRecentCommands(); } }
function saveNotepad() { localStorage.setItem('notepadContent', document.getElementById('notepad-content').value); }

// --- Event Listeners & Initializers ---
document.addEventListener('DOMContentLoaded', () => {
    // Initial UI State
    showSection('rclone-transfer');
    updateRcloneFormUI();

    // Theme setup
    const themeChangerBtn = document.getElementById('themeChangerBtn');
    const themeDropdown = document.getElementById('themeDropdown');
    themeChangerBtn.addEventListener('click', (e) => { e.stopPropagation(); themeDropdown.classList.toggle('hidden'); });
    document.addEventListener('click', () => themeDropdown.classList.add('hidden'));
    document.querySelectorAll('.theme-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const theme = e.target.dataset.theme;
            document.documentElement.className = theme;
            localStorage.setItem('theme', theme);
        });
    });

    // Rclone form listeners
    modeSelect.addEventListener('change', updateRcloneFormUI);
    ['transfers', 'checkers'].forEach(id => document.getElementById(id).addEventListener('input', e => document.getElementById(`${id}-value`).textContent = e.target.value));
    startRcloneBtn.addEventListener('click', startRcloneTransfer);
    stopRcloneBtn.addEventListener('click', stopRcloneTransfer);
    
    // File inputs
    rcloneConfFileInput.addEventListener('change', e => rcloneConfFileNameDisplay.textContent = e.target.files[0]?.name || 'No file chosen');
    saZipFileInput.addEventListener('change', e => saZipFileNameDisplay.textContent = e.target.files[0]?.name || 'No file chosen');
    
    // Terminal listeners
    executeTerminalBtn.addEventListener('click', () => executeTerminalCommand());
    terminalCommandInput.addEventListener('keypress', e => { if (e.key === 'Enter') executeTerminalCommand(); });
    stopTerminalBtn.addEventListener('click', stopTerminalProcess);
    confirmStopAndStartBtn.addEventListener('click', async () => { await stopTerminalProcess(); executeTerminalCommand(pendingTerminalCommand); });
    cancelStopAndStartBtn.addEventListener('click', () => terminalConfirmModal.classList.add('hidden'));

    // Notepad
    document.getElementById('notepad-content').addEventListener('input', saveNotepad);
    document.getElementById('notepad-content').value = localStorage.getItem('notepadContent') || '';
});
