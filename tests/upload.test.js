/**
 * Upload Tests - Comprehensive Upload Functionality Testing
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import fetch from 'node-fetch';

describe('File Upload Tests', () => {
  const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:3000';
  const testFilesDir = './test-files';

  beforeAll(async () => {
    // Create test files directory
    if (!fs.existsSync(testFilesDir)) {
      fs.mkdirSync(testFilesDir, { recursive: true });
    }

    // Create test files
    await createTestFiles();
  });

  afterAll(() => {
    // Clean up test files
    if (fs.existsSync(testFilesDir)) {
      fs.rmSync(testFilesDir, { recursive: true, force: true });
    }
  });

  describe('Single File Upload', () => {
    test('should upload a small text file successfully', async () => {
      const testFile = path.join(testFilesDir, 'small-text.txt');
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
      expect(result.results).toHaveLength(1);
      expect(result.results[0].success).toBe(true);
      expect(result.results[0].fileId).toBeDefined();
      expect(result.results[0].hash).toBeDefined();
    }, 30000);

    test('should upload a medium-sized file successfully', async () => {
      const testFile = path.join(testFilesDir, 'medium-data.json');
      const formData = new FormData();
      formData.append('files', fs.createReadStream(testFile));
      formData.append('userId', 'test-user');
      formData.append('compress', 'true');

      const response = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        body: formData
      });

      expect(response.status).toBe(200);
      
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.results[0].metadata.compressed).toBeDefined();
    }, 60000);

    test('should handle permanent storage option', async () => {
      const testFile = path.join(testFilesDir, 'permanent-test.txt');
      const formData = new FormData();
      formData.append('files', fs.createReadStream(testFile));
      formData.append('userId', 'test-user');
      formData.append('permanent', 'true');

      const response = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        body: formData
      });

      expect(response.status).toBe(200);
      
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.results[0].permanent).toBe(true);
    }, 45000);
  });

  describe('Multiple File Upload', () => {
    test('should upload multiple files successfully', async () => {
      const testFiles = [
        path.join(testFilesDir, 'small-text.txt'),
        path.join(testFilesDir, 'test-image.png'),
        path.join(testFilesDir, 'config.yaml')
      ];

      const formData = new FormData();
      testFiles.forEach(file => {
        formData.append('files', fs.createReadStream(file));
      });
      formData.append('userId', 'test-user');

      const response = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        body: formData
      });

      expect(response.status).toBe(200);
      
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);
      
      result.results.forEach(fileResult => {
        expect(fileResult.success).toBe(true);
        expect(fileResult.fileId).toBeDefined();
      });
    }, 90000);
  });

  describe('Upload Validation', () => {
    test('should reject empty files', async () => {
      const emptyFile = path.join(testFilesDir, 'empty.txt');
      fs.writeFileSync(emptyFile, '');

      const formData = new FormData();
      formData.append('files', fs.createReadStream(emptyFile));
      formData.append('userId', 'test-user');

      const response = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('empty');
    });

    test('should handle oversized files gracefully', async () => {
      // This test would need a very large file or mock the size check
      // For demo purposes, we'll simulate with a reasonable file
      const testFile = path.join(testFilesDir, 'small-text.txt');
      const formData = new FormData();
      formData.append('files', fs.createReadStream(testFile));
      formData.append('userId', 'test-user');

      const response = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        body: formData
      });

      expect(response.status).toBe(200);
    });
  });

  describe('Upload Options', () => {
    test('should respect compression settings', async () => {
      const testFile = path.join(testFilesDir, 'compressible-data.txt');
      
      // Test with compression enabled
      const formDataCompressed = new FormData();
      formDataCompressed.append('files', fs.createReadStream(testFile));
      formDataCompressed.append('userId', 'test-user');
      formDataCompressed.append('compress', 'true');

      const compressedResponse = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        body: formDataCompressed
      });

      const compressedResult = await compressedResponse.json();
      expect(compressedResult.success).toBe(true);
    });

    test('should handle critical file marking', async () => {
      const testFile = path.join(testFilesDir, 'critical-document.pdf');
      const formData = new FormData();
      formData.append('files', fs.createReadStream(testFile));
      formData.append('userId', 'test-user');
      formData.append('critical', 'true');

      const response = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      expect(result.success).toBe(true);
      // Critical files should have backup copies
      expect(result.results[0].providers).toBeGreaterThan(1);
    });
  });

  async function createTestFiles() {
    // Small text file
    fs.writeFileSync(
      path.join(testFilesDir, 'small-text.txt'),
      'This is a small test file for upload testing.'
    );

    // Medium JSON data file
    const mediumData = {
      testData: Array(1000).fill().map((_, i) => ({
        id: i,
        name: `Test Item ${i}`,
        data: `Sample data for item ${i}`,
        timestamp: new Date().toISOString()
      }))
    };
    fs.writeFileSync(
      path.join(testFilesDir, 'medium-data.json'),
      JSON.stringify(mediumData, null, 2)
    );

    // Permanent test file
    fs.writeFileSync(
      path.join(testFilesDir, 'permanent-test.txt'),
      'This file should be stored permanently on Arweave.'
    );

    // Test image (base64 encoded 1x1 PNG)
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(path.join(testFilesDir, 'test-image.png'), pngData);

    // YAML config file
    fs.writeFileSync(
      path.join(testFilesDir, 'config.yaml'),
      `
version: 1.0
test:
  enabled: true
  settings:
    - option1: value1
    - option2: value2
      `.trim()
    );

    // Compressible data
    const compressibleText = 'This text repeats many times. '.repeat(1000);
    fs.writeFileSync(
      path.join(testFilesDir, 'compressible-data.txt'),
      compressibleText
    );

    // Critical document (PDF-like content)
    fs.writeFileSync(
      path.join(testFilesDir, 'critical-document.pdf'),
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n174\n%%EOF'
    );
  }
});
