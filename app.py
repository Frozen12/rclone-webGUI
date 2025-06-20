import os
import subprocess
import threading
import json
import time
from datetime import timedelta
from flask import Flask, render_template, request, jsonify, Response, redirect, url_for, session
from functools import wraps
import zipfile
import shutil
import re

app = Flask(__name__)

# --- Configuration (from Environment Variables for Render.com) ---
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'super-secret-key-please-change-me')
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=360) # Remember user for 6 hours

# Directories and Files
BASE_CONFIG_DIR = '/app/.config/rclone'
# UPLOAD_FOLDER is not explicitly used for conf/sa, but could be for other general uploads if needed
UPLOAD_FOLDER = os.path.join(BASE_CONFIG_DIR, 'uploads')
RCLONE_CONFIG_PATH = os.path.join(BASE_CONFIG_DIR, 'rclone.conf')
# SERVICE_ACCOUNT_DIR now points to the same location as BASE_CONFIG_DIR for SA JSONs
SERVICE_ACCOUNT_DIR = BASE_CONFIG_DIR
LOG_FILE = os.path.join('/tmp', 'rcloneLog.txt') # Use /tmp for ephemeral logs on Render
TERMINAL_LOG_FILE = os.path.join('/tmp', 'terminalLog.txt') # Use /tmp for ephemeral logs on Render

# Login Credentials
LOGIN_USERNAME = os.environ.get('LOGIN_USERNAME', 'admin')
LOGIN_PASSWORD = os.environ.get('LOGIN_PASSWORD', 'password') # IMPORTANT: Change in production!

# --- Utility Functions for Logging (Moved to top for early availability) ---
def write_to_log(filename, content):
    """Appends content to a specified log file."""
    try:
        with open(filename, 'a', encoding='utf-8') as f:
            f.write(content + '\n')
    except Exception as e:
        print(f"Error writing to log {filename}: {e}")

def clear_log(filename):
    """Clears the content of a specified log file."""
    try:
        if os.path.exists(filename):
            with open(filename, 'w', encoding='utf-8') as f:
                f.truncate(0) # Truncate to 0 bytes
    except Exception as e:
        print(f"Error clearing log {filename}: {e}")

def read_last_n_lines(filename, n):
    """Reads the last n meaningful (non-empty) lines from a log file."""
    try:
        if not os.path.exists(filename):
            return []
        with open(filename, 'r', encoding='utf-8') as f:
            lines = f.readlines()
            meaningful_lines = [line.strip() for line in lines if line.strip()]
            return meaningful_lines[-n:]
    except Exception as e:
        print(f"Error reading last {n} lines from {filename}: {e}")
        return []

# --- Ensure Directories Exist on Startup ---
def create_initial_dirs():
    """Creates necessary directories for the application."""
    os.makedirs(BASE_CONFIG_DIR, exist_ok=True)
    # SERVICE_ACCOUNT_DIR is now the same as BASE_CONFIG_DIR, so no separate creation needed

    # Ensure logs are cleared on startup for a fresh start each deployment/restart
    clear_log(LOG_FILE)
    clear_log(TERMINAL_LOG_FILE)
    print(f"Directories created: {BASE_CONFIG_DIR}")
    print(f"Logs cleared: {LOG_FILE}, {TERMINAL_LOG_FILE}")

# Call directory creation on app startup
with app.app_context():
    create_initial_dirs()

# --- Global Variables for Rclone and Terminal Processes ---
# Rclone process management
rclone_process = None
rclone_output_buffer = []
rclone_lock = threading.Lock() # Protects rclone_process and rclone_output_buffer
stop_rclone_flag = threading.Event() # Flag to signal rclone process to stop

# Terminal process management
terminal_process = None
terminal_output_buffer = []
terminal_lock = threading.Lock() # Protects terminal_process and terminal_output_buffer
stop_terminal_flag = threading.Event() # Flag to signal terminal process to stop

# --- Authentication Decorator ---
def login_required(f):
    """Decorator to protect routes requiring an active session."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            # If it's an API call, return JSON error
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest' or request.is_json:
                return jsonify({"status": "error", "message": "Unauthorized. Please log in."}), 401
            # Otherwise, redirect to login page
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- Routes ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    """Handles user login."""
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')

        if username == LOGIN_USERNAME and password == LOGIN_PASSWORD:
            session['logged_in'] = True
            session.permanent = True # Make the session permanent
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error="Invalid Credentials. Please try again.")
    return render_template('login.html')

@app.route('/logout')
def logout():
    """Handles user logout."""
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    """Renders the main Rclone WebGUI application page."""
    return render_template('index.html')

@app.route('/upload-rclone-conf', methods=['POST'])
@login_required
def upload_rclone_conf():
    """Uploads and replaces the rclone.conf file."""
    if 'rclone_conf' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400
    file = request.files['rclone_conf']
    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400
    if file:
        try:
            file.save(RCLONE_CONFIG_PATH)
            return jsonify({"status": "success", "message": f"rclone.conf uploaded successfully to {RCLONE_CONFIG_PATH}"})
        except Exception as e:
            return jsonify({"status": "error", "message": f"Failed to save rclone.conf: {e}"}), 500
    return jsonify({"status": "error", "message": "Unknown error"}), 500

@app.route('/upload-sa-zip', methods=['POST'])
@login_required
def upload_sa_zip():
    """Uploads and extracts service account JSONs from a ZIP file."""
    if 'sa_zip' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400
    file = request.files['sa_zip']
    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400
    if file and file.filename.endswith('.zip'):
        # Save the zip file directly in BASE_CONFIG_DIR as per request
        zip_path = os.path.join(BASE_CONFIG_DIR, 'sa-accounts.zip')
        try:
            file.save(zip_path)

            # Clear existing JSON files directly in BASE_CONFIG_DIR (now SERVICE_ACCOUNT_DIR)
            for filename in os.listdir(SERVICE_ACCOUNT_DIR):
                if filename.endswith('.json'):
                    os.remove(os.path.join(SERVICE_ACCOUNT_DIR, filename))

            # Extract new ZIP contents directly into BASE_CONFIG_DIR (now SERVICE_ACCOUNT_DIR)
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(SERVICE_ACCOUNT_DIR) # This extracts into /app/.config/rclone/

            os.remove(zip_path) # Clean up the temporary zip file
            return jsonify({"status": "success", "message": f"Service account ZIP extracted to {SERVICE_ACCOUNT_DIR}. Existing JSONs cleared."})
        except zipfile.BadZipFile:
            return jsonify({"status": "error", "message": "Invalid ZIP file."}), 400
        except Exception as e:
            return jsonify({"status": "error", "message": f"Failed to process service account ZIP: {e}"}), 500
    return jsonify({"status": "error", "message": "Invalid file type. Please upload a .zip file."}), 400

@app.route('/execute-rclone', methods=['POST'])
@login_required
def execute_rclone():
    """Executes an Rclone command as a subprocess and streams output."""
    global rclone_process, rclone_output_buffer
    with rclone_lock:
        if rclone_process and rclone_process.poll() is None:
            return jsonify({"status": "error", "message": "Rclone process already running. Please stop it first."}), 409

    data = request.get_json()
    mode = data.get('mode')
    source = data.get('source', '').strip()
    destination = data.get('destination', '').strip()
    transfers = data.get('transfers')
    checkers = data.get('checkers')
    buffer_size = data.get('buffer_size')
    order = data.get('order')
    loglevel = data.get('loglevel')
    additional_flags_str = data.get('additional_flags', '').strip()
    use_drive_trash = data.get('use_drive_trash')
    use_service_account = data.get('service_account')
    dry_run = data.get('dry_run')
    serve_protocol = data.get('serve_protocol') # New: serve protocol

    # Define command categories
    two_remote_modes = ["sync", "copy", "move", "check", "cryptcheck"]
    copyurl_mode = "copyurl"
    one_remote_modes = ["lsd", "ls", "tree", "mkdir", "size", "dedupe", "cleanup", "delete", "deletefile", "purge"]
    serve_mode = "serve"
    no_args_modes = ["listremotes", "version"]

    cmd = ["rclone", mode]

    # Handle command arguments based on mode
    if mode in two_remote_modes:
        if not source or not destination:
            return jsonify({"status": "error", "message": "Source and Destination are required for this mode."}), 400
        cmd.extend([source, destination])
    elif mode == copyurl_mode:
        if not source or not destination: # 'source' here is the URL
            return jsonify({"status": "error", "message": "URL and Destination are required for copyurl mode."}), 400
        cmd.extend([source, destination])
    elif mode in one_remote_modes:
        if not source: # 'source' here is the path/remote
            return jsonify({"status": "error", "message": "Source (path/remote) is required for this mode."}), 400
        cmd.append(source)
    elif mode == serve_mode:
        if not source or not serve_protocol: # 'source' here is the path to serve
            return jsonify({"status": "error", "message": "Serve protocol and Path to serve are required for serve mode."}), 400
        cmd.extend([serve_protocol, source])
    elif mode in no_args_modes:
        # No additional arguments needed for these modes
        pass
    else:
        return jsonify({"status": "error", "message": f"Unknown or unsupported Rclone mode: {mode}"}), 400

    # Add optional flags, apply only if mode isn't 'version' or 'listremotes'
    if mode not in ["version", "listremotes"]:
        if transfers:
            cmd.append(f"--transfers={transfers}")
        if checkers:
            cmd.append(f"--checkers={checkers}")
        if buffer_size:
            cmd.append(f"--buffer-size={buffer_size}")
            cmd.append(f"--drive-chunk-size={buffer_size}") # Also apply to drive-chunk-size
        if order:
            cmd.append(f"--order-by={order}")

        # Set log level based on dropdown selection
        loglevel_map = {"ERROR": "ERROR", "Info": "INFO", "DEBUG": "DEBUG"} # Rclone expects these string values
        cmd.append(f"--log-level={loglevel_map.get(loglevel, 'INFO')}")

        # Service Account
        # Check for service accounts directly in BASE_CONFIG_DIR (now SERVICE_ACCOUNT_DIR)
        if use_service_account and os.path.exists(SERVICE_ACCOUNT_DIR) and any(f.endswith('.json') for f in os.listdir(SERVICE_ACCOUNT_DIR)):
            cmd.append(f"--drive-service-account-directory={SERVICE_ACCOUNT_DIR}")
        elif use_service_account and not os.path.exists(SERVICE_ACCOUNT_DIR):
            return jsonify({"status": "error", "message": "Service account directory does not exist or is empty. Please upload service accounts."}), 400

        # Drive trash
        if use_drive_trash:
            cmd.append("--drive-use-trash")
        else:
            cmd.append("--drive-skip-gdocs=true") # Default to skip gdocs if trash is off, as a common safe flag

        # Dry run
        if dry_run:
            cmd.append("--dry-run")

        # Additional flags from input
        if additional_flags_str:
            # Split by space, but handle quoted arguments correctly
            flags_split = re.findall(r'(?:[^\s"]|"[^"]*")+', additional_flags_str)
            cmd.extend([flag.strip('"') for flag in flags_split]) # Remove quotes if present

        # Environment variables for rclone (as specified by user)
        rclone_env = os.environ.copy()
        rclone_env['RCLONE_CONFIG'] = RCLONE_CONFIG_PATH # This is redundant with --config but harmless
        rclone_env['RCLONE_FAST_LIST'] = 'true'
        rclone_env['RCLONE_DRIVE_TPSLIMIT'] = '3'
        rclone_env['RCLONE_DRIVE_ACKNOWLEDGE_ABUSE'] = 'true'
        rclone_env['RCLONE_LOG_FILE'] = LOG_FILE # This is also redundant with --log-file but harmless
        # Removed RCLONE_VERBOSE as it conflicts with --log-level
        rclone_env['RCLONE_DRIVE_PACER_MIN_SLEEP'] = '50ms'
        rclone_env['RCLONE_DRIVE_PACER_BURST'] = '2'
        rclone_env['RCLONE_SERVER_SIDE_ACROSS_CONFIGS'] = 'true'

        # Always include --progress for live updates, unless it's a no-args mode
        cmd.append("--progress")
        cmd.append("--stats=3s") # Provide stats every 3 seconds
        cmd.append("--stats-one-line-date") # Single line stats with date
    
    # Always include --config
    cmd.append(f"--config={RCLONE_CONFIG_PATH}")


    print(f"Executing Rclone command: {' '.join(cmd)}")
    clear_log(LOG_FILE) # Clear log before new execution

    # Generator function to stream output
    def generate_rclone_output():
        global rclone_process
        global rclone_output_buffer
        full_output = []
        stop_rclone_flag.clear() # Clear the stop flag for a new run

        try:
            with rclone_lock:
                rclone_process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, # Merge stdout and stderr
                    universal_newlines=True,
                    bufsize=1, # Line-buffered
                    env=rclone_env # Pass environment variables
                )

            for line in iter(rclone_process.stdout.readline, ''):
                if stop_rclone_flag.is_set():
                    rclone_process.terminate()
                    yield json.dumps({"status": "stopped", "message": "Rclone process stopped by user."}) + '\n'
                    break

                line_stripped = line.strip()
                if line_stripped:
                    write_to_log(LOG_FILE, line_stripped)
                    yield json.dumps({"status": "progress", "output": line_stripped}) + '\n'
                    full_output.append(line_stripped)

            rclone_process.wait()
            return_code = rclone_process.returncode
            final_status = "complete" if return_code == 0 else "error"
            final_message = "Rclone command completed successfully." if return_code == 0 else f"Rclone command failed with exit code {return_code}."
            final_output_lines = read_last_n_lines(LOG_FILE, 50) # Get last 50 lines for final summary

            yield json.dumps({
                "status": final_status,
                "message": final_message,
                "output": "\n".join(final_output_lines)
            }) + '\n'

        except FileNotFoundError:
            yield json.dumps({"status": "error", "message": "Rclone executable not found. Ensure it's installed and in PATH."}) + '\n'
        except Exception as e:
            yield json.dumps({"status": "error", "message": f"An unexpected error occurred: {e}"}) + '\n'
        finally:
            with rclone_lock:
                if rclone_process and rclone_process.poll() is None:
                    rclone_process.terminate() # Ensure process is terminated if loop breaks early
                rclone_process = None # Clear the global process variable

    return Response(generate_rclone_output(), mimetype='application/json-lines')

@app.route('/stop-rclone-process', methods=['POST'])
@login_required
def stop_rclone_process():
    """Terminates the active Rclone process."""
    global rclone_process
    with rclone_lock:
        if rclone_process and rclone_process.poll() is None:
            stop_rclone_flag.set() # Set the flag to signal termination
            rclone_process.terminate() # Send SIGTERM
            rclone_process.wait(timeout=5) # Wait for process to terminate
            if rclone_process.poll() is None: # If still running after timeout, kill it
                rclone_process.kill()
            rclone_process = None
            return jsonify({"status": "success", "message": "Rclone process stopped."})
        return jsonify({"status": "info", "message": "No Rclone process is currently running."})

@app.route('/download-rclone-log', methods=['GET']) # Renamed from /download-logs
@login_required
def download_rclone_log():
    """Allows downloading the full Rclone LOG_FILE as an attachment."""
    if os.path.exists(LOG_FILE):
        return Response(
            open(LOG_FILE, 'rb').read(),
            mimetype='text/plain',
            headers={"Content-Disposition": f"attachment;filename=rclone_webgui_log_{time.strftime('%Y%m%d-%H%M%S')}.txt"}
        )
    return jsonify({"status": "error", "message": "Rclone log file not found."}), 404

# --- Web Terminal Functions ---
def _stream_terminal_output_to_buffer(process, buffer, stop_flag):
    """Internal function to stream subprocess output to a buffer in a separate thread."""
    for line in iter(process.stdout.readline, ''):
        with terminal_lock:
            buffer.append(line.strip())
            # Optionally limit buffer size to prevent excessive memory usage
            if len(buffer) > 1000: # Keep last 1000 lines
                buffer.pop(0)
        write_to_log(TERMINAL_LOG_FILE, line.strip())
        if stop_flag.is_set():
            break
    process.wait() # Wait for the process to truly finish

@app.route('/execute_terminal_command', methods=['POST'])
@login_required
def execute_terminal_command():
    """Executes a terminal command."""
    global terminal_process, terminal_output_buffer
    command = request.get_json().get('command')

    if not command:
        return jsonify({"status": "error", "message": "No command provided."}), 400

    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            return jsonify({
                "status": "warning",
                "message": "A terminal process is already running. Do you want to stop it and start a new one?",
                "running_command": terminal_process.args # Show the current command
            }), 409 # Conflict status code

        # If a process was running and completed, clear its references
        if terminal_process and terminal_process.poll() is not None:
            terminal_process = None

        clear_log(TERMINAL_LOG_FILE) # Clear terminal log before new command
        terminal_output_buffer.clear() # Clear in-memory buffer

        try:
            stop_terminal_flag.clear() # Clear the stop flag for a new run
            terminal_process = subprocess.Popen(
                command,
                shell=True, # Allows executing shell commands directly
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                bufsize=1 # Line-buffered
            )
            # Start a separate thread to consume output
            threading.Thread(
                target=_stream_terminal_output_to_buffer, # Corrected: colon changed to comma
                args=(terminal_process, terminal_output_buffer, stop_terminal_flag),
                daemon=True # Daemon threads are terminated when the main program exits
            ).start()

            return jsonify({"status": "success", "message": f"Command '{command}' started."})
        except Exception as e:
            return jsonify({"status": "error", "message": f"Failed to execute command: {e}"}), 500

@app.route('/get_terminal_output', methods=['GET'])
@login_required
def get_terminal_output():
    """Returns the most recent terminal output."""
    with terminal_lock:
        # Check if the process is still running
        is_running = terminal_process and terminal_process.poll() is None
        # Get the last N lines from the log file, which is kept up-to-date by the streaming thread
        output_lines = read_last_n_lines(TERMINAL_LOG_FILE, 100) # Get last 100 lines for terminal display
        return jsonify({"status": "success", "output": "\n".join(output_lines), "is_running": is_running})

@app.route('/stop_terminal_process', methods=['POST'])
@login_required
def stop_terminal_process():
    """Terminates any active terminal process."""
    global terminal_process
    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            stop_terminal_flag.set() # Set the flag to signal termination
            terminal_process.terminate() # Send SIGTERM
            terminal_process.wait(timeout=5) # Wait for process to terminate
            if terminal_process.poll() is None: # If still running after timeout, kill it
                terminal_process.kill()
            terminal_process = None
            return jsonify({"status": "success", "message": "Terminal process stopped."})
        return jsonify({"status": "info", "message": "No terminal process is currently running."})

@app.route('/download-terminal-log', methods=['GET'])
@login_required
def download_terminal_log():
    """Allows downloading the full Terminal LOG_FILE as an attachment."""
    if os.path.exists(TERMINAL_LOG_FILE):
        return Response(
            open(TERMINAL_LOG_FILE, 'rb').read(),
            mimetype='text/plain',
            headers={"Content-Disposition": f"attachment;filename=terminal_log_{time.strftime('%Y%m%d-%H%M%S')}.txt"}
        )
    return jsonify({"status": "error", "message": "Terminal log file not found."}), 404

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=os.environ.get('PORT', 5000))
