const { runMigrations } = require('./db/migrations');
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
    runMigrations();
    console.log('✓ Migrations applied\n');

    console.log('1. Creating test project...');
    testProject = createProject('Conversation Test', 'Testing conversations');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    console.log('2. Creating conversation...');
    const conv = createConversation(testProject.id, 'Test Conversation');
    console.log(`  ✓ Created conversation ${conv.id}\n`);

    console.log('3. Saving user message...');
    const userMsg = await saveMessage(conv.id, 1, 'user', 'Hello, please analyze the data.', {});
    console.log(`  ✓ Saved user message ${userMsg.id}`);

    const projectPath = path.join(__dirname, '../projects', testProject.id, 'files');
    const msgPath = path.join(projectPath, userMsg.file_path);
    const exists = await fs.access(msgPath).then(() => true).catch(() => false);
    if (!exists) throw new Error('Message file not written');
    console.log(`  ✓ File created at ${userMsg.file_path}\n`);

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
    console.log(`  ✓ Saved agent message ${agentMsg.id}\n`);

    console.log('5. Reading message content...');
    const fullMsg = await readMessage(userMsg.id);
    if (fullMsg.content !== 'Hello, please analyze the data.') {
      throw new Error('Message content mismatch');
    }
    console.log('  ✓ Can read message content');
    console.log('  ✓ Frontmatter parsed correctly\n');

    console.log('6. Listing messages...');
    const messages = listMessages(conv.id);
    if (messages.length !== 2) {
      throw new Error(`Expected 2 messages, got ${messages.length}`);
    }
    console.log(`  ✓ Listed ${messages.length} messages\n`);

    console.log('7. Getting full conversation...');
    const fullConv = await getConversationWithMessages(conv.id);
    if (fullConv.messages.length !== 2) {
      throw new Error('Full conversation missing messages');
    }
    if (!fullConv.messages[0].content) {
      throw new Error('Messages missing content');
    }
    console.log('  ✓ Full conversation loaded with content\n');

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
    console.log(`  ✓ Multiple rounds work, count: ${updated.round_count}\n`);

    console.log('9. Listing conversations...');
    const convs = listConversations(testProject.id);
    if (convs.length !== 1) {
      throw new Error('Conversation not listed');
    }
    console.log(`  ✓ Listed ${convs.length} conversation(s)\n`);

    console.log('✅ All conversation tests passed!');
  } catch (err) {
    console.error('\n❌ Test failed:', err);
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
