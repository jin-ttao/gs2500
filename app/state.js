export const APPROVAL_KEY = 'gs2500-local-approved-day-v2';
export const FLOW_KEY = 'gs2500-product-flow-v1';
export const APPROVAL_SCHEMA = 'gs2500-day-approval-v3';
export const PRODUCT_APPROVAL_SCHEMA = 'gs2500-product-approval/1';

const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);

export function readJson(storage, key, fallback) {
  try {
    const parsed = JSON.parse(storage.getItem(key) || 'null');
    return parsed == null ? clone(fallback) : parsed;
  } catch {
    return clone(fallback);
  }
}

export function initialFlow() {
  return {
    schema: 'gs2500-product-flow-state/1',
    selectedStoreId: 'samsung',
    selectedScenario: 'owner',
    messageDraft: '',
    response: null,
    photoReceipt: null,
    lastRoute: 'manager',
  };
}

export function loadFlow(storage) {
  const value = readJson(storage, FLOW_KEY, initialFlow());
  if (!isRecord(value) || value.schema !== 'gs2500-product-flow-state/1') return initialFlow();
  return { ...initialFlow(), ...value };
}

export function saveFlow(storage, flow) {
  storage.setItem(FLOW_KEY, JSON.stringify({ ...flow, schema: 'gs2500-product-flow-state/1' }));
}

export function validatePhotoFile(file) {
  if (!file || typeof file.type !== 'string' || !Number.isFinite(file.size)) return { ok:false, error:'이미지 파일을 선택해주세요.' };
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return { ok:false, error:'JPG, PNG, WebP 이미지 파일만 선택할 수 있습니다.' };
  if (file.size > 10 * 1024 * 1024) return { ok:false, error:'10MB 이하 이미지 파일을 선택해주세요.' };
  return { ok:true, error:'' };
}

export function loadApprovals(storage) {
  const value = readJson(storage, APPROVAL_KEY, {});
  return isRecord(value) ? value : {};
}

export function validateProductApproval(receipt, { storeId, scenario, bayId } = {}) {
  if (!isRecord(receipt) || receipt.schema !== APPROVAL_SCHEMA || receipt.mode !== 'day' || receipt.isComplete !== true) return false;
  if (receipt.time !== 86400 || !isRecord(receipt.day) || receipt.day.considered !== receipt.day.potentialTotal) return false;
  if (typeof receipt.storeId !== 'string' || typeof receipt.scenario !== 'string' || !Array.isArray(receipt.levels) || receipt.levels.length !== 4) return false;
  if (!isRecord(receipt.productApproval) || receipt.productApproval.schema !== PRODUCT_APPROVAL_SCHEMA) return false;
  if (receipt.productApproval.storeId !== receipt.storeId || receipt.productApproval.candidateScenario !== receipt.scenario) return false;
  if (storeId && receipt.storeId !== storeId) return false;
  if (scenario && receipt.scenario !== scenario) return false;
  if (bayId && receipt.productApproval.bayId !== bayId) return false;
  return true;
}

export function createApprovalReceipt({ result, proposal, levels, messageDraft, approvedAt = new Date().toISOString() }) {
  if (!result || result.storeId !== proposal.storeId || result.scenario !== proposal.candidateScenario) throw new TypeError('실험 결과와 제안 식별자가 일치해야 합니다.');
  if (result.time !== 86400 || result.isComplete !== true) throw new RangeError('24시간 완료 결과만 승인할 수 있습니다.');
  return {
    schema: APPROVAL_SCHEMA,
    mode: 'day',
    isComplete: true,
    storeId: result.storeId,
    scenario: result.scenario,
    runId: result.runId,
    approvedAt,
    levels: clone(levels),
    day: clone(result.day),
    time: result.time,
    completed: result.completed,
    paidRevenue: result.paidRevenue,
    paidGrossProfit: result.paidGrossProfit,
    stock: clone(result.stock),
    backroomStock: clone(result.backroomStock),
    shelfCapacity: clone(result.shelfCapacity),
    initialTotalStock: clone(result.initialTotalStock),
    replenishments: result.replenishments,
    replenishedUnits: result.replenishedUnits,
    engine: clone(result.engine),
    personaSource: clone(result.personaSource),
    productApproval: {
      schema: PRODUCT_APPROVAL_SCHEMA,
      proposalId: proposal.id,
      storeId: proposal.storeId,
      storeCode: proposal.storeCode,
      bayId: proposal.bayId,
      candidateId: proposal.candidateId,
      candidateScenario: proposal.candidateScenario,
      sourceBaselineId: proposal.sourceBaselineId,
      scope: proposal.scope,
      moves: clone(proposal.moves),
      workloadMinutes: proposal.workloadMinutes,
      newOrder: proposal.newOrder,
      reversible: proposal.reversible,
      reason: proposal.reason,
      caveat: proposal.caveat,
      messageDraft: String(messageDraft || ''),
    },
  };
}

export function saveApproval(storage, receipt) {
  if (!validateProductApproval(receipt)) throw new TypeError('유효한 제품 승인 스냅샷이 아닙니다.');
  const approvals = loadApprovals(storage);
  storage.setItem(APPROVAL_KEY, JSON.stringify({ ...approvals, [receipt.storeId]: receipt }));
}

export function clearDemoState(storage) {
  storage.removeItem(APPROVAL_KEY);
  storage.removeItem(FLOW_KEY);
}
