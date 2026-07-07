const { dbPromise } = require('./db');
const { createProject, deleteProject } = require('./db/projects');
const {
  createFile,
  getFile,
  getFileByPath,
  readFileContent,
  listFiles,
  updateFile,
  deleteFile,
  hasFileChanged
} = require('./files/storage');
const fs = require('fs').promises;
const path = require('path');

async function runTests() {
  console.log('=== Testing File Storage ===\n');

  let testProject;

  try {
    // Wait for database initialization
    console.log('0. Initializing database...');
    await dbPromise;
    console.log('✓ Database initialized\n');

    // Create test project
    console.log('1. Creating test project...');
    testProject = createProject('File Test Project', 'Testing file storage');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    // Test file creation
    console.log('2. Testing file creation...');
    const file1 = await createFile(
      testProject.id,
      'test.txt',
      'Hello, world!',
      'text/plain'
    );
    console.log(`  ✓ Created file ${file1.id} at ${file1.path}`);

    // Verify file exists on filesystem
    const projectPath = path.join(__dirname, '../projects', testProject.id, 'files');
    const filePath = path.join(projectPath, 'test.txt');
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!exists) throw new Error('File not written to filesystem');
    console.log('  ✓ File exists on filesystem\n');

    // Test file reading
    console.log('3. Testing file reading...');
    const content = await readFileContent(file1.id);
    if (content.toString('utf-8') !== 'Hello, world!') {
      throw new Error('File content mismatch');
    }
    console.log('  ✓ Can read file content\n');

    // Test file listing
    console.log('4. Testing file listing...');
    await createFile(testProject.id, 'data/sales.csv', 'col1,col2\n1,2', 'text/csv');
    await createFile(testProject.id, 'scripts/run.py', 'print("hi")', 'text/x-python');

    const files = listFiles(testProject.id);
    if (files.length !== 3) {
      throw new Error(`Expected 3 files, got ${files.length}`);
    }
    console.log(`  ✓ Listed ${files.length} files`);
    files.forEach(f => console.log(`    - ${f.path}`));
    console.log();

    // Test file by path lookup
    console.log('5. Testing file lookup by path...');
    const foundFile = getFileByPath(testProject.id, 'data/sales.csv');
    if (!foundFile) throw new Error('File not found by path');
    console.log(`  ✓ Found file by path: ${foundFile.path}\n`);

    // Test file update
    console.log('6. Testing file update...');
    const updated = await updateFile(file1.id, 'Updated content');
    if (updated.content_hash === file1.content_hash) {
      throw new Error('Content hash did not change');
    }
    console.log('  ✓ File updated, hash changed\n');

    // Test change detection
    console.log('7. Testing change detection...');
    const changed = await hasFileChanged(file1.id);
    if (changed) throw new Error('File should not appear changed');
    console.log('  ✓ Change detection works\n');

    // Test file deletion
    console.log('8. Testing file deletion...');
    await deleteFile(file1.id);
    const deleted = getFile(file1.id);
    if (deleted) throw new Error('File still in database');

    const stillExists = await fs.access(filePath).then(() => true).catch(() => false);
    if (stillExists) throw new Error('File still on filesystem');
    console.log('  ✓ File deleted from database and filesystem\n');

    // Test path sanitization
    console.log('9. Testing path sanitization...');
    try {
      await createFile(testProject.id, '../../../etc/passwd', 'hack');
      throw new Error('Should have rejected traversal');
    } catch (err) {
      if (!err.message.includes('traversal')) throw err;
      console.log('  ✓ Directory traversal blocked\n');
    }

    console.log('✅ All file storage tests passed!');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  } finally {
    // Cleanup
    if (testProject) {
      deleteProject(testProject.id);

      // Delete project directory
      const projectDir = path.join(__dirname, '../projects', testProject.id);
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }
}

runTests();
