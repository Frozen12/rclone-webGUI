import os
import time
import subprocess
import json
import secrets
from flask import Flask, request, jsonify, render_template, send_file, redirect, url_for, make_response
from datetime import datetime, timedelta

app = Flask(__name__)
app.secret_key = secrets.token_hex(16) # For session management

# Environment variables for Rclone (will be set before execution)
RCLONE_ENV = {
    'RCLONE_CONFIG': '/app/.config/rclone/rclone.conf',
    'RCLONE_FAST_LIST': 'true',
    'RCLONE_DRIVE_TPSLIMIT': '3',
    'RCLONE_DRIVE_ACKNOWLEDGE_ABUSE': 'true',
    'RCLONE_LOG_FILE': '/app/rclone_Transfer.txt', # Changed path to /app for consistency
    'RCLONE_VERBOSE': '1',
    'RCLONE_DRIVE_PACER_MIN_SLEEP': '75ms',
    'RCLONE_DRIVE_PACER_BURST': '2',
    'RCLONE_SERVER_SIDE_ACROSS_CONFIGS': 'true'
}

# Ensure Rclone config directory exists
os.makedirs('/app/.config/rclone', exist_ok=True)
os.makedirs('/app/.config/rclone/sa-accounts', exist_ok=True)

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
            # Set a simple cookie to remember login. For production, consider signed cookies/sessions.
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
        file.save(RCLONE_ENV['RCLONE_CONFIG'])
        return jsonify({'status': 'success', 'message': 'rclone.conf uploaded successfully'})
    return jsonify({'status': 'error', 'message': 'Failed to upload rclone.conf'}), 500

@app.route('/upload-sa-zip', methods=['POST'])
def upload_sa_zip():
    if 'file' not in request.files:
        return jsonify({'status': 'error', 'message': 'No file part'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'status': 'error', 'message': 'No selected file'}), 400
    if file:
        sa_zip_path = '/app/.config/rclone/sa-accounts.zip'
        file.save(sa_zip_path)
        try:
            # Clear existing SA files
            for f in os.listdir('/app/.config/rclone/sa-accounts'):
                if f.endswith('.json'):
                    os.remove(os.path.join('/app/.config/rclone/sa-accounts', f))
            
            subprocess.run(['unzip', '-qq', '-o', sa_zip_path, '-d', '/app/.config/rclone/sa-accounts/'], check=True)
            return jsonify({'status': 'success', 'message': 'Service Account ZIP extracted successfully'})
        except subprocess.CalledProcessError as e:
            return jsonify({'status': 'error', 'message': f'Failed to extract SA ZIP: {e}'}), 500
        except Exception as e:
            return jsonify({'status': 'error', 'message': f'An error occurred: {e}'}), 500
    return jsonify({'status': 'error', 'message': 'Failed to upload SA ZIP'}), 500

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

    # Construct the Rclone command
    transfersC = f"--transfers={transfers}"
    checkersC = f"--checkers={checkers}"
    bufferS = f"--buffer-size={buffer_size}"
    driveCS = f"--drive-chunk-size={buffer_size}" # Using buffer_size for drive-chunk-size

    driveT = "--drive-use-trash=true" if use_drive_trash else "--drive-use-trash=false"

    serviceA_flag = ""
    if service_account:
        # Get a random SA file
        sa_files = [f for f in os.listdir('/app/.config/rclone/sa-accounts') if f.endswith('.json')]
        if sa_files:
            # Use a simple hash based on current time or PID for selection
            MIXURE = str((os.getpid() + int(time.time())) % len(sa_files)) if sa_files else '0'
            # Simple way to pick one, could be more robust
            selected_sa = os.path.join('/app/.config/rclone/sa-accounts', sa_files[int(MIXURE) % len(sa_files)])
            serviceA_flag = f"--drive-service-account-file={selected_sa}"
        else:
            return jsonify({'status': 'error', 'message': 'No service account files found in /app/.config/rclone/sa-accounts'}), 400
    else:
        serviceA_flag = "--s3-no-head" # This flag is from the original script, it might not be relevant if not using S3

    dryR = "--dry-run" if dry_run else "--s3-no-head-object" # Again, s3 flag

    loglevel_map = {"ERROR ": "0", "Info ": "1", "DEBUG": "2"}
    verbose_level = loglevel_map.get(loglevel.strip(), "1")

    cmd = ["rclone", mode, source, destination]
    if additional_flags:
        cmd.extend(additional_flags.split())
    cmd.extend([
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
        "--max-transfer=749G", # Hardcoded from script
        "--cutoff-mode=SOFT",  # Hardcoded from script
        "--drive-acknowledge-abuse", # Hardcoded from script
        serviceA_flag,
        dryR
    ])

    try:
        # Clear previous log file before starting a new transfer
        if os.path.exists(RCLONE_ENV['RCLONE_LOG_FILE']):
            os.remove(RCLONE_ENV['RCLONE_LOG_FILE'])

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, universal_newlines=True, bufsize=1, env=os.environ.copy())
        
        # Read output in a non-blocking way and send to frontend
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
                    if len(lines_buffer) > 30:
                        lines_buffer.pop(0)
                    
                    # Send updates to client
                    yield json.dumps({
                        "status": "progress",
                        "output": "\\n".join(lines_buffer),
                        "latest_line": line
                    }) + "\\n"
                time.sleep(0.1) # Small delay to prevent too frequent updates

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

@app.route('/')
def index():
    return render_template('index.html')

if __name__ == '__main__':
    # Set Rclone environment variables
    for key, value in RCLONE_ENV.items():
        os.environ[key] = value
    
    app.run(host='0.0.0.0', port=os.environ.get('PORT', 5000), debug=True)