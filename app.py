import os
import time
import subprocess
import json
import secrets
import threading
from collections import deque # For fixed-size Rclone output buffer
from flask import Flask, request, jsonify, render_template, send_file, redirect, url_for, make_response
from datetime import datetime, timedelta

app = Flask(__name__)
app.secret_key = secrets.token_hex(16) # For session management

# --- Rclone Path Definitions (Absolute Paths) ---
# This is the absolute base directory for all rclone configuration files.
RCLONE_BASE_CONFIG_DIR = '/app/.config/rclone'

# Specific paths derived from the base directory
RCLONE_CONF_PATH = os.path.join(RCLONE_BASE_CONFIG_DIR, 'rclone.conf')
RCLONE_SA_ACCOUNTS_DIR = os.path.join(RCLONE_BASE_CONFIG_DIR, 'sa-accounts') # This is where the JSONs will go

# Environment variables for Rclone (will be set before execution)
RCLONE_ENV = {
    'RCLONE_CONFIG': RCLONE_CONF_PATH, # Rclone will respect this ENV var
    'RCLONE_FAST_LIST': 'true',
    'RCLONE_DRIVE_TPSLIMIT': '3',
    'RCLONE_DRIVE_ACKNOWLEDGE_ABUSE': 'true',
    'RCLONE_LOG_FILE': os.path.join(os.getcwd(), 'rclone_Transfer.txt'), # Log in the application's current working directory
    'RCLONE_VERBOSE': '1',
    'RCLONE_DRIVE_PACER_MIN_SLEEP': '75ms',
    'RCLONE_DRIVE_PACER_BURST': '2',
    'RCLONE_SERVER_SIDE_ACROSS_CONFIGS': 'true'
}

# Ensure Rclone config directory and SA directory exist when the app starts
os.makedirs(RCLONE_BASE_CONFIG_DIR, exist_ok=True)
os.makedirs(RCLONE_SA_ACCOUNTS_DIR, exist_ok=True)

# --- Global variables for Web Terminal and Rclone Live Output ---
# WARNING: Running arbitrary commands via a web interface is a severe security risk.
# This feature should only be used in highly controlled, trusted environments.
terminal_output_buffer = [] # Stores all output for the web terminal
terminal_process = None
terminal_lock = threading.Lock() # To prevent concurrent command execution

# Deque for Rclone live output, keeping only the last 40 lines
RCLONE_LIVE_OUTPUT_LINES = 40
rclone_live_output_buffer = deque(maxlen=RCLONE_LIVE_OUTPUT_LINES)

# Function to run a shell command and stream its output to terminal_output_buffer
def run_command_in_background(command):
    global terminal_process
    global terminal_output_buffer
    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            terminal_output_buffer.append("ERROR: Another command is already running. Please wait for it to finish.\n")
            return

        terminal_output_buffer = [] # Clear buffer for new command
        terminal_output_buffer.append(f"$ {command}\n") # Echo command
        
        try:
            # Use shell=True and /bin/bash -i for basic interactivity.
            # This is NOT a full PTY, but allows for basic shell features.
            terminal_process = subprocess.Popen(
                ['/bin/bash', '-i', '-c', command], # Executes command in interactive bash shell
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                bufsize=1 # Line-buffered
            )
            # Read output in a separate thread to avoid blocking Flask
            def read_output():
                for line in iter(terminal_process.stdout.readline, ''):
                    terminal_output_buffer.append(line)
                terminal_process.wait() # Wait for process to terminate
                terminal_output_buffer.append(f"\n--- Command finished with exit code {terminal_process.returncode} ---\n")
                
                # Close stdin pipe explicitly when done
                if terminal_process.stdin:
                    terminal_process.stdin.close()

            thread = threading.Thread(target=read_output)
            thread.daemon = True # Allow main program to exit even if thread is running
            thread.start()

        except Exception as e:
            terminal_output_buffer.append(f"ERROR: Failed to start command: {e}\n")
            terminal_process = None


# --- Authentication ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')

        LOGIN_USERNAME = os.environ.get('LOGIN_USERNAME')
        LOGIN_PASSWORD = os.environ.get('LOGIN_PASSWORD')

        if username == LOGIN_USERNAME and password == LOGIN_PASSWORD:
            resp = make_response(redirect(url_for('index')))
            resp.set_cookie('logged_in', 'true', expires=datetime.now() + timedelta(days=7))
            return resp
        else:
            return render_template('login.html', error='Invalid credentials')
    return render_template('login.html', error=None)

@app.route('/logout')
def logout():
    resp = make_response(redirect(url_for('login')))
    resp.set_cookie('logged_in', '', expires=0) # Clear the cookie
    return resp

@app.before_request
def check_login():
    if request.path != '/login' and request.endpoint != 'static' and request.endpoint != 'logout':
        if not request.cookies.get('logged_in') == 'true':
            return redirect(url_for('login'))

# --- File Uploads ---
@app.route('/upload-rclone-conf', methods=['POST'])
def upload_rclone_conf():
    if 'file' not in request.files:
        return jsonify({'status': 'error', 'message': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'status': 'error', 'message': 'No selected file'}), 400
    if file:
        try:
            file.save(RCLONE_CONF_PATH)
            # Check if file exists after saving
            if os.path.exists(RCLONE_CONF_PATH):
                return jsonify({'status': 'success', 'message': f'rclone.conf uploaded successfully to {RCLONE_CONF_PATH}'})
            else:
                return jsonify({'status': 'error', 'message': 'Failed to save rclone.conf (file not found after save)'}), 500
        except Exception as e:
            return jsonify({'status': 'error', 'message': f'Error saving rclone.conf: {str(e)}'}), 500
    return jsonify({'status': 'error', 'message': 'Failed to upload rclone.conf (unknown error)'}), 500

@app.route('/upload-sa-zip', methods=['POST'])
def upload_sa_zip():
    if 'file' not in request.files:
        return jsonify({'status': 'error', 'message': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'status': 'error', 'message': 'No selected file'}), 400
    if file:
        sa_zip_path = os.path.join(RCLONE_BASE_CONFIG_DIR, 'sa-accounts.zip')
        try:
            file.save(sa_zip_path)
            
            # Check if zip file exists before proceeding
            if not os.path.exists(sa_zip_path):
                return jsonify({'status': 'error', 'message': f'Failed to save SA ZIP to {sa_zip_path} (file not found after save)'}), 500

            # Clear existing SA files from the sa-accounts subdirectory
            for f in os.listdir(RCLONE_SA_ACCOUNTS_DIR):
                if f.endswith('.json'):
                    os.remove(os.path.join(RCLONE_SA_ACCOUNTS_DIR, f))
            
            # Extract the zip directly into RCLONE_BASE_CONFIG_DIR
            # This will create the 'sa-accounts' folder (from within the zip) inside RCLONE_BASE_CONFIG_DIR
            subprocess.run(['unzip', '-qq', '-o', sa_zip_path, '-d', RCLONE_BASE_CONFIG_DIR], check=True)
            
            # Delete the zip file after extraction
            os.remove(sa_zip_path)

            # Verify extraction by checking if the directory is no longer empty
            if not os.listdir(RCLONE_SA_ACCOUNTS_DIR):
                return jsonify({'status': 'error', 'message': f'SA ZIP extracted, but {RCLONE_SA_ACCOUNTS_DIR} is empty. Check zip contents (expected "sa-accounts/" folder).'}), 500

            return jsonify({'status': 'success', 'message': f'Service Account ZIP extracted to {RCLONE_SA_ACCOUNTS_DIR} and original zip deleted successfully.'})
        except subprocess.CalledProcessError as e:
            return jsonify({'status': 'error', 'message': f'Failed to extract SA ZIP: {e}'}), 500
        except Exception as e:
            return jsonify({'status': 'error', 'message': f'An error occurred during SA extraction: {e}'}), 500
    return jsonify({'status': 'error', 'message': 'Failed to upload SA ZIP (unknown error)'}), 500

# --- Rclone Command Execution ---
@app.route('/execute-rclone', methods=['POST'])
def execute_rclone():
    data = request.json
    source = data.get('source')
    destination = data.get('destination')
    mode = data.get('mode')
    transfers = data.get('transfers')
    checkers = data.get('checkers')
    buffer_size = data.get('buffer_size')
    order = data.get('order')
    loglevel = data.get('loglevel')
    additional_flags = data.get('additional_flags', '')
    use_drive_trash = data.get('use_drive_trash')
    service_account = data.get('service_account')
    dry_run = data.get('dry_run')

    # Ensure rclone.conf exists before attempting transfer
    if not os.path.exists(RCLONE_CONF_PATH):
        return jsonify({'status': 'error', 'message': f'rclone.conf not found at {RCLONE_CONF_PATH}. Please upload it via Setup.'}), 400

    # Command construction
    cmd = ["rclone", mode]

    # Add source/destination based on mode type
    one_remote_modes = ['lsd', 'ls', 'tree', 'serve', 'mkdir', 'listremotes']
    if mode in one_remote_modes:
        if not source: # 'source' here is actually 'remote' for one-remote commands
            return jsonify({'status': 'error', 'message': 'Remote path is required for this mode.'}), 400
        cmd.append(source)
    else: # Two-remote commands
        if not source or not destination:
            return jsonify({'status': 'error', 'message': 'Source and Destination paths are required for this mode.'}), 400
        cmd.append(source)
        cmd.append(destination)
    
    # Add optional flags dynamically
    flags_to_add = [
        f"--config={RCLONE_CONF_PATH}",
        f"--log-file={RCLONE_ENV['RCLONE_LOG_FILE']}",
        f"--verbose={loglevel_map.get(loglevel.strip(), '1')}",
        "--progress",
        "--color=NEVER",
        "--stats=3s",
        f"--transfers={transfers}",
        f"--checkers={checkers}",
        f"--buffer-size={buffer_size}M", # Ensure 'M' for megabytes
        f"--drive-chunk-size={buffer_size}M", # Ensure 'M' for megabytes
        f"--drive-use-trash={'true' if use_drive_trash else 'false'}",
        "--order-by", order,
        "--max-transfer=749G",
        "--cutoff-mode=SOFT",
        "--drive-acknowledge-abuse",
    ]

    if service_account:
        sa_files = [f for f in os.listdir(RCLONE_SA_ACCOUNTS_DIR) if f.endswith('.json')]
        if sa_files:
            MIXURE = str((os.getpid() + int(time.time())) % len(sa_files)) # Simple rotation
            selected_sa = os.path.join(RCLONE_SA_ACCOUNTS_DIR, sa_files[int(MIXURE) % len(sa_files)])
            if not os.path.exists(selected_sa):
                return jsonify({'status': 'error', 'message': f'Selected service account file not found: {selected_sa}'}), 400
            flags_to_add.append(f"--drive-service-account-file={selected_sa}")
        else:
            return jsonify({'status': 'error', 'message': f'No service account files found in {RCLONE_SA_ACCOUNTS_DIR}. Please upload SA ZIP via Setup.'}), 400
    
    if dry_run:
        flags_to_add.append("--dry-run")
    
    if additional_flags:
        flags_to_add.extend(additional_flags.split())

    cmd.extend(flags_to_add)

    # Clear previous Rclone live output
    rclone_live_output_buffer.clear()

    try:
        if os.path.exists(RCLONE_ENV['RCLONE_LOG_FILE']):
            os.remove(RCLONE_ENV['RCLONE_LOG_FILE'])

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, bufsize=1, env=os.environ.copy())
        
        def generate():
            yield json.dumps({"status": "start", "message": "Transfer started. Check Rclone Live Transfer Progress."}) + "\\n"
            
            while True:
                line = process.stdout.readline()
                if not line and process.poll() is not None:
                    break
                if line:
                    line = line.strip()
                    rclone_live_output_buffer.append(line) # Add to deque
                    
                    yield json.dumps({
                        "status": "progress",
                        "output": "\\n".join(rclone_live_output_buffer), # Send the buffered lines
                        "latest_line": line
                    }) + "\\n"
                time.sleep(0.05) # Small delay to prevent too frequent updates and high CPU

            process.wait()
            if process.returncode == 0:
                final_msg = "Transfer completed successfully!"
                status = "complete"
            else:
                final_msg = f"Transfer failed with return code: {process.returncode}"
                status = "error"
            
            # Send final status and full buffer content
            yield json.dumps({"status": status, "message": final_msg, "output": "\\n".join(rclone_live_output_buffer)}) + "\\n"

        return app.response_class(generate(), mimetype='application/json')

    except Exception as e:
        import traceback
        return jsonify({"status": "error", "message": f"An unexpected error occurred: {str(e)}\\n{traceback.format_exc()}"}), 500

@app.route('/download-logs')
def download_logs():
    log_file_path = RCLONE_ENV['RCLONE_LOG_FILE']
    if os.path.exists(log_file_path):
        return send_file(log_file_path, as_attachment=True, download_name='rclone_Transfer.txt', mimetype='text/plain')
    return jsonify({'status': 'error', 'message': 'Log file not found'}), 404

# --- Web Terminal Endpoints ---
@app.route('/execute_terminal_command', methods=['POST'])
def execute_terminal_command():
    command = request.json.get('command')
    if not command:
        return jsonify({'status': 'error', 'output': 'No command provided.'})

    # Execute command in background thread
    threading.Thread(target=run_command_in_background, args=(command,)).start()
    return jsonify({'status': 'success', 'message': 'Command started. Polling for output...'})

@app.route('/get_terminal_output', methods=['GET'])
def get_terminal_output():
    global terminal_output_buffer
    global terminal_process
    with terminal_lock:
        output = "".join(terminal_output_buffer)
        # Clear buffer after sending to avoid re-sending old data on next poll
        terminal_output_buffer = [] 
        
        status = "running" if terminal_process and terminal_process.poll() is None else "idle"
        return jsonify({'status': status, 'output': output})

@app.route('/stop_terminal_process', methods=['POST'])
def stop_terminal_process():
    global terminal_process
    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            try:
                terminal_process.terminate() # or .kill() for stronger termination
                terminal_process.wait(timeout=5)
                return jsonify({'status': 'success', 'message': 'Terminal process terminated.'})
            except Exception as e:
                return jsonify({'status': 'error', 'message': f'Failed to terminate process: {str(e)}'})
        return jsonify({'status': 'info', 'message': 'No terminal process running.'})

# --- Rclone Live Output Polling (for Rclone Transfer Progress) ---
@app.route('/get_rclone_live_output', methods=['GET'])
def get_rclone_live_output():
    # This is for polling the Rclone transfer output from the main page
    return jsonify({'output': "\\n".join(rclone_live_output_buffer)})


@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    # Initialize loglevel_map here as it's used in execute_rclone
    loglevel_map = {"ERROR ": "0", "Info ": "1", "DEBUG": "2"} 
    for key, value in RCLONE_ENV.items():
        os.environ[key] = value
    
    app.run(host='0.0.0.0', port=os.environ.get('PORT', 5000), debug=True)
