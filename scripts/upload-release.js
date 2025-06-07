#!/usr/bin/env node

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// Configuration - You can set these via environment variables
const config = {
  region: "auto",
  credentials: {
    accessKeyId: process.env.S3_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
  endpoint: process.env.S3_ENDPOINT,
  bucket: 'logspect-releases',
  forcePathStyle: true
};

const s3Client = new S3Client(config);

// Get MIME type based on file extension
function getMimeType(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  const mimeTypes = {
    'dmg': 'application/octet-stream',
    'zip': 'application/zip',
    'yml': 'text/yaml',
    'yaml': 'text/yaml',
    'json': 'application/json',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'pdf': 'application/pdf',
    'blockmap': 'application/octet-stream'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// Recursively get all files in a directory
function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = readdirSync(dirPath);

  files.forEach(file => {
    const fullPath = join(dirPath, file);
    if (statSync(fullPath).isFile()) {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

// Upload a single file to S3
async function uploadFile(filePath, key) {
  try {
    const fileContent = readFileSync(filePath);
    const contentType = getMimeType(filePath);

    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: fileContent,
      ContentType: contentType,
    });

    await s3Client.send(command);
    console.log(`✅ Uploaded: ${key}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to upload ${key}:`, error.message);
    return false;
  }
}

// Main upload function
async function uploadDistDirectory() {
  const distPath = join(process.cwd(), 'dist');

  try {
    // Check if dist directory exists
    if (!statSync(distPath).isDirectory()) {
      throw new Error('dist directory not found');
    }
  } catch (error) {
    console.error('❌ Error: dist directory not found. Please run "pnpm build" first.');
    process.exit(1);
  }

  console.log(`🚀 Starting upload to S3 bucket: ${config.bucket}`);
  if (config.endpoint) {
    console.log(`🔗 Using S3-compatible endpoint: ${config.endpoint}`);
  }
  console.log(`📁 Uploading from: ${distPath}`);
  console.log('');

  // Get all files in dist directory
  const allFiles = getAllFiles(distPath);

  if (allFiles.length === 0) {
    console.log('⚠️  No files found in dist directory');
    return;
  }

  console.log(`📋 Found ${allFiles.length} files to upload:`);
  allFiles.forEach(file => {
    const relativePath = relative(distPath, file);
    console.log(`   - ${relativePath}`);
  });
  console.log('');

  // Upload files
  let successCount = 0;
  let failCount = 0;

  for (const filePath of allFiles) {
    const relativePath = relative(distPath, filePath);
    const s3Key = relativePath;

    const success = await uploadFile(filePath, s3Key);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('');
  console.log('📊 Upload Summary:');
  console.log(`✅ Successful uploads: ${successCount}`);
  console.log(`❌ Failed uploads: ${failCount}`);
  console.log(`📁 Total files: ${allFiles.length}`);

  if (failCount > 0) {
    console.log('');
    console.log('⚠️  Some files failed to upload. Please check the errors above.');
    process.exit(1);
  } else {
    console.log('');
    console.log('🎉 All files uploaded successfully!');

    console.log(`🔗 Files available at: ${config.endpoint}/${config.bucket}`);
  }
}

// Run the upload
uploadDistDirectory().catch(error => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
