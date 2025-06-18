document.addEventListener('DOMContentLoaded', () => {
    const rcloneForm = document.getElementById('rcloneForm');
    const commandPreview = document.getElementById('commandPreview');
    const majorStepsOutput = document.getElementById('majorStepsOutput');
    const liveOutput = document.getElementById('liveOutput');
    const downloadLogsBtn = document.getElementById('downloadLogsBtn');

    // Range sliders
    const transfersSlider = document.getElementById('transfers');
    const transfersValue = document.getElementById('transfersValue');
    const checkersSlider = document.getElementById('checkers');
    const checkersValue = document.getElementById('checkersValue');

    transfersSlider.addEventListener('input', () => {
        transfersValue.textContent = transfersSlider.value;
        updateCommandPreview();
    });
    checkersSlider.addEventListener('input', () => {
        checkersValue.textContent = checkersSlider.value;
        updateCommandPreview();
    });

    // File upload toggles
    const toggleRcloneConfBtn = document.getElementById('toggleRcloneConf');
    const rcloneConfUploadDiv = document.getElementById('rcloneConfUpload');
    const rcloneConfFile = document.getElementById('rcloneConfFile');
    const uploadRcloneConfBtn = document.getElementById('uploadRcloneConfBtn');
    const rcloneConfStatus = document.getElementById('rcloneConfStatus');

    const toggleSaZipBtn = document.getElementById('toggleSaZip');
    const saZipUploadDiv = document.getElementById('saZipUpload');
    const saZipFile = document.getElementById('saZipFile');
    const uploadSaZipBtn = document.getElementById('uploadSaZipBtn');
    const saZipStatus = document.getElementById('saZipStatus');

    toggleRcloneConfBtn.addEventListener('click', () => {
        rcloneConfUploadDiv.classList.toggle('hidden');
    });
    toggleSaZipBtn.addEventListener('click', () => {
        saZipUploadDiv.classList.toggle('hidden');
    });

    // Upload Rclone Config
    uploadRcloneConfBtn.addEventListener('click', async () => {
        const file = rcloneConfFile.files[0];
        if (!file) {
            rcloneConfStatus.textContent = 'Please select a file.';
            rcloneConfStatus.className = 'mt-2 text-sm text-center text-red-500';
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        rcloneConfStatus.textContent = 'Uploading...';
        rcloneConfStatus.className = 'mt-2 text-sm text-center text-blue-500';

        try {
            const response = await fetch('/upload-rclone-conf', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.status === 'success') {
                rcloneConfStatus.textContent = data.message;
                rcloneConfStatus.className = 'mt-2 text-sm text-center text-green-500';
            } else {
                rcloneConfStatus.textContent = `Error: ${data.message}`;
                rcloneConfStatus.className = 'mt-2 text-sm text-center text-red-500';
            }
        } catch (error) {
            rcloneConfStatus.textContent = `Network error: ${error.message}`;
            rcloneConfStatus.className = 'mt-2 text-sm text-center text-red-500';
        }
    });

    // Upload SA ZIP
    uploadSaZipBtn.addEventListener('click', async () => {
        const file = saZipFile.files[0];
        if (!file) {
            saZipStatus.textContent = 'Please select a file.';
            saZipStatus.className = 'mt-2 text-sm text-center text-red-500';
            return;
        }

        const formData = new FormData();
        formData.append('file', file);

        saZipStatus.textContent = 'Uploading and extracting...';
        saZipStatus.className = 'mt-2 text-sm text-center text-blue-500';

        try {
            const response = await fetch('/upload-sa-zip', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (data.status === 'success') {
                saZipStatus.textContent = data.message;
                saZipStatus.className = 'mt-2 text-sm text-center text-green-500';
            } else {
                saZipStatus.textContent = `Error: ${data.message}`;
                saZipStatus.className = 'mt-2 text-sm text-center text-red-500';
            }
        } catch (error) {
            saZipStatus.textContent = `Network error: ${error.message}`;
            saZipStatus.className = 'mt-2 text-sm text-center text-red-500';
        }
    });

    // Function to update the command preview
    function updateCommandPreview() {
        const source = document.getElementById('source').value;
        const destination = document.getElementById('destination').value;
        const mode = document.getElementById('mode').value;
        const transfers = document.getElementById('transfers').value;
        const checkers = document.getElementById('checkers').value;
        const buffer_size = document.getElementById('buffer_size').value;
        const order = document.getElementById('order').value;
        const loglevel = document.getElementById('loglevel').value;
        const additional_flags = document.getElementById('additional_flags').value;
        const use_drive_trash = document.getElementById('use_drive_trash').checked;
        const service_account = document.getElementById('service_account').checked;
        const dry_run = document.getElementById('dry_run').checked;

        let cmdParts = [
            'rclone', mode,
            `"${source}"`, `"${destination}"`,
            `--transfers=${transfers}`,
            `--checkers=${checkers}`,
            `--buffer-size=${buffer_size}`,
            `--drive-chunk-size=${buffer_size}`, // Same as buffer_size
            `--drive-use-trash=${use_drive_trash}`,
            `--order-by="${order}"`,
            `--max-transfer=749G`,
            `--cutoff-mode=SOFT`,
            `--drive-acknowledge-abuse`
        ];

        // Add service account or S3 no head flag
        if (service_account) {
            cmdParts.push(`--drive-service-account-file=/app/.config/rclone/sa-accounts/credentials.json`); // Placeholder, actual file picked on backend
        } else {
            cmdParts.push(`--s3-no-head`);
        }

        // Add dry run or S3 no head object flag
        if (dry_run) {
            cmdParts.push(`--dry-run`);
        } else {
            cmdParts.push(`--s3-no-head-object`);
        }

        // Additional flags
        if (additional_flags) {
            cmdParts.push(additional_flags);
        }

        // Log level is handled internally by --verbose=X but can be shown here
        const loglevelMap = {"ERROR ": "0", "Info ": "1", "DEBUG": "2"};
        const verboseLevel = loglevelMap[loglevel.trim()];
        cmdParts.push(`--log-file=rclone_Transfer.txt`);
        cmdParts.push(`--verbose=${verboseLevel}`);
        cmdParts.push(`--progress`);
        cmdParts.push(`--color=NEVER`);
        cmdParts.push(`--stats=3s`);

        commandPreview.textContent = cmdParts.join(' ');
    }

    // Attach event listeners to all form fields for real-time update
    const formElements = rcloneForm.querySelectorAll('input, select');
    formElements.forEach(element => {
        element.addEventListener('input', updateCommandPreview);
        element.addEventListener('change', updateCommandPreview); // For checkboxes and selects
    });

    // Initial command preview update
    updateCommandPreview();

    // Handle form submission
    rcloneForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Clear previous outputs
        majorStepsOutput.innerHTML = '';
        liveOutput.innerHTML = '';
        downloadLogsBtn.style.display = 'none';
        majorStepsOutput.classList.remove('error-message', 'success-message');

        majorStepsOutput.innerHTML = '<p class="text-blue-600">🚀 Starting transfer...</p>';

        const formData = {
            source: document.getElementById('source').value,
            destination: document.getElementById('destination').value,
            mode: document.getElementById('mode').value,
            transfers: parseInt(document.getElementById('transfers').value),
            checkers: parseInt(document.getElementById('checkers').value),
            buffer_size: document.getElementById('buffer_size').value,
            order: document.getElementById('order').value,
            loglevel: document.getElementById('loglevel').value,
            additional_flags: document.getElementById('additional_flags').value,
            use_drive_trash: document.getElementById('use_drive_trash').checked,
            service_account: document.getElementById('service_account').checked,
            dry_run: document.getElementById('dry_run').checked
        };

        try {
            const response = await fetch('/execute-rclone', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';
            let lines = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split('\\n'); // Split by the custom newline marker
                buffer = parts.pop(); // Keep the last incomplete part in buffer

                for (const part of parts) {
                    if (part) {
                        try {
                            const message = JSON.parse(part);
                            if (message.status === 'start') {
                                // Already set "Starting transfer..."
                            } else if (message.status === 'progress') {
                                // Update live output box
                                liveOutput.innerHTML = message.output;
                                liveOutput.scrollTop = liveOutput.scrollHeight; // Scroll to bottom

                                // Check for ERROR in the latest line
                                if (message.latest_line && message.latest_line.toUpperCase().includes('ERROR')) {
                                    majorStepsOutput.innerHTML = `<p class="error-message">❌ Error detected: ${message.latest_line}</p>`;
                                }
                            } else if (message.status === 'complete') {
                                majorStepsOutput.innerHTML = `<p class="success-message">✅ Transfer completed successfully!</p>`;
                                downloadLogsBtn.style.display = 'block';
                            } else if (message.status === 'error') {
                                majorStepsOutput.innerHTML = `<p class="error-message">❌ Transfer failed: ${message.message}</p>`;
                                downloadLogsBtn.style.display = 'block';
                            }
                        } catch (e) {
                            console.error("Failed to parse JSON part:", part, e);
                        }
                    }
                }
            }
            if (buffer) { // Process any remaining content in buffer
                 try {
                    const message = JSON.parse(buffer);
                    if (message.status === 'complete') {
                        majorStepsOutput.innerHTML = `<p class="success-message">✅ Transfer completed successfully!</p>`;
                        downloadLogsBtn.style.display = 'block';
                    } else if (message.status === 'error') {
                        majorStepsOutput.innerHTML = `<p class="error-message">❌ Transfer failed: ${message.message}</p>`;
                        downloadLogsBtn.style.display = 'block';
                    }
                } catch (e) {
                    console.error("Failed to parse final JSON part:", buffer, e);
                }
            }


        } catch (error) {
            majorStepsOutput.innerHTML = `<p class="error-message">❌ An unexpected error occurred: ${error.message}</p>`;
            downloadLogsBtn.style.display = 'block';
            console.error("Fetch error:", error);
        }
    });

    // Set default values for sliders explicitly on load
    transfersValue.textContent = transfersSlider.value;
    checkersValue.textContent = checkersSlider.value;
});