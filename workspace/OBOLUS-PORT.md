# Obolus UI → GS2500 포트 기록

작성일: 2026-09-22

이 문서는 GS2500 운영 워크스페이스에 적용한 Obolus UI의 출처, 변환 범위와 제외 사항을 기록합니다. **화면 구성과 표현 계층의 포트이며, 원본 서비스의 업무 로직이나 외부 연결을 통합한 것이 아닙니다.**

## 원본과 사용 근거

- 원본 저장소: [DanRo-AX/Obolus-GoogleCloudAI-Solana](https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana)
- 확인한 커밋: [`ae560b77978d741312281e8468e51618aa7ae860`](https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/tree/ae560b77978d741312281e8468e51618aa7ae860)
- 이번 작업에서 사용자가 본인 팀의 저장소임을 확인하고 GS2500에서의 재사용을 명시적으로 허용했습니다. UI 소스의 재사용은 **이번 작업의 사용자 허용**을 근거로 합니다.
- 확인한 원본 체크아웃에는 프로젝트 전체에 적용되는 공개 라이선스 파일이 없었습니다. 공개 GitHub 저장소라는 이유로 일반적인 오픈소스 사용·재배포 권한이 있다고 주장하지 않습니다.
- 이 문서는 새로운 프로젝트 라이선스를 부여하지 않습니다. 이 포트와 무관한 제3자 사용·배포 권한은 권리자와 별도로 확인해야 합니다.
- 글꼴은 UI 소스와 별개인 SIL Open Font License 1.1의 적용을 받습니다. 아래 글꼴 고지와 함께 배포해야 합니다.

## 이식 방식

원본은 React/TypeScript와 Tailwind 기반입니다. GS2500의 기존 vanilla JavaScript 렌더링, 이벤트 처리, 승인·관찰 상태와 계산 기록을 유지하면서 다음 방식으로 화면을 옮깁니다.

1. 원본 색상·글꼴·간격·테두리 토큰과 컴포넌트의 시각적 구성을 일반 CSS로 옮깁니다.
2. JSX의 표현 구조를 기존 `views.js`와 `operations-view.js`의 HTML 템플릿에 맞춥니다. React 훅이나 원본 상태 저장소를 가져오지 않습니다.
3. 원본 업무 데이터 대신 GS2500의 점포, 운영 이슈, 진열 후보, 관찰과 승인 계약을 연결합니다.
4. `cardGradient.ts`의 독립적이고 결정적인 색상·SVG 질감 생성 로직은 TypeScript 타입을 제거하여 JavaScript로 포트합니다.
5. 글꼴 파일은 바이트를 변경하지 않고 로컬 정적 자산으로 복사합니다. 파일 경로만 짧게 정리합니다.

## 파일별 출처와 변환

원본 경로는 모두 위 고정 커밋 기준입니다. 아래의 “포트”는 전체 파일을 무수정으로 복제했다는 뜻이 아니라, 명시한 표현 부분을 GS2500에 맞게 옮겼다는 뜻입니다.

| 원본 파일 | GS2500 대상 | 이식·변환 범위 |
| --- | --- | --- |
| [`src/index.css`](https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/blob/ae560b77978d741312281e8468e51618aa7ae860/src/index.css) | `workspace/obolus.css` | 밝은 배경, 옅은 회색 카드·사이드바, 좁은 테두리·모서리, Inter/Wanted Sans/Geist Mono 계층을 기존 선택자에 맞춤. Tailwind `@theme`는 일반 CSS로 변환. |
| [`src/components/AppLayout.tsx`](https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/blob/ae560b77978d741312281e8468e51618aa7ae860/src/components/AppLayout.tsx) | `workspace/views.js`, `workspace/obolus.css` | 앱 레일과 메인 작업 영역의 배치·간격을 포트. 원본 인증 효과, 지갑 변경 감지와 Composer 연결 제외. |
| [`src/components/AppSidebar.tsx`](https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/blob/ae560b77978d741312281e8468e51618aa7ae860/src/components/AppSidebar.tsx) | `workspace/views.js`, `workspace/obolus.css` | 탐색 행, 섹션 구분과 계정 영역을 GS2500 운영 메뉴·담당 점포로 변환. 원본 계정·지갑 상태 대신 로컬 데모 상태 사용. |
| [`src/components/ui/primitives.tsx`](https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/blob/ae560b77978d741312281e8468e51618aa7ae860/src/components/ui/primitives.tsx) | `workspace/obolus.css`, 기존 GS2500 HTML 컨트롤 | Badge·Chip·Banner의 작은 반경, 단색 선택 상태와 옅은 배너 구분을 CSS/HTML로 포트. Radix·React 컴포넌트 런타임은 도입하지 않음. |
| [`src/pages/Dashboard.tsx`](https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/blob/ae560b77978d741312281e8468e51618aa7ae860/src/pages/Dashboard.tsx) | `workspace/operations-view.js`, `workspace/obolus.css` | 탐색·필터·카드 정보 계층을 점포별 운영 요약과 실행 제안으로 변환. 원본 설문, 주문, 보상 데이터 제외. |
| [`src/pages/Memory.tsx`](https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/blob/ae560b77978d741312281e8468e51618aa7ae860/src/pages/Memory.tsx) | `workspace/operations-view.js`, `workspace/obolus.css` | 기록·근거와 통계를 정리하는 표현 패턴을 현장 사진·사람이 확인한 관찰·다음 추천으로 변환. 원본 충전·출금·서명·정산 함수 제외. |
| [`src/pages/Archive.tsx`](https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/blob/ae560b77978d741312281e8468e51618aa7ae860/src/pages/Archive.tsx) | `workspace/operations-view.js`, `workspace/obolus.css` | 구획선 기반 기록 행과 날짜/요약/후속 액션의 계층을 운영 타임라인과 근거 목록으로 변환. 온체인 영수증·구매 증빙 링크 제외. |
| [`src/lib/cardGradient.ts`](https://github.com/DanRo-AX/Obolus-GoogleCloudAI-Solana/blob/ae560b77978d741312281e8468e51618aa7ae860/src/lib/cardGradient.ts) | `workspace/obolus-surfaces.js` | TypeScript 타입 주석·타입 선언만 제거. 원본 주석, FNV-1a 시드, 색상군·위치, `cardGradient`와 질감 생성 로직 유지. 출처·이번 작업 허용 주석 추가. |
| `public/fonts/83afe278b6a6bb3c-s.p.3a6ba036.woff2` | `workspace/assets/obolus/fonts/Inter.woff2` | 원본 CSS에서 Inter로 지정한 파일. 파일명·경로만 변경, 내용 무수정. |
| `public/fonts/WantedSansVariable.woff2` | `workspace/assets/obolus/fonts/WantedSans.woff2` | 한글 본문용 Wanted Sans. 파일명·경로만 변경, 내용 무수정. |
| `public/fonts/GeistMono_Variable.p.2f937313.woff2` | `workspace/assets/obolus/fonts/GeistMono.woff2` | 수치·메타정보용 Geist Mono. 파일명·경로만 변경, 내용 무수정. |

기존 GS2500 SVG 차트, 아이콘 도우미, 3D 카드 렌더러와 시뮬레이션 엔진까지 Obolus에서 가져온 것으로 표시하지 않습니다. 기존 차트·상태·계산은 별도 GS2500 구현입니다.

## 명시적으로 제외한 기능

- 원본 `src/lib/api.ts` 등의 외부 API 요청 및 서버·Cloudflare Worker 연결
- 로그인·계정 연결·원본 사용자 상태 저장소와 인증 정보
- Solana/Phantom 지갑, 서명 요청, USDC 충전·결제·출금·정산·영수증
- 설문 마켓플레이스 주문·구매·보상·유료 근거 접근
- 원본 AI/LLM 호출, 비밀키, 토큰, 환경변수와 배포 설정
- 원본 고객·메모리 데이터, 채팅 내역, 세션과 실적 주장
- 서비스 워커·확장프로그램·추적·원본 분석 이벤트
- 원본 설치·빌드·실행 스크립트의 실행

Obolus의 로고를 GS2500의 브랜드로 사용하지 않으며, 원본 팀·글꼴 제작자가 GS2500의 예측 결과를 검증하거나 보증하는 것으로 표시하지 않습니다.

## 글꼴 라이선스와 원문 출처

세 글꼴의 라이선스는 **SIL Open Font License 1.1**입니다. 개별 제작자 저장소에서 2026-09-22에 확인한 원문을 글꼴 옆에 보관했습니다. 원문을 요약하거나 하나의 프로젝트 라이선스로 대체하지 않았습니다.

| 글꼴 | 제작자 고지 | 동봉한 파일 | 공식 원문 |
| --- | --- | --- | --- |
| Inter | Copyright (c) 2016 The Inter Project Authors | [`assets/obolus/fonts/Inter-LICENSE.txt`](assets/obolus/fonts/Inter-LICENSE.txt) | [rsms/inter · LICENSE.txt](https://github.com/rsms/inter/blob/master/LICENSE.txt) |
| Wanted Sans | Copyright 2024 The Wanted Sans Project Authors | [`assets/obolus/fonts/WantedSans-LICENSE.txt`](assets/obolus/fonts/WantedSans-LICENSE.txt) | [wanteddev/wanted-sans · OFL.txt](https://github.com/wanteddev/wanted-sans/blob/main/OFL.txt) |
| Geist Mono | Copyright 2024 The Geist Project Authors | [`assets/obolus/fonts/GeistMono-LICENSE.txt`](assets/obolus/fonts/GeistMono-LICENSE.txt) | [vercel/geist-font · OFL.txt](https://github.com/vercel/geist-font/blob/main/OFL.txt) |

글꼴의 공식 README에서 제공하는 설명도 확인했습니다: [Inter](https://github.com/rsms/inter), [Wanted Sans](https://github.com/wanteddev/wanted-sans), [Geist](https://github.com/vercel/geist-font). Wanted Sans의 제작자 안내는 한글 바탕에 본고딕(Adobe·Google·산돌커뮤니케이션)을 명시합니다. 본 포트는 제작자가 배포한 라이선스 고지를 그대로 동봉하며 추가 권리 주장을 만들지 않습니다.

### 바이트 무변경 검증

원본 고정 커밋의 파일과 아래 배포 파일의 SHA-256이 각각 일치함을 확인했습니다. 내부 글꼴 이름, 글리프와 가변 축을 수정하지 않았습니다.

```text
c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4  Inter.woff2
4259e7e9a172e634c2cb419d793b84148990316341e910443e5d10965b2c8f16  WantedSans.woff2
5f687a5dd4c87da13deaff9f6b9503d5e62249ff501265a96b134565f9aa8c87  GeistMono.woff2
```

동봉한 라이선스 파일의 SHA-256:

```text
262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a  Inter-LICENSE.txt
db345ad0216d0b73ba5dd3a540507281da6695f234e0a4e70cf2e1a8f30d4331  WantedSans-LICENSE.txt
2b2da563e79400b61818402ca9f26a73d52468268b7fc715e92143c1e799737e  GeistMono-LICENSE.txt
```

## GS2500 제품 의미의 경계

- 화면이 완성됐다는 사실과 예측 모델이 실제 점포에서 검증됐다는 사실은 다릅니다.
- 합성 매출·이벤트와 사용자가 직접 남긴 관찰을 구분합니다.
- 사진 접수는 자동 상품 인식이나 실제 진열 완료 검증이 아닙니다.
- 전후 매출 변화는 관찰이며, 가격·날씨·행사·재고 등의 교란을 분리한 인과효과가 아닙니다.
- 현재 관찰 기반 추천의 갱신은 설명 가능한 로컬 규칙입니다. 모델 학습 완료·최적 매출 보장으로 표시하지 않습니다.
- JEV는 보류 상태이며 이 UI 포트에 모델 호출, 실제 POS 연결 또는 자동 발주가 포함되지 않습니다.
- 사용자 사진과 이번 페이지의 관찰 기록은 기존 로컬 메모리 계약을 유지합니다. 이 UI 포트가 영구 저장이나 서버 업로드를 추가하지 않습니다.

기능 및 화면 검증 결과는 프로젝트의 `VERIFICATION.md` 등 별도 검증 기록을 따릅니다. 이 문서는 출처와 이식 범위를 다루며 브라우저 검증 통과를 대신하지 않습니다.
