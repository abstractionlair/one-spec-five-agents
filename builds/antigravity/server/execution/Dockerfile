FROM ubuntu:24.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install baseline tools and package managers
RUN apt-get update && apt-get install -y \
    # Python ecosystem
    python3 \
    python3-pip \
    python3-venv \
    # Node.js ecosystem
    nodejs \
    npm \
    # Utilities
    curl \
    wget \
    git \
    # Build tools (for compiling packages)
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install pixi (conda-like package manager)
# Note: pixi installer requires confirmation, use --yes flag or check latest install docs
RUN curl -fsSL https://pixi.sh/install.sh | bash -s -- --yes
ENV PATH="/root/.pixi/bin:$PATH"

# Set working directory
WORKDIR /project

# Configure npm cache to be in the project directory (writable)
ENV NPM_CONFIG_CACHE=/tmp/.npm-cache

# Default command
CMD ["bash"]
