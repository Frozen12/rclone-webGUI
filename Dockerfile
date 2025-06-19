# Use a Python 3.9 Alpine base image for a smaller footprint
FROM python:3.9-alpine

# Set environment variables for Rclone installation
ENV DEBIAN_FRONTEND noninteractive

# Install necessary system dependencies for Alpine:
# curl for downloading rclone, unzip for extracting
RUN apk add --no-cache \
    curl \
    unzip \
    # Clean up apk caches to reduce image size
    && rm -rf /var/cache/apk/*

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

# Set the working directory inside the container
WORKDIR /app

# Copy the application files into the container
COPY requirements.txt .
COPY app.py .
COPY templates/ templates/
COPY static/ static/

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Create necessary directories for rclone config and service accounts
# Rclone expects config in ~/.config/rclone/ by default
ENV HOME /app
RUN mkdir -p /app/.config/rclone/accounts

# Expose the port Flask will run on
EXPOSE 5000

# Command to run the application
# Using Gunicorn for production deployment with Flask
# --bind 0.0.0.0:${PORT} makes it listen on all interfaces and the port defined by Render
# --workers determines how many concurrent requests can be handled (adjust based on resources)
# --timeout increases the request timeout for potentially long Rclone operations
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--timeout", "300", "app:app"]
