# 전국 GS25 시뮬레이션용 데이터 출처와 한계

확인일: 2026-09-21. `전국`은 자료 제공 범위이지 모든 GS25에 필요한 값이 빠짐없이 존재한다는 의미가 아니다. 자료 다운로드/키 발급/실제 연계 여부는 각각 구분한다.

| 우선순위·자료 | 범위/단위 | 확보할 변수 | 접근·판단상의 한계 |
| --- | --- | --- | --- |
| P0 소진공 상가(상권) CSV | 전국 점포 단위, 분기 | 원문 상호/지점명, 주소, 업종, 좌표, 소스 ID | 2026-06-30 스냅샷 확인. 운영 여부·브랜드 매칭에 오차 가능. 도면/판매/면적 없음 |
| P0 GS25 공식 매장찾기 | 조회되는 점포별 | 공식 명칭·주소·서비스 태그 | 실제 UI 확인. 공개 전점 일괄 API/대량 재사용 허가는 확인하지 않음 |
| P0 GS 본사/점주 제공 자료 | 협의한 점포별 | 도면, 진열, SKU 판매·재고·입고·폐기·행사 | **아직 확보 안 됨**. 매장 성과 모델 검증의 핵심 |
| P1 SGIS 소지역 통계 | 전국, 격자/행정구역, 통계연도별 | 연령·가구·거주/종사 인구·주택 | 총조사 집계이며 실시간 방문자 아님. 경계연도 맞춤 필요. API 키/파일 신청 확인 |
| P1 서울 생활인구 | 서울, 시간별·250m 격자 또는 행정동 | 지역 시간대별 추정 인구와 구성 | **서울 한정**, 통신자료 기반 추정. 점포 방문객으로 직접 대입 금지 |
| P1 서울 상권 추정매출 | 서울, 분기·상권·업종 | 매출 규모·요일/시간 구간 분포 | 카드자료 보정 추정. GS25 POS나 SKU별 판매가 아님 |
| P1 기상청 ASOS/AWS | 전국 관측소, 분/시간/일 | 기온·강수·풍속·결측/품질 정보 | 매장별 직접 관측은 아님. 인접 관측소 연결도 추정이며 API 인증 필요 |
| P1 TourAPI | 전국 관광 콘텐츠, 행사 단위 | 행사 기간·장소·분류·관광시설 | 일정/콘텐츠이지 참석 인원·판매 효과가 아님. 활용신청/인증키 필요 |
| P1 전국문화축제표준데이터 | 기관 등록 축제 단위 | 행사명·시작/종료·주소·좌표·기준일 | 소규모 팝업/대학행사까지 전부 포함하지 않음. 최신 기준일이어도 과거 행사일 수 있음 |
| P2 GS 공식 행사상품·보도자료 | 상품/프로모션/사례 단위 | 신상품 출시일·행사기간·대상 조건 | 전 점포 취급/재고/실시간 트렌드 보장이 아님. 제외 점포·선택 사례를 확인 |

## 확인한 공식 링크

1. [소진공 전국 상가 CSV](https://www.data.go.kr/data/15083033/fileData.do) · [기계 판독 메타데이터](https://www.data.go.kr/catalog/15083033/fileData.json)
2. [소진공 상가 OpenAPI](https://www.data.go.kr/data/15012005/openapi.do): 전국·시도·반경 조회, JSON/XML. 이번 원본은 API 키가 없는 CSV 다운로드 경로로 확보한다.
3. [GS25 공식 페이지 / 매장 찾기](https://www.gsretail.com/brand/gs25): 삼성역점 공개 조회 표본은 `official-store-sample.json`에 기록.
4. [SGIS 소지역 통계 제공 목록](https://data.kostat.go.kr/sbchome/serviceData/svcOfrDataList.do?curMenuNo=OPT_0) · [통계 API](https://sgis.mods.go.kr/developer/html/openApi/api/data.html)
5. [서울 생활인구 소개](https://data.seoul.go.kr/dataVisual/seoul/seoulLivingPopulation.do) · [250m 내국인 자료](https://data.seoul.go.kr/dataList/OA-22784/S/1/datasetView.do) · [행정동 집계](https://data.seoul.go.kr/dataList/OA-23016/S/1/datasetView.do)
6. [서울 상권 추정매출](https://data.seoul.go.kr/dataList/OA-15572/S/1/datasetView.do) · [산출 방식 소개](https://golmok.seoul.go.kr/introduce.do)
7. [기상청 ASOS 관측](https://data.kma.go.kr/data/grnd/selectAsosRltmList.do?pgmNo=36&tabNo=2) · [API 허브](https://apihub.kma.go.kr/apiList.do) · [이용 안내](https://apihub.kma.go.kr/apiInfo.do)
8. [한국관광공사 TourAPI](https://www.data.go.kr/data/15101578/openapi.do?recommendDataYn=Y)
9. [전국문화축제표준데이터](https://www.data.go.kr/data/15013104/standard.do)
10. [GS25 행사상품 안내](https://gs25.gsretail.com/gscvs/ko/products/event-goods?uiel=Mobile): 과거 주소는 홈페이지 개편으로 경로가 달라질 수 있음. 상품 목록 전체를 현재 취급상품이라고 간주하지 않음.

## 연계 순서

**점포 좌표 → 해당 시점의 행정구역/격자 → 주변 시설·인구 → 시간별 날씨·행사 → 점포 실측·POS**로 연결한다. 서울에만 존재하는 지표는 다른 지역에 복제하지 않는다. 전국 공통 최소 변수와 지역별 추가 변수를 나눈다.

각 값에 `source`, `source_record_id`, `observed_at`, `valid_from/to`, `geography_version`, `evidence_kind`, `quality_flags`를 둔다. `evidence_kind`는 공식 조회 관측 / 통계 추정 / 현장 측정 / 모델 가정 / 언론 보도로 구분한다. 출처가 다른 확실성을 임의의 단일 confidence 숫자로 압축하지 않는다.

## 시뮬레이션으로 넘길 때

- 인구·상권 통계는 방문자 구성의 **사전분포**다. 소설처럼 자세한 합성 페르소나도 실제 고객 행동의 정답이 아니다.
- 행사 시작/끝·지리적 영향권은 입력 문맥이다. 방문율·구매량의 계수는 별도 관측/추정한다.
- 진열의 효과를 비교할 때 동일 점포·동일 도착 일정·동일 수요 난수를 후보 A/B/C에 공유하고, 위치/이웃과 재고 차이만 바뀌도록 한다. 반복 시드로 불확실성을 함께 측정한다.
- 한 점포의 1,000회 방문 실험과 전국 점포 1,000곳 표본은 다른 단위다. UI와 내보내기 파일에 점포 수·후보 수·방문 수·반복 수·시뮬레이션 날짜를 각각 표기한다.
- 24시간 가속 시뮬레이션은 시간대별 도착률·영업시간·보충·행사·행동 시간을 동일 가상 시계에 올린 후에 주장한다. 현재 합성 데모의 압축 사건 스케줄은 실제 24시간 자료가 아니다.

## 추가로 요청해야 하는 최소 실측 묶음

본사/점주에게 익명화된 `점포×날짜×시간대×SKU 판매`, 기초/말 재고·입고·폐기, 행사/가격 이력, 진열 변경 시각, 도면/매대 위치를 요청한다. 고객 이름·전화번호·개별 결제 수단은 필요하지 않다. 실제 제공이나 외부 전송은 이번 조사에 포함하지 않았다.
