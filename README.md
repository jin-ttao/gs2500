# GS2500

GS그룹 x 랄프톤 해커톤의 데스크톱 웹앱 데모입니다. 여러 GS25 점포의 전년 동기 대비 매출에서 출발해 진열 변경 후보를 시뮬레이션하고, 매니저 승인·점주 검토·4주 후 회고까지 보여줍니다. 판매·재고·성과는 합성 데모 데이터입니다.

- 팀 공통 제품·구현 맥락: [docs/shared-context.md](docs/shared-context.md)
- 제품 방향과 역할별 경험: [docs/product-brief.md](docs/product-brief.md)
- 실행 전 조정할 단일 `/goal` 프롬프트 초안: [goal-prompt.md](goal-prompt.md)
- 3분 발표 콘티와 구현 인계 HTML: [design/reference/gs2500-storyboard-handoff.html](design/reference/gs2500-storyboard-handoff.html)
- 3D 시뮬레이션 작업 브랜치: `codex/multi-store-live-3d`

현재 `main`의 `index.html`과 [공개 URL](https://gs2500.vercel.app/)은 배포 경로 확인용 임시 페이지입니다. 제품 웹앱은 구현·통합 중이며, 별도 DB 없이 동작하도록 설계합니다.
