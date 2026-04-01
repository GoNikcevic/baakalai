const fs = require('fs');
const path = require('path');

let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, getSignedUrl;
try {
  ({ S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3'));
  ({ getSignedUrl } = require('@aws-sdk/s3-request-presigner'));
} catch {
  // S3 SDK not installed — local storage only
}

const s3Endpoint = process.env.S3_ENDPOINT;
const s3Bucket = process.env.S3_BUCKET;
const s3Region = process.env.S3_REGION || 'auto';
const s3AccessKey = process.env.S3_ACCESS_KEY_ID;
const s3Secret = process.env.S3_SECRET_ACCESS_KEY;
const isS3 = !!(s3Bucket && s3AccessKey && s3Secret && S3Client);

console.log('[storage] S3 config:', { isS3, bucket: s3Bucket, region: s3Region, endpoint: s3Endpoint ? s3Endpoint.slice(0, 30) + '...' : 'none', hasKey: !!s3AccessKey, hasSecret: !!s3Secret });

let s3Client = null;
if (isS3) {
  const clientConfig = {
    region: s3Region,
    credentials: {
      accessKeyId: s3AccessKey,
      secretAccessKey: s3Secret,
    },
    forcePathStyle: true,
  };
  if (s3Endpoint) {
    clientConfig.endpoint = s3Endpoint;
  }
  s3Client = new S3Client(clientConfig);
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
