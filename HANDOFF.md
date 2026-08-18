# CHICMOOD 프로젝트 핸드오프

## 프로젝트 위치
`C:\Users\daekonkim\Desktop\Chicmood`

## 배포 URL
- 소비자 사이트: https://chicmood.vercel.app
- 어드민 페이지: https://chicmood.vercel.app/admin
- 관리자 계정: `01000000000` / `1004`

## 일정
- **8/15(토)~17(월)**: 지선미 대표 테스트 기간 (피드백 접수)
- **8/18(월)**: 피드백 기반 1차 보완 완료
- **8/19(화)~21(목)**: 추가 고도화/안정화
- **8/22(금)**: 오픈 목표

## 기술 스택
- **프론트엔드**: Vanilla JS SPA (index.html, admin.html) + Tailwind CDN
- **백엔드**: Vercel Serverless Functions (Node.js)
- **DB**: Supabase (PostgreSQL) + Supabase Storage (이미지)
- **인증**: JWT (jsonwebtoken), 4자리 PIN
- **주소검색**: 카카오 Daum Postcode API

---

## 8/18 보완 작업 내역

### 관리자 페이지 (admin.html)

| 항목 | 변경 내용 | 수정 파일 |
|------|----------|----------|
| 로젠택배 엑셀 오류 | 헤더행 제거 → 데이터만 출력 (로젠 형식 맞춤) | admin.html |
| 거래처 캐시 버그 | 거래처 등록/삭제 후 vendorListCache 초기화 추가 | admin.html |
| 상품등록 필드 정리 | 판매가/원가/할인/설명 삭제, 매입가만 유지 | admin.html |
| 사이즈 자유입력 | DB에 size 컬럼 추가, 텍스트 직접 입력 방식 | admin.html, api/admin/[...path].js, sql/011_product_size.sql |
| 색상 한글 입력 | hex코드 입력 → 한글 이름만 입력 (베이지, 네이비 등) | admin.html |
| 거래처 담당자 삭제 | 담당자 필드 폼/테이블에서 제거 | admin.html |
| 거래처 이메일→주소 | 이메일 필드를 거래처주소로 변경 | admin.html |
| 거래처 중복등록 방지 | 더블클릭 방지 플래그(_savingVendor) 추가 | admin.html |
| 방송 설명란 삭제 | 방송 모달에서 description textarea 제거 | admin.html |
| 방송 상품 로딩 | openBroadcastModal async 변경, 매번 상품 새로 fetch | admin.html |
| 주문관리 거래처명 | product→vendor 매핑으로 거래처명 컬럼 추가 | admin.html, api/admin/[...path].js |
| 배송관리 전체선택 | id 타입 불일치(숫자/문자열) 버그 수정 | admin.html |
| 시드 데이터 정리 | 동대문/대구/광저우 거래처 3개 + 중복 오진호 1개 삭제 | DB 직접 |

### 소비자 페이지 (index.html)

| 항목 | 변경 내용 | 수정 파일 |
|------|----------|----------|
| 입금계좌 수정 | 110-123-456789 → 100-199-583668 (3곳) | index.html |
| 택배비 수정 | 3,000원 → 4,000원 (2곳) | index.html |
| 틱톡 LIVE 추가 | 배너 + 히어로 섹션 + 푸터에 틱톡 링크/아이콘 추가 | index.html |
| 할인/원가 표시 삭제 | 상품카드 할인% 배지, 원가 취소선, X% OFF 전부 제거 | index.html |
| 방송 설명/할인 삭제 | 방송 카드에서 설명문구, "최대 X% OFF" 제거 | index.html |
| 색상 표시 변경 | hex 원형 칩 → 한글 텍스트 버튼 선택 | index.html |
| 사이즈 표시 변경 | 하드코딩 F/S/M/L → 관리자 입력 텍스트 그대로 표시 | index.html |
| 정품보장/교환/반품 삭제 | 아이콘 3개 영역 삭제 | index.html |
| 소재/설명 삭제 | 상품 상세 하단 설명 영역 삭제 | index.html |
| 주소 검색 기능 | 카카오 Daum Postcode API 연동 (우편번호+기본주소+상세주소) | index.html |

### 백엔드/DB

| 항목 | 변경 내용 |
|------|----------|
| products 테이블 | size TEXT 컬럼 추가 (sql/011_product_size.sql) |
| 상품 API (admin) | POST/PATCH/GET에 size 필드 반영 |
| 상품 API (consumer) | api/products/[id].js에 size 필드 추가 |
| 주문 API (admin) | 거래처명 조회 로직 추가 (product→vendor 매핑) |

### 배포 커밋 이력

| 커밋 | 내용 |
|------|------|
| `36cab5c` | 대표님 보완요청 반영: 상품등록/거래처/방송/주문/택배 개선 |
| `3de0337` | 소비자 페이지: 할인/원가 제거, 색상 한글, 틱톡/계좌/택배비 |
| `a3d7976` | 사이즈 텍스트 그대로 표시, 정품보장/교환/소재 삭제 |
| `5ecb74e` | 주소 검색(카카오 우편번호 API) 연동 |
| `d7404c1` | 배송관리 전체선택 버그 수정 |

---

## 미처리/참고 사항

| 항목 | 상태 |
|------|------|
| 푸터 사업자 정보 | 더미 데이터 (사업자등록번호 123-45-67890, 주소 테헤란로 123) → 실제 정보 확인 후 교체 필요 |
| 카카오채널 메뉴 축소 (6→3개) | 카카오비즈 관리자 페이지에서 직접 설정 (코드 변경 아님) |
| 방송 사진 미표시 | 상품 이미지 업로드 + 방송에서 상품 체크 후 저장 + 상태 라이브 설정 필요 |

---

## 현재 완료된 전체 기능

### 소비자 사이트 (index.html)
- 홈 / 방송별 상품 / 상품 상세 / 장바구니 / 주문 / 주문조회 / 회원가입·로그인·마이페이지
- 유튜브·틱톡 채널 링크 (배너, 히어로, 푸터)
- 카카오 우편번호 주소검색
- 진입 경로: 카카오 채널 "시크무드" 하단 구매하기 버튼 또는 직접 URL

### 어드민 페이지 (admin.html) - 13개 메뉴 (프로세스 순서)

| # | 메뉴 | 주요 기능 |
|---|------|-----------|
| 1 | **대시보드** | 오늘/전체 주문수·매출, 상태별 카운트, 최근 주문 5건, 일/월/년별 매출 차트 |
| 2 | **거래처관리** | 목록/등록/수정/삭제, 검색, 거래처주소 |
| 3 | **상품관리** | 목록/등록/수정/삭제, 이미지 업로드, 거래처 연결, 사이즈 자유입력, 색상 한글입력 |
| 4 | **방송관리** | 검색, 상태 필터, 제목 클릭→상세(판매수량/매출/상품), 복사 기능 |
| 5 | **주문관리** | 필터, 검색, 페이징, 상태 변경+송장번호, 거래처명 표시 |
| 6 | **발주관리** | 목록/등록/수정/삭제, 거래처별 발주 |
| 7 | **재고관리** | 재고 목록, 수동 조정, 재고 로그, 주문 시 자동 차감/복원 |
| 8 | **배송관리** | 전체선택/해제, 로젠택배 엑셀 다운로드 (헤더 없는 형식) |
| 9 | **반품관리** | 검색, 주문번호→품목 조회+체크박스 선택, 환불금액 자동계산 |
| 10 | **매출관리** | 일별/상품별/방송별 탭, 검색, 전기간 비교 증감률, 비중(%), CSV 다운로드 |
| 11 | **회원관리** | 목록/검색, 회원 상세(주문내역) |
| 12 | **통계/리포트** | 매출랭킹/고객분석/방송분석, 날짜 필터, 요약 카드, CSV 다운로드 |
| 13 | **시스템관리** | 택배/계좌 설정, 관리자 계정 관리, 활동 로그 |

### DB 마이그레이션 (실행 완료)
- `sql/001_schema.sql` ~ `sql/011_product_size.sql`

### API 구조
- `api/admin/[...path].js` 1개 catch-all에 모든 어드민 API 통합
- Vercel Hobby 플랜 함수 12개 제한 이내 유지

## 메뉴 순서 (= 업무 프로세스 흐름)
```
거래처 등록 → 상품 등록 → 방송 등록 → 주문 발생 → 발주 → 재고 → 배송 → 반품 → 매출 → 회원 → 통계 → 시스템
```
상단 탭 바(HTML 하드코딩)와 사이드바(NAV_ITEMS JS) 두 곳 모두 동일 순서로 유지해야 함.

## 주요 패턴
- **방송 매출 계산**: broadcast_products → order_items 매칭 (product_id 기준)
- **전기간 비교**: from/to 날짜 설정 시 동일 길이의 이전 기간 자동 계산 → 증감률 표시
- **CSV 다운로드**: 클라이언트사이드, BOM(`\uFEFF`) 포함하여 한글 Excel 호환
- **재고 자동 차감**: 주문 상태 '결제완료' 시 차감, '취소' 시 복원

## 알려진 제약/이슈
- Vercel Hobby 플랜 함수 12개 제한 → 어드민 API catch-all 1개로 통합
- vercel.json에 `/api/admin/:path*` rewrite 필수
- 비밀번호 평문 저장 (4자리 PIN, 해싱 없음)
- 브라우저 캐시 강하게 걸림 → 배포 후 `?v=숫자` 붙이거나 Ctrl+Shift+R 필요

## 파일 구조 (핵심)
```
Chicmood/
├── index.html              # 소비자 SPA
├── admin.html              # 어드민 SPA (~2900줄)
├── vercel.json             # 라우팅 + CORS
├── HANDOFF.md              # 이 파일
├── api/
│   ├── _lib/auth.js        # signToken, verifyToken, requireAdmin
│   ├── _lib/response.js    # ok, fail, handleCors
│   ├── _lib/supabase.js    # supabase (anon), supabaseAdmin (service_role)
│   ├── admin/[...path].js  # 어드민 API 통합 (~1370줄)
│   ├── auth/login.js       # 로그인
│   ├── auth/register.js    # 회원가입
│   ├── broadcasts.js       # 방송 목록 (소비자용)
│   ├── broadcasts/[id].js  # 방송 상세
│   ├── images/upload-url.js # Supabase Storage 서명 URL
│   ├── orders.js           # 주문 생성
│   ├── orders/[orderNo].js # 주문 상태 변경
│   ├── orders/lookup.js    # 주문 조회
│   ├── products.js         # 상품 목록 (소비자용)
│   └── products/[id].js    # 상품 상세 (size 필드 포함)
└── sql/
    ├── 001_schema.sql ~ 011_product_size.sql
```

## 다음 세션 시작 시 프롬프트
```
CHICMOOD 어드민 고도화/안정화 작업을 이어서 진행합니다.
HANDOFF.md 파일을 읽고 현재 상태를 파악해주세요.
지선미 대표 테스트 피드백을 기반으로 수정 작업을 진행할 예정입니다.
목표: 8/22(금) 오픈
```
