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

# Install Rclone using the official script
# Note: Rclone will be installed to /usr/bin/rclone by default
RUN curl https://rclone.org/install.sh | bash
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
