# Step 04: Docker Execution Environment

**Goal:** Execute bash commands in sandboxed Docker containers with project directory mounted.

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 02 (File storage - need project directories)

## Overview

Models execute code in isolated Docker containers:
- **Ephemeral containers** - `docker run --rm` for each command
- **Project directory mounted** - Files persist on host
- **Resource limits** - Memory, CPU, timeout constraints
- **Network access** - Configurable per project

## Dockerfile

Create `server/execution/Dockerfile` (base image should track a current Ubuntu LTS, not a specific older version):

```dockerfile
FROM ubuntu:latest

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

# Default command
CMD ["bash"]
```

## File Structure

```
server/
  execution/
    Dockerfile        # Container image definition
    docker.js         # Docker execution logic
    test-docker.js    # Integration tests
```

## Implementation

### 1. Docker Executor (server/execution/docker.js)

```javascript
const { spawn } = require('child_process');
const path = require('path');
const { getProjectPath } = require('../files/storage');

const IMAGE_NAME = 'multimodelchat-executor';
const DEFAULT_TIMEOUT = 60000; // 60 seconds
const DEFAULT_MEMORY = '1g';
const DEFAULT_CPUS = '2.0';

/**
 * Execute bash command in Docker container
 */
async function executeBash(command, projectId, options = {}) {
  const {
    timeout = DEFAULT_TIMEOUT,
    memory = DEFAULT_MEMORY,
    cpus = DEFAULT_CPUS,
    network = 'bridge',  // 'bridge' for network access, 'none' for isolated
    env = {}
  } = options;

  // Get project directory path
  const projectPath = getProjectPath(projectId);

  // Build docker run command
  const dockerArgs = [
    'run',
    '--rm',                              // Remove container after execution
    '-v', `${projectPath}:/project:rw`,  // Mount project directory
    '-w', '/project',                    // Set working directory
    '--memory', memory,                  // Memory limit
    '--cpus', cpus,                      // CPU limit
    '--network', network,                // Network mode
    '--user', `${process.env.UID || 1000}:${process.env.GID || 1000}`, // Set user to host user ID to prevent permission issues
  ];

  // Add environment variables
  for (const [key, value] of Object.entries(env)) {
    dockerArgs.push('-e', `${key}=${value}`);
  }

  // Add image and command
  dockerArgs.push(IMAGE_NAME);
  dockerArgs.push('bash');
  dockerArgs.push('-c');
  dockerArgs.push(command);

  return new Promise((resolve, reject) => {
    const child = spawn('docker', dockerArgs);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    // Timeout handling
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timeout after ${timeout}ms`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exit_code: code,
        success: code === 0
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Docker execution error: ${err.message}`));
    });
  });
}

/**
 * Check if Docker is available
 */
async function isDockerAvailable() {
  return new Promise((resolve) => {
    const child = spawn('docker', ['--version']);
    child.on('close', (code) => {
      resolve(code === 0);
    });
    child.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Check if executor image exists
 */
async function isImageBuilt() {
  return new Promise((resolve) => {
    const child = spawn('docker', ['images', '-q', IMAGE_NAME]);
    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });
    child.on('close', () => {
      resolve(output.trim().length > 0);
    });
    child.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Build executor image
 */
async function buildImage() {
  const dockerfilePath = path.join(__dirname, 'Dockerfile');

  return new Promise((resolve, reject) => {
    const child = spawn('docker', [
      'build',
      '-t', IMAGE_NAME,
      '-f', dockerfilePath,
      path.dirname(dockerfilePath)
    ], {
      stdio: 'inherit'  // Show build output
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Docker build failed with code ${code}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Docker build error: ${err.message}`));
    });
  });
}

module.exports = {
  executeBash,
  isDockerAvailable,
  isImageBuilt,
  buildImage,
  IMAGE_NAME
};
```

### 2. Integration Test (server/execution/test-docker.js)

```javascript
const { createProject, deleteProject } = require('../db/projects');
const { createFile } = require('../files/storage');
const {
  executeBash,
  isDockerAvailable,
  isImageBuilt,
  buildImage
} = require('./docker');
const fs = require('fs').promises;
const path = require('path');

async function runTests() {
  console.log('=== Testing Docker Execution ===\n');

  let testProject;

  try {
    // Check Docker availability
    console.log('1. Checking Docker availability...');
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      throw new Error('Docker is not available. Please install Docker Desktop.');
    }
    console.log('  ✓ Docker is available\n');

    // Check if image is built
    console.log('2. Checking executor image...');
    const imageBuilt = await isImageBuilt();
    if (!imageBuilt) {
      console.log('  Image not found, building...');
      await buildImage();
      console.log('  ✓ Image built successfully');
    } else {
      console.log('  ✓ Image already exists');
    }
    console.log();

    // Create test project
    console.log('3. Creating test project...');
    testProject = createProject('Docker Test', 'Testing Docker execution');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    // Test basic command
    console.log('4. Testing basic command...');
    const result1 = await executeBash('echo "Hello from Docker"', testProject.id);
    if (!result1.success) {
      throw new Error(`Command failed: ${result1.stderr}`);
    }
    if (!result1.stdout.includes('Hello from Docker')) {
      throw new Error('Unexpected output');
    }
    console.log('  ✓ Basic command works');
    console.log(`  Output: ${result1.stdout.trim()}\n`);

    // Test file creation
    console.log('5. Testing file creation...');
    const result2 = await executeBash(
      'echo "test content" > test-output.txt',
      testProject.id
    );
    if (!result2.success) {
      throw new Error(`File creation failed: ${result2.stderr}`);
    }

    // Verify file exists on host
    const projectPath = path.join(__dirname, '../../projects', testProject.id, 'files');
    const filePath = path.join(projectPath, 'test-output.txt');
    const content = await fs.readFile(filePath, 'utf-8');
    if (!content.includes('test content')) {
      throw new Error('File content mismatch');
    }
    console.log('  ✓ Can create files visible on host\n');

    // Test Python
    console.log('6. Testing Python...');
    const result3 = await executeBash(
      'python3 -c "print(2 + 2)"',
      testProject.id
    );
    if (!result3.stdout.includes('4')) {
      throw new Error('Python execution failed');
    }
    console.log('  ✓ Python works\n');

    // Test Node.js
    console.log('7. Testing Node.js...');
    const result4 = await executeBash(
      'node -e "console.log(2 + 2)"',
      testProject.id
    );
    if (!result4.stdout.includes('4')) {
      throw new Error('Node.js execution failed');
    }
    console.log('  ✓ Node.js works\n');

    // Test virtual environment creation
    console.log('8. Testing Python venv...');
    const result5 = await executeBash(
      'python3 -m venv .venv && source .venv/bin/activate && python --version',
      testProject.id,
      { timeout: 30000 }
    );
    if (!result5.success) {
      throw new Error(`Venv creation failed: ${result5.stderr}`);
    }
    console.log('  ✓ Can create Python venv\n');

    // Test package installation
    console.log('9. Testing package installation...');
    const result6 = await executeBash(
      'source .venv/bin/activate && pip install requests && python -c "import requests; print(requests.__version__)"',
      testProject.id,
      { timeout: 60000 }
    );
    if (!result6.success) {
      throw new Error(`Package installation failed: ${result6.stderr}`);
    }
    console.log('  ✓ Can install packages in venv\n');

    // Test npm
    console.log('10. Testing npm...');
    const result7 = await executeBash(
      'npm init -y && npm install lodash && node -e "const _ = require(\'lodash\'); console.log(_.VERSION)"',
      testProject.id,
      { timeout: 60000 }
    );
    if (!result7.success) {
      throw new Error(`npm installation failed: ${result7.stderr}`);
    }
    console.log('  ✓ Can install npm packages\n');

    // Test timeout
    console.log('11. Testing timeout...');
    try {
      await executeBash('sleep 100', testProject.id, { timeout: 1000 });
      throw new Error('Timeout should have triggered');
    } catch (err) {
      if (!err.message.includes('timeout')) throw err;
      console.log('  ✓ Timeout works\n');
    }

    // Test network access
    console.log('12. Testing network access...');
    const result8 = await executeBash(
      'curl -I https://www.google.com',
      testProject.id,
      { network: 'bridge' }
    );
    if (!result8.success) {
      throw new Error('Network access failed');
    }
    console.log('  ✓ Network access works (when enabled)\n');

    // Test network isolation
    console.log('13. Testing network isolation...');
    const result9 = await executeBash(
      'curl -I https://www.google.com',
      testProject.id,
      { network: 'none', timeout: 5000 }
    );
    if (result9.success) {
      throw new Error('Network should be blocked');
    }
    console.log('  ✓ Network isolation works (when disabled)\n');

    console.log('✅ All Docker execution tests passed!');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  } finally {
    // Cleanup
    if (testProject) {
      deleteProject(testProject.id);

      const projectDir = path.join(__dirname, '../../projects', testProject.id);
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }
}

runTests();
```

## Building the Image

```bash
# Build the Docker image
cd server/execution
docker build -t multimodelchat-executor .

# Or from project root
docker build -t multimodelchat-executor -f server/execution/Dockerfile server/execution
```

## Running Tests

```bash
# Make sure Docker is running, then:
node server/execution/test-docker.js
```

## Success Criteria

- [ ] Docker image builds successfully
- [ ] Can execute simple bash commands
- [ ] Project directory correctly mounted
- [ ] Files created in container appear on host
- [ ] Python works (python3 available)
- [ ] Node.js works (node available)
- [ ] Can create Python venv in project
- [ ] Can install packages with pip
- [ ] Can install packages with npm
- [ ] Timeout protection works
- [ ] Network access works when enabled
- [ ] Network isolated when disabled
- [ ] Memory and CPU limits apply
- [ ] Test script passes

## Common Issues

**"Cannot connect to Docker daemon"**
→ Start Docker Desktop

**"Image not found"**
→ Run `docker build` to create the image

**"Permission denied" on mounted volume**
→ This often happens when files are created by the container as `root` user, but your host user doesn't have permissions to modify them. The `--user` flag in `docker run` sets the container user to match the host user's UID and GID, preventing this.

**"Package installation fails"**
→ Increase timeout for pip/npm commands (they can be slow)

**"Network access works when it shouldn't"**
→ Check `network: 'none'` is being passed correctly

## Security Notes

- Containers are ephemeral (`--rm`) - no state persists in container
- Resource limits prevent runaway processes
- Network can be completely disabled
- Working directory is isolated to project
- File permissions on the host are maintained by running the container process as the host user.

## Next Steps

After this step completes:
- **Step 05:** Integrate Docker execution into /api/turn as a tool
- Models will be able to call bash and run code!

---

**Previous:** [03-conversations-as-files.md](03-conversations-as-files.md) | **Next:** [05-tool-integration.md](05-tool-integration.md)
