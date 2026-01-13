import { getOrCreateUser, getUserStats, updateUserBalance } from '../utils/database.js';
import { getAmadeusBalance, signTransaction } from '../utils/amadeus.js';
import { decryptPrivateKey } from '../utils/encryption.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { toAtomicAma } from '@amadeus-protocol/sdk';
import { environment } from '../config/constants.js';

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
    name: 'validate_balance_for_transfer',
    description: 'Check if user has sufficient balance for BOTH service fee (from env) AND a transfer amount. MUST call this BEFORE attempting any transfer_ama to prevent wasting the user\'s service fee on failed transfers.',
    inputSchema: {
      type: 'object',
      properties: {
        discord_id: {
          type: 'string',
          description: 'Discord user ID of the sender'
        },
        transfer_amount: {
          type: 'string',
          description: 'Amount user wants to transfer in AMA (e.g., "100")'
        }
      },
      required: ['discord_id', 'transfer_amount']
    },
    handler: async (args: ToolInput) => {
      console.log(`[${new Date().toISOString()}] 🔧 Custom Tool: validate_balance_for_transfer`);
      console.log(`   Discord ID: ${args.discord_id}`);
      console.log(`   Transfer Amount: ${args.transfer_amount} AMA`);

      // Import environment at top of file if not already imported
      const { environment } = await import('../config/constants.js');
      const serviceFee = Number(environment.PAYMENT_AMOUNT);

      const user = await getOrCreateUser(args.discord_id, 'Unknown');
      const balance = await getAmadeusBalance(user.amadeusPublicKey as string);
      const balanceNum = parseFloat(balance);

      const transferAmount = parseFloat(args.transfer_amount);
      const totalRequired = serviceFee + transferAmount;
      const sufficient = balanceNum >= totalRequired;
      const shortfall = sufficient ? 0 : totalRequired - balanceNum;

      console.log(`   Current Balance: ${balanceNum} AMA`);
      console.log(`   Total Required: ${totalRequired} AMA (${serviceFee} fee + ${transferAmount} transfer)`);
      console.log(`   Sufficient: ${sufficient ? 'YES' : 'NO'}`);
      if (!sufficient) {
        console.log(`   Shortfall: ${shortfall} AMA`);
      }

      return {
        sufficient,
        current_balance: balanceNum,
        required_total: totalRequired,
        breakdown: {
          service_fee: serviceFee,
          transfer_amount: transferAmount
        },
        shortfall: shortfall > 0 ? shortfall : undefined,
        message: sufficient
          ? `User has sufficient balance (${balanceNum} AMA) for this transfer.`
          : `Insufficient balance. User has ${balanceNum} AMA but needs ${totalRequired} AMA (${serviceFee} service fee + ${transferAmount} transfer). Short by ${shortfall.toFixed(4)} AMA.`
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
  },

  {
    name: 'transfer_with_fee',
    description: 'Execute BOTH service fee payment AND user transfer in a SINGLE BATCH operation (parallel execution). This is 2x faster than sequential transactions. ONLY call after validate_balance_for_transfer confirms sufficient funds.',
    inputSchema: {
      type: 'object',
      properties: {
        discord_id: {
          type: 'string',
          description: 'Discord user ID of the sender'
        },
        recipient: {
          type: 'string',
          description: 'Wallet address of the transfer recipient'
        },
        amount: {
          type: 'string',
          description: 'Amount to transfer in AMA (e.g., "100")'
        }
      },
      required: ['discord_id', 'recipient', 'amount']
    },
    handler: async (args: ToolInput, mcpClient?: any) => {
      if (!mcpClient) {
        throw new Error('MCP Client not initialized for transfer_with_fee');
      }

      console.log(`[${new Date().toISOString()}] 🔧 Custom Tool: transfer_with_fee (BATCH)`);
      console.log(`   User: ${args.discord_id}`);
      console.log(`   Recipient: ${args.recipient}`);
      console.log(`   Transfer Amount: ${args.amount} AMA`);

      const user = await getOrCreateUser(args.discord_id, 'Unknown');
      const serviceFee = Number(environment.PAYMENT_AMOUNT);
      const transferAmount = parseFloat(args.amount);

      const feeAtomic = toAtomicAma(serviceFee);
      const transferAtomic = toAtomicAma(transferAmount);
      const systemWallet = environment.SYSTEM_WALLET_ADDRESS;

      try {
        // STEP 1: Create BOTH transactions in parallel
        console.log(`   📝 Creating both transactions in parallel...`);

        const [feeTxData, transferTxData] = await Promise.all([
          // Transaction 1: Service fee to system wallet
          mcpClient.request({
            method: 'tools/call',
            params: {
              name: 'create_transaction',
              arguments: {
                signer: user.amadeusPublicKey,
                contract: 'Coin',
                function: 'transfer',
                args: [
                  { b58: systemWallet },
                  feeAtomic,
                  'AMA'
                ]
              }
            }
          }, CallToolResultSchema),

          // Transaction 2: User transfer to recipient
          mcpClient.request({
            method: 'tools/call',
            params: {
              name: 'create_transaction',
              arguments: {
                signer: user.amadeusPublicKey,
                contract: 'Coin',
                function: 'transfer',
                args: [
                  { b58: args.recipient },
                  transferAtomic,
                  'AMA'
                ]
              }
            }
          }, CallToolResultSchema)
        ]);

        const feeTx = JSON.parse(feeTxData.content[0].text);
        const transferTx = JSON.parse(transferTxData.content[0].text);

        console.log(`   ✅ Both transactions created`);

        // STEP 2: Sign BOTH transactions
        console.log(`   ✍️  Signing both transactions...`);

        const decryptedKey = decryptPrivateKey(user.amadeusPrivateKey);

        const feeSignature = signTransaction(feeTx.signing_payload, decryptedKey);
        const transferSignature = signTransaction(transferTx.signing_payload, decryptedKey);

        console.log(`   ✅ Both transactions signed`);

        // STEP 3: Submit BOTH transactions in parallel
        console.log(`   📤 Submitting both transactions in parallel...`);

        const [feeResult, transferResult] = await Promise.all([
          mcpClient.request({
            method: 'tools/call',
            params: {
              name: 'submit_transaction',
              arguments: {
                transaction: feeTx.blob,
                signature: feeSignature,
                network: 'testnet'
              }
            }
          }, CallToolResultSchema),

          mcpClient.request({
            method: 'tools/call',
            params: {
              name: 'submit_transaction',
              arguments: {
                transaction: transferTx.blob,
                signature: transferSignature,
                network: 'testnet'
              }
            }
          }, CallToolResultSchema)
        ]);

        const feeHash = JSON.parse(feeResult.content[0].text).tx_hash;
        const transferHash = JSON.parse(transferResult.content[0].text).tx_hash;

        console.log(`   ✅ Fee TX: ${feeHash}`);
        console.log(`   ✅ Transfer TX: ${transferHash}`);
        console.log(`   🎉 BATCH COMPLETE - Both transactions submitted in parallel`);

        return {
          success: true,
          fee_transaction: {
            amount: serviceFee,
            tx_hash: feeHash,
            recipient: systemWallet
          },
          transfer_transaction: {
            amount: transferAmount,
            tx_hash: transferHash,
            recipient: args.recipient
          },
          total_spent: serviceFee + transferAmount,
          batch_execution: true,
          message: `Batch successful: ${serviceFee} AMA fee (${feeHash.substring(0, 8)}...) + ${transferAmount} AMA transfer (${transferHash.substring(0, 8)}...) executed in parallel.`
        };

      } catch (error: any) {
        console.error(`   ❌ Batch transaction failed:`, error.message);
        throw new Error(`Batch transaction failed: ${error.message}`);
      }
    }
  }
];
