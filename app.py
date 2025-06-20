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
UPLOAD_FOLDER = os.path.join(BASE_CONFIG_DIR, 'uploads')
RCLONE_CONFIG_PATH = os.path.join(BASE_CONFIG_DIR, 'rclone.conf')
SERVICE_ACCOUNT_DIR = BASE_CONFIG_DIR
LOG_FILE = os.path.join('/tmp', 'rcloneLog.txt')
TERMINAL_LOG_FILE = os.path.join('/tmp', 'terminalLog.txt')

# Login Credentials
LOGIN_USERNAME = os.environ.get('LOGIN_USERNAME', 'admin')
LOGIN_PASSWORD = os.environ.get('LOGIN_PASSWORD', 'password')

# --- Utility Functions ---
def write_to_log(filename, content):
    try:
        with open(filename, 'a', encoding='utf-8') as f:
            f.write(content + '\n')
    except Exception as e:
        print(f"Error writing to log {filename}: {e}")

def clear_log(filename):
    try:
        if os.path.exists(filename):
            with open(filename, 'w', encoding='utf-8') as f:
                f.truncate(0)
    except Exception as e:
        print(f"Error clearing log {filename}: {e}")

def read_last_n_lines(filename, n):
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

# --- Initial Setup ---
def create_initial_dirs():
    os.makedirs(BASE_CONFIG_DIR, exist_ok=True)
    clear_log(LOG_FILE)
    clear_log(TERMINAL_LOG_FILE)
    print(f"Directories created: {BASE_CONFIG_DIR}")
    print(f"Logs cleared: {LOG_FILE}, {TERMINAL_LOG_FILE}")

with app.app_context():
    create_initial_dirs()

# --- Global Process Management ---
rclone_process = None
rclone_lock = threading.Lock()
stop_rclone_flag = threading.Event()

terminal_process = None
terminal_lock = threading.Lock()
stop_terminal_flag = threading.Event()

# --- Authentication ---
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            if request.headers.get('X-Requested-With') == 'XMLHttpRequest' or request.is_json:
                return jsonify({"status": "error", "message": "Unauthorized. Please log in."}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- Routes ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if username == LOGIN_USERNAME and password == LOGIN_PASSWORD:
            session['logged_in'] = True
            session.permanent = True
            return redirect(url_for('index'))
        else:
            return render_template('login.html', error="Invalid Credentials. Please try again.")
    return render_template('login.html')

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
    if 'rclone_conf' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400
    file = request.files['rclone_conf']
    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400
    try:
        file.save(RCLONE_CONFIG_PATH)
        return jsonify({"status": "success", "message": f"rclone.conf uploaded successfully to {RCLONE_CONFIG_PATH}"})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to save rclone.conf: {e}"}), 500

@app.route('/upload-sa-zip', methods=['POST'])
@login_required
def upload_sa_zip():
    if 'sa_zip' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400
    file = request.files['sa_zip']
    if file.filename == '' or not file.filename.endswith('.zip'):
        return jsonify({"status": "error", "message": "Invalid file. Please upload a .zip file."}), 400
    
    zip_path = os.path.join(BASE_CONFIG_DIR, 'sa-accounts.zip')
    try:
        file.save(zip_path)
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            for member in zip_ref.infolist():
                if member.filename.endswith('.json'):
                    zip_ref.extract(member, SERVICE_ACCOUNT_DIR)
        os.remove(zip_path)
        return jsonify({"status": "success", "message": f"Service account ZIP extracted to {SERVICE_ACCOUNT_DIR}."})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Failed to process service account ZIP: {e}"}), 500

@app.route('/execute-rclone', methods=['POST'])
@login_required
def execute_rclone():
    global rclone_process
    with rclone_lock:
        if rclone_process and rclone_process.poll() is None:
            return jsonify({"status": "error", "message": "Rclone process already running."}), 409

    data = request.get_json()
    mode = data.get('mode')
    
    # Base command
    cmd = ["rclone", mode]

    # --- Mode-specific command construction ---
    if mode == "version":
        pass # No flags needed
    elif mode == "listremotes":
        cmd.append(f"--config={RCLONE_CONFIG_PATH}")
    elif mode == "copyurl":
        url = data.get('url', '').strip()
        destination = data.get('destination', '').strip()
        if not url or not destination:
            return jsonify({"status": "error", "message": "URL and Destination are required for copyurl."}), 400
        cmd.extend([url, destination])
    elif mode == "serve":
        protocol = data.get('serve_protocol')
        path_to_serve = data.get('source', '').strip() # 'source' field is reused for path
        if not protocol or not path_to_serve:
             return jsonify({"status": "error", "message": "Protocol and Path to serve are required."}), 400
        cmd.extend([protocol, path_to_serve])
    else: # Default handling for other commands
        source = data.get('source', '').strip()
        destination = data.get('destination', '').strip()
        
        one_remote_modes = ["lsd", "ls", "tree", "mkdir", "size", "dedupe", "cleanup", "delete", "deletefile", "purge"]
        two_remote_modes = ["sync", "copy", "move", "check", "cryptcheck"]

        if mode in two_remote_modes:
            if not source or not destination:
                return jsonify({"status": "error", "message": "Source and Destination are required."}), 400
            cmd.extend([source, destination])
        elif mode in one_remote_modes:
            if not source:
                return jsonify({"status": "error", "message": "Source (path/remote) is required."}), 400
            cmd.append(source)
    
    # --- General Flags (if not a simple command like 'version') ---
    if mode not in ["version", "listremotes"]:
        # Append flags from request data
        flags_map = {
            'transfers': '--transfers',
            'checkers': '--checkers',
            'buffer_size': '--buffer-size',
            'order': '--order-by'
        }
        for key, flag in flags_map.items():
            if data.get(key):
                cmd.append(f"{flag}={data.get(key)}")
        
        if data.get('buffer_size'):
            cmd.append(f"--drive-chunk-size={data.get('buffer_size')}")

        loglevel_map = {"ERROR": "ERROR", "Info": "INFO", "DEBUG": "DEBUG"}
        cmd.append(f"--log-level={loglevel_map.get(data.get('loglevel'), 'INFO')}")

        if data.get('use_drive_trash'):
            cmd.append("--drive-use-trash")
        else:
            cmd.append("--drive-skip-gdocs=true")

        if data.get('dry_run'):
            cmd.append("--dry-run")
        
        if data.get('service_account') and os.path.exists(SERVICE_ACCOUNT_DIR) and any(f.endswith('.json') for f in os.listdir(SERVICE_ACCOUNT_DIR)):
            cmd.append(f"--drive-service-account-directory={SERVICE_ACCOUNT_DIR}")
        
        additional_flags_str = data.get('additional_flags', '').strip()
        if additional_flags_str:
            cmd.extend(re.findall(r'(?:[^\s"]|"[^"]*")+', additional_flags_str))

    # Always add config, progress, and stats for most commands
    if mode != "version":
        cmd.append(f"--config={RCLONE_CONFIG_PATH}")
    if mode not in ["version", "listremotes"]:
        cmd.extend(["--progress", "--stats=3s", "--stats-one-line-date"])

    print(f"Executing Rclone command: {' '.join(cmd)}")
    clear_log(LOG_FILE)

    def generate_rclone_output():
        global rclone_process
        stop_rclone_flag.clear()
        try:
            with rclone_lock:
                rclone_process = subprocess.Popen(
                    cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    universal_newlines=True, bufsize=1, env=os.environ.copy()
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
            
            rclone_process.wait()
            status = "complete" if rclone_process.returncode == 0 else "error"
            message = "Rclone command completed successfully." if status == "complete" else f"Rclone command failed with exit code {rclone_process.returncode}."
            yield json.dumps({"status": status, "message": message, "output": "\n".join(read_last_n_lines(LOG_FILE, 50))}) + '\n'

        except Exception as e:
            yield json.dumps({"status": "error", "message": f"An error occurred: {e}"}) + '\n'
        finally:
            with rclone_lock:
                rclone_process = None
    return Response(generate_rclone_output(), mimetype='application/json-lines')

@app.route('/stop-rclone-process', methods=['POST'])
@login_required
def stop_rclone_process():
    global rclone_process
    with rclone_lock:
        if rclone_process and rclone_process.poll() is None:
            stop_rclone_flag.set()
            rclone_process.terminate()
            try:
                rclone_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                rclone_process.kill()
            rclone_process = None
            return jsonify({"status": "success", "message": "Rclone process stopped."})
    return jsonify({"status": "info", "message": "No Rclone process running."})

@app.route('/download-logs', methods=['GET'])
@login_required
def download_logs():
    if not os.path.exists(LOG_FILE):
        return jsonify({"status": "error", "message": "Log file not found."}), 404
    return Response(open(LOG_FILE, 'rb').read(), mimetype='text/plain',
                    headers={"Content-Disposition": f"attachment;filename=rclone_webgui_log_{time.strftime('%Y%m%d-%H%M%S')}.txt"})

# --- Web Terminal ---
def _stream_terminal_output(process, stop_flag):
    for line in iter(process.stdout.readline, ''):
        if stop_flag.is_set():
            break
        write_to_log(TERMINAL_LOG_FILE, line.strip())
    process.wait()

@app.route('/execute_terminal_command', methods=['POST'])
@login_required
def execute_terminal_command():
    global terminal_process
    command = request.get_json().get('command')
    if not command:
        return jsonify({"status": "error", "message": "No command provided."}), 400
    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            return jsonify({"status": "warning", "message": "A terminal process is already running.", "running_command": terminal_process.args}), 409
        clear_log(TERMINAL_LOG_FILE)
        try:
            stop_terminal_flag.clear()
            terminal_process = subprocess.Popen(
                command, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                universal_newlines=True, bufsize=1
            )
            threading.Thread(target=_stream_terminal_output, args=(terminal_process, stop_terminal_flag), daemon=True).start()
            return jsonify({"status": "success", "message": f"Command '{command}' started."})
        except Exception as e:
            return jsonify({"status": "error", "message": f"Failed to execute command: {e}"}), 500

@app.route('/get_terminal_output', methods=['GET'])
@login_required
def get_terminal_output():
    with terminal_lock:
        is_running = terminal_process and terminal_process.poll() is None
        output_lines = read_last_n_lines(TERMINAL_LOG_FILE, 100)
        return jsonify({"status": "success", "output": "\n".join(output_lines), "is_running": is_running})

@app.route('/stop_terminal_process', methods=['POST'])
@login_required
def stop_terminal_process():
    global terminal_process
    with terminal_lock:
        if terminal_process and terminal_process.poll() is None:
            stop_terminal_flag.set()
            terminal_process.terminate()
            try:
                terminal_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                terminal_process.kill()
            terminal_process = None
            return jsonify({"status": "success", "message": "Terminal process stopped."})
    return jsonify({"status": "info", "message": "No terminal process running."})

@app.route('/download-terminal-logs', methods=['GET'])
@login_required
def download_terminal_logs():
    if not os.path.exists(TERMINAL_LOG_FILE):
        return jsonify({"status": "error", "message": "Terminal log file not found."}), 404
    return Response(open(TERMINAL_LOG_FILE, 'rb').read(), mimetype='text/plain',
                    headers={"Content-Disposition": f"attachment;filename=terminal_log_{time.strftime('%Y%m%d-%H%M%S')}.txt"})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=os.environ.get('PORT', 5000))
