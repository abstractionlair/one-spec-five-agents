const { runMigrations } = require('../db/migrations');
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
    runMigrations();
    console.log('✓ Migrations applied\n');

    console.log('1. Checking Docker availability...');
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      throw new Error('Docker is not available. Please install Docker Desktop.');
    }
    console.log('  ✓ Docker is available\n');

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

    console.log('3. Creating test project...');
    testProject = createProject('Docker Test', 'Testing Docker execution');
    console.log(`  ✓ Created project ${testProject.id}\n`);

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

    console.log('5. Testing file creation...');
    const result2 = await executeBash('echo "test content" > test-output.txt', testProject.id);
    if (!result2.success) {
      throw new Error(`File creation failed: ${result2.stderr}`);
    }

    const projectPath = path.join(__dirname, '../../projects', testProject.id, 'files');
    const filePath = path.join(projectPath, 'test-output.txt');
    const content = await fs.readFile(filePath, 'utf-8');
    if (!content.includes('test content')) {
      throw new Error('File content mismatch');
    }
    console.log('  ✓ Can create files visible on host\n');

    console.log('6. Testing Python...');
    const result3 = await executeBash('python3 -c "print(2 + 2)"', testProject.id);
    if (!result3.stdout.includes('4')) {
      throw new Error('Python execution failed');
    }
    console.log('  ✓ Python works\n');

    console.log('7. Testing Node.js...');
    const result4 = await executeBash('node -e "console.log(2 + 2)"', testProject.id);
    if (!result4.stdout.includes('4')) {
      throw new Error('Node.js execution failed');
    }
    console.log('  ✓ Node.js works\n');

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

    console.log('10. Testing npm...');
    const result7 = await executeBash(
      "npm init -y && npm install lodash && node -e \"const _ = require('lodash'); console.log(_.VERSION)\"",
      testProject.id,
      { timeout: 60000 }
    );
    if (!result7.success) {
      throw new Error(`npm installation failed: ${result7.stderr}`);
    }
    console.log('  ✓ Can install npm packages\n');

    console.log('11. Testing timeout...');
    try {
      await executeBash('sleep 100', testProject.id, { timeout: 1000 });
      throw new Error('Timeout should have triggered');
    } catch (err) {
      if (!err.message.includes('timeout')) throw err;
      console.log('  ✓ Timeout works\n');
    }

    console.log('12. Testing network access...');
    const result8 = await executeBash('curl -I https://www.google.com', testProject.id, { network: 'bridge' });
    if (!result8.success) {
      throw new Error('Network access failed');
    }
    console.log('  ✓ Network access works (when enabled)\n');

    console.log('13. Testing network isolation...');
    const result9 = await executeBash('curl -I https://www.google.com', testProject.id, { network: 'none', timeout: 5000 });
    if (result9.success) {
      throw new Error('Network should be blocked');
    }
    console.log('  ✓ Network isolation works (when disabled)\n');

    console.log('✅ All Docker execution tests passed!');
  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  } finally {
    if (testProject) {
      deleteProject(testProject.id);
      const projectDir = path.join(__dirname, '../../projects', testProject.id);
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }
}

runTests();
