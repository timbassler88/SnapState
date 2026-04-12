import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { config } from '../config.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

let _client;

function getClient() {
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: config.r2.endpoint,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
  }
  return _client;
}

/**
 * Upload a compressed archive buffer to R2.
 *
 * @param {string} key - R2 object key (e.g. archives/{account_id}/{workflow_id}.json.gz)
 * @param {Buffer} compressedBuffer - gzip-compressed JSON data
 */
export async function uploadArchive(key, compressedBuffer) {
  await _withRetry(() =>
    getClient().send(new PutObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
      Body: compressedBuffer,
      ContentType: 'application/gzip',
    }))
  );
}

/**
 * Download and decompress an archive from R2.
 *
 * @param {string} key
 * @returns {Promise<object>} decompressed JSON object
 */
export async function downloadArchive(key) {
  const response = await _withRetry(() =>
    getClient().send(new GetObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
    }))
  );

  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  const compressed = Buffer.concat(chunks);
  const raw = await gunzipAsync(compressed);
  return JSON.parse(raw.toString('utf8'));
}

/**
 * Delete an archive from R2.
 *
 * @param {string} key
 */
export async function deleteArchive(key) {
  await _withRetry(() =>
    getClient().send(new DeleteObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
    }))
  );
}

export async function checkR2Health() {
  try {
    // Lightweight check — attempt to get a non-existent key; 404 means R2 is reachable
    await getClient().send(new GetObjectCommand({
      Bucket: config.r2.bucketName,
      Key: '__health_check__',
    }));
    return true;
  } catch (err) {
    // NoSuchKey means the bucket is reachable
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return true;
    return false;
  }
}

async function _withRetry(fn, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastErr;
}
