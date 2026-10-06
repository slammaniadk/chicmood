/**
 * DDP창스 라이브 엑셀 일괄 등록 스크립트
 * Usage: node import-ddp-changs.js
 */
require('dotenv').config({ path: '.env.local' });
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const EXCEL_FILE = '★ddp창스라이브_1003.xlsx';

// 시트별 거래처 매핑
const VENDOR_MAP = {
  '르멜리':         { name: '마이엘리(르멜리)', address: '청3가58호', phone: '010-6272-9761' },
  '마이엘리':       { name: '마이엘리', address: '청3가58호', phone: '010-6272-9761' },
  '마이엘리 한정수량': { name: '마이엘리', address: '청3가58호', phone: '010-6272-9761' },
  '어데이즈':       { name: '어데이즈', address: 'DWP동원프라자 1층 113,114호', phone: '010-3001-9236' },
  '토토':           { name: '토토', address: '테크노 B114~15', phone: '010-8865-1448' },
  '야무지개':       { name: '야무지개', address: '디오트 2층 B12호', phone: '010-9460-0602' },
  '콘크리트':       { name: '콘크리트', address: '디오트 B2 D-32,33', phone: '010-4251-2356' },
  '헵타':           { name: '헵타', address: '디오트 B1 D-1-1호', phone: '010-4310-4683' },
};

// 색상 이름 → hex 매핑
const COLOR_HEX = {
  '블랙': '#000000', '화이트': '#FFFFFF', '그레이': '#808080', '베이지': '#D4C5A9',
  '아이보리': '#FFFFF0', '아이': '#FFFFF0', '크림': '#FFFDD0', '모카': '#967259',
  '브라운': '#8B4513', '카키': '#806B2A', '네이비': '#000080', '블루': '#0000FF',
  '레드': '#FF0000', '핑크': '#FFC0CB', '그린': '#008000', '올리브': '#808000',
  '옐로우': '#FFD700', '퍼플': '#800080', '오렌지': '#FF8C00', '버건디': '#800020',
  '차콜': '#36454F', '멜란지': '#B0ADA8', '오트밀': '#D8CCBF', '카멜': '#C4A882',
  '소라': '#87CEEB', '라벤더': '#E6E6FA', '민트': '#98FF98',
  '연청': '#A4C8E1', '중청': '#4A7FB5', '진청': '#1B3A5C', '인디고': '#3F51B5',
  '딥블루': '#00008B', '먹': '#333333', '먹색': '#333333',
  '회': '#808080', '밤': '#5C3317', '밤색': '#5C3317',
  '로즈골드': '#B76E79', '실버': '#C0C0C0', '골드': '#FFD700',
  '와인': '#722F37', '아이비': '#4A5D23', '챠콜': '#36454F',
};

function getColorHex(colorName) {
  if (!colorName) return '#808080';
  const name = colorName.trim();
  if (COLOR_HEX[name]) return COLOR_HEX[name];
  // 부분 매칭
  for (const [key, hex] of Object.entries(COLOR_HEX)) {
    if (name.includes(key)) return hex;
  }
  return '#808080';
}

/**
 * 르멜리 시트: 옵션명에서 색상 추출
 * 형식: [RG_로즈골드-FREE], [OR_실버-FREE] 등
 */
function parseLemelliColor(optionStr) {
  if (!optionStr) return null;
  const m = optionStr.match(/[_](.+?)[-\]]/);
  return m ? m[1].trim() : optionStr.replace(/[\[\]]/g, '').trim();
}

async function ensureVendor(vendorInfo) {
  // 이름으로 검색
  const { data: existing } = await supabase
    .from('vendors')
    .select('id, name')
    .eq('name', vendorInfo.name)
    .limit(1);

  if (existing && existing.length > 0) {
    return existing[0].id;
  }

  // 생성
  const { data: created, error } = await supabase
    .from('vendors')
    .insert({
      name: vendorInfo.name,
      address: vendorInfo.address || '',
      phone: vendorInfo.phone || '',
      is_active: true,
    })
    .select('id')
    .single();

  if (error) throw new Error(`거래처 생성 실패 (${vendorInfo.name}): ${error.message}`);
  console.log(`  [거래처 생성] ${vendorInfo.name} (ID: ${created.id})`);
  return created.id;
}

function normalizeRow(headers, row) {
  const obj = {};
  headers.forEach((h, i) => {
    if (h) obj[h.trim()] = row[i] !== undefined ? row[i] : null;
  });
  return obj;
}

function parseSheet(sheetName, rows) {
  if (rows.length < 2) return [];
  const headers = rows[0];
  const dataRows = rows.slice(1).filter(r => r.some(v => v != null && v !== ''));

  const isLemelli = sheetName === '르멜리';
  const isToto = sheetName === '토토';

  // 정규화된 행 배열
  const normalized = dataRows.map(r => normalizeRow(headers, r));

  // 품번별 그룹핑
  const groups = {};

  for (const row of normalized) {
    const itemNo = String(row['품번'] || '').trim();
    if (!itemNo) continue;

    let productName, color, costPrice, wholesalePrice, material, size, qty;

    if (isLemelli) {
      productName = (row['상품명'] || '').trim();
      color = parseLemelliColor(row['옵션명']);
      costPrice = parseInt(row['공급가']) || 0;
      wholesalePrice = 0;
      material = (row['성분'] || '').trim();
      size = 'FREE';
      qty = parseInt(row['재고']) || 0;
    } else {
      productName = (row['상품명'] || '').trim();
      color = (row['색상'] || '').trim();
      costPrice = parseInt(row['도매가'] || row['도매가격']) || 0;
      wholesalePrice = parseInt(row['판매가']) || 0;
      material = (row['혼용률'] || '').replace(/\r?\n/g, ' ').trim();
      size = (row['사이즈'] || row['상세사이즈'] || '').replace(/\r?\n/g, ' ').trim();
      if (size && !size.startsWith('F')) size = 'FREE';
      else if (!size) size = 'FREE';
      qty = parseInt(row['재고']) || 0;
    }

    // 토토는 상품명이 없으므로 품번 사용
    if (!productName && isToto) productName = String(itemNo);

    if (!productName) continue;

    // 그룹 키 = 품번 + 상품명
    const key = itemNo + '|' + productName;

    if (!groups[key]) {
      groups[key] = {
        itemNo,
        name: productName,
        costPrice,
        wholesalePrice,
        material,
        size,
        colors: [],
        totalQty: 0,
      };
    }

    // 색상 추가
    if (color) {
      const existing = groups[key].colors.find(c => c.name === color);
      if (!existing) {
        groups[key].colors.push({ name: color, hex: getColorHex(color) });
      }
    }

    groups[key].totalQty += qty;

    // 비어있는 필드 채우기
    if (!groups[key].material && material) groups[key].material = material;
    if (costPrice && !groups[key].costPrice) groups[key].costPrice = costPrice;
    if (wholesalePrice && !groups[key].wholesalePrice) groups[key].wholesalePrice = wholesalePrice;
  }

  return Object.values(groups);
}

async function main() {
  console.log('=== DDP창스 라이브 일괄 등록 시작 ===\n');

  const wb = XLSX.readFile(EXCEL_FILE);
  console.log(`시트 목록: ${wb.SheetNames.join(', ')}\n`);

  let totalProducts = 0;
  let totalSkipped = 0;
  let vendorsCreated = 0;
  const vendorIdCache = {};

  for (const sheetName of wb.SheetNames) {
    const vendorInfo = VENDOR_MAP[sheetName];
    if (!vendorInfo) {
      console.log(`[SKIP] 매핑 없는 시트: ${sheetName}`);
      continue;
    }

    console.log(`\n--- 시트: ${sheetName} (거래처: ${vendorInfo.name}) ---`);

    // 거래처 확보
    let vendorId;
    if (vendorIdCache[vendorInfo.name]) {
      vendorId = vendorIdCache[vendorInfo.name];
    } else {
      const existingCount = Object.keys(vendorIdCache).length;
      vendorId = await ensureVendor(vendorInfo);
      vendorIdCache[vendorInfo.name] = vendorId;
      if (Object.keys(vendorIdCache).length > existingCount + (vendorIdCache[vendorInfo.name] === vendorId ? 0 : 1)) {
        // 기존에 없었으면 새로 생성된 것
      }
    }

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const products = parseSheet(sheetName, rows);

    console.log(`  파싱된 상품 그룹: ${products.length}개`);

    for (const prod of products) {
      // 상품 생성
      const price = prod.wholesalePrice || prod.costPrice || 0;
      const insertData = {
        name: prod.name,
        channel: 'ddp_changs',
        cost_price: prod.costPrice,
        wholesale_price: prod.wholesalePrice || 0,
        price: price,
        original_price: price,
        material: prod.material || '',
        size: prod.size || 'FREE',
        available_qty: prod.totalQty,
        vendor_id: vendorId,
        is_active: true,
        discount: 0,
        description: '',
        category: '',
        length_options: '',
      };

      const { data: created, error } = await supabase
        .from('products')
        .insert(insertData)
        .select('id')
        .single();

      if (error) {
        console.log(`  [ERROR] ${prod.name}: ${error.message}`);
        totalSkipped++;
        continue;
      }

      // 색상 등록
      if (prod.colors.length > 0) {
        const colorRows = prod.colors.map((c, i) => ({
          product_id: created.id,
          name: c.name,
          hex_code: c.hex,
          sort_order: i,
        }));
        const { error: colorErr } = await supabase.from('product_colors').insert(colorRows);
        if (colorErr) console.log(`  [WARN] 색상 등록 실패 (${prod.name}): ${colorErr.message}`);
      }

      totalProducts++;
    }

    console.log(`  등록 완료: ${products.length}개`);
  }

  console.log('\n=== 결과 리포트 ===');
  console.log(`거래처 생성/확인: ${Object.keys(vendorIdCache).length}개`);
  console.log(`상품 등록: ${totalProducts}개`);
  console.log(`스킵: ${totalSkipped}개`);
  console.log('=== 완료 ===');
}

main().catch(err => {
  console.error('치명적 오류:', err);
  process.exit(1);
});
