/**
 * Download Tests - Comprehensive Download Functionality Testing
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';

describe('File Download Tests', () => {
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
  const testFilesDir = './test-files';
  const downloadDir = './test-downloads';
  let uploadedFiles = [];

  beforeAll(async () => {
    // Create directories
    [testFilesDir, downloadDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Create and upload test files
    await createTestFiles();
    uploadedFiles = await uploadTestFiles();
  });

  afterAll(() => {
    // Clean up test directories
    [testFilesDir, downloadDir].forEach(dir => {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('Single File Download', () => {
    test('should download uploaded file successfully', async () => {
      const uploadedFile = uploadedFiles[0];
      expect(uploadedFile).toBeDefined();

      const response = await fetch(
        `${baseUrl}/api/download/${uploadedFile.fileId}?userId=test-user`
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toContain(uploadedFile.filename);
      
      const downloadedContent = await response.buffer();
      expect(downloadedContent.length).toBeGreaterThan(0);
      
      // Save downloaded file
      const downloadPath = path.join(downloadDir, `downloaded_${uploadedFile.filename}`);
      fs.writeFileSync(downloadPath, downloadedContent);
      
      // Verify file integrity
      const originalPath = path.join(testFilesDir, uploadedFile.filename);
      const originalContent = fs.readFileSync(originalPath);
      expect(downloadedContent.equals(originalContent)).toBe(true);
    });

    test('should handle non-existent file downloads', async () => {
      const fakeFileId = 'non-existent-file-id';
      
      const response = await fetch(
        `${baseUrl}/api/download/${fakeFileId}?userId=test-user`
      );

      expect(response.status).toBe(404);
      
      const result = await response.json();
      expect(result.error).toBe('File not found');
    });

    test('should include proper headers in download response', async () => {
      const uploadedFile = uploadedFiles[0];
      
      const response = await fetch(
        `${baseUrl}/api/download/${uploadedFile.fileId}?userId=test-user`
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-disposition')).toBeDefined();
      expect(response.headers.get('content-type')).toBeDefined();
      expect(response.headers.get('content-length')).toBeDefined();
      expect(response.headers.get('x-file-hash')).toBeDefined();
    });
  });

  describe('Download Integrity', () => {
    test('should maintain file integrity across upload/download cycle', async () => {
      const testFile = uploadedFiles.find(f => f.filename === 'integrity-test.txt');
      expect(testFile).toBeDefined();

      const response = await fetch(
        `${baseUrl}/api/download/${testFile.fileId}?userId=test-user`
      );

      expect(response.status).toBe(200);
      
      const downloadedContent = await response.buffer();
      const originalContent = fs.readFileSync(
        path.join(testFilesDir, 'integrity-test.txt')
      );

      // Compare file contents
      expect(downloadedContent.equals(originalContent)).toBe(true);
      
      // Compare file sizes
      expect(downloadedContent.length).toBe(originalContent.length);
    });

    test('should verify hash integrity', async () => {
      const testFile = uploadedFiles[0];
      
      const response = await fetch(
        `${baseUrl}/api/download/${testFile.fileId}?userId=test-user`
      );

      expect(response.status).toBe(200);
      
      const fileHash = response.headers.get('x-file-hash');
      expect(fileHash).toBeDefined();
      expect(fileHash).toBe(testFile.hash);
    });
  });

  describe('Download Performance', () => {
    test('should download files within reasonable time', async () => {
      const testFile = uploadedFiles[0];
      const startTime = Date.now();
      
      const response = await fetch(
        `${baseUrl}/api/download/${testFile.fileId}?userId=test-user`
      );

      expect(response.status).toBe(200);
      
      const downloadedContent = await response.buffer();
      const downloadTime = Date.now() - startTime;
      
      expect(downloadedContent.length).toBeGreaterThan(0);
      expect(downloadTime).toBeLessThan(30000); // Should complete within 30 seconds
    });

    test('should handle concurrent downloads', async () => {
      const testFile = uploadedFiles[0];
      const concurrentDownloads = 5;
      
      const downloadPromises = Array(concurrentDownloads).fill().map(async () => {
        const response = await fetch(
          `${baseUrl}/api/download/${testFile.fileId}?userId=test-user-${Math.random()}`
        );
        expect(response.status).toBe(200);
        return response.buffer();
      });

      const results = await Promise.all(downloadPromises);
      
      // All downloads should succeed and have the same content
      expect(results).toHaveLength(concurrentDownloads);
      
      const firstResult = results[0];
      results.forEach(result => {
        expect(result.equals(firstResult)).toBe(true);
      });
    });
  });

  describe('Download Access Control', () => {
    test('should track download statistics', async () => {
      const testFile = uploadedFiles[0];
      
      // Download the file
      const downloadResponse = await fetch(
        `${baseUrl}/api/download/${testFile.fileId}?userId=test-user`
      );
      expect(downloadResponse.status).toBe(200);
      
      // Check metadata for updated download count
      const metadataResponse = await fetch(
        `${baseUrl}/api/files/${testFile.fileId}/metadata`
      );
      expect(metadataResponse.status).toBe(200);
      
      const metadata = await metadataResponse.json();
      expect(metadata.success).toBe(true);
      expect(metadata.metadata.access.downloadCount).toBeGreaterThan(0);
      expect(metadata.metadata.access.lastAccessed).toBeDefined();
    });
  });

  async function createTestFiles() {
    // Small text file
    fs.writeFileSync(
      path.join(testFilesDir, 'small-download-test.txt'),
      'This is a small test file for download testing.'
    );

    // Medium binary file (fake image data)
    const binaryData = Buffer.alloc(1024, 0x42); // 1KB of 'B' characters
    fs.writeFileSync(
      path.join(testFilesDir, 'binary-test.bin'),
      binaryData
    );

    // Integrity test file with known content
    const integrityContent = 'INTEGRITY_TEST_' + Date.now() + '_' + Math.random();
    fs.writeFileSync(
      path.join(testFilesDir, 'integrity-test.txt'),
      integrityContent
    );

    // Large text file for performance testing
    const largeContent = 'Performance test data. '.repeat(10000); // ~200KB
    fs.writeFileSync(
      path.join(testFilesDir, 'performance-test.txt'),
      largeContent
    );
  }

  async function uploadTestFiles() {
    const testFiles = [
      'small-download-test.txt',
      'binary-test.bin',
      'integrity-test.txt',
      'performance-test.txt'
    ];

    const uploadResults = [];

    for (const filename of testFiles) {
      const testFile = path.join(testFilesDir, filename);
      const formData = new FormData();
      formData.append('files', fs.createReadStream(testFile));
      formData.append('userId', 'test-user');

      const response = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        body: formData
      });

      expect(response.status).toBe(200);
      
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.results[0].success).toBe(true);

      uploadResults.push({
        filename,
        fileId: result.results[0].fileId,
        hash: result.results[0].hash,
        size: result.results[0].size
      });
    }

    return uploadResults;
  }
});
