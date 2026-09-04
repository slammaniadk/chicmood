/**
 * Supabase Storage → Cloudflare R2 이미지 마이그레이션 스크립트
 *
 * 사용법:
 *   node migrate-r2.js
 *
 * 필수 환경변수 (.env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL
 *
 * 주의: Supabase egress 한도가 리셋된 후에 실행해야 합니다.
 */

require('dotenv').config({ path: '.env.local' });

const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || 'chicmood-images';
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

const TABLES = [
  { table: 'product_images', column: 'image_url' },
  { table: 'after_service_images', column: 'image_url' },
  { table: 'chat_messages', column: 'image_url' },
];

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

async function uploadToR2(key, buffer, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

function extractKey(url) {
  // Supabase public URL 형식:
  // https://xxx.supabase.co/storage/v1/object/public/product-images/uploads/123_abc.jpg
  const match = url.match(/\/object\/public\/product-images\/(.+)$/);
  return match ? match[1] : null;
}

async function migrateTable({ table, column }) {
  console.log(`\n--- ${table} 마이그레이션 시작 ---`);

  const { data: rows, error } = await supabase
    .from(table)
    .select(`id, ${column}`)
    .not(column, 'is', null)
    .like(column, '%supabase%');

  if (error) {
    console.error(`  ${table} 조회 실패:`, error.message);
    return { total: 0, success: 0, failed: 0 };
  }

  if (!rows || rows.length === 0) {
    console.log(`  마이그레이션 대상 없음`);
    return { total: 0, success: 0, failed: 0 };
  }

  console.log(`  대상: ${rows.length}건`);
  let success = 0;
  let failed = 0;

  for (const row of rows) {
    const url = row[column];
    const key = extractKey(url);
    if (!key) {
      console.warn(`  [SKIP] id=${row.id} - URL에서 key 추출 실패: ${url}`);
      failed++;
      continue;
    }

    try {
      const { buffer, contentType } = await downloadImage(url);
      const newUrl = await uploadToR2(key, buffer, contentType);

      const { error: updateError } = await supabase
        .from(table)
        .update({ [column]: newUrl })
        .eq('id', row.id);

      if (updateError) {
        console.error(`  [FAIL] id=${row.id} - DB 업데이트 실패:`, updateError.message);
        failed++;
      } else {
        console.log(`  [OK] id=${row.id} → ${newUrl}`);
        success++;
      }
    } catch (err) {
      console.error(`  [FAIL] id=${row.id} -`, err.message);
      failed++;
    }
  }

  return { total: rows.length, success, failed };
}

async function main() {
  console.log('=== Supabase → R2 이미지 마이그레이션 ===');
  console.log(`R2 Bucket: ${R2_BUCKET}`);
  console.log(`R2 Public URL: ${R2_PUBLIC_URL}`);

  const results = [];

  for (const spec of TABLES) {
    const result = await migrateTable(spec);
    results.push({ table: spec.table, ...result });
  }

  console.log('\n=== 마이그레이션 완료 ===');
  for (const r of results) {
    console.log(`  ${r.table}: 전체 ${r.total}건 / 성공 ${r.success}건 / 실패 ${r.failed}건`);
  }
}

main().catch(err => {
  console.error('마이그레이션 오류:', err);
  process.exit(1);
});
