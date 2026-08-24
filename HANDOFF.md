# CHICMOOD 프로젝트 핸드오프

## 프로젝트 위치
`C:\Users\daekonkim\Desktop\Chicmood`

## 배포 URL
- 소비자 사이트: https://chicmood.vercel.app
- 어드민 페이지: https://chicmood.vercel.app/admin
- 관리자 계정: `01000000000` / `1004`

## 기술 스택
- **프론트엔드**: Vanilla JS SPA (index.html, admin.html) + Tailwind CDN
- **백엔드**: Vercel Serverless Functions (Node.js)
- **DB**: Supabase (PostgreSQL) + Supabase Storage (이미지)
- **인증**: JWT (jsonwebtoken), 4자리 PIN
- **주소검색**: 카카오 Daum Postcode API

---

## 8/24~25 작업 내역 (발주관리 고도화)

### 부분입고 기능 추가
| 항목 | 변경 내용 | 수정 파일 |
|------|----------|----------|
| DB 스키마 | purchase_orders status 제약조건에 '부분입고' 추가 | sql/019_partial_receiving.sql |
| 발주 목록 필터 | '부분입고' 상태 탭 추가, 주황색 뱃지 | admin.html |
| 발주 상세 모달 | 부분입고 선택 시 입고수량 입력 + 잔량 컬럼 표시 | admin.html |
| 입고수량 저장 | 부분입고 상태에서도 receivedItems 전송 | admin.html, api/admin/[...path].js |

### 재고/배정 연동 강화
| 항목 | 변경 내용 | 수정 파일 |
|------|----------|----------|
| 입고수량 감소 시 재고 차감 | receivedItems가 있으면 상태 무관하게 updateInventoryFromPO 호출 | api/admin/[...path].js |
| 재고 0 정리 | receivedQty=0이면 inventory_log 삭제, stock_qty=0이면 inventory 레코드 삭제 | api/admin/[...path].js |
| 배정 해제 (LIFO) | deallocateExcessFromOrders 함수 신규 - PO 입고 총량 < 배정 총량이면 최신 주문부터 해제 | api/admin/[...path].js |
| 발주 삭제 시 연동 | received_qty → 0 설정 후 deallocate → inventory 역산 → PO 삭제 | api/admin/[...path].js |

### 미발주 자동생성 기능
| 항목 | 변경 내용 | 수정 파일 |
|------|----------|----------|
| 프론트엔드 | "미발주 자동생성" 버튼 + regeneratePOs() 함수 | admin.html |
| API 엔드포인트 | POST /admin/purchase-orders/regenerate | api/admin/[...path].js |
| 로직 | 전체 주문 필요 수량 집계 → 기존 PO 수량 대비 부족분 계산 → 거래처별 그룹핑 → PO 자동 생성 | api/admin/[...path].js |
| PO번호 중복 방지 | 루프 전 max PO번호 조회 + 로컬 카운터 증가 방식 | api/admin/[...path].js |

### 버그 수정
| 버그 | 원인 | 해결 |
|------|------|------|
| renderPODetailItemsView DOM 타이밍 | 모달이 DOM에 없는 시점에 getElementById 호출 | statusOverride 파라미터 추가 |
| 발주 재생성 500 에러 (1차) | debug 객체에서 if 블록 내부 변수(products, groups) 참조 | 해당 참조 제거 |
| 발주 재생성 500 에러 (2차) | totalGroups/groupErrors가 if 블록 내부 const로 선언 → 외부 참조 불가 | let으로 블록 밖 선언 |
| 발주 1건만 생성 | PO번호 count 쿼리가 방금 insert한 PO를 미반영 → 중복 번호 | max번호 조회 + 로컬 카운터 방식으로 변경 |
| vendor_id 없는 상품 스킵 | `if (!prod.vendor_id) continue` | vendor_id 없으면 0으로 처리, insert 시 생략 |

### 커밋 이력 (8/24~25)
| 커밋 | 내용 |
|------|------|
| `cdc2601` | 부분입고 프론트엔드 구현 |
| `bce6372` | renderPODetailItemsView DOM 타이밍 버그 수정 |
| `8bc4a9b` | 입고수량 감소 시 재고 차감 로직 보완 |
| `a4d785c` | deallocateExcessFromOrders LIFO 배정해제 |
| `1bbe77c` | 미발주 자동생성 기능 추가 |
| `d0e530c` | 재생성 로직 aggregate 방식으로 개선 |
| `4190985` | vendor_id 없는 상품 발주 생성 허용 |
| `dea3c04` | 재생성 500 에러 수정 (변수 스코프) |
| `eb18ad7` | 디버그 정보 보강 (skippedItems, pid) |
| `2e53479` | PO번호 중복 버그 수정 (max번호 + 로컬 카운터) |
| `b6ea710` | Last Modified 업데이트 |

---

## 내일 (8/25) 테스트/보완 체크리스트

### 미발주 자동생성 검증
- [ ] 기존 발주 모두 삭제 후 "미발주 자동생성" → 거래처별로 PO가 정상 생성되는지
- [ ] 생성된 PO에 품목/수량이 모두 포함되는지 (3종이면 3종 모두)
- [ ] 이미 발주대기 PO가 있을 때 → 기존 PO에 품목 추가되는지
- [ ] 콘솔 groupErrors가 빈 배열([])인지 확인
- [ ] 디버그 로깅 제거 (안정화 후)

### 부분입고 검증
- [ ] 부분입고 → 입고수량 입력 → 저장 → 재고 증가 확인
- [ ] 부분입고 → 추가 입고 → 재고 추가 증가 확인
- [ ] 부분입고 → 입고수량 감소 → 재고 차감 확인
- [ ] 부분입고 → 입고완료 전환 → 잔량 자동 채움 확인
- [ ] 입고 시 주문 배정 자동 진행 확인

### 배정/해제 검증
- [ ] 입고 → 주문 자동 배정 (결제완료→배송준비) 확인
- [ ] 입고수량 감소 → 최신 주문부터 배정 해제 (LIFO) 확인
- [ ] 발주 삭제 → 재고 0 + 배정 해제 + 주문 상태 복원 확인

### 기존 기능 회귀 테스트
- [ ] 주문 생성 → 자동 발주 생성 정상 동작
- [ ] 배송완료 처리 → 재고 차감
- [ ] 결제취소 → 배정 해제 + 판매가능수량 복원
- [ ] 반품 처리 → 재고 복원

---

## 발주/재고/배정 흐름 정리

```
주문 생성 (입금확인)
    ↓
상태 변경 → 결제완료
    ↓ (자동)
발주 자동생성 (거래처별 그룹핑)
    ↓
입고 (부분입고 / 입고완료)
    ↓ (자동)
재고 증가 (updateInventoryFromPO)
    ↓ (자동)
주문 배정 (allocateReceivedToOrders)
    ↓ (자동)
주문 상태 전환 (결제완료 → 배송준비)
    ↓
배송완료 처리
    ↓ (자동)
재고 차감
```

### 역방향 흐름
```
입고수량 감소
    ↓ (자동)
재고 차감 (diff 기반)
    ↓ (자동)
초과 배정 해제 (LIFO - deallocateExcessFromOrders)
    ↓ (자동)
주문 상태 복원 (배송준비 → 결제완료)

발주 삭제
    ↓ (자동)
received_qty → 0 설정
    ↓ (자동)
전량 배정 해제
    ↓ (자동)
재고 역산 삭제
    ↓
PO/품목 삭제
```

---

## 미처리/참고 사항

| 항목 | 상태 |
|------|------|
| 발주관리 목록 보강 | 계획됨 - 품목/발주수량/입고수량 컬럼 추가 (plan: vivid-petting-axolotl.md) |
| 디버그 로깅 제거 | 미발주 자동생성 안정화 후 console.log/groupErrors 정리 필요 |
| 푸터 사업자 정보 | 더미 데이터 → 실제 정보 확인 후 교체 필요 |
| 비밀번호 | 평문 저장 (4자리 PIN, 해싱 없음) |

---

## 현재 완료된 전체 기능

### 소비자 사이트 (index.html)
- 홈 / 방송별 상품 / 상품 상세 / 장바구니 / 주문 / 주문조회 / 회원가입·로그인·마이페이지
- 유튜브·틱톡 채널 링크 (배너, 히어로, 푸터)
- 카카오 우편번호 주소검색
- 동일방송 재구매 배송비 로직 (2차 주문 무료, 누적 10만원 이상 시 환급)

### 어드민 페이지 (admin.html) - 13개 메뉴

| # | 메뉴 | 주요 기능 |
|---|------|-----------|
| 1 | **대시보드** | 오늘/전체 주문수·매출, 상태별 카운트, 최근 주문 5건, 일/월/년별 매출 차트 |
| 2 | **거래처관리** | 목록/등록/수정/삭제, 검색, 거래처주소 |
| 3 | **상품관리** | 목록/등록/수정/삭제, 이미지 업로드, 거래처 연결, 사이즈 자유입력, 색상 한글입력 |
| 4 | **방송관리** | 검색, 상태 필터, 제목 클릭→상세(판매수량/매출/상품), 복사 기능 |
| 5 | **주문관리** | 필터, 검색, 페이징, 상태 변경+송장번호, 거래처명 표시, 주문문구 복사 |
| 6 | **발주관리** | 목록/등록/수정/삭제, 부분입고, 미발주 자동생성, 거래처별 발주 |
| 7 | **재고관리** | 재고 목록, 수동 조정, 재고 로그, 발주 입고 연동 |
| 8 | **배송관리** | 전체선택/해제, 로젠택배 엑셀 다운로드 (헤더 없는 형식) |
| 9 | **반품관리** | 검색, 주문번호→품목 조회+체크박스 선택, 환불금액 자동계산 |
| 10 | **매출관리** | 일별/상품별/방송별 탭, 검색, 전기간 비교 증감률, 비중(%), CSV 다운로드 |
| 11 | **회원관리** | 목록/검색, 회원 상세(주문내역) |
| 12 | **통계/리포트** | 매출랭킹/고객분석/방송분석, 날짜 필터, 요약 카드, CSV 다운로드 |
| 13 | **시스템관리** | 택배/계좌 설정, 관리자 계정 관리, 활동 로그 |

### DB 마이그레이션 (실행 완료)
- `sql/001_schema.sql` ~ `sql/019_partial_receiving.sql`

### API 구조
- `api/admin/[...path].js` 1개 catch-all에 모든 어드민 API 통합
- Vercel Hobby 플랜 함수 12개 제한 이내 유지

## 파일 구조 (핵심)
```
Chicmood/
├── index.html              # 소비자 SPA
├── admin.html              # 어드민 SPA (~3000줄)
├── vercel.json             # 라우팅 + CORS
├── HANDOFF.md              # 이 파일
├── api/
│   ├── _lib/auth.js        # signToken, verifyToken, requireAdmin
│   ├── _lib/response.js    # ok, fail, handleCors
│   ├── _lib/supabase.js    # supabase (anon), supabaseAdmin (service_role)
│   ├── admin/[...path].js  # 어드민 API 통합 (~1640줄)
│   ├── auth/login.js       # 로그인
│   ├── auth/register.js    # 회원가입
│   ├── broadcasts.js       # 방송 목록 (소비자용)
│   ├── broadcasts/[id].js  # 방송 상세
│   ├── images/upload-url.js # Supabase Storage 서명 URL
│   ├── orders.js           # 주문 생성
│   ├── orders/[orderNo].js # 주문 상태 변경
│   ├── orders/lookup.js    # 주문 조회
│   ├── products.js         # 상품 목록 (소비자용)
│   └── products/[id].js    # 상품 상세
└── sql/
    ├── 001_schema.sql ~ 019_partial_receiving.sql
```

## 주요 패턴
- **방송 매출 계산**: broadcast_products → order_items 매칭 (product_id 기준)
- **전기간 비교**: from/to 날짜 설정 시 동일 길이의 이전 기간 자동 계산 → 증감률 표시
- **CSV 다운로드**: 클라이언트사이드, BOM(`\uFEFF`) 포함하여 한글 Excel 호환
- **재고 diff 업데이트**: 이전 반영 수량 vs 현재 수량 차이만 적용
- **배정 해제 LIFO**: 최신 주문부터 역순으로 해제

## 알려진 제약/이슈
- Vercel Hobby 플랜 함수 12개 제한 → 어드민 API catch-all 1개로 통합
- vercel.json에 `/api/admin/:path*` rewrite 필수
- 비밀번호 평문 저장 (4자리 PIN, 해싱 없음)
- 브라우저 캐시 강하게 걸림 → 배포 후 `?v=숫자` 붙이거나 Ctrl+Shift+R 필요

## 다음 세션 시작 시 프롬프트
```
CHICMOOD 어드민 고도화/안정화 작업을 이어서 진행합니다.
HANDOFF.md 파일을 읽고 현재 상태를 파악해주세요.
발주관리 (부분입고/미발주 자동생성) 테스트 및 보완을 이어갈 예정입니다.
```
