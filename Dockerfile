# Use an official Python runtime on Alpine Linux
FROM python:3.9-alpine

# Install system dependencies
# curl and unzip are needed for downloading and extracting rclone, and for SA zips.
# fuse is needed if you plan to use rclone mount, though not directly used in your web app for transfer.
# If fuse is not strictly needed for your specific rclone commands, you can remove it to shrink image further.
RUN apk add --no-cache \
    curl \
    unzip \
    fuse \
    ca-certificates # Essential for curl to work with HTTPS

# Install rclone from pre-compiled binary for Alpine
# This fetches the latest stable release and installs it.
# Using a specific, known-good version is often more stable for Docker builds.
# You can update RCLONE_VERSION manually periodically.
ENV RCLONE_VERSION 1.66.0 # <--- IMPORTANT: Set the desired Rclone version here

RUN set -eux; \
    # Download the rclone zip archive
    curl -o /tmp/rclone-download.zip "https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-amd64.zip"; \
    \
    # Create a temporary directory for extraction
    mkdir -p /tmp/rclone-extracted; \
    \
    # Extract the zip file into the temporary directory
    unzip -q /tmp/rclone-download.zip -d /tmp/rclone-extracted/; \
    \
    # Find the extracted rclone executable (its path inside the zip can vary slightly with versions)
    # This finds the 'rclone' executable anywhere inside the extracted folder structure
    find /tmp/rclone-extracted -type f -name "rclone" -exec mv {} /usr/bin/ \; ; \
    \
    # Clean up temporary files and directories
    rm -rf /tmp/rclone-download.zip /tmp/rclone-extracted; \
    \
    # Make rclone executable
    chmod +x /usr/bin/rclone; \
    \
    # Verify rclone installation (optional, but good for debugging build issues)
    rclone version

# Set the working directory in the container
WORKDIR /app

# Create necessary directories for rclone config and service accounts
# These directories are critical for the application to function correctly.
RUN mkdir -p /app/.config/rclone/sa-accounts && \
    chmod -R 777 /app/.config # Ensure necessary permissions for config and SA files

# Copy requirements.txt and install Python dependencies
# This is done early to leverage Docker's build cache.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your application code into the container
COPY . .

# Expose the port that Gunicorn will bind to
EXPOSE 5000

# Set the entrypoint to run the Flask application using Gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "app:app"]
