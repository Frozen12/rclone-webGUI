# Dockerfile (Minimalist Alpine)

# Use an official Python runtime based on Alpine as a parent image
FROM python:3.9-alpine

# Install necessary runtime tools and bash for rclone install script/terminal
# 'apk add --no-cache' is Alpine's package manager for efficient installation.
# 'bash' is needed for the rclone install.sh script and the web terminal's interactive shell.
# 'curl' for downloading rclone itself.
# 'unzip' is critical because your app.py explicitly uses it to extract service account ZIP files.
# 'ca-certificates' and 'openssl' are for secure network communications (HTTPS/SSL/TLS).
# NOTE: This Dockerfile *intentionally* omits build tools (like gcc, python3-dev)
# to keep the image small for low-config machines.
# If `pip install` fails due to needing to compile C extensions (e.g., for cryptography),
# you will need to add those build tools back (or use a multi-stage build).
RUN apk add --no-cache \
    bash \
    curl \
    unzip \
    ca-certificates \
    openssl \
    # Clean up apk cache to reduce image size after installation
    && rm -rf /var/cache/apk/*

# Install rclone using its official install script
# This script typically places the rclone executable in /usr/bin
RUN curl https://rclone.org/install.sh | bash

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the working directory
COPY requirements.txt .

# Install Python dependencies specified in requirements.txt
# --break-system-packages is often needed on Alpine to install into the system Python environment.
# We are relying on pre-compiled wheels for all packages here.
RUN pip install --no-cache-dir -r requirements.txt --break-system-packages

# Create the specific rclone configuration directories required by the app.
# Ensure correct permissions for the app to write configuration and SA files.
RUN mkdir -p /app/.config/rclone/sa-accounts && \
    chmod -R 777 /app/.config/rclone # Give broad permissions for simplicity. Adjust in production for security.

# Copy the application code into the container
COPY . .

# Expose the port the app will run on
EXPOSE 5000

# Command to run the application using Gunicorn for a robust server
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]
