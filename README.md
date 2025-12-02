# Hash Search Benchmark

2억 건 해시 문자열 검색 성능 테스트 프로젝트

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

### PostgreSQL - 드라이버 & 인덱스 비교

| Method | Avg (ms) | Min (ms) | Max (ms) | 비고 |
|--------|----------|----------|----------|------|
| pg Driver - Hash | **0.484** | 0.361 | 1.029 | 가장 빠름 |
| pg Driver - B-tree | 0.564 | 0.395 | 1.107 | |
| Prisma Raw - Hash | 0.591 | 0.454 | 0.943 | |
| Prisma Raw - B-tree | 0.663 | 0.529 | 1.175 | |
| Prisma ORM - B-tree | 0.808 | 0.575 | 7.585 | ORM 오버헤드 |
| No Index (Seq Scan) | 7,218 | 6,813 | 7,549 | **14,914배 느림** |

### 드라이버 오버헤드 비교 (B-tree 기준)

| 드라이버 | Avg (ms) | 오버헤드 |
|----------|----------|----------|
| pg Driver | 0.564 | 기준 |
| Prisma Raw | 0.663 | +17.4% |
| Prisma ORM | 0.808 | +43.2% |

### 인덱스 타입 비교 (pg Driver 기준)

| 인덱스 | Avg (ms) | 성능 |
|--------|----------|------|
| Hash | 0.484 | 기준 |
| B-tree | 0.564 | +16.5% 느림 |

### OpenSearch

| Method | Avg (ms) | 비고 |
|--------|----------|------|
| text + match_phrase | **2.35** | 가장 빠름 |
| text + match | 3.10 | |
| keyword + term | 4.39 | |

### 전체 비교 요약

| DB/Driver | Best Method | Avg (ms) |
|-----------|-------------|----------|
| PostgreSQL (pg) | Hash Index | **0.48** |
| PostgreSQL (Prisma Raw) | Hash Index | 0.59 |
| PostgreSQL (Prisma ORM) | B-tree | 0.81 |
| OpenSearch | text + match_phrase | 2.35 |

**결론**: 단순 해시 equal 검색은 PostgreSQL + pg Driver + Hash Index 조합이 가장 빠름

## 인덱스 크기 비교

### PostgreSQL (32.5M rows, 13GB 테이블)

| 인덱스 | 크기 |
|--------|------|
| Primary Key | 696 MB |
| B-tree (hash_btree) | 3,865 MB |
| Hash (hash_hash) | 1,169 MB |

Hash 인덱스가 B-tree보다 **3.3배 작음**

## 쿼리 실행 계획

### B-tree Index
```
Index Scan using idx_hash_btree on hash_records
  Index Cond: (hash_btree = '...')
Planning Time: 0.205 ms
Execution Time: 0.192 ms
```

### Hash Index
```
Index Scan using idx_hash_hash on hash_records
  Index Cond: (hash_hash = '...')
Planning Time: 0.029 ms
Execution Time: 0.023 ms
```

### No Index (Full Table Scan)
```
Gather (Workers: 2)
  Parallel Seq Scan on hash_records
    Filter: (hash_noindex = '...')
    Rows Removed by Filter: 10,836,666
Execution Time: 6191.434 ms
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

| 사용 사례 | 권장 |
|-----------|------|
| 해시 equal 검색 (최고 성능) | PostgreSQL + pg Driver + Hash Index |
| 해시 equal 검색 (편의성) | PostgreSQL + Prisma Raw + Hash Index |
| 범위/정렬 검색 | PostgreSQL + B-tree Index |
| 전문 검색 | OpenSearch + text |
| 분산 환경 | OpenSearch |

### 핵심 인사이트

1. **Hash vs B-tree**: Hash 인덱스가 equal 검색에서 16% 더 빠르고 3.3배 작음
2. **pg vs Prisma**: pg 드라이버가 Prisma Raw보다 17% 빠름, ORM 대비 43% 빠름
3. **인덱스 필수**: No Index는 인덱스 대비 14,914배 느림 (0.48ms vs 7,218ms)
4. **PostgreSQL vs OpenSearch**: 단순 equal 검색은 PostgreSQL이 5배 빠름

## License

MIT
