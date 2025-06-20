import os
import subprocess
import threading
import json
import time
from datetime import timedelta
from flask import Flask, render_template, request, jsonify, Response, redirect, url_for, session, stream_with_context
from functools import wraps
import zipfile
import shutil
import re
import queue # Import queue for real-time output

app = Flask(__name__)

# --- Configuration (from Environment Variables for Render.com) ---
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'super-secret-key-please-change-me')
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=360) # Remember user for 6 hours

# Directories and Files
BASE_CONFIG_DIR = '/app/.config/rclone'
UPLOAD_FOLDER = os.path.join(BASE_CONFIG_DIR, 'uploads')
RCLONE_CONFIG_PATH = os.path.join(BASE_CONFIG_DIR, 'rclone.conf')
SERVICE_ACCOUNT_DIR = BASE_CONFIG_DIR
LOG_FILE = os.path.join('/tmp', 'rcloneLog.txt') # Use /tmp for ephemeral logs on Render
TERMINAL_LOG_FILE = os.path.join('/tmp', 'terminalLog.txt') # Use /tmp for ephemeral logs on Render
RECENT_COMMANDS_FILE = os.path.join('/tmp', 'recent_commands.json') # New file for recent commands

# Ensure necessary directories exist
os.makedirs(BASE_CONFIG_DIR, exist_ok=True)
os.makedirs(UPLOAD_FOLDER, exist_ok=True) # Ensure upload folder exists

# Login Credentials
LOGIN_USERNAME = os.environ.get('LOGIN_USERNAME', 'admin')
LOGIN_PASSWORD = os.environ.get('LOGIN_PASSWORD', 'password') # IMPORTANT: Change in production!

# --- Global variables for terminal process management ---
terminal_process = None
terminal_lock = threading.Lock()
stop_terminal_flag = threading.Event()
terminal_output_queue = queue.Queue() # Queue to hold terminal output lines

# --- Authentication Decorator ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
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
            return redirect(url_for('index'))
        else:
            error = 'Invalid Credentials. Please try again.'
            return render_template('login.html', error=error)
    return render_template('login.html')

@app.route('/logout')
def logout():
    """Logs out the user."""
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    """Renders the main application page."""
    return render_template('index.html')

@app.route('/upload_config', methods=['POST'])
@login_required
def upload_config():
    """Uploads rclone.conf file."""
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400
    if file:
        file.save(RCLONE_CONFIG_PATH)
        return jsonify({"status": "success", "message": "rclone.conf uploaded successfully!"})
    return jsonify({"status": "error", "message": "Failed to upload rclone.conf"}), 500

@app.route('/upload_sa', methods=['POST'])
@login_required
def upload_sa():
    """Uploads service account JSON files (can handle multiple)."""
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400
    files = request.files.getlist('file') # Get all files with the name 'file'
    if not files or all(f.filename == '' for f in files):
        return jsonify({"status": "error", "message": "No selected file(s)"}), 400

    uploaded_count = 0
    for file in files:
        if file and file.filename.endswith('.json'):
            filepath = os.path.join(SERVICE_ACCOUNT_DIR, file.filename)
            file.save(filepath)
            uploaded_count += 1
    if uploaded_count > 0:
        return jsonify({"status": "success", "message": f"{uploaded_count} service account file(s) uploaded successfully!"})
    return jsonify({"status": "error", "message": "Failed to upload service account file(s) or invalid file type."}), 500

@app.route('/clear_config', methods=['POST'])
@login_required
def clear_config():
    """Clears the rclone.conf and service account files."""
    try:
        if os.path.exists(RCLONE_CONFIG_PATH):
            os.remove(RCLONE_CONFIG_PATH)
        for f in os.listdir(SERVICE_ACCOUNT_DIR):
            if f.endswith('.json'):
                os.remove(os.path.join(SERVICE_ACCOUNT_DIR, f))
        return jsonify({"status": "success", "message": "Configuration cleared successfully!"})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Error clearing configuration: {str(e)}"}), 500

@app.route('/execute_rclone', methods=['POST'])
@login_required
def execute_rclone():
    """Executes an rclone command."""
    command_data = request.json.get('command')
    if not command_data:
        return jsonify({"status": "error", "message": "No command provided"}), 400

    # Ensure rclone.conf is used for all commands
    rclone_command = ['rclone', '--config', RCLONE_CONFIG_PATH] + command_data.split()

    try:
        # Clear previous log content before starting a new command
        with open(LOG_FILE, 'w') as f:
            f.write("")

        process = subprocess.Popen(
            rclone_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, # Merge stderr into stdout
            text=True, # Decode stdout/stderr as text
            bufsize=1, # Line-buffered
            universal_newlines=True # Ensure universal newline handling
        )

        output = ""
        for line in process.stdout:
            output += line
            # Write to log file in real-time
            with open(LOG_FILE, 'a') as f:
                f.write(line)
        process.wait() # Wait for the process to finish

        if process.returncode == 0:
            return jsonify({"status": "success", "output": output.strip()})
        else:
            return jsonify({"status": "error", "output": output.strip(), "message": f"Rclone command failed with exit code {process.returncode}"})

    except FileNotFoundError:
        return jsonify({"status": "error", "message": "rclone executable not found. Ensure it's installed and in PATH."}), 500
    except Exception as e:
        return jsonify({"status": "error", "message": f"An error occurred: {str(e)}"}), 500

@app.route('/check_rclone_version', methods=['GET'])
@login_required
def check_rclone_version():
    """Checks the rclone version."""
    try:
        # Explicitly use the config file for version check if it's typical for your setup
        # For a simple version check, it might not be strictly necessary, but good for consistency
        result = subprocess.run(['rclone', '--config', RCLONE_CONFIG_PATH, 'version'], capture_output=True, text=True, check=True)
        return jsonify({"status": "success", "version": result.stdout.strip()})
    except FileNotFoundError:
        return jsonify({"status": "error", "message": "rclone executable not found."}), 500
    except subprocess.CalledProcessError as e:
        return jsonify({"status": "error", "message": f"Error checking rclone version: {e.stderr}"}), 500
    except Exception as e:
        return jsonify({"status": "error", "message": f"An unexpected error occurred: {str(e)}"}), 500

@app.route('/download-rclone-log', methods=['GET'])
@login_required
def download_rclone_log():
    """Allows downloading the full rclone LOG_FILE as an attachment."""
    if os.path.exists(LOG_FILE):
        return Response(
            open(LOG_FILE, 'rb').read(),
            mimetype='text/plain',
            headers={"Content-Disposition": f"attachment;filename=rclone_log_{time.strftime('%Y%m%d-%H%M%S')}.txt"}
        )
    return jsonify({"status": "error", "message": "Rclone log file not found."}), 404

@app.route('/execute_terminal_command', methods=['POST'])
@login_required
def execute_terminal_command():
    """Executes a command in the web terminal and streams output."""
    command_str = request.json.get('command')
    if not command_str:
        return jsonify({"status": "error", "message": "No command provided"}), 400

    global terminal_process
    global stop_terminal_flag
    global terminal_output_queue

    # Add command to recent commands
    try:
        recent_commands = []
        if os.path.exists(RECENT_COMMANDS_FILE):
            with open(RECENT_COMMANDS_FILE, 'r') as f:
                recent_commands = json.load(f)
        recent_commands.insert(0, command_str) # Add to the beginning
        recent_commands = recent_commands[:20] # Keep only the last 20 commands
        with open(RECENT_COMMANDS_FILE, 'w') as f:
            json.dump(recent_commands, f)
    except Exception as e:
        print(f"Error saving recent command: {e}")


    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            # If a process is already running, signal it to stop before starting new one
            stop_terminal_flag.set()
            terminal_process.terminate()
            try:
                terminal_process.wait(timeout=5) # Wait for a bit
            except subprocess.TimeoutExpired:
                terminal_process.kill() # Force kill if it doesn't terminate
            terminal_process = None
            stop_terminal_flag.clear() # Clear the flag for the new process

        # Clear the terminal log file before starting a new command
        with open(TERMINAL_LOG_FILE, 'w') as f:
            f.write(f"$ {command_str}\n") # Write the command itself to the log

        try:
            # Popen with PIPE for real-time streaming
            terminal_process = subprocess.Popen(
                command_str,
                shell=True, # Allows executing commands like 'ls -l | grep .txt'
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, # Merge stderr into stdout
                text=True, # Decode stdout/stderr as text
                bufsize=1, # Line-buffered
                universal_newlines=True # Ensure universal newline handling
            )
            
            # Start a thread to read and enqueue output
            threading.Thread(target=read_and_enqueue_output, args=(terminal_process, terminal_output_queue, stop_terminal_flag)).start()

            return jsonify({"status": "success", "message": "Command started."})

        except FileNotFoundError:
            return jsonify({"status": "error", "message": "Command not found."}), 400
        except Exception as e:
            return jsonify({"status": "error", "message": f"Failed to execute command: {str(e)}"}), 500

def read_and_enqueue_output(process, output_queue, stop_flag):
    """Reads output from the process and puts it into a queue."""
    try:
        for line in process.stdout:
            if stop_flag.is_set():
                break # Stop reading if termination flag is set
            output_queue.put(line)
            with open(TERMINAL_LOG_FILE, 'a') as f: # Append to log file
                f.write(line)
        process.wait() # Wait for the process to complete
        output_queue.put(f"\n--- Command finished with exit code {process.returncode} ---\n")
    except Exception as e:
        output_queue.put(f"\n--- Error reading output: {str(e)} ---\n")
    finally:
        output_queue.put("___END_OF_STREAM___") # Signal end of stream
        stop_flag.clear() # Clear flag once process finishes or is stopped

@app.route('/stream_terminal_output')
@login_required
def stream_terminal_output():
    """Streams real-time output from the terminal process to the client."""
    def generate():
        while True:
            line = terminal_output_queue.get()
            if line == "___END_OF_STREAM___":
                break
            yield f"data:{json.dumps({'output': line})}\n\n"
            if terminal_process and terminal_process.poll() is not None and terminal_output_queue.empty():
                # If process finished and queue is empty, ensure stream ends
                break
            time.sleep(0.01) # Small delay to prevent busy-waiting

    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/check_terminal_status', methods=['GET'])
@login_required
def check_terminal_status():
    """Checks if a terminal process is currently running."""
    is_running = False
    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            is_running = True
    return jsonify({"is_running": is_running})

@app.route('/stop_terminal_process', methods=['POST'])
@login_required
def stop_terminal_process():
    """Terminates any active terminal process."""
    global terminal_process
    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            stop_terminal_flag.set() # Set the flag to signal termination
            terminal_process.terminate() # Send SIGTERM
            try:
                terminal_process.wait(timeout=5) # Wait for process to terminate
            except subprocess.TimeoutExpired:
                terminal_process.kill() # If still running after timeout, kill it
            terminal_process = None
            stop_terminal_flag.clear() # Clear the flag after stopping
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

@app.route('/get_recent_commands', methods=['GET'])
@login_required
def get_recent_commands():
    """Retrieves the list of recent terminal commands."""
    try:
        if os.path.exists(RECENT_COMMANDS_FILE):
            with open(RECENT_COMMANDS_FILE, 'r') as f:
                commands = json.load(f)
            return jsonify({"status": "success", "commands": commands})
        return jsonify({"status": "success", "commands": []})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Error loading recent commands: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=os.environ.get('PORT', 5000))
