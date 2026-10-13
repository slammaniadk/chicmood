const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env.local') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TARGET_POI_ID = 2344;  // PO-20261010-001 차콜 발주5 입고5
const SOURCE_POI_ID = 2515;  // PO-20261013-010 차콜 발주1 입고1

async function main() {
  const DRY = !process.argv.includes('--fix');
  console.log(DRY ? '=== DRY RUN ===' : '=== 실제 수정 ===');

  // 1. 사전 검증: 현재 상태 조회
  console.log('\n[1] 사전 검증');
  const { data: target, error: tErr } = await supabase
    .from('purchase_order_items')
    .select('id, purchase_order_id, product_name, color_name, size_name, qty, received_qty, cost_price, subtotal')
    .eq('id', TARGET_POI_ID).single();
  if (tErr || !target) { console.error('TARGET poi 조회 실패:', tErr); return; }

  const { data: source, error: sErr } = await supabase
    .from('purchase_order_items')
    .select('id, purchase_order_id, product_name, color_name, size_name, qty, received_qty, cost_price, subtotal')
    .eq('id', SOURCE_POI_ID).single();
  if (sErr || !source) { console.error('SOURCE poi 조회 실패:', sErr); return; }

  console.log(`  TARGET poi#${target.id} (PO ID=${target.purchase_order_id}): ${target.product_name} ${target.color_name} ${target.size_name}`);
  console.log(`    발주: ${target.qty}, 입고: ${target.received_qty || 0}, 단가: ${target.cost_price}, 소계: ${target.subtotal}`);
  console.log(`  SOURCE poi#${source.id} (PO ID=${source.purchase_order_id}): ${source.product_name} ${source.color_name} ${source.size_name}`);
  console.log(`    발주: ${source.qty}, 입고: ${source.received_qty || 0}, 단가: ${source.cost_price}, 소계: ${source.subtotal}`);

  const newQty = target.qty + source.qty;
  const newReceivedQty = (target.received_qty || 0) + (source.received_qty || 0);
  const newSubtotal = newQty * target.cost_price;
  console.log(`\n  → 합산 후: 발주 ${target.qty}+${source.qty}=${newQty}, 입고 ${target.received_qty || 0}+${source.received_qty || 0}=${newReceivedQty}, 소계 ${newSubtotal}`);

  // 2. po_order_links 조회
  console.log('\n[2] po_order_links 이관');
  const { data: sourceLinks } = await supabase
    .from('po_order_links')
    .select('id, order_item_id, qty')
    .eq('purchase_order_item_id', SOURCE_POI_ID);
  console.log(`  SOURCE links: ${(sourceLinks || []).length}건`);
  for (const link of (sourceLinks || [])) {
    console.log(`    link#${link.id}: order_item_id=${link.order_item_id}, qty=${link.qty}`);
  }

  if (!DRY) {
    // 2-1. po_order_links 이관
    for (const link of (sourceLinks || [])) {
      const { data: existingLink } = await supabase
        .from('po_order_links')
        .select('id, qty')
        .eq('purchase_order_item_id', TARGET_POI_ID)
        .eq('order_item_id', link.order_item_id)
        .maybeSingle();

      if (existingLink) {
        // 같은 order_item_id가 이미 TARGET에 있으면 qty 합산 후 SOURCE link 삭제
        await supabase.from('po_order_links')
          .update({ qty: existingLink.qty + link.qty })
          .eq('id', existingLink.id);
        await supabase.from('po_order_links').delete().eq('id', link.id);
        console.log(`    link#${link.id} → 기존 link#${existingLink.id}에 qty 합산 (${existingLink.qty}+${link.qty}=${existingLink.qty + link.qty})`);
      } else {
        // TARGET으로 이전
        await supabase.from('po_order_links')
          .update({ purchase_order_item_id: TARGET_POI_ID })
          .eq('id', link.id);
        console.log(`    link#${link.id} → poi#${TARGET_POI_ID}로 이전`);
      }
    }

    // 3. TARGET poi 수량 업데이트
    console.log('\n[3] TARGET poi 수량 업데이트');
    const { error: updateErr } = await supabase
      .from('purchase_order_items')
      .update({ qty: newQty, received_qty: newReceivedQty, subtotal: newSubtotal })
      .eq('id', TARGET_POI_ID);
    if (updateErr) { console.error('업데이트 오류:', updateErr); return; }
    console.log(`  OK: 발주=${newQty}, 입고=${newReceivedQty}, 소계=${newSubtotal}`);

    // 4. SOURCE poi 삭제
    console.log('\n[4] SOURCE poi#' + SOURCE_POI_ID + ' 삭제');
    const { error: delErr } = await supabase
      .from('purchase_order_items')
      .delete()
      .eq('id', SOURCE_POI_ID);
    if (delErr) { console.error('삭제 오류:', delErr); return; }
    console.log('  OK 삭제 완료');

    // 5. SOURCE PO total 재계산
    console.log('\n[5] SOURCE PO (ID=' + source.purchase_order_id + ') total 재계산');
    const { data: srcRemaining } = await supabase
      .from('purchase_order_items')
      .select('subtotal')
      .eq('purchase_order_id', source.purchase_order_id);
    const srcTotal = (srcRemaining || []).reduce((s, i) => s + (i.subtotal || 0), 0);
    await supabase.from('purchase_orders')
      .update({ total_amount: srcTotal, updated_at: new Date().toISOString() })
      .eq('id', source.purchase_order_id);
    console.log(`  OK: total_amount = ${srcTotal.toLocaleString()}원 (남은 품목 ${(srcRemaining || []).length}개)`);

    // 6. TARGET PO total 재계산
    console.log('\n[6] TARGET PO (ID=' + target.purchase_order_id + ') total 재계산');
    const { data: tgtItems } = await supabase
      .from('purchase_order_items')
      .select('subtotal')
      .eq('purchase_order_id', target.purchase_order_id);
    const tgtTotal = (tgtItems || []).reduce((s, i) => s + (i.subtotal || 0), 0);
    await supabase.from('purchase_orders')
      .update({ total_amount: tgtTotal, updated_at: new Date().toISOString() })
      .eq('id', target.purchase_order_id);
    console.log(`  OK: total_amount = ${tgtTotal.toLocaleString()}원 (품목 ${(tgtItems || []).length}개)`);
  }

  // 7. 결과 출력
  console.log('\n[7] 결과 확인');

  const { data: finalTarget } = await supabase
    .from('purchase_order_items')
    .select('id, product_name, color_name, size_name, qty, received_qty, subtotal')
    .eq('id', TARGET_POI_ID).maybeSingle();
  if (finalTarget) {
    console.log(`  poi#${TARGET_POI_ID}: ${finalTarget.product_name} ${finalTarget.color_name} | 발주:${finalTarget.qty} 입고:${finalTarget.received_qty} 소계:${finalTarget.subtotal}`);
  }

  const { data: finalSource } = await supabase
    .from('purchase_order_items')
    .select('id')
    .eq('id', SOURCE_POI_ID).maybeSingle();
  console.log(`  poi#${SOURCE_POI_ID}: ${finalSource ? '아직 존재' : '삭제됨'}`);

  // TARGET PO 링크 확인
  const { data: finalLinks } = await supabase
    .from('po_order_links')
    .select('id, order_item_id, qty')
    .eq('purchase_order_item_id', TARGET_POI_ID);
  console.log(`  poi#${TARGET_POI_ID} links: ${(finalLinks || []).length}건`);
  for (const link of (finalLinks || [])) {
    console.log(`    link#${link.id}: order_item_id=${link.order_item_id}, qty=${link.qty}`);
  }

  // 두 PO 최종 상태
  const { data: po1, error: po1Err } = await supabase.from('purchase_orders')
    .select('id, po_no, total_amount, status')
    .eq('id', target.purchase_order_id).maybeSingle();
  const { data: po2, error: po2Err } = await supabase.from('purchase_orders')
    .select('id, po_no, total_amount, status')
    .eq('id', source.purchase_order_id).maybeSingle();
  if (po1) {
    console.log(`\n  PO ${po1.po_no}: total=${po1.total_amount?.toLocaleString()}원, status=${po1.status}`);
  } else {
    console.log(`\n  TARGET PO (ID=${target.purchase_order_id}) 조회 실패:`, po1Err);
  }
  if (po2) {
    console.log(`  PO ${po2.po_no}: total=${po2.total_amount?.toLocaleString()}원, status=${po2.status}`);
  } else {
    console.log(`  SOURCE PO (ID=${source.purchase_order_id}) 조회 실패:`, po2Err);
  }
}

main().catch(console.error);
