# GS2500 공통 데이터·계산 계약

이 디렉터리는 매니저·점주 흐름을 기존 `demo/` 3D에 연결합니다. 기존 엔진 내부는 바꾸지 않습니다. 판매·점포명·재고·이벤트·회고는 합성 데모이며 실제 GS25 데이터가 아닙니다.

## 식별자

| 점포 ID | 표시 이름 | 기존 3D ID | 맵 | 매대 ID | fixture |
| --- | --- | --- | --- | --- | --- |
| H-0412 | 삼성역점 | samsung | office | B-03 | promo |
| H-0521 | 역삼중앙점 | station | express | B-01 | promo |
| H-0618 | 대치사거리점 | residential | residential | B-05 | promo |
| H-0730 | 선릉역점 | cafe | cafe | B-02 | promo |

현재안은 `hq`/`candidateId: current`입니다. 후보 A=`owner`, B=`balanced`, C=`discovery`입니다. 기존 3D 전광판의 A–D 문자와 의미가 다를 수 있으므로 연결은 문자가 아닌 **scenario key**를 사용합니다. 상세 화면에 후보명과 scenario를 함께 표시합니다.

`data.js`의 `getWorldConfig({storeId,bayId,candidateId})`를 기존 `createWorld`에 전달합니다. 이름은 위 표의 합성 표시 이름, 내부 계산은 기존 ID입니다. 24개 상품은 `demo/model.js`의 PRODUCTS를 그대로 가져옵니다. 재고는 기존 점포의 stockScale 및 `splitDayInventory`, 좌표와 이웃은 `getFixturePlacements`를 그대로 사용합니다. 복제 상품·별도 정적 선반을 만들지 않습니다.

## 데이터 API

- `STORES`, `BAYS`: 동결된 점포·매대·후보 정의. `yoy`는 % 단위, `targetAchievement`도 % 단위, `sales`는 원 단위입니다. 합성 지난달 관찰이며 30일 계산치가 아닙니다.
- `getStore(id)`, `getBay(storeId,bayId)`, `getCandidate(storeId,bayId,candidateId)`: 잘못되거나 교차 점포인 ID에는 RangeError.
- `getInventory(storeId)`: 새로운 `{total,shelf,backroom,capacity}` SKU별 정수 맵. `total=shelf+backroom`.
- `getPlacements(storeId,scenario)`: 모든 실제 3D fixture의 위치. 매대 화면은 `fixtureId==='promo'`로 필터합니다.
- `getShelfRows(storeId,scenario)`: 위에서 아래로 4·3·2·1층, 각 6개 상품, 좌표·열·이웃·총재고·매대·창고재고 포함.
- `getWorldConfig`: 기존 24시간 행동 엔진 입력. 1,000 잠재 고객, 기존 점포 seed 및 정확한 초기 재고. JEV provider를 포함하거나 호출하지 않습니다.

## 30일 분석 모델

`simulateComparison({storeId,bayId,personaCatalog})`는 외부 호출 없이 결정론적으로 계산하며 다음을 반환합니다. 실제 앱은 기존 `loadPersonaCatalog()`로 로컬 파일의 NVIDIA 공개 합성 페르소나 1,000개를 읽어 **반드시** `personaCatalog`를 전달합니다. 입력이 빠진 경우만 명시적으로 `authored-five-profile-fixture`라는 레거시 테스트 모드가 되며, 로딩 실패 시 앱이 이 모드로 자동 대체하면 안 됩니다.

```js
{
  storeId, bayId, completed: true, days: 30,
  engine: { id: 'local-analytic-30day-v1', jevCalled: false, /* 출처·한계 */ },
  baseline, candidates: [/* A, B, C */], assumptions,
  cohortKey, inputFingerprint, inputs, metricDefinitions,
  personaSource: {dataset, revision, count, sourceIds, behaviorInputFingerprint}
}
```

각 결과는 `candidateId,scenario,name,revenue,profit,stockoutRate,deltaPercent,paidUnits,payments,purchaseDemand,stockoutDemand,daily,positions,initialInventory,finalInventory`를 포함합니다. `stockoutRate`는 0~1 비율입니다. `deltaPercent`는 % 값으로, `100*(후보매출-현재매출)/현재매출`; 현재매출 0이면 비교가능한 증가율이 없어 0을 반환하며 재고 경고를 함께 제공합니다. 이는 0% 개선의 실증이 아닙니다.

`daily`는 정확히 30개 `{day:1..30,revenue,profit,payments,paidUnits,purchaseDemand,stockoutDemand,openingInventory,receivedBySKU,paidUnitsBySKU,closingInventory,shelfStock,backroomStock,events,...}`입니다. 모든 합계는 당일 값의 합입니다.

### 실제 수행하는 계산

1. 점포 seed로 매일 1,000개의 잠재 기회를 만듭니다. 소스 카탈로그를 전달한 앱에서는 1,000개의 서로 다른 원본 합성 UUID를 사용하며, 기술적 렌더링용 5개 `archetypeIndex`로 축약하지 않습니다. 매일 같은 1,000명에게 새 필요·예산을 가정하되 그날 방문시간·입장 여부·상품별 난수는 모든 안에서 같습니다. 기존 페르소나 어댑터의 예산·카테고리 선호·시간대 가중치를 사용하고 `deriveBehavior/productPolicy`의 명시적 목적, 신상품/상품 기피, 입력 기억, 가격 민감도, 장바구니·예산 제한을 실제 선택에 반영합니다. 원본 인물 스토리는 보존되지만 해석은 제한된 규칙이며, 사람 행동을 학습했거나 JEV로 판단했다고 주장하지 않습니다. 수업·출퇴근 등의 실제 활동을 추론하지 않습니다.
2. 기존 `promo` 상품 좌표에서 1~4층 노출 `[.32,.73,.78,.4]`, 중앙 열 보정 최대 `.06`, 음료·식사/간식의 인접 보정 `.055`를 계산합니다. 실제 측정한 계수가 아닙니다. 가시성 난수와 카테고리 선호·가격 민감도·합성 행사 조건으로 구매 희망 상품을 정합니다. 가격은 예산 초과 여부뿐 아니라 잔여 예산에서 차지하는 비율의 연속적인 패널티를 줍니다. 예를 들어 생수만 구매하는 1,600원 예산은 생수 구매를 허용하고 다른 상품을 배제합니다.
3. 예산을 넘거나 상품이 보이지 않으면 구매하지 않습니다. 매대 수량이 없으면 결품으로 기록합니다. 창고에 남아 있는 매대 결품과 점포 전체 품절을 구분합니다. 선택된 상품은 즉시 합성 결제 처리하므로 의도만으로 매출을 올리지 않습니다. 실제 동선·계산대 대기는 이 분석에 없습니다.
4. 매시간 시작 시 매대 수량이 용량의 35% 이하이면 창고에서 용량까지 보충합니다. 창고 재고를 새 재고처럼 만들지 않습니다. 2일차부터 매일 06시 SKU별 초기 총재고의 26%(내림)를 받는 **고정 합성 납품 가정**이 있습니다. 후보마다 같은 수량이며 실제 발주 실행이 아닙니다. 초기 0개 SKU에는 납품도 0개이고 구매가 차단되며 경고를 반환합니다.
5. 결제매출은 `sum(결제수량 * 단가)`, 매출총이익은 `sum(결제수량 * (단가 - 합성원가))`, 결품률은 `미충족 구매수량 / 구매시도 수량`입니다. 합성원가는 기존 3D와 동일하게 카테고리별 단가 비율 .71/.64/.62/.68을 10원 단위 반올림합니다. 인건비·폐기·세금·유통기한은 제외합니다.

입력 재현용 fingerprint는 JSON 입력에 대한 비암호학적 FNV-1a입니다. 소스 UUID와 어댑터 예산·선호·행동 조건·시간대·기억도 포함합니다. 보안 서명이나 외부 검증 토큰이 아닙니다. 같은 코드 버전과 입력이면 같은 결과를 반환합니다. 카탈로그는 하나의 불변 입력으로 다루며 내용 변경 시 새 배열로 전달합니다. 진열 좌표를 바꾸어 매출·결품이 달라지는지를 비교하는 수치 모델이지 검증된 인과적 예측이 아닙니다.

### 3D와의 관계를 반드시 표시

두 모델이 공유하는 것은 **점포·매대·24 SKU·초기재고·후보·좌표·원본 합성 페르소나 카탈로그**입니다. 30일 분석은 행사 매대의 24개 상품만 계산하며, 전체 점포 상품의 매출이 아닙니다. 다른 일반 매대 위치 효과·사람별 동선·혼잡·직원 이동은 계산하지 않습니다. 입력에 주어진 기억은 고려하지만 구매 후 기억을 다음날로 누적하지 않습니다. 기존 3D는 더 상세한 **별도 하루 행동 관찰**입니다. 3D 수치를 30일 매출의 재생이나 그 수치를 그대로 30배 한 결과로 소개하면 안 됩니다. 30일 숫자는 상세/전광판/승인/점주에서 같은 결과 객체를 사용합니다.

## 테스트

`node --test workspace/data.test.js workspace/forecast.test.js`

공통 식별자, 기존 엔진의 초기 재고·좌표와 일치, 30일 재현성, 동일 조건, 결제 합산, 일별 재고 보존, 0재고 구매 차단, 보충, 잘못된 입력을 검사합니다. 원본 1,000개 UUID 사용·렌더링용 분류 무관성·생수만 구매·1,600원 예산·가격 변화·신상품 기피·입력 기억도 검사합니다. 인간다운 판단이나 실제 매출 예측 정확도를 검증한 것은 아닙니다.
