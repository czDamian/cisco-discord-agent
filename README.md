# Cisco Discord Bot - X402 Payment System

<div align="center">
  <img src="src/public/logo.png" alt="Cisco Discord Bot Logo" width="300">
</div>

Cisco is an AI-powered Discord bot with Amadeus blockchain integration and x402 payment system integrated.

## Features

- 🤖 **AI Assistant** - Claude-powered responses with Amadeus blockchain tools
- 💰 **Auto-Generated Wallets** - Each user gets a personal Amadeus wallet
- 🔒 **Encrypted Storage** - Private keys encrypted with AES-256-GCM
- 💸 **Pay-Per-Request** - Automatic 10 AMA charge per query
- 📊 **Usage Tracking** - Transaction history and statistics
- 🔧 **MCP Integration** - Direct blockchain access via Model Context Protocol

## Quick Start

### Prerequisites

- Node.js 20+
- MongoDB running locally or connection string
- Discord Bot Token
- Anthropic API Key

### Installation

```bash
# Install dependencies
npm install

# Generate encryption key
openssl rand -hex 32

# Copy and configure environment
cp .env.example .env
# Edit .env with your keys
```

### Environment Setup

Required variables in `.env`:

```env
DISCORD_BOT_TOKEN=<your_discord_bot_token>
ANTHROPIC_API_KEY=<your_anthropic_key>
MONGODB_URI=<your_mongodb_uri>
ENCRYPTION_KEY=<32-byte-hex-from-openssl>
SYSTEM_WALLET_ADDRESS=<your_system_wallet_address>
```

### Run

```bash
npm run dev
```

## Usage

### Bot Commands

- `/balance` - Check your AMA wallet balance on mainnet
- `/deposit` - Get your wallet address for deposits
- `/stats` - View usage statistics
- `/faucet` - Claim 100 AMA daily from the faucet

### Making Queries

Mention the bot with your question or send a **DM** to the bot: 

```
@BotName send 10 AMA to 6cgywWe4bPYyMtBdRnfbYeuim9bDExDHpyrWL1oXbz3JFUrgNLy88vayDkC3Mto7tu from my wallet
```

**Cost**: x402 integrated payment system charges 10 AMA per request (automatically deducted)

## How It Works

### Payment Flow

1. **First Message** → Auto-generated Amadeus wallet created if the suer doesn't have one
2. **User Deposits** → Send AMA to provided wallet address  
3. **Query Sent** → Bot creates & signs 10 AMA transfer to system wallet
4. **Payment Confirmed** → Request processed by Claude
5. **Response Delivered** → Transaction recorded in database

### Architecture

```
User Message
    ↓
Get/Create User (MongoDB)
    ↓
Check Command (/balance, /deposit, /stats)
    ↓
Charge 10 AMA (MCP → Blockchain)
    ↓
Process with Claude (Agentic Loop)
    ↓
Return Response
```

### Wallet Security

- Private keys encrypted with AES-256-GCM
- Encryption key stored separately in `.env`
- Keys only decrypted during transaction signing
- Never logged or exposed

## Project Structure

```
├── bot.js                      # Main Discord bot
├── server.js                   # Express health server
├── models/
│   └── User.js                 # MongoDB user schema
├── utils/
│   ├── encryption.js           # AES-256-GCM encryption
│   ├── amadeus.js              # Wallet generation & signing
│   ├── database.js             # MongoDB operations
│   └── payment.js              # Payment processing
└── GUIDE/
    ├── encryption.ts           # Reference implementation
    └── amadeusFunctions.ts     # Reference implementation
```

## Available MCP Tools

The bot has access to 19 Amadeus blockchain tools:

- `create_transaction` - Create unsigned transactions
- `submit_transaction` - Submit signed transactions
- `get_account_balance` - Query wallet balances
- `get_chain_stats` - Network statistics
- `get_transaction` - Transaction details
- `get_transaction_history` - Account history
- And more...

## Development

### Database Schema

```javascript
User {
  discordId: String (unique),
  discordUsername: String,
  amadeusPublicKey: String,
  amadeusPrivateKey: String (encrypted),
  balance: Number,
  totalRequests: Number,
  totalSpent: Number,
  transactions: [{
    type: 'payment' | 'deposit' | 'refund',
    amount: Number,
    txHash: String,
    timestamp: Date,
    description: String
  }]
}
```

### Testing

```bash
# Test encryption
node -e "import('./utils/encryption.js').then(e => console.log(e.testEncryption()))"

# Test wallet generation  
node -e "import('./utils/amadeus.js').then(a => a.generateAmadeusWallet())"
```

## Configuration

### Payment Settings

Adjust in `.env`:

```env
PAYMENT_AMOUNT=10          # AMA per request
SYSTEM_WALLET_ADDRESS=...     # Receives payments
```

### MongoDB

```env
MONGODB_URI=<your_mongodb_uri>
```

## Troubleshooting

**Payment Failed**
- Check user wallet balance with `/balance`
- Ensure wallet has > 10 AMA
- Verify user deposited to correct address

**Encryption Test Failed**
- Verify `ENCRYPTION_KEY` is exactly 64 hex characters
- Regenerate with `openssl rand -hex 32`

**MongoDB Connection Error**
- Ensure MongoDB is running
- Check `MONGODB_URI` in `.env`

## License

MIT
