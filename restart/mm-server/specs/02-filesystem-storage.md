# Step 02: Filesystem Storage & File APIs

**Goal:** Store files on the filesystem, track metadata in the database, and provide APIs for file operations.

**Complexity:** Medium (3-4 hours)

**Dependencies:** Step 01 (Database schema)

## Overview

This step implements file storage where:
1. **Files live on disk** in `/srv/projects/{project-id}/workspace/`
2. **Metadata lives in database** (`project_files` table)
3. **Content hash** detects changes for re-indexing

## Directory Structure

```
/srv/projects/
  proj_abc123_def456/
    workspace/              # Files accessible to sandbox
      data/
        sales.csv
      scripts/
        analyze.py
      README.md
    .metadata/              # System metadata (not in sandbox)
      .conversations/
```

## File Structure

```
server/
  files/
    storage.py       # Core file operations
    routes.py        # FastAPI routes for file APIs
  utils/
    hash.py          # SHA256 hashing utility
    sanitize.py      # Path sanitization
  tests/
    test_file_apis.py  # Integration tests
```

## Implementation

### 1. Path Utilities (server/utils/sanitize.py)

```python
"""Path sanitization utilities to prevent directory traversal."""

from pathlib import Path, PurePosixPath


def sanitize_path(user_path: str) -> str:
    """
    Sanitize user-provided file paths to prevent directory traversal.

    Args:
        user_path: User-provided path string

    Returns:
        Sanitized relative path

    Raises:
        ValueError: If path is invalid or attempts traversal
    """
    if not user_path or not isinstance(user_path, str):
        raise ValueError("Invalid path: must be a non-empty string")

    # Use PurePosixPath for consistent behavior across platforms
    path = PurePosixPath(user_path)

    # Get parts and filter out empty strings and current directory references
    parts = [p for p in path.parts if p and p != "."]

    # Check for directory traversal attempts
    if ".." in parts or "~" in user_path:
        raise ValueError("Invalid path: directory traversal not allowed")

    # Check for absolute paths
    if path.is_absolute():
        raise ValueError("Invalid path: absolute paths not allowed")

    # Reconstruct clean path
    clean = "/".join(parts) if parts else ""

    if not clean:
        raise ValueError("Invalid path: path resolves to empty")

    return clean
```

### 2. Hash Utility (server/utils/hash.py)

```python
"""Content hashing utilities for change detection."""

import hashlib


def hash_content(content: bytes | str) -> str:
    """
    Generate SHA256 hash of content for change detection.

    Args:
        content: File content as bytes or string

    Returns:
        Hex-encoded SHA256 hash
    """
    if isinstance(content, str):
        content = content.encode("utf-8")

    return hashlib.sha256(content).hexdigest()
```

### 3. File Storage Core (server/files/storage.py)

```python
"""Core file storage operations."""

import json
import mimetypes
from pathlib import Path
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import aiofiles
import aiofiles.os

from db import query, query_one, execute, new_id
from utils.sanitize import sanitize_path
from utils.hash import hash_content


# Base directory for all projects
PROJECTS_ROOT = Path("/srv/projects")


def get_project_path(project_id: str) -> Path:
    """Get absolute path to project workspace directory."""
    return PROJECTS_ROOT / project_id / "workspace"


async def ensure_project_directory(project_id: str) -> Path:
    """Ensure project workspace directory exists."""
    project_path = get_project_path(project_id)
    await aiofiles.os.makedirs(project_path, exist_ok=True)
    return project_path


@dataclass
class ProjectFile:
    """File metadata model."""
    id: str
    project_id: str
    path: str
    content_hash: str | None
    mime_type: str | None
    size_bytes: int | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_record(cls, record) -> "ProjectFile":
        """Create ProjectFile from database record."""
        return cls(
            id=record["id"],
            project_id=record["project_id"],
            path=record["path"],
            content_hash=record["content_hash"],
            mime_type=record["mime_type"],
            size_bytes=record["size_bytes"],
            created_at=record["created_at"],
            updated_at=record["updated_at"]
        )


async def create_file(
    project_id: str,
    file_path: str,
    content: bytes | str,
    mime_type: str | None = None
) -> ProjectFile:
    """
    Upload/create a file in the project.

    Args:
        project_id: Project ID
        file_path: Relative path within project workspace
        content: File content
        mime_type: MIME type (auto-detected if not provided)

    Returns:
        Created file metadata
    """
    # Sanitize path
    sanitized = sanitize_path(file_path)

    # Ensure project directory exists
    project_path = await ensure_project_directory(project_id)

    # Full file path
    full_path = project_path / sanitized

    # Create parent directories
    await aiofiles.os.makedirs(full_path.parent, exist_ok=True)

    # Ensure content is bytes
    if isinstance(content, str):
        content_bytes = content.encode("utf-8")
    else:
        content_bytes = content

    # Write file
    async with aiofiles.open(full_path, "wb") as f:
        await f.write(content_bytes)

    # Calculate hash and size
    content_hash = hash_content(content_bytes)
    size_bytes = len(content_bytes)

    # Auto-detect MIME type if not provided
    if mime_type is None:
        mime_type, _ = mimetypes.guess_type(sanitized)
        if mime_type is None:
            mime_type = "application/octet-stream"

    # Store metadata in database
    file_id = new_id("file")

    await execute("""
        INSERT INTO project_files
        (id, project_id, path, content_hash, mime_type, size_bytes)
        VALUES ($1, $2, $3, $4, $5, $6)
    """, file_id, project_id, sanitized, content_hash, mime_type, size_bytes)

    file = await get_file(file_id)
    if not file:
        raise RuntimeError("Failed to create file")
    return file


async def get_file(file_id: str) -> ProjectFile | None:
    """Get file metadata from database."""
    row = await query_one(
        "SELECT * FROM project_files WHERE id = $1",
        file_id
    )

    if not row:
        return None
    return ProjectFile.from_record(row)


async def get_file_by_path(project_id: str, file_path: str) -> ProjectFile | None:
    """Get file by project and path."""
    sanitized = sanitize_path(file_path)

    row = await query_one("""
        SELECT * FROM project_files
        WHERE project_id = $1 AND path = $2
    """, project_id, sanitized)

    if not row:
        return None
    return ProjectFile.from_record(row)


async def read_file_content(file_id: str) -> bytes:
    """Read file content from filesystem."""
    file = await get_file(file_id)
    if not file:
        raise ValueError("File not found")

    project_path = get_project_path(file.project_id)
    full_path = project_path / file.path

    async with aiofiles.open(full_path, "rb") as f:
        return await f.read()


async def list_files(project_id: str) -> list[ProjectFile]:
    """List all files in a project."""
    rows = await query("""
        SELECT * FROM project_files
        WHERE project_id = $1
        ORDER BY path
    """, project_id)

    return [ProjectFile.from_record(row) for row in rows]


async def update_file(file_id: str, content: bytes | str) -> ProjectFile:
    """Update file content."""
    file = await get_file(file_id)
    if not file:
        raise ValueError("File not found")

    # Ensure content is bytes
    if isinstance(content, str):
        content_bytes = content.encode("utf-8")
    else:
        content_bytes = content

    # Write to filesystem
    project_path = get_project_path(file.project_id)
    full_path = project_path / file.path

    async with aiofiles.open(full_path, "wb") as f:
        await f.write(content_bytes)

    # Update metadata
    content_hash = hash_content(content_bytes)
    size_bytes = len(content_bytes)

    await execute("""
        UPDATE project_files
        SET content_hash = $1, size_bytes = $2
        WHERE id = $3
    """, content_hash, size_bytes, file_id)

    updated = await get_file(file_id)
    if not updated:
        raise RuntimeError("Failed to retrieve updated file")
    return updated


async def delete_file(file_id: str) -> bool:
    """Delete file from filesystem and database."""
    file = await get_file(file_id)
    if not file:
        return False

    # Delete from filesystem
    project_path = get_project_path(file.project_id)
    full_path = project_path / file.path

    try:
        await aiofiles.os.remove(full_path)
    except FileNotFoundError:
        pass  # File already deleted from filesystem

    # Delete from database
    result = await execute(
        "DELETE FROM project_files WHERE id = $1",
        file_id
    )

    return result.endswith("1")


async def has_file_changed(file_id: str) -> bool:
    """Check if file content has changed (for re-indexing)."""
    file = await get_file(file_id)
    if not file:
        raise ValueError("File not found")

    content = await read_file_content(file_id)
    current_hash = hash_content(content)

    return current_hash != file.content_hash
```

### 4. File Routes (server/files/routes.py)

```python
"""FastAPI routes for file operations."""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel

from .storage import (
    create_file,
    get_file,
    read_file_content,
    list_files,
    update_file,
    delete_file,
    ProjectFile
)


router = APIRouter(tags=["files"])


class FileResponse(BaseModel):
    """File metadata response."""
    id: str
    project_id: str
    path: str
    content_hash: str | None
    mime_type: str | None
    size_bytes: int | None

    @classmethod
    def from_file(cls, file: ProjectFile) -> "FileResponse":
        return cls(
            id=file.id,
            project_id=file.project_id,
            path=file.path,
            content_hash=file.content_hash,
            mime_type=file.mime_type,
            size_bytes=file.size_bytes
        )


class CreateTextFileRequest(BaseModel):
    """Request to create a text file."""
    path: str
    content: str
    mime_type: str | None = None


class FileListResponse(BaseModel):
    """List of files response."""
    files: list[FileResponse]


@router.post("/projects/{project_id}/files", response_model=FileResponse)
async def upload_file(
    project_id: str,
    path: str = Form(...),
    file: UploadFile = File(...)
) -> FileResponse:
    """Upload a file to a project."""
    try:
        content = await file.read()
        created = await create_file(
            project_id,
            path,
            content,
            file.content_type
        )
        return FileResponse.from_file(created)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/files/text", response_model=FileResponse)
async def create_text_file(
    project_id: str,
    request: CreateTextFileRequest
) -> FileResponse:
    """Create a text file with string content."""
    try:
        created = await create_file(
            project_id,
            request.path,
            request.content,
            request.mime_type or "text/plain"
        )
        return FileResponse.from_file(created)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}/files", response_model=FileListResponse)
async def list_project_files(project_id: str) -> FileListResponse:
    """List all files in a project."""
    try:
        files = await list_files(project_id)
        return FileListResponse(
            files=[FileResponse.from_file(f) for f in files]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/files/{file_id}", response_model=FileResponse)
async def get_file_metadata(file_id: str) -> FileResponse:
    """Get file metadata."""
    file = await get_file(file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse.from_file(file)


@router.get("/files/{file_id}/content")
async def get_file_content(file_id: str) -> Response:
    """Get file content."""
    file = await get_file(file_id)
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    try:
        content = await read_file_content(file_id)
        return Response(
            content=content,
            media_type=file.mime_type or "application/octet-stream"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/files/{file_id}", response_model=FileResponse)
async def update_file_content(
    file_id: str,
    file: UploadFile = File(...)
) -> FileResponse:
    """Update file content."""
    try:
        content = await file.read()
        updated = await update_file(file_id, content)
        return FileResponse.from_file(updated)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/files/{file_id}")
async def delete_file_endpoint(file_id: str) -> dict:
    """Delete a file."""
    try:
        deleted = await delete_file(file_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="File not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### 5. Project Routes (server/projects/routes.py)

The UI needs CRUD endpoints for projects. These complement the `db/projects.py` helpers from Step 01.

```python
"""FastAPI routes for project operations."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any

from db.projects import (
    create_project,
    get_project,
    list_projects,
    update_project,
    delete_project,
    Project
)


router = APIRouter(tags=["projects"])


class ProjectResponse(BaseModel):
    """Project metadata response."""
    id: str
    name: str
    description: str | None
    settings: dict[str, Any]

    @classmethod
    def from_project(cls, project: Project) -> "ProjectResponse":
        return cls(
            id=project.id,
            name=project.name,
            description=project.description,
            settings=project.settings
        )


class CreateProjectRequest(BaseModel):
    """Request to create a project."""
    name: str
    description: str | None = None


class UpdateProjectRequest(BaseModel):
    """Request to update a project."""
    name: str | None = None
    description: str | None = None
    settings: dict[str, Any] | None = None


class ProjectListResponse(BaseModel):
    """List of projects response."""
    projects: list[ProjectResponse]


@router.post("/projects", response_model=ProjectResponse)
async def create_project_endpoint(request: CreateProjectRequest) -> ProjectResponse:
    """Create a new project."""
    try:
        project = await create_project(request.name, request.description)
        return ProjectResponse.from_project(project)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects", response_model=ProjectListResponse)
async def list_projects_endpoint() -> ProjectListResponse:
    """List all projects."""
    try:
        projects = await list_projects()
        return ProjectListResponse(
            projects=[ProjectResponse.from_project(p) for p in projects]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project_endpoint(project_id: str) -> ProjectResponse:
    """Get a project by ID."""
    try:
        project = await get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return ProjectResponse.from_project(project)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project_endpoint(
    project_id: str,
    request: UpdateProjectRequest
) -> ProjectResponse:
    """Update a project."""
    try:
        project = await update_project(
            project_id,
            name=request.name,
            description=request.description,
            settings=request.settings
        )
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return ProjectResponse.from_project(project)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/projects/{project_id}")
async def delete_project_endpoint(project_id: str) -> dict:
    """Delete a project and all its files."""
    try:
        deleted = await delete_project(project_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**Note:** Register these routes in `server/main.py`:
```python
from projects.routes import router as project_router
app.include_router(project_router)
```

### 6. Integration Test (server/tests/test_file_apis.py)

```python
"""Test file storage operations."""

import asyncio
import sys
import shutil
from pathlib import Path

# Add server to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import init_db, close_db, execute
from db.projects import create_project, delete_project
from files.storage import (
    create_file,
    get_file,
    get_file_by_path,
    read_file_content,
    list_files,
    update_file,
    delete_file,
    has_file_changed,
    PROJECTS_ROOT
)


async def run_tests():
    """Run all file storage tests."""
    print("=== Testing File Storage ===\n")

    test_project = None

    try:
        # Initialize database
        await init_db()

        # Create test project
        print("1. Creating test project...")
        test_project = await create_project("File Test Project", "Testing file storage")
        print(f"     Created project {test_project.id}\n")

        # Test file creation
        print("2. Testing file creation...")
        file1 = await create_file(
            test_project.id,
            "test.txt",
            "Hello, world!",
            "text/plain"
        )
        print(f"     Created file {file1.id} at {file1.path}")

        # Verify file exists on filesystem
        project_path = PROJECTS_ROOT / test_project.id / "workspace"
        file_path = project_path / "test.txt"
        if not file_path.exists():
            raise RuntimeError("File not written to filesystem")
        print("     File exists on filesystem\n")

        # Test file reading
        print("3. Testing file reading...")
        content = await read_file_content(file1.id)
        if content.decode("utf-8") != "Hello, world!":
            raise RuntimeError("File content mismatch")
        print("     Can read file content\n")

        # Test file listing
        print("4. Testing file listing...")
        await create_file(test_project.id, "data/sales.csv", "col1,col2\n1,2", "text/csv")
        await create_file(test_project.id, "scripts/run.py", 'print("hi")', "text/x-python")

        files = await list_files(test_project.id)
        if len(files) != 3:
            raise RuntimeError(f"Expected 3 files, got {len(files)}")
        print(f"     Listed {len(files)} files")
        for f in files:
            print(f"    - {f.path}")
        print()

        # Test file by path lookup
        print("5. Testing file lookup by path...")
        found_file = await get_file_by_path(test_project.id, "data/sales.csv")
        if not found_file:
            raise RuntimeError("File not found by path")
        print(f"     Found file by path: {found_file.path}\n")

        # Test file update
        print("6. Testing file update...")
        updated = await update_file(file1.id, "Updated content")
        if updated.content_hash == file1.content_hash:
            raise RuntimeError("Content hash did not change")
        print("     File updated, hash changed\n")

        # Test change detection
        print("7. Testing change detection...")
        changed = await has_file_changed(file1.id)
        if changed:
            raise RuntimeError("File should not appear changed")
        print("     Change detection works\n")

        # Test file deletion
        print("8. Testing file deletion...")
        await delete_file(file1.id)
        deleted = await get_file(file1.id)
        if deleted:
            raise RuntimeError("File still in database")

        if file_path.exists():
            raise RuntimeError("File still on filesystem")
        print("     File deleted from database and filesystem\n")

        # Test path sanitization
        print("9. Testing path sanitization...")
        try:
            await create_file(test_project.id, "../../../etc/passwd", "hack")
            raise RuntimeError("Should have rejected traversal")
        except ValueError as e:
            if "traversal" not in str(e):
                raise
            print("     Directory traversal blocked\n")

        print(" All file storage tests passed!")

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

## Running

```bash
# Install dependencies
pip install aiofiles

# Run integration tests
python -m server.tests.test_file_apis
```

## Success Criteria

- [ ] Can create files in project directory
- [ ] Files written to `/srv/projects/{project-id}/workspace/{path}`
- [ ] Metadata stored in `project_files` table
- [ ] Can read file content from filesystem
- [ ] Can list all files in project
- [ ] Can update file content
- [ ] Can delete files (removes from DB and filesystem)
- [ ] Content hash calculated correctly
- [ ] Path sanitization prevents directory traversal
- [ ] Nested directories created automatically
- [ ] Test script passes

## Common Issues

**"FileNotFoundError: /srv/projects"**
→ Create base directory: `sudo mkdir -p /srv/projects && sudo chown $USER /srv/projects`

**"Path traversal not blocked"**
→ Check `sanitize_path` function is being called on all user-provided paths

**"File exists but metadata missing"**
→ Ensure both filesystem write and DB insert succeed atomically

**"Permission denied"**
→ Check filesystem permissions on `/srv/projects`

## Next Steps

After this step completes:
- **Step 03:** Add conversation storage as markdown files
- **Step 06:** Add indexing to make files searchable

---

**Previous:** [01-project-setup-and-schema.md](01-project-setup-and-schema.md) | **Next:** [03-conversations-as-files.md](03-conversations-as-files.md)
