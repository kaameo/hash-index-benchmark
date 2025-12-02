import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

const TOTAL_RECORDS = 10_000_000;  // 1천만 건
const BATCH_SIZE = 50_000;         // 배치 크기 (더 줄임)

function generateBatch(size: number): string {
  const values: string[] = [];

  for (let i = 0; i < size; i++) {
    const hash = crypto.randomBytes(32).toString('hex');
    values.push(`('${hash}', '${hash}', '${hash}', NOW(), 0, '{}')`);
  }

  return `INSERT INTO hash_records (hash_btree, hash_hash, hash_noindex, created_at, status, metadata) VALUES ${values.join(',')};`;
}

async function seed() {
  console.log(`🚀 시작: ${TOTAL_RECORDS.toLocaleString()}건 생성`);
  console.log(`📦 배치 크기: ${BATCH_SIZE.toLocaleString()}`);
  console.log(`📊 필드: hash_btree(B-tree), hash_hash(Hash), hash_noindex(없음)\n`);

  const startTime = Date.now();
  let inserted = 0;
  let retryCount = 0;
  const maxRetries = 5;

  for (let i = 0; i < TOTAL_RECORDS; i += BATCH_SIZE) {
    try {
      const currentBatch = Math.min(BATCH_SIZE, TOTAL_RECORDS - i);
      const sql = generateBatch(currentBatch);
      await prisma.$executeRawUnsafe(sql);

      inserted = i + currentBatch;
      retryCount = 0; // 성공하면 리셋

      if (inserted % 100_000 === 0 || inserted === TOTAL_RECORDS) {
        const progress = (inserted / TOTAL_RECORDS * 100).toFixed(2);
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
        const rate = (inserted / ((Date.now() - startTime) / 1000)).toFixed(0);
        console.log(`📊 진행: ${progress}% | ${inserted.toLocaleString()}건 | ${elapsed}분 | ${rate}건/초`);
      }
    } catch (error: any) {
      retryCount++;
      console.error(`❌ 오류 (${retryCount}/${maxRetries}) at ${inserted.toLocaleString()}건:`, error.message);

      if (retryCount >= maxRetries) {
        console.error('💀 최대 재시도 횟수 초과. 종료.');
        break;
      }

      // 재연결 시도
      await prisma.$disconnect();
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3초 대기
      await prisma.$connect();
      i -= BATCH_SIZE; // 재시도
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ 완료: ${inserted.toLocaleString()}건 | ${totalTime}분 소요`);
}

seed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
