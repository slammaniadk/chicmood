/**
 * Chicmood DB 백업 스크립트
 * 사용법: node backup.js
 * 저장 위치: BACKUP DB/chicmood_backup_YYYYMMDD_HHmmss.json
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// .env.local에서 직접 읽기
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const m = line.match(/^([^#=]+)="?([^"]*)"?$/);
  if (m) env[m[1].trim()] = m[2].trim();
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);

const BACKUP_TABLES = [
  'system_settings', 'vendors', 'users', 'broadcasts',
  'products',
  'product_images', 'product_colors', 'broadcast_products',
  'orders', 'purchase_orders', 'merge_history',
  'order_items', 'purchase_order_items', 'inventory',
  'returns', 'after_services', 'chat_messages',
  'return_items', 'inventory_log',
  'after_service_images',
];

async function backup() {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;

  console.log(`[${ts}] DB 백업 시작...`);

  const tables = {};
  const rowCounts = {};

  for (const t of BACKUP_TABLES) {
    // 1000건 이상 테이블 대응: 페이지네이션
    let allRows = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase.from(t).select('*').range(from, from + pageSize - 1);
      if (error) {
        console.error(`  [ERROR] ${t}: ${error.message}`);
        break;
      }
      allRows = allRows.concat(data || []);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    tables[t] = allRows;
    rowCounts[t] = allRows.length;
    console.log(`  ${t}: ${allRows.length}건`);
  }

  const snapshot = {
    version: 1,
    createdAt: now.toISOString(),
    createdBy: 'backup-script',
    tables,
    rowCounts,
  };

  const dir = path.join(__dirname, 'BACKUP DB');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  const fileName = `chicmood_backup_${ts}.json`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

  const sizeKB = Math.round(fs.statSync(filePath).size / 1024);
  console.log(`\n백업 완료: ${fileName} (${sizeKB}KB)`);
  console.log(`저장 위치: ${filePath}`);
}

backup().catch(e => { console.error('백업 실패:', e.message); process.exit(1); });
