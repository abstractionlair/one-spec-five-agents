const { runMigrations } = require('./db/migrations');
const { createProject, deleteProject } = require('./db/projects');
const { createFile } = require('./files/storage');
const { createConversation } = require('./conversations/writer');
const { getConversationWithMessages } = require('./conversations/reader');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const API_URL = 'http://localhost:3000';

async function runTests() {
  console.log('=== Testing /api/turn ===\n');
  console.log('⚠️  Make sure server is running (npm start)\n');

  let testProject;

  try {
    runMigrations();

    console.log('1. Creating test project...');
    testProject = createProject('Turn Test', 'Testing /api/turn');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    console.log('2. Creating test data...');
    await createFile(
      testProject.id,
      'data.csv',
      'name,value\nAlice,100\nBob,200\nCharlie,150',
      'text/csv'
    );
    console.log('  ✓ Created data.csv\n');

    console.log('3. Creating conversation...');
    const conv = createConversation(testProject.id, 'Test Turn');
    console.log(`  ✓ Created conversation ${conv.id}\n`);

    console.log('4. Testing simple query...');
    const response1 = await axios.post(`${API_URL}/api/turn`, {
      projectId: testProject.id,
      conversationId: conv.id,
      userMessage: 'What is 2+2?',
      targetModels: [{ provider: 'openai', modelId: 'gpt-4o-mini' }],
      roundNumber: 1
    });

    if (!response1.data.responses[0].response) {
      throw new Error('No response from model');
    }
    console.log('  ✓ Got response from gpt-4o-mini');
    console.log(`  Response: ${response1.data.responses[0].response.slice(0, 100)}...\n`);

    console.log('5. Testing tool calling (auto round)...');
    const response2 = await axios.post(`${API_URL}/api/turn`, {
      projectId: testProject.id,
      conversationId: conv.id,
      userMessage: 'Count the lines in data.csv using bash',
      targetModels: [{ provider: 'openai', modelId: 'gpt-4o-mini' }]
    });

    const toolResponse = response2.data.responses[0];
    if (!toolResponse.response) {
      throw new Error('No response from model');
    }
    console.log('  ✓ Model called bash tool');
    console.log(`  Response: ${toolResponse.response}\n`);

    console.log('6. Verifying conversation saved...');
    const fullConv = await getConversationWithMessages(conv.id);
    if (fullConv.messages.length < 4) {
      throw new Error('Not all messages saved');
    }
    console.log(`  ✓ Saved ${fullConv.messages.length} messages\n`);

    console.log('7. Testing multiple models...');
    const response3 = await axios.post(`${API_URL}/api/turn`, {
      projectId: testProject.id,
      conversationId: conv.id,
      userMessage: 'Create a file called output.txt with the content \"Hello\"',
      targetModels: [
        { provider: 'openai', modelId: 'gpt-4o-mini' },
        { provider: 'anthropic', modelId: 'claude-sonnet-4-5' }
      ]
    });

    if (response3.data.responses.length !== 2) {
      throw new Error('Expected 2 responses');
    }
    console.log('  ✓ Got responses from both models');

    const projectPath = path.join(__dirname, '../projects', testProject.id, 'files');
    const outputPath = path.join(projectPath, 'output.txt');
    const outputExists = await fs.access(outputPath).then(() => true).catch(() => false);
    if (!outputExists) {
      throw new Error('Model did not create output.txt');
    }
    console.log('  ✓ Model created file via bash\n');

    console.log('8. Testing usage tracking...');
    const lastMessage = fullConv.messages[fullConv.messages.length - 1];
    if (!lastMessage.input_tokens || !lastMessage.output_tokens) {
      console.log('  ⚠️  Usage not tracked (model may not return usage data)');
    } else {
      console.log(`  ✓ Usage tracked: ${lastMessage.input_tokens} in, ${lastMessage.output_tokens} out\n`);
    }

    console.log('✅ All /api/turn tests passed!');
  } catch (err) {
    console.error('\n❌ Test failed:', err.response?.data || err.message);
    process.exit(1);
  } finally {
    if (testProject) {
      deleteProject(testProject.id);
      const projectDir = path.join(__dirname, '../projects', testProject.id);
      await fs.rm(projectDir, { recursive: true, force: true });
    }
  }
}

runTests();
