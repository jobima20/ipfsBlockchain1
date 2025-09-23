/**
 * Performance Monitor - Real-time Performance Tracking
 * Monitors upload/download speeds, resource usage, and system performance
 */

import { EventEmitter } from 'events';
import os from 'os';
import logger from '../utils/logger.js';

export class PerformanceMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      monitoringInterval: config.monitoringInterval || 60000, // 1 minute
      historyLimit: config.historyLimit || 1000,
      alertThresholds: {
        cpuUsage: config.cpuThreshold || 80,
        memoryUsage: config.memoryThreshold || 85,
        diskUsage: config.diskThreshold || 90,
        responseTime: config.responseTimeThreshold || 5000,
        errorRate: config.errorRateThreshold || 5
      },
      ...config
    };

    // Performance data storage
    this.metrics = {
      uploads: [],
      downloads: [],
      systemStats: [],
      errors: [],
      providers: new Map()
    };

    this.currentStats = {
      totalUploads: 0,
      totalDownloads: 0,
      totalErrors: 0,
      totalDataTransferred: 0,
      averageUploadSpeed: 0,
      averageDownloadSpeed: 0,
      uptime: Date.now()
    };

    this.startMonitoring();
  }

  /**
   * Start system monitoring
   */
  startMonitoring() {
    // Monitor system resources
    this.systemMonitorInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, this.config.monitoringInterval);

    // Calculate performance metrics every 5 minutes
    this.metricsCalculationInterval = setInterval(() => {
      this.calculatePerformanceMetrics();
    }, 5 * 60 * 1000);

    // Clean up old metrics every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldMetrics();
    }, 60 * 60 * 1000);

    logger.info('Performance monitoring started');
    this.emit('monitoringStarted');
  }

  /**
   * Record upload performance
   */
  recordUpload(uploadData) {
    const timestamp = Date.now();
    const metric = {
      timestamp,
      fileId: uploadData.fileId || uploadData.primary?.fileId,
      fileName: uploadData.fileName || uploadData.primary?.metadata?.originalName,
      fileSize: uploadData.fileSize || uploadData.primary?.size,
      provider: uploadData.provider || uploadData.primary?.provider,
      uploadTime: uploadData.uploadTime || uploadData.primary?.uploadTime,
      speed: uploadData.speed || uploadData.primary?.speed,
      success: uploadData.success !== false,
      strategy: uploadData.strategy,
      backupCount: uploadData.backups ? uploadData.backups.length : 0,
      chunks: uploadData.chunks || 0,
      compressed: uploadData.compressed || false,
      encrypted: uploadData.encrypted || false
    };

    // Calculate speed if not provided
    if (!metric.speed && metric.fileSize && metric.uploadTime) {
      metric.speed = (metric.fileSize / metric.uploadTime * 1000).toFixed(2);
    }

    this.metrics.uploads.push(metric);
    this.currentStats.totalUploads++;
    
    if (metric.success) {
      this.currentStats.totalDataTransferred += metric.fileSize;
    }

    // Update provider stats
    if (metric.provider) {
      this.updateProviderStats(metric.provider, 'upload', metric);
    }

    // Check for performance issues
    this.checkPerformanceAlerts('upload', metric);

    this.emit('uploadRecorded', metric);
    
    logger.debug('Upload performance recorded:', {
      fileId: metric.fileId,
      size: metric.fileSize,
      speed: metric.speed,
      provider: metric.provider
    });
  }

  /**
   * Record download performance
   */
  recordDownload(downloadData) {
    const timestamp = Date.now();
    const metric = {
      timestamp,
      fileId: downloadData.fileId,
      fileName: downloadData.fileName || downloadData.metadata?.originalName,
      fileSize: downloadData.size,
      provider: downloadData.provider,
      downloadTime: downloadData.downloadTime,
      speed: downloadData.speed,
      success: downloadData.success !== false,
      integrity: downloadData.integrity,
      cached: downloadData.cached || false,
      chunks: downloadData.chunks || 0
    };

    // Calculate speed if not provided
    if (!metric.speed && metric.fileSize && metric.downloadTime) {
      metric.speed = (metric.fileSize / metric.downloadTime * 1000).toFixed(2);
    }

    this.metrics.downloads.push(metric);
    this.currentStats.totalDownloads++;

    if (metric.success) {
      this.currentStats.totalDataTransferred += metric.fileSize;
    }

    // Update provider stats
    if (metric.provider) {
      this.updateProviderStats(metric.provider, 'download', metric);
    }

    // Check for performance issues
    this.checkPerformanceAlerts('download', metric);

    this.emit('downloadRecorded', metric);
    
    logger.debug('Download performance recorded:', {
      fileId: metric.fileId,
      size: metric.fileSize,
      speed: metric.speed,
      provider: metric.provider
    });
  }

  /**
   * Record error
   */
  recordError(errorData) {
    const timestamp = Date.now();
    const metric = {
      timestamp,
      operation: errorData.operation,
      error: errorData.error,
      provider: errorData.provider,
      fileId: errorData.fileId,
      duration: errorData.duration,
      retryCount: errorData.retryCount || 0,
      fatal: errorData.fatal || false
    };

    this.metrics.errors.push(metric);
    this.currentStats.totalErrors++;

    // Update provider error stats
    if (metric.provider) {
      this.updateProviderStats(metric.provider, 'error', metric);
    }

    this.emit('errorRecorded', metric);
    
    logger.warn('Error recorded:', {
      operation: metric.operation,
      error: metric.error,
      provider: metric.provider
    });
  }

  /**
   * Update provider-specific statistics
   */
  updateProviderStats(providerName, operation, metric) {
    if (!this.metrics.providers.has(providerName)) {
      this.metrics.providers.set(providerName, {
        name: providerName,
        uploads: { count: 0, totalSize: 0, totalTime: 0, errors: 0 },
        downloads: { count: 0, totalSize: 0, totalTime: 0, errors: 0 },
        lastActivity: timestamp,
        uptime: 0,
        responseTime: []
      });
    }

    const providerStats = this.metrics.providers.get(providerName);
    const timestamp = Date.now();

    providerStats.lastActivity = timestamp;

    if (operation === 'upload' && metric.success) {
      providerStats.uploads.count++;
      providerStats.uploads.totalSize += metric.fileSize;
      providerStats.uploads.totalTime += metric.uploadTime;
      providerStats.responseTime.push(metric.uploadTime);
    } else if (operation === 'download' && metric.success) {
      providerStats.downloads.count++;
      providerStats.downloads.totalSize += metric.fileSize;
      providerStats.downloads.totalTime += metric.downloadTime;
      providerStats.responseTime.push(metric.downloadTime);
    } else if (operation === 'error') {
      if (metric.operation === 'upload') {
        providerStats.uploads.errors++;
      } else if (metric.operation === 'download') {
        providerStats.downloads.errors++;
      }
    }

    // Keep only recent response times (last 100)
    if (providerStats.responseTime.length > 100) {
      providerStats.responseTime.splice(0, providerStats.responseTime.length - 100);
    }
  }

  /**
   * Collect system metrics
   */
  collectSystemMetrics() {
    const timestamp = Date.now();
    
    try {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const loadAvg = os.loadavg();

      const systemMetric = {
        timestamp,
        cpu: {
          count: cpus.length,
          model: cpus[0].model,
          usage: this.calculateCpuUsage(),
          loadAverage: {
            '1min': loadAvg[0],
            '5min': loadAvg[1],
            '15min': loadAvg[2]
          }
        },
        memory: {
          total: totalMem,
          free: freeMem,
          used: totalMem - freeMem,
          usage: ((totalMem - freeMem) / totalMem * 100).toFixed(2)
        },
        uptime: os.uptime(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        processUptime: process.uptime(),
        processMemory: process.memoryUsage()
      };

      this.metrics.systemStats.push(systemMetric);

      // Check for system alerts
      this.checkSystemAlerts(systemMetric);

      this.emit('systemMetricsCollected', systemMetric);

    } catch (error) {
      logger.error('Failed to collect system metrics:', error.message);
    }
  }

  /**
   * Calculate CPU usage
   */
  calculateCpuUsage() {
    // This is a simplified CPU usage calculation
    // In production, you might want to use a more accurate method
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (let type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - ~~(100 * idle / total);

    return usage;
  }

  /**
   * Calculate performance metrics
   */
  calculatePerformanceMetrics() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    // Recent uploads
    const recentUploads = this.metrics.uploads.filter(u => u.timestamp > oneHourAgo);
    const recentDownloads = this.metrics.downloads.filter(d => d.timestamp > oneHourAgo);
    const recentErrors = this.metrics.errors.filter(e => e.timestamp > oneHourAgo);

    // Calculate average speeds
    if (recentUploads.length > 0) {
      const totalUploadSpeed = recentUploads.reduce((sum, upload) => sum + parseFloat(upload.speed || 0), 0);
      this.currentStats.averageUploadSpeed = (totalUploadSpeed / recentUploads.length).toFixed(2);
    }

    if (recentDownloads.length > 0) {
      const totalDownloadSpeed = recentDownloads.reduce((sum, download) => sum + parseFloat(download.speed || 0), 0);
      this.currentStats.averageDownloadSpeed = (totalDownloadSpeed / recentDownloads.length).toFixed(2);
    }

    // Calculate error rates
    const totalRecentOperations = recentUploads.length + recentDownloads.length;
    const errorRate = totalRecentOperations > 0 ? (recentErrors.length / totalRecentOperations * 100).toFixed(2) : 0;

    const performanceMetrics = {
      timestamp: now,
      period: '1hour',
      uploads: recentUploads.length,
      downloads: recentDownloads.length,
      errors: recentErrors.length,
      errorRate: parseFloat(errorRate),
      averageUploadSpeed: parseFloat(this.currentStats.averageUploadSpeed),
      averageDownloadSpeed: parseFloat(this.currentStats.averageDownloadSpeed),
      totalDataTransferred: this.currentStats.totalDataTransferred,
      uptime: now - this.currentStats.uptime
    };

    this.emit('performanceMetricsCalculated', performanceMetrics);
    
    logger.info('Performance metrics calculated:', performanceMetrics);
  }

  /**
   * Check for performance alerts
   */
  checkPerformanceAlerts(operation, metric) {
    const alerts = [];

    // Check upload/download speed
    if (operation === 'upload' && metric.speed < 1000000) { // Less than 1MB/s
      alerts.push({
        type: 'slow_upload',
        message: `Slow upload speed detected: ${metric.speed} bytes/s`,
        metric
      });
    }

    if (operation === 'download' && metric.speed < 2000000) { // Less than 2MB/s
      alerts.push({
        type: 'slow_download',
        message: `Slow download speed detected: ${metric.speed} bytes/s`,
        metric
      });
    }

    // Check upload/download time
    const timeThreshold = metric.fileSize > 100 * 1024 * 1024 ? 30000 : 10000; // 30s for large files, 10s for others
    const operationTime = operation === 'upload' ? metric.uploadTime : metric.downloadTime;

    if (operationTime > timeThreshold) {
      alerts.push({
        type: `slow_${operation}`,
        message: `${operation} took longer than expected: ${operationTime}ms`,
        metric
      });
    }

    // Emit alerts
    alerts.forEach(alert => {
      this.emit('performanceAlert', alert);
      logger.warn('Performance alert:', alert);
    });
  }

  /**
   * Check for system alerts
   */
  checkSystemAlerts(systemMetric) {
    const alerts = [];

    // CPU usage alert
    if (systemMetric.cpu.usage > this.config.alertThresholds.cpuUsage) {
      alerts.push({
        type: 'high_cpu_usage',
        message: `High CPU usage: ${systemMetric.cpu.usage}%`,
        value: systemMetric.cpu.usage,
        threshold: this.config.alertThresholds.cpuUsage
      });
    }

    // Memory usage alert
    if (parseFloat(systemMetric.memory.usage) > this.config.alertThresholds.memoryUsage) {
      alerts.push({
        type: 'high_memory_usage',
        message: `High memory usage: ${systemMetric.memory.usage}%`,
        value: parseFloat(systemMetric.memory.usage),
        threshold: this.config.alertThresholds.memoryUsage
      });
    }

    // Emit alerts
    alerts.forEach(alert => {
      this.emit('systemAlert', alert);
      logger.warn('System alert:', alert);
    });
  }

  /**
   * Get current performance statistics
   */
  getPerformanceStats() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const oneDayAgo = now - (24 * 60 * 60 * 1000);

    // Recent metrics
    const recentUploads = this.metrics.uploads.filter(u => u.timestamp > oneHourAgo);
    const recentDownloads = this.metrics.downloads.filter(d => d.timestamp > oneHourAgo);
    const recentErrors = this.metrics.errors.filter(e => e.timestamp > oneHourAgo);

    // Daily metrics
    const dailyUploads = this.metrics.uploads.filter(u => u.timestamp > oneDayAgo);
    const dailyDownloads = this.metrics.downloads.filter(d => d.timestamp > oneDayAgo);

    // Provider performance
    const providerStats = {};
    for (const [name, stats] of this.metrics.providers.entries()) {
      const avgResponseTime = stats.responseTime.length > 0 ? 
        stats.responseTime.reduce((sum, time) => sum + time, 0) / stats.responseTime.length : 0;

      providerStats[name] = {
        name: stats.name,
        uploads: stats.uploads.count,
        downloads: stats.downloads.count,
        totalData: stats.uploads.totalSize + stats.downloads.totalSize,
        avgUploadSpeed: stats.uploads.count > 0 ? 
          (stats.uploads.totalSize / stats.uploads.totalTime * 1000).toFixed(2) : 0,
        avgDownloadSpeed: stats.downloads.count > 0 ? 
          (stats.downloads.totalSize / stats.downloads.totalTime * 1000).toFixed(2) : 0,
        avgResponseTime: avgResponseTime.toFixed(2),
        errorRate: ((stats.uploads.errors + stats.downloads.errors) / 
                   Math.max(stats.uploads.count + stats.downloads.count, 1) * 100).toFixed(2),
        lastActivity: stats.lastActivity
      };
    }

    return {
      current: {
        ...this.currentStats,
        uptime: now - this.currentStats.uptime
      },
      recent: {
        uploads: recentUploads.length,
        downloads: recentDownloads.length,
        errors: recentErrors.length,
        errorRate: ((recentUploads.length + recentDownloads.length) > 0 ? 
          (recentErrors.length / (recentUploads.length + recentDownloads.length) * 100).toFixed(2) : 0),
        avgUploadSpeed: recentUploads.length > 0 ? 
          (recentUploads.reduce((sum, u) => sum + parseFloat(u.speed || 0), 0) / recentUploads.length).toFixed(2) : 0,
        avgDownloadSpeed: recentDownloads.length > 0 ? 
          (recentDownloads.reduce((sum, d) => sum + parseFloat(d.speed || 0), 0) / recentDownloads.length).toFixed(2) : 0
      },
      daily: {
        uploads: dailyUploads.length,
        downloads: dailyDownloads.length,
        totalData: dailyUploads.reduce((sum, u) => sum + u.fileSize, 0) + 
                  dailyDownloads.reduce((sum, d) => sum + d.fileSize, 0)
      },
      providers: providerStats,
      system: this.metrics.systemStats.length > 0 ? 
        this.metrics.systemStats[this.metrics.systemStats.length - 1] : null
    };
  }

  /**
   * Get detailed metrics for specific time period
   */
  getDetailedMetrics(startTime, endTime) {
    const uploads = this.metrics.uploads.filter(u => 
      u.timestamp >= startTime && u.timestamp <= endTime
    );

    const downloads = this.metrics.downloads.filter(d => 
      d.timestamp >= startTime && d.timestamp <= endTime
    );

    const errors = this.metrics.errors.filter(e => 
      e.timestamp >= startTime && e.timestamp <= endTime
    );

    const systemStats = this.metrics.systemStats.filter(s => 
      s.timestamp >= startTime && s.timestamp <= endTime
    );

    return {
      period: {
        start: new Date(startTime).toISOString(),
        end: new Date(endTime).toISOString(),
        duration: endTime - startTime
      },
      uploads,
      downloads,
      errors,
      systemStats,
      summary: {
        totalUploads: uploads.length,
        totalDownloads: downloads.length,
        totalErrors: errors.length,
        totalDataTransferred: uploads.reduce((sum, u) => sum + u.fileSize, 0) + 
                            downloads.reduce((sum, d) => sum + d.fileSize, 0),
        avgUploadSpeed: uploads.length > 0 ? 
          (uploads.reduce((sum, u) => sum + parseFloat(u.speed || 0), 0) / uploads.length).toFixed(2) : 0,
        avgDownloadSpeed: downloads.length > 0 ? 
          (downloads.reduce((sum, d) => sum + parseFloat(d.speed || 0), 0) / downloads.length).toFixed(2) : 0,
        errorRate: ((uploads.length + downloads.length) > 0 ? 
          (errors.length / (uploads.length + downloads.length) * 100).toFixed(2) : 0)
      }
    };
  }

  /**
   * Clean up old metrics
   */
  cleanupOldMetrics() {
    const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days

    // Clean up old metrics
    this.metrics.uploads = this.metrics.uploads.filter(u => u.timestamp > cutoffTime);
    this.metrics.downloads = this.metrics.downloads.filter(d => d.timestamp > cutoffTime);
    this.metrics.errors = this.metrics.errors.filter(e => e.timestamp > cutoffTime);
    this.metrics.systemStats = this.metrics.systemStats.filter(s => s.timestamp > cutoffTime);

    logger.info('Old performance metrics cleaned up');
  }

  /**
   * Export performance data
   */
  exportMetrics(options = {}) {
    const {
      startTime = Date.now() - (24 * 60 * 60 * 1000),
      endTime = Date.now(),
      includeSystemStats = true,
      format = 'json'
    } = options;

    const exportData = {
      exportedAt: new Date().toISOString(),
      period: {
        start: new Date(startTime).toISOString(),
        end: new Date(endTime).toISOString()
      },
      metrics: this.getDetailedMetrics(startTime, endTime),
      configuration: this.config
    };

    if (!includeSystemStats) {
      delete exportData.metrics.systemStats;
    }

    if (format === 'json') {
      return JSON.stringify(exportData, null, 2);
    }

    return exportData;
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.systemMonitorInterval) {
      clearInterval(this.systemMonitorInterval);
    }

    if (this.metricsCalculationInterval) {
      clearInterval(this.metricsCalculationInterval);
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    logger.info('Performance monitoring stopped');
    this.emit('monitoringStopped');
  }
}

export default PerformanceMonitor;
