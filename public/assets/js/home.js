/**
 * home.js — 首页交互
 *
 *  · 演示 GIF：原图 → 去背景 自动循环（纯 <img>，无需控制逻辑）
 *  · 全窗口拖拽遮罩：拖入文件时整页高亮提示
 *  · 细节增强：粘贴入口键盘可达、减少动态偏好处理
 */

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------ 拖拽遮罩 */

function initDropzone(onFiles) {
  const zone = document.getElementById('dropzone');
  if (!zone || typeof onFiles !== 'function') return;

  let depth = 0;
  const carriesFiles = (e) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  const open = () => { zone.hidden = false; };
  const close = () => { zone.hidden = true; depth = 0; };

  window.addEventListener('dragenter', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    depth += 1;
    open();
  });

  window.addEventListener('dragover', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });

  window.addEventListener('dragleave', (e) => {
    if (!carriesFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) close();
  });

  window.addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    close();
    if (e.dataTransfer && e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  });

  // 焦点/窗口切走时复位，避免遮罩卡住
  window.addEventListener('blur', close);
}

/* ------------------------------------------------------------ 品牌眼睛 */

/**
 * 顶栏双眼 logo：眼球随指针转动（lerp 平滑），CSS 侧另有周期眨眼。
 * 眼球可动范围 = 眼白半径 11 - 瞳孔半径 4 = 7，取 6.4 留边。
 */
function initBrandEyes() {
  const brand = document.getElementById('brand');
  if (!brand) return;
  const balls = [...brand.querySelectorAll('.eye-ball')];
  if (!balls.length || prefersReducedMotion()) return;

  const MAX = 6.4;
  let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0;

  function paint() {
    cx += (tx - cx) * 0.16;
    cy += (ty - cy) * 0.16;
    for (const ball of balls) {
      const inner = ball.querySelector('.eye-inner');
      const glare = ball.querySelector('.eye-glare');
      inner.setAttribute('cx', (12 + cx).toFixed(2));
      inner.setAttribute('cy', (12 + cy).toFixed(2));
      glare.setAttribute('cx', (14.5 + cx).toFixed(2));
      glare.setAttribute('cy', (9.5 + cy).toFixed(2));
    }
    if (Math.abs(tx - cx) > 0.02 || Math.abs(ty - cy) > 0.02) {
      raf = requestAnimationFrame(paint);
    } else {
      raf = 0;
    }
  }

  window.addEventListener('pointermove', (e) => {
    const eye = brand.querySelector('.eye');
    const r = eye.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    const m = Math.min(d / 26, MAX); // 距离越远转得越多，封顶 MAX
    tx = (dx / d) * m;
    ty = (dy / d) * m;
    if (!raf) raf = requestAnimationFrame(paint);
  }, { passive: true });
}

/* ------------------------------------------------------------ 细节增强 */

function initA11y() {
  const sub = document.querySelector('.drop-card__sub');
  if (!sub) return;
  sub.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      sub.click();
    }
  });
}

/* ------------------------------------------------------------ 入口 */

export function initHome({ onFiles } = {}) {
  initDropzone(onFiles);
  initA11y();
  initBrandEyes();
}
