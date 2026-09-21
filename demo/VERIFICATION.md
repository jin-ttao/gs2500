# Verification — updated 2026-09-22

## Latest: persona causality and JEV integration

- `npm test`: **159/159 passed** (23.65 seconds); `npm run build` passed.
- Loaded **1,000 unique original NVIDIA synthetic source records**, with pinned revision, CC BY attribution, and raw narratives preserved. Budgets, affinities, timing weights and all store data remain authored assumptions, not observed Korean shoppers/POS data.
- Fixed explicit shopping goals, new-product avoidance, negative product memories, price sensitivity, and the arbitrary ₩1,700 exploration cutoff. Current missions respect visit hours. Technical persona buckets no longer inherit old student/developer behaviour coefficients.
- Candidate layouts change ordinary fixture/fridge SKU coordinates as well as promotion shelves. Actual destinations and approach points use the same placements as the 3D renderers.
- Paired **3 stores × 4 plans × 1,000 potential people × 24h**: all completed; **5,432 payments / 9,506 paid units / 288 stock identities** checked. See [BEHAVIOR-AUDIT.md](./BEHAVIOR-AUDIT.md) for full tables, source hashes and limitations.
- Actual JEV entry calls succeeded. Destination requests were rejected; two diagnosed responses were upstream **HTTP 429 / rate_limit_exceeded**, without Retry-After. Full real-JEV purchasing flow and behavioural accuracy are **not verified**. See [JEV-VERIFICATION.md](./JEV-VERIFICATION.md).
- Mocked JEV integration tests cover all three decision stages, illegal responses, timeout/budgets, exact clock freeze during network latency, pause holding an in-flight response, and reset generation isolation. No GPT or local fallback.
- All 1,000 source personas' promotional shelf contexts fit the local request ceiling in an offline check: peak **111,319 bytes / 131,072 limit**. This is not a provider token-capacity claim.
- Actual local server requests: `/.env.local` and `/server.mjs` → **404**, source cohort JSON and runtime modules → **200**. Secrets remain Git-ignored and outside the static build.
- Browser: all **36 worlds** completed 24h; calculation **57.6s**, adjustable replay separate. Samsung A/B/C/D final revenue **1,646,300 / 1,857,300 / 1,621,500 / 1,524,400**, matching the independent audit. These are simulated payments, not actual store revenue.
- Browser model selector visibly distinguishes local/API modes, disables comparison replay for unfinished JEV execution, shows remaining server quota and latest **Gateway 429**, and makes no API request merely by selecting a mode. Desktop 1280px and mobile 390px DOM widths had no horizontal overflow.
- Approval receipts now include engine and persona provenance; preserved older approvals are labelled as older five-template local results rather than silently relabelled as NVIDIA/JEV outputs.

The following sections are historical checks of earlier engine versions. Their
old revenue baselines and earlier “not connected” statements are **not** current results.

## Historical: recorded visits, adjustable comparison playback

The default UI is now `빠른 비교`, with `느리게 / 기본 / 빠르게` presentation
speeds (0.5 / 1 / 2). A fixed-duration marketing claim was removed at the user's
request. The default clip spans 30 presentation seconds, independent of engine
preparation. `실시간 관찰` retains its original shared 32× simulation clock.

- `npm test`: **109/109 passed** (18.83 seconds). `npm run build`,
  `node --check app.js` and `git diff --check` passed.
- Three bounded Web Workers compute the original daily engine without modifying
  `world.js`, `context.js`, `day.js`, persona scores, stock or payment policy.
  Current browser preparation for **all 36 full-day candidates** took **37.8s**;
  this is observed local timing, not a guarantee on other devices.
- Each recording nominates up to 12 actual visitors stratified over the day.
  Motion/turn/state-transition poses and original basket changes are recorded.
  Visits overlap in presentation only; no extra shopping stops or sales are added.
  Explicit notices distinguish this from real simultaneous occupancy.
- Recorder baseline: Samsung A remains **605 entrants / 438 buyers / 689 units /
  KRW 1,603,200**, with 12 retained visits and 97 actual accounting checkpoints.
- Browser: all 36 candidates reached **86,400 seconds**. After changing replay
  speed from 1 to 0.5, pausing, then finishing at 2, all twelve previously audited
  everyday-store candidate revenues matched their original values exactly.
- At paused presentation time **16.4042s**, all four visible Samsung cards showed
  **12 recorded visitors**. A later DOM check found unchanged coordinates and
  accounting. The expanded renderer matched the selected visual-world positions
  and presentation time; approval stayed disabled before playback completion.
- Unit checks preserve final accounting at different durations, frame partitions
  and speed changes; speed changes do not jump the clock. Reset preserves speed
  and original recordings; completed clips never loop autonomously.
- Independent nine-map shortened-day integration sampled **79,478 replay poses**:
  all walkable. Seven boundary-interpolation cases held the previous real tick
  instead of constructing a fictitious detour. This is not proof against every
  possible future layout or recording.
- **1440×900** retained ~327.5×345.97px cards with no horizontal overflow;
  **390×844** also had no document overflow. Mobile controls and representative
  visitors were visually inspected. Temporary viewport overrides were reset.
- Source UI, runtime DOM and docs contain no superseded fixed-duration wording.
  Initial preparation can be cancelled; scene display and live-world state are
  separate. Recordings are memory-only and must be rebuilt after a reload.
- Accounting uses actual 15-minute checkpoints, not interpolated money. Final
  values use the complete original snapshot. Summary export retains all payment
  events, explicitly marks omitted non-payment events, and is not a full ledger.

## Historical: reference card proportions and 32× default

The user relaxed the requirement to squeeze all 16 cards into one viewport.
The current design keeps four alternatives per store and four stores per page,
but prioritizes the supplied card proportions and allows vertical scrolling.
The default shared clock is now 32× rather than 4×; explicit 1× and 4× controls
remain available for close observation. No independent animation multiplier was added.

- `npm test`: **88/88 passed** (22.4 seconds), including default 32× and an explicit
  0.5-second wall increment advancing every one of 36 worlds by 16 seconds.
- `npm run build` passed. Tests retain explicit slow-speed and pause coverage.
- Live browser check after selecting 32×: **24.849 wall seconds → 795.45 simulated
  seconds (32.011×)**. All 36 source times were exactly equal at the sample.
- At an actual **1440×900** viewport, the new card was about **327.5×346px**
  (width/height ≈ 0.947); all sixteen scene rectangles retained about **1.78:1**.
  The store page is taller than the viewport and scrolls vertically. No footer
  exceeded its card, and document width stayed 1440px. The former scene rectangle
  at the same width was about 314.5×77.25px (~4.07:1), creating excess side space.
- At **390×844**, cards measured **163.5×172.72px**, scenes about **151.8×85.36px**;
  no footer child overflow or horizontal document overflow was found. Next-page
  navigation retained four candidates per store and the default 32× setting.

## Historical: sixteen live cards, four candidates, paged stores, slower playback

This section supersedes the older three-store/nine-world board and 900× default
below. The current board owns **nine synthetic stores × four real alternatives =
36 worlds**, split into store pages **4 + 4 + 1**. The final page intentionally has
four cards, not fabricated duplicate stores. Candidate D is `discovery` (신상품 탐색안).

- `npm test`: **88/88 passed** (17.1 seconds). Includes all 36 common card templates,
  unique 24-SKU layouts, equal same-store cohorts, default 4×, selection preserving
  world identity, all nine map formats at a bounded horizon, and eight pager tests.
- `npm run build`, `node --check app.js`, and `git diff --check` passed. Both new
  pager JavaScript and page-layout CSS are explicitly allowlisted into `dist`.
- The full-day verification script uses the explicit `everyday` group: three
  stores × four alternatives = **12 worlds**, 1,000 potentials each, exactly 24:00.
  Agent-run full-day checks passed in 40.9 headless wall seconds; this is neither a
  36-world full-day benchmark nor a browser rendering performance claim.
- Chrome, **1512×805**: all 16 views in page 1 rendered; each 3D viewport was about
  54 CSS pixels high after fixing a footer-clipping issue. No footer exceeded its
  card. **774×863**: all 16 cards fit onscreen, 70px 3D views, no footer clipping,
  document width exactly 774px.
- **390×844** responsive viewport: four stores stack vertically per page, each
  retaining its 2×2 candidate grid. Document width exactly 390px; no clipped
  footers. Vertical scrolling exposed subsequent stores without changing page.
  This is a desktop responsive emulation, not a physical touch-device test.
- Mouse drag advanced one store page without opening a card. A subsequent normal
  click opened university candidate D; closing restored focus to that same card.
  Arrow buttons and page dots also worked. Native touch is browser-controlled and
  covered by unit checks that touch/vertical gestures are not manually prevented.
- Running at default 4×: **27.685 wall seconds → 110.8 simulated seconds (4.002×)**.
  All 36 worlds had identical times, including offscreen stores. Page 2 had 16
  actual visible renderer views, each matching the source time. Pausing at 159.8s
  and navigating to page 3 retained 159.8s and the same execution generation;
  exactly four visible views remained. Paging never calls reset or setStoreGroup.
- After explicitly fast-forwarding and returning to 4×, pause at 1823.5s and
  reveal page 2: all four university candidates had an active shopper. Their
  actual rendered shopper positions, states, and times exactly matched source
  worlds. This checks restoration with real agents, not just empty-store clocks.
- Temporary browser size overrides were reset. Tests use synthetic data and
  local decisions; no GS, JEV, Nemotron, paid API, or external deployment is added.

## Historical: course-card design adaptation

The user-provided React example supplied header/body/footer markup and palette
tokens, but no complete layout CSS. Its visual structure was adapted into the
existing vanilla-JavaScript application, without adding React, Tailwind, or remote
portrait dependencies. All nine cards use the same template; A/B/C consistently
use green/orange/blue. Existing worlds and accounting were not changed.

- `npm test`: **75/75 passed** (~15.7 seconds), including three new template tests
  for nine identical structures, unique live hooks, escaped text, and no nested
  interactive controls or external placeholder assets.
- `npm run build` includes the new component and scoped stylesheet explicitly.
- At the native 774px width, all nine cards had equal 218px heights, positive 60px
  3D viewports, and footers fully inside their own cards. The board scrolls when
  the window is too short; the shared renderer clips against this ancestor.
- A 1440px-wide responsive check showed all nine 3D views and matching source/
  renderer times, run IDs, shopper coordinates, and stock-worker coordinates.
- Pause froze all nine source snapshots. Progress text 44.5%, ARIA value 44.5,
  and the actual bar width 44.5162% agreed to displayed precision.
- At 390px, document and scroll widths both equaled 390; all three selected-store
  cards had equal 485px heights, unclipped footers, and contained numeric metrics.
  Switching store tabs preserved simulation time and did not open the inspector.
  A card opened the matching live world; Escape closed it and restored card focus.
- The outer card retains its keyboard button behavior and receives an updated
  `aria-description` for clock/progress/entry/buyer/revenue, since button descendants
  alone do not reliably expose every metric to assistive technology.

## Historical: fixed 24-hour day, potential entry, and finite replenishment

This section supersedes the mandatory-visit/depletion model described in the
historical checks below. The UI now uses `createLab({mode:'day'})` by default.
Each store has 1,000 potential people spread over 00:00–24:00; its three candidates
reuse that same seeded cohort. They are not 9,000 independent customers.

- `npm test`: **72/72 pass** (~16.4 seconds). New daily tests cover exactly 86,400
  seconds, all potentials considered, need/closed/crowded refusal reasons, shared
  A/B/C schedules, finite partial refills, unpaid cutoff returns, no late payment,
  immutable snapshots, arbitrary frame partition replay, and owner pose timing.
- The daily lab's final fractional tick is tested at horizons 0.01, 0.03, 0.13 and
  1.03 seconds. The default full-day horizon remains exactly 86,400 seconds.
- Independent stock checks on office/express/riverside inspected all SKU quantities
  over 18,000 total ticks: no negative/capacity-exceeding stock, conserved shelf +
  backroom + unpaid baskets + paid quantities, and frozen post-cutoff state.
- Replenishment-only path checks on all nine map formats remained on walkable
  geometry. Worker/customer dynamic collision avoidance is not modeled.
- `npm run test:day` ran the production nine-world, 1,000-potential-person-per-store
  configuration to exactly 24:00 in **36.9 headless wall seconds**. It checks each
  candidate's cohort, clock, stock conservation, payment ledger, hourly totals,
  and final freeze. This is not a browser playback benchmark.

| Store / standard candidate A | Potential | Entered | Passed by | Buyers | Simulated revenue | Refills | Shelf + backroom remaining |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 삼성역점 | 1,000 | 605 | 395 | 438 | ₩1,603,200 | 76 | 206 + 2,035 |
| 역세권 데모점 | 1,000 | 590 | 410 | 385 | ₩1,320,500 | 64 | 219 + 1,683 |
| 주거지 데모점 | 1,000 | 543 | 457 | 439 | ₩1,726,000 | 71 | 180 + 2,610 |

All nine candidates retained inventory when the day ended. Revenue is booked only
on the engine's payment event; the renderer does not independently calculate sales.
Full JSON export retains all events, with a separate recent replenishment history
so ordinary shopper events cannot hide the latest transfers in the daily panel.

Browser checks on the daily model confirmed all nine visible cards use the same
source timestamps/run IDs and exact customer/worker coordinates. At the observed
16:04:04.75 pause, the entire synchronization probe remained byte-identical across
checks. The detailed renderer matched the selected source time and worker position;
its shelf view contained all 24 products, shelf/backroom quantities, and a disabled
approval action before day completion. A 390px viewport had document/scroll widths
of 390px with no horizontal overflow.

Final browser rerun after the lightweight rendering snapshots were integrated:

- At requested 900×, all nine worlds were observed complete within **149.3 wall
  seconds** of starting, at exactly 24:00:00. This is an observation upper bound,
  not an exact completion timestamp or a guaranteed runtime. Samples of actual
  speed were approximately 500–660×, honestly lower than the requested speed.
- All nine final paid-revenue values matched `test:day` exactly despite different
  browser frame timing. Every cohort had considered = entered + skipped = 1,000;
  all worlds retained inventory and had zero active customers.
- The recent-transfer panel showed real finite transfers, including 6 coffees:
  shelf 2→8 and backroom 10→4. Its count and latest records remained available
  after unrelated shopper events.
- Samsung A could not be approved mid-day; its approval became enabled after
  24:00. Before approval the owner page showed no daily plan. After the local test
  approval it showed exactly Samsung A, with 605 entries, 395 passersby, 438 buyers,
  and ₩1,603,200 simulated revenue. Unapproved station store still showed no plan.
- The approved owner page at 390×844 contained all 24 SKU cards with no horizontal
  overflow. The viewport override was then removed and the completed nine-card
  comparison was restored. No browser warnings/errors were captured.
- `npm run build` passed; eight generated runtime modules matched their source
  files byte-for-byte and the bundled Three.js import target existed. No remote
  deployment or push was performed for this change.

These are authored, uncalibrated assumptions: hourly arrival weights, entry intent,
inventory capacities, event effects, and separate cashier/replenishment staff.
The day is an observation window, not actual store closure: at its cutoff, unpaid
baskets are returned to backroom stock and no after-window payment is included.
SKU shelf stock is pooled across displays, with refill service at the promo station.
No real POS data, supplier ordering, JEV call, or real-world revenue validation was used.

## Shared simulation and payment accounting

The comparison uses nine spatial worlds: three synthetic stores × three shelf
scenarios. `lab.js` owns their shared 0.05-second clock. The scene observes the
selected world's shoppers; completed visits, stock, revenue and gross profit come
from those same worlds.

`npm test`: 44 tests passed across the model, world, map, world-accounting, lab
and card-clipping suites (approximately 4.2 seconds on the latest verification).

The 11 `lab.test.js` checks verify:

- Nine independent worlds, stocks and run identities are created.
- All unfinished candidates advance by the same simulated duration before a frame
  budget can yield; throttling retains backlog and reports the actual speed.
- Pause freezes full world snapshots, including shopper positions and metrics.
- Changing the selected store/candidate preserves every world's state.
- Requested 1× and 16× speeds produce proportional actual simulated time when the
  processing budget is unrestricted; all six offered speeds are accepted.
- Equal simulated durations split into different render-frame intervals produce
  identical seeded world snapshots, excluding the session-specific run identifier.
- Reset creates fresh worlds while preserving the selected candidate and speed.
- Invalid limits, speeds, elapsed times, frame budgets and selections are rejected
  without changing the state.
- All nine 20-visit candidates finish within a 1,280-simulated-second bound, stop
  automatically, and retain their final metrics. At least one store's shelf
  candidates produce different revenue in this small cohort; there is no required
  winner or requirement that all candidates differ.
- A second nine-world run audits every event at 0.05-second intervals. Every sale
  equals an actual payment's product prices; units, gross profit and buyer counts
  equal the accumulated payment events at every step. A shopper pays at most once,
  and unpaid baskets do not book revenue.

The existing world and map checks also cover all five authored floor plans,
reachable station/queue positions, 100 completed visits per map, obstacle and
shopper separation, budgets, stock conservation, diverse routes and deterministic
replay. Asset inspection verifies the exported GLB's 19-joint skin and eight
motion clips. Additional world-accounting checks cover actual pick/payment
transitions, shelf-driven choices, detached snapshots, input validation and empty
shelves recording intended demand without fabricated sales.

The legacy `model.test.js` tests still exercise the old standalone arithmetic
model as a regression fixture. Passing those tests does not establish that the UI
uses that model, nor does it validate real shopper behaviour.

## Integrated 9 × 1,000-visit stress check

The coordinating agent ran the default production `createLab` configuration
headlessly, with all nine candidates reaching 1,000 completed visits. The shared
clock stopped at 5,613.45 simulated seconds, with nine completed runs, no failed
runs and zero active shoppers. Wall time for that check was approximately 47.5
seconds; it is not a browser playback benchmark.

| Synthetic store | Shelf candidate | Paid revenue | Authored gross profit |
| --- | --- | ---: | ---: |
| 삼성역점 | 본사 표준안 | ₩2,360,500 | ₩801,800 |
| 삼성역점 | 재고 우선안 | ₩2,360,500 | ₩801,800 |
| 삼성역점 | 균형 후보안 | ₩2,360,500 | ₩801,800 |
| 역세권 데모점 | 본사 표준안 | ₩1,943,700 | ₩661,350 |
| 역세권 데모점 | 재고 우선안 | ₩1,941,700 | ₩660,710 |
| 역세권 데모점 | 균형 후보안 | ₩1,943,700 | ₩661,350 |
| 주거지 데모점 | 본사 표준안 | ₩2,812,600 | ₩954,960 |
| 주거지 데모점 | 재고 우선안 | ₩2,832,600 | ₩962,160 |
| 주거지 데모점 | 균형 후보안 | ₩2,758,600 | ₩935,520 |

Equal end revenue is allowed: the Samsung store's candidates reach the same stock
ceiling, while unmet intended demand still differs (730, 729 and 746 units).
Results are observed local rule-model outcomes, not a calibrated business forecast.

## Earlier browser verification — before the nine-card renderer

The previous separate-batch UI checks and its revenue reference are superseded by
these checks on the integrated localhost UI in the Codex in-app browser:

- Desktop 1,440 × 900 and the user's 884 × 806 panel show all nine candidate cards
  alongside the selected 3D world. The 884-wide panel has no horizontal overflow.
- A 1× playback sample advanced 17.95 simulated seconds at measured 1.002× wall
  time. A 32× sample measured 31.596×. The selected source and renderer timestamps,
  run IDs, and every active shopper's position matched within 1e-8.
- Pause froze the entire DOM synchronization snapshot, including all nine counters
  and 3D poses. Switching candidates while paused preserved time and visit counts.
- At requested 128×, the browser reported its lower effective processing speed
  (approximately 30–40× on this machine), without separating statistics from motion.
  All nine 1,000-visit runs were observed complete by 161.271 wall seconds after
  starting; this is an observation bound, not an exact completion-time benchmark.
- Before approval, the owner view showed no candidate. After approving Samsung's
  B plan, it showed only that saved plan with ₩2,360,500 revenue and ₩801,800 gross
  profit. The browser-assisted start → compare → approve → owner-view check was
  observed complete at 183.017 seconds. This is not a human usability study.
- The approved snapshot survived a page reload. An unapproved station store still
  showed no plan. Approval is local browser storage, not server access control.
- At 390 × 844, the manager uses store tabs and stacked candidate cards; the owner
  plan remains readable. Document width and scroll width both measured 390 pixels.
- The final full-run verification produced no new browser errors or warnings.
  Two earlier transient missing-app.js errors occurred during file replacement and
  were resolved before the verified run.

That pre-card-renderer automated rerun passed all 38 tests in approximately 4.6 seconds.

## Nine live 3D cards — follow-up verification

The former SVG mini-maps have been replaced with nine genuine 3D scenes, rendered
through one shared WebGL context. The selected detailed view opens as a dialog;
it no longer permanently occupies half the dashboard. Card fixtures use an
instanced level-of-detail representation, while shoppers reuse the detailed
view's Blender skinned asset and animations. No simulation engine was replaced.

- At the native 884 × 807 browser size, all nine 3D viewports are visible together,
  each approximately 275 × 112 pixels, with no horizontal overflow.
  At 1,440 × 900, the final layout provides nine 451 × 128-pixel views, also without
  horizontal overflow.
- During 16× playback, the browser displayed 16.0× effective speed. At the sampled
  simulation time 210.25 seconds, all nine views had matching source/drawn run IDs,
  timestamps, agent counts, states and coordinates (tolerance 1e-8). There were
  117 visible shoppers in that sample; the shared renderer reported one context
  and 1,593 draw calls. This is a measured sample, not a performance guarantee.
- Pausing froze all nine drawn snapshots. Opening station candidate B preserved
  every source run and card snapshot; its expanded renderer matched the same
  time, run ID and shopper positions. Escape closed the dialog and restored focus
  to the originating candidate card.
- At 390 × 844, the selected store's cards stack with larger 3D scenes. Only cards
  intersecting the viewport are drawn. Switching to residential candidates snapped
  the visible scenes to their current source states. No horizontal overflow was
  present. Mobile expansion and closing were checked visually.
- With mobile cards offscreen, all nine source worlds continued advancing while
  hidden cards truthfully retained their last rendered timestamps. Visible cards
  remained current. The owner view paused playback, drew zero cards and cleared
  the shared canvas instead of leaving the previous views over its content.
- Reset rebound every card to a new run ID with time zero, no remaining shoppers
  and zero sales. No warnings or errors appeared during this verification run.
- Six new pure geometry tests cover full and partially clipped viewports,
  independent overflow axes, clipping-ancestor intersections, invisible cards and
  immutable inputs. All 44 automated tests pass.

## Public source release check

The public index was exported to an empty checkout without local notes, Blender
editor files or node_modules. `npm ci --ignore-scripts`, all 44 tests and
`npm run build` passed there (Node 24.14.0, npm 11.9.0, Python 3.14.3).
The generated `dist` was served on a separate local port. All nine 3D cards ran,
and at simulation time 1,430.6 seconds their rendered run IDs, timestamps and
shopper coordinates matched their source worlds. No browser warnings or errors
were observed. The production package needs neither node_modules nor API keys
at runtime because Three.js and its license are copied into `dist/vendor`.

The source release excludes local design/research notes and compressed `.blend`
files containing machine-local metadata; the original local files are preserved.
It includes the clean exported GLBs and procedural Blender rebuild scripts.
The staged files were checked for credential patterns and absolute home paths,
with no matches. This check is not a guarantee that every possible secret format
can be detected. No deployment, actual account authorization or ordering occurs.

## Known limits

Store cohorts, initial inventories, arrival patterns, shelf-notice probabilities
and cost ratios are authored assumptions. Gross profit uses those synthetic unit
costs; unmet demand counts intended item purchases blocked by stockouts. Neither
metric is supplied by real GS sales or costs. A 1,000-visit run is not a measured
24-hour forecast, and exhaustion of a fixed inventory can make candidate revenues
tie. The displayed events retain only the latest 15 per world.

Floor plans are fictional rectangles, not surveyed GS stores. Per-map occupancy
limits are demonstration parameters. Café seating is a static obstacle, without
sitting/eating behaviour. The live scene uses stylized Blender meshes in Three.js;
motions are authored and blended rather than mocap or full-body contact IK. The
local policy does not use JEV, Nemotron or an LLM reflection/retrieval loop.
