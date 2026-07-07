const { createProject, deleteProject } = require('./db/projects');
const { createFile } = require('./files/storage');
const { createConversation, saveMessage } = require('./conversations/writer');
const { search } = require('./indexing/search');
const fs = require('fs').promises;
const path = require('path');

async function runTests() {
  console.log('=== Testing Search ===\n');

  let testProject;

  try {
    // Create test project
    console.log('1. Creating test project...');
    testProject = createProject('Search Test', 'Testing search');
    console.log(`  \u2713 Created project ${testProject.id}\n`);

    // Create test files
    console.log('2. Creating test files...');
    await createFile(
      testProject.id,
      'auth.js',
      'function authenticate(user) {\n  // Check credentials\n  return validateToken(user.token);\n}',
      'text/javascript'
    );

    await createFile(
      testProject.id,
      'README.md',
      '# Authentication\n\nThis module handles user authentication using JWT tokens.',
      'text/markdown'
    );

    console.log('  \u2713 Created test files\n');

    // Create conversation with messages
    console.log('3. Creating conversation...');
    const conv = createConversation(testProject.id, 'Search Test Conv');
    await saveMessage(
      conv.id,
      1,
      'user',
      'How does authentication work?',
      {}
    );
    await saveMessage(
      conv.id,
      1,
      'agent:gpt-4o',
      'Authentication works by validating JWT tokens.',
      { model: 'gpt-4o', provider: 'openai' }
    );
    console.log('  \u2713 Created conversation with messages\n');

    // Search for "authentication"
    console.log('4. Searching for "authentication"...');
    const results1 = search(testProject.id, 'authentication');
    if (results1.length === 0) {
      throw new Error('No results found');
    }
    console.log(`  \u2713 Found ${results1.length} results:`);
    results1.forEach(r => {
      console.log(`    - ${r.type}: ${r.file_path || `Round ${r.round}`}`);
    });
    console.log();

    // Search for "token"
    console.log('5. Searching for "token"...');
    const results2 = search(testProject.id, 'token');
    const hasFile = results2.some(r => r.type === 'file');
    const hasConv = results2.some(r => r.type === 'conversation');
    if (!hasFile || !hasConv) {
      throw new Error('Should find results in both files and conversations');
    }
    console.log('  \u2713 Found results in both files and conversations\n');

    // Search files only
    console.log('6. Searching files only...');
    const results3 = search(testProject.id, 'authentication', {
      includeFiles: true,
      includeConversations: false
    });
    if (results3.some(r => r.type === 'conversation')) {
      throw new Error('Should not include conversations when includeConversations=false');
    }
    console.log('  \u2713 Filtered to files only\n');

    // Test snippets
    console.log('7. Testing snippets...');
    if (!results1[0].snippet) {
      throw new Error('No snippet in results');
    }
    if (!results1[0].snippet.includes('<mark>')) {
      throw new Error('Snippet not highlighting matches');
    }
    console.log('  \u2713 Snippets work\n');

    console.log('✅ All search tests passed!');

  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  } finally {
    // Cleanup
    if (testProject) {
      deleteProject(testProject.id);

      const projectDir = path.join(__dirname, '../projects', testProject.id);
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }
}

runTests();
