/**
 * Provider Manager - Intelligent Storage Routing
 * Manages multiple storage providers with fallback and optimization
 */

import { EventEmitter } from 'events';
import StorjProvider from './StorjProvider.js';
import ArweaveProvider from './ArweaveProvider.js';
import logger from '../utils/logger.js';

export class ProviderManager extends EventEmitter {
  constructor(config) {
    super();
    
    this.config = config;
    this.providers = new Map();
    this.healthStatus = new Map();
    this.uploadStrategies = new Map();
    this.failoverEnabled = true;
    
    this.initializeProviders();
    this.setupHealthMonitoring();
    this.defineUploadStrategies();
  }

  /**
   * Initialize all storage providers
   */
  initializeProviders() {
    try {
      // Initialize Storj (Primary)
      if (this.config.storj) {
        const storjProvider = new StorjProvider(this.config.storj);
        this.providers.set('storj', storjProvider);
        
        storjProvider.on('connected', () => {
          this.healthStatus.set('storj', { status: 'healthy', lastCheck: Date.now() });
          logger.info('Storj provider connected and healthy');
        });
        
        storjProvider.on('error', (error) => {
          this.healthStatus.set('storj', { status: 'unhealthy', error, lastCheck: Date.now() });
          logger.error('Storj provider error:', error.message);
        });
      }

      // Initialize Arweave (Permanent)
      if (this.config.arweave) {
        const arweaveProvider = new ArweaveProvider(this.config.arweave);
        this.providers.set('arweave', arweaveProvider);
        
        arweaveProvider.on('connected', () => {
          this.healthStatus.set('arweave', { status: 'healthy', lastCheck: Date.now() });
          logger.info('Arweave provider connected and healthy');
        });
        
        arweaveProvider.on('error', (error) => {
          this.healthStatus.set('arweave', { status: 'unhealthy', error, lastCheck: Date.now() });
          logger.error('Arweave provider error:', error.message);
        });
      }

      logger.info(`Initialized ${this.providers.size} storage providers`);

    } catch (error) {
      logger.error('Failed to initialize providers:', error.message);
      throw error;
    }
  }

  /**
   * Define intelligent upload strategies
   */
  defineUploadStrategies() {
    // Strategy for small files (< 10MB)
    this.uploadStrategies.set('small', {
      primary: 'storj',
      backup: 'arweave',
      condition: (fileSize, options) => fileSize < 10 * 1024 * 1024
    });

    // Strategy for medium files (10MB - 100MB)
    this.uploadStrategies.set('medium', {
      primary: 'storj',
      backup: null, // No backup for medium files to save Arweave space
      condition: (fileSize, options) => fileSize >= 10 * 1024 * 1024 && fileSize < 100 * 1024 * 1024
    });

    // Strategy for large files (> 100MB)
    this.uploadStrategies.set('large', {
      primary: 'storj',
      backup: null,
      condition: (fileSize, options) => fileSize >= 100 * 1024 * 1024
    });

    // Strategy for permanent files
    this.uploadStrategies.set('permanent', {
      primary: 'arweave',
      backup: 'storj',
      condition: (fileSize, options) => options.permanent === true
    });

    // Strategy for critical files
    this.uploadStrategies.set('critical', {
      primary: 'storj',
      backup: 'arweave',
      condition: (fileSize, options) => options.critical === true && fileSize < 200 * 1024 * 1024
    });
  }

  /**
   * Setup health monitoring for all providers
   */
  setupHealthMonitoring() {
    // Check provider health every 5 minutes
    setInterval(async () => {
      await this.performHealthChecks();
    }, 5 * 60 * 1000);

    // Initial health check
    setTimeout(() => this.performHealthChecks(), 5000);
  }

  /**
   * Perform health checks on all providers
   */
  async performHealthChecks() {
    const healthPromises = Array.from(this.providers.entries()).map(async ([name, provider]) => {
      try {
        const health = await provider.healthCheck();
        this.healthStatus.set(name, {
          status: health.status,
          lastCheck: Date.now(),
          details: health
        });
        return { name, health };
      } catch (error) {
        this.healthStatus.set(name, {
          status: 'unhealthy',
          error: error.message,
          lastCheck: Date.now()
        });
        return { name, error };
      }
    });

    const results = await Promise.all(healthPromises);
    
    const healthyProviders = results.filter(r => r.health?.status === 'healthy').length;
    const totalProviders = results.length;

    logger.info(`Health check completed: ${healthyProviders}/${totalProviders} providers healthy`);
    
    this.emit('healthCheck', {
      healthy: healthyProviders,
      total: totalProviders,
      results
    });
  }

  /**
   * Select optimal storage strategy based on file characteristics
   */
  selectStrategy(fileSize, options = {}) {
    for (const [strategyName, strategy] of this.uploadStrategies) {
      if (strategy.condition(fileSize, options)) {
        const primaryHealthy = this.isProviderHealthy(strategy.primary);
        const backupHealthy = strategy.backup ? this.isProviderHealthy(strategy.backup) : false;

        return {
          name: strategyName,
          primary: primaryHealthy ? strategy.primary : (backupHealthy ? strategy.backup : null),
          backup: strategy.backup && backupHealthy ? strategy.backup : null,
          primaryProvider: this.providers.get(strategy.primary),
          backupProvider: strategy.backup ? this.providers.get(strategy.backup) : null
        };
      }
    }

    // Default strategy if no match
    return {
      name: 'default',
      primary: this.getHealthiestProvider(),
      backup: null,
      primaryProvider: this.providers.get(this.getHealthiestProvider()),
      backupProvider: null
    };
  }

  /**
   * Check if provider is healthy
   */
  isProviderHealthy(providerName) {
    const health = this.healthStatus.get(providerName);
    return health && health.status === 'healthy';
  }

  /**
   * Get the healthiest available provider
   */
  getHealthiestProvider() {
    for (const [name, health] of this.healthStatus.entries()) {
      if (health.status === 'healthy') {
        return name;
      }
    }
    
    // Return first provider as fallback
    return Array.from(this.providers.keys())[0];
  }

  /**
   * Upload file with intelligent routing and fallback
   */
  async upload(filePath, options = {}) {
    const fileSize = require('fs').statSync(filePath).size;
    const strategy = this.selectStrategy(fileSize, options);

    logger.info(`Selected upload strategy: ${strategy.name}`, {
      fileSize,
      primary: strategy.primary,
      backup: strategy.backup
    });

    const results = [];
    let primaryResult = null;

    // Primary upload
    if (strategy.primaryProvider) {
      try {
        primaryResult = await strategy.primaryProvider.upload(filePath, {
          ...options,
          strategy: strategy.name
        });
        results.push(primaryResult);
        
        logger.info(`Primary upload successful (${strategy.primary}):`, {
          fileId: primaryResult.fileId,
          size: primaryResult.size
        });

      } catch (error) {
        logger.error(`Primary upload failed (${strategy.primary}):`, error.message);
        
        // Try backup provider if primary fails
        if (strategy.backupProvider && this.failoverEnabled) {
          try {
            const backupResult = await strategy.backupProvider.upload(filePath, {
              ...options,
              strategy: strategy.name + '_fallback'
            });
            results.push(backupResult);
            primaryResult = backupResult;
            
            logger.info(`Fallback upload successful (${strategy.backup}):`, {
              fileId: backupResult.fileId,
              size: backupResult.size
            });

          } catch (backupError) {
            logger.error(`Backup upload also failed (${strategy.backup}):`, backupError.message);
            throw new Error(`Both primary and backup uploads failed: ${error.message}, ${backupError.message}`);
          }
        } else {
          throw error;
        }
      }
    } else {
      throw new Error('No healthy providers available for upload');
    }

    // Backup upload (if enabled and different from primary)
    if (strategy.backupProvider && strategy.backup !== strategy.primary && options.createBackup !== false) {
      try {
        const backupResult = await strategy.backupProvider.upload(filePath, {
          ...options,
          strategy: strategy.name + '_backup',
          isBackup: true
        });
        results.push(backupResult);
        
        logger.info(`Backup upload successful (${strategy.backup}):`, {
          fileId: backupResult.fileId,
          size: backupResult.size
        });

      } catch (backupError) {
        logger.warn(`Backup upload failed (${strategy.backup}):`, backupError.message);
        // Don't fail the entire operation if backup fails
      }
    }

    const uploadResult = {
      success: true,
      primary: primaryResult,
      backups: results.filter(r => r !== primaryResult),
      strategy: strategy.name,
      totalUploads: results.length,
      fileSize,
      timestamp: new Date().toISOString()
    };

    this.emit('uploadComplete', uploadResult);
    return uploadResult;
  }

  /**
   * Download file with automatic provider selection
   */
  async download(fileId, downloadPath, options = {}) {
    // Try to find file across all providers
    const downloadAttempts = [];
    
    for (const [providerName, provider] of this.providers.entries()) {
      if (!this.isProviderHealthy(providerName)) {
        continue;
      }

      try {
        // Try to find file with different key patterns
        const possibleKeys = this.generatePossibleKeys(fileId, options);
        
        for (const key of possibleKeys) {
          try {
            const result = await provider.download(key, downloadPath, options);
            
            logger.info(`Download successful from ${providerName}:`, {
              fileId,
              key,
              size: result.size
            });

            this.emit('downloadComplete', {
              ...result,
              provider: providerName,
              fileId
            });

            return result;

          } catch (keyError) {
            // Try next key pattern
            continue;
          }
        }

      } catch (providerError) {
        downloadAttempts.push({
          provider: providerName,
          error: providerError.message
        });
        logger.warn(`Download failed from ${providerName}:`, providerError.message);
      }
    }

    // If all providers failed
    const errorMessage = `Download failed from all providers: ${downloadAttempts.map(a => `${a.provider}: ${a.error}`).join(', ')}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  /**
   * Generate possible key patterns for file lookup
   */
  generatePossibleKeys(fileId, options = {}) {
    const keys = [];
    
    // Standard patterns
    keys.push(`uploads/${fileId}`);
    keys.push(`permanent/${fileId}`);
    
    // If original filename is provided
    if (options.originalName) {
      keys.push(`uploads/${fileId}-${options.originalName}`);
      keys.push(`permanent/${fileId}-${options.originalName}`);
    }

    // Pattern with timestamp prefix (common pattern)
    keys.push(`uploads/${fileId.split('-')[0]}-${fileId}`);
    keys.push(`permanent/${fileId.split('-')[0]}-${fileId}`);

    return [...new Set(keys)]; // Remove duplicates
  }

  /**
   * List files across all providers
   */
  async listFiles(options = {}) {
    const allFiles = [];
    const providerResults = [];

    for (const [providerName, provider] of this.providers.entries()) {
      if (!this.isProviderHealthy(providerName)) {
        continue;
      }

      try {
        const result = await provider.list(options.prefix, options.maxKeys);
        
        providerResults.push({
          provider: providerName,
          success: true,
          fileCount: result.files.length,
          files: result.files.map(file => ({
            ...file,
            provider: providerName
          }))
        });

        allFiles.push(...result.files.map(file => ({
          ...file,
          provider: providerName
        })));

      } catch (error) {
        providerResults.push({
          provider: providerName,
          success: false,
          error: error.message
        });
      }
    }

    return {
      success: true,
      totalFiles: allFiles.length,
      files: allFiles,
      providers: providerResults
    };
  }

  /**
   * Get comprehensive usage statistics
   */
  async getUsageStats() {
    const stats = {
      timestamp: new Date().toISOString(),
      providers: [],
      totals: {
        files: 0,
        size: 0,
        healthy: 0,
        total: this.providers.size
      }
    };

    for (const [providerName, provider] of this.providers.entries()) {
      try {
        const providerStats = await provider.getUsageStats();
        stats.providers.push(providerStats);
        
        if (providerStats.connected) {
          stats.totals.files += providerStats.totalFiles || 0;
          stats.totals.size += providerStats.totalSize || 0;
          stats.totals.healthy++;
        }

      } catch (error) {
        stats.providers.push({
          provider: providerName,
          error: error.message,
          connected: false
        });
      }
    }

    return stats;
  }

  /**
   * Delete file from all providers
   */
  async deleteFile(fileId, options = {}) {
    const deleteResults = [];
    const possibleKeys = this.generatePossibleKeys(fileId, options);

    for (const [providerName, provider] of this.providers.entries()) {
      if (!this.isProviderHealthy(providerName)) {
        continue;
      }

      for (const key of possibleKeys) {
        try {
          await provider.delete(key);
          deleteResults.push({
            provider: providerName,
            key,
            success: true
          });
          
          logger.info(`File deleted from ${providerName}:`, { fileId, key });
          break; // Move to next provider after successful deletion

        } catch (error) {
          // Try next key pattern
          continue;
        }
      }
    }

    if (deleteResults.length === 0) {
      throw new Error(`File ${fileId} not found in any provider`);
    }

    return {
      success: true,
      fileId,
      deletions: deleteResults
    };
  }

  /**
   * Get provider by name
   */
  getProvider(name) {
    return this.providers.get(name);
  }

  /**
   * Get all provider names
   */
  getProviderNames() {
    return Array.from(this.providers.keys());
  }

  /**
   * Get health status of all providers
   */
  getHealthStatus() {
    const status = {};
    
    for (const [name, health] of this.healthStatus.entries()) {
      status[name] = {
        ...health,
        provider: this.providers.get(name)?.name || name
      };
    }

    return status;
  }
}

export default ProviderManager;
