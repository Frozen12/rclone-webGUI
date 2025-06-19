# Rclone WebGUI

This is a Flask-based web interface for Rclone, allowing you to manage Rclone configurations, upload files, and perform Rclone operations through a user-friendly GUI. It includes features for service account management, a web terminal, and live progress monitoring.

## Features

* **Rclone Configuration Upload:** Easily upload your `rclone.conf` and Service Account (SA) JSON files (in a ZIP archive).
* **Dynamic Rclone Commands:** Select various Rclone modes (`sync`, `copy`, `move`, `lsd`, `lsf`, `tree`, `mkdir`, `purge`, `delete`, `dedupe`, `cleanup`, `listremotes`, `serve`, `checksum`) with dynamic input fields.
* **Live Transfer Progress:** Monitor Rclone transfer output in real-time.
* **Interactive Web Terminal:** Execute shell commands directly in your browser with live streaming output.
* **Recent Commands History:** Store and view previously executed terminal commands and Rclone source/destination locations.
* **Authentication:** Basic username/password login for secure access.
* **Download Logs:** Download the full Rclone transfer log file.
* **Modern UI:** Built with Tailwind CSS for a clean and professional look.

## Project Structure
```
rclone-webgui/
├── .env                  # Environment variables (e.g., login credentials)
├── .dockerignore         # Files to ignore during Docker build
├── app.py                # Main Flask application logic
├── Dockerfile            # Docker build instructions
├── README.md             # This file
├── requirements.txt      # Python dependencies
└── templates/
├── index.html        # Main WebGUI interface
└── login.html        # User login page
```
