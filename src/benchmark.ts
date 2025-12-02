import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';

const prisma = new PrismaClient();

interface BenchmarkResult {
  method: string;
  avgMs: number;
  minMs: number;
  maxMs: number;
  iterations: number;
}

async function getRandomHashes(): Promise<{ btree: string; hash: string; noindex: string }> {
  const result = await prisma.$queryRaw<{ hash_btree: string; hash_hash: string; hash_noindex: string }[]>`
    SELECT hash_btree, hash_hash, hash_noindex FROM hash_records
    ORDER BY RANDOM() LIMIT 1
  `;
  return {
    btree: result[0].hash_btree,
    hash: result[0].hash_hash,
    noindex: result[0].hash_noindex,
  };
}

async function benchmark(
  name: string,
  query: () => Promise<any>,
  iterations: number
): Promise<BenchmarkResult> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await query();
    times.push(performance.now() - start);
  }

  return {
    method: name,
    avgMs: times.reduce((a, b) => a + b) / times.length,
    minMs: Math.min(...times),
    maxMs: Math.max(...times),
    iterations,
  };
}

async function explainQueries(hashes: { btree: string; hash: string; noindex: string }): Promise<void> {
  console.log('\n📋 쿼리 실행 계획:\n');

  console.log('🌲 B-tree 인덱스 (hash_btree):');
  const explainBtree = await prisma.$queryRaw<any[]>`
    EXPLAIN ANALYZE SELECT * FROM hash_records WHERE hash_btree = ${hashes.btree}
  `;
  explainBtree.forEach((row) => console.log('   ' + row['QUERY PLAN']));

  console.log('\n#️⃣  Hash 인덱스 (hash_hash):');
  const explainHash = await prisma.$queryRaw<any[]>`
    EXPLAIN ANALYZE SELECT * FROM hash_records WHERE hash_hash = ${hashes.hash}
  `;
  explainHash.forEach((row) => console.log('   ' + row['QUERY PLAN']));

  console.log('\n❌ 인덱스 없음 (hash_noindex):');
  const explainNoindex = await prisma.$queryRaw<any[]>`
    EXPLAIN ANALYZE SELECT * FROM hash_records WHERE hash_noindex = ${hashes.noindex}
  `;
  explainNoindex.forEach((row) => console.log('   ' + row['QUERY PLAN']));
}

async function getTableStats(): Promise<void> {
  const count = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) as count FROM hash_records
  `;
  console.log(`📊 테이블 통계:`);
  console.log(`   총 레코드: ${Number(count[0].count).toLocaleString()}건`);

  const size = await prisma.$queryRaw<{ size: string }[]>`
    SELECT pg_size_pretty(pg_total_relation_size('hash_records')) as size
  `;
  console.log(`   테이블 크기: ${size[0].size}`);

  const indexSizes = await prisma.$queryRaw<{ indexname: string; size: string }[]>`
    SELECT indexname, pg_size_pretty(pg_relation_size(indexname::regclass)) as size
    FROM pg_indexes WHERE tablename = 'hash_records'
  `;
  console.log(`   인덱스 크기:`);
  indexSizes.forEach((idx) => console.log(`     - ${idx.indexname}: ${idx.size}`));
}

async function main() {
  console.log('🔥 해시 검색 벤치마크 시작\n');
  console.log('='.repeat(80));

  await getTableStats();

  // 랜덤 해시 값 가져오기
  console.log('\n🎲 테스트용 해시 값 추출...');
  const hashes = await getRandomHashes();
  console.log(`   B-tree용:  ${hashes.btree}`);
  console.log(`   Hash용:    ${hashes.hash}`);
  console.log(`   NoIndex용: ${hashes.noindex}`);

  // pg 클라이언트 연결
  const pgClient = new Client({
    connectionString: 'postgresql://benchmark:benchmark123@localhost:5432/hash_test',
  });
  await pgClient.connect();

  // 웜업
  console.log('\n🔥 웜업 실행...');
  for (let i = 0; i < 10; i++) {
    await prisma.$queryRaw`SELECT * FROM hash_records WHERE hash_btree = ${hashes.btree}`;
    await prisma.$queryRaw`SELECT * FROM hash_records WHERE hash_hash = ${hashes.hash}`;
    await pgClient.query('SELECT * FROM hash_records WHERE hash_btree = $1', [hashes.btree]);
  }

  const iterations = 100;
  console.log(`\n⏱️  벤치마크 실행 (${iterations}회 반복):\n`);

  const results: BenchmarkResult[] = [];

  // ========== Prisma Raw Query ==========
  console.log('📌 Prisma Raw Query 테스트...');

  // B-tree 인덱스 테스트
  results.push(
    await benchmark('Prisma Raw - B-tree', () =>
      prisma.$queryRaw`SELECT * FROM hash_records WHERE hash_btree = ${hashes.btree}`,
      iterations
    )
  );

  // Hash 인덱스 테스트
  results.push(
    await benchmark('Prisma Raw - Hash', () =>
      prisma.$queryRaw`SELECT * FROM hash_records WHERE hash_hash = ${hashes.hash}`,
      iterations
    )
  );

  // ========== pg 드라이버 ==========
  console.log('📌 pg 드라이버 테스트...');

  // B-tree 인덱스 테스트
  results.push(
    await benchmark('pg Driver - B-tree', () =>
      pgClient.query('SELECT * FROM hash_records WHERE hash_btree = $1', [hashes.btree]),
      iterations
    )
  );

  // Hash 인덱스 테스트
  results.push(
    await benchmark('pg Driver - Hash', () =>
      pgClient.query('SELECT * FROM hash_records WHERE hash_hash = $1', [hashes.hash]),
      iterations
    )
  );

  // ========== Prisma ORM ==========
  console.log('📌 Prisma ORM 테스트...');

  results.push(
    await benchmark('Prisma ORM - B-tree', () =>
      prisma.hashRecord.findFirst({ where: { hashBtree: hashes.btree } }),
      iterations
    )
  );

  results.push(
    await benchmark('Prisma ORM - Hash', () =>
      prisma.hashRecord.findFirst({ where: { hashHash: hashes.hash } }),
      iterations
    )
  );

  // ========== No Index ==========
  console.log('⚠️  No Index 테스트 중... (Full Table Scan - 느릴 수 있음)');

  results.push(
    await benchmark('pg Driver - No Index', () =>
      pgClient.query('SELECT * FROM hash_records WHERE hash_noindex = $1 LIMIT 1', [hashes.noindex]),
      Math.min(iterations, 10) // 느리므로 10회만
    )
  );

  results.push(
    await benchmark('Prisma Raw - No Index', () =>
      prisma.$queryRaw`SELECT * FROM hash_records WHERE hash_noindex = ${hashes.noindex} LIMIT 1`,
      Math.min(iterations, 10) // 느리므로 10회만
    )
  );

  results.push(
    await benchmark('Prisma ORM - No Index', () =>
      prisma.hashRecord.findFirst({ where: { hashNoindex: hashes.noindex } }),
      Math.min(iterations, 10) // 느리므로 10회만
    )
  );

  // pg 클라이언트 종료
  await pgClient.end();

  // 결과 출력
  console.log('\n' + '='.repeat(80));
  console.log('📊 벤치마크 결과');
  console.log('='.repeat(80));
  console.log(
    `${'Method'.padEnd(30)} | ${'Avg (ms)'.padStart(12)} | ${'Min (ms)'.padStart(12)} | ${'Max (ms)'.padStart(12)}`
  );
  console.log('-'.repeat(80));

  for (const result of results) {
    console.log(
      `${result.method.padEnd(30)} | ${result.avgMs.toFixed(3).padStart(12)} | ${result.minMs.toFixed(3).padStart(12)} | ${result.maxMs.toFixed(3).padStart(12)}`
    );
  }
  console.log('='.repeat(80));

  // 비교 분석
  const prismaRawBtree = results.find(r => r.method === 'Prisma Raw - B-tree');
  const pgDriverBtree = results.find(r => r.method === 'pg Driver - B-tree');
  const prismaOrmBtree = results.find(r => r.method === 'Prisma ORM - B-tree');

  if (prismaRawBtree && pgDriverBtree && prismaOrmBtree) {
    console.log('\n📈 드라이버 비교 (B-tree 기준):');
    const baseline = pgDriverBtree.avgMs;
    console.log(`   pg Driver:     ${pgDriverBtree.avgMs.toFixed(3)}ms (기준)`);
    console.log(`   Prisma Raw:    ${prismaRawBtree.avgMs.toFixed(3)}ms (${((prismaRawBtree.avgMs - baseline) / baseline * 100).toFixed(1)}%)`);
    console.log(`   Prisma ORM:    ${prismaOrmBtree.avgMs.toFixed(3)}ms (${((prismaOrmBtree.avgMs - baseline) / baseline * 100).toFixed(1)}%)`);
  }

  // 실행 계획 출력
  await explainQueries(hashes);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
