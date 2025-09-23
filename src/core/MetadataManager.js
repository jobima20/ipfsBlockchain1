/**
 * Metadata Manager - Blockchain-Ready Metadata Handling
 * Manages file metadata with blockchain integration preparation
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import logger from '../utils/logger.js';
import { generateUniqueId } from '../utils/validation.js';

export class MetadataManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      metadataDir: config.metadataDir || './metadata',
      enableBlockchainSync: config.enableBlockchainSync !== false,
      enableVersioning: config.enableVersioning !== false,
      compressionEnabled: config.compressionEnabled !== false,
      encryptionEnabled: config.encryptionEnabled !== false,
      maxVersions: config.maxVersions || 10,
      ...config
    };

    // In-memory metadata cache
    this.metadataCache = new Map();
    this.versionHistory = new Map();
    this.blockchainQueue = [];
    
    this.ensureMetadataDir();
    this.initializeMetadataSystem();
  }

  /**
   * Ensure metadata directory exists
   */
  ensureMetadataDir() {
    if (!fs.existsSync(this.config.metadataDir)) {
      fs.mkdirSync(this.config.metadataDir, { recursive: true });
    }
  }

  /**
   * Initialize metadata system
   */
  initializeMetadataSystem() {
    // Load existing metadata from disk
    this.loadExistingMetadata();
    
    // Setup blockchain sync if enabled
    if (this.config.enableBlockchainSync) {
      this.setupBlockchainSync();
    }

    logger.info('Metadata manager initialized');
  }

  /**
   * Load existing metadata from disk
   */
  loadExistingMetadata() {
    try {
      if (!fs.existsSync(this.config.metadataDir)) {
        return;
      }

      const files = fs.readdirSync(this.config.metadataDir);
      let loadedCount = 0;

      for (const file of files) {
        if (file.endsWith('.meta.json')) {
          try {
            const filePath = path.join(this.config.metadataDir, file);
            const metadataJson = fs.readFileSync(filePath, 'utf8');
            const metadata = JSON.parse(metadataJson);
            
            this.metadataCache.set(metadata.fileId, metadata);
            
            // Load version history if available
            if (metadata.versions) {
              this.versionHistory.set(metadata.fileId, metadata.versions);
            }
            
            loadedCount++;
          } catch (error) {
            logger.warn(`Failed to load metadata file ${file}:`, error.message);
          }
        }
      }

      logger.info(`Loaded ${loadedCount} metadata entries from disk`);

    } catch (error) {
      logger.error('Failed to load existing metadata:', error.message);
    }
  }

  /**
   * Create comprehensive metadata for uploaded file
   */
  createMetadata(fileInfo, uploadResult, processingResult, userInfo) {
    const fileId = fileInfo.fileId || generateUniqueId();
    const timestamp = new Date().toISOString();

    const metadata = {
      // Core identification
      fileId,
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      
      // File information
      file: {
        originalName: fileInfo.originalName || path.basename(fileInfo.path),
        size: fileInfo.size || fs.statSync(fileInfo.path).size,
        type: fileInfo.type || path.extname(fileInfo.path),
        hash: fileInfo.hash,
        encoding: fileInfo.encoding || 'binary'
      },

      // Storage information
      storage: {
        providers: uploadResult.backups ? 
                  [uploadResult.primary, ...uploadResult.backups] : 
                  [uploadResult.primary],
        primary: {
          provider: uploadResult.primary.provider,
          location: uploadResult.primary.location,
          key: uploadResult.primary.key,
          size: uploadResult.primary.size,
          uploadTime: uploadResult.primary.uploadTime,
          etag: uploadResult.primary.etag
        },
        backups: uploadResult.backups ? uploadResult.backups.map(backup => ({
          provider: backup.provider,
          location: backup.location,
          key: backup.key,
          size: backup.size,
          uploadTime: backup.uploadTime,
          etag: backup.etag
        })) : [],
        strategy: uploadResult.strategy,
        totalUploads: uploadResult.totalUploads
      },

      // Processing information
      processing: processingResult ? {
        compressed: processingResult.processing.compressed,
        encrypted: processingResult.processing.encrypted,
        chunked: processingResult.processing.chunked,
        chunkCount: processingResult.processing.chunks?.length || 0,
        compressionRatio: processingResult.processing.compressionRatio,
        processingTime: processingResult.processingTime,
        finalSize: processingResult.processing.finalSize,
        encryptionKey: processingResult.processing.encryptionKey,
        encryptionIv: processingResult.processing.encryptionIv
      } : null,

      // User and access information
      access: {
        owner: userInfo.userId || 'anonymous',
        permissions: userInfo.permissions || ['read'],
        accessLevel: userInfo.accessLevel || 'private',
        sharedWith: [],
        downloadCount: 0,
        lastAccessed: null
      },

      // Blockchain preparation
      blockchain: {
        transactionHash: null,
        blockNumber: null,
        gasUsed: null,
        confirmed: false,
        smartContractAddress: null,
        eventLogs: []
      },

      // Additional metadata
      metadata: {
        description: fileInfo.description || '',
        tags: fileInfo.tags || [],
        category: fileInfo.category || 'general',
        public: fileInfo.public || false,
        searchable: fileInfo.searchable !== false
      },

      // System information
      system: {
        uploadedFrom: userInfo.ipAddress || 'unknown',
        userAgent: userInfo.userAgent || 'unknown',
        apiVersion: '1.0.0',
        nodeVersion: process.version,
        timestamp: Date.now()
      }
    };

    // Store in cache and persist
    this.metadataCache.set(fileId, metadata);
    this.persistMetadata(fileId, metadata);

    // Initialize version history
    if (this.config.enableVersioning) {
      this.versionHistory.set(fileId, [{
        version: 1,
        timestamp,
        changes: 'Initial upload',
        hash: fileInfo.hash,
        size: metadata.file.size
      }]);
    }

    // Queue for blockchain sync
    if (this.config.enableBlockchainSync) {
      this.queueForBlockchainSync(fileId, metadata);
    }

    this.emit('metadataCreated', { fileId, metadata });
    
    logger.info(`Metadata created for file:`, { 
      fileId, 
      originalName: metadata.file.originalName,
      size: metadata.file.size
    });

    return metadata;
  }

  /**
   * Update existing metadata
   */
  updateMetadata(fileId, updates, userInfo = {}) {
    const existingMetadata = this.metadataCache.get(fileId);
    
    if (!existingMetadata) {
      throw new Error(`Metadata not found for file: ${fileId}`);
    }

    const timestamp = new Date().toISOString();
    const newVersion = existingMetadata.version + 1;

    // Create updated metadata
    const updatedMetadata = {
      ...existingMetadata,
      version: newVersion,
      updatedAt: timestamp,
      ...updates
    };

    // Store version history
    if (this.config.enableVersioning) {
      const versionHistory = this.versionHistory.get(fileId) || [];
      versionHistory.push({
        version: newVersion,
        timestamp,
        changes: updates.changeDescription || 'Metadata updated',
        updatedBy: userInfo.userId || 'system',
        previousVersion: existingMetadata.version
      });

      // Limit version history
      if (versionHistory.length > this.config.maxVersions) {
        versionHistory.splice(0, versionHistory.length - this.config.maxVersions);
      }

      this.versionHistory.set(fileId, versionHistory);
      updatedMetadata.versions = versionHistory;
    }

    // Update cache and persist
    this.metadataCache.set(fileId, updatedMetadata);
    this.persistMetadata(fileId, updatedMetadata);

    // Queue for blockchain sync
    if (this.config.enableBlockchainSync) {
      this.queueForBlockchainSync(fileId, updatedMetadata);
    }

    this.emit('metadataUpdated', { fileId, metadata: updatedMetadata, previousVersion: existingMetadata.version });
    
    logger.info(`Metadata updated for file:`, { 
      fileId, 
      version: newVersion,
      changes: updates.changeDescription
    });

    return updatedMetadata;
  }

  /**
   * Get metadata by file ID
   */
  getMetadata(fileId, options = {}) {
    const metadata = this.metadataCache.get(fileId);
    
    if (!metadata) {
      // Try loading from disk if not in cache
      const loadedMetadata = this.loadMetadataFromDisk(fileId);
      if (loadedMetadata) {
        this.metadataCache.set(fileId, loadedMetadata);
        return this.filterMetadata(loadedMetadata, options);
      }
      return null;
    }

    return this.filterMetadata(metadata, options);
  }

  /**
   * Filter metadata based on options and permissions
   */
  filterMetadata(metadata, options = {}) {
    if (!metadata) return null;

    let filteredMetadata = { ...metadata };

    // Remove sensitive information if not authorized
    if (!options.includeSecrets) {
      if (filteredMetadata.processing?.encryptionKey) {
        filteredMetadata.processing.encryptionKey = '[REDACTED]';
      }
      if (filteredMetadata.processing?.encryptionIv) {
        filteredMetadata.processing.encryptionIv = '[REDACTED]';
      }
    }

    // Filter based on access level
    if (options.accessLevel && options.accessLevel !== 'admin') {
      delete filteredMetadata.system;
      delete filteredMetadata.blockchain.gasUsed;
    }

    // Include version history if requested
    if (options.includeVersions && this.versionHistory.has(metadata.fileId)) {
      filteredMetadata.versionHistory = this.versionHistory.get(metadata.fileId);
    }

    return filteredMetadata;
  }

  /**
   * Search metadata
   */
  searchMetadata(query, options = {}) {
    const {
      limit = 50,
      offset = 0,
      sortBy = 'updatedAt',
      sortOrder = 'desc',
      filters = {}
    } = options;

    let results = Array.from(this.metadataCache.values());

    // Apply text search
    if (query) {
      const searchTerm = query.toLowerCase();
      results = results.filter(metadata => {
        return (
          metadata.file.originalName.toLowerCase().includes(searchTerm) ||
          metadata.metadata.description.toLowerCase().includes(searchTerm) ||
          metadata.metadata.tags.some(tag => tag.toLowerCase().includes(searchTerm)) ||
          metadata.metadata.category.toLowerCase().includes(searchTerm)
        );
      });
    }

    // Apply filters
    if (filters.owner) {
      results = results.filter(metadata => metadata.access.owner === filters.owner);
    }

    if (filters.category) {
      results = results.filter(metadata => metadata.metadata.category === filters.category);
    }

    if (filters.public !== undefined) {
      results = results.filter(metadata => metadata.metadata.public === filters.public);
    }

    if (filters.minSize) {
      results = results.filter(metadata => metadata.file.size >= filters.minSize);
    }

    if (filters.maxSize) {
      results = results.filter(metadata => metadata.file.size <= filters.maxSize);
    }

    if (filters.fileType) {
      results = results.filter(metadata => metadata.file.type === filters.fileType);
    }

    if (filters.dateFrom) {
      results = results.filter(metadata => 
        new Date(metadata.createdAt) >= new Date(filters.dateFrom)
      );
    }

    if (filters.dateTo) {
      results = results.filter(metadata => 
        new Date(metadata.createdAt) <= new Date(filters.dateTo)
      );
    }

    // Sort results
    results.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];

      // Handle nested properties
      if (sortBy.includes('.')) {
        const parts = sortBy.split('.');
        aValue = parts.reduce((obj, key) => obj?.[key], a);
        bValue = parts.reduce((obj, key) => obj?.[key], b);
      }

      if (sortOrder === 'desc') {
        return bValue > aValue ? 1 : -1;
      } else {
        return aValue > bValue ? 1 : -1;
      }
    });

    // Apply pagination
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      results: paginatedResults.map(metadata => this.filterMetadata(metadata, options)),
      total: results.length,
      limit,
      offset,
      hasMore: offset + limit < results.length
    };
  }

  /**
   * Update file access statistics
   */
  updateAccessStats(fileId, action = 'download', userInfo = {}) {
    const metadata = this.metadataCache.get(fileId);
    
    if (!metadata) {
      logger.warn(`Cannot update access stats - metadata not found:`, { fileId });
      return false;
    }

    const timestamp = new Date().toISOString();

    // Update access statistics
    if (action === 'download') {
      metadata.access.downloadCount = (metadata.access.downloadCount || 0) + 1;
      metadata.access.lastAccessed = timestamp;
      metadata.access.lastDownloadedBy = userInfo.userId || 'anonymous';
    }

    // Update metadata
    metadata.updatedAt = timestamp;
    
    // Persist changes
    this.metadataCache.set(fileId, metadata);
    this.persistMetadata(fileId, metadata);

    this.emit('accessStatsUpdated', { fileId, action, metadata });

    return true;
  }

  /**
   * Add file sharing information
   */
  shareFile(fileId, shareWith, permissions = ['read'], expiresAt = null, sharedBy = 'unknown') {
    const metadata = this.metadataCache.get(fileId);
    
    if (!metadata) {
      throw new Error(`File not found: ${fileId}`);
    }

    const shareId = generateUniqueId();
    const timestamp = new Date().toISOString();

    const shareInfo = {
      shareId,
      sharedWith: shareWith,
      permissions,
      sharedBy,
      sharedAt: timestamp,
      expiresAt,
      active: true
    };

    // Add to shared list
    if (!metadata.access.sharedWith) {
      metadata.access.sharedWith = [];
    }

    metadata.access.sharedWith.push(shareInfo);
    metadata.updatedAt = timestamp;

    // Persist changes
    this.metadataCache.set(fileId, metadata);
    this.persistMetadata(fileId, metadata);

    this.emit('fileShared', { fileId, shareInfo, metadata });

    logger.info(`File shared:`, { 
      fileId, 
      shareId,
      sharedWith: shareWith,
      permissions
    });

    return shareInfo;
  }

  /**
   * Revoke file sharing
   */
  revokeFileShare(fileId, shareId, revokedBy = 'unknown') {
    const metadata = this.metadataCache.get(fileId);
    
    if (!metadata || !metadata.access.sharedWith) {
      throw new Error(`File or share not found: ${fileId}/${shareId}`);
    }

    const shareIndex = metadata.access.sharedWith.findIndex(share => share.shareId === shareId);
    
    if (shareIndex === -1) {
      throw new Error(`Share not found: ${shareId}`);
    }

    // Mark as inactive
    metadata.access.sharedWith[shareIndex].active = false;
    metadata.access.sharedWith[shareIndex].revokedAt = new Date().toISOString();
    metadata.access.sharedWith[shareIndex].revokedBy = revokedBy;
    metadata.updatedAt = new Date().toISOString();

    // Persist changes
    this.metadataCache.set(fileId, metadata);
    this.persistMetadata(fileId, metadata);

    this.emit('fileShareRevoked', { fileId, shareId, metadata });

    logger.info(`File share revoked:`, { fileId, shareId, revokedBy });

    return true;
  }

  /**
   * Get blockchain-ready metadata
   */
  getBlockchainMetadata(fileId) {
    const metadata = this.getMetadata(fileId);
    
    if (!metadata) {
      return null;
    }

    // Create blockchain-optimized metadata
    const blockchainMetadata = {
      fileId: metadata.fileId,
      fileHash: metadata.file.hash,
      fileName: metadata.file.originalName,
      fileSize: metadata.file.size,
      owner: metadata.access.owner,
      timestamp: Math.floor(new Date(metadata.createdAt).getTime() / 1000),
      accessLevel: metadata.access.accessLevel,
      storageProvider: metadata.storage.primary.provider,
      storageLocation: metadata.storage.primary.location,
      permanent: metadata.storage.primary.provider === 'Arweave',
      encrypted: metadata.processing?.encrypted || false,
      version: metadata.version
    };

    return blockchainMetadata;
  }

  /**
   * Update blockchain information
   */
  updateBlockchainInfo(fileId, blockchainInfo) {
    const metadata = this.metadataCache.get(fileId);
    
    if (!metadata) {
      throw new Error(`Metadata not found for file: ${fileId}`);
    }

    // Update blockchain information
    metadata.blockchain = {
      ...metadata.blockchain,
      ...blockchainInfo,
      lastUpdated: new Date().toISOString()
    };

    metadata.updatedAt = new Date().toISOString();

    // Persist changes
    this.metadataCache.set(fileId, metadata);
    this.persistMetadata(fileId, metadata);

    this.emit('blockchainInfoUpdated', { fileId, blockchainInfo, metadata });

    logger.info(`Blockchain info updated for file:`, { 
      fileId, 
      transactionHash: blockchainInfo.transactionHash,
      confirmed: blockchainInfo.confirmed
    });

    return metadata;
  }

  /**
   * Persist metadata to disk
   */
  persistMetadata(fileId, metadata) {
    try {
      const filename = `${fileId}.meta.json`;
      const filepath = path.join(this.config.metadataDir, filename);
      
      fs.writeFileSync(filepath, JSON.stringify(metadata, null, 2));
      
    } catch (error) {
      logger.error(`Failed to persist metadata for ${fileId}:`, error.message);
    }
  }

  /**
   * Load metadata from disk
   */
  loadMetadataFromDisk(fileId) {
    try {
      const filename = `${fileId}.meta.json`;
      const filepath = path.join(this.config.metadataDir, filename);
      
      if (!fs.existsSync(filepath)) {
        return null;
      }

      const metadataJson = fs.readFileSync(filepath, 'utf8');
      return JSON.parse(metadataJson);
      
    } catch (error) {
      logger.error(`Failed to load metadata from disk for ${fileId}:`, error.message);
      return null;
    }
  }

  /**
   * Delete metadata
   */
  deleteMetadata(fileId) {
    // Remove from cache
    this.metadataCache.delete(fileId);
    this.versionHistory.delete(fileId);

    // Remove from disk
    try {
      const filename = `${fileId}.meta.json`;
      const filepath = path.join(this.config.metadataDir, filename);
      
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }

      this.emit('metadataDeleted', { fileId });
      
      logger.info(`Metadata deleted for file:`, { fileId });
      
      return true;

    } catch (error) {
      logger.error(`Failed to delete metadata for ${fileId}:`, error.message);
      return false;
    }
  }

  /**
   * Setup blockchain synchronization
   */
  setupBlockchainSync() {
    // Process blockchain queue every 30 seconds
    setInterval(() => {
      this.processBlockchainQueue();
    }, 30 * 1000);

    logger.info('Blockchain sync initialized');
  }

  /**
   * Queue metadata for blockchain sync
   */
  queueForBlockchainSync(fileId, metadata) {
    this.blockchainQueue.push({
      fileId,
      metadata: this.getBlockchainMetadata(fileId),
      queuedAt: Date.now(),
      attempts: 0
    });

    logger.debug(`Queued for blockchain sync:`, { fileId });
  }

  /**
   * Process blockchain sync queue
   */
  async processBlockchainQueue() {
    if (this.blockchainQueue.length === 0) {
      return;
    }

    const batchSize = 5;
    const batch = this.blockchainQueue.splice(0, batchSize);

    for (const item of batch) {
      try {
        // In production, this would interact with actual blockchain
        // For demo, simulate blockchain interaction
        await this.simulateBlockchainInteraction(item);
        
      } catch (error) {
        logger.error(`Blockchain sync failed for ${item.fileId}:`, error.message);
        
        // Retry logic
        item.attempts++;
        if (item.attempts < 3) {
          this.blockchainQueue.push(item);
        } else {
          logger.error(`Max retry attempts reached for ${item.fileId}`);
        }
      }
    }
  }

  /**
   * Simulate blockchain interaction (for demo)
   */
  async simulateBlockchainInteraction(item) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));

    // Simulate successful blockchain transaction
    const mockTransactionHash = `0x${crypto.randomBytes(32).toString('hex')}`;
    const mockBlockNumber = Math.floor(Math.random() * 1000000) + 15000000;

    this.updateBlockchainInfo(item.fileId, {
      transactionHash: mockTransactionHash,
      blockNumber: mockBlockNumber,
      gasUsed: Math.floor(Math.random() * 100000) + 21000,
      confirmed: true,
      syncedAt: new Date().toISOString()
    });

    logger.info(`Blockchain sync completed:`, { 
      fileId: item.fileId,
      transactionHash: mockTransactionHash
    });
  }

  /**
   * Get metadata statistics
   */
  getMetadataStats() {
    const stats = {
      totalFiles: this.metadataCache.size,
      totalSize: 0,
      fileTypes: {},
      categories: {},
      owners: {},
      storageProviders: {},
      recentUploads: 0
    };

    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);

    for (const metadata of this.metadataCache.values()) {
      // Total size
      stats.totalSize += metadata.file.size;

      // File types
      const fileType = metadata.file.type || 'unknown';
      stats.fileTypes[fileType] = (stats.fileTypes[fileType] || 0) + 1;

      // Categories
      const category = metadata.metadata.category || 'general';
      stats.categories[category] = (stats.categories[category] || 0) + 1;

      // Owners
      const owner = metadata.access.owner || 'anonymous';
      stats.owners[owner] = (stats.owners[owner] || 0) + 1;

      // Storage providers
      const provider = metadata.storage.primary.provider;
      stats.storageProviders[provider] = (stats.storageProviders[provider] || 0) + 1;

      // Recent uploads
      if (new Date(metadata.createdAt).getTime() > oneDayAgo) {
        stats.recentUploads++;
      }
    }

    return stats;
  }

  /**
   * Export metadata for backup
   */
  exportMetadata(options = {}) {
    const {
      fileIds = null,
      includeVersions = true,
      format = 'json'
    } = options;

    let metadataToExport;

    if (fileIds) {
      metadataToExport = fileIds.map(fileId => this.getMetadata(fileId, { includeVersions }))
                                .filter(metadata => metadata !== null);
    } else {
      metadataToExport = Array.from(this.metadataCache.values());
      
      if (includeVersions) {
        metadataToExport = metadataToExport.map(metadata => ({
          ...metadata,
          versionHistory: this.versionHistory.get(metadata.fileId) || []
        }));
      }
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      version: '1.0.0',
      totalFiles: metadataToExport.length,
      metadata: metadataToExport
    };

    if (format === 'json') {
      return JSON.stringify(exportData, null, 2);
    }

    return exportData;
  }

  /**
   * Import metadata from backup
   */
  importMetadata(importData, options = {}) {
    const {
      overwrite = false,
      validateHashes = true
    } = options;

    try {
      let data;
      
      if (typeof importData === 'string') {
        data = JSON.parse(importData);
      } else {
        data = importData;
      }

      let importedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const metadata of data.metadata) {
        try {
          const existingMetadata = this.metadataCache.get(metadata.fileId);
          
          if (existingMetadata && !overwrite) {
            skippedCount++;
            continue;
          }

          // Store metadata
          this.metadataCache.set(metadata.fileId, metadata);
          this.persistMetadata(metadata.fileId, metadata);

          // Restore version history
          if (metadata.versionHistory) {
            this.versionHistory.set(metadata.fileId, metadata.versionHistory);
          }

          importedCount++;

        } catch (error) {
          logger.error(`Failed to import metadata for ${metadata.fileId}:`, error.message);
          errorCount++;
        }
      }

      logger.info(`Metadata import completed:`, {
        imported: importedCount,
        skipped: skippedCount,
        errors: errorCount
      });

      return {
        success: true,
        imported: importedCount,
        skipped: skippedCount,
        errors: errorCount
      };

    } catch (error) {
      logger.error('Metadata import failed:', error.message);
      throw error;
    }
  }
}

export default MetadataManager;
