# Dockerfile

# Use an official Python runtime based on Alpine as a parent image
FROM python:3.9-alpine

# Install rclone and necessary tools
# Alpine uses 'apk' for package management.
# 'bash' is needed for the rclone install script.
# 'curl' for downloading rclone.
# 'unzip' for extracting the service account zip.
# 'ca-certificates' for secure communication.
RUN apk add --no-cache \
    bash \
    curl \
    unzip \
    ca-certificates \
    openssl \
    libffi-dev \
    gcc \
    musl-dev \
    python3-dev \
    # Clean up apk cache to reduce image size
    && rm -rf /var/cache/apk/*

# Install rclone using its official install script
# This script usually handles putting rclone in /usr/bin
RUN curl https://rclone.org/install.sh | bash

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the working directory
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
# --break-system-packages is often needed on Alpine to install into system Python
# which is usually where Python packages are installed without venv.
RUN pip install --no-cache-dir -r requirements.txt --break-system-packages

# Create the specific rclone configuration directories required by the app.
# These directories must exist and be writable by the application user.
# Alpine's default user is root, so this is fine, but in production,
# consider running as a less privileged user.
RUN mkdir -p /app/.config/rclone/sa-accounts && \
    chmod -R 777 /app/.config/rclone # Give broad permissions for simplicity in this example

# Copy the application code into the container
COPY . .

# Expose the port the app will run on
EXPOSE 5000

# Command to run the application (using Gunicorn for production-like deployment)
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]
