import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const inputFile = process.argv[2];

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}. Provide the aggregated JSON file.`);
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log(`Loading pre-aggregated LCA data from ${inputFile}...`);
  const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));

  if (!Array.isArray(data) || data.length === 0) {
    console.error('Invalid or empty JSON data.');
    process.exit(1);
  }

  console.log(`Found ${data.length} employer records. Starting Prisma import...`);

  const chunkSize = 1000;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    await prisma.lcaEmployer.createMany({
      data: chunk,
      skipDuplicates: true
    });
    console.log(`Inserted chunk ${Math.floor(i/chunkSize) + 1} of ${Math.ceil(data.length/chunkSize)}`);
  }

  console.log('Production database import complete!');
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
