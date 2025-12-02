import { Client } from '@opensearch-project/opensearch';

const client = new Client({
  node: 'http://localhost:9200',
});

const INDEX_NAME = 'hash_records';

interface BenchmarkResult {
  method: string;
  avgMs: number;
  minMs: number;
  maxMs: number;
  iterations: number;
}

async function getRandomHash(): Promise<string> {
  const result = await client.search({
    index: INDEX_NAME,
    body: {
      size: 1,
      query: {
        function_score: {
          query: { match_all: {} },
          random_score: {},
        },
      },
    },
  });

  return result.body.hits.hits[0]._source.hash_keyword;
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

async function getIndexStats(): Promise<void> {
  const stats = await client.indices.stats({ index: INDEX_NAME });
  const indexStats = stats.body.indices[INDEX_NAME];

  console.log(`📊 인덱스 통계:`);
  console.log(`   총 문서: ${indexStats.primaries.docs.count.toLocaleString()}건`);
  console.log(`   인덱스 크기: ${(indexStats.primaries.store.size_in_bytes / 1024 / 1024).toFixed(0)} MB`);

  // 필드별 크기 확인
  const mapping = await client.indices.getMapping({ index: INDEX_NAME });
  console.log(`   필드 매핑:`);
  const props = mapping.body[INDEX_NAME].mappings.properties;
  Object.entries(props).forEach(([field, config]: [string, any]) => {
    console.log(`     - ${field}: ${config.type}`);
  });
}

async function main() {
  console.log('🔥 OpenSearch 해시 검색 벤치마크 시작\n');
  console.log('='.repeat(80));

  await getIndexStats();

  // 랜덤 해시 값 가져오기
  console.log('\n🎲 테스트용 해시 값 추출...');
  const testHash = await getRandomHash();
  console.log(`   테스트 해시: ${testHash}`);

  // 웜업
  console.log('\n🔥 웜업 실행...');
  for (let i = 0; i < 10; i++) {
    await client.search({
      index: INDEX_NAME,
      body: { query: { term: { hash_keyword: testHash } } },
    });
  }

  const iterations = 100;
  console.log(`\n⏱️  벤치마크 실행 (${iterations}회 반복):\n`);

  const results: BenchmarkResult[] = [];

  // ========== keyword 필드 테스트 ==========
  console.log('📌 keyword 필드 테스트...');

  // Term Query (keyword - exact match)
  results.push(
    await benchmark('keyword + term', () =>
      client.search({
        index: INDEX_NAME,
        body: {
          query: { term: { hash_keyword: testHash } },
        },
      }),
      iterations
    )
  );

  // Bool Filter (keyword - cached)
  results.push(
    await benchmark('keyword + bool filter', () =>
      client.search({
        index: INDEX_NAME,
        body: {
          query: {
            bool: {
              filter: [{ term: { hash_keyword: testHash } }],
            },
          },
        },
      }),
      iterations
    )
  );

  // ========== text 필드 테스트 ==========
  console.log('📌 text 필드 테스트...');

  // Match Query (text - analyzed)
  results.push(
    await benchmark('text + match', () =>
      client.search({
        index: INDEX_NAME,
        body: {
          query: { match: { hash_text: testHash } },
        },
      }),
      iterations
    )
  );

  // Match Phrase Query (text - exact phrase)
  results.push(
    await benchmark('text + match_phrase', () =>
      client.search({
        index: INDEX_NAME,
        body: {
          query: { match_phrase: { hash_text: testHash } },
        },
      }),
      iterations
    )
  );

  // Bool Filter with Match (text)
  results.push(
    await benchmark('text + bool filter match', () =>
      client.search({
        index: INDEX_NAME,
        body: {
          query: {
            bool: {
              filter: [{ match: { hash_text: testHash } }],
            },
          },
        },
      }),
      iterations
    )
  );

  // 결과 출력
  console.log('\n' + '='.repeat(80));
  console.log('📊 OpenSearch 벤치마크 결과');
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

  // 쿼리 프로파일
  console.log('\n📋 쿼리 프로파일:\n');

  console.log('🔑 keyword + term:');
  const profileKeyword = await client.search({
    index: INDEX_NAME,
    body: {
      profile: true,
      query: { term: { hash_keyword: testHash } },
    },
  });
  const keywordProfile = profileKeyword.body.profile.shards[0].searches[0].query[0];
  console.log(`   Time: ${(keywordProfile.time_in_nanos / 1_000_000).toFixed(4)}ms`);
  console.log(`   Type: ${keywordProfile.type}`);

  console.log('\n📝 text + match:');
  const profileText = await client.search({
    index: INDEX_NAME,
    body: {
      profile: true,
      query: { match: { hash_text: testHash } },
    },
  });
  const textProfile = profileText.body.profile.shards[0].searches[0].query[0];
  console.log(`   Time: ${(textProfile.time_in_nanos / 1_000_000).toFixed(4)}ms`);
  console.log(`   Type: ${textProfile.type}`);
}

main()
  .catch(console.error)
  .finally(() => client.close());
