# Hash Search Benchmark

해시 문자열 검색 성능 테스트 프로젝트

## 목적

- PostgreSQL 인덱스 타입별 성능 비교 (B-tree vs Hash vs No Index)
- PostgreSQL 드라이버 성능 비교 (pg vs Prisma Raw vs Prisma ORM)
- OpenSearch 필드 타입별 성능 비교 (keyword vs text)
- 대용량 데이터에서 equal 검색 최적화 방안 검증

## 기술 스택

- **Runtime**: Node.js + TypeScript
- **Database Driver**: pg (node-postgres)
- **ORM**: Prisma
- **Database**: PostgreSQL 15
- **Search Engine**: OpenSearch 2.11

## 프로젝트 구조

```
├── docker-compose.yml          # PostgreSQL + OpenSearch
├── prisma/
│   └── schema.prisma           # Prisma 스키마
├── init/
│   └── 01-schema.sql           # PostgreSQL 테이블/인덱스
├── src/
│   ├── seed.ts                 # PostgreSQL 시딩
│   ├── benchmark.ts            # PostgreSQL 벤치마크
│   ├── opensearch-seed.ts      # OpenSearch 시딩
│   └── opensearch-benchmark.ts # OpenSearch 벤치마크
└── .env                        # 환경 변수
```

## 실행 방법

### 1. 환경 설정

```bash
# Docker 컨테이너 시작
docker compose up -d

# 의존성 설치
npm install

# Prisma 클라이언트 생성
npx prisma generate
```

### 2. PostgreSQL 벤치마크

```bash
# 스키마 적용
docker exec -i hash-benchmark-db psql -U benchmark -d hash_test < init/01-schema.sql

# 시딩 (TOTAL_RECORDS 조정 가능)
npm run seed

# 벤치마크 실행
npm run benchmark
```

### 3. OpenSearch 벤치마크

```bash
# 시딩
npm run os:seed

# 벤치마크 실행
npm run os:benchmark
```

## 테이블 스키마

### PostgreSQL

| 필드 | 타입 | 인덱스 |
|------|------|--------|
| id | BIGSERIAL | PRIMARY KEY |
| hash_btree | VARCHAR(64) | B-tree |
| hash_hash | VARCHAR(64) | Hash |
| hash_noindex | VARCHAR(64) | 없음 |

### OpenSearch

| 필드 | 타입 | 용도 |
|------|------|------|
| hash_keyword | keyword | exact match |
| hash_text | text | full-text search |

## 벤치마크 결과 (32,510,000건)

### PostgreSQL 전체 결과

| Method | Avg (ms) | Min (ms) | Max (ms) | 비고 |
|--------|----------|----------|----------|------|
| pg Driver - Hash | **0.398** | 0.291 | 0.928 | 🥇 가장 빠름 |
| pg Driver - B-tree | 0.447 | 0.320 | 0.822 | 🥈 |
| Prisma Raw - B-tree | 0.461 | 0.352 | 0.784 | 🥉 |
| Prisma Raw - Hash | 0.519 | 0.376 | 0.722 | |
| Prisma ORM - Hash | 0.655 | 0.554 | 1.137 | |
| Prisma ORM - B-tree | 0.726 | 0.597 | 2.477 | |
| Prisma ORM - No Index | 7,962 | 7,465 | 8,435 | Full Scan |
| Prisma Raw - No Index | 8,097 | 7,563 | 8,832 | Full Scan |
| pg Driver - No Index | 8,208 | 7,630 | 8,658 | Full Scan |

### 드라이버 × 인덱스 매트릭스 (Avg ms)

|  | B-tree | Hash | No Index |
|--|--------|------|----------|
| **pg Driver** | 0.447 | **0.398** | 8,208 |
| **Prisma Raw** | 0.461 | 0.519 | 8,097 |
| **Prisma ORM** | 0.726 | 0.655 | 7,962 |

### 드라이버별 오버헤드 비교

| 드라이버 | B-tree (ms) | 오버헤드 | Hash (ms) | 오버헤드 |
|----------|-------------|----------|-----------|----------|
| pg Driver | 0.447 | 기준 | 0.398 | 기준 |
| Prisma Raw | 0.461 | +3.0% | 0.519 | +30.4% |
| Prisma ORM | 0.726 | +62.3% | 0.655 | +64.6% |

### 인덱스별 성능 비교 (pg Driver 기준)

| 인덱스 | Avg (ms) | 성능 비교 |
|--------|----------|-----------|
| Hash | 0.398 | 기준 (가장 빠름) |
| B-tree | 0.447 | +12.3% 느림 |
| No Index | 8,208 | **20,623배 느림** |

### OpenSearch

| Method | Avg (ms) | 비고 |
|--------|----------|------|
| text + match_phrase | **2.35** | 가장 빠름 |
| text + match | 3.10 | |
| keyword + term | 4.39 | |

### 전체 비교 요약

| 순위 | DB/Driver | Index | Avg (ms) |
|------|-----------|-------|----------|
| 🥇 | PostgreSQL (pg) | Hash | **0.398** |
| 🥈 | PostgreSQL (pg) | B-tree | 0.447 |
| 🥉 | PostgreSQL (Prisma Raw) | B-tree | 0.461 |
| 4 | PostgreSQL (Prisma Raw) | Hash | 0.519 |
| 5 | PostgreSQL (Prisma ORM) | Hash | 0.655 |
| 6 | PostgreSQL (Prisma ORM) | B-tree | 0.726 |
| 7 | OpenSearch | text + match_phrase | 2.35 |
| 8 | OpenSearch | keyword + term | 4.39 |
| 💀 | PostgreSQL (any) | No Index | ~8,000 |

## 인덱스 크기 비교

### PostgreSQL (32.5M rows, 13GB 테이블)

| 인덱스 | 크기 | 비율 |
|--------|------|------|
| Primary Key | 696 MB | 기준 |
| Hash (hash_hash) | 1,169 MB | 1.7x |
| B-tree (hash_btree) | 3,865 MB | 5.6x |

**Hash 인덱스가 B-tree보다 3.3배 작음**

## 쿼리 실행 계획

### B-tree Index

```
Index Scan using idx_hash_btree on hash_records
  Index Cond: (hash_btree = '...')
Planning Time: 0.202 ms
Execution Time: 0.040 ms
```

### Hash Index

```
Index Scan using idx_hash_hash on hash_records
  Index Cond: (hash_hash = '...')
Planning Time: 0.029 ms
Execution Time: 0.278 ms
```

### No Index (Full Table Scan)

```
Gather (Workers: 2)
  Parallel Seq Scan on hash_records
    Filter: (hash_noindex = '...')
    Rows Removed by Filter: 10,836,666
Execution Time: 6232.044 ms
```

## 설정 최적화

### PostgreSQL (docker-compose.yml)

```yaml
command:
  - "postgres"
  - "-c"
  - "shared_buffers=512MB"
  - "-c"
  - "max_wal_size=4GB"
  - "-c"
  - "work_mem=64MB"
```

### OpenSearch

```yaml
environment:
  - "OPENSEARCH_JAVA_OPTS=-Xms2g -Xmx2g"
  - DISABLE_SECURITY_PLUGIN=true
```

## 결론

### 권장 사항

| 사용 사례 | 권장 |
|-----------|------|
| 해시 equal 검색 (최고 성능) | PostgreSQL + pg Driver + Hash Index |
| 해시 equal 검색 (편의성) | PostgreSQL + Prisma Raw + B-tree Index |
| 범위/정렬 검색 | PostgreSQL + B-tree Index |
| 전문 검색 | OpenSearch + text |
| 분산 환경 | OpenSearch |

### 핵심 인사이트

1. **Hash vs B-tree**: Hash 인덱스가 equal 검색에서 12% 더 빠르고 3.3배 작음
2. **pg vs Prisma Raw**: pg 드라이버가 Prisma Raw보다 3~30% 빠름
3. **pg vs Prisma ORM**: pg 드라이버가 Prisma ORM보다 62~65% 빠름
4. **인덱스 필수**: No Index는 인덱스 대비 **20,623배** 느림 (0.4ms vs 8,200ms)
5. **PostgreSQL vs OpenSearch**: 단순 equal 검색은 PostgreSQL이 **6배** 빠름

### 성능 계층 구조

```
pg Driver + Hash     ████████████████████████████████████████ 0.4ms (최고)
pg Driver + B-tree   ████████████████████████████████████████████ 0.45ms
Prisma Raw + B-tree  █████████████████████████████████████████████ 0.46ms
Prisma Raw + Hash    ████████████████████████████████████████████████ 0.52ms
Prisma ORM + Hash    █████████████████████████████████████████████████████████████ 0.66ms
Prisma ORM + B-tree  ███████████████████████████████████████████████████████████████████ 0.73ms
OpenSearch           ████████████████████████████████████████████████████████████████████████████████████████████████████████ 2.35ms
No Index             ████████████████████████████████████████████████████████████████████████... 8,200ms (20,623x)
```

## License

MIT
