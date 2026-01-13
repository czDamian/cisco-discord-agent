import { Message, ChatInputCommandInteraction } from 'discord.js';
import { getAmadeusBalance } from '../utils/amadeus.js';
import { updateUserBalance, getUserStats } from '../utils/database.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { environment } from '../config/constants.js';

// All commands in this file are free to use and does not require the user to pay
interface UserDocument {
  discordId: string;
  discordUsername: string;
  amadeusPublicKey: string;
  amadeusPrivateKey: string;
  balance: number;
}

type ReplyFunction = (msg: string) => Promise<any>;

/**
 * Handle /balance command
 */
export async function handleBalance(
  user: UserDocument,
  reply: ReplyFunction
): Promise<void> {
  const balance = await getAmadeusBalance(user.amadeusPublicKey);
  await updateUserBalance(user.discordId);

  await reply(
    `Balance for your wallet - \`${user.amadeusPublicKey}\` is **${balance}** AMA`
  );
}

/**
 * Handle /deposit command
 */
export async function handleDeposit(
  user: UserDocument,
  reply: ReplyFunction
): Promise<void> {
  await reply(
    `Send AMA from any wallet or faucet to:\n` +
    `\`${user.amadeusPublicKey}\`\n\n` +
    `Use \`/balance\` to check your balance on Amadeus mainnet.`
  );
}

/**
 * Handle /stats command
 */
export async function handleStats(
  user: UserDocument,
  reply: ReplyFunction
): Promise<void> {
  const stats = await getUserStats(user.discordId);
  const balance = await getAmadeusBalance(stats.walletAddress);

  await reply(
    `Current Balance: **${balance}** AMA\n` +
    `Total Requests: **${stats.totalRequests}**\n` +
    `Total Spent: **${stats.totalSpent}** AMA\n` +
    `Member Since: ${stats.memberSince.toLocaleDateString()}`
  );
}

/**
 * Handle /faucet command - Claim 100 testnet AMA
 */
export async function handleFaucet(
  user: UserDocument,
  reply: ReplyFunction,
  mcpClient: any
): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}] 💧 Faucet claim requested by ${user.amadeusPublicKey}`);

    // Call MCP claim_testnet_ama tool
    const result = await mcpClient.request({
      method: 'tools/call',
      params: {
        name: "claim_testnet_ama",
        arguments: {
          address: user.amadeusPublicKey
        }
      }
    }, CallToolResultSchema);

    const responseContent = result.content[0];
    if (responseContent.type !== 'text') {
      throw new Error('Invalid faucet response');
    }

    const faucetResult = JSON.parse(responseContent.text);
    console.log(`[${new Date().toISOString()}] ✅ Faucet claim result:`, faucetResult);

    // Update balance
    await updateUserBalance(user.discordId);

    if (faucetResult.status === 'success') {
      await reply(
        `✅ **Claim Successful!**\n\n` +
        `Received: **${environment.FAUCET_AMOUNT} AMA**\n` +
        `TX Hash: \`${faucetResult.tx_hash}\`\n\n` +
        `Use \`/balance\` to check your updated balance.`
      );
    } else {
      await reply(
        `❌ **Claim Failed**\n\n` +
        `${faucetResult.message || 'You may have already claimed from this wallet.'}\n\n` +
        `Note: Faucet is limited to once per day.`
      );
    }
  } catch (error: any) {
    console.error(`[${new Date().toISOString()}] ❌ Faucet claim failed:`, error);
    await reply(
      `❌ **Error claiming from faucet**\n\n` +
      `${error.message}\n\n` +
      `Please try again later or contact support.`
    );
  }
}
