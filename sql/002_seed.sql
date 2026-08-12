-- ============================================================
--  CHICMOOD Seed Data
--  index.html의 PRODUCTS / BROADCASTS 데이터 이관
-- ============================================================

-- ── Broadcasts ──────────────────────────────────────────────
INSERT INTO broadcasts (id, title, date_text, scheduled_at, status, description) VALUES
(1, '8/12(화) 여름 원피스 특가 LIVE', '2026.08.12 (화) 20:00', '2026-08-12T20:00:00+09:00', 'live',
 '올 여름 마지막 원피스 특가! 린넨부터 쉬폰까지 다양한 소재를 만나보세요.'),
(2, '8/10(일) F/W 아우터 선공개', '2026.08.10 (일) 19:00', '2026-08-10T19:00:00+09:00', 'ended',
 '가을/겨울 시즌 아우터와 니트를 미리 만나보세요. 선공개 특가 혜택!');

SELECT setval('broadcasts_id_seq', 2);

-- ── Products ────────────────────────────────────────────────
INSERT INTO products (id, name, price, original_price, discount, description, material) VALUES
(1, '엘레강스 트렌치 코트', 189000, 248000, 24,
 '고급스러운 실루엣의 엘레강스 트렌치 코트입니다. 클래식한 디자인에 현대적인 핏을 더해, 격식 있는 자리부터 일상 외출까지 품격 있게 연출할 수 있습니다.',
 '울 50%, 폴리에스터 45%, 스판덱스 5% / 안감: 고급 새틴 / 드라이클리닝 권장'),
(2, '캐시미어 블렌드 니트', 89000, 128000, 30,
 '부드러운 캐시미어 블렌드 소재로 제작된 고급 니트입니다. 가벼우면서도 보온성이 뛰어나 가을부터 겨울까지 활용도가 높습니다.',
 '캐시미어 30%, 울 40%, 나일론 30% / 손세탁 또는 드라이클리닝'),
(3, '플리츠 롱스커트', 79000, 110000, 28,
 '우아한 플리츠 디테일의 롱스커트입니다. 잔잔한 주름이 움직일 때마다 아름다운 실루엣을 만들어냅니다.',
 '폴리에스터 100% / 기계세탁 가능 (찬물, 약한 세탁)'),
(4, '린넨 블라우스', 69000, 98000, 30,
 '시원한 린넨 소재의 블라우스입니다. 자연스러운 질감과 편안한 핏으로 여름철 데일리 아이템으로 활용하기 좋습니다.',
 '린넨 70%, 면 30% / 기계세탁 가능 (찬물)'),
(5, '플라워 랩원피스', 129000, 168000, 23,
 '은은한 플라워 패턴의 랩원피스입니다. 여성스러운 실루엣과 허리 벨트 디테일로 날씬해 보이는 효과가 있습니다.',
 '폴리에스터 95%, 스판덱스 5% / 기계세탁 가능 (약한 세탁)'),
(6, 'A라인 미디 원피스', 99000, 139000, 29,
 '깔끔한 A라인 실루엣의 미디 원피스입니다. 체형을 자연스럽게 커버해주며 단품으로 착용하기 좋은 아이템입니다.',
 '폴리에스터 80%, 레이온 20% / 기계세탁 가능'),
(7, '쉬폰 프릴 원피스', 109000, 148000, 26,
 '로맨틱한 프릴 디테일의 쉬폰 원피스입니다. 가벼운 쉬폰 소재가 바람에 자연스럽게 흔들리며 우아한 분위기를 연출합니다.',
 '쉬폰(폴리에스터 100%) / 안감 있음 / 손세탁 권장');

SELECT setval('products_id_seq', 7);

-- ── Product Images ──────────────────────────────────────────
INSERT INTO product_images (product_id, image_url, sort_order) VALUES
-- 상품 1: 엘레강스 트렌치 코트
(1, 'https://images.unsplash.com/photo-1525507119028-ed4c629a60a3?w=600&h=800&fit=crop&auto=format&q=80', 0),
(1, 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=600&h=800&fit=crop&auto=format&q=80', 1),
(1, 'https://images.unsplash.com/photo-1544022613-e87ca75a784a?w=600&h=800&fit=crop&auto=format&q=80', 2),
-- 상품 2: 캐시미어 블렌드 니트
(2, 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=600&h=800&fit=crop&auto=format&q=80', 0),
(2, 'https://images.unsplash.com/photo-1548126032-079a0fb0099d?w=600&h=800&fit=crop&auto=format&q=80', 1),
(2, 'https://images.unsplash.com/photo-1487222477857-f5e183d3e68b?w=600&h=800&fit=crop&auto=format&q=80', 2),
-- 상품 3: 플리츠 롱스커트
(3, 'https://images.unsplash.com/photo-1583496661160-fb5886a0aaaa?w=600&h=800&fit=crop&auto=format&q=80', 0),
(3, 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=800&fit=crop&auto=format&q=80', 1),
(3, 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&h=800&fit=crop&auto=format&q=80', 2),
-- 상품 4: 린넨 블라우스
(4, 'https://images.unsplash.com/photo-1564257631407-4deb1f99d992?w=600&h=800&fit=crop&auto=format&q=80', 0),
(4, 'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=600&h=800&fit=crop&auto=format&q=80', 1),
(4, 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&h=800&fit=crop&auto=format&q=80', 2),
-- 상품 5: 플라워 랩원피스
(5, 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=600&h=800&fit=crop&auto=format&q=80', 0),
(5, 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=600&h=800&fit=crop&auto=format&q=80', 1),
(5, 'https://images.unsplash.com/photo-1539533113208-f6df8cc8b543?w=600&h=800&fit=crop&auto=format&q=80', 2),
-- 상품 6: A라인 미디 원피스
(6, 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=600&h=800&fit=crop&auto=format&q=80', 0),
(6, 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=600&h=800&fit=crop&auto=format&q=80', 1),
(6, 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=600&h=800&fit=crop&auto=format&q=80', 2),
-- 상품 7: 쉬폰 프릴 원피스
(7, 'https://images.unsplash.com/photo-1539533113208-f6df8cc8b543?w=600&h=800&fit=crop&auto=format&q=80', 0),
(7, 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&h=800&fit=crop&auto=format&q=80', 1),
(7, 'https://images.unsplash.com/photo-1566174053879-31528523f8ae?w=600&h=800&fit=crop&auto=format&q=80', 2);

-- ── Product Colors ──────────────────────────────────────────
INSERT INTO product_colors (product_id, name, hex_code, sort_order) VALUES
(1, '카멜',    '#c4a882', 0),
(1, '모카',    '#8b7d6b', 1),
(2, '크림',    '#f5ead6', 0),
(2, '베이지',  '#c8b898', 1),
(3, '베이지',  '#d4b896', 0),
(3, '블랙',    '#2c2c2c', 1),
(4, '화이트',  '#f8f4ef', 0),
(4, '베이지',  '#d8c8a8', 1),
(5, '네이비',  '#2c3e6b', 0),
(5, '와인',    '#7b2d4a', 1),
(6, '블랙',    '#2c2c2c', 0),
(6, '카키',    '#7a7d5a', 1),
(7, '아이보리','#f0e8d8', 0),
(7, '핑크',    '#d4a0a0', 1);

-- ── Broadcast ↔ Product 매칭 ────────────────────────────────
INSERT INTO broadcast_products (broadcast_id, product_id, sort_order) VALUES
-- 방송 1: 여름 원피스 (상품 4,5,6,7)
(1, 4, 0),
(1, 5, 1),
(1, 6, 2),
(1, 7, 3),
-- 방송 2: F/W 아우터 (상품 1,2,3)
(2, 1, 0),
(2, 2, 1),
(2, 3, 2);
