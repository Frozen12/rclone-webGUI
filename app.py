import os
import subprocess
import zipfile
import shutil
import json
import threading
import time
from datetime import timedelta
from flask import Flask, request, jsonify, render_template, redirect, url_for, session, send_from_directory, Response
from functools import wraps

# --- Flask Application Setup ---
app = Flask(__name__)
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'super-secret-key-replace-me')
app.permanent_session_lifetime = timedelta(minutes=360) # Remember user for 360 minutes

# --- Configuration Paths ---
UPLOAD_FOLDER = os.path.join(os.getcwd(), 'uploads') # Where rclone.conf and sa-accounts.zip are temporarily stored
RCLONE_CONFIG_DIR = os.path.join(os.getcwd(), '.config', 'rclone')
RCLONE_CONFIG_PATH = os.path.join(RCLONE_CONFIG_DIR, 'rclone.conf')
SERVICE_ACCOUNT_DIR = os.path.join(RCLONE_CONFIG_DIR, 'sa-accounts')
LOG_FILE = '/content/rcloneLog.txt' # Shared path as in colab script
TERMINAL_LOG_FILE = os.path.join(os.getcwd(), 'terminal_log.txt')

# --- Login Credentials from Environment Variables ---
LOGIN_USERNAME = os.environ.get('LOGIN_USERNAME', 'admin') # Default for local testing
LOGIN_PASSWORD = os.environ.get('LOGIN_PASSWORD', 'password') # Default for local testing

# --- Global variables for Web Terminal ---
terminal_process = None
terminal_output_buffer = []
terminal_lock = threading.Lock() # Protects access to terminal_process and terminal_output_buffer

# --- Rclone Environment Variables ---
os.environ['RCLONE_CONFIG'] = RCLONE_CONFIG_PATH
os.environ['RCLONE_FAST_LIST'] = 'true'
os.environ['RCLONE_DRIVE_TPSLIMIT'] = '3'
os.environ['RCLONE_DRIVE_ACKNOWLEDGE_ABUSE'] = 'true'
os.environ['RCLONE_LOG_FILE'] = LOG_FILE
os.environ['RCLONE_VERBOSE'] = '2'
os.environ['RCLONE_DRIVE_PACER_MIN_SLEEP'] = '50ms'
os.environ['RCLONE_DRIVE_PACER_BURST'] = '2'
os.environ['RCLONE_SERVER_SIDE_ACROSS_CONFIGS'] = 'true'


# --- Utility Functions ---
def ensure_dirs():
    """Ensures necessary directories exist."""
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    os.makedirs(RCLONE_CONFIG_DIR, exist_ok=True)
    os.makedirs(SERVICE_ACCOUNT_DIR, exist_ok=True)

def write_to_log(filename, content):
    """Appends content to a specified log file."""
    try:
        with open(filename, 'a') as f:
            f.write(content + '\n')
    except IOError as e:
        print(f"Error writing to log file {filename}: {e}")

def clear_log(filename):
    """Clears a specified log file."""
    try:
        if os.path.exists(filename):
            with open(filename, 'w') as f:
                f.truncate(0)
    except IOError as e:
        print(f"Error clearing log file {filename}: {e}")

def read_last_n_lines(filename, n):
    """Reads the last n meaningful (non-empty) lines from a log file."""
    try:
        if not os.path.exists(filename):
            return []
        with open(filename, 'r') as f:
            lines = [line.strip() for line in f if line.strip()] # Read and strip empty lines
            return lines[-n:]
    except IOError as e:
        print(f"Error reading log file {filename}: {e}")
        return []

# --- Authentication Decorator ---
def login_required(f):
    """Decorator to protect routes."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            if request.is_json:
                return jsonify({"status": "error", "message": "Unauthorized"}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- Routes ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    """Handles user login."""
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        if username == LOGIN_USERNAME and password == LOGIN_PASSWORD:
            session['logged_in'] = True
            session.permanent = True # Make the session permanent
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error='Invalid Credentials')
    return render_template('login.html')

@app.route('/logout')
def logout():
    """Handles user logout."""
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    """Renders the main application page."""
    return render_template('index.html')

@app.route('/upload-rclone-conf', methods=['POST'])
@login_required
def upload_rclone_conf():
    """Handles uploading rclone.conf."""
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file part"})
    file = request.files['file']
    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"})
    if file:
        try:
            file.save(RCLONE_CONFIG_PATH)
            return jsonify({"status": "success", "message": "rclone.conf uploaded successfully."})
        except Exception as e:
            return jsonify({"status": "error", "message": f"Error uploading rclone.conf: {e}"})
    return jsonify({"status": "error", "message": "Unknown error during upload."})

@app.route('/upload-sa-zip', methods=['POST'])
@login_required
def upload_sa_zip():
    """Handles uploading a ZIP file containing service account JSONs."""
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file part"})
    file = request.files['file']
    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"})
    if file and file.filename.endswith('.zip'):
        zip_path = os.path.join(UPLOAD_FOLDER, 'sa-accounts.zip')
        try:
            file.save(zip_path)

            # Clear existing JSON files in SERVICE_ACCOUNT_DIR
            for filename in os.listdir(SERVICE_ACCOUNT_DIR):
                if filename.endswith('.json'):
                    os.remove(os.path.join(SERVICE_ACCOUNT_DIR, filename))

            # Extract new ZIP contents
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(SERVICE_ACCOUNT_DIR)

            # Clean up the uploaded zip file
            os.remove(zip_path)

            return jsonify({"status": "success", "message": "Service account ZIP extracted successfully."})
        except zipfile.BadZipFile:
            return jsonify({"status": "error", "message": "Invalid ZIP file."})
        except Exception as e:
            return jsonify({"status": "error", "message": f"Error processing service account ZIP: {e}"})
    return jsonify({"status": "error", "message": "Please upload a valid .zip file."})


@app.route('/execute-rclone', methods=['POST'])
@login_required
def execute_rclone():
    """Executes an rclone command and streams output."""
    data = request.json
    mode = data.get('mode', 'sync')
    source = data.get('source', '')
    destination = data.get('destination', '')
    transfers = data.get('transfers', 2)
    checkers = data.get('checkers', 3)
    buffer_size = data.get('buffer_size', '16M')
    order = data.get('order', 'size,mixed,50')
    log_level = data.get('log_level', 'INFO') # Default to INFO if not provided
    additional_flags = data.get('additional_flags', '--azureblob-env-auth --crypt-pass-bad-blocks')
    use_drive_trash = data.get('use_drive_trash', False)
    service_account = data.get('service_account', False)
    dry_run = data.get('dry_run', False)

    cmd = ["rclone", mode]

    # Add source and destination based on mode
    one_remote_modes = [
        "lsd", "ls", "tree", "listremotes", "mkdir", "size", "serve", "dedupe",
        "cleanup", "checksum", "delete", "deletefile", "purge", "version"
    ]
    two_remote_modes = [
        "sync", "copy", "move", "copyurl", "check", "cryptcheck"
    ]

    if mode in two_remote_modes:
        if source: cmd.append(source)
        if destination: cmd.append(destination)
    elif mode in one_remote_modes:
        if source: cmd.append(source) # Source acts as path for one-remote commands
    else:
        # Default behavior for unknown modes - might need adjustment based on rclone behavior
        if source: cmd.append(source)
        if destination: cmd.append(destination)


    # Construct flags
    cmd.extend([
        f"--config={RCLONE_CONFIG_PATH}",
        f"--transfers={transfers}",
        f"--checkers={checkers}",
        f"--buffer-size={buffer_size}",
        f"--log-level={log_level}",
        f"--log-file={LOG_FILE}",
        "--progress",
        "--color=NEVER", # Disable color codes for cleaner parsing
        "--stats=3s",
        "--cutoff-mode=SOFT",
    ])

    if order:
        cmd.extend(["--order-by", order])

    # Colab script specific flags (ensure consistency if desired)
    # The colab script has these fixed:
    # "--drive-chunk-size="+str(Buffer_size) # this is duplicated by --buffer-size
    # "--max-transfer=749G" # This is a specific limit, consider making it configurable if needed
    # If the user wants specific values for these flags, they should be added to additional_flags.

    if use_drive_trash:
        cmd.append("--drive-use-trash=true")
    else:
        cmd.append("--drive-use-trash=false")

    if service_account:
        sa_files = [f for f in os.listdir(SERVICE_ACCOUNT_DIR) if f.endswith('.json')]
        if sa_files:
            # Rclone uses --drive-service-account-directory or --drive-service-account-file
            # The colab script picks a random SA file and renames it to credentials.json
            # For simplicity, we'll use the directory flag if SA files exist.
            cmd.append(f"--drive-service-account-directory={SERVICE_ACCOUNT_DIR}")
        else:
            # Warn if service account is checked but no files found
            return jsonify({"status": "error", "message": "Service account enabled but no JSON files found in SA directory."}), 400

    if dry_run:
        cmd.append("--dry-run")


    # Add additional flags
    if additional_flags:
        # Split by space and add, handling potential empty strings after split
        cmd.extend([flag for flag in additional_flags.split() if flag])

    print(f"Executing Rclone Command: {' '.join(cmd)}")
    clear_log(LOG_FILE) # Clear previous rclone log

    def generate():
        process = None
        try:
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, bufsize=1)
            full_output = []
            for line in iter(process.stdout.readline, ''):
                full_output.append(line.strip())
                write_to_log(LOG_FILE, line.strip()) # Write to log file
                yield json.dumps({"status": "progress", "output": line.strip()}) + '\n'
            process.wait()

            final_status = "complete" if process.returncode == 0 else "error"
            message = "Rclone command completed successfully." if final_status == "complete" else f"Rclone command failed with return code {process.returncode}."

            yield json.dumps({
                "status": final_status,
                "message": message,
                "output": "\n".join(read_last_n_lines(LOG_FILE, 50)) # Return last 50 lines of log
            }) + '\n'

        except FileNotFoundError:
            error_msg = "Rclone executable not found. Please ensure Rclone is installed and in your system's PATH."
            yield json.dumps({"status": "error", "message": error_msg, "output": error_msg}) + '\n'
        except Exception as e:
            error_msg = f"An unexpected error occurred during Rclone execution: {e}"
            yield json.dumps({"status": "error", "message": error_msg, "output": error_msg}) + '\n'
        finally:
            if process and process.poll() is None:
                process.terminate() # Ensure process is terminated if something goes wrong

    return Response(generate(), mimetype='application/json-lines')


@app.route('/download-logs')
@login_required
def download_logs():
    """Allows downloading the full LOG_FILE as an attachment."""
    if os.path.exists(LOG_FILE):
        return send_from_directory(os.path.dirname(LOG_FILE), os.path.basename(LOG_FILE), as_attachment=True)
    return jsonify({"status": "error", "message": "Rclone log file not found."}), 404

# --- Web Terminal Endpoints ---
@app.route('/execute_terminal_command', methods=['POST'])
@login_required
def execute_terminal_command():
    """Executes a terminal command."""
    global terminal_process, terminal_output_buffer
    command = request.json.get('command')
    force = request.json.get('force', False)

    if not command:
        return jsonify({"status": "error", "message": "No command provided."}), 400

    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            if not force:
                return jsonify({"status": "warning", "message": "Another process is running. Terminate it first or send 'force: true' to stop it."}), 409
            else:
                terminal_process.terminate()
                terminal_process.wait(timeout=5) # Give it some time to terminate
                if terminal_process.poll() is None: # If still running, kill it
                    terminal_process.kill()
                print("Terminated previous terminal process.")

        clear_log(TERMINAL_LOG_FILE) # Clear previous terminal log
        terminal_output_buffer = [] # Clear buffer for new command
        
        try:
            terminal_process = subprocess.Popen(
                command,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                bufsize=1 # Line-buffered output
            )
            # Start a non-blocking thread to read output
            threading.Thread(target=read_terminal_output_to_buffer, daemon=True).start()
            return jsonify({"status": "success", "message": "Command started."})
        except Exception as e:
            return jsonify({"status": "error", "message": f"Error executing command: {e}"}), 500

def read_terminal_output_to_buffer():
    """Reads stdout/stderr from terminal_process and appends to buffer and log file."""
    global terminal_process, terminal_output_buffer
    while terminal_process and terminal_process.poll() is None:
        try:
            line = terminal_process.stdout.readline()
            if line:
                with terminal_lock:
                    terminal_output_buffer.append(line.strip())
                    write_to_log(TERMINAL_LOG_FILE, line.strip())
            else:
                # If readline returns empty string, process might have finished
                if terminal_process.poll() is not None:
                    break
                time.sleep(0.01) # Small delay to prevent busy-waiting
        except ValueError:
            # Handle I/O operation on closed file if process terminates quickly
            break
        except Exception as e:
            print(f"Error reading terminal output: {e}")
            break
    print("Terminal output reader thread finished.")


@app.route('/get_terminal_output', methods=['GET'])
@login_required
def get_terminal_output():
    """Returns the last N lines of the terminal log file."""
    with terminal_lock:
        # Check if the process is still running. If not, consider it complete.
        is_running = terminal_process and terminal_process.poll() is None
        
        # Read from the log file to ensure persistence and correct line count
        output_lines = read_last_n_lines(TERMINAL_LOG_FILE, 100) # Get last 100 lines for frontend
        
        return jsonify({
            "status": "success", 
            "output": "\n".join(output_lines), 
            "is_running": is_running
        })


@app.route('/stop_terminal_process', methods=['POST'])
@login_required
def stop_terminal_process():
    """Terminates any active terminal_process."""
    global terminal_process
    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            try:
                terminal_process.terminate()
                terminal_process.wait(timeout=5) # Give it a few seconds to terminate gracefully
                if terminal_process.poll() is None: # If it's still alive, kill it
                    terminal_process.kill()
                return jsonify({"status": "success", "message": "Terminal process terminated."})
            except Exception as e:
                return jsonify({"status": "error", "message": f"Error terminating process: {e}"})
        else:
            return jsonify({"status": "info", "message": "No active terminal process to stop."})


# --- Application Startup ---
@app.before_first_request
def startup_tasks():
    """Tasks to run once when the application starts."""
    ensure_dirs()
    clear_log(LOG_FILE)
    clear_log(TERMINAL_LOG_FILE)
    print("Application started. Log files cleared and directories ensured.")

if __name__ == '__main__':
    # For local development, you can set these in your environment or a .env file
    # Example: export FLASK_SECRET_KEY='your_strong_secret_key'
    # Example: export LOGIN_USERNAME='myuser'
    # Example: export LOGIN_PASSWORD='mypassword'
    app.run(debug=True, host='0.0.0.0', port=5000)

