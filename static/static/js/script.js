// DOM Elements
const majorStepsOutputElement = document.getElementById('majorStepsOutput'); // For upload/setup messages
const rcloneLiveOutputElement = document.getElementById('rcloneLiveOutput'); // For live Rclone transfer logs
const terminalOutputElement = document.getElementById('terminalOutput'); // For Web Terminal output
const setupSection = document.getElementById('setupSection');
const terminalSection = document.getElementById('terminalSection');
const recentCommandsModal = document.getElementById('recentCommandsModal');
const terminalCommandInput = document.getElementById('terminalCommandInput');
const modeSelect = document.getElementById('mode');
const modeDescription = document.getElementById('modeDescription');
const sourceInput = document.getElementById('source');
const destinationInput = document.getElementById('destination');
const sourceLabel = document.getElementById('sourceLabel');
const destinationField = document.getElementById('destinationField');
const lastSourceSpan = document.getElementById('lastSource');
const lastDestinationSpan = document.getElementById('lastDestination');
const terminalCommandHistoryDiv = document.getElementById('terminalCommandHistory');

// Spinner Elements
const rcloneSpinner = document.getElementById('rcloneSpinner');
const terminalSpinner = document.getElementById('terminalSpinner');

// Polling interval for terminal output
let terminalPollingInterval;
// Polling interval for Rclone live output (even if no transfer is running)
let rcloneLivePollingInterval;

// Rclone Mode Descriptions
const modeDescriptions = {
    "sync": "Make source and destination identical, modifying destination only.",
    "copy": "Copy files from source to destination.",
    "move": "Move files from source to destination (deleting from source after copy).",
    "purge": "Remove all content in the path, including the root directory itself. DANGEROUS.",
    "delete": "Remove files in the path. Does not delete directories.",
    "dedupe": "Remove duplicate files on the remote. Choose how to identify and which to keep.",
    "cleanup": "Clean up the remote (e.g., delete empty folders).",
    "checksum": "Check files checksums.",

    "lsd": "List directories/containers in the path.",
    "ls": "List all files in the path (including size and modification time).",
    "tree": "List contents of the remote in a tree-like fashion.",
    "serve": "serve - Serve a remote over HTTP/WebDAV/FTP/etc. (Advanced: Requires specific flags).",
    "mkdir": "Create new directory.",
    "listremotes": "List all the remotes in the config file."
};

const twoRemoteModes = ["sync", "copy", "move", "purge", "delete", "dedupe", "cleanup", "checksum"];


// --- Initialization on Load ---
document.addEventListener('DOMContentLoaded', () => {
    updateModeDescription(); // Set initial description
    toggleRemoteField();    // Set initial field visibility
    loadRecentCommands();   // Load commands from local storage
    startRcloneLivePolling(); // Start polling for Rclone live output
});

// --- UI Toggling Functions ---
function toggleSection(sectionId) {
    const sections = {
        'setupSection': setupSection,
        'terminalSection': terminalSection
    };

    for (const key in sections) {
        if (key === sectionId) {
            sections[key].classList.toggle('hidden');
        } else {
            sections[key].classList.add('hidden');
        }
    }

    // Manage terminal polling based on visibility
    if (sectionId === 'terminalSection' && !terminalSection.classList.contains('hidden')) {
        if (!terminalPollingInterval) {
            terminalPollingInterval = setInterval(getTerminalOutput, 500); // Poll every 0.5 second
        }
        terminalCommandInput.focus(); // Focus input field
    } else {
        clearInterval(terminalPollingInterval);
        terminalPollingInterval = null;
        hideTerminalSpinner(); // Hide spinner when terminal is hidden
    }
}

document.getElementById('setupBtn').addEventListener('click', () => toggleSection('setupSection'));
document.getElementById('terminalBtn').addEventListener('click', () => toggleSection('terminalSection'));

// --- Rclone Form & Mode Logic ---
function updateModeDescription() {
    const selectedMode = modeSelect.value;
    modeDescription.textContent = modeDescriptions[selectedMode] || "No description available for this mode.";
}

function toggleRemoteField() {
    const selectedMode = modeSelect.value;
    const isOneRemoteMode = !twoRemoteModes.includes(selectedMode);

    if (isOneRemoteMode) {
        // Change 'Source' label to 'Remote'
        sourceLabel.textContent = 'Remote:';
        // Hide Destination field
        destinationField.classList.add('hidden');
        // Copy source content to destination if user wants to keep it for later
        if (sourceInput.value && !destinationInput.value) {
            destinationInput.value = sourceInput.value;
        }
    } else {
        // Revert 'Source' label
        sourceLabel.textContent = 'Source:';
        // Show Destination field
        destinationField.classList.remove('hidden');
    }
}

// --- Spinner Control Functions ---
function showRcloneSpinner() {
    rcloneSpinner.classList.remove('hidden');
}

function hideRcloneSpinner() {
    rcloneSpinner.classList.add('hidden');
}

function showTerminalSpinner() {
    terminalSpinner.classList.remove('hidden');
}

function hideTerminalSpinner() {
    terminalSpinner.classList.add('hidden');
}


// --- Rclone Uploads & Transfer ---
async function uploadFile(fileInputId, endpoint) {
    const fileInput = document.getElementById(fileInputId);
    const file = fileInput.files[0];

    if (!file) {
        majorStepsOutputElement.textContent = 'Please select a file to upload.';
        majorStepsOutputElement.classList.remove('bg-green-600', 'bg-red-600');
        majorStepsOutputElement.classList.add('bg-yellow-600');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    majorStepsOutputElement.textContent = `Uploading ${file.name}...`;
    majorStepsOutputElement.classList.remove('bg-green-600', 'bg-red-600');
    majorStepsOutputElement.classList.add('bg-blue-600'); // Indicate processing

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        if (data.status === 'success') {
            majorStepsOutputElement.textContent = data.message;
            majorStepsOutputElement.classList.remove('bg-red-600', 'bg-blue-600', 'bg-yellow-600');
            majorStepsOutputElement.classList.add('bg-green-600');
        } else {
            majorStepsOutputElement.textContent = `Error: ${data.message}`;
            majorStepsOutputElement.classList.remove('bg-green-600', 'bg-blue-600', 'bg-yellow-600');
            majorStepsOutputElement.classList.add('bg-red-600');
        }
    } catch (error) {
        majorStepsOutputElement.textContent = `Network error: ${error}`;
        majorStepsOutputElement.classList.remove('bg-green-600', 'bg-blue-600', 'bg-yellow-600');
        majorStepsOutputElement.classList.add('bg-red-600');
    }
    fileInput.value = ''; // Clear file input
}

function uploadRcloneConf() {
    uploadFile('rcloneConfFile', '/upload-rclone-conf');
}

function uploadSaZip() {
    uploadFile('saZipFile', '/upload-sa-zip');
}

async function startRcloneTransfer() {
    showRcloneSpinner(); // Show spinner
    majorStepsOutputElement.textContent = 'Starting Rclone transfer...';
    majorStepsOutputElement.classList.remove('bg-green-600', 'bg-red-600');
    majorStepsOutputElement.classList.add('bg-blue-600');

    // Clear Rclone live output at the start of a new transfer
    rcloneLiveOutputElement.textContent = '';
    rcloneLiveOutputElement.classList.remove('text-red-400');
    rcloneLiveOutputElement.classList.add('text-green-400');

    const selectedMode = modeSelect.value;
    const isOneRemoteMode = !twoRemoteModes.includes(selectedMode);

    const payload = {
        source: sourceInput.value,
        destination: isOneRemoteMode ? '' : destinationInput.value, // Only send destination if it's a two-remote command
        mode: selectedMode,
        transfers: document.getElementById('transfers').value,
        checkers: document.getElementById('checkers').value,
        buffer_size: document.getElementById('buffer_size').value,
        order: document.getElementById('order').value,
        loglevel: document.getElementById('loglevel').value,
        additional_flags: document.getElementById('additional_flags').value,
        use_drive_trash: document.getElementById('use_drive_trash').checked,
        service_account: document.getElementById('service_account').checked,
        dry_run: document.getElementById('dry_run').checked
    };

    // Save last Rclone locations
    localStorage.setItem('lastRcloneSource', payload.source);
    localStorage.setItem('lastRcloneDestination', payload.destination);
    updateRecentCommandsModalContent(); // Update modal content

    try {
        const response = await fetch('/execute-rclone', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            majorStepsOutputElement.textContent = `Error: ${errorData.message}`;
            majorStepsOutputElement.classList.remove('bg-green-600', 'bg-blue-600');
            majorStepsOutputElement.classList.add('bg-red-600');
            rcloneLiveOutputElement.textContent = ''; // Clear live output if error from start
            hideRcloneSpinner(); // Hide spinner on error
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let lastNewlineIndex;

            // Process all complete JSON lines in the buffer
            while ((lastNewlineIndex = buffer.lastIndexOf('\n')) !== -1) {
                const line = buffer.substring(0, lastNewlineIndex);
                buffer = buffer.substring(lastNewlineIndex + 1);
                
                try {
                    const data = JSON.parse(line);
                    if (data.status === 'progress') {
                        rcloneLiveOutputElement.textContent = data.output; // Display buffered output
                        rcloneLiveOutputElement.scrollTop = rcloneLiveOutputElement.scrollHeight; // Scroll to bottom
                    } else {
                        // Final message (complete/error)
                        majorStepsOutputElement.textContent = data.message;
                        if (data.status === 'error') {
                            majorStepsOutputElement.classList.remove('bg-green-600', 'bg-blue-600');
                            majorStepsOutputElement.classList.add('bg-red-600');
                            rcloneLiveOutputElement.classList.remove('text-green-400');
                            rcloneLiveOutputElement.classList.add('text-red-400');
                        } else if (data.status === 'complete') {
                            majorStepsOutputElement.classList.remove('bg-red-600', 'bg-blue-600');
                            majorStepsOutputElement.classList.add('bg-green-600');
                            rcloneLiveOutputElement.classList.remove('text-red-400');
                            rcloneLiveOutputElement.classList.add('text-green-400');
                        }
                        if (data.output) { // Update with full final output
                            rcloneLiveOutputElement.textContent = data.output;
                            rcloneLiveOutputElement.scrollTop = rcloneLiveOutputElement.scrollHeight;
                        }
                    }
                } catch (e) {
                    // Handle incomplete JSON or non-JSON lines - often happens with streaming
                    console.warn("Failed to parse JSON line from Rclone output:", line, e);
                }
            }
        }
    } catch (error) {
        majorStepsOutputElement.textContent = `Network error during Rclone transfer: ${error}`;
        majorStepsOutputElement.classList.remove('bg-green-600', 'bg-blue-600');
        majorStepsOutputElement.classList.add('bg-red-600');
    } finally {
        hideRcloneSpinner(); // Ensure spinner is hidden when operation completes or errors
    }
}

function downloadLogs() {
    window.location.href = '/download-logs';
}

// --- Web Terminal Functions ---
async function executeTerminalCommand() {
    const command = terminalCommandInput.value.trim();
    if (!command) {
        terminalOutputElement.textContent += "\nNo command entered.\n";
        terminalOutputElement.scrollTop = terminalOutputElement.scrollHeight;
        return;
    }

    // Save command to local storage
    saveCommandToHistory(command);

    terminalCommandInput.value = ''; // Clear input immediately
    showTerminalSpinner(); // Show spinner

    try {
        const response = await fetch('/execute_terminal_command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: command })
        });
        const data = await response.json();
        if (data.status === 'error') {
            terminalOutputElement.textContent += `ERROR: ${data.output}\n`;
            terminalOutputElement.scrollTop = terminalOutputElement.scrollHeight;
            hideTerminalSpinner(); // Hide on immediate error
        }
        // Output will be updated by polling getTerminalOutput().
        // Spinner should remain active as long as polling is active and command is presumed running.
    } catch (error) {
        terminalOutputElement.textContent += `\nNetwork error: ${error}\n`;
        terminalOutputElement.scrollTop = terminalOutputElement.scrollHeight;
        hideTerminalSpinner(); // Hide on network error
    }
}

async function getTerminalOutput() {
    try {
        const response = await fetch('/get_terminal_output');
        const data = await response.json();
        if (data.output) {
            terminalOutputElement.textContent = data.output; // Replace content with the latest N lines
            terminalOutputElement.scrollTop = terminalOutputElement.scrollHeight;
            // Decide if spinner should be hidden here. If output is empty for a while, perhaps.
            // For now, it stays visible until manually stopped or a new command.
        } else {
            // If output is consistently empty, and there's no active process, maybe hide spinner
            // (This logic can be more complex, e.g., checking backend process status)
        }
    } catch (error) {
        console.error("Error polling terminal output:", error);
        // Do not hide spinner on simple polling error, might be temporary.
    }
}

async function stopTerminalProcess() {
    try {
        const response = await fetch('/stop_terminal_process', { method: 'POST' });
        const data = await response.json();
        terminalOutputElement.textContent += `\n--- ${data.message} ---\n`;
        terminalOutputElement.scrollTop = terminalOutputElement.scrollHeight;
        hideTerminalSpinner(); // Hide spinner when process is explicitly stopped
    } catch (error) {
        terminalOutputElement.textContent += `\nError stopping process: ${error}\n`;
        terminalOutputElement.scrollTop = terminalOutputElement.scrollHeight;
    }
}

function clearTerminalOutput() {
    terminalOutputElement.textContent = '';
    hideTerminalSpinner(); // Clear output usually means stopping perceived work too
}

// Handle Enter key in terminal input
terminalCommandInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault(); // Prevent default form submission
        executeTerminalCommand();
    }
});

// --- Recent Commands History ---
document.getElementById('recentCommandsBtn').addEventListener('click', () => {
    updateRecentCommandsModalContent();
    recentCommandsModal.classList.remove('hidden');
});

function closeRecentCommandsModal() {
    recentCommandsModal.classList.add('hidden');
}

function saveCommandToHistory(command) {
    let history = JSON.parse(localStorage.getItem('terminalCommandHistory') || '[]');
    history.push(command);
    // Optional: Limit history size, e.g., to 50 commands
    if (history.length > 50) {
        history = history.slice(history.length - 50);
    }
    localStorage.setItem('terminalCommandHistory', JSON.stringify(history));
}

function loadRecentCommands() {
    updateRecentCommandsModalContent();
}

function updateRecentCommandsModalContent() {
    // Update Rclone locations
    const lastSource = localStorage.getItem('lastRcloneSource') || 'N/A';
    const lastDestination = localStorage.getItem('lastRcloneDestination') || 'N/A';
    lastSourceSpan.textContent = lastSource;
    lastDestinationSpan.textContent = lastDestination;

    // Update Terminal Command History
    let history = JSON.parse(localStorage.getItem('terminalCommandHistory') || '[]');
    terminalCommandHistoryDiv.innerHTML = ''; // Clear previous content
    if (history.length === 0) {
        terminalCommandHistoryDiv.innerHTML = '<p class="text-gray-400">No commands yet.</p>';
    } else {
        history.forEach((cmd, index) => {
            const p = document.createElement('p');
            p.classList.add('bg-gray-700', 'p-3', 'rounded-lg', 'mb-2', 'text-sm', 'font-mono', 'break-all', 'text-gray-300');
            p.textContent = `${index + 1}. ${cmd}`;
            terminalCommandHistoryDiv.appendChild(p);
        });
    }
}

// --- Logout Function ---
function logout() {
    window.location.href = '/logout';
}

// --- Rclone Live Output Polling (for transfer progress, runs always) ---
async function getRcloneLiveOutput() {
    try {
        const response = await fetch('/get_rclone_live_output');
        const data = await response.json();
        if (data.output) {
            rcloneLiveOutputElement.textContent = data.output;
            rcloneLiveOutputElement.scrollTop = rcloneLiveOutputElement.scrollHeight;
        }
    } catch (error) {
        console.error("Error polling Rclone live output:", error);
    }
}

function startRcloneLivePolling() {
    if (!rcloneLivePollingInterval) {
        rcloneLivePollingInterval = setInterval(getRcloneLiveOutput, 1000); // Poll every 1 second
    }
}
