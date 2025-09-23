/**
 * File Processor - Advanced File Handling
 * Handles validation, compression, chunking, and processing
 */

import fs from 'fs';
import path from 'path';
import pako from 'pako';
import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { calculateFileHash, validateFileType, generateUniqueId } from '../utils/validation.js';
import { encrypt, decrypt } from '../utils/encryption.js';

export class FileProcessor extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      maxFileSize: config.maxFileSize || 1024 * 1024 * 1024, // 1GB
      chunkSize: config.chunkSize || 50 * 1024 * 1024, // 50MB
      compressionThreshold: config.compressionThreshold || 1024 * 1024, // 1MB
      allowedTypes: config.allowedTypes || ['*'], // Allow all by default
      tempDir: config.tempDir || './temp',
      enableCompression: config.enableCompression !== false,
      enableEncryption: config.enableEncryption !== false,
      enableDeduplication: config.enableDeduplication !== false,
      ...config
    };

    this.processingQueue = new Map();
    this.deduplicationCache = new Map();
    
    this.ensureTempDir();
  }

  /**
   * Ensure temp directory exists
   */
  ensureTempDir() {
    if (!fs.existsSync(this.config.tempDir)) {
      fs.mkdirSync(this.config.tempDir, { recursive: true });
    }
  }

  /**
   * Process file before upload with all enhancements
   */
  async processFile(filePath, options = {}) {
    const processingId = generateUniqueId();
    const startTime = Date.now();
    
    logger.info(`Starting file processing:`, { 
      processingId, 
      file: path.basename(filePath) 
    });

    try {
      // Add to processing queue
      this.processingQueue.set(processingId, {
        status: 'processing',
        startTime,
        file: path.basename(filePath)
      });

      this.emit('processingStart', { processingId, file: filePath });

      // Step 1: Validate file
      const validation = await this.validateFile(filePath, options);
      if (!validation.valid) {
        throw new Error(`File validation failed: ${validation.errors.join(', ')}`);
      }

      // Step 2: Calculate original hash for deduplication
      const originalHash = await calculateFileHash(filePath);
      
      // Step 3: Check for deduplication
      if (this.config.enableDeduplication) {
        const existingFile = this.deduplicationCache.get(originalHash);
        if (existingFile && options.allowDeduplication !== false) {
          logger.info(`File already exists (deduplicated):`, { originalHash });
          
          return {
            success: true,
            deduplicated: true,
            processingId,
            originalHash,
            existingFile,
            processingTime: Date.now() - startTime
          };
        }
      }

      let processedFilePath = filePath;
      const processing = {
        compressed: false,
        encrypted: false,
        chunks: [],
        originalSize: fs.statSync(filePath).size,
        finalSize: 0
      };

      // Step 4: Compression (if enabled and beneficial)
      if (this.config.enableCompression && processing.originalSize > this.config.compressionThreshold) {
        const compressionResult = await this.compressFile(filePath, options);
        if (compressionResult.beneficial) {
          processedFilePath = compressionResult.compressedPath;
          processing.compressed = true;
          processing.compressionRatio = compressionResult.ratio;
          
          logger.info(`File compressed:`, {
            originalSize: processing.originalSize,
            compressedSize: compressionResult.compressedSize,
            ratio: compressionResult.ratio
          });
        }
      }

      // Step 5: Encryption (if enabled)
      if (this.config.enableEncryption && options.encrypt !== false) {
        const encryptionResult = await this.encryptFile(processedFilePath, options.encryptionKey);
        processedFilePath = encryptionResult.encryptedPath;
        processing.encrypted = true;
        processing.encryptionKey = encryptionResult.key;
        processing.encryptionIv = encryptionResult.iv;
        
        logger.info(`File encrypted:`, { processingId });
      }

      // Step 6: Chunking (for large files)
      processing.finalSize = fs.statSync(processedFilePath).size;
      if (processing.finalSize > this.config.chunkSize) {
        const chunkingResult = await this.chunkFile(processedFilePath, options);
        processing.chunks = chunkingResult.chunks;
        processing.chunked = true;
        
        logger.info(`File chunked:`, {
          totalChunks: processing.chunks.length,
          chunkSize: this.config.chunkSize
        });
      }

      // Step 7: Generate final hash
      const finalHash = await calculateFileHash(processedFilePath);

      // Step 8: Update deduplication cache
      if (this.config.enableDeduplication) {
        this.deduplicationCache.set(originalHash, {
          processingId,
          finalHash,
          timestamp: new Date().toISOString(),
          size: processing.originalSize
        });
      }

      const result = {
        success: true,
        processingId,
        originalPath: filePath,
        processedPath: processedFilePath,
        originalHash,
        finalHash,
        processing,
        processingTime: Date.now() - startTime,
        metadata: {
          originalName: path.basename(filePath),
          originalSize: processing.originalSize,
          finalSize: processing.finalSize,
          compressed: processing.compressed,
          encrypted: processing.encrypted,
          chunked: processing.chunked,
          chunkCount: processing.chunks.length
        }
      };

      // Update processing queue
      this.processingQueue.set(processingId, {
        status: 'completed',
        startTime,
        endTime: Date.now(),
        result
      });

      this.emit('processingComplete', result);
      
      logger.info(`File processing completed:`, {
        processingId,
        originalSize: processing.originalSize,
        finalSize: processing.finalSize,
        time: result.processingTime + 'ms'
      });

      return result;

    } catch (error) {
      this.processingQueue.set(processingId, {
        status: 'failed',
        startTime,
        endTime: Date.now(),
        error: error.message
      });

      this.emit('processingError', { processingId, error });
      
      logger.error(`File processing failed:`, {
        processingId,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Validate file before processing
   */
  async validateFile(filePath, options = {}) {
    const errors = [];
    const warnings = [];

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        errors.push('File does not exist');
        return { valid: false, errors, warnings };
      }

      const stats = fs.statSync(filePath);

      // Check file size
      if (stats.size === 0) {
        errors.push('File is empty');
      }

      if (stats.size > this.config.maxFileSize) {
        errors.push(`File size (${stats.size} bytes) exceeds maximum allowed size (${this.config.maxFileSize} bytes)`);
      }

      // Check file type
      const typeValidation = validateFileType(filePath, this.config.allowedTypes);
      if (!typeValidation.valid) {
        errors.push(`File type not allowed: ${typeValidation.detectedType}`);
      }

      // Security scan simulation (placeholder for real virus scanning)
      const securityScan = await this.performSecurityScan(filePath);
      if (!securityScan.safe) {
        errors.push(`Security scan failed: ${securityScan.reason}`);
      }

      // Performance warnings
      if (stats.size > 100 * 1024 * 1024) {
        warnings.push('Large file detected - upload may take significant time');
      }

      return {
        valid: errors.length === 0,
        errors,
        warnings,
        fileSize: stats.size,
        fileType: typeValidation.detectedType
      };

    } catch (error) {
      return {
        valid: false,
        errors: [`Validation error: ${error.message}`],
        warnings
      };
    }
  }

  /**
   * Simulate security scan (placeholder for real implementation)
   */
  async performSecurityScan(filePath) {
    // In production, integrate with actual virus scanning service
    // For demo, perform basic checks
    
    const fileName = path.basename(filePath).toLowerCase();
    const extension = path.extname(fileName);
    
    // Blacklist dangerous extensions
    const dangerousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.vbs', '.js'];
    if (dangerousExtensions.includes(extension)) {
      return {
        safe: false,
        reason: `Potentially dangerous file extension: ${extension}`
      };
    }

    // Check for suspicious patterns in filename
    const suspiciousPatterns = ['virus', 'malware', 'trojan', 'backdoor'];
    for (const pattern of suspiciousPatterns) {
      if (fileName.includes(pattern)) {
        return {
          safe: false,
          reason: `Suspicious filename pattern detected: ${pattern}`
        };
      }
    }

    return { safe: true };
  }

  /**
   * Compress file if beneficial
   */
  async compressFile(filePath, options = {}) {
    const originalSize = fs.statSync(filePath).size;
    const tempCompressedPath = path.join(this.config.tempDir, `compressed_${generateUniqueId()}.gz`);

    try {
      const originalData = fs.readFileSync(filePath);
      const compressedData = pako.gzip(originalData, {
        level: options.compressionLevel || 6,
        windowBits: 15,
        memLevel: 8
      });

      const compressedSize = compressedData.length;
      const ratio = ((originalSize - compressedSize) / originalSize * 100).toFixed(2);
      
      // Only use compression if it saves at least 10%
      const beneficial = compressedSize < originalSize * 0.9;

      if (beneficial) {
        fs.writeFileSync(tempCompressedPath, compressedData);
        
        return {
          beneficial: true,
          compressedPath: tempCompressedPath,
          originalSize,
          compressedSize,
          ratio: parseFloat(ratio)
        };
      } else {
        return {
          beneficial: false,
          reason: `Compression not beneficial (${ratio}% savings)`
        };
      }

    } catch (error) {
      logger.error(`Compression failed:`, error.message);
      return {
        beneficial: false,
        error: error.message
      };
    }
  }

  /**
   * Encrypt file
   */
  async encryptFile(filePath, encryptionKey) {
    const tempEncryptedPath = path.join(this.config.tempDir, `encrypted_${generateUniqueId()}.enc`);

    try {
      const fileData = fs.readFileSync(filePath);
      const encryptionResult = encrypt(fileData, encryptionKey);
      
      fs.writeFileSync(tempEncryptedPath, encryptionResult.encrypted);

      return {
        encryptedPath: tempEncryptedPath,
        key: encryptionResult.key,
        iv: encryptionResult.iv
      };

    } catch (error) {
      logger.error(`Encryption failed:`, error.message);
      throw error;
    }
  }

  /**
   * Chunk large file
   */
  async chunkFile(filePath, options = {}) {
    const fileSize = fs.statSync(filePath).size;
    const chunkSize = options.chunkSize || this.config.chunkSize;
    const totalChunks = Math.ceil(fileSize / chunkSize);
    const chunks = [];

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, fileSize);
        const chunkPath = path.join(this.config.tempDir, `chunk_${i}_${generateUniqueId()}.part`);
        
        // Read chunk
        const fileHandle = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(end - start);
        fs.readSync(fileHandle, buffer, 0, end - start, start);
        fs.closeSync(fileHandle);
        
        // Write chunk
        fs.writeFileSync(chunkPath, buffer);
        
        const chunkHash = await calculateFileHash(chunkPath);
        
        chunks.push({
          index: i,
          path: chunkPath,
          size: buffer.length,
          hash: chunkHash,
          start,
          end
        });

        this.emit('chunkCreated', {
          chunkIndex: i,
          totalChunks,
          chunkSize: buffer.length
        });
      }

      return {
        success: true,
        chunks,
        totalChunks,
        originalSize: fileSize
      };

    } catch (error) {
      logger.error(`Chunking failed:`, error.message);
      throw error;
    }
  }

  /**
   * Reconstruct file from chunks
   */
  async reconstructFile(chunks, outputPath) {
    try {
      const sortedChunks = chunks.sort((a, b) => a.index - b.index);
      const outputStream = fs.createWriteStream(outputPath);

      for (const chunk of sortedChunks) {
        const chunkData = fs.readFileSync(chunk.path);
        outputStream.write(chunkData);
      }

      outputStream.end();

      return new Promise((resolve, reject) => {
        outputStream.on('finish', () => {
          logger.info(`File reconstructed successfully:`, { outputPath });
          resolve({ success: true, path: outputPath });
        });

        outputStream.on('error', reject);
      });

    } catch (error) {
      logger.error(`File reconstruction failed:`, error.message);
      throw error;
    }
  }

  /**
   * Decompress file
   */
  async decompressFile(compressedPath, outputPath) {
    try {
      const compressedData = fs.readFileSync(compressedPath);
      const decompressedData = pako.ungzip(compressedData);
      
      fs.writeFileSync(outputPath, decompressedData);
      
      return {
        success: true,
        path: outputPath,
        originalSize: compressedData.length,
        decompressedSize: decompressedData.length
      };

    } catch (error) {
      logger.error(`Decompression failed:`, error.message);
      throw error;
    }
  }

  /**
   * Decrypt file
   */
  async decryptFile(encryptedPath, outputPath, key, iv) {
    try {
      const encryptedData = fs.readFileSync(encryptedPath);
      const decryptedData = decrypt(encryptedData, key, iv);
      
      fs.writeFileSync(outputPath, decryptedData);
      
      return {
        success: true,
        path: outputPath,
        size: decryptedData.length
      };

    } catch (error) {
      logger.error(`Decryption failed:`, error.message);
      throw error;
    }
  }

  /**
   * Clean up temporary files
   */
  async cleanup(processingId) {
    try {
      const processing = this.processingQueue.get(processingId);
      if (!processing || !processing.result) {
        return;
      }

      const result = processing.result;
      
      // Clean up processed file if different from original
      if (result.processedPath !== result.originalPath && fs.existsSync(result.processedPath)) {
        fs.unlinkSync(result.processedPath);
      }

      // Clean up chunks
      if (result.processing.chunks) {
        for (const chunk of result.processing.chunks) {
          if (fs.existsSync(chunk.path)) {
            fs.unlinkSync(chunk.path);
          }
        }
      }

      this.processingQueue.delete(processingId);
      
      logger.info(`Cleanup completed for processing:`, { processingId });

    } catch (error) {
      logger.error(`Cleanup failed:`, error.message);
    }
  }

  /**
   * Get processing status
   */
  getProcessingStatus(processingId) {
    return this.processingQueue.get(processingId);
  }

  /**
   * Get all processing statuses
   */
  getAllProcessingStatuses() {
    return Object.fromEntries(this.processingQueue);
  }
}

export default FileProcessor;
