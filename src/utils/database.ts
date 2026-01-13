import mongoose from 'mongoose';
import User from '../models/User.js';
import { generateAmadeusWallet, getAmadeusBalance } from './amadeus.js';
import { encryptPrivateKey } from './encryption.js';
import { environment } from '../config/constants';

export async function connectToDatabase() {
  if (!environment.MONGODB_URI) {
    throw new Error('Missing MONGODB_URI environment variable');
  }
  try {
    await mongoose.connect(environment.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
}

/**
 * Get or create a user by Discord ID
 * Creates a new Amadeus wallet if user doesn't exist
 * 
 * @param {string} discordId - Discord user ID
 * @param {string} discordUsername - Discord username
 * @returns {Promise<User>} User document
 */
export async function getOrCreateUser(discordId: string, discordUsername: string) {
  let user = await User.findOne({ discordId });

  if (!user) {
    console.log(`\n📝 Creating new user: ${discordUsername} (${discordId})`);

    // Generate new Amadeus wallet
    const wallet = await generateAmadeusWallet();

    // Encrypt the private key before storing
    const encryptedPrivateKey = encryptPrivateKey(wallet.privateKey);

    // Create new user
    user = new User({
      discordId,
      discordUsername,
      amadeusPublicKey: wallet.publicKey,
      amadeusPrivateKey: encryptedPrivateKey,
      balance: parseFloat(wallet.balance),
      transactions: []
    });

    await user.save();
    console.log(`✅ User created with wallet: ${wallet.publicKey}\n`);
  }

  return user;
}

/**
 * Update user's cached balance from blockchain
 * 
 * @param {string} discordId - Discord user ID
 * @returns {Promise<number>} Updated balance
 */
export async function updateUserBalance(discordId: string) {
  const user = await User.findOne({ discordId });
  if (!user) {
    throw new Error('User not found');
  }

  const balance = await getAmadeusBalance(user.amadeusPublicKey);
  const balanceNum = parseFloat(balance);

  await User.findOneAndUpdate(
    { discordId },
    { balance: balanceNum, lastActive: new Date() }
  );

  return balanceNum;
}

/**
 * Record a transaction in user's history
 * 
 * @param {string} discordId - Discord user ID
 * @param {Object} txData - Transaction data
 * @param {string} txData.type - Transaction type ('payment', 'deposit', 'refund')
 * @param {number} txData.amount - Amount in AMA
 * @param {string} txData.txHash - Transaction hash
 * @param {string} txData.description - Description
 */
export async function recordTransaction(discordId: string, txData: any) {
  await User.findOneAndUpdate(
    { discordId },
    {
      $push: {
        transactions: {
          type: txData.type,
          amount: txData.amount,
          txHash: txData.txHash,
          timestamp: new Date(),
          description: txData.description
        }
      },
      $inc: {
        totalSpent: txData.type === 'payment' ? parseFloat(txData.amount) : 0,
        totalRequests: txData.type === 'payment' ? 1 : 0
      },
      lastActive: new Date()
    }
  );
}

/**
 * Get user statistics
 * 
 * @param {string} discordId - Discord user ID
 * @returns {Promise<Object>} User statistics
 */
export async function getUserStats(discordId: string) {
  const user = await User.findOne({ discordId });
  if (!user) {
    throw new Error('User not found');
  }

  return {
    totalRequests: user.totalRequests,
    totalSpent: user.totalSpent,
    balance: user.balance,
    walletAddress: user.amadeusPublicKey,
    memberSince: user.createdAt
  };
}
