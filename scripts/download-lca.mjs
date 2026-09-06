import fs from 'fs';
import path from 'path';
<<<<<<< HEAD
import crypto from 'crypto';

async function download(url, destPath) {
  console.log(`Downloading ${url}...`);
=======
import { pipeline } from 'stream/promises';

async function download(url, destPath) {
  console.log(`Downloading ${url}... (this might take a few minutes for a ~250MB xlsx file)`);
>>>>>>> divyanshu/master
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
  });

  if (!res.ok) {
<<<<<<< HEAD
    throw new Error(`HTTP error ${res.status} ${res.statusText} fetching ${url}`);
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) {
    const errorSnippet = (await res.text()).slice(0, 500);
    throw new Error(`Expected spreadsheet download but received HTML error page: ${errorSnippet}`);
=======
    throw new Error(`Failed to download ${url}: ${res.statusText}`);
>>>>>>> divyanshu/master
  }

  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  let downloadedBytes = 0;
<<<<<<< HEAD

  const reader = res.body.getReader();
  const fileStream = fs.createWriteStream(destPath);
  const hash = crypto.createHash('sha256');

  let firstChunk = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    if (!firstChunk && value.length >= 4) {
      firstChunk = value;
      // XLSX files are zip archives starting with magic bytes PK (0x50 0x4B 0x03 0x04)
      const isZip = value[0] === 0x50 && value[1] === 0x4B && value[2] === 0x03 && value[3] === 0x04;
      if (!isZip && destPath.endsWith('.xlsx')) {
        console.warn('Warning: First 4 bytes do not match standard PK zip magic header for xlsx.');
      }
    }

    downloadedBytes += value.length;
    fileStream.write(value);
    hash.update(value);

    if (contentLength > 0 && downloadedBytes % (1024 * 1024 * 25) < value.length) {
=======
  
  // Custom tracking logic using native Fetch API.
  const reader = res.body.getReader();
  const fileStream = fs.createWriteStream(destPath);
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    downloadedBytes += value.length;
    fileStream.write(value);
    
    if (contentLength > 0 && downloadedBytes % (1024 * 1024 * 20) < value.length) {
>>>>>>> divyanshu/master
      const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
      const totalMb = (contentLength / 1024 / 1024).toFixed(1);
      const pct = Math.round((downloadedBytes / contentLength) * 100);
      console.log(`Downloaded ${mb}MB / ${totalMb}MB (${pct}%)`);
    }
  }
<<<<<<< HEAD

  await new Promise((resolve, reject) => {
    fileStream.end((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const sha256 = hash.digest('hex');
  const sizeMb = (downloadedBytes / 1024 / 1024).toFixed(2);
  console.log(`Download complete! Saved to ${destPath}`);
  console.log(`File size: ${sizeMb} MB (${downloadedBytes} bytes)`);
  console.log(`SHA-256: ${sha256}`);

  return { destPath, downloadedBytes, sha256 };
=======
  
  fileStream.end();
  console.log(`\nDownload complete! Saved to ${destPath}`);
>>>>>>> divyanshu/master
}

async function start() {
  const url = process.argv[2];
  if (!url) {
<<<<<<< HEAD
    console.error('Usage: node scripts/download-lca.mjs <url> [output-path]');
    process.exit(1);
  }

  const filename = url.split('/').pop() || 'lca-data.xlsx';
  const tmpDir = path.join(process.cwd(), 'tmp');

  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const destPath = process.argv[3] || path.join(tmpDir, filename);
  await download(url, destPath);
}

start().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
=======
    console.error('Missing URL to download.');
    process.exit(1);
  }
  
  const filename = url.split('/').pop();
  const tmpDir = path.join(process.cwd(), 'tmp');
  
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  
  const destPath = path.join(tmpDir, filename);
  await download(url, destPath);
}

start().catch(console.error);
>>>>>>> divyanshu/master
