const { runMigrations } = require('./db/migrations');
const { createProject, deleteProject } = require('./db/projects');
const { createFile } = require('./files/storage');
const { createConversation } = require('./conversations/writer');
const { buildSystemPrompt, buildMessages } = require('./prompts/builder');

async function runTests() {
  console.log('=== Testing System Prompts ===\n');

  let testProject;

  try {
    runMigrations();
    console.log('✓ Migrations applied\n');

    console.log('1. Creating test project...');
    testProject = createProject('Prompt Test', 'Testing system prompts');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    console.log('2. Adding test files...');
    await createFile(testProject.id, 'test.py', 'print("hello")', 'text/x-python');
    await createFile(testProject.id, 'data.csv', 'a,b\n1,2', 'text/csv');
    console.log('  ✓ Added files\n');

    console.log('3. Creating conversation...');
    const conv = createConversation(testProject.id, 'Test');
    console.log(`  ✓ Created conversation ${conv.id}\n`);

    console.log('4. Building OpenAI system prompt...');
    const openaiPrompt = buildSystemPrompt('openai', 'gpt-4o', testProject.id, 1);

    if (!openaiPrompt.includes('Prompt Test')) {
      throw new Error('Prompt missing project name');
    }
    if (!openaiPrompt.includes('test.py')) {
      throw new Error('Prompt missing file listing');
    }
    if (!openaiPrompt.includes('bash')) {
      throw new Error('Prompt missing bash instructions');
    }
    if (!openaiPrompt.includes('venv')) {
      throw new Error('Prompt missing venv instructions');
    }
    console.log('  ✓ OpenAI prompt contains all required elements\n');

    console.log('5. Building Anthropic system prompt...');
    const anthropicPrompt = buildSystemPrompt('anthropic', 'claude-sonnet-4-5', testProject.id, 1);
    if (!anthropicPrompt.includes('Prompt Test')) {
      throw new Error('Prompt missing project name');
    }
    console.log('  ✓ Anthropic prompt contains required elements\n');

    console.log('6. Building OpenAI messages...');
    const { saveMessage } = require('./conversations/writer');
    await saveMessage(conv.id, 1, 'user', 'Hello', {});

    const openaiBuilt = await buildMessages({
      conversationId: conv.id,
      provider: 'openai',
      modelId: 'gpt-4o',
      roundNumber: 1
    });

    if (!Array.isArray(openaiBuilt.messages)) {
      throw new Error('OpenAI messages should be array');
    }
    if (openaiBuilt.messages[0].role !== 'system') {
      throw new Error('First OpenAI message should be system');
    }
    if (!openaiBuilt.messages.some((m) => m.role === 'user')) {
      throw new Error('OpenAI messages should include user history');
    }
    console.log('  ✓ OpenAI messages structured correctly with history\n');

    console.log('7. Building Anthropic messages...');
    const anthropicBuilt = await buildMessages({
      conversationId: conv.id,
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      roundNumber: 1
    });

    if (!anthropicBuilt.system) {
      throw new Error('Anthropic builder should return system property');
    }
    if (!Array.isArray(anthropicBuilt.messages)) {
      throw new Error('Anthropic messages should be array');
    }
    console.log('  ✓ Anthropic messages structured correctly with history\n');

    console.log('8. Testing file count display...');
    for (let i = 0; i < 25; i++) {
      await createFile(testProject.id, `file${i}.txt`, `content ${i}`, 'text/plain');
    }

    const manyFilesPrompt = buildSystemPrompt('openai', 'gpt-4o', testProject.id, 1);
    if (!manyFilesPrompt.includes('... and')) {
      throw new Error('Should truncate file list for many files');
    }
    console.log('  ✓ File list truncates for many files\n');

    console.log('✅ All system prompt tests passed!');
  } catch (err) {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
  } finally {
    if (testProject) {
      deleteProject(testProject.id);

      const path = require('path');
      const fs = require('fs').promises;
      const projectDir = path.join(__dirname, '../projects', testProject.id);
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }
}

runTests();
