// --- DOM Element References ---
const setupSection = document.getElementById('setup-section');
const rcloneTransferSection = document.getElementById('rclone-transfer-section');
const webTerminalSection = document.getElementById('web-terminal-section');
const recentCommandsSection = document.getElementById('recent-commands-section'); // New tab
const notepadSection = document.getElementById('notepad-section'); // New tab

const navButtons = document.querySelectorAll('.nav-button');

const modeSelect = document.getElementById('mode');
const modeDescription = document.getElementById('mode-description');
const sourceField = document.getElementById('source-field'); // Get the div containing source input
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
const executeRcloneBtn = document.getElementById('executeRcloneBtn');
const stopRcloneBtn = document.getElementById('stopRcloneBtn');
const rcloneOutput = document.getElementById('rclone-output-area');
const rcloneStatusMessage = document.getElementById('rclone-status-message');
const clearOutputBtn = document.getElementById('clearOutputBtn');
const downloadLogsBtn = document.getElementById('downloadLogsBtn');

const uploadRcloneConfBtn = document.getElementById('upload_rclone_conf_btn');
const rcloneConfUploadInput = document.getElementById('rclone_conf_upload');
const rcloneConfStatus = document.getElementById('rclone_conf_status');

const uploadSaZipBtn = document.getElementById('upload_sa_zip_btn');
const saZipUploadInput = document.getElementById('sa_zip_upload');
const saZipStatus = document.getElementById('sa_zip_status');

const terminalCommandInput = document.getElementById('terminalCommandInput');
const executeTerminalBtn = document.getElementById('executeTerminalBtn');
const stopTerminalBtn = document.getElementById('stopTerminalBtn');
const terminalOutputArea = document.getElementById('terminal-output-area');
const terminalStatusMessage = document.getElementById('terminal-status-message');
const terminalSpinner = document.getElementById('terminal-spinner');
const clearTerminalOutputBtn = document.getElementById('clearTerminalOutputBtn');
const downloadTerminalLogBtn = document.getElementById('downloadTerminalLogBtn'); // New button

const notepadContent = document.getElementById('notepad-content');

const themeSwitcherBtn = document.getElementById('theme-switcher-btn');
const themeSwitcherDropdown = document.getElementById('theme-switcher-dropdown');
const themeOptions = document.querySelectorAll('.theme-option');

const terminalConfirmModal = document.getElementById('terminalConfirmModal');
const confirmStopAndStartBtn = document.getElementById('confirmStopAndStartBtn');
const cancelStopAndStartBtn = document.getElementById('cancelStopAndStartBtn');
const terminalConfirmMessage = document.getElementById('terminalConfirmMessage');

// New elements for copyurl and serve modes
const urlField = document.getElementById('url-field');
const urlInput = document.getElementById('url');
const serveProtocolField = document.getElementById('serve-protocol-field');
const serveProtocolSelect = document.getElementById('serve_protocol');


// --- Global State Variables ---
let currentRcloneProcess = null;
let isTerminalProcessRunning = false;
let terminalOutputInterval = null;
let pendingTerminalCommand = null;

// --- Utility Functions ---

function showSpinner(spinnerElement) {
    spinnerElement.classList.remove('hidden');
}

function hideSpinner(spinnerElement) {
    spinnerElement.classList.add('hidden');
}

function updateStatusMessage(element, message, type) {
    element.textContent = message;
    element.className = 'mt-3 text-center font-bold'; // Reset classes
    if (type === 'success') {
        element.classList.add('text-success-color');
    } else if (type === 'error') {
        element.classList.add('text-error-color');
    } else if (type === 'info') {
        element.classList.add('text-info-color');
    } else if (type === 'warning') {
        element.classList.add('text-warning-color');
    } else {
        element.classList.add('text-text-color'); // Default
    }
}

// Function to handle section visibility with fade effect
function showSection(sectionId) {
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => {
        if (section.id === sectionId) {
            // Fade in new section
            section.style.display = 'block'; // Make it visible for animation
            // Use a slight delay to allow display property to take effect before transition
            setTimeout(() => {
                section.classList.remove('fade-out');
                section.classList.add('fade-in');
            }, 10);
        } else {
            // Fade out old section
            section.classList.remove('fade-in');
            section.classList.add('fade-out');
            // Hide completely after transition
            setTimeout(() => {
                section.style.display = 'none';
            }, 500); // Match CSS transition duration
        }
    });
}


// --- Theme Switching ---
function applyTheme(themeName) {
    document.documentElement.className = themeName; // Apply to html tag
    localStorage.setItem('theme', themeName);
}

// --- Rclone Operations ---

async function executeRcloneCommand() {
    executeRcloneBtn.disabled = true;
    stopRcloneBtn.classList.remove('hidden');
    rcloneOutput.textContent = 'Executing Rclone command...';
    updateStatusMessage(rcloneStatusMessage, 'Starting...', 'info');

    const payload = {
        mode: modeSelect.value,
        source: sourceInput.value,
        destination: destinationInput.value,
        transfers: transfersInput.value,
        checkers: checkersInput.value,
        buffer_size: bufferSizeSelect.value,
        order: orderSelect.value,
        loglevel: loglevelSelect.value,
        additional_flags: additionalFlagsInput.value,
        use_drive_trash: useDriveTrashCheckbox.checked,
        service_account: serviceAccountCheckbox.checked,
        dry_run: dryRunCheckbox.checked
    };

    // Add specific fields for copyurl and serve
    if (modeSelect.value === 'copyurl') {
        payload.url_field = urlInput.value;
    }
    if (modeSelect.value === 'serve') {
        payload.serve_protocol = serveProtocolSelect.value;
    }

    try {
        const response = await fetch('/execute-rclone', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            updateStatusMessage(rcloneStatusMessage, `Error: ${errorData.message}`, 'error');
            rcloneOutput.textContent += `\nError: ${errorData.message}`;
            executeRcloneBtn.disabled = false;
            stopRcloneBtn.classList.add('hidden');
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // Keep the last incomplete line in buffer

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const data = JSON.parse(line);
                        if (data.status === 'progress') {
                            rcloneOutput.textContent += data.output + '\n';
                            rcloneOutput.scrollTop = rcloneOutput.scrollHeight; // Auto-scroll
                        } else if (data.status === 'complete' || data.status === 'error' || data.status === 'stopped') {
                            updateStatusMessage(rcloneStatusMessage, data.message, data.status === 'error' ? 'error' : (data.status === 'stopped' ? 'warning' : 'success'));
                            rcloneOutput.textContent += '\n' + data.output + '\n'; // Add final output
                            rcloneOutput.scrollTop = rcloneOutput.scrollHeight;
                            reader.cancel(); // Stop reading
                            break;
                        }
                    } catch (e) {
                        console.error('Failed to parse line as JSON:', line, e);
                        rcloneOutput.textContent += line + '\n'; // Add raw line if not JSON
                        rcloneOutput.scrollTop = rcloneOutput.scrollHeight;
                    }
                }
            }
        }
    } catch (error) {
        console.error('Fetch error:', error);
        updateStatusMessage(rcloneStatusMessage, `Connection error: ${error.message}`, 'error');
        rcloneOutput.textContent += `\nConnection error: ${error.message}`;
    } finally {
        executeRcloneBtn.disabled = false;
        stopRcloneBtn.classList.add('hidden');
    }
}

async function stopRcloneProcess() {
    updateStatusMessage(rcloneStatusMessage, 'Stopping Rclone process...', 'info');
    try {
        const response = await fetch('/stop-rclone-process', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await response.json();
        updateStatusMessage(rcloneStatusMessage, data.message, data.status);
    } catch (error) {
        console.error('Error stopping rclone process:', error);
        updateStatusMessage(rcloneStatusMessage, `Error stopping process: ${error.message}`, 'error');
    } finally {
        executeRcloneBtn.disabled = false;
        stopRcloneBtn.classList.add('hidden');
    }
}

async function uploadFile(fileInput, statusElement, uploadUrl) {
    const file = fileInput.files[0];
    if (!file) {
        updateStatusMessage(statusElement, 'Please select a file first.', 'error');
        return;
    }

    const formData = new FormData();
    formData.append(fileInput.name, file);

    updateStatusMessage(statusElement, 'Uploading...', 'info');

    try {
        const response = await fetch(uploadUrl, {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        updateStatusMessage(statusElement, data.message, data.status);
    } catch (error) {
        console.error('Upload error:', error);
        updateStatusMessage(statusElement, `Upload failed: ${error.message}`, 'error');
    }
}

// --- Web Terminal Operations ---

async function executeTerminalCommandLogic(command) {
    showSpinner(terminalSpinner);
    executeTerminalBtn.classList.add('hidden');
    stopTerminalBtn.classList.remove('hidden');
    isTerminalProcessRunning = true;
    terminalOutputArea.textContent = `Executing: ${command}\n`; // Clear and show new command
    updateStatusMessage(terminalStatusMessage, 'Command started...', 'info');

    try {
        const response = await fetch('/execute_terminal_command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: command })
        });
        const data = await response.json();
        if (data.status === 'success') {
            updateStatusMessage(terminalStatusMessage, data.message, data.status);
            // Start polling for output
            if (terminalOutputInterval) clearInterval(terminalOutputInterval);
            terminalOutputInterval = setInterval(getTerminalOutput, 1000); // Poll every 1 second
        } else if (data.status === 'warning' && data.message.includes("already running")) {
            // Show confirmation modal
            terminalConfirmModal.classList.remove('hidden');
            terminalConfirmMessage.querySelector('code').textContent = data.running_command;
            pendingTerminalCommand = command; // Store command for later execution
            hideSpinner(terminalSpinner);
            executeTerminalBtn.classList.remove('hidden');
            stopTerminalBtn.classList.add('hidden'); // Ensure stop button is hidden with modal
        } else {
            updateStatusMessage(terminalStatusMessage, `Error: ${data.message}`, 'error');
            hideSpinner(terminalSpinner);
            executeTerminalBtn.classList.remove('hidden');
            stopTerminalBtn.classList.add('hidden');
            isTerminalProcessRunning = false;
            if (terminalOutputInterval) clearInterval(terminalOutputInterval);
        }
    } catch (error) {
        console.error('Error executing terminal command:', error);
        updateStatusMessage(terminalStatusMessage, `Network error: ${error.message}`, 'error');
        hideSpinner(terminalSpinner);
        executeTerminalBtn.classList.remove('hidden');
        stopTerminalBtn.classList.add('hidden');
        isTerminalProcessRunning = false;
        if (terminalOutputInterval) clearInterval(terminalOutputInterval);
    }
}

async function getTerminalOutput() {
    try {
        const response = await fetch('/get_terminal_output');
        const data = await response.json();
        terminalOutputArea.textContent = data.output;
        terminalOutputArea.scrollTop = terminalOutputArea.scrollHeight; // Auto-scroll
        if (!data.is_running) {
            updateStatusMessage(terminalStatusMessage, 'Command finished.', 'success');
            hideSpinner(terminalSpinner);
            executeTerminalBtn.classList.remove('hidden');
            stopTerminalBtn.classList.add('hidden');
            isTerminalProcessRunning = false;
            if (terminalOutputInterval) clearInterval(terminalOutputInterval);
        }
    } catch (error) {
        console.error('Error fetching terminal output:', error);
        updateStatusMessage(terminalStatusMessage, `Error fetching output: ${error.message}`, 'error');
        hideSpinner(terminalSpinner);
        executeTerminalBtn.classList.remove('hidden');
        stopTerminalBtn.classList.add('hidden');
        isTerminalProcessRunning = false;
        if (terminalOutputInterval) clearInterval(terminalOutputInterval);
    }
}

async function stopTerminalProcess() {
    updateStatusMessage(terminalStatusMessage, 'Stopping terminal process...', 'info');
    showSpinner(terminalSpinner);
    try {
        const response = await fetch('/stop_terminal_process', { method: 'POST' });
        const data = await response.json();
        updateStatusMessage(terminalStatusMessage, data.message, data.status);
        if (terminalOutputInterval) clearInterval(terminalOutputInterval);
    } catch (error) {
        console.error('Error stopping terminal process:', error);
        updateStatusMessage(terminalStatusMessage, `Error stopping process: ${error.message}`, 'error');
    } finally {
        hideSpinner(terminalSpinner);
        executeTerminalBtn.classList.remove('hidden');
        stopTerminalBtn.classList.add('hidden');
        isTerminalProcessRunning = false;
        if (terminalOutputInterval) clearInterval(terminalOutputInterval); // Ensure cleared
    }
}

// --- Recent Commands ---
function saveRecentCommand(command) {
    let recentCommands = JSON.parse(localStorage.getItem('recentCommands')) || [];
    // Add only if not the same as the last command
    if (recentCommands.length === 0 || recentCommands[recentCommands.length - 1] !== command) {
        recentCommands.push(command);
        if (recentCommands.length > 10) { // Keep last 10 commands
            recentCommands = recentCommands.slice(-10);
        }
        localStorage.setItem('recentCommands', JSON.stringify(recentCommands));
    }
}

function loadRecentCommands() {
    const recentCommandsList = document.getElementById('recent-commands-list');
    let recentCommands = JSON.parse(localStorage.getItem('recentCommands')) || [];
    recentCommandsList.innerHTML = ''; // Clear existing list

    if (recentCommands.length === 0) {
        recentCommandsList.innerHTML = '<p class="text-text-color">No recent commands. Commands executed in the Web Terminal will appear here.</p>';
        return;
    }

    recentCommands.reverse().forEach((command, index) => { // Show most recent first
        const commandElement = document.createElement('div');
        commandElement.className = 'bg-input-bg-color p-3 rounded-lg flex items-center justify-between shadow-sm';
        commandElement.innerHTML = `
            <code class="text-text-color text-sm font-mono flex-grow mr-4 break-all">${command}</code>
            <button class="btn-secondary px-3 py-1 text-sm rounded-lg replay-command-btn" data-command="${command}">
                <i class="fas fa-redo mr-2"></i> Replay
            </button>
        `;
        recentCommandsList.appendChild(commandElement);
    });

    // Add event listeners to replay buttons
    document.querySelectorAll('.replay-command-btn').forEach(button => {
        button.addEventListener('click', (event) => {
            const commandToReplay = event.currentTarget.dataset.command;
            terminalCommandInput.value = commandToReplay; // Put command in input
            showSection('web-terminal-section'); // Switch to terminal tab
            terminalCommandInput.focus(); // Focus input
            // Optionally, auto-execute: executeTerminalCommandLogic(commandToReplay);
        });
    });
}

// --- Notepad ---
function saveNotepadContent() {
    localStorage.setItem('notepadContent', notepadContent.value);
}

function loadNotepadContent() {
    notepadContent.value = localStorage.getItem('notepadContent') || '';
}


// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    // Set initial active nav button and show default section
    const initialSectionId = 'setup-section';
    const initialNavButton = document.querySelector(`.nav-button[data-target="${initialSectionId}"]`);
    if (initialNavButton) {
        initialNavButton.classList.add('active-nav-button');
    }
    showSection(initialSectionId); // Show initial section with fade-in

    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            navButtons.forEach(btn => btn.classList.remove('active-nav-button'));
            button.classList.add('active-nav-button');
            showSection(button.dataset.target);

            // Special handling for recent commands to load them when tab is clicked
            if (button.dataset.target === 'recent-commands-section') {
                loadRecentCommands();
            }
            // Special handling for notepad to load content when tab is clicked
            if (button.dataset.target === 'notepad-section') {
                loadNotepadContent();
            }
        });
    });

    // Rclone Form Submission
    document.getElementById('rclone-transfer-form').addEventListener('submit', (e) => {
        e.preventDefault();
        executeRcloneCommand();
    });

    stopRcloneBtn.addEventListener('click', stopRcloneProcess);

    // File Uploads
    rcloneConfUploadInput.addEventListener('change', () => {
        if (rcloneConfUploadInput.files.length > 0) {
            rcloneConfStatus.textContent = `File selected: ${rcloneConfUploadInput.files[0].name}`;
            rcloneConfStatus.className = 'mt-3 text-sm text-center text-info-color';
        } else {
            rcloneConfStatus.textContent = '';
        }
    });
    uploadRcloneConfBtn.addEventListener('click', () => uploadFile(rcloneConfUploadInput, rcloneConfStatus, '/upload-rclone-conf'));

    saZipUploadInput.addEventListener('change', () => {
        if (saZipUploadInput.files.length > 0) {
            saZipStatus.textContent = `File selected: ${saZipUploadInput.files[0].name}`;
            saZipStatus.className = 'mt-3 text-sm text-center text-info-color';
        } else {
            saZipStatus.textContent = '';
        }
    });
    uploadSaZipBtn.addEventListener('click', () => uploadFile(saZipUploadInput, saZipStatus, '/upload-sa-zip'));


    // Rclone Range Input Value Display
    transfersInput.addEventListener('input', () => {
        transfersValueSpan.textContent = transfersInput.value;
    });
    checkersInput.addEventListener('input', () => {
        checkersValueSpan.textContent = checkersInput.value;
    });

    // Clear Rclone Output
    if (clearOutputBtn) {
        clearOutputBtn.addEventListener('click', () => {
            rcloneOutput.textContent = ''; // Clear the Rclone output textarea
            updateStatusMessage(rcloneStatusMessage, 'Output cleared.', 'info');
        });
    }

    // Download Rclone Logs
    if (downloadLogsBtn) {
        downloadLogsBtn.addEventListener('click', () => {
            window.location.href = '/download-logs';
        });
    }

    // --- Web Terminal Event Listeners ---
    executeTerminalBtn.addEventListener('click', () => {
        const command = terminalCommandInput.value.trim();
        if (command) {
            executeTerminalCommandLogic(command);
            saveRecentCommand(command); // Save command to recent list
        } else {
            updateStatusMessage(terminalStatusMessage, 'Please enter a command.', 'error');
        }
    });

    terminalCommandInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            executeTerminalBtn.click();
        }
    });

    stopTerminalBtn.addEventListener('click', stopTerminalProcess);

    clearTerminalOutputBtn.addEventListener('click', () => {
        terminalOutputArea.textContent = '';
        updateStatusMessage(terminalStatusMessage, 'Terminal output cleared.', 'info');
    });

    downloadTerminalLogBtn.addEventListener('click', () => {
        window.location.href = '/download-terminal-log';
    });


    // --- Theme Switcher Dropdown Logic ---
    themeSwitcherBtn.addEventListener('click', (event) => {
        event.stopPropagation(); // Prevent click from immediately closing it
        themeSwitcherDropdown.classList.toggle('hidden');
    });

    themeOptions.forEach(option => {
        option.addEventListener('click', (event) => {
            event.preventDefault();
            const theme = event.target.dataset.theme;
            applyTheme(theme);
            themeSwitcherDropdown.classList.add('hidden'); // Hide after selection
        });
    });

    // Close dropdown if clicked outside
    document.addEventListener('click', (event) => {
        if (!themeSwitcherDropdown.contains(event.target) && !themeSwitcherBtn.contains(event.target)) {
            themeSwitcherDropdown.classList.add('hidden');
        }
    });

    // --- Terminal Confirmation Modal Logic ---
    confirmStopAndStartBtn.addEventListener('click', async () => {
        terminalConfirmModal.classList.add('hidden');
        await stopTerminalProcess(); // Ensure current process is stopped
        if (pendingTerminalCommand) {
            executeTerminalCommandLogic(pendingTerminalCommand); // Execute the new command
            pendingTerminalCommand = null;
        }
    });

    cancelStopAndStartBtn.addEventListener('click', () => {
        terminalConfirmModal.classList.add('hidden');
        pendingTerminalCommand = null; // Clear pending command
        hideSpinner(terminalSpinner);
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
                hideSpinner(terminalSpinner);
                isTerminalProcessRunning = false; // Reset state if cancelled
                executeTerminalBtn.classList.remove('hidden');
                stopTerminalBtn.classList.add('hidden');
            }
        }
    });

    // Event listener for Recent Commands tab to load content when clicked
    document.querySelector('.nav-button[data-target*="recent-commands"]').addEventListener('click', loadRecentCommands);
    // Event listener for Notepad tab to load content when clicked
    document.querySelector('.nav-button[data-target*="notepad-section"]').addEventListener('click', loadNotepadContent);


    // --- Dynamic Rclone Mode Field Visibility ---
    modeSelect.addEventListener('change', () => {
        const selectedMode = modeSelect.value;

        // Reset all fields and descriptions
        sourceField.style.display = 'block';
        sourceInput.required = true;
        sourceInput.placeholder = "e.g., remote:path/to/source or /local/path";
        document.querySelector('#source-field label').textContent = "Source:";

        destinationField.style.display = 'block';
        destinationInput.required = false; // Only required for two-remote, will re-enable below
        destinationInput.placeholder = "e.g., remote:path/to/destination";
        document.querySelector('#destination-field label').textContent = "Destination:";

        urlField.style.display = 'none';
        urlInput.required = false;
        serveProtocolField.style.display = 'none';
        serveProtocolSelect.required = false;

        // Hide/show transfers, checkers, buffer_size, order, use_drive_trash, service_account, dry_run fields by default
        // Then enable for specific modes
        transfersInput.closest('.form-group').style.display = 'none';
        checkersInput.closest('.form-group').style.display = 'none';
        bufferSizeSelect.closest('.form-group').style.display = 'none';
        orderSelect.closest('.form-group').style.display = 'none';
        useDriveTrashCheckbox.closest('.form-group').style.display = 'none';
        serviceAccountCheckbox.closest('.form-group').style.display = 'none';
        dryRunCheckbox.closest('.form-group').style.display = 'none';

        // Update mode description (this element already exists)
        let description = '';

        switch (selectedMode) {
            case 'sync':
                description = 'Synchronize source to destination, changing the destination only.';
                enableCommonOptions();
                destinationInput.required = true;
                break;
            case 'copy':
                description = 'Copy files from source to destination.';
                enableCommonOptions();
                destinationInput.required = true;
                break;
            case 'move':
                description = 'Move files from source to destination.';
                enableCommonOptions();
                destinationInput.required = true;
                break;
            case 'copyurl':
                description = 'Copy a URL content to destination.';
                sourceField.style.display = 'none'; // Hide source field
                urlField.style.display = 'block'; // Show URL field
                urlInput.required = true;
                destinationInput.required = true; // Destination is required
                enableCommonOptions(true); // Enable basic common options for copyurl
                break;
            case 'check':
                description = 'Checks the files in the source and destination match.';
                enableCommonOptions();
                destinationInput.required = true;
                break;
            case 'cryptcheck':
                description = 'Cryptcheck checks the integrity of a crypted remote.';
                enableCommonOptions();
                destinationInput.required = true;
                break;
            case 'lsd':
                description = 'List directories in the source.';
                sourceInput.placeholder = "e.g., remote:";
                // Specific options for lsd
                serviceAccountCheckbox.closest('.form-group').style.display = 'block';
                break;
            case 'ls':
                description = 'List all files and objects in the source.';
                sourceInput.placeholder = "e.g., remote:path";
                // Specific options for ls
                serviceAccountCheckbox.closest('.form-group').style.display = 'block';
                break;
            case 'tree':
                description = 'List contents of the remote in a tree like fashion.';
                sourceInput.placeholder = "e.g., remote:path";
                serviceAccountCheckbox.closest('.form-group').style.display = 'block';
                break;
            case 'listremotes':
                description = 'List all configured remotes.';
                sourceField.style.display = 'none';
                destinationField.style.display = 'none';
                sourceInput.required = false;
                destinationInput.required = false;
                break;
            case 'mkdir':
                description = 'Make a new directory in the source.';
                sourceInput.placeholder = "e.g., remote:new_folder";
                serviceAccountCheckbox.closest('.form-group').style.display = 'block';
                break;
            case 'size':
                description = 'Print the total size and number of objects in the path.';
                sourceInput.placeholder = "e.g., remote:path";
                serviceAccountCheckbox.closest('.form-group').style.display = 'block';
                break;
            case 'serve':
                description = 'Serve a remote via a protocol (e.g., http, webdav).';
                // Hide source, show protocol dropdown in its place
                sourceField.style.display = 'none';
                serveProtocolField.style.display = 'block';
                serveProtocolSelect.required = true;

                // Move destination label/placeholder to source field's spot logically
                // This means the "source" input itself will act as the path for "serve"
                document.querySelector('#source-field label').textContent = "Path to serve:";
                sourceInput.placeholder = "e.g., remote:path/to/share or /local/path";
                sourceField.style.display = 'block'; // Keep source field visible for path
                sourceInput.required = true;

                destinationField.style.display = 'none'; // Hide destination field
                destinationInput.required = false;

                // General options for serve
                serviceAccountCheckbox.closest('.form-group').style.display = 'block';
                dryRunCheckbox.closest('.form-group').style.display = 'block'; // Dry run can be useful for serve testing
                break;
            case 'dedupe':
                description = 'Deduplicate files in the path.';
                serviceAccountCheckbox.closest('.form-group').style.display = 'block';
                dryRunCheckbox.closest('.form-group').style.display = 'block';
                break;
            case 'cleanup':
                description = 'Clean up the remote (e.g., delete empty directories).';
                serviceAccountCheckbox.closest('.form-group').style.display = 'block';
                dryRunCheckbox.closest('.form-group').style.display = 'block';
                break;
            case 'delete':
                description = 'Delete files in the path.';
                enableCommonOptions(true); // Basic options
                break;
            case 'deletefile':
                description = 'Delete a single file in the path.';
                enableCommonOptions(true); // Basic options
                break;
            case 'purge':
                description = 'Remove the path and all its contents.';
                enableCommonOptions(true); // Basic options
                break;
            case 'version':
                description = 'Show version and quit.';
                sourceField.style.display = 'none';
                destinationField.style.display = 'none';
                sourceInput.required = false;
                destinationInput.required = false;
                break;
            default:
                description = 'Select an Rclone command mode.';
                break;
        }
        modeDescription.textContent = description;

        // Function to enable common options
        function enableCommonOptions(basic = false) {
            if (!basic) { // For full options (sync, copy, move, check, cryptcheck)
                transfersInput.closest('.form-group').style.display = 'block';
                checkersInput.closest('.form-group').style.display = 'block';
                bufferSizeSelect.closest('.form-group').style.display = 'block';
                orderSelect.closest('.form-group').style.display = 'block';
            }
            useDriveTrashCheckbox.closest('.form-group').style.display = 'block';
            serviceAccountCheckbox.closest('.form-group').style.display = 'block';
            dryRunCheckbox.closest('.form-group').style.display = 'block';
        }
    });

    // Manually trigger change to set initial state
    modeSelect.dispatchEvent(new Event('change'));
});
