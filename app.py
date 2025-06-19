import os
import time
import subprocess
import json
import secrets
import threading # For basic non-blocking terminal command execution
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

# Global variables for the simple Web Terminal (NOT production-grade interactive shell)
# WARNING: Running arbitrary commands via a web interface is a severe security risk.
# This feature should only be used in highly controlled, trusted environments.
terminal_output_buffer = []
terminal_process = None
terminal_lock = threading.Lock() # To prevent concurrent command execution

def run_command_in_background(command):
    global terminal_process
    global terminal_output_buffer
    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            terminal_output_buffer.append("ERROR: Another command is already running.\n")
            return

        terminal_output_buffer = [] # Clear buffer for new command
        try:
            # Use shell=True for convenience, but be aware of shell injection risks
            # For interactive terminal-like behavior, this is simpler
            terminal_process = subprocess.Popen(
                command,
                shell=True,
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

@app.before_request
def check_login():
    if request.path != '/login' and request.endpoint != 'static':
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
        file.save(RCLONE_CONF_PATH)
        # Check if file exists after saving
        if os.path.exists(RCLONE_CONF_PATH):
            return jsonify({'status': 'success', 'message': f'rclone.conf uploaded successfully to {RCLONE_CONF_PATH}'})
        else:
            return jsonify({'status': 'error', 'message': 'Failed to save rclone.conf (file not found after save)'}), 500
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
        file.save(sa_zip_path)
        
        # Check if zip file exists before proceeding
        if not os.path.exists(sa_zip_path):
             return jsonify({'status': 'error', 'message': f'Failed to save SA ZIP to {sa_zip_path} (file not found after save)'}), 500

        try:
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
                return jsonify({'status': 'error', 'message': f'SA ZIP extracted, but {RCLONE_SA_ACCOUNTS_DIR} is empty. Check zip contents.'}), 500

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

    transfersC = f"--transfers={transfers}"
    checkersC = f"--checkers={checkers}"
    bufferS = f"--buffer-size={buffer_size}"
    driveCS = f"--drive-chunk-size={buffer_size}" 

    driveT = "--drive-use-trash=true" if use_drive_trash else "--drive-use-trash=false"

    serviceA_flag = ""
    if service_account:
        sa_files = [f for f in os.listdir(RCLONE_SA_ACCOUNTS_DIR) if f.endswith('.json')]
        if sa_files:
            MIXURE = str((os.getpid() + int(time.time())) % len(sa_files)) if sa_files else '0'
            selected_sa = os.path.join(RCLONE_SA_ACCOUNTS_DIR, sa_files[int(MIXURE) % len(sa_files)])
            # Verify selected SA file exists
            if not os.path.exists(selected_sa):
                return jsonify({'status': 'error', 'message': f'Selected service account file not found: {selected_sa}'}), 400
            serviceA_flag = f"--drive-service-account-file={selected_sa}"
        else:
            return jsonify({'status': 'error', 'message': f'No service account files found in {RCLONE_SA_ACCOUNTS_DIR}. Please upload SA ZIP via Setup.'}), 400
    else:
        serviceA_flag = "" # Ensure no SA flag if not used

    dryR = "--dry-run" if dry_run else "" # Only add dry-run if true

    loglevel_map = {"ERROR ": "0", "Info ": "1", "DEBUG": "2"}
    verbose_level = loglevel_map.get(loglevel.strip(), "1")

    cmd = ["rclone", mode, source, destination]
    if additional_flags:
        cmd.extend(additional_flags.split())
    
    # Add flags dynamically
    flags_to_add = [
        f"--config={RCLONE_CONF_PATH}", # Explicitly specify config path
        f"--log-file={RCLONE_ENV['RCLONE_LOG_FILE']}",
        f"--verbose={verbose_level}",
        "--progress",
        "--color=NEVER",
        "--stats=3s",
        transfersC,
        checkersC,
        bufferS,
        driveCS,
        driveT,
        "--order-by", order,
        "--max-transfer=749G",
        "--cutoff-mode=SOFT",
        "--drive-acknowledge-abuse",
    ]

    if serviceA_flag: # Only add if a service account is being used
        flags_to_add.append(serviceA_flag)
    if dryR: # Only add if dry_run is true
        flags_to_add.append(dryR)

    cmd.extend(flags_to_add)

    try:
        if os.path.exists(RCLONE_ENV['RCLONE_LOG_FILE']):
            os.remove(RCLONE_ENV['RCLONE_LOG_FILE'])

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, bufsize=1, env=os.environ.copy())
        
        def generate():
            yield json.dumps({"status": "start", "message": "Transfer started."}) + "\\n"
            
            lines_buffer = []
            while True:
                line = process.stdout.readline()
                if not line and process.poll() is not None:
                    break
                if line:
                    line = line.strip()
                    lines_buffer.append(line)
                    if len(lines_buffer) > 30: # Keep buffer small for frontend display
                        lines_buffer.pop(0)
                    
                    yield json.dumps({
                        "status": "progress",
                        "output": "\\n".join(lines_buffer),
                        "latest_line": line
                    }) + "\\n"
                time.sleep(0.05) # Small delay to prevent too frequent updates and high CPU

            process.wait()
            if process.returncode == 0:
                yield json.dumps({"status": "complete", "message": "Transfer completed successfully!"}) + "\\n"
            else:
                yield json.dumps({"status": "error", "message": f"Transfer failed with return code: {process.returncode}"}) + "\\n"

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

@app.route('/execute_terminal_command', methods=['POST'])
def execute_terminal_command():
    command = request.json.get('command')
    if not command:
        return jsonify({'status': 'error', 'output': 'No command provided.'})

    run_command_in_background(command)
    return jsonify({'status': 'success', 'message': 'Command started.'})

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


@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    for key, value in RCLONE_ENV.items():
        os.environ[key] = value
    
    app.run(host='0.0.0.0', port=os.environ.get('PORT', 5000), debug=True)
