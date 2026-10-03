/** ui.js — 轻量提示与进度遮罩 */

let toastTimer = 0;

export function toast(message, ms = 3400) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth; // 重放动画
  el.style.animation = '';
  clearTimeout(toastTimer);
  // ms <= 0 表示常驻，需手动 hideToast()
  if (ms > 0) {
    toastTimer = window.setTimeout(() => { el.hidden = true; }, ms);
  }
}

/** 手动关闭 toast（用于常驻提示，如模型下载） */
export function hideToast() {
  clearTimeout(toastTimer);
  const el = document.getElementById('toast');
  if (el) el.hidden = true;
}

/** 静默更新当前 toast 的文案（不重放动画，用于进度百分比刷新） */
export function toastProgress(message) {
  const el = document.getElementById('toast');
  if (!el || el.hidden) return;
  el.textContent = message;
}

export const progress = {
  el: () => document.getElementById('overlay'),

  show(stage = '正在准备…', hint = '图片不会离开本机') {
    const el = this.el();
    if (!el) return;
    el.hidden = false;
    this.set(0, stage, hint);
  },

  set(percent, stage, hint) {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    const fill = document.getElementById('progress-fill');
    const meta = document.getElementById('progress-meta');
    const stageEl = document.getElementById('progress-stage');
    const hintEl = document.getElementById('progress-hint');
    if (fill) fill.style.width = p + '%';
    if (meta) meta.textContent = p + '%';
    if (stage && stageEl) stageEl.textContent = stage;
    if (hint && hintEl) hintEl.textContent = hint;
  },

  /** 不确定进度时的流动样式 */
  indeterminate(stage, hint) {
    const el = this.el();
    if (el) el.hidden = false;
    const meta = document.getElementById('progress-meta');
    const stageEl = document.getElementById('progress-stage');
    const fill = document.getElementById('progress-fill');
    if (stage && stageEl) stageEl.textContent = stage;
    if (hint) document.getElementById('progress-hint') && (document.getElementById('progress-hint').textContent = hint);
    if (fill) fill.style.width = '100%';
    if (meta) meta.textContent = '';
  },

  hide() {
    const el = this.el();
    if (el) el.hidden = true;
  },
};
