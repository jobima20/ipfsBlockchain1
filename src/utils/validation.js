/**
 * Validation Utilities - File and Data Validation
 * Provides comprehensive validation functions for files and data
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { promisify } from 'util';

const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

/**
 * Generate unique ID
 */
export function generateUniqueId(prefix = '') {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(6).toString('hex');
  return `${prefix}${timestamp}-${random}`;
}

/**
 * Calculate file hash (SHA-256)
 */
export async function calculateFileHash(filePath, algorithm = 'sha256') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => {
      hash.update(data);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Calculate buffer hash
 */
export function calculateBufferHash(buffer, algorithm = 'sha256') {
  return crypto.createHash(algorithm).update(buffer).digest('hex');
}

/**
 * Validate file type based on extension and magic bytes
 */
export function validateFileType(filePath, allowedTypes = ['*']) {
  try {
    const extension = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath).toLowerCase();
    
    // If all types are allowed
    if (allowedTypes.includes('*')) {
      return {
        valid: true,
        detectedType: extension,
        mimeType: getMimeType(extension)
      };
    }

    // Check extension against allowed types
    const isAllowed = allowedTypes.some(type => {
      if (type.startsWith('.')) {
        return extension === type.toLowerCase();
      }
      return extension === `.${type.toLowerCase()}`;
    });

    // Additional security checks
    const securityCheck = performSecurityCheck(fileName, extension);

    return {
      valid: isAllowed && securityCheck.safe,
      detectedType: extension,
      mimeType: getMimeType(extension),
      securityIssues: securityCheck.issues
    };

  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Get MIME type from file extension
 */
export function getMimeType(extension) {
  const mimeTypes = {
    // Images
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',

    // Documents
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.rtf': 'application/rtf',
    '.odt': 'application/vnd.oasis.opendocument.text',

    // Archives
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',

    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',

    // Video
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.webm': 'video/webm',

    // Code
    '.js': 'application/javascript',
    '.html': 'text/html',
    '.css': 'text/css',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.csv': 'text/csv',

    // Other
    '.bin': 'application/octet-stream',
    '.exe': 'application/x-msdownload',
    '.dmg': 'application/x-apple-diskimage'
  };

  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * Perform security checks on filename and extension
 */
export function performSecurityCheck(fileName, extension) {
  const issues = [];
  let safe = true;

  // Dangerous extensions
  const dangerousExtensions = [
    '.exe', '.bat', '.cmd', '.com', '.pif', '.scr', '.vbs', '.vbe', '.js', '.jse',
    '.jar', '.msi', '.msp', '.hta', '.cpl', '.dll', '.ocx', '.sys', '.drv'
  ];

  if (dangerousExtensions.includes(extension)) {
    issues.push(`Potentially dangerous file extension: ${extension}`);
    safe = false;
  }

  // Suspicious filename patterns
  const suspiciousPatterns = [
    /virus/i, /malware/i, /trojan/i, /backdoor/i, /exploit/i,
    /payload/i, /shell/i, /hack/i, /crack/i, /keygen/i
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(fileName)) {
      issues.push(`Suspicious filename pattern: ${pattern.source}`);
      safe = false;
    }
  }

  // Check for double extensions
  const doubleExtensionPattern = /\.[a-z0-9]{1,4}\.[a-z0-9]{1,4}$/i;
  if (doubleExtensionPattern.test(fileName)) {
    issues.push('Double file extension detected');
    // Not necessarily unsafe, but suspicious
  }

  // Check for hidden file attempts
  if (fileName.startsWith('.') && fileName.length > 1) {
    issues.push('Hidden file detected');
    // Not unsafe, but worth noting
  }

  // Check filename length
  if (fileName.length > 255) {
    issues.push('Filename too long');
    safe = false;
  }

  // Check for invalid characters
  const invalidChars = /[<>:"/\\|?*\x00-\x1f]/;
  if (invalidChars.test(fileName)) {
    issues.push('Invalid characters in filename');
    safe = false;
  }

  return { safe, issues };
}

/**
 * Validate file size
 */
export async function validateFileSize(filePath, maxSize = null, minSize = 0) {
  try {
    const stats = await stat(filePath);
    const fileSize = stats.size;

    const validation = {
      valid: true,
      size: fileSize,
      issues: []
    };

    if (fileSize < minSize) {
      validation.valid = false;
      validation.issues.push(`File size (${fileSize} bytes) is below minimum (${minSize} bytes)`);
    }

    if (maxSize && fileSize > maxSize) {
      validation.valid = false;
      validation.issues.push(`File size (${fileSize} bytes) exceeds maximum (${maxSize} bytes)`);
    }

    if (fileSize === 0) {
      validation.valid = false;
      validation.issues.push('File is empty');
    }

    return validation;

  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Validate file exists and is readable
 */
export async function validateFileAccess(filePath) {
  try {
    await stat(filePath);
    
    // Check read permission
    try {
      await fs.promises.access(filePath, fs.constants.R_OK);
      return { valid: true, readable: true };
    } catch (error) {
      return { 
        valid: false, 
        readable: false, 
        error: 'File is not readable' 
      };
    }

  } catch (error) {
    return {
      valid: false,
      exists: false,
      error: 'File does not exist'
    };
  }
}

/**
 * Comprehensive file validation
 */
export async function validateFile(filePath, options = {}) {
  const {
    maxSize = null,
    minSize = 0,
    allowedTypes = ['*'],
    checkHash = false,
    expectedHash = null
  } = options;

  const validation = {
    valid: true,
    errors: [],
    warnings: [],
    details: {}
  };

  try {
    // Check file access
    const accessCheck = await validateFileAccess(filePath);
    if (!accessCheck.valid) {
      validation.valid = false;
      validation.errors.push(accessCheck.error);
      return validation;
    }

    // Check file size
    const sizeCheck = await validateFileSize(filePath, maxSize, minSize);
    validation.details.size = sizeCheck.size;
    if (!sizeCheck.valid) {
      validation.valid = false;
      validation.errors.push(...sizeCheck.issues);
    }

    // Check file type
    const typeCheck = validateFileType(filePath, allowedTypes);
    validation.details.type = typeCheck.detectedType;
    validation.details.mimeType = typeCheck.mimeType;
    
    if (!typeCheck.valid) {
      validation.valid = false;
      validation.errors.push(`File type not allowed: ${typeCheck.detectedType}`);
    }

    if (typeCheck.securityIssues && typeCheck.securityIssues.length > 0) {
      validation.warnings.push(...typeCheck.securityIssues);
    }

    // Check file hash if requested
    if (checkHash || expectedHash) {
      const calculatedHash = await calculateFileHash(filePath);
      validation.details.hash = calculatedHash;

      if (expectedHash && calculatedHash !== expectedHash) {
        validation.valid = false;
        validation.errors.push('File hash verification failed');
      }
    }

    // Additional magic byte checking for common file types
    const magicByteCheck = await validateMagicBytes(filePath, typeCheck.detectedType);
    if (!magicByteCheck.valid) {
      validation.warnings.push(magicByteCheck.warning);
    }

  } catch (error) {
    validation.valid = false;
    validation.errors.push(`Validation error: ${error.message}`);
  }

  return validation;
}

/**
 * Validate file magic bytes (file header)
 */
export async function validateMagicBytes(filePath, expectedType) {
  try {
    const buffer = await readFile(filePath, { flag: 'r' });
    const header = buffer.slice(0, 16);

    const magicBytes = {
      '.jpg': [0xFF, 0xD8, 0xFF],
      '.jpeg': [0xFF, 0xD8, 0xFF],
      '.png': [0x89, 0x50, 0x4E, 0x47],
      '.gif': [0x47, 0x49, 0x46, 0x38],
      '.pdf': [0x25, 0x50, 0x44, 0x46],
      '.zip': [0x50, 0x4B, 0x03, 0x04],
      '.mp3': [0x49, 0x44, 0x33],
      '.mp4': [0x66, 0x74, 0x79, 0x70],
      '.exe': [0x4D, 0x5A]
    };

    const expectedMagic = magicBytes[expectedType];
    if (!expectedMagic) {
      // No magic bytes defined for this type
      return { valid: true };
    }

    const matches = expectedMagic.every((byte, index) => header[index] === byte);

    if (!matches) {
      return {
        valid: false,
        warning: `File header doesn't match expected type ${expectedType}`
      };
    }

    return { valid: true };

  } catch (error) {
    return {
      valid: false,
      warning: `Could not read file header: ${error.message}`
    };
  }
}

/**
 * Validate email address
 */
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return {
    valid: emailRegex.test(email),
    normalized: email.toLowerCase().trim()
  };
}

/**
 * Validate URL
 */
export function validateUrl(url) {
  try {
    const urlObj = new URL(url);
    return {
      valid: true,
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      pathname: urlObj.pathname
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Sanitize filename for safe storage
 */
export function sanitizeFilename(filename) {
  // Remove invalid characters
  let sanitized = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  
  // Remove leading/trailing dots and spaces
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, '');
  
  // Limit length
  if (sanitized.length > 255) {
    const ext = path.extname(sanitized);
    const name = path.basename(sanitized, ext);
    sanitized = name.substring(0, 255 - ext.length) + ext;
  }
  
  // Ensure it's not empty
  if (!sanitized) {
    sanitized = 'unnamed_file';
  }
  
  return sanitized;
}

/**
 * Validate JSON string
 */
export function validateJSON(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    return {
      valid: true,
      data: parsed
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Validate hex string
 */
export function validateHex(hexString, expectedLength = null) {
  const hexRegex = /^[0-9a-fA-F]+$/;
  const isValid = hexRegex.test(hexString);
  
  const validation = {
    valid: isValid,
    length: hexString.length
  };

  if (expectedLength && hexString.length !== expectedLength) {
    validation.valid = false;
    validation.error = `Expected length ${expectedLength}, got ${hexString.length}`;
  }

  return validation;
}

export default {
  generateUniqueId,
  calculateFileHash,
  calculateBufferHash,
  validateFileType,
  getMimeType,
  performSecurityCheck,
  validateFileSize,
  validateFileAccess,
  validateFile,
  validateMagicBytes,
  validateEmail,
  validateUrl,
  sanitizeFilename,
  validateJSON,
  validateHex
};
