import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import { signTransaction, getAmadeusBalance } from './amadeus.js';
import { decryptPrivateKey } from './encryption.js';
import { toAtomicAma } from '@amadeus-protocol/sdk';
import { environment } from '../config/constants';

const SYSTEM_WALLET = environment.SYSTEM_WALLET_ADDRESS;
const PAYMENT_AMOUNT = Number(environment.PAYMENT_AMOUNT)
const PAYMENT_ATOMIC = toAtomicAma(PAYMENT_AMOUNT); // Fee amount in atomic units

interface UserDocument {
  discordId: string;
  discordUsername: string;
  amadeusPublicKey: string;
  amadeusPrivateKey: string;
  balance: number;
}

/**
 * Charge user by transferring from their wallet to system wallet
 * 
 * @param user - User document from MongoDB
 * @param mcpClient - MCP client instance
 * @returns Payment result with transaction hash
 */
export async function chargeUser(
  user: UserDocument,
  mcpClient: MCPClient
): Promise<{ success: boolean; txHash: string; amount: number }> {
  console.log(`[${new Date().toISOString()}] 💰 Charging ${PAYMENT_AMOUNT} AMA from ${user.discordUsername}`);

  try {
    // PRE-FLIGHT BALANCE CHECK
    console.log(`[${new Date().toISOString()}] ✈️ PRE-FLIGHT: Checking balance...`);
    const currentBalance = await getAmadeusBalance(user.amadeusPublicKey);
    const balanceNum = parseFloat(currentBalance);

    console.log(`[${new Date().toISOString()}] 💵 Current balance: ${balanceNum.toFixed(4)} AMA`);
    console.log(`[${new Date().toISOString()}] 💵 Required: ${PAYMENT_AMOUNT} AMA`);

    if (balanceNum < PAYMENT_AMOUNT) {
      console.log(`[${new Date().toISOString()}] ❌ PRE-FLIGHT FAILED: Insufficient balance`);
      throw new Error(
        `Insufficient balance: ${balanceNum.toFixed(4)} AMA (need ${PAYMENT_AMOUNT} AMA)`
      );
    }

    console.log(`[${new Date().toISOString()}] ✅ PRE-FLIGHT PASSED: Balance sufficient\n`);

    // Step 1: Create transfer transaction
    console.log(`[${new Date().toISOString()}] 🔨 STEP 1: Creating transaction...`);
    console.log(`[${new Date().toISOString()}]    Args: [${SYSTEM_WALLET}, ${PAYMENT_ATOMIC}, AMA]`);

    const txData = await mcpClient.request({
      method: 'tools/call',
      params: {
        name: 'create_transaction',
        arguments: {
          signer: user.amadeusPublicKey,
          contract: 'Coin',
          function: 'transfer',
          args: [
            { b58: SYSTEM_WALLET },
            PAYMENT_ATOMIC,
            'AMA'
          ]
        }
      }
    }, CallToolResultSchema);

    console.log(`[${new Date().toISOString()}] 📦 MCP Response received`);
    console.log(`[${new Date().toISOString()}] 🔍 Response content length: ${txData.content?.length || 0}`);

    // Extract signing_payload and blob from nested MCP response
    const firstContent = txData.content[0];
    if (firstContent.type !== 'text') {
      throw new Error('Expected text response from create_transaction');
    }
    const txResult = JSON.parse(firstContent.text);
    const { signing_payload, blob } = txResult;

    if (!signing_payload || !blob) {
      console.log(`[${new Date().toISOString()}] ❌ Invalid MCP response structure`);
      console.log(`[${new Date().toISOString()}] 🔍 Response:`, JSON.stringify(txResult, null, 2));
      throw new Error('Invalid transaction response from MCP');
    }

    console.log(`[${new Date().toISOString()}] 📝 Signing payload: ${signing_payload.substring(0, 40)}...`);
    console.log(`[${new Date().toISOString()}] 📝 Blob length: ${blob.length} chars\n`);

    // Step 2: Decrypt user's private key and sign transaction
    console.log(`[${new Date().toISOString()}] ✍️  STEP 2: Signing transaction...`);
    console.log(`[${new Date().toISOString()}]    Decrypting private key...`);
    const decryptedPrivateKey = decryptPrivateKey(user.amadeusPrivateKey);
    console.log(`[${new Date().toISOString()}]    ✅ Private key decrypted`);

    console.log(`[${new Date().toISOString()}]    Creating BLS12-381 signature...`);
    const signature = signTransaction(signing_payload, decryptedPrivateKey);
    console.log(`[${new Date().toISOString()}]    ✅ Signature created: ${signature.substring(0, 40)}...`);
    console.log(`[${new Date().toISOString()}]    Signature length: ${signature.length} chars\n`);

    // Step 3: Submit signed transaction
    console.log(`[${new Date().toISOString()}] 📤 STEP 3: Submitting transaction to blockchain...`);
    console.log(`[${new Date().toISOString()}]    Network: testnet`);

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

    console.log(`[${new Date().toISOString()}] 📦 Submit response received`);
    console.log(`[${new Date().toISOString()}] 🔍 Full submit result:`, JSON.stringify(submitResult, null, 2));

    const submitContent = submitResult.content[0];
    if (submitContent.type !== 'text') {
      throw new Error('Expected text response from submit_transaction');
    }
    const result = JSON.parse(submitContent.text);
    console.log(`[${new Date().toISOString()}] 🔍 Parsed result:`, JSON.stringify(result, null, 2));

    const txHash = result.tx_hash;

    if (!txHash) {
      console.log(`[${new Date().toISOString()}] ❌ No transaction hash in response`);
      throw new Error('No transaction hash returned from blockchain');
    }

    console.log(`[${new Date().toISOString()}] ✅ Transaction submitted successfully!`);
    console.log(`[${new Date().toISOString()}] 🔗 TX Hash: ${txHash}`);
    console.log(`[${new Date().toISOString()}] 💰 ========== PAYMENT COMPLETED ==========\n`);

    return {
      success: true,
      txHash,
      amount: PAYMENT_AMOUNT
    };
  } catch (error) {
    const err = error as Error;
    console.error(`\n[${new Date().toISOString()}] ❌ ========== PAYMENT FAILED ==========`);
    console.error(`[${new Date().toISOString()}] ❌ Error type: ${err.name}`);
    console.error(`[${new Date().toISOString()}] ❌ Error message: ${err.message}`);
    console.error(`[${new Date().toISOString()}] ❌ Stack trace:`, err.stack);
    console.error(`[${new Date().toISOString()}] ❌ =============================================\n`);

    // Provide user-friendly error messages
    if (err.message.includes('Insufficient balance')) {
      throw err; // Already formatted
    } else if (err.message.includes('insufficient')) {
      throw new Error('Insufficient AMA balance in your wallet');
    } else if (err.message.includes('Invalid response from blockchain')) {
      throw new Error('Transaction failed - please check your wallet balance');
    } else {
      throw new Error(`Payment error: ${err.message}`);
    }
  }
}

/**
 * Check if user has sufficient balance for a request
 * This is a soft check using cached balance - actual payment will be the real verification
 */
export function hasSufficientBalance(user: UserDocument): boolean {
  const required = Number(PAYMENT_AMOUNT);
  return user.balance >= required;
}
