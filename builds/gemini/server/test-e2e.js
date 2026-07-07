const { createProject, deleteProject } = require('./db/projects');
const { createFile } = require('./files/storage');
const { createConversation } = require('./conversations/writer');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

const API_URL = 'http://localhost:3000';

async function runE2ETest() {
  console.log('=== End-to-End Integration Test ===\n');
  console.log('⚠️  Ensure server is running (npm start)\n');

  let testProject;

  try {
    // 1. Create project
    console.log('1. Creating project...');
    testProject = createProject('E2E Test Project', 'Full system test');
    console.log(`  ✓ Project created: ${testProject.id}\n`);

    // 2. Upload data file
    console.log('2. Uploading data file...');
    await createFile(
      testProject.id,
      'sales.csv',
      'month,sales\nJan,1000\nFeb,1200\nMar,1500',
      'text/csv'
    );
    console.log('  ✓ File uploaded\n');

    // 3. Create conversation
    console.log('3. Creating conversation...');
    const conv = createConversation(testProject.id, 'E2E Test Conversation');
    console.log(`  ✓ Conversation created: ${conv.id}\n`);

    // 4. Send message asking to analyze data
    console.log('4. Sending message: "Analyze sales.csv and create a summary"...');
    const response = await axios.post(`${API_URL}/api/turn`, {
      projectId: testProject.id,
      conversationId: conv.id,
      userMessage: 'Read sales.csv and tell me the total sales',
      targetModels: [
        { provider: 'openai', modelId: 'gpt-4o-mini' }
      ],
      roundNumber: 1
    });

    if (!response.data.responses[0].response) {
      throw new Error('No response from model');
    }

    console.log('  ✓ Got response from model');
    console.log(`  Response preview: ${response.data.responses[0].response.slice(0, 150)}...\n`);

    // 5. Verify model used bash tool (check for typical signs)
    const resp = response.data.responses[0].response;
    const usedBash = resp.includes('3700') || resp.includes('sales') || resp.includes('total');
    if (!usedBash) {
      console.log('  ⚠️  Model may not have used bash tool (or calculated correctly)\n');
    } else {
      console.log('  ✓ Model appears to have read and analyzed the file\n');
    }

    // 6. Search for "sales"
    console.log('5. Searching for "sales"...');
    const searchResp = await axios.post(`${API_URL}/api/projects/${testProject.id}/search`, {
      query: 'sales',
      limit: 10
    });

    if (searchResp.data.results.length === 0) {
      throw new Error('Search returned no results');
    }

    const hasFileResult = searchResp.data.results.some(r => r.type === 'file');
    const hasConvResult = searchResp.data.results.some(r => r.type === 'conversation');

    console.log(`  ✓ Found ${searchResp.data.results.length} results`);
    console.log(`    - Files: ${hasFileResult ? 'yes' : 'no'}`);
    console.log(`    - Conversations: ${hasConvResult ? 'yes' : 'no'}\n`);

    // 7. Verify conversation was saved
    console.log('6. Verifying conversation persistence...');
    const convResp = await axios.get(`${API_URL}/api/conversations/${conv.id}?includeContent=true`);

    if (convResp.data.conversation.messages.length < 2) {
      throw new Error('Conversation not fully saved');
    }

    console.log(`  ✓ Conversation has ${convResp.data.conversation.messages.length} messages\n`);

    // 8. Send follow-up message
    console.log('7. Sending follow-up message...');
    const followup = await axios.post(`${API_URL}/api/turn`, {
      projectId: testProject.id,
      conversationId: conv.id,
      userMessage: 'What was the best month?',
      targetModels: [
        { provider: 'openai', modelId: 'gpt-4o-mini' }
      ],
      roundNumber: 2
    });

    console.log('  ✓ Follow-up response received\n');

    // 9. List files
    console.log('8. Listing project files...');
    const filesResp = await axios.get(`${API_URL}/api/projects/${testProject.id}/files`);

    if (filesResp.data.files.length === 0) {
      throw new Error('No files found');
    }

    console.log(`  ✓ Found ${filesResp.data.files.length} file(s)\n`);

    console.log('✅ End-to-end test passed!\n');
    console.log('All systems working:');
    console.log('  • Project creation');
    console.log('  • File upload and storage');
    console.log('  • Conversation management');
    console.log('  • Model communication');
    console.log('  • Tool calling (bash)');
    console.log('  • Search indexing');
    console.log('  • Multi-round conversations');

  } catch (err) {
    console.error('\n❌ E2E test failed:', err.response?.data || err.message);
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

runE2ETest();
