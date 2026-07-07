FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    curl \
    wget \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install pixi (conda-like env manager)
RUN curl -fsSL https://pixi.sh/install.sh | bash -s -- --yes
ENV PATH="/root/.pixi/bin:$PATH"

WORKDIR /project

CMD ["bash"]
