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
RUN set -eux; \
    RCLONE_VERSION=$(curl -s https://downloads.rclone.org/version.txt); \
    mkdir -p /tmp/rclone-download; \
    curl -o /tmp/rclone-download/rclone.zip "https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-amd64.zip"; \
    unzip -q /tmp/rclone-download/rclone.zip -d /tmp/rclone-download/; \
    mv /tmp/rclone-download/rclone-v${RCLONE_VERSION}-linux-amd64/rclone /usr/bin/; \
    rm -rf /tmp/rclone-download; \
    chmod +x /usr/bin/rclone

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