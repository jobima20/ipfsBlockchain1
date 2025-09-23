/**
 * Security Manager - Multi-Layer Security Implementation
 * Handles authentication, authorization, encryption, and security monitoring
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { encrypt, decrypt } from '../utils/encryption.js';

export class SecurityManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      jwtSecret: config.jwtSecret || process.env.JWT_SECRET,
      encryptionKey: config.encryptionKey || process.env.ENCRYPTION_KEY,
      tokenExpiry: config.tokenExpiry || '24h',
      maxLoginAttempts: config.maxLoginAttempts || 5,
      lockoutDuration: config.lockoutDuration || 15 * 60 * 1000, // 15 minutes
      rateLimitWindow: config.rateLimitWindow || 60 * 1000, // 1 minute
      rateLimitMax: config.rateLimitMax || 100,
      ...config
    };

    // Security tracking
    this.loginAttempts = new Map();
    this.activeTokens = new Map();
    this.rateLimitTracker = new Map();
    this.securityEvents = [];
    
    // Initialize security monitoring
    this.initializeSecurityMonitoring();
  }

  /**
   * Initialize security monitoring and cleanup
   */
  initializeSecurityMonitoring() {
    // Clean up expired tokens every hour
    setInterval(() => {
      this.cleanupExpiredTokens();
    }, 60 * 60 * 1000);

    // Clean up old security events every day
    setInterval(() => {
      this.cleanupSecurityEvents();
    }, 24 * 60 * 60 * 1000);

    // Clean up rate limit tracking every minute
    setInterval(() => {
      this.cleanupRateLimitTracker();
    }, 60 * 1000);

    logger.info('Security monitoring initialized');
  }

  /**
   * Generate secure access token for file operations
   */
  generateAccessToken(userId, permissions = [], metadata = {}) {
    try {
      const tokenId = crypto.randomUUID();
      const payload = {
        userId,
        tokenId,
        permissions,
        type: 'file_access',
        metadata,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + this.parseTokenExpiry(this.config.tokenExpiry)
      };

      const token = jwt.sign(payload, this.config.jwtSecret);
      
      // Store active token
      this.activeTokens.set(tokenId, {
        userId,
        permissions,
        createdAt: new Date(),
        lastUsed: new Date(),
        metadata
      });

      this.logSecurityEvent('token_generated', {
        userId,
        tokenId,
        permissions
      });

      return {
        token,
        tokenId,
        expiresIn: this.config.tokenExpiry,
        permissions
      };

    } catch (error) {
      logger.error('Token generation failed:', error.message);
      throw new Error('Failed to generate access token');
    }
  }

  /**
   * Verify and validate access token
   */
  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret);
      const tokenInfo = this.activeTokens.get(decoded.tokenId);

      if (!tokenInfo) {
        throw new Error('Token not found or revoked');
      }

      // Update last used timestamp
      tokenInfo.lastUsed = new Date();
      this.activeTokens.set(decoded.tokenId, tokenInfo);

      return {
        valid: true,
        userId: decoded.userId,
        tokenId: decoded.tokenId,
        permissions: decoded.permissions,
        metadata: decoded.metadata
      };

    } catch (error) {
      this.logSecurityEvent('token_verification_failed', {
        error: error.message,
        token: token.substring(0, 20) + '...'
      });

      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Check if user has required permission
   */
  hasPermission(userPermissions, requiredPermission) {
    if (!userPermissions || !Array.isArray(userPermissions)) {
      return false;
    }

    return userPermissions.includes(requiredPermission) || 
           userPermissions.includes('admin') ||
           userPermissions.includes('*');
  }

  /**
   * Generate file access signature
   */
  generateFileSignature(fileId, userId, action, expiry = 3600) {
    const timestamp = Math.floor(Date.now() / 1000);
    const expiryTime = timestamp + expiry;
    
    const signatureData = {
      fileId,
      userId,
      action,
      timestamp,
      expiry: expiryTime
    };

    const signatureString = JSON.stringify(signatureData);
    const signature = crypto
      .createHmac('sha256', this.config.encryptionKey)
      .update(signatureString)
      .digest('hex');

    return {
      signature,
      timestamp,
      expiry: expiryTime,
      valid: true
    };
  }

  /**
   * Verify file access signature
   */
  verifyFileSignature(fileId, userId, action, signature, timestamp, expiry) {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Check if signature has expired
      if (currentTime > expiry) {
        return {
          valid: false,
          error: 'Signature expired'
        };
      }

      // Recreate signature data
      const signatureData = {
        fileId,
        userId,
        action,
        timestamp,
        expiry
      };

      const signatureString = JSON.stringify(signatureData);
      const expectedSignature = crypto
        .createHmac('sha256', this.config.encryptionKey)
        .update(signatureString)
        .digest('hex');

      if (signature !== expectedSignature) {
        this.logSecurityEvent('signature_verification_failed', {
          fileId,
          userId,
          action
        });

        return {
          valid: false,
          error: 'Invalid signature'
        };
      }

      return {
        valid: true,
        fileId,
        userId,
        action
      };

    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Encrypt sensitive file metadata
   */
  encryptMetadata(metadata) {
    try {
      const metadataString = JSON.stringify(metadata);
      const encryptionResult = encrypt(Buffer.from(metadataString), this.config.encryptionKey);
      
      return {
        encrypted: encryptionResult.encrypted.toString('base64'),
        iv: encryptionResult.iv,
        algorithm: 'aes-256-gcm'
      };

    } catch (error) {
      logger.error('Metadata encryption failed:', error.message);
      throw error;
    }
  }

  /**
   * Decrypt sensitive file metadata
   */
  decryptMetadata(encryptedMetadata, iv) {
    try {
      const encryptedBuffer = Buffer.from(encryptedMetadata, 'base64');
      const decryptedBuffer = decrypt(encryptedBuffer, this.config.encryptionKey, iv);
      const metadataString = decryptedBuffer.toString();
      
      return JSON.parse(metadataString);

    } catch (error) {
      logger.error('Metadata decryption failed:', error.message);
      throw error;
    }
  }

  /**
   * Rate limiting check
   */
  checkRateLimit(identifier, action = 'default') {
    const key = `${identifier}:${action}`;
    const now = Date.now();
    const windowStart = now - this.config.rateLimitWindow;

    // Get or create rate limit entry
    let rateLimitEntry = this.rateLimitTracker.get(key);
    if (!rateLimitEntry) {
      rateLimitEntry = {
        requests: [],
        blocked: false,
        blockUntil: 0
      };
      this.rateLimitTracker.set(key, rateLimitEntry);
    }

    // Check if currently blocked
    if (rateLimitEntry.blocked && now < rateLimitEntry.blockUntil) {
      return {
        allowed: false,
        retryAfter: Math.ceil((rateLimitEntry.blockUntil - now) / 1000),
        remaining: 0
      };
    }

    // Clean old requests
    rateLimitEntry.requests = rateLimitEntry.requests.filter(time => time > windowStart);

    // Check if limit exceeded
    if (rateLimitEntry.requests.length >= this.config.rateLimitMax) {
      rateLimitEntry.blocked = true;
      rateLimitEntry.blockUntil = now + this.config.lockoutDuration;

      this.logSecurityEvent('rate_limit_exceeded', {
        identifier,
        action,
        requestCount: rateLimitEntry.requests.length
      });

      return {
        allowed: false,
        retryAfter: Math.ceil(this.config.lockoutDuration / 1000),
        remaining: 0
      };
    }

    // Add current request
    rateLimitEntry.requests.push(now);
    rateLimitEntry.blocked = false;

    return {
      allowed: true,
      remaining: this.config.rateLimitMax - rateLimitEntry.requests.length,
      resetTime: windowStart + this.config.rateLimitWindow
    };
  }

  /**
   * Validate file upload security
   */
  validateFileUpload(fileInfo, userInfo) {
    const security = {
      safe: true,
      warnings: [],
      errors: []
    };

    // Check file size
    if (fileInfo.size > 1024 * 1024 * 1024) { // 1GB
      security.warnings.push('Large file upload detected');
    }

    // Check file extension
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.vbs', '.js', '.jar'];
    const extension = fileInfo.name.toLowerCase().split('.').pop();
    
    if (dangerousExtensions.includes('.' + extension)) {
      security.safe = false;
      security.errors.push(`Dangerous file extension detected: .${extension}`);
    }

    // Check filename for suspicious patterns
    const suspiciousPatterns = ['script', 'payload', 'exploit', 'backdoor'];
    const filename = fileInfo.name.toLowerCase();
    
    for (const pattern of suspiciousPatterns) {
      if (filename.includes(pattern)) {
        security.warnings.push(`Suspicious filename pattern: ${pattern}`);
      }
    }

    // Check user permissions
    if (!this.hasPermission(userInfo.permissions, 'upload')) {
      security.safe = false;
      security.errors.push('User does not have upload permission');
    }

    return security;
  }

  /**
   * Generate secure download URL
   */
  generateSecureDownloadUrl(fileId, userId, baseUrl, expiry = 3600) {
    const signature = this.generateFileSignature(fileId, userId, 'download', expiry);
    
    const params = new URLSearchParams({
      file: fileId,
      user: userId,
      sig: signature.signature,
      ts: signature.timestamp,
      exp: signature.expiry
    });

    return `${baseUrl}/download?${params.toString()}`;
  }

  /**
   * Audit trail logging
   */
  logSecurityEvent(eventType, details = {}) {
    const event = {
      id: crypto.randomUUID(),
      type: eventType,
      timestamp: new Date().toISOString(),
      details,
      source: 'SecurityManager'
    };

    this.securityEvents.push(event);
    
    // Emit event for real-time monitoring
    this.emit('securityEvent', event);
    
    // Log critical events
    if (['token_verification_failed', 'signature_verification_failed', 'rate_limit_exceeded'].includes(eventType)) {
      logger.warn(`Security event: ${eventType}`, details);
    }
  }

  /**
   * Get security audit trail
   */
  getSecurityAudit(options = {}) {
    const {
      limit = 100,
      offset = 0,
      eventType,
      userId,
      startDate,
      endDate
    } = options;

    let filteredEvents = [...this.securityEvents];

    // Apply filters
    if (eventType) {
      filteredEvents = filteredEvents.filter(event => event.type === eventType);
    }

    if (userId) {
      filteredEvents = filteredEvents.filter(event => event.details.userId === userId);
    }

    if (startDate) {
      filteredEvents = filteredEvents.filter(event => new Date(event.timestamp) >= new Date(startDate));
    }

    if (endDate) {
      filteredEvents = filteredEvents.filter(event => new Date(event.timestamp) <= new Date(endDate));
    }

    // Sort by timestamp (newest first)
    filteredEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Apply pagination
    const paginatedEvents = filteredEvents.slice(offset, offset + limit);

    return {
      events: paginatedEvents,
      total: filteredEvents.length,
      limit,
      offset
    };
  }

  /**
   * Revoke access token
   */
  revokeToken(tokenId, reason = 'manual_revocation') {
    const tokenInfo = this.activeTokens.get(tokenId);
    
    if (tokenInfo) {
      this.activeTokens.delete(tokenId);
      
      this.logSecurityEvent('token_revoked', {
        tokenId,
        userId: tokenInfo.userId,
        reason
      });

      return { success: true };
    }

    return { success: false, error: 'Token not found' };
  }

  /**
   * Get active sessions for user
   */
  getUserSessions(userId) {
    const sessions = [];
    
    for (const [tokenId, tokenInfo] of this.activeTokens.entries()) {
      if (tokenInfo.userId === userId) {
        sessions.push({
          tokenId,
          createdAt: tokenInfo.createdAt,
          lastUsed: tokenInfo.lastUsed,
          permissions: tokenInfo.permissions
        });
      }
    }

    return sessions;
  }

  /**
   * Cleanup expired tokens
   */
  cleanupExpiredTokens() {
    const now = new Date();
    const expiredTokens = [];

    for (const [tokenId, tokenInfo] of this.activeTokens.entries()) {
      // Consider token expired if not used for 24 hours
      if (now - tokenInfo.lastUsed > 24 * 60 * 60 * 1000) {
        expiredTokens.push(tokenId);
      }
    }

    expiredTokens.forEach(tokenId => {
      this.activeTokens.delete(tokenId);
    });

    if (expiredTokens.length > 0) {
      logger.info(`Cleaned up ${expiredTokens.length} expired tokens`);
    }
  }

  /**
   * Cleanup old security events
   */
  cleanupSecurityEvents() {
    const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days
    const originalCount = this.securityEvents.length;
    
    this.securityEvents = this.securityEvents.filter(event => 
      new Date(event.timestamp) > cutoffDate
    );

    const cleanedCount = originalCount - this.securityEvents.length;
    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} old security events`);
    }
  }

  /**
   * Cleanup rate limit tracker
   */
  cleanupRateLimitTracker() {
    const now = Date.now();
    const cutoff = now - this.config.rateLimitWindow;

    for (const [key, entry] of this.rateLimitTracker.entries()) {
      entry.requests = entry.requests.filter(time => time > cutoff);
      
      // Remove entries with no recent requests and not blocked
      if (entry.requests.length === 0 && !entry.blocked) {
        this.rateLimitTracker.delete(key);
      }
    }
  }

  /**
   * Parse token expiry string to seconds
   */
  parseTokenExpiry(expiry) {
    if (typeof expiry === 'number') return expiry;
    
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 24 * 60 * 60; // Default 24 hours
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 24 * 60 * 60;
      default: return 24 * 60 * 60;
    }
  }

  /**
   * Get security statistics
   */
  getSecurityStats() {
    const now = new Date();
    const last24h = new Date(now - 24 * 60 * 60 * 1000);
    
    const recentEvents = this.securityEvents.filter(event => 
      new Date(event.timestamp) > last24h
    );

    const eventTypeCounts = {};
    recentEvents.forEach(event => {
      eventTypeCounts[event.type] = (eventTypeCounts[event.type] || 0) + 1;
    });

    return {
      activeTokens: this.activeTokens.size,
      recentEvents: recentEvents.length,
      eventTypeCounts,
      rateLimitEntries: this.rateLimitTracker.size,
      totalSecurityEvents: this.securityEvents.length
    };
  }
}

export default SecurityManager;
