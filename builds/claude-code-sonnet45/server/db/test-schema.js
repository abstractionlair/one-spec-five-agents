const { db } = require('./index');
const { runMigrations } = require('./migrations');
const {
  createProject,
  getProject,
  listProjects,
  updateProject,
  deleteProject
} = require('./projects');
const {
  getConfig,
  setConfig,
  listConfig,
  deleteConfig
} = require('./config');

async function runTests() {
  console.log('=== Testing Database Schema ===\n');

  try {
    // Run migrations
    console.log('1. Running migrations...');
    runMigrations();
    console.log('✓ Migrations complete\n');

    // Test projects
    console.log('2. Testing project CRUD...');

    const project = createProject(
      'Test Project',
      'A test project',
      { allow_network: true }
    );
    console.log('  Created project:', project.id);

    const retrieved = getProject(project.id);
    if (!retrieved) throw new Error('Failed to retrieve project');
    console.log('  ✓ Can retrieve project');

    const updated = updateProject(project.id, { name: 'Updated Project' });
    if (updated.name !== 'Updated Project') {
      throw new Error('Failed to update project');
    }
    console.log('  ✓ Can update project');

    const projects = listProjects();
    if (projects.length === 0) throw new Error('No projects listed');
    console.log('  ✓ Can list projects');

    // Test config
    console.log('\n3. Testing config CRUD...');

    setConfig('test_key', { value: 'test' });
    console.log('  ✓ Can set config');

    const configValue = getConfig('test_key');
    if (!configValue || configValue.value !== 'test') {
      throw new Error('Failed to retrieve config');
    }
    console.log('  ✓ Can get config');

    const allConfig = listConfig();
    if (!allConfig.test_key) throw new Error('Config not in list');
    console.log('  ✓ Can list config');

    deleteConfig('test_key');
    if (getConfig('test_key')) throw new Error('Failed to delete config');
    console.log('  ✓ Can delete config');

    // Test foreign keys
    console.log('\n4. Testing foreign keys...');

    // Insert a file record
    db.prepare(`
      INSERT INTO project_files (id, project_id, path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('file_test', project.id, 'test.txt', Date.now(), Date.now());

    // Delete project should cascade
    deleteProject(project.id);

    const fileExists = db.prepare('SELECT * FROM project_files WHERE id = ?')
      .get('file_test');

    if (fileExists) throw new Error('Cascade delete failed');
    console.log('  ✓ Foreign key cascade works');

    console.log('\n✅ All tests passed!');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  }
}

runTests();
