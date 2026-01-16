import "dotenv/config"

/**
 * Central Configuration
 * All environment variables and constants exported from a single object
 */
export const environment = {
  PAYMENT_AMOUNT: 1,              // 1 AMA per request
  MIN_BALANCE: 2,                   // Minimum balance to process request
  FAUCET_AMOUNT: 100,                 // Amount claimed from the faucet 
  SYSTEM_WALLET_ADDRESS: process.env.SYSTEM_WALLET_ADDRESS!,
  TESTNET_RPC: process.env.TESTNET_RPC!,
  MAINNET_RPC: process.env.MAINNET_RPC!,
  MONGODB_URI: process.env.MONGODB_URI!,
  DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN!,
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID!,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
  ANTHROPIC_MODEL: 'claude-haiku-4-5-20251001',
  MAX_TOKENS: 4096,
  MAX_TOOL_OUTPUT_CHARS: 30000, // Truncate tool outputs to ~7.5k tokens
  MCP_SERVER_URL: 'https://mcp.ama.one',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
  ENCRYPTION_ALGORITHM: 'aes-256-gcm' as const,
  EXPRESS_PORT: process.env.EXPRESS_PORT || '3000',
  MAX_HISTORY_MESSAGES: 6,      // Keep last 6 messages
  MAX_AGENTIC_LOOPS: 5,         // To Prevent infinite loops
} as const;

/**
 * Validates required environment variables
 */
export function validateConfig(): void {
  const required = [
    { name: 'DISCORD_BOT_TOKEN', value: environment.DISCORD_BOT_TOKEN },
    { name: 'DISCORD_CLIENT_ID', value: environment.DISCORD_CLIENT_ID },
    { name: 'ANTHROPIC_API_KEY', value: environment.ANTHROPIC_API_KEY },
    { name: 'MONGODB_URI', value: environment.MONGODB_URI },
    { name: 'ENCRYPTION_KEY', value: environment.ENCRYPTION_KEY },
    { name: 'SYSTEM_WALLET_ADDRESS', value: environment.SYSTEM_WALLET_ADDRESS },
    { name: 'TESTNET_RPC', value: environment.TESTNET_RPC },
    { name: 'MAINNET_RPC', value: environment.MAINNET_RPC },
  ];

  const missing = required.filter(r => !r.value);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.map(m => m.name).join(', ')}`
    );
  }
}
