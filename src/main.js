/**
 * Main Application - Express Server with File Storage API
 * Production-ready server with comprehensive error handling and monitoring
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Import core modules
import ProviderManager from './providers/ProviderManager.js';
import FileProcessor from './core/FileProcessor.js';
import SecurityManager from './core/SecurityManager.js';
import MetadataManager from './core/MetadataManager.js';
import PerformanceMonitor from './core/PerformanceMonitor.js';

// Import utilities
import logger from './utils/logger.js';
import { validateFile, sanitizeFilename } from './utils/validation.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BlockchainFileStorageServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    
    // Initialize core components
    this.initializeComponents();
    
    // Setup middleware
    this.setupMiddleware();
    
    // Setup routes
    this.setupRoutes();
    
    // Setup error handling
    this.setupErrorHandling();
    
    // Initialize upload handling
    this.setupFileUpload();
  }

  /**
   * Initialize all core components
   */
  initializeComponents() {
    try {
      // Load configuration
      this.config = this.loadConfiguration();
      
      // Initialize Provider Manager
      this.providerManager = new ProviderManager({
        storj: {
          accessKey: process.env.STORJ_ACCESS_KEY,
          secretKey: process.env.STORJ_SECRET_KEY,
          bucket: process.env.STORJ_BUCKET,
          endpoint: process.env.STORJ_ENDPOINT
        },
        arweave: {
          accessKey: process.env.ARWEAVE_ACCESS_KEY,
          secretKey: process.env.ARWEAVE_SECRET_KEY,
          bucket: process.env.ARWEAVE_BUCKET,
          endpoint: process.env.ARWEAVE_ENDPOINT
        }
      });

      // Initialize File Processor
      this.fileProcessor = new FileProcessor({
        maxFileSize: parseInt(process.env.UPLOAD_SIZE_LIMIT) || 1024 * 1024 * 1024,
        chunkSize: parseInt(process.env.CHUNK_SIZE) || 50 * 1024 * 1024,
        tempDir: './temp',
        enableCompression: true,
        enableEncryption: true,
        enableDeduplication: true
      });

      // Initialize Security Manager
      this.securityManager = new SecurityManager({
        jwtSecret: process.env.JWT_SECRET,
        encryptionKey: process.env.ENCRYPTION_KEY
      });

      // Initialize Metadata Manager
      this.metadataManager = new MetadataManager({
        metadataDir: './metadata',
        enableBlockchainSync: true,
        enableVersioning: true
      });

      // Initialize Performance Monitor
      this.performanceMonitor = new PerformanceMonitor({
        monitoringInterval: 60000,
        historyLimit: 1000
      });

      // Setup event listeners
      this.setupEventListeners();

      logger.info('All core components initialized successfully');

    } catch (error) {
      logger.error('Failed to initialize core components:', error.message);
      process.exit(1);
    }
  }

  /**
   * Load application configuration
   */
  loadConfiguration() {
    try {
      const configPath = path.join(__dirname, '../config');
      
      // Load provider configuration
      const providersConfig = JSON.parse(
        fs.readFileSync(path.join(configPath, 'providers.json'), 'utf8')
      );
      
      // Load security configuration
      const securityConfig = JSON.parse(
        fs.readFileSync(path.join(configPath, 'security.json'), 'utf8')
      );

      return {
        providers: providersConfig,
        security: securityConfig,
        app: {
          name: 'Blockchain File Storage Demo',
          version: '1.0.0',
          environment: process.env.NODE_ENV || 'development'
        }
      };

    } catch (error) {
      logger.warn('Could not load configuration files, using defaults:', error.message);
      return {
        providers: {},
        security: {},
        app: {
          name: 'Blockchain File Storage Demo',
          version: '1.0.0',
          environment: process.env.NODE_ENV || 'development'
        }
      };
    }
  }

  /**
   * Setup middleware
   */
  setupMiddleware() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"]
        }
      }
    }));

    // CORS
    this.app.use(cors({
      origin: process.env.NODE_ENV === 'production' ? false : true,
      credentials: true
    }));

    // Request logging
    this.app.use(morgan('combined', {
      stream: {
        write: (message) => logger.info('HTTP Request:', message.trim())
      }
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Static files
    this.app.use(express.static(path.join(__dirname, '../public')));

    // Rate limiting middleware
    this.app.use('/api', (req, res, next) => {
      const clientId = req.ip || 'unknown';
      const rateLimit = this.securityManager.checkRateLimit(clientId, 'api');
      
      if (!rateLimit.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: rateLimit.retryAfter
        });
      }

      res.set('X-RateLimit-Remaining', rateLimit.remaining);
      next();
    });

    logger.info('Middleware setup completed');
  }

  /**
   * Setup file upload handling
   */
  setupFileUpload() {
    // Ensure temp directory exists
    const tempDir = './temp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Configure multer for file uploads
    this.upload = multer({
      dest: tempDir,
      limits: {
        fileSize: parseInt(process.env.UPLOAD_SIZE_LIMIT) || 1024 * 1024 * 1024, // 1GB
        files: 10 // Max 10 files per request
      },
      fileFilter: (req, file, cb) => {
        // Basic file validation
        const sanitizedName = sanitizeFilename(file.originalname);
        file.originalname = sanitizedName;
        cb(null, true);
      }
    });
  }

  /**
   * Setup event listeners for components
   */
  setupEventListeners() {
    // Provider Manager events
    this.providerManager.on('uploadComplete', (result) => {
      this.performanceMonitor.recordUpload(result);
      logger.upload('Upload completed', result);
    });

    this.providerManager.on('downloadComplete', (result) => {
      this.performanceMonitor.recordDownload(result);
      logger.download('Download completed', result);
    });

    // File Processor events
    this.fileProcessor.on('processingComplete', (result) => {
      logger.info('File processing completed', {
        processingId: result.processingId,
        originalSize: result.processing.originalSize,
        finalSize: result.processing.finalSize
      });
    });

    // Security Manager events
    this.securityManager.on('securityEvent', (event) => {
      logger.security('Security event detected', event);
    });

    // Performance Monitor events
    this.performanceMonitor.on('performanceAlert', (alert) => {
      logger.warn('Performance alert', alert);
    });

    this.performanceMonitor.on('systemAlert', (alert) => {
      logger.warn('System alert', alert);
    });
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: this.config.app.version,
        uptime: process.uptime()
      });
    });

    // System status
    this.app.get('/api/status', async (req, res) => {
      try {
        const providerHealth = this.providerManager.getHealthStatus();
        const performanceStats = this.performanceMonitor.getPerformanceStats();
        const usageStats = await this.providerManager.getUsageStats();

        res.json({
          status: 'operational',
          providers: providerHealth,
          performance: performanceStats,
          usage: usageStats,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('Status check failed:', error.message);
        res.status(500).json({
          error: 'Status check failed',
          message: error.message
        });
      }
    });

    // File upload endpoint
    this.app.post('/api/upload', this.upload.array('files', 10), async (req, res) => {
      try {
        if (!req.files || req.files.length === 0) {
          return res.status(400).json({
            error: 'No files uploaded',
            message: 'Please select at least one file to upload'
          });
        }

        const uploadResults = [];
        const userInfo = {
          userId: req.body.userId || 'anonymous',
          permissions: ['upload', 'read'],
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        };

        for (const file of req.files) {
          try {
            logger.info(`Processing upload: ${file.originalname}`, {
              size: file.size,
              mimetype: file.mimetype
            });

            // Validate file
            const validation = await validateFile(file.path, {
              maxSize: parseInt(process.env.UPLOAD_SIZE_LIMIT),
              allowedTypes: ['*'] // Allow all for demo
            });

            if (!validation.valid) {
              uploadResults.push({
                filename: file.originalname,
                success: false,
                error: validation.errors.join(', ')
              });
              continue;
            }

            // Process file
            const processingResult = await this.fileProcessor.processFile(file.path, {
              originalName: file.originalname,
              permanent: req.body.permanent === 'true',
              critical: req.body.critical === 'true',
              encryptionKey: req.body.encryptionKey,
              compress: req.body.compress !== 'false'
            });

            // Upload to storage providers
            const uploadResult = await this.providerManager.upload(
              processingResult.processedPath || file.path,
              {
                originalName: file.originalname,
                permanent: req.body.permanent === 'true',
                critical: req.body.critical === 'true',
                userId: userInfo.userId
              }
            );

            // Create metadata
            const metadata = this.metadataManager.createMetadata(
              {
                fileId: uploadResult.primary.fileId,
                originalName: file.originalname,
                path: file.path,
                size: file.size,
                type: file.mimetype,
                hash: uploadResult.primary.hash
              },
              uploadResult,
              processingResult,
              userInfo
            );

            // Cleanup temporary files
            await this.fileProcessor.cleanup(processingResult.processingId);
            fs.unlinkSync(file.path);

            uploadResults.push({
              filename: file.originalname,
              success: true,
              fileId: uploadResult.primary.fileId,
              size: file.size,
              hash: uploadResult.primary.hash,
              providers: uploadResult.totalUploads,
              permanent: uploadResult.primary.permanent || false,
              metadata: {
                compressed: processingResult.processing?.compressed || false,
                encrypted: processingResult.processing?.encrypted || false,
                chunked: processingResult.processing?.chunked || false
              }
            });

            logger.upload('File uploaded successfully', {
              fileId: uploadResult.primary.fileId,
              filename: file.originalname,
              size: file.size
            });

          } catch (fileError) {
            logger.error(`Upload failed for ${file.originalname}:`, fileError.message);
            uploadResults.push({
              filename: file.originalname,
              success: false,
              error: fileError.message
            });

            // Cleanup on error
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          }
        }

        res.json({
          success: true,
          message: `Processed ${req.files.length} file(s)`,
          results: uploadResults,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('Upload endpoint error:', error.message);
        res.status(500).json({
          error: 'Upload failed',
          message: error.message
        });
      }
    });

    // File download endpoint
    this.app.get('/api/download/:fileId', async (req, res) => {
      try {
        const { fileId } = req.params;
        const userInfo = {
          userId: req.query.userId || 'anonymous',
          ipAddress: req.ip
        };

        logger.info(`Download requested: ${fileId}`, userInfo);

        // Get file metadata
        const metadata = this.metadataManager.getMetadata(fileId);
        if (!metadata) {
          return res.status(404).json({
            error: 'File not found',
            fileId
          });
        }

        // Create temporary download path
        const downloadPath = path.join('./temp', `download_${fileId}_${Date.now()}`);

        // Download from storage providers
        const downloadResult = await this.providerManager.download(
          fileId,
          downloadPath,
          {
            originalName: metadata.file.originalName,
            strictIntegrity: true
          }
        );

        // Update access statistics
        this.metadataManager.updateAccessStats(fileId, 'download', userInfo);

        // Set response headers
        res.setHeader('Content-Disposition', 
          `attachment; filename="${metadata.file.originalName}"`);
        res.setHeader('Content-Type', metadata.file.type || 'application/octet-stream');
        res.setHeader('Content-Length', metadata.file.size);
        res.setHeader('X-File-Hash', metadata.file.hash);

        // Stream file to client
        const fileStream = fs.createReadStream(downloadPath);
        
        fileStream.on('end', () => {
          // Cleanup temporary file
          if (fs.existsSync(downloadPath)) {
            fs.unlinkSync(downloadPath);
          }
        });

        fileStream.on('error', (error) => {
          logger.error(`Download stream error for ${fileId}:`, error.message);
          if (!res.headersSent) {
            res.status(500).json({ error: 'Download failed' });
          }
        });

        fileStream.pipe(res);

        logger.download('File download started', {
          fileId,
          filename: metadata.file.originalName,
          size: metadata.file.size
        });

      } catch (error) {
        logger.error('Download endpoint error:', error.message);
        res.status(500).json({
          error: 'Download failed',
          message: error.message
        });
      }
    });

    // List files endpoint
    this.app.get('/api/files', async (req, res) => {
      try {
        const {
          search = '',
          limit = 50,
          offset = 0,
          sortBy = 'updatedAt',
          sortOrder = 'desc',
          category,
          owner,
          fileType
        } = req.query;

        const searchResult = this.metadataManager.searchMetadata(search, {
          limit: parseInt(limit),
          offset: parseInt(offset),
          sortBy,
          sortOrder,
          filters: {
            category,
            owner,
            fileType
          }
        });

        res.json({
          success: true,
          files: searchResult.results,
          total: searchResult.total,
          limit: searchResult.limit,
          offset: searchResult.offset,
          hasMore: searchResult.hasMore
        });

      } catch (error) {
        logger.error('List files error:', error.message);
        res.status(500).json({
          error: 'Failed to list files',
          message: error.message
        });
      }
    });

    // File metadata endpoint
    this.app.get('/api/files/:fileId/metadata', (req, res) => {
      try {
        const { fileId } = req.params;
        const metadata = this.metadataManager.getMetadata(fileId, {
          includeVersions: req.query.versions === 'true'
        });

        if (!metadata) {
          return res.status(404).json({
            error: 'File not found',
            fileId
          });
        }

        res.json({
          success: true,
          metadata
        });

      } catch (error) {
        logger.error('Metadata endpoint error:', error.message);
        res.status(500).json({
          error: 'Failed to get metadata',
          message: error.message
        });
      }
    });

    // Delete file endpoint
    this.app.delete('/api/files/:fileId', async (req, res) => {
      try {
        const { fileId } = req.params;
        const userInfo = {
          userId: req.body.userId || 'anonymous'
        };

        logger.info(`Delete requested: ${fileId}`, userInfo);

        // Delete from storage providers
        const deleteResult = await this.providerManager.deleteFile(fileId);

        // Delete metadata
        this.metadataManager.deleteMetadata(fileId);

        res.json({
          success: true,
          message: 'File deleted successfully',
          fileId,
          deletions: deleteResult.deletions
        });

      } catch (error) {
        logger.error('Delete endpoint error:', error.message);
        res.status(500).json({
          error: 'Delete failed',
          message: error.message
        });
      }
    });

    // Performance metrics endpoint
    this.app.get('/api/metrics', (req, res) => {
      try {
        const stats = this.performanceMonitor.getPerformanceStats();
        res.json({
          success: true,
          metrics: stats,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        logger.error('Metrics endpoint error:', error.message);
        res.status(500).json({
          error: 'Failed to get metrics',
          message: error.message
        });
      }
    });

    logger.info('API routes setup completed');
  }

  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // Handle 404
    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`
      });
    });

    // Global error handler
    this.app.use((err, req, res, next) => {
      logger.error('Unhandled error:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method
      });

      // Don't leak error details in production
      const isDevelopment = process.env.NODE_ENV !== 'production';

      res.status(err.status || 500).json({
        error: 'Internal Server Error',
        message: isDevelopment ? err.message : 'Something went wrong',
        ...(isDevelopment && { stack: err.stack })
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully');
      this.performanceMonitor.stopMonitoring();
      process.exit(0);
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully');
      this.performanceMonitor.stopMonitoring();
      process.exit(0);
    });
  }

  /**
   * Start the server
   */
  async start() {
    try {
      // Wait for providers to be ready
      await this.waitForProviders();

      this.server = this.app.listen(this.port, () => {
        logger.info(`🚀 Blockchain File Storage Demo started`, {
          port: this.port,
          environment: process.env.NODE_ENV || 'development',
          version: this.config.app.version
        });

        logger.info('📊 Server Status:', {
          providers: Object.keys(this.providerManager.getHealthStatus()),
          endpoints: [
            'GET /api/health - Health check',
            'GET /api/status - System status',
            'POST /api/upload - Upload files',
            'GET /api/download/:fileId - Download file',
            'GET /api/files - List files',
            'GET /api/files/:fileId/metadata - Get metadata',
            'DELETE /api/files/:fileId - Delete file',
            'GET /api/metrics - Performance metrics',
            'GET / - Demo interface'
          ]
        });
      });

    } catch (error) {
      logger.error('Failed to start server:', error.message);
      process.exit(1);
    }
  }

  /**
   * Wait for providers to be ready
   */
  async waitForProviders() {
    return new Promise((resolve) => {
      let readyProviders = 0;
      const totalProviders = this.providerManager.getProviderNames().length;

      if (totalProviders === 0) {
        logger.warn('No storage providers configured');
        resolve();
        return;
      }

      const checkReady = () => {
        const healthStatus = this.providerManager.getHealthStatus();
        const healthy = Object.values(healthStatus).filter(status => status.status === 'healthy').length;

        if (healthy > 0) {
          logger.info(`${healthy}/${totalProviders} storage providers ready`);
          resolve();
        } else {
          setTimeout(checkReady, 1000);
        }
      };

      checkReady();
    });
  }
}

// Start the server
const server = new BlockchainFileStorageServer();
server.start().catch(error => {
  logger.error('Server startup failed:', error);
  process.exit(1);
});

export default BlockchainFileStorageServer;
