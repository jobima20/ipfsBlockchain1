/**
 * Storj Storage Provider - Enterprise Implementation
 * Handles unlimited storage with S3-compatible API
 */

import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { calculateFileHash, generateUniqueId } from '../utils/validation.js';

export class StorjProvider extends EventEmitter {
  constructor(config) {
    super();
    
    this.config = {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
      endpoint: config.endpoint || 'https://gateway.storjshare.io',
      bucket: config.bucket,
      region: 'us-east-1',
      s3ForcePathStyle: true,
      signatureVersion: 'v4',
      maxRetries: 3,
      timeout: 300000, // 5 minutes
      ...config
    };

    this.s3 = new AWS.S3(this.config);
    this.name = 'Storj';
    this.type = 'primary';
    this.isConnected = false;
    
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
   * Upload file with chunked upload support
   */
  async upload(filePath, options = {}) {
    if (!this.isConnected) {
      throw new Error(`${this.name} provider not connected`);
    }

    const startTime = Date.now();
    const fileStats = fs.statSync(filePath);
    const fileHash = await calculateFileHash(filePath);
    const fileId = generateUniqueId();
    const key = `${options.prefix || 'uploads'}/${fileId}-${path.basename(filePath)}`;

    try {
      logger.info(`Starting ${this.name} upload:`, { 
        file: path.basename(filePath), 
        size: fileStats.size,
        key 
      });

      let uploadResult;

      // Use multipart upload for large files (>50MB)
      if (fileStats.size > 50 * 1024 * 1024) {
        uploadResult = await this.multipartUpload(filePath, key, options, fileHash);
      } else {
        uploadResult = await this.singleUpload(filePath, key, options, fileHash);
      }

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
        speed: (fileStats.size / uploadTime * 1000).toFixed(2), // bytes per second
        metadata: {
          originalName: path.basename(filePath),
          uploadTimestamp: new Date().toISOString(),
          fileType: path.extname(filePath),
          ...options.metadata
        }
      };

      logger.info(`${this.name} upload completed:`, {
        fileId,
        size: fileStats.size,
        time: uploadTime + 'ms'
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
   * Single upload for smaller files
   */
  async singleUpload(filePath, key, options, fileHash) {
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
        ...options.metadata
      },
      ServerSideEncryption: 'AES256'
    };

    return await this.s3.upload(uploadParams).promise();
  }

  /**
   * Multipart upload for large files with progress tracking
   */
  async multipartUpload(filePath, key, options, fileHash) {
    const fileStats = fs.statSync(filePath);
    const chunkSize = this.config.chunkSize || 50 * 1024 * 1024; // 50MB chunks
    const totalChunks = Math.ceil(fileStats.size / chunkSize);

    logger.info(`Starting multipart upload: ${totalChunks} chunks`);

    const uploadParams = {
      Bucket: this.config.bucket,
      Key: key,
      ContentType: options.contentType || 'application/octet-stream',
      Metadata: {
        'file-hash': fileHash,
        'upload-timestamp': new Date().toISOString(),
        'chunk-upload': 'true',
        'total-chunks': totalChunks.toString(),
        ...options.metadata
      }
    };

    // Initialize multipart upload
    const multipart = await this.s3.createMultipartUpload(uploadParams).promise();
    const uploadId = multipart.UploadId;

    try {
      const uploadPromises = [];
      const parts = [];

      // Upload chunks in parallel (limit concurrency)
      const concurrencyLimit = 3;
      for (let i = 0; i < totalChunks; i += concurrencyLimit) {
        const batch = [];
        
        for (let j = 0; j < concurrencyLimit && i + j < totalChunks; j++) {
          const chunkIndex = i + j;
          const start = chunkIndex * chunkSize;
          const end = Math.min(start + chunkSize, fileStats.size);
          
          batch.push(this.uploadChunk(filePath, key, uploadId, chunkIndex + 1, start, end));
        }

        const batchResults = await Promise.all(batch);
        parts.push(...batchResults);

        // Emit progress
        const progress = Math.round(((i + concurrencyLimit) / totalChunks) * 100);
        this.emit('uploadProgress', {
          progress: Math.min(progress, 100),
          uploadedChunks: i + concurrencyLimit,
          totalChunks
        });
      }

      // Complete multipart upload
      const completeParams = {
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber)
        }
      };

      return await this.s3.completeMultipartUpload(completeParams).promise();

    } catch (error) {
      // Abort multipart upload on error
      await this.s3.abortMultipartUpload({
        Bucket: this.config.bucket,
        Key: key,
        UploadId: uploadId
      }).promise();
      throw error;
    }
  }

  /**
   * Upload individual chunk
   */
  async uploadChunk(filePath, key, uploadId, partNumber, start, end) {
    const chunkStream = fs.createReadStream(filePath, { start, end: end - 1 });
    
    const uploadParams = {
      Bucket: this.config.bucket,
      Key: key,
      PartNumber: partNumber,
      UploadId: uploadId,
      Body: chunkStream
    };

    const result = await this.s3.uploadPart(uploadParams).promise();
    
    return {
      ETag: result.ETag,
      PartNumber: partNumber
    };
  }

  /**
   * Download file with integrity verification
   */
  async download(key, downloadPath, options = {}) {
    if (!this.isConnected) {
      throw new Error(`${this.name} provider not connected`);
    }

    try {
      logger.info(`Starting ${this.name} download:`, { key });

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
        throw new Error('File integrity verification failed');
      }

      const result = {
        success: true,
        provider: this.name,
        path: downloadPath,
        size: data.Body.length,
        hash: downloadHash,
        integrity: isValid,
        metadata: headResult.Metadata
      };

      logger.info(`${this.name} download completed:`, {
        key,
        size: data.Body.length,
        integrity: isValid
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
   * Delete file
   */
  async delete(key) {
    if (!this.isConnected) {
      throw new Error(`${this.name} provider not connected`);
    }

    try {
      await this.s3.deleteObject({
        Bucket: this.config.bucket,
        Key: key
      }).promise();

      logger.info(`${this.name} file deleted:`, { key });
      return { success: true, key };

    } catch (error) {
      logger.error(`${this.name} delete failed:`, error.message);
      throw error;
    }
  }

  /**
   * List files
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
          etag: item.ETag
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
      const listResult = await this.list('', 10000);
      const totalSize = listResult.files.reduce((sum, file) => sum + file.size, 0);
      const totalFiles = listResult.files.length;

      return {
        provider: this.name,
        totalFiles,
        totalSize,
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
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        provider: this.name,
        status: 'unhealthy',
        connected: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

export default StorjProvider;
