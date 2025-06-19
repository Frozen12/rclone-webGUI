import os
import subprocess
import threading
import json
import time
from datetime import timedelta
from flask import Flask, render_template, request, jsonify, Response, redirect, url_for, session, send_file
from functools import wraps
import zipfile
import shutil
import re

app = Flask(__name__)

# --- Configuration (from Environment Variables for Render.com) ---
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'a-very-secure-and-random-secret-key')
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(minutes=360)

# --- Directories and Files ---
# Using /tmp for logs and ephemeral data on services like Render
BASE_CONFIG_DIR = os.path.join(os.getcwd(), '.config', 'rclone')
RCLONE_CONFIG_PATH = os.path.join(BASE_CONFIG_DIR, 'rclone.conf')
SERVICE_ACCOUNT_DIR = BASE_CONFIG_DIR
LOG_FILE = os.path.join('/tmp', 'rcloneLog.txt')
TERMINAL_LOG_FILE = os.path.join('/tmp', 'terminalLog.txt')

# --- Login Credentials ---
LOGIN_USERNAME = os.environ.get('LOGIN_USERNAME', 'admin')
LOGIN_PASSWORD = os.environ.get('LOGIN_PASSWORD', 'password')

# --- Global variables for process management ---
# Using dictionaries to hold process-related state
rclone_process_holder = {'process': None}
terminal_process_holder = {'process': None}
process_lock = threading.Lock() # A single lock for both processes

# --- Initial Setup ---
def initial_setup():
    """Creates necessary directories and clears old logs on startup."""
    print("Performing initial setup...")
    os.makedirs(BASE_CONFIG_DIR, exist_ok=True)
    clear_log(LOG_FILE)
    clear_log(TERMINAL_LOG_FILE)
    print("Setup complete.")

# --- Utility Functions ---
def write_to_log(filename, content):
    """Appends content to a specified log file."""
    try:
        with open(filename, "a", encoding='utf-8') as f:
            f.write(content + "\\n")
    except IOError as e:
        print(f"Error writing to log file {filename}: {e}")

def clear_log(filename):
    """Clears a specified log file."""
    if os.path.exists(filename):
        try:
            with open(filename, "w", encoding='utf-8') as f:
                f.truncate()
            print(f"Cleared log file: {filename}")
        except IOError as e:
            print(f"Error clearing log file {filename}: {e}")

def read_last_n_lines(filename, n):
    """Reads the last n non-empty lines from a file."""
    if not os.path.exists(filename):
        return []
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            lines = [line for line in f.read().splitlines() if line.strip()]
        return lines[-n:]
    except IOError as e:
        print(f"Error reading from log file {filename}: {e}")
        return []

# --- Authentication ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            if request.is_json:
                return jsonify({"status": "error", "message": "Authentication required"}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- Routes ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    error = None
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        if username == LOGIN_USERNAME and password == LOGIN_PASSWORD:
            session['logged_in'] = True
            session.permanent = True
            return redirect(url_for('index'))
        else:
            error = 'Invalid Credentials. Please try again.'
    return render_template('login.html', error=error)

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index():
    return render_template('index.html')

@app.route('/upload-rclone-conf', methods=['POST'])
@login_required
def upload_rclone_conf():
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400
    if file:
        try:
            file.save(RCLONE_CONFIG_PATH)
            return jsonify({"status": "success", "message": "rclone.conf uploaded successfully."})
        except Exception as e:
            return jsonify({"status": "error", "message": f"Error saving file: {e}"}), 500
    return jsonify({"status": "error", "message": "File upload failed"}), 500

@app.route('/upload-sa-zip', methods=['POST'])
@login_required
def upload_sa_zip():
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400
    file = request.files['file']
    if file.filename == '' or not file.filename.endswith('.zip'):
        return jsonify({"status": "error", "message": "Please upload a valid .zip file"}), 400

    zip_path = os.path.join(BASE_CONFIG_DIR, 'sa-accounts.zip')
    try:
        # Clear existing .json files before extracting
        for item in os.listdir(SERVICE_ACCOUNT_DIR):
            if item.endswith(".json"):
                os.remove(os.path.join(SERVICE_ACCOUNT_DIR, item))

        file.save(zip_path)
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(SERVICE_ACCOUNT_DIR)
        os.remove(zip_path) # Clean up the zip file
        return jsonify({"status": "success", "message": "Service account ZIP extracted successfully."})
    except zipfile.BadZipFile:
        return jsonify({"status": "error", "message": "Invalid ZIP file."}), 400
    except Exception as e:
        return jsonify({"status": "error", "message": f"An error occurred: {e}"}), 500

@app.route('/execute-rclone', methods=['POST'])
@login_required
def execute_rclone():
    with process_lock:
        if rclone_process_holder['process'] and rclone_process_holder['process'].poll() is None:
            return jsonify({"status": "error", "message": "An Rclone process is already running."}), 409

    data = request.json
    mode = data.get('mode')
    
    clear_log(LOG_FILE) # Clear log for new transfer

    # Base command structure with environment variables for rclone
    cmd = ['rclone', mode]
    
    # --- Special Mode Handling ---
    if mode == 'version':
        cmd = ['rclone', 'version']
    elif mode == 'listremotes':
        cmd = ['rclone', 'listremotes', '--config', RCLONE_CONFIG_PATH]
    else:
        # Handle source/destination/path based on mode
        if mode == 'copyurl':
            cmd.extend([data.get('url', ''), data.get('destination', '')])
        elif mode == 'serve':
            cmd.extend([data.get('protocol', 'http'), data.get('path', '')])
        else: # Standard one or two remote commands
            source = data.get('source', '')
            cmd.append(source)
            if data.get('destination'):
                destination = data.get('destination', '')
                cmd.append(destination)

        # --- Add Flags ---
        cmd.extend([
            f"--config={RCLONE_CONFIG_PATH}",
            f"--log-level={data.get('loglevel', 'INFO')}",
            f"--transfers={data.get('transfers', 4)}",
            f"--checkers={data.get('checkers', 8)}",
            f"--buffer-size={data.get('buffer_size', '16M')}",
            f"--order-by={data.get('order', 'size,mixed,50')}",
            "--progress",
            "--color=NEVER", # Disable color codes for clean parsing
            "--stats=3s"
        ])

        if data.get('use_drive_trash'):
            cmd.append('--drive-use-trash')
        if data.get('dry_run'):
            cmd.append('--dry-run')

        # Add service account directory if requested and JSONs exist
        sa_files_exist = any(f.endswith('.json') for f in os.listdir(SERVICE_ACCOUNT_DIR))
        if data.get('service_account') and sa_files_exist:
            cmd.append(f"--drive-service-account-directory={SERVICE_ACCOUNT_DIR}")

        if data.get('additional_flags'):
            cmd.extend(data['additional_flags'].split())

    def generate_output():
        try:
            # Use Popen to start the process
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', bufsize=1)
            with process_lock:
                rclone_process_holder['process'] = process

            # Stream output
            for line in iter(process.stdout.readline, ''):
                clean_line = line.strip()
                write_to_log(LOG_FILE, clean_line)
                yield f"data: {json.dumps({'status': 'progress', 'output': clean_line})}\n\n"
            
            process.wait() # Wait for the process to finish
            return_code = process.returncode
            final_status = "complete" if return_code == 0 else "error"
            final_message = "Rclone process completed successfully." if final_status == "complete" else f"Rclone process finished with errors (code: {return_code})."
            
            last_lines = read_last_n_lines(LOG_FILE, 50)
            
            # *** FIX: Pre-format the string with newlines to avoid backslash in f-string expression ***
            output_str = "\n".join(last_lines)
            payload = {'status': final_status, 'message': final_message, 'output': output_str}
            yield f"data: {json.dumps(payload)}\n\n"

        except FileNotFoundError:
            error_msg = "Error: 'rclone' command not found. Ensure Rclone is installed and in your system's PATH."
            write_to_log(LOG_FILE, error_msg)
            yield f"data: {json.dumps({'status': 'error', 'message': error_msg, 'output': error_msg})}\n\n"
        except Exception as e:
            error_msg = f"An unexpected error occurred: {e}"
            write_to_log(LOG_FILE, error_msg)
            yield f"data: {json.dumps({'status': 'error', 'message': error_msg, 'output': error_msg})}\n\n"
        finally:
            with process_lock:
                rclone_process_holder['process'] = None # Clear process holder

    return Response(generate_output(), mimetype='text/event-stream')

@app.route('/stop-rclone', methods=['POST'])
@login_required
def stop_rclone():
    with process_lock:
        process = rclone_process_holder.get('process')
        if process and process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=5)
                if process.poll() is None:
                    process.kill()
                rclone_process_holder['process'] = None
                return jsonify({"status": "success", "message": "Rclone process stopped."})
            except Exception as e:
                return jsonify({"status": "error", "message": f"Error stopping process: {e}"})
        return jsonify({"status": "info", "message": "No Rclone process is running."})


@app.route('/download-logs', methods=['GET'])
@login_required
def download_logs():
    """Allows downloading the full Rclone log file."""
    try:
        return send_file(LOG_FILE, as_attachment=True, download_name='rclone_log.txt')
    except FileNotFoundError:
        return "Rclone log file not found.", 404
        
@app.route('/download-terminal-log', methods=['GET'])
@login_required
def download_terminal_log():
    """Allows downloading the full terminal log file."""
    try:
        return send_file(TERMINAL_LOG_FILE, as_attachment=True, download_name='terminal_log.txt')
    except FileNotFoundError:
        return "Terminal log file not found.", 404

# --- Web Terminal Routes ---
def stream_terminal_output(process, log_file):
    """Thread target to stream a process's output to a log file."""
    try:
        for line in iter(process.stdout.readline, ''):
            write_to_log(log_file, line.strip())
    except Exception as e:
        print(f"Error in terminal streaming thread: {e}")
    finally:
        print("Terminal streaming thread finished.")


@app.route('/execute-terminal-command', methods=['POST'])
@login_required
def execute_terminal_command():
    with process_lock:
        if terminal_process_holder['process'] and terminal_process_holder['process'].poll() is None:
            # A process is already running. The frontend will handle confirmation.
            return jsonify({"status": "running", "message": "A terminal process is already running."}), 409

        command = request.json.get('command')
        if not command:
            return jsonify({"status": "error", "message": "No command provided."}), 400

        clear_log(TERMINAL_LOG_FILE) # Clear log for new command
        
        try:
            # Use Popen with shell=True for terminal-like behavior
            process = subprocess.Popen(command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', bufsize=1)
            terminal_process_holder['process'] = process

            # Start a thread to read output and write to log
            thread = threading.Thread(target=stream_terminal_output, args=(process, TERMINAL_LOG_FILE))
            thread.daemon = True
            thread.start()
            
            return jsonify({"status": "success", "message": "Command execution started."})
        except Exception as e:
            return jsonify({"status": "error", "message": f"Failed to start command: {e}"}), 500


@app.route('/get-terminal-output', methods=['GET'])
@login_required
def get_terminal_output():
    """Returns the most recent terminal output from the log file."""
    with process_lock:
        process = terminal_process_holder.get('process')
        is_running = process and process.poll() is None
    
    output_lines = read_last_n_lines(TERMINAL_LOG_FILE, 100)
    return jsonify({"status": "success", "output": "\\n".join(output_lines), "is_running": is_running})


@app.route('/stop-terminal-process', methods=['POST'])
@login_required
def stop_terminal_process():
    """Terminates any active terminal process."""
    with process_lock:
        process = terminal_process_holder.get('process')
        if process and process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=5)
                if process.poll() is None:
                    process.kill()
                terminal_process_holder['process'] = None
                return jsonify({"status": "success", "message": "Terminal process stopped."})
            except Exception as e:
                return jsonify({"status": "error", "message": f"Failed to stop process: {e}"})
        return jsonify({"status": "info", "message": "No terminal process is currently running."})


if __name__ == '__main__':
    initial_setup()
    # For local dev, use Flask's server. For production, Gunicorn is used via Dockerfile.
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
