/**
 * Frontend Application - Blockchain File Storage Demo Interface
 * Handles all user interactions, file uploads, downloads, and real-time updates
 */

class BlockchainFileStorageApp {
  constructor() {
    this.apiBaseUrl = '/api';
    this.files = [];
    this.currentPage = 1;
    this.filesPerPage = 20;
    this.totalFiles = 0;
    this.uploadQueue = [];
    this.isUploading = false;
    this.systemStatus = {};
    
    // Initialize application
    this.init();
  }

  /**
   * Initialize the application
   */
  async init() {
    try {
      console.log('🚀 Initializing Blockchain File Storage Demo...');
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Load initial data
      await this.loadSystemStatus();
      await this.loadFiles();
      await this.loadPerformanceMetrics();
      
      // Start real-time updates
      this.startRealTimeUpdates();
      
      // Show welcome notification
      this.showNotification('success', 'System Ready', 'Blockchain file storage demo is ready to use!');
      
      console.log('✅ Application initialized successfully');
      
    } catch (error) {
      console.error('❌ Application initialization failed:', error);
      this.showNotification('error', 'Initialization Failed', 'Failed to initialize the application. Please refresh the page.');
    }
  }

  /**
   * Setup all event listeners
   */
  setupEventListeners() {
    // File upload events
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');

    // Drag and drop
    uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
    uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
    uploadArea.addEventListener('drop', this.handleFileDrop.bind(this));
    
    // File input
    browseBtn.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', this.handleFileSelect.bind(this));

    // File management events
    document.getElementById('search-btn').addEventListener('click', this.searchFiles.bind(this));
    document.getElementById('file-search').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.searchFiles();
    });
    
    document.getElementById('category-filter').addEventListener('change', this.filterFiles.bind(this));
    document.getElementById('refresh-files').addEventListener('click', this.loadFiles.bind(this));

    // Pagination
    document.getElementById('prev-page').addEventListener('click', this.prevPage.bind(this));
    document.getElementById('next-page').addEventListener('click', this.nextPage.bind(this));

    // Modal events
    document.getElementById('close-preview').addEventListener('click', this.closeModal.bind(this));
    
    // Footer events
    document.getElementById('export-logs').addEventListener('click', this.exportLogs.bind(this));
    document.getElementById('system-status').addEventListener('click', this.showSystemStatus.bind(this));

    // Close modals on outside click
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal')) {
        this.closeModal();
      }
    });

    // Close notifications on click
    document.addEventListener('click', (e) => {
      if (e.target.closest('.notification')) {
        const notification = e.target.closest('.notification');
        this.removeNotification(notification);
      }
    });

    console.log('📡 Event listeners setup completed');
  }

  /**
   * Handle drag over event
   */
  handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('dragover');
  }

  /**
   * Handle drag leave event
   */
  handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
  }

  /**
   * Handle file drop event
   */
  handleFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('dragover');
    
    const files = Array.from(e.dataTransfer.files);
    this.processFiles(files);
  }

  /**
   * Handle file selection
   */
  handleFileSelect(e) {
    const files = Array.from(e.target.files);
    this.processFiles(files);
    e.target.value = ''; // Reset input
  }

  /**
   * Process selected files
   */
  async processFiles(files) {
    if (files.length === 0) return;

    console.log(`📁 Processing ${files.length} file(s)...`);

    // Validate files
    const validFiles = [];
    const invalidFiles = [];

    for (const file of files) {
      const validation = this.validateFile(file);
      if (validation.valid) {
        validFiles.push(file);
      } else {
        invalidFiles.push({ file, errors: validation.errors });
      }
    }

    // Show validation errors
    if (invalidFiles.length > 0) {
      for (const invalid of invalidFiles) {
        this.showNotification('error', 'File Validation Failed', 
          `${invalid.file.name}: ${invalid.errors.join(', ')}`);
      }
    }

    if (validFiles.length === 0) {
      return;
    }

    // Add to upload queue
    for (const file of validFiles) {
      const queueItem = {
        id: this.generateId(),
        file,
        status: 'queued',
        progress: 0,
        startTime: null,
        endTime: null,
        result: null,
        error: null
      };
      
      this.uploadQueue.push(queueItem);
    }

    // Update UI and start upload
    this.updateUploadQueue();
    await this.processUploadQueue();
  }

  /**
   * Validate file before upload
   */
  validateFile(file) {
    const errors = [];
    const maxSize = 1024 * 1024 * 1024; // 1GB
    
    // Check file size
    if (file.size === 0) {
      errors.push('File is empty');
    }
    
    if (file.size > maxSize) {
      errors.push(`File size (${this.formatFileSize(file.size)}) exceeds maximum (${this.formatFileSize(maxSize)})`);
    }

    // Check file name
    if (file.name.length > 255) {
      errors.push('Filename too long');
    }

    // Check for dangerous extensions (basic check)
    const dangerousExts = ['.exe', '.bat', '.cmd', '.scr', '.pif'];
    const ext = file.name.toLowerCase().substr(file.name.lastIndexOf('.'));
    if (dangerousExts.includes(ext)) {
      errors.push(`Potentially dangerous file type: ${ext}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Process upload queue
   */
  async processUploadQueue() {
    if (this.isUploading || this.uploadQueue.length === 0) {
      return;
    }

    this.isUploading = true;
    console.log(`🚀 Starting upload process for ${this.uploadQueue.length} file(s)...`);

    // Show progress modal
    this.showProgressModal();

    try {
      const queuedItems = this.uploadQueue.filter(item => item.status === 'queued');
      
      for (let i = 0; i < queuedItems.length; i++) {
        const item = queuedItems[i];
        
        try {
          item.status = 'uploading';
          item.startTime = Date.now();
          this.updateUploadQueue();
          this.updateProgressModal(item, i, queuedItems.length);

          const result = await this.uploadFile(item);
          
          item.status = 'completed';
          item.endTime = Date.now();
          item.result = result;
          item.progress = 100;
          
          this.showNotification('success', 'Upload Successful', 
            `${item.file.name} uploaded successfully!`);

        } catch (error) {
          console.error(`Upload failed for ${item.file.name}:`, error);
          
          item.status = 'failed';
          item.endTime = Date.now();
          item.error = error.message;
          
          this.showNotification('error', 'Upload Failed', 
            `${item.file.name}: ${error.message}`);
        }
        
        this.updateUploadQueue();
      }

      // Refresh file list
      await this.loadFiles();
      await this.loadPerformanceMetrics();

    } finally {
      this.isUploading = false;
      this.hideProgressModal();
      
      // Clear completed items after 5 seconds
      setTimeout(() => {
        this.uploadQueue = this.uploadQueue.filter(item => 
          item.status !== 'completed' && item.status !== 'failed'
        );
        this.updateUploadQueue();
      }, 5000);
    }
  }

  /**
   * Upload single file
   */
  async uploadFile(queueItem) {
    const formData = new FormData();
    formData.append('files', queueItem.file);
    formData.append('userId', 'demo-user');
    formData.append('permanent', document.getElementById('permanent-storage').checked);
    formData.append('critical', document.getElementById('critical-files').checked);
    formData.append('compress', document.getElementById('enable-compression').checked);

    const xhr = new XMLHttpRequest();

    return new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          queueItem.progress = Math.round((e.loaded / e.total) * 100);
          this.updateUploadQueue();
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          try {
            const response = JSON.parse(xhr.responseText);
            if (response.success && response.results.length > 0) {
              const result = response.results[0];
              if (result.success) {
                resolve(result);
              } else {
                reject(new Error(result.error || 'Upload failed'));
              }
            } else {
              reject(new Error('Upload failed: Invalid response'));
            }
          } catch (error) {
            reject(new Error('Upload failed: Invalid JSON response'));
          }
        } else {
          try {
            const errorResponse = JSON.parse(xhr.responseText);
            reject(new Error(errorResponse.message || `HTTP ${xhr.status}`));
          } catch {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        }
      });

      xhr.addEventListener('error', () => {
        reject(new Error('Network error occurred during upload'));
      });

      xhr.addEventListener('timeout', () => {
        reject(new Error('Upload timeout'));
      });

      xhr.timeout = 10 * 60 * 1000; // 10 minutes
      xhr.open('POST', `${this.apiBaseUrl}/upload`);
      xhr.send(formData);
    });
  }

  /**
   * Update upload queue UI
   */
  updateUploadQueue() {
    const queueContainer = document.getElementById('upload-queue');
    const queueItems = document.getElementById('queue-items');

    if (this.uploadQueue.length === 0) {
      queueContainer.style.display = 'none';
      return;
    }

    queueContainer.style.display = 'block';
    queueItems.innerHTML = '';

    for (const item of this.uploadQueue) {
      const queueItemEl = document.createElement('div');
      queueItemEl.className = 'queue-item';
      
      const statusIcon = this.getStatusIcon(item.status);
      const statusColor = this.getStatusColor(item.status);
      
      queueItemEl.innerHTML = `
        <div class="file-info">
          <div class="file-icon">${this.getFileIcon(item.file.name)}</div>
          <div class="file-details">
            <h4>${item.file.name}</h4>
            <p>${this.formatFileSize(item.file.size)} • ${item.status}</p>
          </div>
        </div>
        <div class="upload-progress">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${item.progress}%; background: ${statusColor};"></div>
          </div>
          <div class="progress-text">${item.progress}%</div>
        </div>
        <div class="queue-actions">
          <span style="color: ${statusColor};">${statusIcon}</span>
        </div>
      `;
      
      queueItems.appendChild(queueItemEl);
    }
  }

  /**
   * Show progress modal
   */
  showProgressModal() {
    const modal = document.getElementById('progress-modal');
    modal.style.display = 'flex';
  }

  /**
   * Update progress modal
   */
  updateProgressModal(currentItem, currentIndex, totalItems) {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const uploadDetails = document.getElementById('upload-details');

    const overallProgress = ((currentIndex + (currentItem.progress / 100)) / totalItems) * 100;
    
    progressFill.style.width = `${overallProgress}%`;
    progressText.textContent = `Uploading ${currentItem.file.name} (${currentIndex + 1}/${totalItems})`;
    
    uploadDetails.innerHTML = `
      <div><strong>Current File:</strong> ${currentItem.file.name}</div>
      <div><strong>Size:</strong> ${this.formatFileSize(currentItem.file.size)}</div>
      <div><strong>Progress:</strong> ${currentItem.progress}%</div>
      <div><strong>Status:</strong> ${currentItem.status}</div>
    `;
  }

  /**
   * Hide progress modal
   */
  hideProgressModal() {
    const modal = document.getElementById('progress-modal');
    modal.style.display = 'none';
  }

  /**
   * Load system status
   */
  async loadSystemStatus() {
    try {
      const response = await fetch(`${this.apiBaseUrl}/status`);
      const data = await response.json();
      
      this.systemStatus = data;
      this.updateProviderStatus();
      
      console.log('📊 System status loaded:', data);
      
    } catch (error) {
      console.error('Failed to load system status:', error);
      this.showNotification('warning', 'Status Update Failed', 'Could not load system status');
    }
  }

  /**
   * Update provider status indicators
   */
  updateProviderStatus() {
    if (!this.systemStatus.providers) return;

    // Update Storj status
    const storjStatus = document.getElementById('storj-status');
    const storjHealth = this.systemStatus.providers.storj;
    if (storjHealth) {
      storjStatus.className = `status-item ${storjHealth.status}`;
    }

    // Update Arweave status
    const arweaveStatus = document.getElementById('arweave-status');
    const arweaveHealth = this.systemStatus.providers.arweave;
    if (arweaveHealth) {
      arweaveStatus.className = `status-item ${arweaveHealth.status}`;
    }
  }

  /**
   * Load performance metrics
   */
  async loadPerformanceMetrics() {
    try {
      const response = await fetch(`${this.apiBaseUrl}/metrics`);
      const data = await response.json();
      
      this.updateMetricsDisplay(data.metrics);
      
    } catch (error) {
      console.error('Failed to load performance metrics:', error);
    }
  }

  /**
   * Update metrics display
   */
  updateMetricsDisplay(metrics) {
    // Update metric cards
    document.getElementById('total-files').textContent = 
      metrics.current.totalUploads + metrics.current.totalDownloads;
    
    document.getElementById('storage-used').textContent = 
      this.formatFileSize(metrics.current.totalDataTransferred || 0);
    
    document.getElementById('upload-speed').textContent = 
      this.formatSpeed(metrics.recent.avgUploadSpeed || 0);
    
    document.getElementById('success-rate').textContent = 
      `${100 - parseFloat(metrics.recent.errorRate || 0)}%`;

    // Update provider stats
    this.updateProviderStats(metrics.providers);
  }

  /**
   * Update provider statistics
   */
  updateProviderStats(providers) {
    const providerStatsContainer = document.getElementById('provider-stats');
    providerStatsContainer.innerHTML = '';

    for (const [name, stats] of Object.entries(providers)) {
      const providerCard = document.createElement('div');
      providerCard.className = 'provider-card';
      
      const isHealthy = stats.errorRate < 5;
      
      providerCard.innerHTML = `
        <div class="provider-header">
          <div class="provider-name">${stats.name}</div>
          <div class="provider-status ${isHealthy ? 'healthy' : 'unhealthy'}">
            ${isHealthy ? 'Healthy' : 'Issues'}
          </div>
        </div>
        <div class="provider-metrics">
          <div class="provider-metric">
            <div class="provider-metric-value">${stats.uploads}</div>
            <div class="provider-metric-label">Uploads</div>
          </div>
          <div class="provider-metric">
            <div class="provider-metric-value">${stats.downloads}</div>
            <div class="provider-metric-label">Downloads</div>
          </div>
          <div class="provider-metric">
            <div class="provider-metric-value">${this.formatSpeed(stats.avgUploadSpeed)}</div>
            <div class="provider-metric-label">Avg Speed</div>
          </div>
          <div class="provider-metric">
            <div class="provider-metric-value">${stats.errorRate}%</div>
            <div class="provider-metric-label">Error Rate</div>
          </div>
        </div>
      `;
      
      providerStatsContainer.appendChild(providerCard);
    }
  }

  /**
   * Load files from server
   */
  async loadFiles() {
    try {
      const searchQuery = document.getElementById('file-search').value;
      const categoryFilter = document.getElementById('category-filter').value;
      
      const params = new URLSearchParams({
        search: searchQuery,
        limit: this.filesPerPage,
        offset: (this.currentPage - 1) * this.filesPerPage,
        category: categoryFilter
      });

      const response = await fetch(`${this.apiBaseUrl}/files?${params}`);
      const data = await response.json();
      
      if (data.success) {
        this.files = data.files;
        this.totalFiles = data.total;
        this.updateFilesDisplay();
        this.updatePagination();
      } else {
        throw new Error(data.message || 'Failed to load files');
      }
      
    } catch (error) {
      console.error('Failed to load files:', error);
      this.showNotification('error', 'Load Failed', 'Could not load files');
      
      // Show error in files list
      const filesBody = document.getElementById('files-body');
      filesBody.innerHTML = `
        <div class="empty-message">
          <p>❌ Failed to load files</p>
          <p>${error.message}</p>
          <button class="btn btn-primary" onclick="app.loadFiles()">Retry</button>
        </div>
      `;
    }
  }

  /**
   * Update files display
   */
  updateFilesDisplay() {
    const filesBody = document.getElementById('files-body');
    
    if (this.files.length === 0) {
      filesBody.innerHTML = `
        <div class="empty-message">
          <p>📁 No files found</p>
          <p>Upload some files to get started!</p>
        </div>
      `;
      return;
    }

    filesBody.innerHTML = '';
    
    for (const file of this.files) {
      const fileRow = document.createElement('div');
      fileRow.className = 'file-row';
      
      const fileDate = new Date(file.updatedAt).toLocaleDateString();
      const primaryProvider = file.storage?.primary?.provider || 'Unknown';
      
      fileRow.innerHTML = `
        <div class="file-name">
          <span class="file-name-icon">${this.getFileIcon(file.file.originalName)}</span>
          <span class="file-name-text">${file.file.originalName}</span>
        </div>
        <div class="file-size">${this.formatFileSize(file.file.size)}</div>
        <div class="file-date">${fileDate}</div>
        <div class="file-provider">${primaryProvider}</div>
        <div class="file-actions">
          <button class="btn btn-secondary" onclick="app.downloadFile('${file.fileId}', '${file.file.originalName}')">
            ⬇️ Download
          </button>
          <button class="btn btn-secondary" onclick="app.showFilePreview('${file.fileId}')">
            👁️ View
          </button>
          <button class="btn btn-danger" onclick="app.deleteFile('${file.fileId}', '${file.file.originalName}')">
            🗑️ Delete
          </button>
        </div>
      `;
      
      filesBody.appendChild(fileRow);
    }
  }

  /**
   * Download file
   */
  async downloadFile(fileId, fileName) {
    try {
      this.showNotification('info', 'Download Started', `Downloading ${fileName}...`);
      
      const response = await fetch(`${this.apiBaseUrl}/download/${fileId}?userId=demo-user`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      window.URL.revokeObjectURL(url);
      
      this.showNotification('success', 'Download Complete', `${fileName} downloaded successfully!`);
      
    } catch (error) {
      console.error('Download failed:', error);
      this.showNotification('error', 'Download Failed', error.message);
    }
  }

  /**
   * Show file preview
   */
  async showFilePreview(fileId) {
    try {
      const response = await fetch(`${this.apiBaseUrl}/files/${fileId}/metadata`);
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.message || 'Failed to load file metadata');
      }

      const file = data.metadata;
      
      document.getElementById('preview-title').textContent = file.file.originalName;
      
      const previewBody = document.getElementById('preview-body');
      previewBody.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
          <div><strong>File Name:</strong> ${file.file.originalName}</div>
          <div><strong>File Size:</strong> ${this.formatFileSize(file.file.size)}</div>
          <div><strong>File Type:</strong> ${file.file.type}</div>
          <div><strong>Upload Date:</strong> ${new Date(file.createdAt).toLocaleString()}</div>
          <div><strong>File Hash:</strong> ${file.file.hash?.substring(0, 16)}...</div>
          <div><strong>Provider:</strong> ${file.storage.primary.provider}</div>
        </div>
        
        <div style="background: var(--bg-secondary); padding: 1rem; border-radius: var(--border-radius); margin-bottom: 1rem;">
          <h4>Storage Information</h4>
          <p><strong>Primary Storage:</strong> ${file.storage.primary.provider}</p>
          <p><strong>Backup Copies:</strong> ${file.storage.backups?.length || 0}</p>
          <p><strong>Strategy:</strong> ${file.storage.strategy}</p>
          ${file.processing ? `
            <p><strong>Compressed:</strong> ${file.processing.compressed ? 'Yes' : 'No'}</p>
            <p><strong>Encrypted:</strong> ${file.processing.encrypted ? 'Yes' : 'No'}</p>
          ` : ''}
        </div>
        
        <div style="background: var(--bg-secondary); padding: 1rem; border-radius: var(--border-radius);">
          <h4>Access Information</h4>
          <p><strong>Owner:</strong> ${file.access.owner}</p>
          <p><strong>Access Level:</strong> ${file.access.accessLevel}</p>
          <p><strong>Download Count:</strong> ${file.access.downloadCount || 0}</p>
          <p><strong>Last Accessed:</strong> ${file.access.lastAccessed ? new Date(file.access.lastAccessed).toLocaleString() : 'Never'}</p>
        </div>
        
        <div style="margin-top: 1rem; text-align: center;">
          <button class="btn btn-primary" onclick="app.downloadFile('${fileId}', '${file.file.originalName}')">
            ⬇️ Download File
          </button>
        </div>
      `;
      
      document.getElementById('preview-modal').style.display = 'flex';
      
    } catch (error) {
      console.error('Failed to show preview:', error);
      this.showNotification('error', 'Preview Failed', error.message);
    }
  }

  /**
   * Delete file
   */
  async deleteFile(fileId, fileName) {
    if (!confirm(`Are you sure you want to delete "${fileName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`${this.apiBaseUrl}/files/${fileId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId: 'demo-user' })
      });

      const data = await response.json();
      
      if (data.success) {
        this.showNotification('success', 'File Deleted', `${fileName} deleted successfully!`);
        await this.loadFiles();
        await this.loadPerformanceMetrics();
      } else {
        throw new Error(data.message || 'Delete failed');
      }
      
    } catch (error) {
      console.error('Delete failed:', error);
      this.showNotification('error', 'Delete Failed', error.message);
    }
  }

  /**
   * Search files
   */
  async searchFiles() {
    this.currentPage = 1;
    await this.loadFiles();
  }

  /**
   * Filter files
   */
  async filterFiles() {
    this.currentPage = 1;
    await this.loadFiles();
  }

  /**
   * Previous page
   */
  async prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      await this.loadFiles();
    }
  }

  /**
   * Next page
   */
  async nextPage() {
    const totalPages = Math.ceil(this.totalFiles / this.filesPerPage);
    if (this.currentPage < totalPages) {
      this.currentPage++;
      await this.loadFiles();
    }
  }

  /**
   * Update pagination
   */
  updatePagination() {
    const totalPages = Math.ceil(this.totalFiles / this.filesPerPage);
    const paginationContainer = document.getElementById('pagination');
    const pageInfo = document.getElementById('page-info');
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');

    if (totalPages <= 1) {
      paginationContainer.style.display = 'none';
      return;
    }

    paginationContainer.style.display = 'flex';
    pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
    
    prevBtn.disabled = this.currentPage === 1;
    nextBtn.disabled = this.currentPage === totalPages;
  }

  /**
   * Close modal
   */
  closeModal() {
    document.getElementById('preview-modal').style.display = 'none';
    document.getElementById('progress-modal').style.display = 'none';
  }

  /**
   * Show system status modal
   */
  async showSystemStatus() {
    await this.loadSystemStatus();
    
    const statusInfo = `
      <h3>System Status</h3>
      <div style="margin: 1rem 0;">
        <strong>Status:</strong> ${this.systemStatus.status || 'Unknown'}<br>
        <strong>Version:</strong> 1.0.0<br>
        <strong>Uptime:</strong> ${this.formatUptime(this.systemStatus.uptime || 0)}<br>
      </div>
      
      <h4>Provider Health</h4>
      ${Object.entries(this.systemStatus.providers || {}).map(([name, status]) => `
        <div style="margin: 0.5rem 0;">
          <span style="color: ${status.status === 'healthy' ? 'var(--success-color)' : 'var(--error-color)'};">
            ${status.status === 'healthy' ? '✅' : '❌'}
          </span>
          <strong>${name}:</strong> ${status.status}
        </div>
      `).join('')}
    `;

    alert(statusInfo.replace(/<[^>]*>/g, '\n').replace(/\n+/g, '\n'));
  }

  /**
   * Export logs
   */
  async exportLogs() {
    try {
      const response = await fetch(`${this.apiBaseUrl}/metrics`);
      const data = await response.json();
      
      const logData = {
        timestamp: new Date().toISOString(),
        systemStatus: this.systemStatus,
        performanceMetrics: data.metrics,
        uploadQueue: this.uploadQueue
      };

      const blob = new Blob([JSON.stringify(logData, null, 2)], { 
        type: 'application/json' 
      });
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `blockchain-storage-logs-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      this.showNotification('success', 'Export Complete', 'Logs exported successfully!');
      
    } catch (error) {
      console.error('Failed to export logs:', error);
      this.showNotification('error', 'Export Failed', 'Could not export logs');
    }
  }

  /**
   * Start real-time updates
   */
  startRealTimeUpdates() {
    // Update system status every 30 seconds
    setInterval(() => {
      this.loadSystemStatus();
    }, 30000);

    // Update performance metrics every 60 seconds
    setInterval(() => {
      this.loadPerformanceMetrics();
    }, 60000);

    console.log('🔄 Real-time updates started');
  }

  /**
   * Show notification
   */
  showNotification(type, title, message, duration = 5000) {
    const notifications = document.getElementById('notifications');
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    
    notification.innerHTML = `
      <div class="notification-header">
        <div class="notification-title">${title}</div>
        <button class="notification-close">&times;</button>
      </div>
      <div class="notification-message">${message}</div>
    `;
    
    // Add close functionality
    notification.querySelector('.notification-close').addEventListener('click', () => {
      this.removeNotification(notification);
    });
    
    notifications.appendChild(notification);
    
    // Auto-remove after duration
    setTimeout(() => {
      this.removeNotification(notification);
    }, duration);
  }

  /**
   * Remove notification
   */
  removeNotification(notification) {
    if (notification && notification.parentNode) {
      notification.style.animation = 'slideOut 0.3s ease forwards';
      setTimeout(() => {
        if (notification.parentNode) {
          notification.parentNode.removeChild(notification);
        }
      }, 300);
    }
  }

  /**
   * Utility Functions
   */

  generateId() {
    return Math.random().toString(36).substr(2, 9);
  }

  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatSpeed(bytesPerSecond) {
    return this.formatFileSize(bytesPerSecond) + '/s';
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  getFileIcon(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    const iconMap = {
      // Images
      'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'svg': '🖼️',
      // Documents
      'pdf': '📄', 'doc': '📝', 'docx': '📝', 'txt': '📄', 'rtf': '📄',
      // Spreadsheets
      'xls': '📊', 'xlsx': '📊', 'csv': '📊',
      // Presentations
      'ppt': '📽️', 'pptx': '📽️',
      // Archives
      'zip': '🗜️', 'rar': '🗜️', '7z': '🗜️', 'tar': '🗜️', 'gz': '🗜️',
      // Audio
      'mp3': '🎵', 'wav': '🎵', 'ogg': '🎵', 'm4a': '🎵',
      // Video
      'mp4': '🎬', 'avi': '🎬', 'mov': '🎬', 'wmv': '🎬',
      // Code
      'js': '⚙️', 'html': '🌐', 'css': '🎨', 'json': '⚙️', 'xml': '⚙️'
    };
    
    return iconMap[ext] || '📁';
  }

  getStatusIcon(status) {
    const iconMap = {
      'queued': '⏳',
      'uploading': '⬆️',
      'completed': '✅',
      'failed': '❌'
    };
    return iconMap[status] || '❓';
  }

  getStatusColor(status) {
    const colorMap = {
      'queued': 'var(--secondary-color)',
      'uploading': 'var(--primary-color)',
      'completed': 'var(--success-color)',
      'failed': 'var(--error-color)'
    };
    return colorMap[status] || 'var(--secondary-color)';
  }
}

// Custom CSS for slideOut animation
const style = document.createElement('style');
style.textContent = `
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  window.app = new BlockchainFileStorageApp();
});

// Handle global errors
window.addEventListener('error', (e) => {
  console.error('Global error:', e.error);
  if (window.app) {
    window.app.showNotification('error', 'Application Error', 'An unexpected error occurred');
  }
});

// Handle unhandled promise rejections
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  if (window.app) {
    window.app.showNotification('error', 'Promise Error', 'An async operation failed');
  }
});
