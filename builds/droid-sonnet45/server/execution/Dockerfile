FROM ubuntu:22.04

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
# Note: pixi installer requires confirmation, use --yes flag
RUN curl -fsSL https://pixi.sh/install.sh | bash -s -- --yes || true
ENV PATH="/root/.pixi/bin:$PATH"

# Set working directory
WORKDIR /project

# Default command
CMD ["bash"]
