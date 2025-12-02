import { Client } from '@opensearch-project/opensearch';
import * as crypto from 'crypto';

const client = new Client({
  node: 'http://localhost:9200',
});

const INDEX_NAME = 'hash_records';
const TOTAL_RECORDS = 10_000_000;  // 1천만 건
const BATCH_SIZE = 5_000;          // OpenSearch bulk 배치

async function createIndex() {
  const exists = await client.indices.exists({ index: INDEX_NAME });

  if (exists.body) {
    console.log('🗑️  기존 인덱스 삭제...');
    await client.indices.delete({ index: INDEX_NAME });
  }

  console.log('📦 인덱스 생성...');
  await client.indices.create({
    index: INDEX_NAME,
    body: {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        refresh_interval: '-1',  // 시딩 중 refresh 비활성화
      },
      mappings: {
        properties: {
          hash_keyword: { type: 'keyword' },  // exact match (keyword)
          hash_text: { type: 'text' },        // full-text search (text)
          created_at: { type: 'date' },
          status: { type: 'integer' },
          metadata: { type: 'object', enabled: false },
        },
      },
    },
  });
}

async function seed() {
  console.log(`🚀 OpenSearch 시딩 시작: ${TOTAL_RECORDS.toLocaleString()}건`);
  console.log(`📦 배치 크기: ${BATCH_SIZE.toLocaleString()}`);
  console.log(`📊 필드: hash_keyword(keyword), hash_text(text)\n`);

  await createIndex();

  const startTime = Date.now();
  let inserted = 0;

  for (let i = 0; i < TOTAL_RECORDS; i += BATCH_SIZE) {
    const currentBatch = Math.min(BATCH_SIZE, TOTAL_RECORDS - i);
    const body: any[] = [];

    for (let j = 0; j < currentBatch; j++) {
      const hash = crypto.randomBytes(32).toString('hex');
      body.push({ index: { _index: INDEX_NAME } });
      body.push({
        hash_keyword: hash,
        hash_text: hash,
        created_at: new Date().toISOString(),
        status: 0,
        metadata: {},
      });
    }

    await client.bulk({ body, refresh: false });
    inserted = i + currentBatch;

    if (inserted % 100_000 === 0 || inserted === TOTAL_RECORDS) {
      const progress = (inserted / TOTAL_RECORDS * 100).toFixed(2);
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      const rate = (inserted / ((Date.now() - startTime) / 1000)).toFixed(0);
      console.log(`📊 진행: ${progress}% | ${inserted.toLocaleString()}건 | ${elapsed}분 | ${rate}건/초`);
    }
  }

  console.log('\n🔄 인덱스 refresh 중...');
  await client.indices.refresh({ index: INDEX_NAME });

  console.log('⚙️  refresh_interval 복원...');
  await client.indices.putSettings({
    index: INDEX_NAME,
    body: { 'index.refresh_interval': '1s' },
  });

  const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ 완료: ${inserted.toLocaleString()}건 | ${totalTime}분 소요`);
}

seed()
  .catch(console.error)
  .finally(() => client.close());
