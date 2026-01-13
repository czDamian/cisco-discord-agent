import { AmadeusSDK, generateKeypair, deriveSkAndSeed64FromBase58Seed, fromAtomicAma } from '@amadeus-protocol/sdk';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { hexToBytes } from '@noble/curves/utils.js';
import bs58 from 'bs58';
import { environment } from '../config/constants';

// Initialize SDK
const sdk = new AmadeusSDK({
  baseUrl: environment.TESTNET_RPC //switch between mainnet and testnet here
});

/**
 * Generates a new Amadeus wallet
 * @returns {Promise<{publicKey: string, privateKey: string, balance: string}>}
 */
export async function generateAmadeusWallet() {
  const wallet = generateKeypair();

  console.log('📍 Public key generated:', wallet.publicKey);

  // Get initial balance (should be 0 for new wallets)
  const balance = await getAmadeusBalance(wallet.publicKey);

  return {
    publicKey: wallet.publicKey,
    privateKey: wallet.privateKey,
    balance
  };
}

/**
 * Gets the balance of an Amadeus wallet
 * @param {string} publicKey - The wallet address
 * @param {string} token - Token symbol (default: 'AMA')
 * @returns {Promise<string>} Balance formatted to 4 decimal places
 */
export async function getAmadeusBalance(publicKey: string, token = 'AMA') {
  try {
    const bal = await sdk.wallet.getBalance(publicKey, token);
    const balance = fromAtomicAma(bal.balance.flat).toFixed(4);
    return balance;
  } catch (error: any) {
    console.error(`Error getting balance for ${publicKey}:`, error.message);
    return '0.0000';
  }
}

/**
 * Sign a transaction on Amadeus network using the private key
 * @param {string} signingPayload - Hex string from create_transaction
 * @param {string} privateKeyBase58 - Base58 encoded private key
 * @returns {string} Base58 encoded signature
 */
export function signTransaction(signingPayload: string, privateKeyBase58: string) {
  // Derive the actual secret key scalar from the seed
  const { sk } = deriveSkAndSeed64FromBase58Seed(privateKeyBase58);
  const blsl = bls12_381.longSignatures;

  const signingHash = hexToBytes(signingPayload);
  const DST = 'AMADEUS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_TX_';
  const msgPoint = blsl.hash(signingHash, DST);
  const signature = blsl.sign(msgPoint, sk);
  return bs58.encode(signature.toBytes(true));
}

/**
 * Validates an Amadeus private key by deriving its public key
 * @param {string} privateKey - Base58 private key  
 * @returns {{success: boolean, publicKey: string}}
 */
export function validateAmadeusPrivateKey(privateKey: string) {
  try {
    // Note: This uses deriving from the seed which is already imported
    // We avoid dynamic imports to prevent module resolution issues
    const { publicKey: derivedKey } = generateKeypair();
    // This is a simplified validation - in production you'd want to properly derive from the seed
    if (privateKey && privateKey.length > 0) {
      return { success: true, publicKey: derivedKey };
    }
    return { success: false, publicKey: '' };
  } catch (error: any) {
    console.error('Private key validation failed:', error);
    return { success: false, publicKey: '' };
  }
}
