# Use a slim Python base image based on Alpine for smaller size
FROM python:3.9-alpine

# Set environment variables for non-interactive Rclone installation
ENV DEBIAN_FRONTEND=noninteractive

# Install core dependencies for Rclone and application:
# unzip: for rclone and service account zips
# curl: for downloading rclone
# fuse: common dependency for rclone, even if not directly mounting, it's safer
# ca-certificates: for HTTPS downloads
# git: useful for general web app development and if Python packages require it, or for terminal use
# build-base: Alpine equivalent of build-essential, needed for compiling Python packages with C extensions
RUN apk update && \
    apk add --no-cache \
    unzip \
    curl \
    fuse \
    ca-certificates \
    git \
    build-base && \
    rm -rf /var/cache/apk/*

# Install rclone using the "current" link for the latest stable version
RUN set -eux; \
    # Download the latest rclone zip archive
    curl -O https://downloads.rclone.org/rclone-current-linux-amd64.zip; \
    \
    # Create a temporary directory for extraction
    mkdir -p /tmp/rclone-extracted; \
    \
    # Unzip the file into the temporary directory
    unzip -q rclone-current-linux-amd64.zip -d /tmp/rclone-extracted/; \
    \
    # Find the extracted rclone executable (its path inside the zip can vary slightly)
    # The find command is robust against changes in the extracted directory name (e.g., rclone-vX.Y.Z-linux-amd64)
    find /tmp/rclone-extracted -type f -name "rclone" -exec mv {} /usr/bin/ \; ; \
    \
    # Clean up temporary files and directories
    rm -rf rclone-current-linux-amd64.zip /tmp/rclone-extracted; \
    \
    # Make rclone executable
    chmod +x /usr/bin/rclone; \
    \
    # Verify rclone installation
    rclone version

# Set the working directory in the container
WORKDIR /app

# Copy the application files into the container
COPY app.py .
COPY templates/ templates/
COPY static/ static/

# Install Python dependencies
# Ensure requirements.txt includes gunicorn for production
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Ensure necessary directories for rclone configs and logs exist
# These will be created by app.py on startup, but pre-creating them
# can help with permissions or initial setup if needed.
RUN mkdir -p /app/.config/rclone/sa-accounts
RUN mkdir -p /content # For rcloneLog.txt as specified in the colab script, even if it's external

# Expose the port Flask runs on
EXPOSE 5000

# Command to run the application using Gunicorn (recommended for production)
# Render automatically injects the PORT env var, so you don't need to specify it explicitly in CMD,
# but it's good practice for clarity.
CMD ["python", "app.py"]
