document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element References ---
    const navButtons = document.querySelectorAll('.nav-button');
    const contentSections = document.querySelectorAll('.content-section');
    const majorStepsOutput = document.getElementById('majorStepsOutput');

    // Rclone section
    const modeSelect = document.getElementById('mode');
    const modeDescription = document.getElementById('mode-description');
    const sourceField = document.getElementById('source-field');
    const sourceInput = document.getElementById('source');
    const sourceLabel = sourceField.querySelector('label');
    const destinationField = document.getElementById('destination-field');
    const copyUrlField = document.getElementById('copy-url-field');
    const urlInput = document.getElementById('url-input');
    const serveProtocolField = document.getElementById('serve-protocol-field');
    const serveProtocolInput = document.getElementById('serve-protocol-input');
    
    const transfersInput = document.getElementById('transfers');
    const transfersValueSpan = document.getElementById('transfers-value');
    const checkersInput = document.getElementById('checkers');
    const checkersValueSpan = document.getElementById('checkers-value');

    const startRcloneTransferBtn = document.getElementById('startRcloneTransferBtn');
    const stopRcloneTransferBtn = document.getElementById('stopRcloneTransferBtn');
    const downloadRcloneLogBtn = document.getElementById('downloadRcloneLogBtn');
    const clearRcloneOutputBtn = document.getElementById('clearRcloneOutputBtn');
    const rcloneLiveOutput = document.getElementById('rcloneLiveOutput');
    const rcloneSpinner = document.getElementById('rclone-spinner');

    // Setup section
    const uploadRcloneConfBtn = document.getElementById('uploadRcloneConfBtn');
    const uploadSaZipBtn = document.getElementById('uploadSaZipBtn');

    // Terminal section
    const terminalCommandInput = document.getElementById('terminal-command-input');
    const executeTerminalBtn = document.getElementById('executeTerminalBtn');
    const stopTerminalBtn = document.getElementById('stopTerminalBtn');
    const clearTerminalOutputBtn = document.getElementById('clearTerminalOutputBtn');
    const downloadTerminalLogBtn = document.getElementById('downloadTerminalLogBtn');
    const terminalOutput = document.getElementById('terminalOutput');
    const terminalSpinner = document.getElementById('terminal-spinner');
    const terminalConfirmModal = document.getElementById('terminalConfirmModal');
    const confirmStopAndStartBtn = document.getElementById('confirmStopAndStartBtn');
    const cancelStopAndStartBtn = document.getElementById('cancelStopAndStartBtn');

    // Recent Commands
    const recentCommandsContent = document.getElementById('recent-commands-content');
    
    // Header
    const themeSelector = document.getElementById('theme-selector');
    const logoutBtn = document.getElementById('logout-btn');

    // --- State Variables ---
    let rcloneEventSource = null;
    let terminalOutputInterval = null;
    let pendingTerminalCommand = null;

    // --- Rclone Mode Definitions ---
    const oneRemoteCommands = ['lsd', 'ls', 'tree', 'listremotes', 'mkdir', 'size', 'serve', 'dedupe', 'cleanup', 'delete', 'deletefile', 'purge', 'version'];
    const modeDescriptions = {
        sync: 'Make source and destination identical, modifying destination only.',
        copy: 'Copy files from source to destination, skipping identical files.',
        move: 'Move files from source to destination.',
        copyurl: 'Copy content of a URL to a remote path.',
        check: 'Check files in source against destination.',
        cryptcheck: 'Check the integrity of a crypted remote.',
        lsd: 'List only directories in a path.',
        ls: 'List all files and directories in a path.',
        tree: 'List contents in a tree-like format.',
        listremotes: 'List all configured remotes.',
        mkdir: 'Create a directory on a remote.',
        size: 'Print the total size and number of objects in a path.',
        serve: 'Serve a remote over a specified protocol (e.g., HTTP, FTP).',
        dedupe: 'Remove duplicate files from a path.',
        cleanup: 'Clean up the remote, removing empty directories.',
        delete: 'Delete all files in a path.',
        deletefile: 'Delete a single file.',
        purge: 'Permanently remove a path and all its contents.',
        version: 'Show the currently installed rclone version.'
    };
    
    // --- Utility Functions ---
    const showSpinner = (spinnerElement) => spinnerElement.classList.remove('hidden');
    const hideSpinner = (spinnerElement) => spinnerElement.classList.add('hidden');

    const showMessage = (message, status = 'info') => {
        majorStepsOutput.textContent = message;
        majorStepsOutput.className = `p-4 rounded-xl shadow-md text-center font-semibold ${status}-message`;
        majorStepsOutput.classList.remove('hidden');
        setTimeout(() => majorStepsOutput.classList.add('hidden'), 5000);
    };

    // --- Event Listeners ---
    
    // Navigation
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.dataset.target;

            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            contentSections.forEach(section => {
                section.id === targetId ? section.classList.remove('hidden') : section.classList.add('hidden');
            });

            if (targetId === 'recent-commands-section') {
                loadRecentCommands();
            }
        });
    });

    // Theme Selector
    themeSelector.addEventListener('change', (e) => {
        document.documentElement.className = e.target.value;
        localStorage.setItem('theme', e.target.value);
    });

    // Logout
    logoutBtn.addEventListener('click', () => window.location.href = '/logout');
    
    // Sliders
    transfersInput.addEventListener('input', (e) => transfersValueSpan.textContent = e.target.value);
    checkersInput.addEventListener('input', (e) => checkersValueSpan.textContent = e.target.value);
    
    // Rclone Mode Change
    modeSelect.addEventListener('change', updateUIForMode);

    // Rclone Actions
    startRcloneTransferBtn.addEventListener('click', startRcloneTransfer);
    stopRcloneTransferBtn.addEventListener('click', stopRcloneTransfer);
    downloadRcloneLogBtn.addEventListener('click', () => window.location.href = '/download-logs');
    clearRcloneOutputBtn.addEventListener('click', () => {
        rcloneLiveOutput.textContent = '';
        rcloneLiveOutput.classList.remove('success', 'error');
    });

    // Setup Actions
    uploadRcloneConfBtn.addEventListener('click', () => uploadFile('rclone-conf-upload', '/upload-rclone-conf'));
    uploadSaZipBtn.addEventListener('click', () => uploadFile('sa-zip-upload', '/upload-sa-zip'));

    // Terminal Actions
    executeTerminalBtn.addEventListener('click', () => executeTerminalCommand());
    terminalCommandInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            executeTerminalCommand();
        }
    });
    stopTerminalBtn.addEventListener('click', stopTerminalProcess);
    clearTerminalOutputBtn.addEventListener('click', () => terminalOutput.textContent = '');
    downloadTerminalLogBtn.addEventListener('click', () => window.location.href = '/download-terminal-log');
    
    // Terminal Confirmation Modal
    confirmStopAndStartBtn.addEventListener('click', async () => {
        terminalConfirmModal.classList.add('hidden');
        await stopTerminalProcess(true); // Stop silently
        if (pendingTerminalCommand) {
            executeTerminalCommand(pendingTerminalCommand);
            pendingTerminalCommand = null;
        }
    });
    cancelStopAndStartBtn.addEventListener('click', () => {
        terminalConfirmModal.classList.add('hidden');
        pendingTerminalCommand = null;
        hideSpinner(terminalSpinner);
    });
    
    // --- Functions ---
    
    function updateUIForMode() {
        const mode = modeSelect.value;
        modeDescription.textContent = modeDescriptions[mode] || 'Select a mode to see its description.';

        // Reset all special fields
        [copyUrlField, serveProtocolField].forEach(f => f.classList.add('hidden'));
        [sourceField, destinationField].forEach(f => f.classList.remove('hidden'));
        sourceLabel.textContent = 'Source';

        if (oneRemoteCommands.includes(mode)) {
            destinationField.classList.add('hidden');
        }

        if (mode === 'copyurl') {
            sourceField.classList.add('hidden');
            copyUrlField.classList.remove('hidden');
        } else if (mode === 'serve') {
            sourceField.classList.remove('hidden'); // Re-show for path
            sourceLabel.textContent = 'Path to Serve';
            destinationField.classList.add('hidden');
            serveProtocolField.classList.remove('hidden');
        } else if (mode === 'listremotes' || mode === 'version') {
            sourceField.classList.add('hidden');
        }
    }

    async function uploadFile(inputId, endpoint) {
        const fileInput = document.getElementById(inputId);
        const file = fileInput.files[0];
        if (!file) {
            showMessage('Please select a file first.', 'warning');
            return;
        }
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(endpoint, { method: 'POST', body: formData });
            const result = await response.json();
            showMessage(result.message, result.status);
        } catch (error) {
            showMessage(`Upload failed: ${error.message}`, 'error');
        }
    }

    function startRcloneTransfer() {
        if (rcloneEventSource) {
            showMessage('A transfer is already in progress.', 'warning');
            return;
        }

        const mode = modeSelect.value;
        const payload = {
            mode: mode,
            source: sourceInput.value,
            destination: destinationInput.value,
            url: urlInput.value,
            protocol: serveProtocolInput.value,
            path: sourceInput.value, // For 'serve', source input is used as path
            transfers: transfersInput.value,
            checkers: checkersInput.value,
            buffer_size: document.getElementById('buffer_size').value,
            order: document.getElementById('order').value,
            loglevel: document.getElementById('loglevel').value,
            additional_flags: document.getElementById('additional_flags').value,
            use_drive_trash: document.getElementById('use_drive_trash').checked,
            service_account: document.getElementById('service_account').checked,
            dry_run: document.getElementById('dry_run').checked,
        };

        // Save recent locations
        if(payload.source) saveToLocalStorage('rclone_sources', payload.source);
        if(payload.destination) saveToLocalStorage('rclone_destinations', payload.destination);

        showSpinner(rcloneSpinner);
        startRcloneTransferBtn.classList.add('hidden');
        stopRcloneTransferBtn.classList.remove('hidden');
        rcloneLiveOutput.textContent = 'Starting Rclone process...';
        rcloneLiveOutput.classList.remove('success', 'error');

        rcloneEventSource = new EventSource(`/execute-rclone?data=${encodeURIComponent(JSON.stringify(payload))}`);
        // The above is a GET request, but we need POST. Let's fix this.
        // We'll use fetch and read the stream manually.
        
        fetch('/execute-rclone', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        }).then(response => {
             const reader = response.body.getReader();
             const decoder = new TextDecoder();
             
             function push() {
                 reader.read().then(({ done, value }) => {
                     if (done) {
                        // The stream is done, but the final message comes from the last event.
                        return;
                     }
                     
                     // The data can be chunked, so we process it line by line
                     const chunk = decoder.decode(value, { stream: true });
                     const lines = chunk.split('\\n\\n');

                     lines.forEach(line => {
                         if (line.startsWith('data:')) {
                             const dataStr = line.substring(5);
                             try {
                                const data = JSON.parse(dataStr);
                                 if (data.status === 'progress') {
                                     rcloneLiveOutput.textContent += `\\n${data.output}`;
                                 } else {
                                     showMessage(data.message, data.status);
                                     rcloneLiveOutput.classList.add(data.status); // 'complete' -> 'success', 'error' -> 'error'
                                     stopRcloneTransfer(true); // Stop streaming
                                 }
                                 rcloneLiveOutput.scrollTop = rcloneLiveOutput.scrollHeight;
                             } catch(e) {
                                console.error("Failed to parse stream data:", e, "Data:", dataStr);
                             }
                         }
                     });
                     push();
                 });
             }
             push();
        }).catch(err => {
            console.error('Fetch error:', err);
            showMessage(`Connection error: ${err.message}`, 'error');
            stopRcloneTransfer(true);
        });
    }

    async function stopRcloneTransfer(isSilent = false) {
        if (!isSilent) {
            try {
                const response = await fetch('/stop-rclone', { method: 'POST' });
                const result = await response.json();
                showMessage(result.message, result.status);
            } catch (error) {
                showMessage(`Error stopping transfer: ${error.message}`, 'error');
            }
        }
        
        // This is a placeholder for a real EventSource close, which fetch doesn't have.
        // The stream will naturally end when the backend process is killed.
        // We just reset the UI here.

        hideSpinner(rcloneSpinner);
        startRcloneTransferBtn.classList.remove('hidden');
        stopRcloneTransferBtn.classList.add('hidden');
    }

    async function executeTerminalCommand(commandOverride = null) {
        const command = commandOverride || terminalCommandInput.value;
        if (!command) {
            showMessage('Please enter a command.', 'warning');
            return;
        }

        showSpinner(terminalSpinner);
        try {
            const response = await fetch('/execute-terminal-command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: command })
            });

            if (response.status === 409) { // Process already running
                terminalConfirmModal.classList.remove('hidden');
                pendingTerminalCommand = command; // Save for later
                // Don't hide spinner yet, wait for user action
                return;
            }

            const result = await response.json();
            if (result.status === 'success') {
                saveToLocalStorage('terminal_commands', command);
                terminalCommandInput.value = '';
                executeTerminalBtn.classList.add('hidden');
                stopTerminalBtn.classList.remove('hidden');
                startTerminalPolling();
            } else {
                showMessage(result.message, 'error');
                hideSpinner(terminalSpinner);
            }

        } catch (error) {
            showMessage(`Failed to execute command: ${error.message}`, 'error');
            hideSpinner(terminalSpinner);
        }
    }

    function startTerminalPolling() {
        if (terminalOutputInterval) clearInterval(terminalOutputInterval);
        terminalOutputInterval = setInterval(async () => {
            try {
                const response = await fetch('/get-terminal-output');
                const result = await response.json();
                terminalOutput.textContent = result.output;
                terminalOutput.scrollTop = terminalOutput.scrollHeight;

                if (!result.is_running) {
                   stopTerminalProcess(true); // Polling detected process end, clean up UI
                }
            } catch (error) {
                console.error('Terminal polling failed:', error);
                stopTerminalProcess(true); // Stop on error
            }
        }, 1500);
    }
    
    async function stopTerminalProcess(isSilent = false) {
        if (terminalOutputInterval) clearInterval(terminalOutputInterval);
        terminalOutputInterval = null;

        if (!isSilent) {
             try {
                const response = await fetch('/stop-terminal-process', { method: 'POST' });
                const result = await response.json();
                showMessage(result.message, result.status);
            } catch (error) {
                showMessage(`Error stopping process: ${error.message}`, 'error');
            }
        }
       
        hideSpinner(terminalSpinner);
        executeTerminalBtn.classList.remove('hidden');
        stopTerminalBtn.classList.add('hidden');
    }

    // --- Local Storage & Recents ---
    function saveToLocalStorage(key, value) {
        let items = JSON.parse(localStorage.getItem(key)) || [];
        if (!items.includes(value)) {
            items.unshift(value); // Add to the beginning
            items = items.slice(0, 20); // Keep last 20
            localStorage.setItem(key, JSON.stringify(items));
        }
    }

    function loadRecentCommands() {
        const sources = JSON.parse(localStorage.getItem('rclone_sources')) || [];
        const destinations = JSON.parse(localStorage.getItem('rclone_destinations')) || [];
        const terminalCmds = JSON.parse(localStorage.getItem('terminal_commands')) || [];

        let html = '<p class="text-text-color/70">No recent activity.</p>';
        if (sources.length > 0 || destinations.length > 0 || terminalCmds.length > 0) {
            html = `
                ${createRecentListHTML('Recent Sources', sources, 'source')}
                ${createRecentListHTML('Recent Destinations', destinations, 'destination')}
                ${createRecentListHTML('Recent Terminal Commands', terminalCmds, 'terminal')}
            `;
        }
        recentCommandsContent.innerHTML = html;
        addRecentClickListeners();
    }

    function createRecentListHTML(title, items, type) {
        if (items.length === 0) return '';
        return `
            <div>
                <h3 class="font-bold text-lg mb-2 text-primary-color">${title}</h3>
                <ul class="space-y-1">
                    ${items.map(item => `
                        <li class="flex items-center justify-between bg-input-bg-color p-2 rounded-lg">
                            <code class="text-sm truncate mr-2">${item}</code>
                            <button class="copy-recent-btn btn-secondary text-xs p-1" data-value="${item}" data-type="${type}"><i class="fas fa-copy"></i></button>
                        </li>`).join('')}
                </ul>
            </div>
        `;
    }

    function addRecentClickListeners() {
        document.querySelectorAll('.copy-recent-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const value = target.dataset.value;
                const type = target.dataset.type;

                if (type === 'source') sourceInput.value = value;
                else if (type === 'destination') destinationInput.value = value;
                else if (type === 'terminal') terminalCommandInput.value = value;
                
                showMessage(`Copied '${value.substring(0,20)}...' to input.`);
            });
        });
    }

    // --- Initial Page Load ---
    (function init() {
        const savedTheme = localStorage.getItem('theme') || 'theme-green-dark';
        themeSelector.value = savedTheme;
        updateUIForMode(); // Set initial UI based on default mode
        startTerminalPolling(); // Check for any running terminal process on load
    })();
});
document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Element References ---
    const navButtons = document.querySelectorAll('.nav-button');
    const contentSections = document.querySelectorAll('.content-section');
    const majorStepsOutput = document.getElementById('majorStepsOutput');

    // Rclone section
    const modeSelect = document.getElementById('mode');
    const modeDescription = document.getElementById('mode-description');
    const sourceField = document.getElementById('source-field');
    const sourceInput = document.getElementById('source');
    const sourceLabel = sourceField.querySelector('label');
    const destinationField = document.getElementById('destination-field');
    const copyUrlField = document.getElementById('copy-url-field');
    const urlInput = document.getElementById('url-input');
    const serveProtocolField = document.getElementById('serve-protocol-field');
    const serveProtocolInput = document.getElementById('serve-protocol-input');
    
    const transfersInput = document.getElementById('transfers');
    const transfersValueSpan = document.getElementById('transfers-value');
    const checkersInput = document.getElementById('checkers');
    const checkersValueSpan = document.getElementById('checkers-value');

    const startRcloneTransferBtn = document.getElementById('startRcloneTransferBtn');
    const stopRcloneTransferBtn = document.getElementById('stopRcloneTransferBtn');
    const downloadRcloneLogBtn = document.getElementById('downloadRcloneLogBtn');
    const clearRcloneOutputBtn = document.getElementById('clearRcloneOutputBtn');
    const rcloneLiveOutput = document.getElementById('rcloneLiveOutput');
    const rcloneSpinner = document.getElementById('rclone-spinner');

    // Setup section
    const uploadRcloneConfBtn = document.getElementById('uploadRcloneConfBtn');
    const uploadSaZipBtn = document.getElementById('uploadSaZipBtn');

    // Terminal section
    const terminalCommandInput = document.getElementById('terminal-command-input');
    const executeTerminalBtn = document.getElementById('executeTerminalBtn');
    const stopTerminalBtn = document.getElementById('stopTerminalBtn');
    const clearTerminalOutputBtn = document.getElementById('clearTerminalOutputBtn');
    const downloadTerminalLogBtn = document.getElementById('downloadTerminalLogBtn');
    const terminalOutput = document.getElementById('terminalOutput');
    const terminalSpinner = document.getElementById('terminal-spinner');
    const terminalConfirmModal = document.getElementById('terminalConfirmModal');
    const confirmStopAndStartBtn = document.getElementById('confirmStopAndStartBtn');
    const cancelStopAndStartBtn = document.getElementById('cancelStopAndStartBtn');

    // Recent Commands
    const recentCommandsContent = document.getElementById('recent-commands-content');
    
    // Header
    const themeSelector = document.getElementById('theme-selector');
    const logoutBtn = document.getElementById('logout-btn');

    // --- State Variables ---
    let rcloneEventSource = null;
    let terminalOutputInterval = null;
    let pendingTerminalCommand = null;

    // --- Rclone Mode Definitions ---
    const oneRemoteCommands = ['lsd', 'ls', 'tree', 'listremotes', 'mkdir', 'size', 'serve', 'dedupe', 'cleanup', 'delete', 'deletefile', 'purge', 'version'];
    const modeDescriptions = {
        sync: 'Make source and destination identical, modifying destination only.',
        copy: 'Copy files from source to destination, skipping identical files.',
        move: 'Move files from source to destination.',
        copyurl: 'Copy content of a URL to a remote path.',
        check: 'Check files in source against destination.',
        cryptcheck: 'Check the integrity of a crypted remote.',
        lsd: 'List only directories in a path.',
        ls: 'List all files and directories in a path.',
        tree: 'List contents in a tree-like format.',
        listremotes: 'List all configured remotes.',
        mkdir: 'Create a directory on a remote.',
        size: 'Print the total size and number of objects in a path.',
        serve: 'Serve a remote over a specified protocol (e.g., HTTP, FTP).',
        dedupe: 'Remove duplicate files from a path.',
        cleanup: 'Clean up the remote, removing empty directories.',
        delete: 'Delete all files in a path.',
        deletefile: 'Delete a single file.',
        purge: 'Permanently remove a path and all its contents.',
        version: 'Show the currently installed rclone version.'
    };
    
    // --- Utility Functions ---
    const showSpinner = (spinnerElement) => spinnerElement.classList.remove('hidden');
    const hideSpinner = (spinnerElement) => spinnerElement.classList.add('hidden');

    const showMessage = (message, status = 'info') => {
        majorStepsOutput.textContent = message;
        majorStepsOutput.className = `p-4 rounded-xl shadow-md text-center font-semibold ${status}-message`;
        majorStepsOutput.classList.remove('hidden');
        setTimeout(() => majorStepsOutput.classList.add('hidden'), 5000);
    };

    // --- Event Listeners ---
    
    // Navigation
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetId = button.dataset.target;

            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            contentSections.forEach(section => {
                section.id === targetId ? section.classList.remove('hidden') : section.classList.add('hidden');
            });

            if (targetId === 'recent-commands-section') {
                loadRecentCommands();
            }
        });
    });

    // Theme Selector
    themeSelector.addEventListener('change', (e) => {
        document.documentElement.className = e.target.value;
        localStorage.setItem('theme', e.target.value);
    });

    // Logout
    logoutBtn.addEventListener('click', () => window.location.href = '/logout');
    
    // Sliders
    transfersInput.addEventListener('input', (e) => transfersValueSpan.textContent = e.target.value);
    checkersInput.addEventListener('input', (e) => checkersValueSpan.textContent = e.target.value);
    
    // Rclone Mode Change
    modeSelect.addEventListener('change', updateUIForMode);

    // Rclone Actions
    startRcloneTransferBtn.addEventListener('click', startRcloneTransfer);
    stopRcloneTransferBtn.addEventListener('click', stopRcloneTransfer);
    downloadRcloneLogBtn.addEventListener('click', () => window.location.href = '/download-logs');
    clearRcloneOutputBtn.addEventListener('click', () => {
        rcloneLiveOutput.textContent = '';
        rcloneLiveOutput.classList.remove('success', 'error');
    });

    // Setup Actions
    uploadRcloneConfBtn.addEventListener('click', () => uploadFile('rclone-conf-upload', '/upload-rclone-conf'));
    uploadSaZipBtn.addEventListener('click', () => uploadFile('sa-zip-upload', '/upload-sa-zip'));

    // Terminal Actions
    executeTerminalBtn.addEventListener('click', () => executeTerminalCommand());
    terminalCommandInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            executeTerminalCommand();
        }
    });
    stopTerminalBtn.addEventListener('click', stopTerminalProcess);
    clearTerminalOutputBtn.addEventListener('click', () => terminalOutput.textContent = '');
    downloadTerminalLogBtn.addEventListener('click', () => window.location.href = '/download-terminal-log');
    
    // Terminal Confirmation Modal
    confirmStopAndStartBtn.addEventListener('click', async () => {
        terminalConfirmModal.classList.add('hidden');
        await stopTerminalProcess(true); // Stop silently
        if (pendingTerminalCommand) {
            executeTerminalCommand(pendingTerminalCommand);
            pendingTerminalCommand = null;
        }
    });
    cancelStopAndStartBtn.addEventListener('click', () => {
        terminalConfirmModal.classList.add('hidden');
        pendingTerminalCommand = null;
        hideSpinner(terminalSpinner);
    });
    
    // --- Functions ---
    
    function updateUIForMode() {
        const mode = modeSelect.value;
        modeDescription.textContent = modeDescriptions[mode] || 'Select a mode to see its description.';

        // Reset all special fields
        [copyUrlField, serveProtocolField].forEach(f => f.classList.add('hidden'));
        [sourceField, destinationField].forEach(f => f.classList.remove('hidden'));
        sourceLabel.textContent = 'Source';

        if (oneRemoteCommands.includes(mode)) {
            destinationField.classList.add('hidden');
        }

        if (mode === 'copyurl') {
            sourceField.classList.add('hidden');
            copyUrlField.classList.remove('hidden');
        } else if (mode === 'serve') {
            sourceField.classList.remove('hidden'); // Re-show for path
            sourceLabel.textContent = 'Path to Serve';
            destinationField.classList.add('hidden');
            serveProtocolField.classList.remove('hidden');
        } else if (mode === 'listremotes' || mode === 'version') {
            sourceField.classList.add('hidden');
        }
    }

    async function uploadFile(inputId, endpoint) {
        const fileInput = document.getElementById(inputId);
        const file = fileInput.files[0];
        if (!file) {
            showMessage('Please select a file first.', 'warning');
            return;
        }
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(endpoint, { method: 'POST', body: formData });
            const result = await response.json();
            showMessage(result.message, result.status);
        } catch (error) {
            showMessage(`Upload failed: ${error.message}`, 'error');
        }
    }

    function startRcloneTransfer() {
        if (rcloneEventSource) {
            showMessage('A transfer is already in progress.', 'warning');
            return;
        }

        const mode = modeSelect.value;
        const payload = {
            mode: mode,
            source: sourceInput.value,
            destination: destinationInput.value,
            url: urlInput.value,
            protocol: serveProtocolInput.value,
            path: sourceInput.value, // For 'serve', source input is used as path
            transfers: transfersInput.value,
            checkers: checkersInput.value,
            buffer_size: document.getElementById('buffer_size').value,
            order: document.getElementById('order').value,
            loglevel: document.getElementById('loglevel').value,
            additional_flags: document.getElementById('additional_flags').value,
            use_drive_trash: document.getElementById('use_drive_trash').checked,
            service_account: document.getElementById('service_account').checked,
            dry_run: document.getElementById('dry_run').checked,
        };

        // Save recent locations
        if(payload.source) saveToLocalStorage('rclone_sources', payload.source);
        if(payload.destination) saveToLocalStorage('rclone_destinations', payload.destination);

        showSpinner(rcloneSpinner);
        startRcloneTransferBtn.classList.add('hidden');
        stopRcloneTransferBtn.classList.remove('hidden');
        rcloneLiveOutput.textContent = 'Starting Rclone process...';
        rcloneLiveOutput.classList.remove('success', 'error');

        rcloneEventSource = new EventSource(`/execute-rclone?data=${encodeURIComponent(JSON.stringify(payload))}`);
        // The above is a GET request, but we need POST. Let's fix this.
        // We'll use fetch and read the stream manually.
        
        fetch('/execute-rclone', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        }).then(response => {
             const reader = response.body.getReader();
             const decoder = new TextDecoder();
             
             function push() {
                 reader.read().then(({ done, value }) => {
                     if (done) {
                        // The stream is done, but the final message comes from the last event.
                        return;
                     }
                     
                     // The data can be chunked, so we process it line by line
                     const chunk = decoder.decode(value, { stream: true });
                     const lines = chunk.split('\\n\\n');

                     lines.forEach(line => {
                         if (line.startsWith('data:')) {
                             const dataStr = line.substring(5);
                             try {
                                const data = JSON.parse(dataStr);
                                 if (data.status === 'progress') {
                                     rcloneLiveOutput.textContent += `\\n${data.output}`;
                                 } else {
                                     showMessage(data.message, data.status);
                                     rcloneLiveOutput.classList.add(data.status); // 'complete' -> 'success', 'error' -> 'error'
                                     stopRcloneTransfer(true); // Stop streaming
                                 }
                                 rcloneLiveOutput.scrollTop = rcloneLiveOutput.scrollHeight;
                             } catch(e) {
                                console.error("Failed to parse stream data:", e, "Data:", dataStr);
                             }
                         }
                     });
                     push();
                 });
             }
             push();
        }).catch(err => {
            console.error('Fetch error:', err);
            showMessage(`Connection error: ${err.message}`, 'error');
            stopRcloneTransfer(true);
        });
    }

    async function stopRcloneTransfer(isSilent = false) {
        if (!isSilent) {
            try {
                const response = await fetch('/stop-rclone', { method: 'POST' });
                const result = await response.json();
                showMessage(result.message, result.status);
            } catch (error) {
                showMessage(`Error stopping transfer: ${error.message}`, 'error');
            }
        }
        
        // This is a placeholder for a real EventSource close, which fetch doesn't have.
        // The stream will naturally end when the backend process is killed.
        // We just reset the UI here.

        hideSpinner(rcloneSpinner);
        startRcloneTransferBtn.classList.remove('hidden');
        stopRcloneTransferBtn.classList.add('hidden');
    }

    async function executeTerminalCommand(commandOverride = null) {
        const command = commandOverride || terminalCommandInput.value;
        if (!command) {
            showMessage('Please enter a command.', 'warning');
            return;
        }

        showSpinner(terminalSpinner);
        try {
            const response = await fetch('/execute-terminal-command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: command })
            });

            if (response.status === 409) { // Process already running
                terminalConfirmModal.classList.remove('hidden');
                pendingTerminalCommand = command; // Save for later
                // Don't hide spinner yet, wait for user action
                return;
            }

            const result = await response.json();
            if (result.status === 'success') {
                saveToLocalStorage('terminal_commands', command);
                terminalCommandInput.value = '';
                executeTerminalBtn.classList.add('hidden');
                stopTerminalBtn.classList.remove('hidden');
                startTerminalPolling();
            } else {
                showMessage(result.message, 'error');
                hideSpinner(terminalSpinner);
            }

        } catch (error) {
            showMessage(`Failed to execute command: ${error.message}`, 'error');
            hideSpinner(terminalSpinner);
        }
    }

    function startTerminalPolling() {
        if (terminalOutputInterval) clearInterval(terminalOutputInterval);
        terminalOutputInterval = setInterval(async () => {
            try {
                const response = await fetch('/get-terminal-output');
                const result = await response.json();
                terminalOutput.textContent = result.output;
                terminalOutput.scrollTop = terminalOutput.scrollHeight;

                if (!result.is_running) {
                   stopTerminalProcess(true); // Polling detected process end, clean up UI
                }
            } catch (error) {
                console.error('Terminal polling failed:', error);
                stopTerminalProcess(true); // Stop on error
            }
        }, 1500);
    }
    
    async function stopTerminalProcess(isSilent = false) {
        if (terminalOutputInterval) clearInterval(terminalOutputInterval);
        terminalOutputInterval = null;

        if (!isSilent) {
             try {
                const response = await fetch('/stop-terminal-process', { method: 'POST' });
                const result = await response.json();
                showMessage(result.message, result.status);
            } catch (error) {
                showMessage(`Error stopping process: ${error.message}`, 'error');
            }
        }
       
        hideSpinner(terminalSpinner);
        executeTerminalBtn.classList.remove('hidden');
        stopTerminalBtn.classList.add('hidden');
    }

    // --- Local Storage & Recents ---
    function saveToLocalStorage(key, value) {
        let items = JSON.parse(localStorage.getItem(key)) || [];
        if (!items.includes(value)) {
            items.unshift(value); // Add to the beginning
            items = items.slice(0, 20); // Keep last 20
            localStorage.setItem(key, JSON.stringify(items));
        }
    }

    function loadRecentCommands() {
        const sources = JSON.parse(localStorage.getItem('rclone_sources')) || [];
        const destinations = JSON.parse(localStorage.getItem('rclone_destinations')) || [];
        const terminalCmds = JSON.parse(localStorage.getItem('terminal_commands')) || [];

        let html = '<p class="text-text-color/70">No recent activity.</p>';
        if (sources.length > 0 || destinations.length > 0 || terminalCmds.length > 0) {
            html = `
                ${createRecentListHTML('Recent Sources', sources, 'source')}
                ${createRecentListHTML('Recent Destinations', destinations, 'destination')}
                ${createRecentListHTML('Recent Terminal Commands', terminalCmds, 'terminal')}
            `;
        }
        recentCommandsContent.innerHTML = html;
        addRecentClickListeners();
    }

    function createRecentListHTML(title, items, type) {
        if (items.length === 0) return '';
        return `
            <div>
                <h3 class="font-bold text-lg mb-2 text-primary-color">${title}</h3>
                <ul class="space-y-1">
                    ${items.map(item => `
                        <li class="flex items-center justify-between bg-input-bg-color p-2 rounded-lg">
                            <code class="text-sm truncate mr-2">${item}</code>
                            <button class="copy-recent-btn btn-secondary text-xs p-1" data-value="${item}" data-type="${type}"><i class="fas fa-copy"></i></button>
                        </li>`).join('')}
                </ul>
            </div>
        `;
    }

    function addRecentClickListeners() {
        document.querySelectorAll('.copy-recent-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const target = e.currentTarget;
                const value = target.dataset.value;
                const type = target.dataset.type;

                if (type === 'source') sourceInput.value = value;
                else if (type === 'destination') destinationInput.value = value;
                else if (type === 'terminal') terminalCommandInput.value = value;
                
                showMessage(`Copied '${value.substring(0,20)}...' to input.`);
            });
        });
    }

    // --- Initial Page Load ---
    (function init() {
        const savedTheme = localStorage.getItem('theme') || 'theme-green-dark';
        themeSelector.value = savedTheme;
        updateUIForMode(); // Set initial UI based on default mode
        startTerminalPolling(); // Check for any running terminal process on load
    })();
});
