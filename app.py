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
RCLONE_CONFIG_PATH = os.path.join(BASE_CONFIG_DIR, 'rclone.conf')
SERVICE_ACCOUNT_DIR = BASE_CONFIG_DIR # Service accounts are now extracted into BASE_CONFIG_DIR
LOG_FILE = os.path.join('/tmp', 'rcloneLog.txt') # Use /tmp for ephemeral Rclone logs on Render (aggregated)
TERMINAL_LOG_FILE = os.path.join('/tmp', 'terminalLog.txt') # Use /tmp for ephemeral Terminal logs on Render (aggregated)
RCLONE_PROCESS_LOG_DIR = '/tmp/rclone_process_logs' # Directory for individual Rclone process logs

# Login Credentials
LOGIN_USERNAME = os.environ.get('LOGIN_USERNAME', 'admin')
LOGIN_PASSWORD = os.environ.get('LOGIN_PASSWORD', 'password') # IMPORTANT: Change in production!

# --- Utility Functions for Logging ---
def write_to_log(filename, content):
    """Appends content to a specified log file."""
    try:
        os.makedirs(os.path.dirname(filename), exist_ok=True) # Ensure directory exists
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

def read_full_log(filename):
    """Reads the entire content of a specified log file."""
    try:
        if not os.path.exists(filename):
            return ""
        with open(filename, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        print(f"Error reading full log from {filename}: {e}")
        return ""

# --- Ensure Directories Exist on Startup ---
def create_initial_dirs():
    """Creates necessary directories for the application."""
    os.makedirs(BASE_CONFIG_DIR, exist_ok=True)
    os.makedirs(RCLONE_PROCESS_LOG_DIR, exist_ok=True)
    # Ensure logs are cleared on startup for a fresh start each deployment/restart
    clear_log(LOG_FILE)
    clear_log(TERMINAL_LOG_FILE)
    
    # Clear any old individual Rclone process logs
    for f in os.listdir(RCLONE_PROCESS_LOG_DIR):
        os.remove(os.path.join(RCLONE_PROCESS_LOG_DIR, f))

    print(f"Directories created: {BASE_CONFIG_DIR}, {RCLONE_PROCESS_LOG_DIR}")
    print(f"Logs cleared: {LOG_FILE}, {TERMINAL_LOG_FILE}, individual Rclone process logs.")

# Call directory creation on app startup
with app.app_context():
    create_initial_dirs()

# --- Global Variables for Rclone and Terminal Processes ---
# Rclone process management: Dictionary to hold multiple background processes
# Key: process_id (timestamp), Value: {'process_obj': Popen_object, 'command': 'cmd', 'pid': int, 'status': 'running'|'completed'|'failed', 'log_file_path': 'path', 'stop_flag': Event}
active_rclone_processes = {}
rclone_lock = threading.Lock() # Protects active_rclone_processes

# Terminal process management: Dictionary to hold multiple background processes
# Key: process_id (timestamp), Value: {'process_obj': Popen_object, 'command': 'cmd', 'pid': int, 'status': 'running'|'completed'|'failed'}
active_terminal_processes = {}
terminal_lock = threading.Lock() # Protects active_terminal_processes


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
    return jsonify({"status": "error", "message": "Invalid file type. Please upload a .zip file."}), 500

# --- Rclone Functions (Updated for Background Execution) ---
def _stream_rclone_output_to_file(process_id, process_obj, process_log_file_path, aggregated_log_file_path, stop_flag):
    """Internal function to stream Rclone subprocess output to its specific file and the aggregated log."""
    clear_log(process_log_file_path) # Clear process-specific log before starting

    with rclone_lock:
        active_rclone_processes[process_id]['status'] = 'running'

    try:
        # Write command start to aggregated log
        command_str = " ".join(process_obj.args) if isinstance(process_obj.args, list) else process_obj.args
        write_to_log(aggregated_log_file_path, f"--- Rclone Command {process_id} (PID: {process_obj.pid}) Started: {command_str} ---")

        for line in iter(process_obj.stdout.readline, ''):
            line_stripped = line.strip()
            if line_stripped:
                write_to_log(process_log_file_path, line_stripped)
                write_to_log(aggregated_log_file_path, line_stripped)
            if stop_flag.is_set():
                break # Exit loop if stop flag is set

        process_obj.wait()
        return_code = process_obj.returncode
        with rclone_lock:
            if process_id in active_rclone_processes:
                if stop_flag.is_set():
                    active_rclone_processes[process_id]['status'] = 'stopped'
                    final_message = f"Rclone process {process_id} stopped by user."
                elif return_code == 0:
                    active_rclone_processes[process_id]['status'] = 'completed'
                    final_message = f"Rclone process {process_id} completed successfully."
                else:
                    active_rclone_processes[process_id]['status'] = 'failed'
                    final_message = f"Rclone process {process_id} failed with exit code {return_code}."
                
                # Write final status to aggregated log
                write_to_log(aggregated_log_file_path, f"--- Rclone Command {process_id} ({active_rclone_processes[process_id]['status']}): {final_message} ---")

    except Exception as e:
        with rclone_lock:
            if process_id in active_rclone_processes:
                active_rclone_processes[process_id]['status'] = 'failed'
                write_to_log(aggregated_log_file_path, f"--- Rclone Command {process_id} Failed (Error): {e} ---")
        print(f"Error streaming Rclone output for {process_id}: {e}")
    finally:
        # Do not remove process_log_file_path here, frontend might need to download it
        pass


@app.route('/execute-rclone', methods=['POST'])
@login_required
def execute_rclone():
    """Executes an Rclone command in the background."""
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
    serve_protocol = data.get('serve_protocol')

    cmd = ["rclone", mode]

    # Always include --config
    cmd.append(f"--config={RCLONE_CONFIG_PATH}")

    # Define command categories
    two_remote_modes = ["sync", "copy", "move", "check", "cryptcheck"]
    copyurl_mode = "copyurl"
    one_remote_modes = ["lsd", "ls", "tree", "mkdir", "size", "dedupe", "cleanup", "delete", "deletefile", "purge"]
    serve_mode = "serve"
    no_args_modes = ["listremotes", "version"]

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
        sa_files_exist = os.path.exists(SERVICE_ACCOUNT_DIR) and any(f.endswith('.json') for f in os.listdir(SERVICE_ACCOUNT_DIR))
        if use_service_account:
            if sa_files_exist:
                cmd.append(f"--drive-service-account-directory={SERVICE_ACCOUNT_DIR}")
            else:
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
        rclone_env['RCLONE_FAST_LIST'] = 'true'
        rclone_env['RCLONE_DRIVE_TPSLIMIT'] = '3'
        rclone_env['RCLONE_DRIVE_ACKNOWLEDGE_ABUSE'] = 'true'
        rclone_env['RCLONE_DRIVE_PACER_MIN_SLEEP'] = '50ms'
        rclone_env['RCLONE_DRIVE_PACER_BURST'] = '2'
        rclone_env['RCLONE_SERVER_SIDE_ACROSS_CONFIGS'] = 'true'

        # Always include --progress for live updates, unless it's a no-args mode
        cmd.append("--progress")
        cmd.append("--stats=3s") # Provide stats every 3 seconds
        cmd.append("--stats-one-line-date") # Single line stats with date

    process_id = str(time.time()) # Unique ID for this Rclone process
    process_log_file_path = os.path.join(RCLONE_PROCESS_LOG_DIR, f'rclone_process_{process_id}.txt')

    print(f"Executing Rclone command: {' '.join(cmd)} with process_id: {process_id}")

    try:
        # Create a new stop flag for this specific process
        stop_current_process_flag = threading.Event()
        
        process_obj = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, # Merge stdout and stderr
            universal_newlines=True,
            bufsize=1, # Line-buffered
            env=rclone_env if 'rclone_env' in locals() else os.environ.copy() # Pass environment variables if created
        )

        with rclone_lock:
            active_rclone_processes[process_id] = {
                'process_obj': process_obj,
                'command': ' '.join(cmd), # Store full command string
                'pid': process_obj.pid,
                'status': 'starting', # Will be updated to 'running' by the thread
                'log_file_path': process_log_file_path,
                'stop_flag': stop_current_process_flag # Store the specific stop flag
            }

        # Start a separate thread to consume output and write to log files
        threading.Thread(
            target=_stream_rclone_output_to_file,
            args=(process_id, process_obj, process_log_file_path, LOG_FILE, stop_current_process_flag),
            daemon=True # Daemon threads are terminated when the main program exits
        ).start()

        return jsonify({"status": "success", "message": f"Rclone command started with PID {process_obj.pid}.", "process_id": process_id})
    except FileNotFoundError:
        with rclone_lock:
            if process_id in active_rclone_processes:
                del active_rclone_processes[process_id]
        return jsonify({"status": "error", "message": "Rclone executable not found. Ensure it's installed and in PATH."}), 500
    except Exception as e:
        with rclone_lock:
            if process_id in active_rclone_processes:
                del active_rclone_processes[process_id] # Clean up if starting failed
        return jsonify({"status": "error", "message": f"Failed to execute command: {e}"}), 500

@app.route('/get_rclone_output/<process_id>', methods=['GET'])
@login_required
def get_rclone_output(process_id):
    """Returns the output for a specific Rclone process."""
    with rclone_lock:
        if process_id not in active_rclone_processes:
            return jsonify({"status": "error", "message": "Rclone process not found."}), 404
        
        process_info = active_rclone_processes[process_id]
        log_content = read_full_log(process_info['log_file_path'])
        is_running = process_info['process_obj'].poll() is None
        current_status = process_info['status']

        return jsonify({"status": "success", "output": log_content, "is_running": is_running, "process_status": current_status})


@app.route('/stop-rclone-process', methods=['POST'])
@login_required
def stop_rclone_process():
    """Terminates a specific active Rclone process by ID."""
    process_id = request.get_json().get('process_id')

    if not process_id:
        return jsonify({"status": "error", "message": "No process ID provided."}), 400

    with rclone_lock:
        if process_id in active_rclone_processes:
            process_info = active_rclone_processes[process_id]
            process_obj = process_info['process_obj']
            stop_flag = process_info['stop_flag']

            if process_obj.poll() is None: # If process is still running
                stop_flag.set() # Signal the streaming thread to stop
                process_obj.terminate() # Send SIGTERM
                process_obj.wait(timeout=5) # Wait for process to terminate
                if process_obj.poll() is None: # If still running after timeout, kill it
                    process_obj.kill()
                process_info['status'] = 'stopped' # Update status in our tracker
                return jsonify({"status": "success", "message": f"Rclone process {process_id} (PID: {process_info['pid']}) stopped."})
            else:
                return jsonify({"status": "info", "message": f"Rclone process {process_id} (PID: {process_info['pid']}) is not running."})
        return jsonify({"status": "error", "message": f"Rclone process {process_id} not found."}), 404

@app.route('/list_active_rclone_processes', methods=['GET'])
@login_required
def list_active_rclone_processes():
    """Returns a list of currently active (or recently completed) Rclone processes."""
    with rclone_lock:
        processes_for_frontend = []
        for p_id, p_info in active_rclone_processes.items():
            # Check if the process is still alive and update status if needed
            if p_info['process_obj'].poll() is not None and p_info['status'] == 'running':
                # Process has finished but status hasn't been updated by thread yet
                if p_info['process_obj'].returncode == 0:
                    p_info['status'] = 'completed'
                else:
                    p_info['status'] = 'failed'
            
            processes_for_frontend.append({
                'process_id': p_id,
                'command': p_info['command'],
                'pid': p_info['pid'],
                'status': p_info['status']
            })
        return jsonify({"status": "success", "processes": processes_for_frontend})


@app.route('/download-rclone-log', methods=['GET'])
@login_required
def download_rclone_log():
    """Allows downloading the full aggregated Rclone LOG_FILE as an attachment."""
    if os.path.exists(LOG_FILE):
        return Response(
            open(LOG_FILE, 'rb').read(),
            mimetype='text/plain',
            headers={"Content-Disposition": f"attachment;filename=rclone_webgui_aggregated_log_{time.strftime('%Y%m%d-%H%M%S')}.txt"}
        )
    return jsonify({"status": "error", "message": "Aggregated Rclone log file not found."}), 404

@app.route('/download_rclone_process_log/<process_id>', methods=['GET'])
@login_required
def download_rclone_process_log(process_id):
    """Allows downloading the log for a specific Rclone process."""
    with rclone_lock:
        if process_id not in active_rclone_processes:
            return jsonify({"status": "error", "message": "Rclone process log not found."}), 404
        
        process_info = active_rclone_processes[process_id]
        log_file_path = process_info['log_file_path']
        command_name = process_info['command'].split(' ')[1] # e.g., 'sync' from 'rclone sync'

        if os.path.exists(log_file_path):
            return Response(
                open(log_file_path, 'rb').read(),
                mimetype='text/plain',
                headers={"Content-Disposition": f"attachment;filename=rclone_{command_name}_log_{process_id}_{time.strftime('%Y%m%d-%H%M%S')}.txt"}
            )
        return jsonify({"status": "error", "message": "Specific Rclone process log file not found."}), 404


# --- Web Terminal Functions ---
def _stream_terminal_output_to_file(process_id, process_obj, aggregated_log_file_path):
    """Internal function to stream subprocess output to the aggregated terminal log file."""
    # Each terminal process will also have its own temporary log file for detailed viewing if needed
    process_log_file = os.path.join('/tmp', f'terminal_process_log_{process_id}.txt')
    clear_log(process_log_file) # Clear log before starting new stream

    with terminal_lock:
        if process_id in active_terminal_processes:
            active_terminal_processes[process_id]['status'] = 'running'

    try:
        # Write command start to aggregated log
        command_str = active_terminal_processes[process_id]['command']
        write_to_log(aggregated_log_file_path, f"--- Terminal Command {process_id} (PID: {process_obj.pid}) Started: {command_str} ---")
        
        for line in iter(process_obj.stdout.readline, ''):
            line_stripped = line.strip()
            if line_stripped:
                write_to_log(process_log_file, line_stripped) # Write to individual process log
                write_to_log(aggregated_log_file_path, line_stripped) # Write to aggregated log

            with terminal_lock: # Check stop flag from active_terminal_processes entry
                if process_id in active_terminal_processes and active_terminal_processes[process_id]['stop_flag'].is_set():
                    break

        process_obj.wait()
        return_code = process_obj.returncode
        with terminal_lock:
            if process_id in active_terminal_processes:
                if active_terminal_processes[process_id]['stop_flag'].is_set():
                    active_terminal_processes[process_id]['status'] = 'stopped'
                    final_message = f"Terminal process {process_id} stopped by user."
                elif return_code == 0:
                    active_terminal_processes[process_id]['status'] = 'completed'
                    final_message = f"Terminal process {process_id} completed successfully."
                else:
                    active_terminal_processes[process_id]['status'] = 'failed'
                    final_message = f"Terminal process {process_id} failed with exit code {return_code}."
                
                # Write final status to aggregated log
                write_to_log(aggregated_log_file_path, f"--- Terminal Command {process_id} ({active_terminal_processes[process_id]['status']}): {final_message} ---")
                # Clean up process_obj and stop_flag after completion, but keep metadata for list
                active_terminal_processes[process_id]['process_obj'] = None
                active_terminal_processes[process_id]['stop_flag'] = None


    except Exception as e:
        with terminal_lock:
            if process_id in active_terminal_processes:
                active_terminal_processes[process_id]['status'] = 'failed'
                write_to_log(aggregated_log_file_path, f"--- Terminal Command {process_id} Failed (Error): {e} ---")
        print(f"Error streaming terminal output for {process_id}: {e}")
    finally:
        # Clean up individual process log file
        if os.path.exists(process_log_file):
            os.remove(process_log_file)


@app.route('/execute_terminal_command', methods=['POST'])
@login_required
def execute_terminal_command():
    """Executes a terminal command in the background."""
    command = request.get_json().get('command')

    if not command:
        return jsonify({"status": "error", "message": "No command provided."}), 400

    process_id = str(time.time()) # Unique ID for this process

    try:
        # Create a new stop flag for this specific process
        stop_current_process_flag = threading.Event()
        
        process_obj = subprocess.Popen(
            command,
            shell=True, # Allows executing shell commands directly
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, # Merge stdout and stderr
            universal_newlines=True,
            bufsize=1 # Line-buffered
        )

        with terminal_lock:
            active_terminal_processes[process_id] = {
                'process_obj': process_obj,
                'command': command,
                'pid': process_obj.pid,
                'status': 'starting', # Will be updated to 'running' by the thread
                'stop_flag': stop_current_process_flag # Store the specific stop flag
            }

        # Start a separate thread to consume output and write to log file
        threading.Thread(
            target=_stream_terminal_output_to_file,
            args=(process_id, process_obj, TERMINAL_LOG_FILE),
            daemon=True # Daemon threads are terminated when the main program exits
        ).start()

        return jsonify({"status": "success", "message": f"Command '{command}' started with PID {process_obj.pid}.", "process_id": process_id})
    except Exception as e:
        with terminal_lock:
            if process_id in active_terminal_processes:
                del active_terminal_processes[process_id] # Clean up if starting failed
        return jsonify({"status": "error", "message": f"Failed to execute command: {e}"}), 500

@app.route('/get_terminal_output', methods=['GET'])
@login_required
def get_terminal_output():
    """Returns the full terminal output from the main aggregated log file and overall status."""
    output_content = read_full_log(TERMINAL_LOG_FILE)
    # Check if any terminal process is currently running
    any_running = False
    with terminal_lock:
        for p_info in active_terminal_processes.values():
            if p_info['process_obj'] and p_info['process_obj'].poll() is None:
                any_running = True
                break
    return jsonify({"status": "success", "output": output_content, "is_running": any_running})

@app.route('/stop_terminal_process', methods=['POST'])
@login_required
def stop_terminal_process():
    """Terminates a specific active terminal process by ID."""
    process_id = request.get_json().get('process_id')

    if not process_id:
        # If no process_id is provided, try to stop the *last initiated* running process
        # This is a fallback for the old frontend behavior if not updated to send process_id
        with terminal_lock:
            last_running_process_id = None
            for p_id in reversed(list(active_terminal_processes.keys())):
                p_info = active_terminal_processes[p_id]
                if p_info['process_obj'] and p_info['process_obj'].poll() is None:
                    last_running_process_id = p_id
                    break
            if last_running_process_id:
                process_id = last_running_process_id
            else:
                return jsonify({"status": "info", "message": "No terminal process is currently running to stop."})


    with terminal_lock:
        if process_id in active_terminal_processes:
            process_info = active_terminal_processes[process_id]
            process_obj = process_info.get('process_obj')
            stop_flag = process_info.get('stop_flag')

            if process_obj and process_obj.poll() is None: # If process is still running
                if stop_flag: # Signal the streaming thread to stop gracefully
                    stop_flag.set() 
                process_obj.terminate() # Send SIGTERM
                process_obj.wait(timeout=5) # Wait for process to terminate
                if process_obj.poll() is None: # If still running after timeout, kill it
                    process_obj.kill()
                process_info['status'] = 'stopped' # Update status
                process_info['process_obj'] = None # Clear Popen object reference
                process_info['stop_flag'] = None # Clear stop flag reference
                return jsonify({"status": "success", "message": f"Terminal process {process_id} (PID: {process_info['pid']}) stopped."})
            else:
                return jsonify({"status": "info", "message": f"Terminal process {process_id} (PID: {process_info['pid']}) is not running or already completed."})
        return jsonify({"status": "error", "message": f"Terminal process {process_id} not found."}), 404

@app.route('/list_active_terminal_processes', methods=['GET'])
@login_required
def list_active_terminal_processes():
    """Returns a list of currently active (or recently completed) terminal processes."""
    with terminal_lock:
        processes_for_frontend = []
        for p_id, p_info in list(active_terminal_processes.items()): # Iterate on a copy
            # Update status if process has finished but not yet updated by its thread
            if p_info['process_obj'] and p_info['process_obj'].poll() is not None and p_info['status'] == 'running':
                if p_info['process_obj'].returncode == 0:
                    p_info['status'] = 'completed'
                else:
                    p_info['status'] = 'failed'
                p_info['process_obj'] = None # Clean up reference
                p_info['stop_flag'] = None # Clean up reference

            processes_for_frontend.append({
                'process_id': p_id,
                'command': p_info['command'],
                'pid': p_info['pid'],
                'status': p_info['status']
            })
        return jsonify({"status": "success", "processes": processes_for_frontend})

@app.route('/download-terminal-log', methods=['GET'])
@login_required
def download_terminal_log():
    """Allows downloading the full aggregated Terminal LOG_FILE as an attachment."""
    if os.path.exists(TERMINAL_LOG_FILE):
        return Response(
            open(TERMINAL_LOG_FILE, 'rb').read(),
            mimetype='text/plain',
            headers={"Content-Disposition": f"attachment;filename=terminal_aggregated_log_{time.strftime('%Y%m%d-%H%M%S')}.txt"}
        )
    return jsonify({"status": "error", "message": "Aggregated Terminal log file not found."}), 404

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=os.environ.get('PORT', 5000))

