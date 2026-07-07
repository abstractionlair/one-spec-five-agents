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
    console.log('2. Checking Docker image...');
    const imageBuilt = await isImageBuilt();
    if (!imageBuilt) {
      console.log('  Image not found, building...');
      await buildImage();
      console.log('  ✓ Image built successfully');
    } else {
      console.log('  ✓ Image already built');
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
      throw new Error('Basic command failed');
    }
    if (!result1.stdout.includes('Hello from Docker')) {
      throw new Error('Output mismatch');
    }
    console.log('  ✓ Basic command works');
    console.log(`  Output: ${result1.stdout.trim()}\n`);

    // Test Python
    console.log('5. Testing Python...');
    const result2 = await executeBash('python3 --version', testProject.id);
    if (!result2.success) {
      throw new Error('Python not available');
    }
    console.log(`  ✓ Python available: ${result2.stdout.trim()}\n`);

    // Test Node.js
    console.log('6. Testing Node.js...');
    const result3 = await executeBash('node --version', testProject.id);
    if (!result3.success) {
      throw new Error('Node.js not available');
    }
    console.log(`  ✓ Node.js available: ${result3.stdout.trim()}\n`);

    // Test file creation
    console.log('7. Testing file creation...');
    await executeBash('echo "test content" > test.txt', testProject.id);
    const projectPath = path.join(__dirname, '../../projects', testProject.id, 'files');
    const testFile = await fs.readFile(path.join(projectPath, 'test.txt'), 'utf-8');
    if (!testFile.includes('test content')) {
      throw new Error('File creation failed');
    }
    console.log('  ✓ Can create files in project directory\n');

    // Test Python venv
    console.log('8. Testing Python venv...');
    await executeBash('python3 -m venv .venv', testProject.id, { timeout: 30000 });
    const venvExists = await fs.access(path.join(projectPath, '.venv'))
      .then(() => true)
      .catch(() => false);
    if (!venvExists) {
      throw new Error('venv creation failed');
    }
    console.log('  ✓ Can create Python venv\n');

    // Test timeout
    console.log('9. Testing timeout...');
    try {
      await executeBash('sleep 10', testProject.id, { timeout: 1000 });
      throw new Error('Timeout did not trigger');
    } catch (err) {
      if (!err.message.includes('timeout')) {
        throw err;
      }
      console.log('  ✓ Timeout protection works\n');
    }

    console.log('✅ All Docker tests passed!');

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
