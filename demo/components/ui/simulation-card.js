// The supplied course-card visual grammar, adapted to the existing DOM renderer.
// All data hooks are stable for the lifetime of a world; never rebuild on a tick.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const person = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="3.5" fill="currentColor"/><path d="M5 21v-2a7 7 0 0 1 14 0v2" fill="currentColor"/></svg>';
const stockWorker = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="6.5" r="3" fill="currentColor"/><path d="M6 18v-2a6 6 0 0 1 12 0v2" fill="currentColor"/><path d="M7 14h10v8H7z" fill="#bce9e5" stroke="currentColor" stroke-width="1.5"/><path d="M12 14v3" stroke="currentColor" stroke-width="1.5"/></svg>';

export function renderSimulationCard({letter,title,description,storeName}) {
  return `
    <div class="course-card-header">
      <span class="course-card-date">DAY 01 <i>·</i> 합성 실험</span>
      <span class="card-status">대기</span>
      <span class="course-card-more" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg></span>
    </div>
    <div class="course-card-heading">
      <div class="card-title"><span class="candidate-letter">${escape(letter)}</span><strong>${escape(title)}</strong></div>
      <p>${escape(description)}</p>
    </div>
    <div class="card-viewport" role="img" aria-label="${escape(storeName)} ${escape(letter)} 실제 3D 시뮬레이션">
      <div class="card-view-hint"><span>LIVE WORLD</span><span>확대 ↗</span></div>
    </div>
    <div class="card-metrics"><div><span>시뮬레이션 결제매출</span><b data-revenue>₩0</b></div><div class="profit"><span>총이익</span><b data-profit>₩0</b></div></div>
    <div class="card-funnel" aria-label="잠재 고객 검토와 입장, 지나침, 구매자"><span>검토 <b data-considered>0</b></span><span>입장 <b data-entered>0</b></span><span>지나침 <b data-skipped>0</b></span><span>구매 <b data-buyers>0</b></span></div>
    <div class="card-inventory"><span data-inventory>진열 0 · 창고 0</span><span data-owner>점주 보충 대기</span></div>
    <div class="card-secondary"><span>진열 품절 구매 실패</span><b data-stockout>0건 · 0.0%</b></div>
    <div class="course-card-progress"><div class="course-progress-heading"><span>하루 진행</span><span data-completed>0.0%</span></div><div class="candidate-progress" role="progressbar" aria-label="하루 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i data-progress></i></div></div>
    <div class="course-card-footer">
      <div class="course-participants"><span class="course-avatar customer" title="모의 고객">${person}</span><span class="course-avatar worker" title="보충 담당자">${stockWorker}</span><span class="course-card-add" aria-hidden="true">+</span><span data-active>매장 내 0</span></div>
      <span class="course-countdown" title="동기화된 시뮬레이션 시각 / 하루 24시간"><time data-card-clock>00:00:00</time><small>/ 24h</small></span>
    </div>`;
}
