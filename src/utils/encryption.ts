import crypto from 'crypto';
import { environment } from '../config/constants';

const ENCRYPTION_KEY = environment.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm';

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  throw new Error('ENCRYPTION_KEY must be a 32-byte hex string (64 characters)');
}

/**
 * Encrypts an Amadeus private key (Base58 format
 * NOTE: Amadeus keys are stored as Hex-encoded UTF8 strings of the Base58 key
 * @param {string} privateKeyBase58 - The Base58 private key to encrypt
 * @returns {string} Encrypted data in format "iv:tag:encrypted"
 */
export function encryptPrivateKey(privateKeyBase58: string): string {
  try {
    // Convert Base58 key to hex-encoded UTF8 string
    const hexEncodedKey = Buffer.from(privateKeyBase58, 'utf8').toString('hex');

    // Generate a random initialization vector
    const iv = crypto.randomBytes(16);

    // Create cipher with IV
    const cipher = crypto.createCipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      iv
    );

    // Encrypt the hex-encoded key
    let encrypted = cipher.update(hexEncodedKey, 'hex', 'hex');
    encrypted += cipher.final('hex');

    // Get the authentication tag
    const tag = cipher.getAuthTag();

    // Combine iv, tag, and encrypted data
    const combined = iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;

    return combined;
  } catch (error) {
    console.error('Encryption failed:', error);
    throw new Error('Failed to encrypt private key');
  }
}

/**
 * Decrypts an Amadeus private key back to Base58 format
 * @param {string} encryptedData - The encrypted private key string
 * @returns {string} Decrypted private key (Base58 string)
 */
export function decryptPrivateKey(encryptedData: string): string {
  try {
    // Split the combined data
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    // Create decipher with IV
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY, 'hex'),
      iv
    );

    // Set the authentication tag
    decipher.setAuthTag(tag);

    // Decrypt to get hex-encoded key
    let decryptedHexKey = decipher.update(encrypted, 'hex', 'hex');
    decryptedHexKey += decipher.final('hex');

    // Convert hex-encoded UTF8 back to original Base58 string
    const privateKeyBase58 = Buffer.from(decryptedHexKey, 'hex').toString('utf8');

    return privateKeyBase58;
  } catch (error) {
    console.error('Decryption failed:', error);
    throw new Error('Failed to decrypt private key');
  }
}

/**
 * Validates that encryption/decryption is working correctly
 * @returns {boolean} indicating if encryption is working
 */
export function testEncryption() {
  try {
    // Test with a sample Base58-like key
    const testKey = '5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3';
    const encrypted = encryptPrivateKey(testKey);
    const decrypted = decryptPrivateKey(encrypted);

    const success = testKey === decrypted;
    if (success) {
      console.log('✅ Encryption test passed');
    } else {
      console.error('❌ Encryption test failed: keys do not match');
    }
    return success;
  } catch (error) {
    console.error('❌ Encryption test failed:', error);
    return false;
  }
}
