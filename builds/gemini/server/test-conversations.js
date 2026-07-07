const { createProject, deleteProject } = require('./db/projects');
const {
  createConversation,
  getConversation,
  listConversations,
  saveMessage,
  listMessages
} = require('./conversations/writer');
const { readMessage, getConversationWithMessages } = require('./conversations/reader');
const fs = require('fs').promises;
const path = require('path');

async function runTests() {
  console.log('=== Testing Conversations ===\n');

  let testProject;

  try {
    // Create test project
    console.log('1. Creating test project...');
    testProject = createProject('Conversation Test', 'Testing conversations');
    console.log(`  \u2713 Created project ${testProject.id}\n`);

    // Create conversation
    console.log('2. Creating conversation...');
    const conv = createConversation(testProject.id, 'Test Conversation');
    console.log(`  \u2713 Created conversation ${conv.id}\n`);

    // Save user message
    console.log('3. Saving user message...');
    const userMsg = await saveMessage(
      conv.id,
      1,
      'user',
      'Hello, please analyze the data.',
      {}
    );
    console.log(`  \u2713 Saved user message ${userMsg.id}`);

    // Verify file exists
    const projectPath = path.join(__dirname, '../projects', testProject.id, 'files');
    const msgPath = path.join(projectPath, userMsg.file_path);
    const exists = await fs.access(msgPath).then(() => true).catch(() => false);
    if (!exists) throw new Error('Message file not written');
    console.log(`  \u2713 File created at ${userMsg.file_path}\n`);

    // Save agent message
    console.log('4. Saving agent message...');
    const agentMsg = await saveMessage(
      conv.id,
      1,
      'agent:gpt-4o',
      'I will analyze the data for you.',
      {
        model: 'gpt-4o',
        provider: 'openai',
        usage: {
          input_tokens: 150,
          output_tokens: 50
        }
      }
    );
    console.log(`  \u2713 Saved agent message ${agentMsg.id}\n`);

    // Read message content
    console.log('5. Reading message content...');
    const fullMsg = await readMessage(userMsg.id);
    if (fullMsg.content !== 'Hello, please analyze the data.') {
      throw new Error('Message content mismatch');
    }
    console.log('  \u2713 Can read message content');
    console.log('  \u2713 Frontmatter parsed correctly\n');

    // List messages
    console.log('6. Listing messages...');
    const messages = listMessages(conv.id);
    if (messages.length !== 2) {
      throw new Error(`Expected 2 messages, got ${messages.length}`);
    }
    console.log(`  \u2713 Listed ${messages.length} messages\n`);

    // Get full conversation
    console.log('7. Getting full conversation...');
    const fullConv = await getConversationWithMessages(conv.id);
    if (fullConv.messages.length !== 2) {
      throw new Error('Full conversation missing messages');
    }
    if (!fullConv.messages[0].content) {
      throw new Error('Messages missing content');
    }
    console.log('  \u2713 Full conversation loaded with content\n');

    // Test multiple rounds
    console.log('8. Testing multiple rounds...');
    await saveMessage(conv.id, 2, 'user', 'What about trends?', {});
    await saveMessage(
      conv.id,
      2,
      'agent:gpt-4o',
      'The trend is upward.',
      { model: 'gpt-4o', provider: 'openai' }
    );

    const updated = getConversation(conv.id);
    if (updated.round_count !== 2) {
      throw new Error('Round count not updated');
    }
    console.log(`  \u2713 Multiple rounds work, count: ${updated.round_count}\n`);

    // List conversations
    console.log('9. Listing conversations...');
    const convs = listConversations(testProject.id);
    if (convs.length !== 1) {
      throw new Error('Conversation not listed');
    }
    console.log(`  \u2713 Listed ${convs.length} conversation(s)\n`);

    console.log('✅ All conversation tests passed!');

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
