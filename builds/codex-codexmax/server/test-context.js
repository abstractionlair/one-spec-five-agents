const { runMigrations } = require('./db/migrations');
const { createProject, deleteProject } = require('./db/projects');
const { createConversation, saveMessage } = require('./conversations/writer');
const {
  estimateConversationTokens,
  needsSummarization,
  getContextMessages
} = require('./conversations/context');
const { summarizeRounds, getSummary } = require('./conversations/summarizer');
const fs = require('fs').promises;
const path = require('path');

async function runTests() {
  console.log('=== Testing Context Management ===\n');

  let testProject;

  try {
    runMigrations();
    console.log('✓ Migrations applied\n');

    console.log('1. Creating test project...');
    testProject = createProject('Context Test', 'Testing context management');
    console.log(`  ✓ Created project ${testProject.id}\n`);

    console.log('2. Creating conversation with messages...');
    const conv = createConversation(testProject.id, 'Context Test Conv');

    for (let round = 1; round <= 5; round++) {
      await saveMessage(conv.id, round, 'user', `User message in round ${round}. `.repeat(20), {});
      await saveMessage(
        conv.id,
        round,
        'agent:gpt-4o',
        `Assistant response in round ${round}. `.repeat(50),
        { model: 'gpt-4o', provider: 'openai' }
      );
    }
    console.log('  ✓ Created 5 rounds of messages\n');

    console.log('3. Testing token estimation...');
    const tokens = await estimateConversationTokens(conv.id);
    if (tokens === 0) {
      throw new Error('Token estimation returned 0');
    }
    console.log(`  ✓ Estimated ${tokens} tokens\n`);

    console.log('4. Testing context message retrieval...');
    const context = await getContextMessages(conv.id, 1000);
    if (!context.truncated) {
      console.log('  ⚠️  Expected truncation with low token limit');
    } else {
      console.log(`  ✓ Truncated to ${context.messages.length} messages (dropped ${context.droppedMessages})\n`);
    }

    if (process.env.OPENAI_API_KEY) {
      console.log('5. Testing summarization...');
      const summary = await summarizeRounds(conv.id, 3, { provider: 'openai', modelId: 'gpt-4o-mini' });
      if (!summary || summary.length === 0) {
        throw new Error('Summarization returned empty result');
      }
      console.log(`  ✓ Created summary (${summary.length} chars)\n`);

      console.log('6. Testing summary retrieval...');
      const retrievedSummary = getSummary(conv.id);
      if (!retrievedSummary) {
        throw new Error('Could not retrieve saved summary');
      }
      if (retrievedSummary.upToRound !== 3) {
        throw new Error('Summary metadata incorrect');
      }
      console.log('  ✓ Retrieved summary with metadata\n');
    } else {
      console.log('5-6. Skipping summarization tests (no OPENAI_API_KEY)\n');
    }

    console.log('✅ All context management tests passed!');
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
