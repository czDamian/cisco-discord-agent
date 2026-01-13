import { getOrCreateUser, getUserStats, updateUserBalance } from '../utils/database.js';
import { getAmadeusBalance, signTransaction } from '../utils/amadeus.js';
import { decryptPrivateKey } from '../utils/encryption.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

interface ToolInput {
  discord_id: string;
  [key: string]: any;
}

export interface CustomTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: ToolInput, mcpClient?: any) => Promise<any>;
}

/**
 * Custom tools for the ModelContextProtocol
 */
export const customTools: CustomTool[] = [
  {
    name: 'get_user_info',
    description: 'Get current Discord user information including wallet address, balance, and usage statistics. Use this when user asks about "my account", "my info", or "who am I".',
    inputSchema: {
      type: 'object',
      properties: {
        discord_id: {
          type: 'string',
          description: 'Discord user ID of the requesting user'
        }
      },
      required: ['discord_id']
    },
    handler: async (args: ToolInput) => {
      console.log(`[${new Date().toISOString()}] 🔧 Custom Tool: get_user_info for ${args.discord_id}`);

      const user = await getOrCreateUser(args.discord_id, 'Unknown');
      const balance = await getAmadeusBalance(user.amadeusPublicKey as string);

      console.log(`[${new Date().toISOString()}] ✅ User info retrieved: ${user.discordUsername}`);

      return {
        discord_id: user.discordId,
        discord_username: user.discordUsername,
        wallet_address: user.amadeusPublicKey,
        balance_ama: balance,
        total_requests: user.totalRequests,
        total_spent_ama: user.totalSpent,
        member_since: user.createdAt
      };
    }
  },

  {
    name: 'get_user_balance',
    description: 'Get user AMA balance from blockchain in real-time. Use this when user asks about "my balance", "how much AMA do I have", or "check my wallet".',
    inputSchema: {
      type: 'object',
      properties: {
        discord_id: {
          type: 'string',
          description: 'Discord user ID of the requesting user'
        }
      },
      required: ['discord_id']
    },
    handler: async (args: ToolInput) => {
      console.log(`[${new Date().toISOString()}] 🔧 Custom Tool: get_user_balance for ${args.discord_id}`);

      const user = await getOrCreateUser(args.discord_id, 'Unknown');
      const balance = await getAmadeusBalance(user.amadeusPublicKey as string);
      await updateUserBalance(args.discord_id);

      console.log(`[${new Date().toISOString()}] ✅ Balance retrieved: ${balance} AMA`);

      return {
        wallet_address: user.amadeusPublicKey,
        balance_ama: balance,
        last_updated: new Date().toISOString()
      };
    }
  },

  {
    name: 'get_user_stats',
    description: 'Get user usage statistics including total requests, total spent, and account history. Use when user asks about "my stats", "my usage", "how much have I spent".',
    inputSchema: {
      type: 'object',
      properties: {
        discord_id: {
          type: 'string',
          description: 'Discord user ID of the requesting user'
        }
      },
      required: ['discord_id']
    },
    handler: async (args: ToolInput) => {
      console.log(`[${new Date().toISOString()}] 🔧 Custom Tool: get_user_stats for ${args.discord_id}`);

      const stats = await getUserStats(args.discord_id);
      const balance = await getAmadeusBalance(stats.walletAddress);

      console.log(`[${new Date().toISOString()}] ✅ Stats retrieved: ${stats.totalRequests} requests`);

      return {
        ...stats,
        current_balance_ama: balance
      };
    }
  },

  {
    name: 'transfer_ama',
    description: 'Send AMA tokens from the user wallet to another address. THIS TOOL AUTOMATICALLY SIGNS AND SUBMITS the transaction.',
    inputSchema: {
      type: 'object',
      properties: {
        discord_id: {
          type: 'string',
          description: 'Discord user ID of the sender'
        },
        recipient: {
          type: 'string',
          description: 'Wallet address of the recipient'
        },
        amount: {
          type: 'string',
          description: 'Amount of AMA to send (e.g., "10")'
        }
      },
      required: ['discord_id', 'recipient', 'amount']
    },
    handler: async (args: ToolInput, mcpClient?: any) => {
      if (!mcpClient) {
        throw new Error('MCP Client not initialized for transfer_ama');
      }

      console.log(`[${new Date().toISOString()}] 🔧 Custom Tool: transfer_ama`);
      console.log(`   From User: ${args.discord_id}`);
      console.log(`   To: ${args.recipient}`);
      console.log(`   Amount: ${args.amount} AMA`);

      const user = await getOrCreateUser(args.discord_id, 'Unknown');
      const amountAtomic = (parseFloat(args.amount) * 1_000_000_000).toString();

      // 1. Create Transaction
      console.log('   🔨 Creating transaction...');
      const txData = await mcpClient.request({
        method: 'tools/call',
        params: {
          name: 'create_transaction',
          arguments: {
            signer: user.amadeusPublicKey,
            contract: 'Coin',
            function: 'transfer',
            args: [
              { b58: args.recipient },
              amountAtomic,
              'AMA'
            ]
          }
        }
      }, CallToolResultSchema);

      const firstContent = txData.content[0];
      if (firstContent.type !== 'text') {
        throw new Error('Expected text response from create_transaction');
      }
      const txResult = JSON.parse(firstContent.text);
      const { signing_payload, blob } = txResult;

      // 2. Sign Transaction
      console.log('   ✍️  Signing transaction...');
      const decryptedPrivateKey = decryptPrivateKey(user.amadeusPrivateKey);
      const signature = signTransaction(signing_payload, decryptedPrivateKey);

      // 3. Submit Transaction
      console.log('   📤 Submitting transaction...');
      const submitResult = await mcpClient.request({
        method: 'tools/call',
        params: {
          name: 'submit_transaction',
          arguments: {
            transaction: blob,
            signature,
            network: 'testnet'
          }
        }
      }, CallToolResultSchema);

      const submitContent = submitResult.content[0];
      const result = JSON.parse(submitContent.text);

      console.log(`   ✅ Transfer successful! TX: ${result.tx_hash}`);

      return {
        success: true,
        tx_hash: result.tx_hash,
        from: user.amadeusPublicKey,
        to: args.recipient,
        amount_ama: args.amount,
        status: 'confirmed'
      };
    }
  }
];
