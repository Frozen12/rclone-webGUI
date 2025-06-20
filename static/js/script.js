// --- DOM Element References ---
const setupSection = document.getElementById('setup-section');
const rcloneTransferSection = document.getElementById('rclone-transfer-section');
const webTerminalSection = document.getElementById('web-terminal-section');
const recentCommandsSection = document.getElementById('recent-commands-section'); // New tab
const notepadSection = document.getElementById('notepad-section'); // New tab

const navButtons = document.querySelectorAll('.nav-button');

const modeSelect = document.getElementById('mode');
const modeDescription = document.getElementById('mode-description');
const sourceFieldContainer = document.getElementById('source-field-container'); // Container for source/URL/protocol
const sourceLabel = document.getElementById('source-label'); // Label for source/path to serve
const sourceInput = document.getElementById('source'); // This is the input itself now (will be path to serve for serve mode)
const urlInput = document.getElementById('url-input'); // New URL input for copyurl
const serveProtocolSelect = document.getElementById('serve-protocol-select'); // New dropdown for serve protocol
const destinationField = document.getElementById('destination-field'); // This is the div wrapping destination input
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
const rcloneSpinner = document.getElementById('rclone-spinner'); // Spinner next to title

const rcloneConfFileInput = document.getElementById('rclone_conf_file_input');
const rcloneConfFileNameDisplay = document.getElementById('rclone-conf-file-name');
const saZipFileInput = document.getElementById('sa_zip_file_input');
const saZipFileNameDisplay = document.getElementById('sa-zip-file-name');
const majorStepsOutput = document.getElementById('majorStepsOutput'); // This is also used for setup section messages

const terminalCommandInput = document.getElementById('terminalCommand');
const executeTerminalBtn = document.getElementById('execute-terminal-btn');
const stopTerminalBtn = document.getElementById('stop-terminal-btn');
const terminalOutput = document.getElementById('terminalOutput');
const terminalSpinner = document.getElementById('terminal-spinner'); // Spinner next to title
const terminalConfirmModal = document.getElementById('terminalConfirmModal');
const terminalConfirmMessage = document.getElementById('terminalConfirmMessage');
const confirmStopAndStartBtn = document.getElementById('confirmStopAndStartBtn');
const cancelStopAndStartBtn = document.getElementById('cancelStopAndStartBtn');

const recentRcloneTransfersDiv = document.getElementById('recentRcloneTransfers');
const recentTerminalCommandsDiv = document.getElementById('recentTerminalCommands');

const notepadContent = document.getElementById('notepad-content');

let currentUsername = 'admin'; // Default for local testing, will be updated from backend


// --- Global State Variables ---
let isRcloneProcessRunning = false;
let isTerminalProcessRunning = false;
let pendingTerminalCommand = null; // Stores command if user confirms stop & start

// For header scroll behavior
let lastScrollY = 0;
const header = document.querySelector('header');
const headerHeight = header.offsetHeight;


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
    "delete": "Remove files in the path. (Path is the file to delete)",
    "deletefile": "Remove a single file from remote. (Path is the file to delete)",
    "purge": "Remove all content in the path. (Path is the directory to purge)",
    "version": "Show version and exit."
};

// Modes requiring two remotes (source and destination)
const modesTwoRemotes = ["sync", "copy", "move", "check", "cryptcheck"];
// Modes requiring a URL and a destination
const modesCopyUrl = ["copyurl"];
// Modes requiring one remote (source as path/remote)
const modesOneRemote = ["lsd", "ls", "tree", "mkdir", "size", "dedupe", "cleanup", "delete", "deletefile", "purge"];
// Modes for serving a remote
const modesServe = ["serve"];
// Modes requiring no arguments other than --config
const modesNoArgs = ["listremotes", "version"];

const potentiallyDestructiveModes = ["delete", "purge", "move", "cleanup", "dedupe"];

// --- UI Toggling Functions ---
function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.add('hidden');
        section.classList.remove('active'); // Remove active class for styling
    });
    // Deactivate all nav buttons
    navButtons.forEach(button => button.classList.remove('active'));

    // Show the selected section
    const selectedSection = document.getElementById(`${sectionId}-section`);
    if (selectedSection) {
        selectedSection.classList.remove('hidden');
        selectedSection.classList.add('active'); // Add active class for styling
    }

    // Activate the corresponding nav button
    const activeButton = document.querySelector(`.nav-button[onclick*="${sectionId}"]`);
    if (activeButton) {
        activeButton.classList.add('active');
    }

    // Load content specific to the section
    if (sectionId === 'notepad') {
        loadNotepadContent();
    } else if (sectionId === 'recent-commands') {
        loadRecentCommands();
    }
}

function showRcloneSpinner() {
    rcloneSpinner.style.display = 'block'; // Make spinner visible
}

function hideRcloneSpinner() {
    rcloneSpinner.style.display = 'none'; // Hide spinner
}

function showTerminalSpinner() {
    terminalSpinner.style.display = 'block'; // Make spinner visible
}

function hideTerminalSpinner() {
    terminalSpinner.style.display = 'none'; // Hide spinner
}

// --- Header Scroll Behavior ---
function handleScroll() {
    if (window.scrollY > lastScrollY && window.scrollY > headerHeight) { // Scrolling down
        header.classList.remove('header-visible');
        header.classList.add('header-hidden');
    } else { // Scrolling up or at the very top
        header.classList.remove('header-hidden');
        header.classList.add('header-visible');
    }
    lastScrollY = window.scrollY;
}


// --- Rclone Mode Logic ---
function updateModeDescription() {
    const selectedMode = modeSelect.value;
    const description = RcloneModeDescriptions[selectedMode] || "No description available.";
    modeDescription.textContent = description;

    // Warn about destructive modes
    if (potentiallyDestructiveModes.includes(selectedMode)) {
        rcloneMajorStepsOutput.innerHTML = `<span class="warning"><i class="fas fa-exclamation-triangle mr-2"></i> WARNING: This mode (${selectedMode}) can lead to data loss! Use with caution.</span>`;
        rcloneMajorStepsOutput.style.display = 'block';
    } else {
        rcloneMajorStepsOutput.style.display = 'none'; // Hide if not destructive
        rcloneMajorStepsOutput.innerHTML = ''; // Clear content
    }
    toggleRemoteField(); // Call this to update field visibility based on the new mode
}

function toggleRemoteField() {
    const selectedMode = modeSelect.value;

    // Hide all mode-specific inputs initially
    sourceInput.classList.add('hidden');
    urlInput.classList.add('hidden');
    serveProtocolSelect.classList.add('hidden');
    sourceLabel.textContent = 'Source Path'; // Reset label

    // Reset required attributes
    sourceInput.removeAttribute('required');
    urlInput.removeAttribute('required');
    destinationInput.removeAttribute('required');


    // Show/hide source and destination fields based on mode type
    if (modesTwoRemotes.includes(selectedMode)) {
        sourceInput.classList.remove('hidden');
        sourceInput.setAttribute('required', 'true');
        destinationField.classList.remove('hidden'); // Show destination field
        destinationInput.setAttribute('required', 'true');
        sourceLabel.textContent = 'Source Path';
    } else if (modesCopyUrl.includes(selectedMode)) {
        urlInput.classList.remove('hidden'); // Show URL input
        urlInput.setAttribute('required', 'true');
        destinationField.classList.remove('hidden'); // Show destination field
        destinationInput.setAttribute('required', 'true');
        sourceLabel.textContent = 'URL'; // Change label to URL
    } else if (modesOneRemote.includes(selectedMode)) {
        sourceInput.classList.remove('hidden'); // Keep source field for "path"
        sourceInput.setAttribute('required', 'true'); // Source is required as the "path"
        destinationField.classList.add('hidden'); // Hide destination field
        sourceLabel.textContent = 'Path/Remote';
    } else if (modesServe.includes(selectedMode)) {
        serveProtocolSelect.classList.remove('hidden'); // Show serve protocol dropdown
        sourceInput.classList.remove('hidden'); // Source becomes "Path to serve"
        sourceInput.setAttribute('required', 'true');
        destinationField.classList.add('hidden'); // Hide destination field
        sourceLabel.textContent = 'Path to serve'; // Change label to Path to serve
    } else if (modesNoArgs.includes(selectedMode)) {
        sourceInput.classList.add('hidden'); // Hide source field
        destinationField.classList.add('hidden'); // Hide destination field
        sourceInput.removeAttribute('required');
        destinationInput.removeAttribute('required');
    }
}


// --- Generic File Upload ---
async function uploadFile(fileInput, fileNameDisplay, endpoint, outputElement, successMessage) {
    const file = fileInput.files[0];
    if (!file) {
        logMessage(outputElement, "No file selected.", 'error');
        return;
    }

    const formData = new FormData();
    formData.append(fileInput.name, file); // Use fileInput.name here, which is 'rclone_conf' or 'sa_zip' as defined in HTML

    logMessage(outputElement, `Uploading ${file.name}...`, 'info');

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData,
            // DO NOT set Content-Type header manually when using FormData, browser sets it correctly
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
        fileNameDisplay.textContent = 'No file chosen'; // Reset file name display
    }
}

function uploadRcloneConf() {
    uploadFile(rcloneConfFileInput, rcloneConfFileNameDisplay, '/upload-rclone-conf', majorStepsOutput, 'Rclone config uploaded');
}

function uploadSaZip() {
    uploadFile(saZipFileInput, saZipFileNameDisplay, '/upload-sa-zip', majorStepsOutput, 'Service accounts uploaded');
}

// --- Rclone Transfer Logic ---
async function startRcloneTransfer() {
    if (isRcloneProcessRunning) {
        logMessage(rcloneMajorStepsOutput, "Rclone process is already running. Please stop it first.", 'warning');
        return;
    }

    const mode = modeSelect.value;
    let source = '';
    const destination = destinationInput.value.trim();
    let serveProtocol = '';

    // Handle source/URL/path-to-serve based on selected mode
    if (modesCopyUrl.includes(mode)) {
        source = urlInput.value.trim();
        if (!source) {
            logMessage(rcloneMajorStepsOutput, "URL is required for copyurl mode.", 'error');
            return;
        }
    } else if (modesServe.includes(mode)) {
        source = sourceInput.value.trim(); // sourceInput is "Path to serve" in this mode
        serveProtocol = serveProtocolSelect.value;
        if (!source) {
            logMessage(rcloneMajorStepsOutput, "Path to serve is required for serve mode.", 'error');
            return;
        }
    } else if (modesTwoRemotes.includes(mode) || modesOneRemote.includes(mode)) {
        source = sourceInput.value.trim();
        if (!source && (modesTwoRemotes.includes(mode) || modesOneRemote.includes(mode))) {
            logMessage(rcloneMajorStepsOutput, "Source (path/remote) is required for this Rclone mode.", 'error');
            return;
        }
    } else if (modesNoArgs.includes(mode)) {
        // No arguments needed
    } else {
        logMessage(rcloneMajorStepsOutput, `Unknown Rclone mode: ${mode}`, 'error');
        return;
    }

    // Validate destination for modes that require it
    if ((modesTwoRemotes.includes(mode) || modesCopyUrl.includes(mode)) && !destination) {
        logMessage(rcloneMajorStepsOutput, "Destination is required for this Rclone mode.", 'error');
        return;
    }

    rcloneLiveOutput.textContent = ''; // Clear previous output
    logMessage(rcloneMajorStepsOutput, 'Initializing Rclone transfer...', 'info');
    showRcloneSpinner(); // Show spinner next to title
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
        dry_run: dryRunCheckbox.checked,
        serve_protocol: serveProtocol // Include serve protocol in payload
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
            // Ensure buttons are reset on error immediately
            hideRcloneSpinner();
            isRcloneProcessRunning = false;
            startRcloneBtn.classList.remove('hidden');
            stopRcloneBtn.classList.add('hidden');
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
                        if (data.output) { // For version/listremotes, data.output might contain the full output
                             appendOutput(rcloneLiveOutput, data.output, 'success');
                        }
                        saveRcloneTransferToHistory(mode, source, destination, 'Success');
                    } else if (data.status === 'error') {
                        logMessage(rcloneMajorStepsOutput, `Error: ${data.message}`, 'error');
                        appendOutput(rcloneLiveOutput, '\n--- Rclone Command Finished (Error) ---\n');
                        if (data.output) {
                            appendOutput(rcloneLiveOutput, data.output, 'error');
                        }
                        saveRcloneTransferToHistory(mode, source, destination, 'Failed');
                    } else if (data.status === 'stopped') {
                        logMessage(rcloneMajorStepsOutput, data.message, 'info');
                        appendOutput(rcloneLiveOutput, '\n--- Rclone Command Stopped by User ---\n');
                        saveRcloneTransferToHistory(mode, source, destination, 'Stopped');
                    }
                } catch (parseError) {
                    // This might happen with partial lines, just append as raw text if not valid JSON
                    appendOutput(rcloneLiveOutput, line);
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
        // Process any remaining buffer content after stream ends
        if (buffer.trim()) {
             try {
                const data = JSON.parse(buffer.trim());
                 if (data.status === 'complete') {
                    logMessage(rcloneMajorStepsOutput, data.message, 'success');
                    appendOutput(rcloneLiveOutput, '\n--- Rclone Command Finished (Success) ---\n');
                    if (data.output) appendOutput(rcloneLiveOutput, data.add;
                    saveRcloneTransferToHistory(mode, source, destination, 'Success');
                } else if (data.status === 'error') {
                    logMessage(rcloneMajorStepsOutput, `Error: ${data.message}`, 'error');
                    appendOutput(rcloneLiveOutput, '\n--- Rclone Command Finished (Error) ---\n');
                    if (data.output) appendOutput(rcloneLiveOutput, data.output, 'error');
                    saveRcloneTransferToHistory(mode, source, destination, 'Failed');
                }
             } catch (e) {
                 appendOutput(rcloneLiveOutput, buffer.trim());
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

function clearRcloneOutput() {
    rcloneLiveOutput.textContent = '';
    rcloneMajorStepsOutput.innerHTML = '';
    rcloneMajorStepsOutput.style.display = 'none';
}

// --- Log Download ---
async function downloadRcloneLogs() {
    try {
        const response = await fetch('/download-rclone-log');
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            const contentDisposition = response.headers.get('Content-Disposition');
            const filenameMatch = contentDisposition && contentDisposition.match(/filename="?([^"]+)"?/);
            a.download = filenameMatch ? filenameMatch[1] : `rclone_webgui_log_${new Date().toISOString().slice(0,10)}.txt`;
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

async function downloadTerminalLogs() {
    try {
        const response = await fetch('/download-terminal-log');
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            const contentDisposition = response.headers.get('Content-Disposition');
            const filenameMatch = contentDisposition && contentDisposition.match(/filename="?([^"]+)"?/);
            a.download = filenameMatch ? filenameMatch[1] : `terminal_log_${new Date().toISOString().slice(0,10)}.txt`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            logMessage(terminalOutput, "Terminal log download initiated.", 'info');
        } else {
            const errorData = await response.json();
            logMessage(terminalOutput, `Failed to download terminal log: ${errorData.message}`, 'error');
        }
    } catch (error) {
        logMessage(terminalOutput, `Network error during terminal log download: ${error.message}`, 'error');
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
    showTerminalSpinner(); // Show spinner next to title
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
        // Check for specific status codes (e.g., 409 Conflict) before reading as JSON
        if (response.status === 409) {
            const result = await response.json();
            terminalConfirmMessage.innerHTML = `A command is currently running: <code class="bg-input-bg-color p-1 rounded-md text-sm">${escapeHtml(result.running_command)}</code>. Do you want to stop it and start a new one?`;
            terminalConfirmModal.classList.remove('hidden');
            pendingTerminalCommand = cmdToExecute; // Store the new command
            hideTerminalSpinner(); // Hide spinner when showing modal
            isTerminalProcessRunning = false; // Reset state for UI control
            executeTerminalBtn.classList.remove('hidden');
            stopTerminalBtn.classList.add('hidden');
            return; // Exit function as modal is shown
        }
        
        // Handle stream for successful command execution
        if (response.ok) {
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
                            appendOutput(terminalOutput, data.output);
                        } else if (data.status === 'complete') {
                            logMessage(terminalOutput, data.message, 'success');
                            appendOutput(terminalOutput, '\n--- Terminal Command Finished (Success) ---\n');
                            if (data.output) appendOutput(terminalOutput, data.output, 'success'); // Append full output if any
                            saveCommandToHistory(cmdToExecute);
                        } else if (data.status === 'error') {
                            logMessage(terminalOutput, `Error: ${data.message}`, 'error');
                            appendOutput(terminalOutput, '\n--- Terminal Command Finished (Error) ---\n');
                            if (data.output) appendOutput(terminalOutput, data.output, 'error'); // Append full output if any
                            saveCommandToHistory(cmdToExecute);
                        } else if (data.status === 'stopped') {
                            logMessage(terminalOutput, data.message, 'info');
                            appendOutput(terminalOutput, '\n--- Terminal Command Stopped by User ---\n');
                            saveCommandToHistory(cmdToExecute);
                        }
                    } catch (parseError) {
                        appendOutput(terminalOutput, line); // Append raw line if not JSON
                    }
                }
            }
        } else { // Handle other non-OK HTTP status codes
            const errorData = await response.json();
            logMessage(terminalOutput, `Error: ${errorData.message}`, 'error');
            saveCommandToHistory(cmdToExecute); // Still save failed command to history
        }
    } catch (error) {
        logMessage(terminalOutput, `Network or Terminal execution error: ${error.message}`, 'error');
        appendOutput(terminalOutput, `\nError during stream: ${error.message}`, 'error');
        saveCommandToHistory(cmdToExecute); // Still save failed command to history
    } finally {
        hideTerminalSpinner();
        isTerminalProcessRunning = false;
        executeTerminalBtn.classList.remove('hidden');
        stopTerminalBtn.classList.add('hidden');
        // Process any remaining buffer content after stream ends (if applicable for non-streaming error paths)
        if (buffer && buffer.trim()) {
            try {
                const data = JSON.parse(buffer.trim());
                if (data.status === 'complete') {
                    logMessage(terminalOutput, data.message, 'success');
                    appendOutput(terminalOutput, '\n--- Terminal Command Finished (Success) ---\n');
                    if (data.output) appendOutput(terminalOutput, data.output, 'success');
                    saveCommandToHistory(cmdToExecute);
                } else if (data.status === 'error') {
                    logMessage(terminalOutput, `Error: ${data.message}`, 'error');
                    appendOutput(terminalOutput, '\n--- Terminal Command Finished (Error) ---\n');
                    if (data.output) appendOutput(terminalOutput, data.output, 'error');
                    saveCommandToHistory(cmdToExecute);
                }
            } catch (e) {
                appendOutput(terminalOutput, buffer.trim());
            }
        }
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
        } else {
            logMessage(terminalOutput, `Failed to stop terminal process: ${result.message}`, 'error');
        }
    } catch (error) {
        logMessage(terminalOutput, `Network error stopping terminal process: ${error.message}`, 'error');
    }
}

function clearTerminalOutput() {
    terminalOutput.textContent = '';
}


// --- Recent Commands History (Server-Side) ---
async function saveCommandToHistory(command) {
    try {
        const response = await fetch('/save_recent_commands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'terminal', command: command, timestamp: new Date().toISOString() })
        });
        const result = await response.json();
        if (result.status !== 'success') {
            console.error("Error saving terminal command history:", result.message);
        }
    } catch (error) {
        console.error("Network error saving terminal command history:", error);
    }
}

async function saveRcloneTransferToHistory(mode, source, destination, status) {
    try {
        const response = await fetch('/save_recent_commands', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'rclone',
                mode: mode,
                source: source,
                destination: destination,
                status: status,
                timestamp: new Date().toISOString()
            })
        });
        const result = await response.json();
        if (result.status !== 'success') {
            console.error("Error saving Rclone transfer history:", result.message);
        }
    } catch (error) {
        console.error("Network error saving Rclone transfer history:", error);
    }
}

async function loadRecentCommands() {
    try {
        const response = await fetch('/load_recent_commands');
        const result = await response.json();

        recentTerminalCommandsDiv.innerHTML = '';
        recentRcloneTransfersDiv.innerHTML = '';

        if (result.status === 'success' && result.data) {
            const sortedData = result.data.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Sort by timestamp, newest first

            sortedData.forEach(item => {
                if (item.type === 'terminal') {
                    const div = document.createElement('div');
                    div.className = 'bg-input-bg-color p-3 rounded-md border border-border-color flex justify-between items-center';
                    div.innerHTML = `
                        <div>
                            <code class="text-primary-color text-sm">${escapeHtml(item.command)}</code>
                            <p class="text-xs text-gray-400 mt-1">${new Date(item.timestamp).toLocaleString()}</p>
                        </div>
                        <button class="btn-secondary btn-copy-command px-3 py-1 text-xs" data-command="${escapeHtml(item.command)}">
                            <i class="fas fa-copy"></i> Copy
                        </button>
                    `;
                    recentTerminalCommandsDiv.appendChild(div);
                } else if (item.type === 'rclone') {
                    const statusClass = item.status === 'Success' ? 'text-success-color' : (item.status === 'Failed' ? 'text-error-color' : 'text-warning-color');
                    const div = document.createElement('div');
                    div.className = 'bg-input-bg-color p-3 rounded-md border border-border-color space-y-1';
                    div.innerHTML = `
                        <p><span class="font-semibold text-accent-color">${item.mode}:</span> <code class="text-primary-color text-sm">${escapeHtml(item.source)}</code> ${item.destination ? `<i class="fas fa-arrow-right mx-1 text-gray-500"></i> <code class="text-primary-color text-sm">${escapeHtml(item.destination)}</code>` : ''}</p>
                        <p class="text-xs text-gray-400">Status: <span class="${statusClass}">${item.status}</span> | ${new Date(item.timestamp).toLocaleString()}</p>
                        <div class="flex flex-wrap gap-2 mt-2">
                            <button class="btn-secondary btn-copy-rclone-source px-3 py-1 text-xs" data-source="${escapeHtml(item.source)}"><i class="fas fa-copy"></i> Copy Source</button>
                            ${item.destination ? `<button class="btn-secondary btn-copy-rclone-destination px-3 py-1 text-xs" data-destination="${escapeHtml(item.destination)}"><i class="fas fa-copy"></i> Copy Destination</button>` : ''}
                        </div>
                    `;
                    recentRcloneTransfersDiv.appendChild(div);
                }
            });

            if (recentTerminalCommandsDiv.childElementCount === 0) {
                recentTerminalCommandsDiv.innerHTML = '<p class="text-text-color">No recent terminal commands.</p>';
            }
            if (recentRcloneTransfersDiv.childElementCount === 0) {
                recentRcloneTransfersDiv.innerHTML = '<p class="text-text-color">No recent Rclone transfers.</p>';
            }

            // Add event listeners for copy buttons after content is rendered
            document.querySelectorAll('.btn-copy-command').forEach(button => {
                button.onclick = (e) => copyToClipboard(e.target.dataset.command || e.target.closest('button').dataset.command);
            });
            document.querySelectorAll('.btn-copy-rclone-source').forEach(button => {
                button.onclick = (e) => copyToClipboard(e.target.dataset.source || e.target.closest('button').dataset.source);
            });
            document.querySelectorAll('.btn-copy-rclone-destination').forEach(button => {
                button.onclick = (e) => copyToClipboard(e.target.dataset.destination || e.target.closest('button').dataset.destination);
            });

        } else {
            console.error("Error loading recent commands:", result.message);
            recentTerminalCommandsDiv.innerHTML = `<p class="text-error-color">Error loading recent commands: ${result.message}</p>`;
            recentRcloneTransfersDiv.innerHTML = `<p class="text-error-color">Error loading recent transfers: ${result.message}</p>`;
        }
    } catch (error) {
        console.error("Network error loading recent commands:", error);
        recentTerminalCommandsDiv.innerHTML = '<p class="text-error-color">Network error loading recent commands.</p>';
        recentRcloneTransfersDiv.innerHTML = '<p class="text-error-color">Network error loading recent transfers.</p>';
    }
}


async function clearAllRecentCommands() {
    // Custom confirmation modal
    const confirmModal = document.createElement('div');
    confirmModal.className = 'modal';
    confirmModal.innerHTML = `
        <div class="modal-content card rounded-xl p-8 shadow-2xl">
            <h2 class="text-2xl font-bold mb-4 text-primary-color">Confirm Clear History</h2>
            <p class="text-text-color mb-6">Are you sure you want to clear all recent commands and transfers history, including notepad content? This cannot be undone.</p>
            <div class="flex justify-end space-x-4">
                <button id="confirmClearBtn" class="btn-danger"><i class="fas fa-trash-alt mr-2"></i> Clear All</button>
                <button id="cancelClearBtn" class="btn-secondary"><i class="fas fa-times-circle mr-2"></i> Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(confirmModal);

    const confirmClearBtn = document.getElementById('confirmClearBtn');
    const cancelClearBtn = document.getElementById('cancelClearBtn');

    confirmClearBtn.onclick = async () => {
        document.body.removeChild(confirmModal);
        try {
            const response = await fetch('/clear_all_user_data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            const result = await response.json();
            if (result.status === 'success') {
                logMessage(majorStepsOutput, result.message, 'success');
                loadRecentCommands(); // Reload to show empty state
                loadNotepadContent(); // Reload notepad to show empty state
            } else {
                logMessage(majorStepsOutput, `Failed to clear history: ${result.message}`, 'error');
            }
        } catch (error) {
            logMessage(majorStepsOutput, `Network error clearing history: ${error.message}`, 'error');
        }
    };
    cancelClearBtn.onclick = () => {
        document.body.removeChild(confirmModal);
    };
}


// --- Notepad Logic (Server-Side) ---
async function saveNotepadContent() {
    try {
        const response = await fetch('/save_notepad_content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: notepadContent.value })
        });
        const result = await response.json();
        if (result.status !== 'success') {
            console.error("Error saving notepad content:", result.message);
        }
    } catch (error) {
        console.error("Network error saving notepad content:", error);
    }
}

async function loadNotepadContent() {
    try {
        const response = await fetch('/load_notepad_content');
        const result = await response.json();
        if (result.status === 'success') {
            notepadContent.value = result.content || 'Type or paste your notes here. This content will be saved automatically to the cloud.';
        } else {
            console.error("Error loading notepad content:", result.message);
            notepadContent.value = `Error loading notepad content: ${result.message}`;
        }
    } catch (error) {
        console.error("Network error loading notepad content:", error);
        notepadContent.value = 'Network error loading notepad content.';
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
        // A simple visual feedback for copy
        const copyFeedback = document.createElement('span');
        copyFeedback.textContent = successful ? "Copied!" : "Failed to copy!";
        copyFeedback.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: rgba(var(--card-bg-color-rgb), 0.9);
            color: var(--primary-color);
            padding: 10px 20px;
            border-radius: 8px;
            z-index: 1001;
            opacity: 0;
            transition: opacity 0.3s ease-in-out;
        `;
        document.body.appendChild(copyFeedback);
        setTimeout(() => {
            copyFeedback.style.opacity = 1;
        }, 10); // Small delay to trigger transition
        setTimeout(() => {
            copyFeedback.style.opacity = 0;
            copyFeedback.remove();
        }, 1500); // Hide after 1.5 seconds

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
            document.documentElement.className = theme; // Apply to html for global variables
            document.body.className = theme; // Apply to body for fallback/compatibility
            localStorage.setItem('theme', theme); // Save theme preference
            themeDropdown.classList.add('hidden'); // Hide dropdown after selection
        });
    });

    // Fetch and display username on load
    fetch('/get_username')
        .then(response => response.json())
        .then(data => {
            if (data.username) {
                currentUsername = data.username; // Set global username
                document.getElementById('user-id-display').textContent = `User: ${data.username}`;
            } else {
                document.getElementById('user-id-display').textContent = 'User: N/A';
            }
        })
        .catch(error => {
            console.error("Error fetching username:", error);
            document.getElementById('user-id-display').textContent = 'User: N/A (Error)';
        });

});


// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // Initial UI setup
    showSection('rclone-transfer'); // Show Rclone Transfer section by default
    updateModeDescription(); // Set initial mode description
    toggleRemoteField(); // Set initial destination field visibility


    // Header scroll behavior
    window.addEventListener('scroll', handleScroll);


    // Listen for file input changes to display file name
    rcloneConfFileInput.addEventListener('change', (event) => {
        rcloneConfFileNameDisplay.textContent = event.target.files[0] ? event.target.files[0].name : 'No file chosen';
    });
    saZipFileInput.addEventListener('change', (event) => {
        saZipFileNameDisplay.textContent = event.target.files[0] ? event.target.files[0].name : 'No file chosen';
    });


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

    // Notepad auto-save
    notepadContent.addEventListener('input', saveNotepadContent);

    // Close modal on Escape key press
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
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

    // Initial load for notepad and recent commands once username is set
    // This is handled by the fetch('/get_username') success callback now.
    // If navigating directly to a section, load content immediately
    const initialSection = document.querySelector('.nav-button.active');
    if (initialSection) {
        const sectionId = initialSection.getAttribute('onclick').match(/'([^']+)'/)[1];
        if (sectionId === 'notepad') {
            loadNotepadContent();
        } else if (sectionId === 'recent-commands') {
            loadRecentCommands();
        }
    }
});
