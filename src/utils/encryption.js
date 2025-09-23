/**
 * Encryption Utilities - AES-256-GCM Implementation
 * Provides secure encryption/decryption for file data
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits
const TAG_LENGTH = 16; // 128 bits

/**
 * Generate a secure random encryption key
 */
export function generateKey() {
  return crypto.randomBytes(KEY_LENGTH);
}

/**
 * Generate a secure random initialization vector
 */
export function generateIV() {
  return crypto.randomBytes(IV_LENGTH);
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(data, key = null, iv = null) {
  try {
    // Generate key and IV if not provided
    const encryptionKey = key || generateKey();
    const initVector = iv || generateIV();

    // Ensure key is the right length
    let finalKey;
    if (typeof encryptionKey === 'string') {
      finalKey = crypto.scryptSync(encryptionKey, 'salt', KEY_LENGTH);
    } else if (encryptionKey.length === KEY_LENGTH) {
      finalKey = encryptionKey;
    } else {
      throw new Error(`Invalid key length: ${encryptionKey.length}, expected: ${KEY_LENGTH}`);
    }

    // Create cipher
    const cipher = crypto.createCipher(ALGORITHM, finalKey, initVector);

    // Encrypt data
    let encrypted = cipher.update(data);
    cipher.final();

    // Get authentication tag
    const tag = cipher.getAuthTag();

    // Combine IV + tag + encrypted data
    const result = Buffer.concat([initVector, tag, encrypted]);

    return {
      encrypted: result,
      key: finalKey,
      iv: initVector,
      tag: tag,
      algorithm: ALGORITHM
    };

  } catch (error) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(encryptedData, key, iv = null, tag = null) {
  try {
    let finalKey;
    let initVector;
    let authTag;
    let ciphertext;

    // Handle different input formats
    if (iv && tag) {
      // Separate components provided
      initVector = iv;
      authTag = tag;
      ciphertext = encryptedData;
    } else {
      // Combined format (IV + tag + ciphertext)
      if (encryptedData.length < IV_LENGTH + TAG_LENGTH) {
        throw new Error('Encrypted data too short');
      }
      
      initVector = encryptedData.slice(0, IV_LENGTH);
      authTag = encryptedData.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      ciphertext = encryptedData.slice(IV_LENGTH + TAG_LENGTH);
    }

    // Ensure key is the right length
    if (typeof key === 'string') {
      finalKey = crypto.scryptSync(key, 'salt', KEY_LENGTH);
    } else if (key.length === KEY_LENGTH) {
      finalKey = key;
    } else {
      throw new Error(`Invalid key length: ${key.length}, expected: ${KEY_LENGTH}`);
    }

    // Create decipher
    const decipher = crypto.createDecipher(ALGORITHM, finalKey, initVector);
    decipher.setAuthTag(authTag);

    // Decrypt data
    let decrypted = decipher.update(ciphertext);
    decipher.final();

    return decrypted;

  } catch (error) {
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Encrypt file stream
 */
export function createEncryptStream(key, iv = null) {
  const initVector = iv || generateIV();
  const finalKey = typeof key === 'string' ? crypto.scryptSync(key, 'salt', KEY_LENGTH) : key;
  
  return {
    stream: crypto.createCipher(ALGORITHM, finalKey, initVector),
    iv: initVector,
    key: finalKey
  };
}

/**
 * Decrypt file stream
 */
export function createDecryptStream(key, iv, tag) {
  const finalKey = typeof key === 'string' ? crypto.scryptSync(key, 'salt', KEY_LENGTH) : key;
  const decipher = crypto.createDecipher(ALGORITHM, finalKey, iv);
  
  if (tag) {
    decipher.setAuthTag(tag);
  }
  
  return decipher;
}

/**
 * Hash data using SHA-256
 */
export function hash(data, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(data).digest('hex');
}

/**
 * Generate secure random bytes
 */
export function randomBytes(length) {
  return crypto.randomBytes(length);
}

/**
 * Generate secure random string
 */
export function randomString(length = 32, encoding = 'hex') {
  return crypto.randomBytes(Math.ceil(length / 2)).toString(encoding).slice(0, length);
}

/**
 * Create HMAC signature
 */
export function createHMAC(data, secret, algorithm = 'sha256') {
  return crypto.createHmac(algorithm, secret).update(data).digest('hex');
}

/**
 * Verify HMAC signature
 */
export function verifyHMAC(data, secret, signature, algorithm = 'sha256') {
  const expectedSignature = createHMAC(data, secret, algorithm);
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Password-based key derivation
 */
export function deriveKey(password, salt = null, iterations = 100000, keyLength = KEY_LENGTH) {
  const finalSalt = salt || crypto.randomBytes(16);
  const derivedKey = crypto.pbkdf2Sync(password, finalSalt, iterations, keyLength, 'sha256');
  
  return {
    key: derivedKey,
    salt: finalSalt,
    iterations
  };
}

/**
 * Secure password hashing
 */
export function hashPassword(password, saltRounds = 12) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, saltRounds * 1000, 32, 'sha256');
  
  return {
    hash: hash.toString('hex'),
    salt: salt.toString('hex'),
    rounds: saltRounds
  };
}

/**
 * Verify password hash
 */
export function verifyPassword(password, hash, salt, rounds = 12) {
  const saltBuffer = Buffer.from(salt, 'hex');
  const hashBuffer = Buffer.from(hash, 'hex');
  const computedHash = crypto.pbkdf2Sync(password, saltBuffer, rounds * 1000, 32, 'sha256');
  
  return crypto.timingSafeEqual(computedHash, hashBuffer);
}

export default {
  encrypt,
  decrypt,
  generateKey,
  generateIV,
  createEncryptStream,
  createDecryptStream,
  hash,
  randomBytes,
  randomString,
  createHMAC,
  verifyHMAC,
  deriveKey,
  hashPassword,
  verifyPassword
};
