// --- DOM Element References ---
const rcloneTransferSection = document.getElementById('rclone-transfer-section');
const setupSection = document.getElementById('setup-section');
const webTerminalSection = document.getElementById('web-terminal-section');

const navButtons = document.querySelectorAll('.nav-button');

const modeSelect = document.getElementById('mode');
const modeDescription = document.getElementById('mode-description');
const sourceInput = document.getElementById('source');
const destinationField = document.getElementById('destination-field');
const destinationInput = document.getElementById('destination');
const transfersInput = document.getElementById('transfers');
const transfersValueSpan = document.getElementById('transfers-value');
const checkersInput = document.getElementById('checkers');
const checkersValueSpan = document.getElementById('checkers-value');
const bufferSizeSelect = document.getElementById('buffer_size');
const orderSelect = document.getElementById('order');
const loglevelSelect = document.getElementById('loglevel');
const additionalFlagsInput = document.getElementById('additional_flags');
const useDriveTrashCheckbox = document.getElementById('use_drive_trash');
const serviceAccountCheckbox = document.getElementById('service_account');
const dryRunCheckbox = document.getElementById('dry_run');

const startRcloneBtn = document.getElementById('start-rclone-btn');
const stopRcloneBtn = document.getElementById('stop-rclone-btn');
const rcloneLiveOutput = document.getElementById('rcloneLiveOutput');
const rcloneMajorStepsOutput = document.getElementById('rclone-major-steps');
const rcloneSpinner = document.getElementById('rclone-spinner');
const rcloneSpinnerText = document.getElementById('rclone-spinner-text');

const rcloneConfFile = document.getElementById('rcloneConfFile');
const saZipFile = document.getElementById('saZipFile');
const majorStepsOutput = document.getElementById('majorStepsOutput');

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


const recentCommandsModal = document.getElementById('recentCommandsModal');
const recentRcloneTransfersDiv = document.getElementById('recentRcloneTransfers');
const recentTerminalCommandsDiv = document.getElementById('recentTerminalCommands');


// --- Global State Variables ---
let rclonePollingInterval = null;
let terminalPollingInterval = null;
let isRcloneProcessRunning = false;
let isTerminalProcessRunning = false;
let pendingTerminalCommand = null; // Stores command if user confirms stop & start

const RcloneModeDescriptions = {
    "sync": "Make source and destination identical.",
    "copy": "Copy files from source to destination.",
    "move": "Move files from source to destination.",
    "copyurl": "Copy a URL content to destination.",
    "check": "Check files in the source match the files in the destination.",
    "cryptcheck": "Cryptcheck the vault.",
    "lsd": "List directories/containers in the path.",
    "ls": "List all files in the path.",
    "tree": "List contents of remote in a tree-like fashion.",
    "listremotes": "List all remotes in the config file.",
    "mkdir": "Create new directory.",
    "size": "Counts objects and their sizes in a remote.",
    "serve": "Serve a remote over HTTP/WebDAV/FTP/etc.",
    "dedupe": "Remove duplicate files.",
    "cleanup": "Clean up the remote.",
    "checksum": "Check files checksums.",
    "delete": "Remove files in the path.",
    "deletefile": "Remove a single file from remote.",
    "purge": "Remove all content in the path.",
    "version": "Show version and exit."
};

const twoRemoteModes = [
    "sync", "copy", "move", "copyurl", "check", "cryptcheck"
];

const potentiallyDestructiveModes = ["delete", "purge"];

// --- UI Toggling Functions ---
function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.add('hidden');
        section.classList.remove('active');
    });
    // Deactivate all nav buttons
    navButtons.forEach(button => button.classList.remove('active'));

    // Show the selected section
    const selectedSection = document.getElementById(`${sectionId}-section`);
    if (selectedSection) {
        selectedSection.classList.remove('hidden');
        selectedSection.classList.add('active');
    }

    // Activate the corresponding nav button
    const activeButton = document.querySelector(`.nav-button[onclick*="${sectionId}"]`);
    if (activeButton) {
        activeButton.classList.add('active');
    }

    // Manage polling based on active section
    if (sectionId === 'web-terminal') {
        startTerminalPolling();
    } else {
        stopTerminalPolling();
    }
    // Rclone polling runs independently, as it can be active in background
}

function showRcloneSpinner(message = "Transferring...") {
    rcloneSpinnerText.textContent = message;
    rcloneSpinner.classList.remove('hidden');
}

function hideRcloneSpinner() {
    rcloneSpinner.classList.add('hidden');
}

function showTerminalSpinner(message = "Executing command...") {
    terminalSpinnerText.textContent = message;
    terminalSpinner.classList.remove('hidden');
}

function hideTerminalSpinner() {
    terminalSpinner.classList.add('hidden');
}

// --- Rclone Mode Logic ---
function updateModeDescription() {
    const selectedMode = modeSelect.value;
    modeDescription.textContent = RcloneModeDescriptions[selectedMode] || "No description available.";

    // Warn about destructive modes
    if (potentiallyDestructiveModes.includes(selectedMode)) {
        rcloneMajorStepsOutput.innerHTML = `<span class="warning"><i class="fas fa-exclamation-triangle mr-2"></i> WARNING: This mode (${selectedMode}) can lead to data loss! Use with caution.</span>`;
        rcloneMajorStepsOutput.style.display = 'block';
    } else {
        rcloneMajorStepsOutput.style.display = 'none'; // Hide if not destructive
        rcloneMajorStepsOutput.innerHTML = '';
    }
}

function toggleRemoteField() {
    const selectedMode = modeSelect.value;
    if (twoRemoteModes.includes(selectedMode)) {
        destinationField.classList.remove('hidden');
        destinationInput.setAttribute('required', 'true');
    } else {
        destinationField.classList.add('hidden');
        destinationInput.removeAttribute('required');
    }
}

// --- Generic File Upload ---
async function uploadFile(fileInput, endpoint, outputElement, successMessage) {
    const file = fileInput.files[0];
    if (!file) {
        logMessage(outputElement, "No file selected.", 'error');
        return;
    }

    const formData = new FormData();
    formData.append(fileInput.id, file); // Use the input's ID as the form field name

    logMessage(outputElement, `Uploading ${file.name}...`, 'info');

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();
        if (result.status === 'success') {
            logMessage(outputElement, `${successMessage}: ${result.message}`, 'success');
        } else {
            logMessage(outputElement, `Upload failed: ${result.message}`, 'error');
        }
    } catch (error) {
        logMessage(outputElement, `Network error during upload: ${error.message}`, 'error');
    } finally {
        fileInput.value = ''; // Clear the file input
    }
}

function uploadRcloneConf() {
    uploadFile(rcloneConfFile, '/upload-rclone-conf', majorStepsOutput, 'Rclone config uploaded');
}

function uploadSaZip() {
    uploadFile(saZipFile, '/upload-sa-zip', majorStepsOutput, 'Service accounts uploaded');
}

// --- Rclone Transfer Logic ---
async function startRcloneTransfer() {
    if (isRcloneProcessRunning) {
        logMessage(rcloneMajorStepsOutput, "Rclone process is already running. Please stop it first.", 'warning');
        return;
    }

    const mode = modeSelect.value;
    const source = sourceInput.value.trim();
    const destination = destinationInput.value.trim();

    // Basic validation for two-remote commands
    if (twoRemoteModes.includes(mode) && (!source || !destination)) {
        logMessage(rcloneMajorStepsOutput, "Source and Destination are required for this Rclone mode.", 'error');
        return;
    }
    // Basic validation for one-remote commands
    if (!twoRemoteModes.includes(mode) && !source) {
         logMessage(rcloneMajorStepsOutput, "Source is required for this Rclone mode.", 'error');
        return;
    }

    rcloneLiveOutput.textContent = ''; // Clear previous output
    logMessage(rcloneMajorStepsOutput, 'Initializing Rclone transfer...', 'info');
    showRcloneSpinner();
    isRcloneProcessRunning = true;
    startRcloneBtn.classList.add('hidden');
    stopRcloneBtn.classList.remove('hidden');

    const payload = {
        mode: mode,
        source: source,
        destination: destination,
        transfers: parseInt(transfersInput.value),
        checkers: parseInt(checkersInput.value),
        buffer_size: bufferSizeSelect.value,
        order: orderSelect.value,
        loglevel: loglevelSelect.value,
        additional_flags: additionalFlagsInput.value.trim(),
        use_drive_trash: useDriveTrashCheckbox.checked,
        service_account: serviceAccountCheckbox.checked,
        dry_run: dryRunCheckbox.checked
    };

    try {
        const response = await fetch('/execute-rclone', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const errorData = await response.json();
            logMessage(rcloneMajorStepsOutput, `Error: ${errorData.message}`, 'error');
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.substring(0, newlineIndex);
                buffer = buffer.substring(newlineIndex + 1);

                try {
                    const data = JSON.parse(line);
                    if (data.status === 'progress') {
                        appendOutput(rcloneLiveOutput, data.output);
                    } else if (data.status === 'complete') {
                        logMessage(rcloneMajorStepsOutput, data.message, 'success');
                        appendOutput(rcloneLiveOutput, '\n--- Rclone Command Finished (Success) ---\n');
                        appendOutput(rcloneLiveOutput, data.output, 'success'); // Display final accumulated output
                        saveRcloneTransferToHistory(mode, source, destination, 'Success');
                    } else if (data.status === 'error') {
                        logMessage(rcloneMajorStepsOutput, `Error: ${data.message}`, 'error');
                        appendOutput(rcloneLiveOutput, '\n--- Rclone Command Finished (Error) ---\n');
                        appendOutput(rcloneLiveOutput, data.output, 'error'); // Display final accumulated output
                        saveRcloneTransferToHistory(mode, source, destination, 'Failed');
                    } else if (data.status === 'stopped') {
                        logMessage(rcloneMajorStepsOutput, data.message, 'info');
                        appendOutput(rcloneLiveOutput, '\n--- Rclone Command Stopped by User ---\n');
                        saveRcloneTransferToHistory(mode, source, destination, 'Stopped');
                    }
                } catch (parseError) {
                    // console.warn('Could not parse JSON line:', line, parseError);
                    // This might happen with partial lines, just ignore and wait for more data
                }
            }
        }
    } catch (error) {
        logMessage(rcloneMajorStepsOutput, `Network or Rclone execution error: ${error.message}`, 'error');
        appendOutput(rcloneLiveOutput, `\nError during stream: ${error.message}`, 'error');
        saveRcloneTransferToHistory(mode, source, destination, 'Failed');
    } finally {
        hideRcloneSpinner();
        isRcloneProcessRunning = false;
        startRcloneBtn.classList.remove('hidden');
        stopRcloneBtn.classList.add('hidden');
        // Ensure any remaining buffer content is processed if it's a complete JSON object
        if (buffer.trim()) {
             try {
                const data = JSON.parse(buffer.trim());
                 if (data.status === 'complete') {
                    logMessage(rcloneMajorStepsOutput, data.message, 'success');
                    appendOutput(rcloneLiveOutput, '\n--- Rclone Command Finished (Success) ---\n');
                    appendOutput(rcloneLiveOutput, data.output, 'success');
                    saveRcloneTransferToHistory(mode, source, destination, 'Success');
                } else if (data.status === 'error') {
                    logMessage(rcloneMajorStepsOutput, `Error: ${data.message}`, 'error');
                    appendOutput(rcloneLiveOutput, '\n--- Rclone Command Finished (Error) ---\n');
                    appendOutput(rcloneLiveOutput, data.output, 'error');
                    saveRcloneTransferToHistory(mode, source, destination, 'Failed');
                }
             } catch (e) {
                 // Ignore if not a valid JSON object
             }
        }
    }
}

async function stopRcloneTransfer() {
    if (!isRcloneProcessRunning) {
        logMessage(rcloneMajorStepsOutput, "No Rclone process is currently running.", 'info');
        return;
    }

    logMessage(rcloneMajorStepsOutput, "Sending stop signal to Rclone process...", 'info');
    try {
        const response = await fetch('/stop-rclone-process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        if (result.status === 'success') {
            logMessage(rcloneMajorStepsOutput, result.message, 'success');
        } else {
            logMessage(rcloneMajorStepsOutput, `Failed to stop Rclone: ${result.message}`, 'error');
        }
    } catch (error) {
        logMessage(rcloneMajorStepsOutput, `Network error stopping Rclone: ${error.message}`, 'error');
    }
}

function appendOutput(element, text, status = 'default') {
    const span = document.createElement('span');
    span.textContent = text + '\n';
    if (status === 'success') span.style.color = 'var(--success-color)';
    if (status === 'error') span.style.color = 'var(--error-color)';
    if (status === 'warning') span.style.color = 'var(--warning-color)';
    if (status === 'info') span.style.color = 'var(--info-color)'; // Added info color

    element.appendChild(span);
    element.scrollTop = element.scrollHeight; // Auto-scroll to bottom
}

function logMessage(element, message, type = 'info') {
    const msgElement = document.createElement('div');
    msgElement.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    msgElement.classList.add(type); // Add class for styling
    element.appendChild(msgElement);
    element.scrollTop = element.scrollHeight;
}

// --- Log Download ---
async function downloadLogs() {
    try {
        const response = await fetch('/download-logs');
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = response.headers.get('Content-Disposition').split('filename=')[1].replace(/"/g, '');
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            logMessage(rcloneMajorStepsOutput, "Rclone log download initiated.", 'info');
        } else {
            const errorData = await response.json();
            logMessage(rcloneMajorStepsOutput, `Failed to download log: ${errorData.message}`, 'error');
        }
    } catch (error) {
        logMessage(rcloneMajorStepsOutput, `Network error during log download: ${error.message}`, 'error');
    }
}

// --- Web Terminal Logic ---
async function executeTerminalCommand(command = null) {
    const cmdToExecute = command || terminalCommandInput.value.trim();
    if (!cmdToExecute) {
        logMessage(terminalOutput, "Please enter a command.", 'error');
        return;
    }

    logMessage(terminalOutput, `Executing: ${cmdToExecute}`, 'info');
    showTerminalSpinner();
    terminalOutput.textContent = ''; // Clear previous output
    isTerminalProcessRunning = true;
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
            logMessage(terminalOutput, result.message, 'success');
            saveCommandToHistory(cmdToExecute); // Save command on successful execution start
            startTerminalPolling(); // Start polling immediately after command execution starts
            terminalCommandInput.value = ''; // Clear input field
        } else if (result.status === 'warning' && result.message.includes("already running")) {
            // Show confirmation modal
            terminalConfirmMessage.innerHTML = `A command is currently running: <code class="bg-input-bg-color p-1 rounded-md text-sm">${result.running_command}</code>. Do you want to stop it and start a new one?`;
            terminalConfirmModal.classList.remove('hidden');
            pendingTerminalCommand = cmdToExecute; // Store the new command
        } else {
            logMessage(terminalOutput, `Error: ${result.message}`, 'error');
            hideTerminalSpinner();
            isTerminalProcessRunning = false;
            executeTerminalBtn.classList.remove('hidden');
            stopTerminalBtn.classList.add('hidden');
        }
    } catch (error) {
        logMessage(terminalOutput, `Network error: ${error.message}`, 'error');
        hideTerminalSpinner();
        isTerminalProcessRunning = false;
        executeTerminalBtn.classList.remove('hidden');
        stopTerminalBtn.classList.add('hidden');
    }
}

async function getTerminalOutput() {
    try {
        const response = await fetch('/get_terminal_output');
        const result = await response.json();
        terminalOutput.textContent = result.output; // Update with full content
        terminalOutput.scrollTop = terminalOutput.scrollHeight; // Auto-scroll

        if (!result.is_running && isTerminalProcessRunning) {
            // Process has finished on the backend
            logMessage(terminalOutput, "Terminal command finished.", 'info');
            hideTerminalSpinner();
            isTerminalProcessRunning = false;
            executeTerminalBtn.classList.remove('hidden');
            stopTerminalBtn.classList.add('hidden');
            stopTerminalPolling(); // Stop polling when command is done
        }
    } catch (error) {
        // Log error but don't stop polling immediately, might be a transient network issue
        console.error("Error fetching terminal output:", error);
        // If the backend is truly down, polling will naturally stop as requests fail
    }
}

async function stopTerminalProcess() {
    if (!isTerminalProcessRunning) {
        logMessage(terminalOutput, "No terminal process is currently running.", 'info');
        return;
    }

    logMessage(terminalOutput, "Sending stop signal to terminal process...", 'info');
    try {
        const response = await fetch('/stop_terminal_process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const result = await response.json();
        if (result.status === 'success') {
            logMessage(terminalOutput, result.message, 'success');
            hideTerminalSpinner();
            isTerminalProcessRunning = false;
            executeTerminalBtn.classList.remove('hidden');
            stopTerminalBtn.classList.add('hidden');
            stopTerminalPolling(); // Stop polling when process is stopped
        } else {
            logMessage(terminalOutput, `Failed to stop terminal process: ${result.message}`, 'error');
        }
    } catch (error) {
        logMessage(terminalOutput, `Network error stopping terminal process: ${error.message}`, 'error');
    }
}

function clearTerminalOutput() {
    terminalOutput.textContent = '';
    logMessage(terminalOutput, "Terminal output cleared.", 'info');
}

function startTerminalPolling() {
    if (terminalPollingInterval) {
        clearInterval(terminalPollingInterval);
    }
    terminalPollingInterval = setInterval(getTerminalOutput, 1000); // Poll every 1 second
}

function stopTerminalPolling() {
    if (terminalPollingInterval) {
        clearInterval(terminalPollingInterval);
        terminalPollingInterval = null;
    }
}


// --- Recent Commands History ---
function saveCommandToHistory(command) {
    let commands = JSON.parse(localStorage.getItem('terminalCommands')) || [];
    commands.unshift({ command: command, timestamp: new Date().toLocaleString() }); // Add to beginning
    if (commands.length > 20) { // Keep last 20 commands
        commands.pop();
    }
    localStorage.setItem('terminalCommands', JSON.stringify(commands));
    updateRecentCommandsModalContent(); // Refresh modal if open
}

function saveRcloneTransferToHistory(mode, source, destination, status) {
    let transfers = JSON.parse(localStorage.getItem('rcloneTransfers')) || [];
    transfers.unshift({
        mode: mode,
        source: source,
        destination: destination,
        status: status,
        timestamp: new Date().toLocaleString()
    });
    if (transfers.length > 20) { // Keep last 20 transfers
        transfers.pop();
    }
    localStorage.setItem('rcloneTransfers', JSON.stringify(transfers));
    updateRecentCommandsModalContent(); // Refresh modal if open
}


function loadRecentCommands() {
    const terminalCommands = JSON.parse(localStorage.getItem('terminalCommands')) || [];
    const rcloneTransfers = JSON.parse(localStorage.getItem('rcloneTransfers')) || [];

    recentTerminalCommandsDiv.innerHTML = '';
    if (terminalCommands.length === 0) {
        recentTerminalCommandsDiv.innerHTML = '<p class="text-text-color">No recent terminal commands.</p>';
    } else {
        terminalCommands.forEach(item => {
            const div = document.createElement('div');
            div.className = 'bg-input-bg-color p-3 rounded-md border border-border-color flex justify-between items-center';
            div.innerHTML = `
                <div>
                    <code class="text-primary-color text-sm">${escapeHtml(item.command)}</code>
                    <p class="text-xs text-gray-400 mt-1">${item.timestamp}</p>
                </div>
                <button class="btn-secondary btn-copy-command px-3 py-1 text-xs" data-command="${escapeHtml(item.command)}">
                    <i class="fas fa-copy"></i> Copy
                </button>
            `;
            recentTerminalCommandsDiv.appendChild(div);
        });
    }

    recentRcloneTransfersDiv.innerHTML = '';
    if (rcloneTransfers.length === 0) {
        recentRcloneTransfersDiv.innerHTML = '<p class="text-text-color">No recent Rclone transfers.</p>';
    } else {
        rcloneTransfers.forEach(item => {
            const statusClass = item.status === 'Success' ? 'text-success-color' : (item.status === 'Failed' ? 'text-error-color' : 'text-warning-color');
            const div = document.createElement('div');
            div.className = 'bg-input-bg-color p-3 rounded-md border border-border-color space-y-1';
            div.innerHTML = `
                <p><span class="font-semibold text-accent-color">${item.mode}:</span> <code class="text-primary-color text-sm">${escapeHtml(item.source)}</code> ${item.destination ? `<i class="fas fa-arrow-right mx-1 text-gray-500"></i> <code class="text-primary-color text-sm">${escapeHtml(item.destination)}</code>` : ''}</p>
                <p class="text-xs text-gray-400">Status: <span class="${statusClass}">${item.status}</span> | ${item.timestamp}</p>
                <div class="flex flex-wrap gap-2 mt-2">
                    <button class="btn-secondary btn-copy-rclone-source px-3 py-1 text-xs" data-source="${escapeHtml(item.source)}"><i class="fas fa-copy"></i> Copy Source</button>
                    ${item.destination ? `<button class="btn-secondary btn-copy-rclone-destination px-3 py-1 text-xs" data-destination="${escapeHtml(item.destination)}"><i class="fas fa-copy"></i> Copy Destination</button>` : ''}
                </div>
            `;
            recentRcloneTransfersDiv.appendChild(div);
        });
    }

    // Add event listeners for copy buttons
    document.querySelectorAll('.btn-copy-command').forEach(button => {
        button.onclick = (e) => copyToClipboard(e.target.dataset.command || e.target.closest('button').dataset.command);
    });
    document.querySelectorAll('.btn-copy-rclone-source').forEach(button => {
        button.onclick = (e) => copyToClipboard(e.target.dataset.source || e.target.closest('button').dataset.source);
    });
    document.querySelectorAll('.btn-copy-rclone-destination').forEach(button => {
        button.onclick = (e) => copyToClipboard(e.target.dataset.destination || e.target.closest('button').dataset.destination);
    });
}

function clearAllRecentCommands() {
    if (confirm("Are you sure you want to clear all recent commands and transfers history?")) {
        localStorage.removeItem('terminalCommands');
        localStorage.removeItem('rcloneTransfers');
        updateRecentCommandsModalContent();
        logMessage(majorStepsOutput, "All recent commands and transfers history cleared.", 'info');
    }
}


function toggleRecentCommandsModal() {
    recentCommandsModal.classList.toggle('hidden');
    if (!recentCommandsModal.classList.contains('hidden')) {
        loadRecentCommands(); // Load/refresh content when modal is shown
    }
}

// Utility to escape HTML for display
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// --- Clipboard Copy Utility ---
function copyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    try {
        const successful = document.execCommand('copy');
        logMessage(majorStepsOutput, successful ? "Copied to clipboard!" : "Failed to copy!", successful ? 'success' : 'error');
    } catch (err) {
        logMessage(majorStepsOutput, "Failed to copy to clipboard (unsupported by browser).", 'error');
    }
    document.body.removeChild(textarea);
}


// --- Logout ---
function logout() {
    window.location.href = '/logout';
}

// --- Theme Changer ---
document.addEventListener('DOMContentLoaded', () => {
    const themeChangerBtn = document.getElementById('themeChangerBtn');
    const themeDropdown = document.getElementById('themeDropdown');

    // Toggle dropdown visibility
    themeChangerBtn.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent click from bubbling to document and closing immediately
        themeDropdown.classList.toggle('hidden');
    });

    // Close dropdown if clicked outside
    document.addEventListener('click', (event) => {
        if (!themeDropdown.contains(event.target) && !themeChangerBtn.contains(event.target)) {
            themeDropdown.classList.add('hidden');
        }
    });

    // Apply selected theme
    themeDropdown.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            const theme = event.target.dataset.theme;
            document.body.className = theme; // Set the class on the body
            localStorage.setItem('theme', theme); // Save theme preference
            themeDropdown.classList.add('hidden'); // Hide dropdown after selection
        });
    });

    // Load saved theme on initial page load
    const savedTheme = localStorage.getItem('theme') || 'dark-mode'; // Default to dark-mode
    document.body.className = savedTheme;
});


// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // Initial UI setup
    showSection('rclone-transfer'); // Show Rclone Transfer section by default
    updateModeDescription(); // Set initial mode description
    toggleRemoteField(); // Set initial destination field visibility
    loadRecentCommands(); // Load recent commands on startup

    // Rclone Form Events
    modeSelect.addEventListener('change', () => {
        updateModeDescription();
        toggleRemoteField();
    });
    transfersInput.addEventListener('input', () => {
        transfersValueSpan.textContent = transfersInput.value;
    });
    checkersInput.addEventListener('input', () => {
        checkersValueSpan.textContent = checkersInput.value;
    });
    startRcloneBtn.addEventListener('click', startRcloneTransfer);
    stopRcloneBtn.addEventListener('click', stopRcloneTransfer);

    // Terminal Events
    executeTerminalBtn.addEventListener('click', () => executeTerminalCommand());
    stopTerminalBtn.addEventListener('click', stopTerminalProcess);
    terminalCommandInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault(); // Prevent default form submission
            executeTerminalCommand();
        }
    });

    confirmStopAndStartBtn.addEventListener('click', async () => {
        terminalConfirmModal.classList.add('hidden');
        await stopTerminalProcess(); // Ensure the current process is stopped
        if (pendingTerminalCommand) {
            executeTerminalCommand(pendingTerminalCommand); // Execute the new command
            pendingTerminalCommand = null;
        }
    });

    cancelStopAndStartBtn.addEventListener('click', () => {
        terminalConfirmModal.classList.add('hidden');
        pendingTerminalCommand = null; // Clear pending command
        hideTerminalSpinner();
        isTerminalProcessRunning = false; // Reset state if cancelled
        executeTerminalBtn.classList.remove('hidden');
        stopTerminalBtn.classList.add('hidden');
    });

    // Close modal if clicked outside content
    recentCommandsModal.addEventListener('click', (event) => {
        if (event.target === recentCommandsModal) {
            toggleRecentCommandsModal();
        }
    });

    // Close modal on Escape key press
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (!recentCommandsModal.classList.contains('hidden')) {
                toggleRecentCommandsModal();
            }
            if (!terminalConfirmModal.classList.contains('hidden')) {
                terminalConfirmModal.classList.add('hidden');
                pendingTerminalCommand = null; // Clear pending command
                hideTerminalSpinner();
                isTerminalProcessRunning = false; // Reset state if cancelled
                executeTerminalBtn.classList.remove('hidden');
                stopTerminalBtn.classList.add('hidden');
            }
        }
    });
});
