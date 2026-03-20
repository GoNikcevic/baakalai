const fs = require('fs');
const path = require('path');

let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, getSignedUrl;
try {
  ({ S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3'));
  ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
} catch {
  // S3 SDK not installed — local storage only
}

const isS3 = !!(process.env.S3_BUCKET && process.env.S3_REGION && S3Client);

let s3Client = null;
if (isS3) {
  s3Client = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined, // For Cloudflare R2 or MinIO
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: !!process.env.S3_ENDPOINT, // Required for R2/MinIO
  });
}

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

async function uploadFile(key, buffer, contentType) {
  if (isS3) {
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    return { location: 's3', key };
  }

  // Local fallback
  const filePath = path.join(UPLOAD_DIR, key);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return { location: 'local', key };
}

async function getFileUrl(key, expiresIn = 3600) {
  if (isS3) {
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
    });
    return getSignedUrl(s3Client, command, { expiresIn });
  }

  // Local: return relative path
  return `/uploads/${key}`;
}

async function deleteFile(key) {
  if (isS3) {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: key,
    }));
    return;
  }

  const filePath = path.join(UPLOAD_DIR, key);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = { uploadFile, getFileUrl, deleteFile, isS3 };
