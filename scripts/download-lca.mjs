import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

async function download(url, destPath) {
  console.log(`Downloading ${url}... (this might take a few minutes for a ~250MB xlsx file)`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to download ${url}: ${res.statusText}`);
  }

  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  let downloadedBytes = 0;
  
  // Custom tracking logic using native Fetch API.
  const reader = res.body.getReader();
  const fileStream = fs.createWriteStream(destPath);
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    downloadedBytes += value.length;
    fileStream.write(value);
    
    if (contentLength > 0 && downloadedBytes % (1024 * 1024 * 20) < value.length) {
      const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
      const totalMb = (contentLength / 1024 / 1024).toFixed(1);
      const pct = Math.round((downloadedBytes / contentLength) * 100);
      console.log(`Downloaded ${mb}MB / ${totalMb}MB (${pct}%)`);
    }
  }
  
  fileStream.end();
  console.log(`\nDownload complete! Saved to ${destPath}`);
}

async function start() {
  const url = process.argv[2];
  if (!url) {
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
