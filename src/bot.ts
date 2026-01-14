import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListToolsResultSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { Client, GatewayIntentBits, ChannelType, Partials } from 'discord.js';
import Anthropic from '@anthropic-ai/sdk';

// Payment system imports
import { startServer } from './server.js';
import { connectToDatabase, getOrCreateUser, recordTransaction, updateUserBalance, getUserStats } from './utils/database.js';
import { chargeUser, hasSufficientBalance } from './utils/payment.js';
import { getAmadeusBalance } from './utils/amadeus.js';
import { testEncryption } from './utils/encryption.js';
import { environment } from './config/constants.js';
// Custom database tools
import { customTools } from './mcp/tools.js';

// Free command handlers
import { handleBalance, handleDeposit, handleStats, handleFaucet } from './handlers/freeCommands.js';

const discordBotToken = environment.DISCORD_BOT_TOKEN;
const apiKey = environment.ANTHROPIC_API_KEY;

if (!discordBotToken || !apiKey) {
  throw new Error('Missing environment variables');
}

const discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel] // Required for DMs
});

const anthropic = new Anthropic({
  apiKey
});

// Connect to MCP server
let mcpClient: any;
let mcpTools: any[] = [];

async function initializeMCP() {
  const transport = new StreamableHTTPClientTransport(
    new URL('https://mcp.ama.one')
  );

  mcpClient = new MCPClient({
    name: 'discord-ama-bot',
    version: '1.0.0'
  }, {
    capabilities: {}
  });

  await mcpClient.connect(transport);

  // Get available tools using modern request API
  const toolsList = await mcpClient.request(
    { method: 'tools/list', params: {} },
    ListToolsResultSchema
  );
  mcpTools = toolsList.tools;

  console.log('MCP connected. Available tools:', mcpTools.map((t: any) => t.name));
  console.log('Custom tools loaded:', customTools.map(t => t.name));
  console.log(`Total tools available: ${mcpTools.length + customTools.length}`);
}

// Export mcpClient for payment utilities
export { mcpClient };

discord.on('messageCreate', async (message) => {
  if (!discord.user) {
    console.log('❌ message not from a user');
    return;
  }
  // Debug logging
  console.log(`\n[${new Date().toISOString()}] 🔔 Message received:`);
  console.log(`   Author: ${message.author.tag} (bot: ${message.author.bot})`);
  console.log(`   Content: "${message.content}"`);

  if (message.author.bot) {
    console.log(`   ❌ Ignoring: Bot message`);
    return;
  }

  // Accept messages if:
  // 1. It's a DM (ChannelType.DM)
  // 2. OR it mentions the bot in a server
  const isDM = message.channel.type === ChannelType.DM;
  const hasMention = message.mentions.has(discord.user);

  if (!isDM && !hasMention) {
    console.log(`   ❌ Ignoring: Not a DM and no mention`);
    return;
  }

  console.log(`   ✅ Processing: ${isDM ? 'DM' : 'Mention in server'}`);

  const query = message.content.replace(`<@${discord.user.id}>`, '').trim();
  if (!query) {
    console.log(`   ❌ Ignoring: Empty query after removing mention`);
    return;
  }

  await message.channel.sendTyping();

  try {
    // Get or create user
    const user = await getOrCreateUser(message.author.id, message.author.tag);
    const reply = (msg: string) => message.reply(msg);

    // FREE COMMANDS (no payment required)
    if (query === '/balance' || query.toLowerCase() === 'balance') {
      return handleBalance(user as any, reply);
    }

    if (query === '/deposit' || query.toLowerCase() === 'deposit') {
      return handleDeposit(user as any, reply);
    }

    if (query === '/stats' || query.toLowerCase() === 'stats') {
      return handleStats(user as any, reply);
    }

    // NEW: Faucet command - claim 100 testnet AMA
    if (query.toLowerCase().includes('faucet') || query.toLowerCase().includes('claim')) {
      return handleFaucet(user as any, reply, mcpClient);
    }

    // For all other queries, AI handles payment via batch tools
    console.log(`[${new Date().toISOString()}] 💳 Processing query (AI handles payment)...`);

    try {
      const response = await handleQuery(query, user as any);
      console.log(`[${new Date().toISOString()}] ✅ Sending response: "${response.substring(0, 100)}..."`);
      await message.reply(response);

    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] ❌ Error:`, error.message);
      await message.reply('Sorry, something went wrong! Please try again.');
    }

  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ❌ Error handling message:`, error.message);
    console.error('Full error:', error);
    await message.reply('Sorry, something went wrong! Please try again.');
  }
});

// Handle slash command interactions
discord.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  console.log(`\n[${new Date().toISOString()}] ⚡ Slash command received: /${interaction.commandName} from ${interaction.user.tag}`);

  try {
    // CRITICAL: Defer reply immediately to prevent 3-second timeout
    await interaction.deferReply({ ephemeral: true });

    // Get or create user
    const user = await getOrCreateUser(interaction.user.id, interaction.user.tag);

    if (interaction.commandName === 'balance') {
      const balance = await getAmadeusBalance(user.amadeusPublicKey as string);
      await updateUserBalance(user.discordId as string);

      await interaction.editReply({
        content:
          `**Your Wallet**\n` +
          `Balance: **${balance} AMA**\n` +
          `Address: \`${user.amadeusPublicKey}\`\n` +
          `Cost per request: 10 AMA`
      });
    }
    else if (interaction.commandName === 'deposit') {
      await interaction.editReply({
        content:
          `**Deposit AMA to Your Wallet**\n\n` +
          `Send AMA from any wallet or exchange to:\n` +
          `\`${user.amadeusPublicKey}\`\n\n` +
          `After depositing, use \`/balance\` to check your balance.`
      });
    }
    else if (interaction.commandName === 'stats') {
      const stats = await getUserStats(user.discordId as string);
      const balance = await getAmadeusBalance(stats.walletAddress);

      await interaction.editReply({
        content:
          `**Your Statistics**\n` +
          `Current Balance: ${balance} AMA\n` +
          `Total Requests: ${stats.totalRequests}\n` +
          `Total Spent: ${stats.totalSpent} AMA\n` +
          `Member Since: ${stats.memberSince.toLocaleDateString()}`
      });
    }
    else if (interaction.commandName === 'faucet') {
      // Use handler for faucet
      const reply = async (msg: string) => {
        await interaction.editReply({ content: msg });
      };
      await handleFaucet(user as any, reply, mcpClient);
    }
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ❌ Error handling slash command:`, error.message);
    await interaction.editReply({
      content: 'Sorry, something went wrong! Please try again.'
    });
  }
});

async function handleQuery(userQuery: string, user?: any): Promise<string> {
  console.log(`[${new Date().toISOString()}] 🤔 Processing query...`);

  // First, ask Claude what it wants to do
  let conversationMessages: any[] = [{
    role: 'user',
    content: userQuery
  }];

  let loopCount = 0;
  const maxLoops = 5; // Prevent infinite loops

  while (loopCount < maxLoops) {
    loopCount++;
    console.log(`[${new Date().toISOString()}] 🔄 Agentic loop iteration ${loopCount}/${maxLoops}`);

    // Combine MCP tools and custom tools
    const simplifiedMcpTools = mcpTools.map((tool: any) => ({
      name: tool.name,
      description: (tool.description || '').substring(0, 200), // Truncate long descriptions
      input_schema: tool.inputSchema
    }));

    const simplifiedCustomTools = customTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));

    const allTools = [...simplifiedMcpTools, ...simplifiedCustomTools];

    console.log(`[${new Date().toISOString()}] 🧠 Calling Claude with ${conversationMessages.length} messages and ${allTools.length} tools (${mcpTools.length} MCP + ${customTools.length} custom)...`);

    // Helper function to call Claude with retry logic for 529 errors
    const callClaude = async () => {
      const maxRetries = 3;
      let initialDelay = 4000; // Start with 4 seconds

      for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
          return await anthropic.messages.create({
            model: environment.ANTHROPIC_MODEL,
            max_tokens: environment.MAX_TOKENS,
            system: `You are an AI Agent with access to Amadeus blockchain tools AND user database tools.

CURRENT USER CONTEXT:
- Discord ID: ${user?.discordId}
- Wallet Address: ${user?.amadeusPublicKey}
- Current Balance: ${user?.balance} AMA

Available tools:
${allTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

BLOCKCHAIN TOOLS (via MCP):
- create_transaction, submit_transaction, etc.

⚠️ CRITICAL PAYMENT TOOLS:
- validate_balance_for_transfer: Check if user has funds for fee + transfer  
- transfer_with_fee: Execute fee + transfer in ONE BATCH (2x faster). ONLY after validation confirms sufficient.

WORKFLOW FOR TRANSFERS:
1. Call validate_balance_for_transfer(discord_id, amount)
2. If sufficient: Call transfer_with_fee(discord_id, recipient, amount) - handles EVERYTHING
3. If insufficient: Tell user they need more funds

Do NOT use "create_transaction" or "transfer_ama" for transfers. Use transfer_with_fee for batch execution.

When user asks "my balance" or "my wallet", use get_user_balance.
When user asks "my stats" or "my info", use get_user_stats.
Always pass the user's discord_id when using database tools.

📝 RESPONSE FORMATTING (CRITICAL):
SUCCESS transfers: "✅ Sent X AMA to [address]. Total cost: Y AMA."
- NO "batch", NO "fee breakdown", NO "parallel processing"
FAILED transfers: "❌ Insufficient balance. Need X AMA, have Y AMA. Use /deposit to add funds."
- NO fee breakdown in error messages
Keep ALL responses under 100 words and user-friendly.`,
            messages: conversationMessages,
            tools: allTools
          });
        } catch (error: any) {
          if (error.status === 529 || (error.error && error.error.type === 'overloaded_error')) {
            if (attempt <= maxRetries) {
              const delay = initialDelay * Math.pow(2, attempt - 1);
              console.log(`[${new Date().toISOString()}] ⏳ Claude overloaded (529). Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              throw error; // Max retries reached
            }
          } else {
            throw error; // Other error
          }
        }
      }
      throw new Error('Claude retry loop failed unexpected');
    };

    const response = await callClaude();



    console.log(`[${new Date().toISOString()}] 📝 Claude response received (${response.content.length} content blocks)`);

    // Check if Claude wants to use tools (can be multiple)
    const toolUses: any[] = response.content.filter((block: any) => block.type === 'tool_use');

    if (toolUses.length === 0) {
      // No tool use, return the text response
      const text = response.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('\n');
      console.log(`[${new Date().toISOString()}] ✅ Final response ready (no tool use)`);
      return text;
    }

    console.log(`[${new Date().toISOString()}] 🔧 Tools requested: ${toolUses.length}`);

    // Add assistant response ONCE (with all tool uses)
    conversationMessages.push({
      role: 'assistant',
      content: response.content
    });

    // Process EACH tool use and add its result
    for (const toolUse of toolUses) {
      console.log(`[${new Date().toISOString()}] 🔧 Processing tool: ${toolUse.name}`);
      console.log(`[${new Date().toISOString()}] 📋 Tool arguments:`, JSON.stringify(toolUse.input, null, 2));

      try {
        let toolContent: string;

        // Check if it's a custom tool
        const customTool = customTools.find(t => t.name === toolUse.name);

        if (customTool) {
          // Execute custom tool
          console.log(`[${new Date().toISOString()}] 🗄️  Executing CUSTOM tool: ${customTool.name}`);

          // Inject discord_id if not provided
          const toolInput = { ...toolUse.input };
          if (!toolInput.discord_id && user?.discordId) {
            toolInput.discord_id = user.discordId;
            console.log(`[${new Date().toISOString()}] 💉 Injected discord_id: ${user.discordId}`);
          }

          const result = await customTool.handler(toolInput, mcpClient);
          toolContent = JSON.stringify(result, null, 2);
          console.log(`[${new Date().toISOString()}] ✅ Custom tool result: ${toolContent.substring(0, 200)}...`);

        } else {
          // Execute MCP tool
          console.log(`[${new Date().toISOString()}] 🌐 Executing MCP tool: ${toolUse.name}`);

          const toolResult = await mcpClient.request(
            {
              method: 'tools/call',
              params: {
                name: toolUse.name,
                arguments: toolUse.input
              }
            },
            CallToolResultSchema
          );

          console.log(`[${new Date().toISOString()}] ✅ Tool result received:`, toolResult.content?.length, 'content items');

          // Extract only the text content from the tool result to avoid token bloat
          toolContent = toolResult.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text)
            .join('\n');

          console.log(`[${new Date().toISOString()}] 📄 Extracted tool content (${toolContent.length} chars): ${toolContent.substring(0, 200)}...`);
        }

        // Add THIS tool's result to conversation
        conversationMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: toolContent
          }]
        });

        console.log(`[${new Date().toISOString()}] ✅ Added tool_result for ${toolUse.name}`);

      } catch (error: any) {
        console.error(`[${new Date().toISOString()}] ❌ Tool call error for ${toolUse.name}:`, error.message);

        // Add error result for THIS tool
        conversationMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Error calling tool: ${error.message}`,
            is_error: true
          }]
        });
      }
    }
  }

  console.log(`[${new Date().toISOString()}] ⚠️ Max loop iterations reached`);
  return "I've reached my processing limit. Please try asking your question differently.";
}

// Start bot
async function start() {
  console.log('\n🚀 Starting AMA Discord Bot...\n');

  // Test encryption
  console.log('🔐 Testing encryption...');
  if (!testEncryption()) {
    throw new Error('Encryption test failed! Check ENCRYPTION_KEY in .env');
  }
  await connectToDatabase();
  await initializeMCP();
  startServer();

  // Login to Discord
  await discord.login(discordBotToken);
  console.log('✅ Discord bot ready!');
  console.log('\n📋 Available commands:');
  console.log('   /balance - Check your wallet balance');
  console.log('   /deposit - Get your wallet address');
  console.log('   /stats   - View your usage statistics');
  console.log('\n💡 Mention the bot in your channel or send a DM to use (costs 10 AMA per request)\n');
}

start().catch(console.error);