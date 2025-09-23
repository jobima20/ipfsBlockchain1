/**
 * Arweave Storage Provider - Permanent Storage Implementation
 * Handles permanent storage via 4EVERLAND gateway for demo purposes
 */

import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { calculateFileHash, generateUniqueId } from '../utils/validation.js';

export class ArweaveProvider extends EventEmitter {
  constructor(config) {
    super();
    
    this.config = {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
      endpoint: config.endpoint || 'https://endpoint.4everland.co',
      bucket: config.bucket,
      region: 'us-east-1',
      s3ForcePathStyle: true,
      signatureVersion: 'v4',
      maxRetries: 3,
      timeout: 600000, // 10 minutes for permanent storage
      ...config
    };

    this.s3 = new AWS.S3(this.config);
    this.name = 'Arweave';
    this.type = 'permanent';
    this.isConnected = false;
    this.maxFileSize = 200 * 1024 * 1024; // 200MB free tier limit
    
    this.initialize();
  }

  /**
   * Initialize provider and verify connection
   */
  async initialize() {
    try {
      await this.s3.headBucket({ Bucket: this.config.bucket }).promise();
      this.isConnected = true;
      logger.info(`${this.name} provider initialized successfully`);
      this.emit('connected');
    } catch (error) {
      if (error.statusCode === 404) {
        await this.createBucket();
      } else {
        logger.error(`${this.name} initialization failed:`, error.message);
        this.emit('error', error);
      }
    }
  }

  /**
   * Create bucket if it doesn't exist
   */
  async createBucket() {
    try {
      await this.s3.createBucket({ Bucket: this.config.bucket }).promise();
      this.isConnected = true;
      logger.info(`${this.name} bucket created successfully`);
      this.emit('connected');
    } catch (error) {
      logger.error(`Failed to create ${this.name} bucket:`, error.message);
      throw error;
    }
  }

  /**
   * Upload file to Arweave (permanent storage)
   */
  async upload(filePath, options = {}) {
    if (!this.isConnected) {
      throw new Error(`${this.name} provider not connected`);
    }

    const startTime = Date.now();
    const fileStats = fs.statSync(filePath);
    
    // Check file size limit for free tier
    if (fileStats.size > this.maxFileSize) {
      throw new Error(`File size (${fileStats.size} bytes) exceeds Arweave free tier limit (${this.maxFileSize} bytes)`);
    }

    const fileHash = await calculateFileHash(filePath);
    const fileId = generateUniqueId();
    const key = `permanent/${fileId}-${path.basename(filePath)}`;

    try {
      logger.info(`Starting ${this.name} upload:`, { 
        file: path.basename(filePath), 
        size: fileStats.size,
        key,
        permanent: true
      });

      const fileStream = fs.createReadStream(filePath);
      
      const uploadParams = {
        Bucket: this.config.bucket,
        Key: key,
        Body: fileStream,
        ContentType: options.contentType || 'application/octet-stream',
        Metadata: {
          'file-hash': fileHash,
          'upload-timestamp': new Date().toISOString(),
          'original-name': path.basename(filePath),
          'storage-type': 'permanent',
          'provider': 'arweave',
          ...options.metadata
        },
        // Arweave-specific metadata for permanent storage
        TaggingDirective: 'REPLACE',
        Tagging: 'StorageType=Permanent&Provider=Arweave&Demo=True'
      };

      const uploadResult = await this.s3.upload(uploadParams).promise();
      const uploadTime = Date.now() - startTime;

      const result = {
        success: true,
        provider: this.name,
        fileId,
        key,
        location: uploadResult.Location,
        etag: uploadResult.ETag,
        size: fileStats.size,
        hash: fileHash,
        uploadTime,
        permanent: true,
        speed: (fileStats.size / uploadTime * 1000).toFixed(2),
        metadata: {
          originalName: path.basename(filePath),
          uploadTimestamp: new Date().toISOString(),
          fileType: path.extname(filePath),
          storageType: 'permanent',
          ...options.metadata
        }
      };

      logger.info(`${this.name} upload completed:`, {
        fileId,
        size: fileStats.size,
        time: uploadTime + 'ms',
        permanent: true
      });

      this.emit('uploadComplete', result);
      return result;

    } catch (error) {
      logger.error(`${this.name} upload failed:`, error.message);
      this.emit('uploadError', error);
      throw new Error(`${this.name} upload failed: ${error.message}`);
    }
  }

  /**
   * Download file with permanent storage verification
   */
  async download(key, downloadPath, options = {}) {
    if (!this.isConnected) {
      throw new Error(`${this.name} provider not connected`);
    }

    try {
      logger.info(`Starting ${this.name} download:`, { key, permanent: true });

      const params = {
        Bucket: this.config.bucket,
        Key: key
      };

      // Get object metadata first
      const headResult = await this.s3.headObject(params).promise();
      const originalHash = headResult.Metadata['file-hash'];

      // Download file
      const data = await this.s3.getObject(params).promise();
      
      // Create download directory if it doesn't exist
      const downloadDir = path.dirname(downloadPath);
      if (!fs.existsSync(downloadDir)) {
        fs.mkdirSync(downloadDir, { recursive: true });
      }

      // Write file
      fs.writeFileSync(downloadPath, data.Body);

      // Verify integrity
      const downloadHash = await calculateFileHash(downloadPath);
      const isValid = downloadHash === originalHash;

      if (!isValid && options.strictIntegrity) {
        fs.unlinkSync(downloadPath);
        throw new Error('File integrity verification failed for permanent storage');
      }

      const result = {
        success: true,
        provider: this.name,
        path: downloadPath,
        size: data.Body.length,
        hash: downloadHash,
        integrity: isValid,
        permanent: true,
        metadata: headResult.Metadata
      };

      logger.info(`${this.name} download completed:`, {
        key,
        size: data.Body.length,
        integrity: isValid,
        permanent: true
      });

      this.emit('downloadComplete', result);
      return result;

    } catch (error) {
      logger.error(`${this.name} download failed:`, error.message);
      this.emit('downloadError', error);
      throw new Error(`${this.name} download failed: ${error.message}`);
    }
  }

  /**
   * List permanent files
   */
  async list(prefix = '', maxKeys = 1000) {
    if (!this.isConnected) {
      throw new Error(`${this.name} provider not connected`);
    }

    try {
      const params = {
        Bucket: this.config.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys
      };

      const result = await this.s3.listObjectsV2(params).promise();
      
      return {
        success: true,
        files: result.Contents.map(item => ({
          key: item.Key,
          size: item.Size,
          lastModified: item.LastModified,
          etag: item.ETag,
          permanent: true
        })),
        truncated: result.IsTruncated,
        nextToken: result.NextContinuationToken
      };

    } catch (error) {
      logger.error(`${this.name} list failed:`, error.message);
      throw error;
    }
  }

  /**
   * Get storage usage statistics
   */
  async getUsageStats() {
    try {
      const listResult = await this.list('permanent/', 10000);
      const totalSize = listResult.files.reduce((sum, file) => sum + file.size, 0);
      const totalFiles = listResult.files.length;

      return {
        provider: this.name,
        totalFiles,
        totalSize,
        permanent: true,
        freeLimit: this.maxFileSize,
        connected: this.isConnected
      };

    } catch (error) {
      logger.error(`${this.name} usage stats failed:`, error.message);
      return {
        provider: this.name,
        error: error.message,
        connected: this.isConnected
      };
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      await this.s3.headBucket({ Bucket: this.config.bucket }).promise();
      return {
        provider: this.name,
        status: 'healthy',
        connected: true,
        permanent: true,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        provider: this.name,
        status: 'unhealthy',
        connected: false,
        permanent: true,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export default ArweaveProvider;
