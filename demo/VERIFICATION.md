# Verification — 2026-09-21

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
