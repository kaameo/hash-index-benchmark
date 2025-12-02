-- 해시 검색 벤치마크용 테이블
CREATE TABLE hash_records (
    id BIGSERIAL PRIMARY KEY,
    hash_btree VARCHAR(64) NOT NULL,       -- B-tree 인덱스 적용
    hash_hash VARCHAR(64) NOT NULL,        -- Hash 인덱스 적용
    hash_noindex VARCHAR(64) NOT NULL,     -- 인덱스 없음
    created_at TIMESTAMP DEFAULT NOW(),
    status SMALLINT DEFAULT 0,
    metadata JSONB DEFAULT '{}'
);

-- B-tree 인덱스만 적용
CREATE INDEX idx_hash_btree ON hash_records(hash_btree);

-- Hash 인덱스만 적용
CREATE INDEX idx_hash_hash ON hash_records USING HASH(hash_hash);

-- hash_noindex는 인덱스 없음 (Full Table Scan 테스트용)

-- 통계 수집 설정
ALTER TABLE hash_records SET (autovacuum_analyze_scale_factor = 0.01);
