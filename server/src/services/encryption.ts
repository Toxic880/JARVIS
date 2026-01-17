/**
 * Encryption Service
 * 
 * Provides encryption at rest for sensitive memory entries.
 * 
 * Trade-offs:
 * - Uses AES-256-GCM for authenticated encryption
 * - Key derived from master secret using PBKDF2
 * - Each entry gets unique IV (nonce)
 * - Searchability is lost for encrypted content (can't query encrypted fields)
 * 
 * When to encrypt:
 * - Memory type: HEALTH (medical info)
 * - Memory type: IMPORTANT (sensitive dates)
 * - Explicitly marked as sensitive
 * 
 * When NOT to encrypt:
 * - Facts/preferences (need to be searchable)
 * - Projects (need to be searchable)
 * - General information
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

export class EncryptionService {
  private masterKey: Buffer | null = null;

  /**
   * Initialize with master secret from environment
   */
  constructor() {
    const secret = process.env.ENCRYPTION_SECRET;
    if (secret) {
      // Derive key from secret
      this.masterKey = this.deriveKey(secret, Buffer.alloc(SALT_LENGTH, 0));
      console.log('[Encryption] Service initialized with master key');
    } else {
      console.warn('[Encryption] No ENCRYPTION_SECRET set - encryption disabled');
    }
  }

  /**
   * Derive encryption key from password using PBKDF2
   */
  private deriveKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
  }

  /**
   * Check if encryption is available
   */
  isEnabled(): boolean {
    return this.masterKey !== null;
  }

  /**
   * Encrypt a string value
   * Returns base64 encoded: salt + iv + authTag + ciphertext
   */
  encrypt(plaintext: string): string {
    if (!this.masterKey) {
      throw new Error('Encryption not configured');
    }

    // Generate random salt and IV
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Derive key for this encryption using the salt
    const key = this.deriveKey(this.masterKey.toString('hex'), salt);

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    // Encrypt
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    // Get auth tag
    const authTag = cipher.getAuthTag();

    // Combine: salt + iv + authTag + ciphertext
    const combined = Buffer.concat([salt, iv, authTag, encrypted]);

    return combined.toString('base64');
  }

  /**
   * Decrypt a string value
   * Expects base64 encoded: salt + iv + authTag + ciphertext
   */
  decrypt(ciphertext: string): string {
    if (!this.masterKey) {
      throw new Error('Encryption not configured');
    }

    const combined = Buffer.from(ciphertext, 'base64');

    // Extract components
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(
      SALT_LENGTH + IV_LENGTH,
      SALT_LENGTH + IV_LENGTH + TAG_LENGTH
    );
    const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    // Derive key using the salt
    const key = this.deriveKey(this.masterKey.toString('hex'), salt);

    // Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  /**
   * Determine if a memory entry should be encrypted
   */
  shouldEncrypt(type: string, content: string): boolean {
    // Always encrypt health-related memories
    if (type === 'health') {
      return true;
    }

    // Check for sensitive patterns in content
    const sensitivePatterns = [
      /\b(ssn|social security)\b/i,
      /\b(password|passcode|pin)\b/i,
      /\b(credit card|bank account)\b/i,
      /\b(medical|diagnosis|prescription)\b/i,
      /\b(secret|confidential)\b/i,
    ];

    return sensitivePatterns.some((pattern) => pattern.test(content));
  }

  /**
   * Encrypt memory content if needed
   */
  maybeEncrypt(
    type: string,
    content: string
  ): { content: string; isEncrypted: boolean } {
    if (!this.isEnabled()) {
      return { content, isEncrypted: false };
    }

    if (this.shouldEncrypt(type, content)) {
      return {
        content: this.encrypt(content),
        isEncrypted: true,
      };
    }

    return { content, isEncrypted: false };
  }

  /**
   * Decrypt memory content if encrypted
   */
  maybeDecrypt(content: string, isEncrypted: boolean): string {
    if (!isEncrypted) {
      return content;
    }

    if (!this.isEnabled()) {
      throw new Error('Cannot decrypt: encryption not configured');
    }

    return this.decrypt(content);
  }
}

// Singleton instance
export const encryptionService = new EncryptionService();
