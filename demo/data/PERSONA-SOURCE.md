# Nemotron 한국어 합성 페르소나 코호트

이 파일은 **실제 한국인 1,000명이나 GS25 고객 데이터가 아니다.** NVIDIA가 공개한 합성 인물 데이터셋의 원본 레코드 1,000개를 로컬 데모에 포함한다. 원본 설명이 상세해도 관측된 방문·구매 이력을 뜻하지 않는다. 이 부분표본은 한국 인구나 GS25 고객을 대표한다고 주장하지 않는다.

## 출처와 사용 허가

- 제작자: NVIDIA Corporation.
- 공식 데이터셋: [nvidia/Nemotron-Personas-Korea](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea).
- 검증·고정 리비전: `ada0f5b53a38bb5a30cce09358adde883c1ab63a`.
- [고정된 공식 README와 데이터 설명](https://huggingface.co/datasets/nvidia/Nemotron-Personas-Korea/blob/ada0f5b53a38bb5a30cce09358adde883c1ab63a/README.md).
- 라이선스: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). 원본 데이터셋 메타데이터와 README의 CC BY 4.0 표시를 확인했다. 상업적 이용을 포함한 재사용 시 출처·라이선스·변경 사실을 표시한다.
- 표시 문구: “NVIDIA Corporation — Nemotron-Personas-Korea, CC BY 4.0. GS2500이 부분표본을 선택하고 시뮬레이션용 가정 파라미터를 별도로 작성함.”

공식 데이터는 19세 이상 합성 인물 1,000,000개이며 원본 스키마는 26필드다. 이름 전용 필드는 없으므로 화면 이름은 원문에서 `…씨` 패턴으로 추출하거나 `합성 인물 NNNN`으로 표시한다. 이름은 중복될 수 있지만 원본 UUID 1,000개는 모두 서로 다르다. 원문과 데이터셋 문서 사이에 불일치가 있다면 원문을 보존하고 출처의 합성 데이터 한계를 따른다.

## 재현 가능한 추출

`nemotron-korea-sample.json`은 원본 26필드를 수정하지 않은 `{rowIndex,row}` 1,000개, 공식 스키마, 출처·라이선스·리비전, 추출 메타데이터를 포함한다. 이야기 13필드와 구조화된 사실 12필드, UUID 1개가 보존된다. 리스트처럼 생긴 문자열도 원래 문자열 그대로 보존하며 실행하거나 `eval`하지 않는다.

원본 `default/train`의 row index 구간을 동일 크기 20개로 나누고 각 구간에서 연속 50행을 선택했다. 시드 `20260921`과 FNV-1a 스타일의 32비트 문자열 해시가 블록 시작점을 정한다. **이것은 행 번호 구간별 결정적 엔지니어링 표본이며, 성별·연령·지역 층화나 확률가중 인구표본이 아니다.** 연속 블록의 군집 효과와 원본 배열 순서의 편향이 있을 수 있다.

약 2GB인 전체 parquet 파일을 내려받는 대신 Hugging Face datasets-server `/rows` API를 50행씩 20번 호출했다. 매 응답의 `x-revision`이 고정 리비전과 일치하는지, 행 번호가 맞는지, 잘린 필드가 없는지, UUID가 고유한지 확인했다. 각 요청 URL·offset은 JSON에 있다. 다른 리비전이 반환되면 importer는 중단하며 몰래 최신 데이터로 대체하지 않는다.

- 로컬 원본 JSON 크기: 약 4.7MiB.
- 무결성 해시 대상: `JSON.stringify(payload.records)`의 UTF-8 바이트.
- SHA-256: `119f09e515419b933bef808405e805b13f376b972895f736c8fdf41cbedd6976`.
- `retrievedAt`만 새 실행 시 바뀌며 같은 리비전·추출법이면 원본 레코드 해시는 같다.

재추출과 검증:

```sh
cd /Users/yuchanlee/GS/demo
node scripts/import-personas.mjs
node --test personas.test.js
```

추출은 공개 데이터의 읽기 요청만 수행하며 API 키가 필요 없다. 앱 실행 중에는 번들에 포함된 로컬 JSON을 읽으므로 Hugging Face에 개별 고객 요청을 보내지 않는다.

## 원문과 시뮬레이션 가정의 경계

| 항목 | 보존·변환 방식 | 해석 한계 |
| --- | --- | --- |
| `sourceFacts` | 나이·성별·직업·지역 등 원본 사실 필드 그대로 | 합성 인물의 설정이며 실제 사람의 개인정보가 아님 |
| `sourceNarratives`, `story` | 모든 원문 이야기 필드 보존, story에는 필드 이름만 구분자로 추가 | 현재 시각의 실제 행동이나 관측 구매로 바꾸지 않음 |
| 표시 이름 | 원문에서 이름 추출 또는 명시적 합성 라벨 | 이름으로 개체를 식별하지 않고 UUID를 사용 |
| `budget` | UUID 해시로 6천·8천·1만·1.2만·1.5만원 중 하나를 설정 | 알려진 소득·실제 지출이 아니라 작성한 가정 |
| `affinity` | 중립 0.5, 긍정적인 음식 서술 근거가 있으면 0.62 | 키워드 규칙의 약한 사전값이며 측정 취향 아님; 근거 원문 함께 제공 |
| 새로움 선호 | 음식 서술의 탐색·반복 키워드에 0.65·0.4, 모르면 0.5 | 자연어를 완전히 해석하지 못하는 가정 |
| 시간대 가중치 | 기본 방문 기회 분포; 명시적 심야 근무 문장만 야간 기회 가중 | 관측 스케줄 아님; 나이·성별로 수업·출퇴근·운동을 단정하지 않음 |
| 방문 미션 | 현재 시간대에 가능한 중립적 방문 기회 문구 | 입점·구매는 필수가 아님; 원래 명시된 구매 목표·제약은 보존 |
| `archetypeIndex` | UUID 해시를 5개 기술 버킷으로 분류 | 기존 엔진 호환용 숫자일 뿐 기존 다섯 직업/성격 프로필을 의미하지 않음 |
| 가격 민감도·최대 바구니·시간 예산 | 별도 `behavior` 가정 | NVIDIA 레이블이나 GS 실측값이라고 표시하면 안 됨 |

어댑터는 나이·성별·학력·주거·직업만으로 구매 예산이나 강한 상품 취향을 부여하지 않는다. 모든 수치 변환은 `derived` / `behavior.status` / `schedule.status`에 작성한 가정임을 남긴다. 카테고리 근거 문장은 원문 필드 이름과 함께 제공한다.

`createVisitPersona(profile,hour)`는 원문 story와 명시적 목표를 변경하지 않는다. 생수만 구매 같은 명시적 구매 미션은 심야에도 유지한다. 반면 기존 다섯 명 데모 템플릿의 `수업 사이 간식` 같은 상황 문구는 심야에 현재 행동으로 단정하지 않고 원래 미션을 provenance로 보관한다. 각 시간대 기회는 허용된 상황일 뿐 특정 인물에게 일어났다고 주장하는 사건이 아니다.

명시적 구매 미션 확장 필드와 원문의 알레르기·채식·금지 등 제약 후보 문장을 `behavior.explicitGoals`, `goalEvidence`에 보존한다. **키워드 추출은 완전한 식이·행동 해석기가 아니다.** 식품 안전 필터나 실제 고객에 대한 추천에 바로 사용할 수 없으며 JEV 입력에는 추출된 숫자뿐 아니라 원문과 근거를 함께 제공해야 한다. JEV도 사실 검증된 소비자 모델이 아니며 실제 성과 예측 정확도를 별도 검증해야 한다.

## 브라우저 API

`loadPersonaCatalog({fetchImpl})`은 로컬 JSON의 출처·리비전·라이선스·고유 UUID를 확인한 후 프로필 배열 1,000개를 반환한다. 배열의 비열거 `metadata`에 원본 출처·추출·무결성 정보를 제공한다. `adaptPersonaRecord(row,index,metadata)`는 개별 원본 행을 변환하고 `createVisitPersona(profile,hour)`는 원본을 수정하지 않는 방문별 사본을 만든다. 테스트에서는 전체 원본의 SHA-256, UUID 고유성, 원문 보존, 인구통계 변수로 취향을 단정하지 않는 성질, 시간대와 명시적 목표 보존을 검사한다.
