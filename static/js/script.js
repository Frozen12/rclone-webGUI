// Vue.js Application
const app = Vue.createApp({
    delimiters: ['[[', ']]'], // IMPORTANT: Change Vue delimiters to avoid Jinja2 conflict
    data() {
        return {
            // UI State
            activeSection: 'rclone', // 'rclone', 'setup', 'terminal'
            showRecentCommandsModal: false,
            showMobileNav: false, // For responsive sidebar
            modeDescription: 'Make source and destination identical.', // Initial description for 'sync'
            showDestinationField: true, // Initially true for 'sync'
            rcloneSpinnerVisible: false,
            terminalSpinnerVisible: false,
            rcloneTransferRunning: false, // Tracks if rclone transfer is ongoing
            terminalProcessRunning: false, // Tracks if terminal process is ongoing
            darkMode: false,
            currentTheme: 'emerald',

            // Rclone Form Data
            rcloneForm: {
                mode: 'sync',
                source: '',
                destination: '',
                transfers: 2,
                checkers: 3,
                buffer_size: '16M',
                order: 'size,mixed,50',
                log_level: 'INFO', // Added from instructions
                additional_flags: '--azureblob-env-auth --crypt-pass-bad-blocks',
                use_drive_trash: false,
                service_account: false,
                dry_run: false,
            },

            // Terminal Data
            terminalCommand: '',

            // Output Areas
            rcloneLiveOutput: '',
            majorStepsOutput: '',
            terminalOutput: '',

            // History
            recentRcloneTransfers: [],
            recentTerminalCommands: [],

            // Polling intervals (adjust as needed for performance)
            terminalPollInterval: null,
            rclonePollInterval: null,
        };
    },
    watch: {
        'rcloneForm.mode': {
            handler: 'updateModeDescription',
            immediate: true // Run immediately on component mount
        },
        // Watch for changes in any form field to update the live command preview
        rcloneForm: {
            handler: 'updateRcloneCommandPreview',
            deep: true, // Watch nested properties
            immediate: true, // Run immediately on component mount
        },
        activeSection(newVal) {
            // Stop polling when switching away from terminal
            if (newVal !== 'terminal' && this.terminalPollInterval) {
                clearInterval(this.terminalPollInterval);
                this.terminalPollInterval = null;
            } else if (newVal === 'terminal' && !this.terminalPollInterval) {
                // Start polling when switching to terminal and not already polling
                this.startTerminalPolling();
            }
            // Ensure mobile nav closes when section is selected
            if (this.showMobileNav) {
                this.showMobileNav = false;
            }
        },
        terminalProcessRunning(newVal) {
            if (newVal) {
                this.startTerminalPolling();
            } else {
                clearInterval(this.terminalPollInterval);
                this.terminalPollInterval = null;
            }
        },
        showRecentCommandsModal(newVal) {
            // Disable body scrolling when modal is open
            if (newVal) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = '';
            }
        }
    },
    mounted() {
        this.loadRecentCommands();
        // Set initial theme based on localStorage or default
        const savedTheme = localStorage.getItem('themeColor') || 'emerald';
        const savedDarkMode = localStorage.getItem('darkMode') === 'true';
        this.currentTheme = savedTheme;
        this.darkMode = savedDarkMode;
        this.applyTheme();
        this.toggleDestinationField(); // Ensure correct initial state
        this.updateRcloneCommandPreview(); // Initial preview generation
    },
    methods: {
        // --- UI Toggling & Theme Management ---
        toggleSection(section) {
            this.activeSection = section;
        },
        toggleMobileNav() {
            this.showMobileNav = !this.showMobileNav;
        },
        logout() {
            // Simple redirect to logout endpoint
            window.location.href = '/logout';
        },
        changeTheme(theme) {
            this.currentTheme = theme;
            localStorage.setItem('themeColor', theme);
            this.applyTheme();
        },
        toggleDarkMode() {
            this.darkMode = !this.darkMode;
            localStorage.setItem('darkMode', this.darkMode);
            this.applyTheme();
        },
        applyTheme() {
            const body = document.body;
            // Remove previous theme classes starting with 'body-'
            body.className = body.className.split(' ').filter(c => !c.startsWith('body-')).join(' ');
            
            // Apply new theme class to body
            body.classList.add(`body-${this.currentTheme}`);

            // Apply dark/light mode class
            if (this.darkMode) {
                body.classList.add('dark');
            } else {
                body.classList.remove('dark');
            }

            // Update CSS variables for dynamic styling. This requires the CSS to have :root and .dark rules.
            const style = getComputedStyle(document.body);
            const accentColor = style.getPropertyValue('--color-accent');
            if (accentColor) {
                // Convert hex or rgb string to r,g,b values for use in rgba()
                let rgb = [];
                if (accentColor.startsWith('#')) {
                    rgb = accentColor.match(/\w\w/g).map(x => parseInt(x, 16));
                } else if (accentColor.startsWith('rgb')) {
                    rgb = accentColor.match(/\d+/g).map(Number);
                }
                document.documentElement.style.setProperty('--color-accent-rgb-val', rgb.join(',')); // Added for glow effect
            }
        },


        // --- Rclone Mode Logic & Command Preview ---
        updateModeDescription() {
            const modeDescriptions = {
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
                "version": "Show version and exit.",
            };
            this.modeDescription = modeDescriptions[this.rcloneForm.mode] || '';
            this.toggleDestinationField();
            this.updateRcloneCommandPreview(); // Update preview when mode changes
        },
        toggleDestinationField() {
            const twoRemoteModes = ["sync", "copy", "move", "copyurl", "check", "cryptcheck"];
            this.showDestinationField = twoRemoteModes.includes(this.rcloneForm.mode);
        },
        updateRcloneCommandPreview() {
            const form = this.rcloneForm;
            let preview = `rclone ${form.mode}`;

            const oneRemoteModes = [
                "lsd", "ls", "tree", "listremotes", "mkdir", "size", "serve", "dedupe",
                "cleanup", "checksum", "delete", "deletefile", "purge", "version"
            ];
            const twoRemoteModes = [
                "sync", "copy", "move", "copyurl", "check", "cryptcheck"
            ];

            if (twoRemoteModes.includes(form.mode)) {
                if (form.source) preview += ` "${form.source}"`;
                if (form.destination) preview += ` "${form.destination}"`;
            } else if (oneRemoteModes.includes(form.mode)) {
                if (form.source) preview += ` "${form.source}"`; // Source acts as path
            }

            preview += ` --transfers=${form.transfers}`;
            preview += ` --checkers=${form.checkers}`;
            preview += ` --buffer-size=${form.buffer_size}`;
            preview += ` --log-level=${form.log_level.toUpperCase()}`; // Ensure uppercase
            preview += ` --order-by="${form.order}"`;

            if (form.use_drive_trash) preview += ` --drive-use-trash=true`;
            if (form.service_account) preview += ` --drive-service-account-directory=/app/.config/rclone/sa-accounts`; // Simplified for preview
            if (form.dry_run) preview += ` --dry-run`;
            
            // Add static Rclone Env variables as flags for preview clarity
            preview += ` --config=/app/.config/rclone/rclone.conf`;
            preview += ` --fast-list`;
            preview += ` --drive-tpslimit=3`;
            preview += ` --drive-acknowledge-abuse`;
            preview += ` --log-file=/content/rcloneLog.txt`;
            preview += ` --verbose=2`;
            preview += ` --drive-pacer-min-sleep=50ms`;
            preview += ` --drive-pacer-burst=2`;
            preview += ` --server-side-across-configs`;
            preview += ` --progress --color=NEVER --stats=3s --cutoff-mode=SOFT`;


            if (form.additional_flags) {
                preview += ` ${form.additional_flags.trim()}`;
            }

            this.rcloneCommandPreview = preview;
        },

        // --- Spinner Control ---
        showRcloneSpinner() {
            this.rcloneSpinnerVisible = true;
        },
        hideRcloneSpinner() {
            this.rcloneSpinnerVisible = false;
        },
        showTerminalSpinner() {
            this.terminalSpinnerVisible = true;
        },
        hideTerminalSpinner() {
            this.terminalSpinnerVisible = false;
        },

        // --- File Uploads ---
        async uploadFile(endpoint, fileRef, outputArea) {
            const fileInput = this.$refs[fileRef];
            if (!fileInput || !fileInput.files.length) {
                this.updateOutput(outputArea, { status: 'error', message: 'Please select a file to upload.' });
                return;
            }

            const formData = new FormData();
            formData.append('file', fileInput.files[0]);

            this.updateOutput(outputArea, { status: 'info', message: '<i class="fas fa-spinner fa-spin mr-2"></i> Uploading...' });

            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    body: formData,
                });
                const data = await response.json();
                this.updateOutput(outputArea, data);
            } catch (error) {
                this.updateOutput(outputArea, { status: 'error', message: `Upload failed: ${error.message}` });
            } finally {
                fileInput.value = ''; // Clear file input after upload
            }
        },
        uploadRcloneConf() {
            this.uploadFile('/upload-rclone-conf', 'rcloneConfFile', 'majorStepsOutput');
        },
        uploadSaZip() {
            this.uploadFile('/upload-sa-zip', 'saZipFile', 'majorStepsOutput');
        },

        // --- Rclone Transfer ---
        async startRcloneTransfer() {
            this.showRcloneSpinner();
            this.rcloneLiveOutput = ''; // Clear previous output
            this.rcloneTransferRunning = true;
            this.updateOutput('majorStepsOutput', { status: 'info', message: '<i class="fas fa-play mr-2"></i> Initiating Rclone transfer...' });

            try {
                const response = await fetch('/execute-rclone', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(this.rcloneForm),
                });

                if (!response.body) {
                    throw new Error("Response body is not readable.");
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    let lastNewlineIndex = buffer.lastIndexOf('\n');

                    if (lastNewlineIndex !== -1) {
                        const lines = buffer.substring(0, lastNewlineIndex).split('\n');
                        buffer = buffer.substring(lastNewlineIndex + 1);

                        for (const line of lines) {
                            if (line.trim()) { // Ensure line is not just whitespace
                                try {
                                    const data = JSON.parse(line);
                                    if (data.status === 'progress') {
                                        this.rcloneLiveOutput += data.output + '\n';
                                    } else {
                                        // Final status message
                                        this.updateOutput('majorStepsOutput', data);
                                        this.rcloneLiveOutput += data.output + '\n';
                                        // Use nextTick to ensure DOM is updated before applying class
                                        this.$nextTick(() => {
                                            if (this.rcloneLiveOutputElement) {
                                                this.rcloneLiveOutputElement.className = `output-area text-sm overflow-auto max-h-96 ${data.status === 'complete' ? 'success' : 'error'}`;
                                            }
                                        });
                                    }
                                } catch (e) {
                                    console.error("Error parsing JSON line:", e, "Line:", line);
                                }
                            }
                        }
                    }
                    this.scrollToBottom('rcloneLiveOutput');
                }
                // Process any remaining content in the buffer after the stream closes
                if (buffer.trim()) {
                    try {
                        const data = JSON.parse(buffer);
                        this.updateOutput('majorStepsOutput', data);
                        this.rcloneLiveOutput += data.output + '\n';
                        this.$nextTick(() => {
                            if (this.rcloneLiveOutputElement) {
                                this.rcloneLiveOutputElement.className = `output-area text-sm overflow-auto max-h-96 ${data.status === 'complete' ? 'success' : 'error'}`;
                            }
                        });
                    } catch (e) {
                        console.error("Error parsing final JSON buffer:", e, "Buffer:", buffer);
                    }
                }

                // Save to recent commands
                this.saveCommandToHistory('rclone', {
                    mode: this.rcloneForm.mode,
                    source: this.rcloneForm.source,
                    destination: this.rcloneForm.destination
                });

            } catch (error) {
                this.updateOutput('majorStepsOutput', { status: 'error', message: `<i class="fas fa-times-circle mr-2"></i> Rclone transfer failed: ${error.message}` });
                this.rcloneLiveOutput += `Error: ${error.message}\n`;
                this.$nextTick(() => {
                    if (this.rcloneLiveOutputElement) {
                        this.rcloneLiveOutputElement.className = 'output-area text-sm overflow-auto max-h-96 error';
                    }
                });
            } finally {
                this.hideRcloneSpinner();
                this.rcloneTransferRunning = false;
                this.scrollToBottom('rcloneLiveOutput');
            }
        },

        async stopRcloneTransfer() {
            // Note: Rclone commands are not easily stoppable from the client once started
            // without a dedicated backend process manager. For simplicity, this button
            // will just update the UI state. A more robust solution would involve storing
            // the subprocess PID on the server and sending a termination signal.
            // For now, it will simply indicate that the transfer cannot be stopped from UI easily.
            this.updateOutput('majorStepsOutput', { status: 'info', message: '<i class="fas fa-info-circle mr-2"></i> Stopping Rclone transfer not directly supported via UI. Please refresh page if needed.' });
            // This is a placeholder; actual backend stop logic is complex for streaming processes.
            // If the backend `execute-rclone` were designed with a PID tracker, you'd call an endpoint here.
            // For now, it's illustrative.
            this.rcloneTransferRunning = false; // Optimistic UI update
            this.hideRcloneSpinner();
        },

        downloadLogs() {
            window.open('/download-logs', '_blank');
        },

        // --- Web Terminal Interactions ---
        async executeTerminalCommand() {
            if (!this.terminalCommand.trim()) {
                this.updateOutput('terminalOutput', { status: 'error', message: 'Please enter a command.' });
                return;
            }

            this.showTerminalSpinner();
            this.terminalOutput = ''; // Clear previous output
            this.updateOutput('majorStepsOutput', { status: 'info', message: '<i class="fas fa-play mr-2"></i> Executing terminal command...' });
            
            try {
                const response = await fetch('/execute_terminal_command', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: this.terminalCommand }),
                });
                const data = await response.json();

                if (data.status === 'warning' && data.message.includes('Another process is running')) {
                    const confirmStop = confirm(data.message + "\nDo you want to stop it and start the new command?");
                    if (confirmStop) {
                        const forceResponse = await fetch('/execute_terminal_command', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ command: this.terminalCommand, force: true }),
                        });
                        const forceData = await forceResponse.json();
                        this.updateOutput('majorStepsOutput', forceData);
                        if (forceData.status === 'success') {
                            this.terminalProcessRunning = true;
                        } else {
                            this.hideTerminalSpinner();
                        }
                    } else {
                        this.hideTerminalSpinner();
                    }
                } else {
                    this.updateOutput('majorStepsOutput', data);
                    if (data.status === 'success') {
                        this.terminalProcessRunning = true;
                    } else {
                        this.hideTerminalSpinner();
                    }
                }
                
                // Save command to history regardless of immediate success (it was attempted)
                this.saveCommandToHistory('terminal', this.terminalCommand);

            } catch (error) {
                this.updateOutput('majorStepsOutput', { status: 'error', message: `<i class="fas fa-times-circle mr-2"></i> Terminal command execution failed: ${error.message}` });
                this.hideTerminalSpinner();
            }
        },

        startTerminalPolling() {
            if (this.terminalPollInterval) {
                clearInterval(this.terminalPollInterval);
            }
            // Check terminal process status periodically
            this.terminalPollInterval = setInterval(this.getTerminalOutput, 1000); // Poll every 1 second
            console.log("Started terminal polling.");
        },

        async getTerminalOutput() {
            try {
                const response = await fetch('/get_terminal_output');
                const data = await response.json();
                this.terminalOutput = data.output;
                this.terminalProcessRunning = data.is_running; // Update process running status
                this.hideTerminalSpinner(); // Hide spinner once first output comes or if not running
                this.scrollToBottom('terminalOutput');

                if (!data.is_running && !this.terminalSpinnerVisible) { // If not running and spinner is already hidden
                    clearInterval(this.terminalPollInterval);
                    this.terminalPollInterval = null;
                    this.updateOutput('majorStepsOutput', { status: 'complete', message: '<i class="fas fa-check-circle mr-2"></i> Terminal process finished.' });
                    console.log("Stopped terminal polling: process finished.");
                }
            } catch (error) {
                console.error("Error fetching terminal output:", error);
                this.updateOutput('majorStepsOutput', { status: 'error', message: `<i class="fas fa-times-circle mr-2"></i> Failed to fetch terminal output: ${error.message}` });
                this.hideTerminalSpinner();
                clearInterval(this.terminalPollInterval);
                this.terminalPollInterval = null;
            }
        },

        async stopTerminalProcess() {
            this.showTerminalSpinner();
            this.updateOutput('majorStepsOutput', { status: 'info', message: '<i class="fas fa-stop-circle mr-2"></i> Attempting to stop terminal process...' });
            try {
                const response = await fetch('/stop_terminal_process', { method: 'POST' });
                const data = await response.json();
                this.updateOutput('majorStepsOutput', data);
                if (data.status === 'success' || data.status === 'info') {
                    this.terminalProcessRunning = false;
                    clearInterval(this.terminalPollInterval);
                    this.terminalPollInterval = null;
                }
            } catch (error) {
                this.updateOutput('majorStepsOutput', { status: 'error', message: `<i class="fas fa-times-circle mr-2"></i> Failed to stop terminal process: ${error.message}` });
            } finally {
                this.hideTerminalSpinner();
            }
        },

        clearTerminalOutput() {
            this.terminalOutput = '';
            // Also clear the actual log file on the backend for a true "clear"
            fetch('/clear_terminal_log', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    console.log("Terminal log cleared on backend:", data.message);
                    this.updateOutput('majorStepsOutput', { status: 'info', message: '<i class="fas fa-eraser mr-2"></i> Terminal output cleared.' });
                })
                .catch(error => {
                    console.error("Error clearing backend terminal log:", error);
                    this.updateOutput('majorStepsOutput', { status: 'error', message: `<i class="fas fa-times-circle mr-2"></i> Failed to clear backend terminal log.` });
                });
        },

        // --- Recent Commands History ---
        saveCommandToHistory(type, commandData) {
            if (type === 'rclone') {
                // Ensure no duplicates based on mode/source/destination
                const isDuplicate = this.recentRcloneTransfers.some(t =>
                    t.mode === commandData.mode &&
                    t.source === commandData.source &&
                    t.destination === commandData.destination
                );
                if (!isDuplicate) {
                    this.recentRcloneTransfers.unshift(commandData); // Add to beginning
                    if (this.recentRcloneTransfers.length > 10) { // Keep last 10
                        this.recentRcloneTransfers.pop();
                    }
                    localStorage.setItem('recentRcloneTransfers', JSON.stringify(this.recentRcloneTransfers));
                }
            } else if (type === 'terminal') {
                const isDuplicate = this.recentTerminalCommands.includes(commandData);
                if (!isDuplicate) {
                    this.recentTerminalCommands.unshift(commandData);
                    if (this.recentTerminalCommands.length > 10) {
                        this.recentTerminalCommands.pop();
                    }
                    localStorage.setItem('recentTerminalCommands', JSON.stringify(this.recentTerminalCommands));
                }
            }
        },

        loadRecentCommands() {
            const rcloneHistory = localStorage.getItem('recentRcloneTransfers');
            const terminalHistory = localStorage.getItem('recentTerminalCommands');
            if (rcloneHistory) {
                this.recentRcloneTransfers = JSON.parse(rcloneHistory);
            }
            if (terminalHistory) {
                this.recentTerminalCommands = JSON.parse(terminalHistory);
            }
        },

        copyRcloneTransfer(transfer) {
            // Populate the Rclone form with the selected transfer details
            this.rcloneForm.mode = transfer.mode;
            this.rcloneForm.source = transfer.source;
            this.rcloneForm.destination = transfer.destination;
            this.showRecentCommandsModal = false; // Close modal
            this.activeSection = 'rclone'; // Switch to Rclone tab
            this.updateModeDescription(); // Update description and destination field visibility
            this.updateOutput('majorStepsOutput', { status: 'info', message: '<i class="fas fa-paste mr-2"></i> Rclone form populated from history.' });
        },

        copyToClipboard(text) {
            // Using execCommand for wider iframe compatibility
            const tempInput = document.createElement('textarea');
            tempInput.value = text;
            document.body.appendChild(tempInput);
            tempInput.select();
            try {
                document.execCommand('copy');
                this.updateOutput('majorStepsOutput', { status: 'success', message: '<i class="fas fa-clipboard-check mr-2"></i> Command copied to clipboard!' });
            } catch (err) {
                console.error('Could not copy text: ', err);
                this.updateOutput('majorStepsOutput', { status: 'error', message: '<i class="fas fa-times-circle mr-2"></i> Failed to copy command.' });
            }
            document.body.removeChild(tempInput);
        },

        // --- Generic Output Updater ---
        updateOutput(outputRef, data) {
            let targetOutput = '';
            let targetElement = null;

            // Update data properties
            if (outputRef === 'majorStepsOutput') {
                this.majorStepsOutput = data.message;
                targetElement = document.getElementById('majorStepsOutput');
            } else if (outputRef === 'rcloneLiveOutput') {
                this.rcloneLiveOutput = data.output;
                targetElement = document.getElementById('rcloneLiveOutput');
            } else if (outputRef === 'terminalOutput') {
                this.terminalOutput = data.output;
                targetElement = document.getElementById('terminalOutput');
            }

            // Apply classes to target element for styling
            if (targetElement) {
                this.$nextTick(() => { // Ensure DOM is updated before applying classes
                    targetElement.className = `output-area text-sm overflow-auto max-h-96 ${data.status === 'success' || data.status === 'complete' ? 'success' : data.status === 'error' ? 'error' : 'text-gray-700 dark:text-gray-300'}`;
                    this.scrollToBottom(outputRef);
                });
            }
        },

        scrollToBottom(elementId) {
            const element = document.getElementById(elementId);
            if (element) {
                element.scrollTop = element.scrollHeight;
            }
        },
    },
    computed: {
        rcloneLiveOutputElement() {
            return document.getElementById('rcloneLiveOutput');
        },
        terminalOutputElement() {
            return document.getElementById('terminalOutput');
        },
        rcloneCommandPreview: {
            get() {
                // This will be updated by updateRcloneCommandPreview method
                return this._rcloneCommandPreview || '';
            },
            set(value) {
                this._rcloneCommandPreview = value;
            }
        }
    }
});

app.mount('#app');

// Initial theme application
document.addEventListener('DOMContentLoaded', () => {
    app.applyTheme();
});
