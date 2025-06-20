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
const rcloneSpinner = document.getElementById('rclone-spinner'); // Spinner overlay
const rcloneSpinnerText = document.getElementById('rclone-spinner-text'); // Text for spinner overlay
const rcloneHeaderSpinner = document.getElementById('rclone-header-spinner'); // Spinner next to tab heading
const rcloneHeaderSpinnerTxt = document.getElementById('rclone-header-spinner-text'); // Text for spinner next to tab heading

const rcloneConfFileInput = document.getElementById('rclone_conf_file_input');
const rcloneConfFileNameDisplay = document.getElementById('rclone-conf-file-name');
const saZipFileInput = document.getElementById('sa_zip_file_input');
const saZipFileNameDisplay = document.getElementById('sa-zip-file-name');
const majorStepsOutput = document.getElementById('majorStepsOutput'); // This is also used for setup section messages

const terminalCommandInput = document.getElementById('terminalCommand');
const executeTerminalBtn = document.getElementById('execute-terminal-btn');
const stopTerminalBtn = document.getElementById('stop-terminal-btn');
const terminalOutput = document.getElementById('terminalOutput');
const terminalSpinner = document.getElementById('terminal-spinner'); // Spinner overlay
const terminalSpinnerText = document.getElementById('terminal-spinner-text'); // Text for spinner overlay
const terminalHeaderSpinner = document.getElementById('terminal-header-spinner'); // Spinner next to tab heading
const terminalHeaderSpinnerTxt = document.getElementById('terminal-header-spinner-text'); // Text for spinner next to tab heading

const terminalConfirmModal = document.getElementById('terminalConfirmModal');
const terminalConfirmMessage = document.getElementById('terminalConfirmMessage');
const confirmStopAndStartBtn = document.getElementById('confirmStopAndStartBtn');
const cancelStopAndStartBtn = document.getElementById('cancelStopAndStartBtn');

const recentRcloneTransfersDiv = document.getElementById('recentRcloneTransfers');
const recentTerminalCommandsDiv = document.getElementById('recentTerminalCommands');

const notepadContent = document.getElementById('notepad-content');


// --- Global State Variables ---
let rclonePollingInterval = null; // No longer needed for Rclone, streaming now
let terminalPollingInterval = null; // Still needed for terminal polling
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
    "delete": "Remove files in the path.",
    "deletefile": "Remove a single file from remote.",
    "purge": "Remove all content in the path.",
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

    // Manage polling based on active section
    if (sectionId === 'web-terminal') {
        startTerminalPolling();
    } else {
        stopTerminalPolling();
    }

    // Load notepad content if switching to notepad section
    if (sectionId === 'notepad') {
        loadNotepadContent();
    } else if (sectionId === 'recent-commands') {
        loadRecentCommands(); // Reload recent commands when its tab is opened
    }
    // Rclone polling runs independently, as it can be active in background
}

function showRcloneSpinner(message = "Transferring...") {
    rcloneSpinnerText.textContent = message; // Overlay spinner text
    rcloneSpinner.classList.remove('hidden'); // Overlay spinner

    rcloneHeaderSpinnerTxt.textContent = message; // Header spinner text
    rcloneHeaderSpinner.classList.remove('hidden'); // Header spinner
}

function hideRcloneSpinner() {
    rcloneSpinner.classList.add('hidden'); // Overlay spinner
    rcloneHeaderSpinner.classList.add('hidden'); // Header spinner
}

function showTerminalSpinner(message = "Executing command...") {
    terminalSpinnerText.textContent = message; // Overlay spinner text
    terminalSpinner.classList.remove('hidden'); // Overlay spinner

    terminalHeaderSpinnerTxt.textContent = message; // Header spinner text
    terminalHeaderSpinner.classList.remove('hidden'); // Header spinner
}

function hideTerminalSpinner() {
    terminalSpinner.classList.add('hidden'); // Overlay spinner
    terminalHeaderSpinner.classList.add('hidden'); // Header spinner
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
        dry_run: dryRunCheckbox.checked,
        serve_protocol: serveProtocol
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
                        rcloneLiveOutput.textContent = data.output; // Display full accumulated output
                        appendOutput(rcloneLiveOutput, '', 'no-newline'); // Ensure scroll to bottom with last append
                        saveRcloneTransferToHistory(mode, source, destination, 'Success');
                    } else if (data.status === 'error') {
                        logMessage(rcloneMajorStepsOutput, `Error: ${data.message}`, 'error');
                        appendOutput(rcloneLiveOutput, '\n--- Rclone Command Finished (Error) ---\n');
                        rcloneLiveOutput.textContent = data.output; // Display full accumulated output
                        appendOutput(rcloneLiveOutput, '', 'no-newline'); // Ensure scroll to bottom with last append
                        saveRcloneTransferToHistory(mode, source, destination, 'Failed');
                    } else if (data.status === 'stopped') {
                        logMessage(rcloneMajorStepsOutput, data.message, 'info');
                        appendOutput(rcloneLiveOutput, '\n--- Rclone Command Stopped by User ---\n');
                        appendOutput(rcloneLiveOutput, data.output, 'info'); // Display final accumulated output
                        saveRcloneTransferToHistory(mode, source, destination, 'Stopped');
                    }
                } catch (parseError) {
                    // console.warn('Could not parse JSON line:', line, parseError);
                    // This might happen with partial lines or non-JSON data, just ignore and wait for more data
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
        // Process any remaining buffer content as the final message
        if (buffer.trim()) {
             try {
                const data = JSON.parse(buffer.trim());
                if (data.status === 'complete') {
                    logMessage(rcloneMajorStepsOutput, data.message, 'success');
                    appendOutput(rcloneLiveOutput, '\n--- Rclone Command Finished (Success) ---\n');
                    rcloneLiveOutput.textContent = data.output;
                    appendOutput(rcloneLiveOutput, '', 'no-newline');
                    saveRcloneTransferToHistory(mode, source, destination, 'Success');
                } else if (data.status === 'error') {
                    logMessage(rcloneMajorStepsOutput, `Error: ${data.message}`, 'error');
                    appendOutput(rcloneLiveOutput, '\n--- Rclone Command Finished (Error) ---\n');
                    rcloneLiveOutput.textContent = data.output;
                    appendOutput(rcloneLiveOutput, '', 'no-newline');
                    saveRcloneTransferToHistory(mode, source, destination, 'Failed');
                } else if (data.status === 'stopped') {
                    logMessage(rcloneMajorStepsOutput, data.message, 'info');
                    appendOutput(rcloneLiveOutput, '\n--- Rclone Command Stopped by User ---\n');
                    appendOutput(rcloneLiveOutput, data.output, 'info');
                    saveRcloneTransferToHistory(mode, source, destination, 'Stopped');
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
    // Append directly to textContent for performance, only add newline if needed
    if (status === 'no-newline') { // Special case for last line to ensure scroll
        element.scrollTop = element.scrollHeight;
        return;
    }
    const coloredText = getColoredText(text, status);
    element.innerHTML += coloredText + '\n';
    element.scrollTop = element.scrollHeight; // Auto-scroll to bottom
}

function getColoredText(text, status) {
    let color = '';
    if (status === 'success') color = 'var(--success-color)';
    if (status === 'error') color = 'var(--error-color)';
    if (status === 'warning') color = 'var(--warning-color)';
    if (status === 'info') color = 'var(--info-color)';
    if (color) {
        return `<span style="color: ${color}">${escapeHtml(text)}</span>`;
    }
    return escapeHtml(text);
}


function logMessage(element, message, type = 'info') {
    const msgElement = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    msgElement.innerHTML = `<span class="${type}">[${timestamp}] ${escapeHtml(message)}</span>`; // Use innerHTML to allow for styling via span
    element.appendChild(msgElement);
    element.scrollTop = element.scrollHeight;
}

function clearRcloneOutput() {
    rcloneLiveOutput.textContent = '';
    rcloneMajorStepsOutput.innerHTML = '';
    rcloneMajorStepsOutput.style.display = 'none';
    logMessage(rcloneMajorStepsOutput, "Rclone output cleared.", 'info'); // Log to major steps output
}

// --- Log Download ---
async function downloadLogs() {
    try {
        const response = await fetch('/download-rclone-log');
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            // Get filename from Content-Disposition header if available, otherwise default
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
            // terminalCommandInput.value = ''; // DO NOT CLEAR INPUT FIELD
        } else if (result.status === 'warning' && result.message.includes("already running")) {
            // Show confirmation modal
            terminalConfirmMessage.innerHTML = `A command is currently running: <code class="bg-input-bg-color p-1 rounded-md text-sm">${escapeHtml(result.running_command)}</code>. Do you want to stop it and start a new one?`;
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

    // Add event listeners for copy buttons (must be done after content is loaded)
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
    // Replaced confirm with a custom modal if needed, but for simplicity, keeping this as is for now.
    // In a full production app, this would be a custom modal/dialog.
    if (confirm("Are you sure you want to clear all recent commands and transfers history? This cannot be undone.")) {
        localStorage.removeItem('terminalCommands');
        localStorage.removeItem('rcloneTransfers');
        loadRecentCommands(); // Reload to show empty state
        logMessage(majorStepsOutput, "All recent commands and transfers history cleared.", 'info');
    }
}

// --- Notepad Logic ---
function saveNotepadContent() {
    localStorage.setItem('notepadContent', notepadContent.value);
}

function loadNotepadContent() {
    notepadContent.value = localStorage.getItem('notepadContent') || '';
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
            document.body.className = theme; // Set the class on the body
            localStorage.setItem('theme', theme); // Save theme preference
            themeDropdown.classList.add('hidden'); // Hide dropdown after selection
        });
    });

    // Load saved theme on initial page load - Moved to <head> for login.html to prevent flash
    // For index.html, this will still apply on DOMContentLoaded
    const savedTheme = localStorage.getItem('theme') || 'dark-mode'; // Default to dark-mode
    document.body.className = savedTheme;
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

    cancelStopAndAndStartBtn.addEventListener('click', () => {
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

    // Event listener for Recent Commands tab to load content when clicked
    document.querySelector('.nav-button[onclick*="recent-commands"]').addEventListener('click', loadRecentCommands);
});
