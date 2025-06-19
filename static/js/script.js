// Vue.js Application
const app = Vue.createApp({
    data() {
        return {
            // UI State
            activeSection: 'rclone', // 'rclone', 'setup', 'terminal'
            showRecentCommandsModal: false,
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
        activeSection(newVal) {
            // Stop polling when switching away from terminal
            if (newVal !== 'terminal' && this.terminalPollInterval) {
                clearInterval(this.terminalPollInterval);
                this.terminalPollInterval = null;
            } else if (newVal === 'terminal' && !this.terminalPollInterval) {
                // Start polling when switching to terminal and not already polling
                this.startTerminalPolling();
            }
        },
        terminalProcessRunning(newVal) {
            if (newVal) {
                this.startTerminalPolling();
            } else {
                clearInterval(this.terminalPollInterval);
                this.terminalPollInterval = null;
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
    },
    methods: {
        // --- UI Toggling & Theme Management ---
        toggleSection(section) {
            this.activeSection = section;
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
            // Remove previous theme classes
            body.className = body.className.split(' ').filter(c => !c.startsWith('body-theme-') && !c.startsWith('theme-')).join(' ');
            
            // Apply new theme class to body
            body.classList.add(`body-${this.currentTheme}`);

            // Apply dark/light mode class
            if (this.darkMode) {
                body.classList.add('dark');
            } else {
                body.classList.remove('dark');
            }

            // Update CSS variables for dynamic styling. This requires the CSS to have :root and .dark rules.
            // For the header gradient, we use direct Tailwind classes on header, but dynamic CSS variables can
            // override the base colors if setup correctly. The approach in style.css directly uses CSS vars.
            // Here, we also set RGB values for focus rings if the CSS variable is used for that.
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
                document.documentElement.style.setProperty('--color-accent-rgb', rgb.join(','));
                document.documentElement.style.setProperty('--color-accent-glow', `rgba(${rgb.join(',')}, 0.4)`);
            }
        },


        // --- Rclone Mode Logic ---
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
        },
        toggleDestinationField() {
            const twoRemoteModes = ["sync", "copy", "move", "copyurl", "check", "cryptcheck"];
            this.showDestinationField = twoRemoteModes.includes(this.rcloneForm.mode);
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

            this.updateOutput(outputArea, { status: 'info', message: 'Uploading...' });

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
            this.updateOutput('majorStepsOutput', { status: 'info', message: 'Initiating Rclone transfer...' });

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
                                        this.rcloneLiveOutputElement.className = `output-area text-sm overflow-auto max-h-64 ${data.status === 'complete' ? 'success' : 'error'}`;
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
                        this.rcloneLiveOutputElement.className = `output-area text-sm overflow-auto max-h-64 ${data.status === 'complete' ? 'success' : 'error'}`;
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
                this.updateOutput('majorStepsOutput', { status: 'error', message: `Rclone transfer failed: ${error.message}` });
                this.rcloneLiveOutput += `Error: ${error.message}\n`;
                this.rcloneLiveOutputElement.className = 'output-area text-sm overflow-auto max-h-64 error';
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
            this.updateOutput('majorStepsOutput', { status: 'info', message: 'Stopping Rclone transfer not directly supported via UI. Please refresh page if needed.' });
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
            this.updateOutput('majorStepsOutput', { status: 'info', message: 'Executing terminal command...' });
            
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
                this.updateOutput('majorStepsOutput', { status: 'error', message: `Terminal command execution failed: ${error.message}` });
                this.hideTerminalSpinner();
            }
        },

        startTerminalPolling() {
            if (this.terminalPollInterval) {
                clearInterval(this.terminalPollInterval);
            }
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
                    this.updateOutput('majorStepsOutput', { status: 'complete', message: 'Terminal process finished.' });
                    console.log("Stopped terminal polling: process finished.");
                }
            } catch (error) {
                console.error("Error fetching terminal output:", error);
                this.updateOutput('majorStepsOutput', { status: 'error', message: `Failed to fetch terminal output: ${error.message}` });
                this.hideTerminalSpinner();
                clearInterval(this.terminalPollInterval);
                this.terminalPollInterval = null;
            }
        },

        async stopTerminalProcess() {
            this.showTerminalSpinner();
            this.updateOutput('majorStepsOutput', { status: 'info', message: 'Attempting to stop terminal process...' });
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
                this.updateOutput('majorStepsOutput', { status: 'error', message: `Failed to stop terminal process: ${error.message}` });
            } finally {
                this.hideTerminalSpinner();
            }
        },

        clearTerminalOutput() {
            this.terminalOutput = '';
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
            this.updateOutput('majorStepsOutput', { status: 'info', message: 'Rclone form populated from history.' });
        },

        copyToClipboard(text) {
            // Using execCommand for wider iframe compatibility
            const tempInput = document.createElement('textarea');
            tempInput.value = text;
            document.body.appendChild(tempInput);
            tempInput.select();
            try {
                document.execCommand('copy');
                this.updateOutput('majorStepsOutput', { status: 'success', message: 'Command copied to clipboard!' });
            } catch (err) {
                console.error('Could not copy text: ', err);
                this.updateOutput('majorStepsOutput', { status: 'error', message: 'Failed to copy command.' });
            }
            document.body.removeChild(tempInput);
        },

        // --- Generic Output Updater ---
        updateOutput(outputRef, data) {
            let targetOutput = '';
            let targetElement = null;

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

            if (targetElement) {
                targetElement.className = `output-area text-sm ${data.status === 'success' || data.status === 'complete' ? 'success' : data.status === 'error' ? 'error' : 'text-gray-700 dark:text-gray-300'}`;
                this.scrollToBottom(outputRef);
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
        }
    }
});

app.mount('#app');

// Initial theme application
document.addEventListener('DOMContentLoaded', () => {
    app.applyTheme();
});
