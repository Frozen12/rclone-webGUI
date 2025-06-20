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
import signal # Import signal module

app = Flask(__name__)

# --- Configuration (from Environment Variables for Render.com) ---
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'super-secret-key-please-change-me')
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=360) # Remember user for 6 hours

# Directories and Files
BASE_CONFIG_DIR = '/app/.config/rclone'
RCLONE_CONFIG_PATH = os.path.join(BASE_CONFIG_DIR, 'rclone.conf')
SERVICE_ACCOUNT_DIR = BASE_CONFIG_DIR # SA JSONs directly in BASE_CONFIG_DIR
LOG_FILE = os.path.join('/tmp', 'rcloneLog.txt') # Use /tmp for ephemeral logs on Render
TERMINAL_LOG_FILE = os.path.join('/tmp', 'terminalLog.txt') # Use /tmp for ephemeral logs on Render

# --- User Data Storage Directory ---
# This directory will hold user-specific notepad and recent command history files.
# IMPORTANT: Data here is ephemeral in containerized environments (e.g., Render.com)
# and will be lost on container restarts/redeployments.
SESSION_DATA_DIR = '/app/session-data'

# Login Credentials
LOGIN_USERNAME = os.environ.get('LOGIN_USERNAME', 'admin')
LOGIN_PASSWORD = os.environ.get('LOGIN_PASSWORD', 'password') # IMPORTANT: Change in production!

# --- Utility Functions for Logging and File Management ---
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

def get_user_data_path(filename):
    """Constructs the full path for a user-specific data file."""
    username = session.get('username')
    if not username:
        return None # Should not happen if @login_required is used properly
    user_dir = os.path.join(SESSION_DATA_DIR, username)
    os.makedirs(user_dir, exist_ok=True) # Ensure user directory exists
    return os.path.join(user_dir, filename)

# --- Ensure Directories Exist on Startup ---
def create_initial_dirs():
    """Creates necessary directories for the application and ephemeral logs."""
    os.makedirs(BASE_CONFIG_DIR, exist_ok=True)
    os.makedirs(SESSION_DATA_DIR, exist_ok=True) # Create session data root
    # SERVICE_ACCOUNT_DIR is now the same as BASE_CONFIG_DIR, so no separate creation needed

    # Ensure logs are cleared on startup for a fresh start each deployment/restart
    clear_log(LOG_FILE)
    clear_log(TERMINAL_LOG_FILE)
    print(f"Directories created: {BASE_CONFIG_DIR}, {SESSION_DATA_DIR}")
    print(f"Logs cleared: {LOG_FILE}, {TERMINAL_LOG_FILE}")

# Call directory creation on app startup
with app.app_context():
    create_initial_dirs()

# --- Global Variables for Rclone and Terminal Processes ---
# Rclone process management
rclone_process = None
rclone_lock = threading.Lock() # Protects rclone_process
stop_rclone_flag = threading.Event() # Flag to signal rclone process to stop

# Terminal process management
terminal_process = None
terminal_lock = threading.Lock() # Protects terminal_process
stop_terminal_flag = threading.Event() # Flag to signal terminal process to stop

# --- Authentication Decorator ---
def login_required(f):
    """Decorator to protect routes requiring an active session."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session or 'username' not in session:
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
            session['username'] = username # Store username in session
            session.permanent = True # Make the session permanent
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error="Invalid Credentials. Please try again.")
    return render_template('login.html')

@app.route('/logout')
def logout():
    """Handles user logout."""
    session.pop('logged_in', None)
    session.pop('username', None)
    return redirect(url_for('login'))

@app.route('/get_username')
@login_required
def get_username():
    """Returns the current username."""
    return jsonify({"username": session.get('username')})


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
        zip_path = os.path.join(BASE_CONFIG_DIR, 'sa-accounts.zip')
        try:
            file.save(zip_path)

            # Clear existing JSON files directly in SERVICE_ACCOUNT_DIR
            for filename in os.listdir(SERVICE_ACCOUNT_DIR):
                if filename.endswith('.json'):
                    os.remove(os.path.join(SERVICE_ACCOUNT_DIR, filename))

            # Extract new ZIP contents directly into SERVICE_ACCOUNT_DIR
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(SERVICE_ACCOUNT_DIR)

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
    global rclone_process
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
        # Check for service accounts directly in SERVICE_ACCOUNT_DIR
        if use_service_account and os.path.exists(SERVICE_ACCOUNT_DIR) and any(f.endswith('.json') for f in os.listdir(SERVICE_ACCOUNT_DIR)):
            cmd.append(f"--drive-service-account-directory={SERVICE_ACCOUNT_DIR}")
        elif use_service_account and not os.path.exists(SERVICE_ACCOUNT_DIR):
            # This should be a user-visible error rather than a backend crash
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
        rclone_env['RCLONE_CONFIG'] = RCLONE_CONFIG_PATH
        rclone_env['RCLONE_FAST_LIST'] = 'true'
        rclone_env['RCLONE_DRIVE_TPSLIMIT'] = '3'
        rclone_env['RCLONE_DRIVE_ACKNOWLEDGE_ABUSE'] = 'true'
        rclone_env['RCLONE_LOG_FILE'] = LOG_FILE
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
        full_output_lines = [] # Collect all lines for final output

        stop_rclone_flag.clear() # Clear the stop flag for a new run

        try:
            with rclone_lock:
                # Use preexec_fn=os.setsid to make the child process a session leader
                # This ensures that signals sent to the process group (like SIGTERM) are handled correctly.
                rclone_process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, # Merge stdout and stderr
                    universal_newlines=True,
                    bufsize=1, # Line-buffered
                    env=rclone_env if mode not in ["version", "listremotes"] else os.environ.copy(), # Only pass rclone_env for actual rclone operations
                    preexec_fn=os.setsid # Detach process from current process group
                )

            # For `version` and `listremotes` modes, capture complete output and send as one block
            if mode in ["version", "listremotes"]:
                stdout, _ = rclone_process.communicate(timeout=30) # Wait for a short time
                full_raw_output = stdout.strip()
                write_to_log(LOG_FILE, full_raw_output) # Log the full output
                return_code = rclone_process.returncode
                final_status = "complete" if return_code == 0 else "error"
                final_message = "Rclone command completed successfully." if return_code == 0 else f"Rclone command failed with exit code {return_code}."
                
                yield json.dumps({
                    "status": final_status,
                    "message": final_message,
                    "output": full_raw_output # Send the raw output directly
                }) + '\n'
            else:
                # Existing streaming logic for other modes
                for line in iter(rclone_process.stdout.readline, ''):
                    if stop_rclone_flag.is_set():
                        # If stop flag is set, send SIGINT (Ctrl+C) for graceful termination
                        if rclone_process.poll() is None: # Only send if still running
                            os.killpg(os.getpgid(rclone_process.pid), signal.SIGINT) # Send SIGINT to process group
                            print(f"Sent SIGINT to Rclone process {rclone_process.pid}")
                        yield json.dumps({"status": "stopped", "message": "Rclone process stopping gracefully..."}) + '\n'
                        break # Exit the loop, process will be waited on in finally block

                    line_stripped = line.strip()
                    if line_stripped:
                        write_to_log(LOG_FILE, line_stripped)
                        yield json.dumps({"status": "progress", "output": line_stripped}) + '\n'
                        full_output_lines.append(line_stripped)

                # After loop, wait for process to fully terminate
                rclone_process.wait(timeout=10) # Wait longer for graceful exit
                if rclone_process.poll() is None: # If still running after timeout, send SIGKILL
                    rclone_process.kill()
                    print(f"Rclone process {rclone_process.pid} killed after timeout.")

                return_code = rclone_process.returncode
                final_status = "complete" if return_code == 0 else "error"
                final_message = "Rclone command completed successfully." if return_code == 0 else f"Rclone command failed with exit code {return_code}."
                # For streaming modes, return collected lines if available, otherwise read from log
                output_to_send = "\n".join(full_output_lines) if full_output_lines else "\n".join(read_last_n_lines(LOG_FILE, 50))

                yield json.dumps({
                    "status": final_status,
                    "message": final_message,
                    "output": output_to_send
                }) + '\n'

        except FileNotFoundError:
            yield json.dumps({"status": "error", "message": "Rclone executable not found. Ensure it's installed and in PATH."}) + '\n'
        except subprocess.TimeoutExpired:
            rclone_process.kill()
            yield json.dumps({"status": "error", "message": "Rclone process timed out during execution."}) + '\n'
        except Exception as e:
            yield json.dumps({"status": "error", "message": f"An unexpected error occurred: {e}"}) + '\n'
        finally:
            with rclone_lock:
                if rclone_process and rclone_process.poll() is None:
                    # This should ideally not be reached if SIGINT/SIGKILL were effective
                    rclone_process.terminate() # Fallback, if process is somehow still alive
                rclone_process = None # Clear the global process variable

    return Response(generate_rclone_output(), mimetype='application/json-lines')

@app.route('/stop-rclone-process', methods=['POST'])
@login_required
def stop_rclone_process():
    """Terminates the active Rclone process gracefully."""
    global rclone_process
    with rclone_lock:
        if rclone_process and rclone_process.poll() is None:
            stop_rclone_flag.set() # Set the flag to signal termination in the streaming thread
            # The streaming thread will now send SIGINT and wait.
            # We don't send terminate/kill here directly, let the streaming thread manage it.
            return jsonify({"status": "success", "message": "Rclone process stop signal sent. Waiting for graceful termination."})
        return jsonify({"status": "info", "message": "No Rclone process is currently running."})

@app.route('/download-rclone-log', methods=['GET'])
@login_required
def download_rclone_log():
    """Allows downloading the full Rclone LOG_FILE as an attachment."""
    if os.path.exists(LOG_FILE):
        return send_file(
            LOG_FILE,
            mimetype='text/plain',
            as_attachment=True,
            download_name=f"rclone_webgui_log_{time.strftime('%Y%m%d-%H%M%S')}.txt"
        )
    return jsonify({"status": "error", "message": "Rclone log file not found."}), 404

# --- Web Terminal Functions ---
def _stream_terminal_output_to_buffer(process, stop_flag):
    """Internal function to stream subprocess output to log file."""
    try:
        for line in iter(process.stdout.readline, ''):
            write_to_log(TERMINAL_LOG_FILE, line.strip())
            if stop_flag.is_set():
                # If stop flag is set, try to send SIGINT for graceful termination
                if process.poll() is None:
                    os.killpg(os.getpgid(process.pid), signal.SIGINT) # Send SIGINT to process group
                    print(f"Sent SIGINT to terminal process {process.pid}")
                break
        process.wait(timeout=10) # Wait longer for graceful exit
        if process.poll() is None: # If still running after timeout, send SIGKILL
            process.kill()
            print(f"Terminal process {process.pid} killed after timeout.")
    except Exception as e:
        print(f"Error streaming terminal output: {e}")
    finally:
        with terminal_lock:
            # Ensure process reference is cleared after it's done or killed
            if process and process.poll() is None:
                process.terminate() # Fallback
            global terminal_process
            terminal_process = None


@app.route('/execute_terminal_command', methods=['POST'])
@login_required
def execute_terminal_command():
    """Executes a terminal command and streams output."""
    global terminal_process
    command = request.get_json().get('command')

    if not command:
        return jsonify({"status": "error", "message": "No command provided."}), 400

    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            return jsonify({
                "status": "warning",
                "message": "A terminal process is already running. Do you want to stop it and start a new one?",
                "running_command": ' '.join(terminal_process.args) if isinstance(terminal_process.args, list) else terminal_process.args # Show the current command more reliably
            }), 409 # Conflict status code

        # If a process was running and completed, clear its references
        if terminal_process and terminal_process.poll() is not None:
            terminal_process = None

        clear_log(TERMINAL_LOG_FILE) # Clear terminal log before new command

        try:
            stop_terminal_flag.clear() # Clear the stop flag for a new run
            terminal_process = subprocess.Popen(
                command,
                shell=True, # Allows executing shell commands directly
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                bufsize=1, # Line-buffered
                preexec_fn=os.setsid # Detach process from current process group
            )

            # Generator function to stream terminal output to the client
            def generate_terminal_output():
                for line in iter(terminal_process.stdout.readline, ''):
                    line_stripped = line.strip()
                    write_to_log(TERMINAL_LOG_FILE, line_stripped) # Write to log file in real-time
                    yield json.dumps({"status": "progress", "output": line_stripped}) + '\n'
                    if stop_terminal_flag.is_set():
                        # If stop flag is set, send SIGINT and break loop
                        if terminal_process.poll() is None:
                            os.killpg(os.getpgid(terminal_process.pid), signal.SIGINT)
                            print(f"Sent SIGINT to terminal process {terminal_process.pid}")
                        yield json.dumps({"status": "stopped", "message": "Terminal process stopping gracefully..."}) + '\n'
                        break

                # After loop, wait for process to finish and send final status
                terminal_process.wait(timeout=10) # Wait for graceful exit
                if terminal_process.poll() is None:
                    terminal_process.kill()
                    print(f"Terminal process {terminal_process.pid} killed after timeout.")

                return_code = terminal_process.returncode
                final_status = "complete" if return_code == 0 else "error"
                final_message = "Command completed successfully." if return_code == 0 else f"Command failed with exit code {return_code}."
                
                # Read last lines from the log file for the final output snippet
                output_to_send = "\n".join(read_last_n_lines(TERMINAL_LOG_FILE, 50))
                
                yield json.dumps({
                    "status": final_status,
                    "message": final_message,
                    "output": output_to_send
                }) + '\n'
            
            return Response(generate_terminal_output(), mimetype='application/json-lines')

        except FileNotFoundError:
            return jsonify({"status": "error", "message": "Command not found. Ensure it's in PATH."}), 500
        except Exception as e:
            # Catch other potential errors during subprocess creation
            return jsonify({"status": "error", "message": f"Failed to execute command: {e}"}), 500

@app.route('/stop_terminal_process', methods=['POST'])
@login_required
def stop_terminal_process():
    """Terminates any active terminal process gracefully."""
    global terminal_process
    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            stop_terminal_flag.set() # Set the flag to signal termination in the streaming thread
            return jsonify({"status": "success", "message": "Terminal process stop signal sent. Waiting for graceful termination."})
        return jsonify({"status": "info", "message": "No terminal process is currently running."})

@app.route('/download-terminal-log', methods=['GET'])
@login_required
def download_terminal_log():
    """Allows downloading the full Terminal LOG_FILE as an attachment."""
    if os.path.exists(TERMINAL_LOG_FILE):
        return send_file(
            TERMINAL_LOG_FILE,
            mimetype='text/plain',
            as_attachment=True,
            download_name=f"terminal_log_{time.strftime('%Y%m%d-%H%M%S')}.txt"
        )
    return jsonify({"status": "error", "message": "Terminal log file not found."}), 404

# --- User Data (Notepad & Recent Commands) Routes ---
@app.route('/save_notepad_content', methods=['POST'])
@login_required
def save_notepad_content():
    """Saves notepad content for the current user."""
    content = request.get_json().get('content', '')
    notepad_file = get_user_data_path(f"notepad_{session['username']}.txt")
    if not notepad_file:
        return jsonify({"status": "error", "message": "User not authenticated or user data path invalid."}), 401
    try:
        with open(notepad_file, 'w', encoding='utf-8') as f:
            f.write(content)
        return jsonify({"status": "success", "message": "Notepad content saved."})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to save notepad content: {e}"}), 500

@app.route('/load_notepad_content', methods=['GET'])
@login_required
def load_notepad_content():
    """Loads notepad content for the current user."""
    notepad_file = get_user_data_path(f"notepad_{session['username']}.txt")
    if not notepad_file:
        return jsonify({"status": "error", "message": "User not authenticated or user data path invalid."}), 401
    try:
        if os.path.exists(notepad_file):
            with open(notepad_file, 'r', encoding='utf-8') as f:
                content = f.read()
            return jsonify({"status": "success", "content": content})
        return jsonify({"status": "success", "content": ""}) # Return empty if file doesn't exist yet
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to load notepad content: {e}"}), 500

@app.route('/save_recent_commands', methods=['POST'])
@login_required
def save_recent_commands():
    """Saves recent commands/transfers for the current user."""
    new_entry = request.get_json()
    history_file = get_user_data_path(f"recent_commands_{session['username']}.json")
    if not history_file:
        return jsonify({"status": "error", "message": "User not authenticated or user data path invalid."}), 401
    
    # Ensure timestamp is present
    if 'timestamp' not in new_entry:
        new_entry['timestamp'] = time.time() # Use Unix timestamp if not provided

    try:
        history = []
        if os.path.exists(history_file):
            with open(history_file, 'r', encoding='utf-8') as f:
                try:
                    history = json.load(f)
                except json.JSONDecodeError:
                    # Handle empty or corrupted JSON file
                    history = []
        
        # Append new entry and keep only the last 20
        history.append(new_entry)
        history = history[-20:] # Keep only the last 20 entries

        with open(history_file, 'w', encoding='utf-8') as f:
            json.dump(history, f, indent=4)
        return jsonify({"status": "success", "message": "Recent command saved."})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to save recent commands: {e}"}), 500

@app.route('/load_recent_commands', methods=['GET'])
@login_required
def load_recent_commands():
    """Loads recent commands/transfers for the current user."""
    history_file = get_user_data_path(f"recent_commands_{session['username']}.json")
    if not history_file:
        return jsonify({"status": "error", "message": "User not authenticated or user data path invalid."}), 401
    try:
        if os.path.exists(history_file):
            with open(history_file, 'r', encoding='utf-8') as f:
                history = json.load(f)
            return jsonify({"status": "success", "data": history})
        return jsonify({"status": "success", "data": []}) # Return empty list if file doesn't exist
    except json.JSONDecodeError:
        # Handle corrupted JSON file by returning empty list and logging error
        print(f"Warning: Corrupted JSON for recent commands at {history_file}. Returning empty list.")
        return jsonify({"status": "success", "data": []}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to load recent commands: {e}"}), 500

@app.route('/clear_all_user_data', methods=['POST'])
@login_required
def clear_all_user_data():
    """Clears all user-specific data (notepad and recent commands history)."""
    username = session.get('username')
    if not username:
        return jsonify({"status": "error", "message": "User not authenticated."}), 401

    notepad_file = get_user_data_path(f"notepad_{username}.txt")
    history_file = get_user_data_path(f"recent_commands_{username}.json")
    
    try:
        if os.path.exists(notepad_file):
            os.remove(notepad_file)
        if os.path.exists(history_file):
            os.remove(history_file)
        return jsonify({"status": "success", "message": "All user data cleared."})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to clear user data: {e}"}), 500


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=os.environ.get('PORT', 5000))
