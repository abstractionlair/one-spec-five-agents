# Step 04: Bubblewrap Sandbox Execution

**Goal:** Execute bash commands in sandboxed bubblewrap processes with project directory mounted.

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 02 (File storage - need project directories)

## Overview

Models execute code in isolated bubblewrap sandboxes:
- **Ephemeral processes** - Each command spawns a new sandbox
- **Project directory mounted** - Files persist on host at `/workspace`
- **Lightweight** - ~1ms startup overhead (vs ~1.5s for Docker)
- **Linux namespaces** - PID, network, filesystem isolation
- **Network access** - Enabled by default for package installs

**Note:** Bubblewrap is Linux-only. This spec assumes hosting on a Fedora (or similar) Linux server.

## Prerequisites

Install bubblewrap on the host system:

```bash
# Fedora
sudo dnf install bubblewrap

# Ubuntu/Debian
sudo apt install bubblewrap

# Verify installation
bwrap --version
```

Ensure system has Python and Node.js at latest stable versions:

```bash
# Check versions (should be latest stable)
python3 --version   # e.g., 3.14.x
node --version      # e.g., v24.x (LTS)
```

## File Structure

```
server/
  execution/
    sandbox.py        # Bubblewrap execution logic
  tests/
    test_sandbox.py   # Integration tests
```

## Implementation

### 1. Sandbox Executor (server/execution/sandbox.py)

```python
"""Bubblewrap sandbox execution for running bash commands."""

import asyncio
import shutil
from pathlib import Path
from dataclasses import dataclass
from typing import Any

from files.storage import PROJECTS_ROOT


DEFAULT_TIMEOUT = 60  # seconds


@dataclass
class ExecutionResult:
    """Result of a sandbox command execution."""
    stdout: str
    stderr: str
    exit_code: int
    success: bool
    timed_out: bool = False


def get_workspace_path(project_id: str) -> Path:
    """Get the workspace path for a project."""
    return PROJECTS_ROOT / project_id / "workspace"


async def execute_bash(
    command: str,
    project_id: str,
    timeout: int = DEFAULT_TIMEOUT,
    network: bool = True,
    env: dict[str, str] | None = None
) -> ExecutionResult:
    """
    Execute bash command in bubblewrap sandbox.

    Args:
        command: Bash command to execute
        project_id: Project ID for workspace directory
        timeout: Maximum execution time in seconds
        network: Whether to allow network access
        env: Additional environment variables

    Returns:
        ExecutionResult with stdout, stderr, exit_code
    """
    env = env or {}

    # Get project workspace path
    workspace_path = get_workspace_path(project_id)

    # Ensure workspace exists
    workspace_path.mkdir(parents=True, exist_ok=True)

    # Build bubblewrap command
    bwrap_args = [
        "bwrap",
        # Read-only system binaries
        "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/lib", "/lib",
        "--ro-bind", "/lib64", "/lib64",
        "--ro-bind", "/bin", "/bin",
        "--ro-bind", "/sbin", "/sbin",
        # Read-write project directory
        "--bind", str(workspace_path), "/workspace",
        # Ephemeral temp space
        "--tmpfs", "/tmp",
        # Process and device access
        "--proc", "/proc",
        "--dev", "/dev",
        # Isolation
        "--unshare-all",
        # Die when parent exits
        "--die-with-parent",
        # Working directory
        "--chdir", "/workspace",
    ]

    # Network access (enabled by default for package installs)
    if network:
        bwrap_args.append("--share-net")

    # Set PATH to include common locations
    path_value = "/usr/local/bin:/usr/bin:/bin:/workspace/.venv/bin:/workspace/.pyenv/shims"
    bwrap_args.extend(["--setenv", "PATH", path_value])
    bwrap_args.extend(["--setenv", "HOME", "/workspace"])

    # Add custom environment variables
    for key, value in env.items():
        bwrap_args.extend(["--setenv", key, value])

    # Add command
    bwrap_args.extend(["bash", "-c", command])

    try:
        proc = await asyncio.create_subprocess_exec(
            *bwrap_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(),
                timeout=timeout
            )

            return ExecutionResult(
                stdout=stdout_bytes.decode("utf-8", errors="replace"),
                stderr=stderr_bytes.decode("utf-8", errors="replace"),
                exit_code=proc.returncode or 0,
                success=proc.returncode == 0
            )

        except asyncio.TimeoutError:
            # Kill the process on timeout
            proc.kill()
            await proc.wait()

            return ExecutionResult(
                stdout="",
                stderr=f"Command timed out after {timeout} seconds",
                exit_code=-1,
                success=False,
                timed_out=True
            )

    except FileNotFoundError:
        return ExecutionResult(
            stdout="",
            stderr="Bubblewrap (bwrap) not found. Install with: sudo dnf install bubblewrap",
            exit_code=-1,
            success=False
        )
    except Exception as e:
        return ExecutionResult(
            stdout="",
            stderr=f"Sandbox execution error: {str(e)}",
            exit_code=-1,
            success=False
        )


async def is_bubblewrap_available() -> bool:
    """Check if bubblewrap is installed and available."""
    bwrap_path = shutil.which("bwrap")
    if not bwrap_path:
        return False

    try:
        proc = await asyncio.create_subprocess_exec(
            "bwrap", "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        await proc.wait()
        return proc.returncode == 0
    except Exception:
        return False


async def get_bubblewrap_version() -> str | None:
    """Get the bubblewrap version string."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "bwrap", "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        if proc.returncode == 0:
            return stdout.decode().strip()
        return None
    except Exception:
        return None
```

### 2. Integration Test (server/tests/test_sandbox.py)

```python
"""Test bubblewrap sandbox execution."""

import asyncio
import sys
import shutil
from pathlib import Path

# Add server to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import init_db, close_db
from db.projects import create_project, delete_project
from files.storage import PROJECTS_ROOT
from execution.sandbox import (
    execute_bash,
    is_bubblewrap_available,
    get_bubblewrap_version,
    get_workspace_path
)


async def run_tests():
    """Run all sandbox execution tests."""
    print("=== Testing Bubblewrap Sandbox Execution ===\n")

    test_project = None

    try:
        # Initialize database
        await init_db()

        # Check bubblewrap availability
        print("1. Checking bubblewrap availability...")
        if not await is_bubblewrap_available():
            raise RuntimeError(
                "Bubblewrap is not available. Install with: sudo dnf install bubblewrap"
            )
        version = await get_bubblewrap_version()
        print(f"     Bubblewrap is available: {version}\n")

        # Create test project
        print("2. Creating test project...")
        test_project = await create_project("Sandbox Test", "Testing sandbox execution")
        print(f"     Created project {test_project.id}\n")

        # Test basic command
        print("3. Testing basic command...")
        result1 = await execute_bash('echo "Hello from sandbox"', test_project.id)
        if not result1.success:
            raise RuntimeError(f"Command failed: {result1.stderr}")
        if "Hello from sandbox" not in result1.stdout:
            raise RuntimeError("Unexpected output")
        print("     Basic command works")
        print(f"   Output: {result1.stdout.strip()}\n")

        # Test file creation
        print("4. Testing file creation...")
        result2 = await execute_bash(
            'echo "test content" > test-output.txt',
            test_project.id
        )
        if not result2.success:
            raise RuntimeError(f"File creation failed: {result2.stderr}")

        # Verify file exists on host
        workspace_path = get_workspace_path(test_project.id)
        file_path = workspace_path / "test-output.txt"
        if not file_path.exists():
            raise RuntimeError("File not created on host")
        content = file_path.read_text()
        if "test content" not in content:
            raise RuntimeError("File content mismatch")
        print("     Can create files visible on host\n")

        # Test Python (system version)
        print("5. Testing Python...")
        result3 = await execute_bash(
            'python3 -c "print(2 + 2)"',
            test_project.id
        )
        if "4" not in result3.stdout:
            raise RuntimeError(f"Python execution failed: {result3.stderr}")
        print("     Python works\n")

        # Test Node.js (system version)
        print("6. Testing Node.js...")
        result4 = await execute_bash(
            'node -e "console.log(2 + 2)"',
            test_project.id
        )
        if "4" not in result4.stdout:
            raise RuntimeError(f"Node.js execution failed: {result4.stderr}")
        print("     Node.js works\n")

        # Test virtual environment creation
        print("7. Testing Python venv...")
        result5 = await execute_bash(
            'python3 -m venv .venv && source .venv/bin/activate && python --version',
            test_project.id,
            timeout=30
        )
        if not result5.success:
            raise RuntimeError(f"Venv creation failed: {result5.stderr}")
        print("     Can create Python venv\n")

        # Test package installation
        print("8. Testing package installation...")
        result6 = await execute_bash(
            'source .venv/bin/activate && pip install requests && python -c "import requests; print(requests.__version__)"',
            test_project.id,
            timeout=120
        )
        if not result6.success:
            raise RuntimeError(f"Package installation failed: {result6.stderr}")
        print("     Can install packages in venv\n")

        # Test npm
        print("9. Testing npm...")
        result7 = await execute_bash(
            "npm init -y && npm install lodash && node -e \"const _ = require('lodash'); console.log(_.VERSION)\"",
            test_project.id,
            timeout=120
        )
        if not result7.success:
            raise RuntimeError(f"npm installation failed: {result7.stderr}")
        print("     Can install npm packages\n")

        # Test timeout
        print("10. Testing timeout...")
        result_timeout = await execute_bash(
            "sleep 100",
            test_project.id,
            timeout=2
        )
        if not result_timeout.timed_out:
            raise RuntimeError("Timeout should have triggered")
        print("     Timeout works\n")

        # Test network access
        print("11. Testing network access...")
        result8 = await execute_bash(
            "curl -I https://www.google.com --connect-timeout 5",
            test_project.id,
            network=True,
            timeout=10
        )
        if not result8.success:
            raise RuntimeError(f"Network access failed: {result8.stderr}")
        print("     Network access works (when enabled)\n")

        # Test network isolation
        print("12. Testing network isolation...")
        result9 = await execute_bash(
            "curl -I https://www.google.com --connect-timeout 2",
            test_project.id,
            network=False,
            timeout=5
        )
        if result9.success:
            raise RuntimeError("Network should be blocked")
        print("     Network isolation works (when disabled)\n")

        print(" All sandbox execution tests passed!")

    except Exception as err:
        print(f"\n Test failed: {err}")
        sys.exit(1)
    finally:
        # Cleanup
        if test_project:
            await delete_project(test_project.id)

            # Delete project directory
            project_dir = PROJECTS_ROOT / test_project.id
            if project_dir.exists():
                shutil.rmtree(project_dir)

        await close_db()


if __name__ == "__main__":
    asyncio.run(run_tests())
```

## System Setup

```bash
# Install bubblewrap (Fedora)
sudo dnf install bubblewrap

# Install bubblewrap (Ubuntu/Debian)
sudo apt install bubblewrap

# Verify installation
bwrap --version

# Ensure Python and Node.js are installed (latest stable versions)
python3 --version
node --version

# Create projects directory
sudo mkdir -p /srv/projects
sudo chown $USER /srv/projects
```

## Running Tests

```bash
# Run sandbox tests (requires Linux with bubblewrap)
python -m server.tests.test_sandbox
```

## Success Criteria

- [ ] Bubblewrap installed and available
- [ ] Can execute simple bash commands
- [ ] Project directory correctly mounted at /project
- [ ] Files created in sandbox appear on host
- [ ] Python works (system python3)
- [ ] Node.js works (system node)
- [ ] Can create Python venv in project
- [ ] Can install packages with pip
- [ ] Can install packages with npm
- [ ] Timeout protection works
- [ ] Network access works when enabled
- [ ] Network isolated when disabled
- [ ] Test script passes

## Common Issues

**"bwrap: command not found"**
→ Install bubblewrap: `sudo dnf install bubblewrap` (Fedora) or `sudo apt install bubblewrap` (Debian/Ubuntu)

**"Permission denied" errors**
→ Ensure project directories have correct permissions: `sudo chown -R $USER /srv/projects`

**"Package installation fails"**
→ Increase timeout for pip/npm commands (they can be slow on first install)

**"Network access works when it shouldn't"**
→ Check `network=False` is being passed and `--share-net` is not added

**"Cannot find python3 or node"**
→ Ensure system Python and Node.js are installed at latest stable versions

## Security Notes

- Sandboxes are ephemeral processes - no state persists in sandbox
- System directories are mounted read-only
- Project directory is the only writable location
- PID namespace isolation prevents seeing host processes
- Network can be disabled per-project
- Timeout kills runaway processes
- Single-user model: provides accident prevention, not hardened security

## Next Steps

After this step completes:
- **Step 05:** Integrate sandbox execution into /api/turn as a tool
- Models will be able to call bash and run code!

---

**Previous:** [03-conversations-as-files.md](03-conversations-as-files.md) | **Next:** [05-tool-integration.md](05-tool-integration.md)
