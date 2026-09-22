/**
 * Authored browser E2E coverage; this file is NOT executed by `npm test`.
 * Optional developer setup (not installed or executed by the authoring agent):
 *   npm install --no-save --package-lock=false @playwright/test
 *   npx playwright install chromium
 * Start a built app in a separate terminal with `npm run build` then `npm start`.
 *   GS2500_E2E_BASE_URL=http://127.0.0.1:4175 npx playwright test scripts/browser-e2e.spec.mjs --workers=1
 * Use a public deployment URL in GS2500_E2E_BASE_URL to check that deployment.
 * Only synthetic demo actions are used. No external account, model, or order call.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { BAYS, getCandidate } from '../workspace/data.js';

const baseURL = process.env.GS2500_E2E_BASE_URL || 'http://127.0.0.1:4175';
const primaryBay = BAYS.find(bay => bay.storeId === 'H-0412');
const referencePhoto = fileURLToPath(new URL('../workspace/assets/bay-reference.jpg', import.meta.url));
const pageErrors = new WeakMap();
const editedMessage = '사장님, 2단 상품만 먼저 검토해주세요. <검토 의견> 그대로 표시되어야 하며 실제 문자 발송은 없습니다.';

test.use({
  baseURL,
  viewport: { width: 1440, height: 1000 },
  screenshot: 'only-on-failure',
  trace: 'retain-on-failure',
});
test.setTimeout(180_000);

test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: '데모 로그인', exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page), 'No unhandled JavaScript errors on the demo path').toEqual([]);
});

function action(page, name, data = {}) {
  const attributes = Object.entries(data).map(([key, value]) => `[data-${key}="${value}"]`).join('');
  return page.locator(`[data-action="${name}"]${attributes}`);
}

async function login(page) {
  await page.getByRole('button', { name: '데모 로그인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '이번 주, 어느 점포를 먼저 도울까요?', exact: true })).toBeVisible();
}

async function selectPrimaryBay(page) {
  await action(page, 'navigate', { route: 'bays' }).first().click();
  await expect(page.getByRole('heading', { name: '진단 대기 매대', exact: true })).toBeVisible();
  await page.locator(`.bay-row [data-action="select-bay"][data-store="${primaryBay.storeId}"][data-bay="${primaryBay.id}"]`).click();
  await expect(page.locator('.title-tags')).toContainText('삼성역점');
  await expect(page.locator('.title-tags')).toContainText(primaryBay.id);
}

async function calculate(page) {
  await action(page, 'navigate', { route: 'bays' }).first().click();
  await action(page, 'run-all').click();
  await expect(page.getByRole('heading', { name: '여러 점포, 여러 선택을 한눈에', exact: true })).toBeVisible();
  await expect(page.locator('.board-status strong')).toHaveText(`${BAYS.length} / ${BAYS.length} 매대 비교 준비`, { timeout: 120_000 });
  await expect(page.locator('.error-banner')).toHaveCount(0);
}

async function chooseCandidate(page, candidateId = 'B') {
  const selected = page.locator(`.forecast-comparisons [data-action="select-candidate"][data-store="${primaryBay.storeId}"][data-bay="${primaryBay.id}"][data-candidate="${candidateId}"]`);
  await expect(selected).toBeEnabled();
  await selected.click();
  await expect(page.getByRole('heading', {
    name: getCandidate(primaryBay.storeId, primaryBay.id, candidateId).name,
    exact: true,
  })).toBeVisible();
  await expect(page.locator('#world-detail')).toBeVisible();
}

async function approveSelected(page, message = editedMessage) {
  await action(page, 'open-approval').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('#approval-message').fill(message);
  await action(page, 'approve').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.badge').filter({ hasText: '매니저 승인됨' })).toBeVisible();
}

async function approvedOwner(page, candidateId = 'B') {
  await login(page);
  await selectPrimaryBay(page);
  await calculate(page);
  await chooseCandidate(page, candidateId);
  await approveSelected(page);
  await action(page, 'role-owner').click();
  await expect(page.locator('.approved-message p')).toHaveText(editedMessage);
  await expect(page.locator('.option-card, .forecast-card, #world-board, #world-detail')).toHaveCount(0);
}

test('manager → unpublished owner → comparison → exact approval → partial reply/photo → review', async ({ page }) => {
  const started = Date.now();
  await login(page);

  // Drafts and their forecast values are not visible in the owner workspace.
  await action(page, 'role-owner').click();
  await expect(page.getByRole('heading', { name: '아직 승인된 제안이 없습니다', exact: true })).toBeVisible();
  await expect(page.locator('.approved-message, .response-panel, .forecast-card')).toHaveCount(0);
  await action(page, 'role-manager').first().click();

  await selectPrimaryBay(page);
  await calculate(page);
  await chooseCandidate(page, 'B');
  const approvedDelta = await page.locator('.candidate-impact .impact-number').innerText();
  await approveSelected(page);
  await action(page, 'role-owner').click();
  await expect(page.locator('.approved-message p')).toHaveText(editedMessage);
  await expect(page.getByRole('heading', { name: getCandidate(primaryBay.storeId, primaryBay.id, 'B').name, exact: true })).toBeVisible();
  await expect(page.locator('.forecast-callout')).toContainText(approvedDelta);
  await expect(page.locator('.option-card, .forecast-card, #world-board, #world-detail')).toHaveCount(0);

  await page.locator('#owner-note').fill('공간이 부족해서 2단만 옮겼어요. 나머지는 담당자와 상의할게요.');
  await action(page, 'respond', { status: 'partial' }).click();
  await expect(page.locator('.response-panel .badge')).toHaveText('부분 실행');
  await page.locator('#photo-file').setInputFiles(referencePhoto);
  await expect(page.getByRole('heading', { name: '사진 접수됨', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '점주가 접수한 사진 미리보기', exact: true })).toBeVisible();
  await expect(page.locator('.response-panel')).toContainText('실제 서버에 업로드하거나 진열 실행을 검증하지 않습니다.');

  await action(page, 'role-manager').first().click();
  await expect(page.getByRole('heading', { name: '제안의 끝은 실행이 아니라, 다음 판단', exact: true })).toBeVisible();
  await expect(page.locator('.review-funnel .metric').nth(0)).toContainText(`${BAYS.length} / ${BAYS.length}`);
  await expect(page.locator('.review-funnel .metric').nth(1)).toContainText(`1 / ${BAYS.length}`);
  await expect(page.locator('.review-funnel .metric').nth(2)).toContainText(`1 / ${BAYS.length}`);
  await expect(page.locator('.review-funnel')).toContainText('사진 접수 1건');
  const primaryReview = page.locator('.review-card').filter({ has: page.locator('.badge', { hasText: '삼성역점' }) });
  await expect(primaryReview).toContainText('부분 실행 회신');
  await expect(primaryReview).toContainText('옵션 B');
  await expect(primaryReview).toContainText('2단만 옮겼어요');
  await expect(primaryReview).toContainText('사진 접수됨');
  await expect(page.locator('.review-list')).not.toContainText('— → —');
  expect(Date.now() - started, 'Main desktop demo path stays below five minutes').toBeLessThan(300_000);
});

test('declined proposal stays a refusal; upload failure does not imply execution; reset removes approval', async ({ page }) => {
  await approvedOwner(page, 'A');
  await page.locator('#owner-note').fill('행사 계약이 있어서 이동은 어렵습니다.');
  await action(page, 'respond', { status: 'declined' }).click();
  await expect(page.locator('.response-panel .badge')).toHaveText('실행 어려움');
  await page.locator('#photo-file').setInputFiles(referencePhoto);
  await expect(page.getByRole('alert')).toContainText('수용 또는 부분 실행으로 회신한 뒤');
  await expect(page.locator('.upload-preview')).toHaveCount(0);

  await action(page, 'role-manager').first().click();
  const review = page.locator('.review-card').filter({ has: page.locator('.badge', { hasText: '삼성역점' }) });
  await expect(review).toContainText('실행 어려움');
  await expect(review).toContainText('행사 계약');
  await expect(page.locator('.review-funnel')).toContainText('사진 접수 0건');
  await action(page, 'reset-demo').click();
  await expect(page.getByRole('button', { name: '데모 로그인', exact: true })).toBeVisible();
  await login(page);
  await action(page, 'role-owner').click();
  await expect(page.getByRole('heading', { name: '아직 승인된 제안이 없습니다', exact: true })).toBeVisible();
});

test('invalid file and corrupted image are rejected without replacing an accepted photo', async ({ page }) => {
  await approvedOwner(page);
  await action(page, 'respond', { status: 'accepted' }).click();
  await page.locator('#photo-file').setInputFiles(referencePhoto);
  await expect(page.locator('.upload-preview')).toBeVisible();
  const priorPreview = await page.locator('.upload-preview').getAttribute('src');

  await page.locator('#photo-file').setInputFiles({ name: 'not-an-image.txt', mimeType: 'text/plain', buffer: Buffer.from('plain text, not a photo') });
  await expect(page.getByRole('alert')).toContainText('JPG·PNG·WebP 이미지 파일만');
  await expect(page.locator('.upload-preview')).toHaveAttribute('src', priorPreview);

  // MIME metadata alone is insufficient: the actual browser must decode it.
  await page.locator('#photo-file').setInputFiles({ name: 'corrupt.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG image') });
  await expect(page.getByRole('alert')).toContainText('사진 접수 실패');
  await expect(page.locator('.upload-preview')).toHaveAttribute('src', priorPreview);
  await expect(page.locator('.response-panel .badge')).toHaveText('수용');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: '데모 로그인', exact: true })).toBeVisible();
  await login(page);
  await action(page, 'role-owner').click();
  await expect(page.locator('.upload-preview, .approved-message')).toHaveCount(0);
});

test('3D module failure is visible and does not erase the calculation/approval path', async ({ page }) => {
  await page.route('**/workspace/world-view.js', route => route.abort('failed'));
  await login(page);
  await selectPrimaryBay(page);
  await calculate(page);
  await expect(page.locator('#world-board .world-error')).toContainText('3D 연결 실패');
  await chooseCandidate(page, 'A');
  await expect(page.locator('#world-detail .world-error')).toContainText('3D 연결 실패');
  await approveSelected(page);
  await action(page, 'role-owner').click();
  await expect(page.locator('.approved-message p')).toHaveText(editedMessage);
});
