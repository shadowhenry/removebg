/**
 * editor.js — 编辑器：状态、画布渲染、工具面板、历史记录、导出
 */

import { toast } from './ui.js';

/* ------------------------------------------------------------------ 常量 */

const SWATCHES = [
  { value: '#ffffff', title: '白底' },
  { value: '#1f2329', title: '深灰' },
  { value: '#cc0000', title: '证件照红底' },
  { value: '#1e50a2', title: '证件照蓝底' },
  { value: '#438edb', title: '浅蓝' },
  { value: '#22c55e', title: '绿' },
  { value: '#ffb020', title: '橙' },
  { value: '#8b5cf6', title: '紫' },
  { value: '#f472b6', title: '粉' },
  { value: '#e5e7eb', title: '浅灰' },
];

const RATIOS = { '1:1': 1, '4:5': 0.8, '16:9': 16 / 9, '9:16': 9 / 16, banner: 3 };

/* 参数控件绑定表：id → 状态路径 */
const RANGE_CONTROLS = [
  ['grad-angle', 'grad-angle-val', 'background.angle', (v) => `${v}°`],
  ['bg-blur', 'bg-blur-val', 'background.blur', (v) => String(v)],
  ['bg-opacity', 'bg-opacity-val', 'background.opacity', (v) => String(v)],
  ['fx-shadow', 'fx-shadow-val', 'effects.shadow', (v) => String(v)],
  ['fx-outline', 'fx-outline-val', 'effects.outline', (v) => String(v)],
  ['fx-blur', 'fx-blur-val', 'effects.blur', (v) => String(v)],
  ['fx-radius', 'fx-radius-val', 'effects.radius', (v) => String(v)],
  ['adj-brightness', 'adj-brightness-val', 'adjust.brightness', (v) => String(v)],
  ['adj-contrast', 'adj-contrast-val', 'adjust.contrast', (v) => String(v)],
  ['adj-saturate', 'adj-saturate-val', 'adjust.saturate', (v) => String(v)],
  ['adj-hue', 'adj-hue-val', 'adjust.hue', (v) => `${v}°`],
  ['ds-padding', 'ds-padding-val', 'design.padding', (v) => `${v}%`],
  ['ds-scale', 'ds-scale-val', 'design.scale', (v) => `${v}%`],
];

const COLOR_CONTROLS = [
  ['bg-color', 'background.color'],
  ['grad-color1', 'background.color1'],
  ['grad-color2', 'background.color2'],
  ['fx-outline-color', 'effects.outlineColor'],
];

const SEG_CONTROLS = [
  ['bgtype', 'background.type'],
  ['ratio', 'design.ratio'],
  ['flip', 'design.flip'],
];

/* ------------------------------------------------------------ 状态工具 */

function defaultState() {
  return {
    background: {
      type: 'transparent',
      color: '#ffffff',
      color1: '#2f7cff',
      color2: '#8f5cff',
      angle: 135,
      image: null,
      blur: 0,
      opacity: 100,
    },
    effects: { shadow: 0, outline: 0, outlineColor: '#ffffff', blur: 0, radius: 0 },
    adjust: { brightness: 100, contrast: 100, saturate: 100, hue: 0 },
    design: { ratio: 'original', padding: 6, scale: 100, flip: 'none' },
  };
}

function cloneState(s) {
  return {
    background: { ...s.background },
    effects: { ...s.effects },
    adjust: { ...s.adjust },
    design: { ...s.design },
  };
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

function roundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 把 File / Blob / URL 解码为可绘制的位图（ImageBitmap 或 HTMLImageElement）。 */
export async function toBitmap(source) {
  if (typeof createImageBitmap === 'function' && source instanceof Blob) {
    try {
      return await createImageBitmap(source);
    } catch (_) {
      /* 回退 */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    if (typeof source === 'string') img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片解码失败'));
    img.src = typeof source === 'string' ? source : URL.createObjectURL(source);
  });
}

/* ================================================================ Editor */

export class Editor {
  constructor(options = {}) {
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.wrap = options.wrap;
    this.stage = options.stage;
    this.listEl = options.listEl;
    this.onRecut = options.onRecut || (() => {});

    this.items = [];
    this.activeId = null;
    this.model = 'isnet_fp16'; // 固定使用高精度模型（UI 上不再提供切换）

    this.history = [];
    this.hIndex = -1;

    this._silCache = null;
    this._layerCache = null;
    this._raf = 0;
    this._frame = null;

    this._bind();
    window.addEventListener('resize', () => this.scheduleRender());
  }

  /* ------------------------------------------------------------ 数据 */

  get active() {
    return this.items.find((it) => it.id === this.activeId) || null;
  }

  get state() {
    const item = this.active;
    return item ? item.state : defaultState();
  }

  addItem({ name, file, source, url }) {
    const item = {
      id: `it_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name || 'image',
      file: file || null,
      source,
      url: url || (file ? URL.createObjectURL(file) : null),
      cutout: null,
      cutoutBlob: null,
      processing: false,
      state: defaultState(),
    };
    this.items.push(item);
    this.renderList();
    return item;
  }

  removeItem(id) {
    const idx = this.items.findIndex((it) => it.id === id);
    if (idx < 0 || this.items.length <= 1) return;
    const [removed] = this.items.splice(idx, 1);
    if (removed.url) URL.revokeObjectURL(removed.url);
    if (this.activeId === id) {
      const next = this.items[Math.min(idx, this.items.length - 1)];
      this.setActive(next.id);
    } else {
      this.renderList();
    }
  }

  setActive(id) {
    if (this.activeId === id) return;
    this.activeId = id;
    const item = this.active;
    if (item) {
      this.history = [cloneState(item.state)];
      this.hIndex = 0;
    }
    this._silCache = null;
    this._layerCache = null;
    this.renderList();
    this.syncControls();
    this.render();
  }

  updateThumb(item) {
    const li = this.listEl && this.listEl.querySelector(`[data-id="${item.id}"]`);
    if (!li) return;
    const img = li.querySelector('img');
    if (img) img.src = item.url || '';
    li.classList.toggle('is-busy', !!item.processing);
  }

  /* ------------------------------------------------------- 历史 / 状态 */

  commit() {
    const item = this.active;
    if (!item) return;
    this.history = this.history.slice(0, this.hIndex + 1);
    this.history.push(cloneState(item.state));
    if (this.history.length > 80) this.history.shift();
    this.hIndex = this.history.length - 1;
    this._emit();
  }

  undo() {
    if (this.hIndex <= 0) return;
    this.hIndex -= 1;
    this.active.state = cloneState(this.history[this.hIndex]);
    this._silCache = null;
    this._layerCache = null;
    this.syncControls();
    this.render();
    this._emit();
  }

  redo() {
    if (this.hIndex >= this.history.length - 1) return;
    this.hIndex += 1;
    this.active.state = cloneState(this.history[this.hIndex]);
    this._silCache = null;
    this._layerCache = null;
    this.syncControls();
    this.render();
    this._emit();
  }

  _emit() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = this.hIndex <= 0;
    if (redoBtn) redoBtn.disabled = this.hIndex >= this.history.length - 1;
  }

  set(path, value, { commit = false, render = true } = {}) {
    const item = this.active;
    if (!item) return;
    setPath(item.state, path, value);
    if (render) this.render();
    if (commit) this.commit();
  }

  /* -------------------------------------------------------- 缩略图列表 */

  renderList() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';
    this.items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'thumb' + (item.id === this.activeId ? ' is-active' : '');
      li.dataset.id = item.id;
      li.title = item.name;

      const img = document.createElement('img');
      img.src = item.url || '';
      img.alt = item.name;
      li.appendChild(img);

      const chev = document.createElement('span');
      chev.className = 'thumb__chev';
      chev.textContent = '▲';
      li.appendChild(chev);

      if (this.items.length > 1) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'thumb__del';
        del.textContent = '×';
        del.title = '移除';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeItem(item.id);
        });
        li.appendChild(del);
      }

      li.addEventListener('click', () => {
        this.setActive(item.id);
        if (!item.cutout && !item.processing && item.file) this.onRecut(item);
      });

      this.listEl.appendChild(li);
    });
  }

  /* ----------------------------------------------------------- 渲染 */

  scheduleRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.render();
    });
  }

  _canvasSize(sw, sh, ratio) {
    const MAX_SIDE = 2400;
    const MAX_PIXELS = 10e6;
    let cw;
    let ch;
    if (!ratio || ratio === 'original' || !RATIOS[ratio]) {
      cw = sw;
      ch = sh;
    } else {
      const r = RATIOS[ratio];
      const base = Math.max(sw, sh);
      if (r >= 1) {
        cw = base * Math.min(r, 3.2);
        ch = base;
      } else {
        cw = base;
        ch = base / r;
      }
    }
    let s = 1;
    if (Math.max(cw, ch) > MAX_SIDE) s = MAX_SIDE / Math.max(cw, ch);
    if (cw * ch * s * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / (cw * ch));
    return [Math.max(1, Math.round(cw * s)), Math.max(1, Math.round(ch * s))];
  }

  _filter(st, factor) {
    const parts = [];
    const a = st.adjust;
    if (a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`);
    if (a.contrast !== 100) parts.push(`contrast(${a.contrast}%)`);
    if (a.saturate !== 100) parts.push(`saturate(${a.saturate}%)`);
    if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
    if (st.effects.blur > 0) parts.push(`blur(${(st.effects.blur * factor).toFixed(2)}px)`);
    return parts.length ? parts.join(' ') : 'none';
  }

  _silhouette(image, color) {
    const c = this._silCache;
    if (c && c.image === image && c.color === color) return c.canvas;
    const cv = document.createElement('canvas');
    cv.width = image.width;
    cv.height = image.height;
    const cx = cv.getContext('2d');
    cx.drawImage(image, 0, 0);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = color;
    cx.fillRect(0, 0, cv.width, cv.height);
    this._silCache = { image, color, canvas: cv };
    return cv;
  }

  /** 主体图层：应用圆角裁剪 + 颜色调整 + 模糊，供阴影/描边复用。 */
  _subjectLayer(subject, dw, dh, radiusPx, filter, flip) {
    const key = [
      this.activeId,
      subject === this.active?.cutout ? 'cut' : 'src',
      Math.round(dw),
      Math.round(dh),
      Math.round(radiusPx),
      filter,
      flip,
    ].join('|');

    if (this._layerCache && this._layerCache.key === key) return this._layerCache.canvas;

    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(dw));
    cv.height = Math.max(1, Math.round(dh));
    const cx = cv.getContext('2d');

    if (radiusPx > 0.5) {
      roundRect(cx, 0, 0, cv.width, cv.height, Math.min(radiusPx, cv.width / 2, cv.height / 2));
      cx.clip();
    }
    if (filter && filter !== 'none') cx.filter = filter;

    if (flip && flip !== 'none') {
      cx.save();
      cx.translate(cv.width / 2, cv.height / 2);
      cx.scale(flip === 'h' ? -1 : 1, flip === 'v' ? -1 : 1);
      cx.translate(-cv.width / 2, -cv.height / 2);
      cx.drawImage(subject, 0, 0, cv.width, cv.height);
      cx.restore();
    } else {
      cx.drawImage(subject, 0, 0, cv.width, cv.height);
    }

    this._layerCache = { key, canvas: cv };
    return cv;
  }

  _drawBackground(ctx, cw, ch, st) {
    const b = st.background;
    if (b.type === 'color') {
      ctx.fillStyle = b.color;
      ctx.fillRect(0, 0, cw, ch);
      return;
    }
    if (b.type === 'gradient') {
      const a = ((b.angle - 90) * Math.PI) / 180;
      const cx = cw / 2;
      const cy = ch / 2;
      const len = Math.abs(cw * Math.cos(a)) + Math.abs(ch * Math.sin(a));
      const g = ctx.createLinearGradient(
        cx - (Math.cos(a) * len) / 2,
        cy - (Math.sin(a) * len) / 2,
        cx + (Math.cos(a) * len) / 2,
        cy + (Math.sin(a) * len) / 2
      );
      g.addColorStop(0, b.color1);
      g.addColorStop(1, b.color2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
      return;
    }
    if (b.type === 'image' && b.image) {
      const iw = b.image.width;
      const ih = b.image.height;
      const s = Math.max(cw / iw, ch / ih);
      const dw = iw * s;
      const dh = ih * s;
      ctx.save();
      const factor = Math.max(1, cw / 900);
      if (b.blur > 0) ctx.filter = `blur(${(b.blur * factor).toFixed(2)}px)`;
      ctx.globalAlpha = Math.max(0.1, Math.min(1, b.opacity / 100));
      ctx.drawImage(b.image, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      ctx.restore();
    }
  }

  render() {
    const item = this.active;
    if (!item) return;
    const ctx = this.ctx;
    const subject = item.cutout || item.source;
    if (!subject) return;

    const st = item.state;
    const sw = subject.width;
    const sh = subject.height;
    const [cw, ch] = this._canvasSize(sw, sh, st.design.ratio);

    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.wrap.style.width = '';
      this.wrap.style.height = '';
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, cw, ch);

    this._drawBackground(ctx, cw, ch, st);

    const padPct = st.design.padding / 100;
    const availW = cw * Math.max(0.05, 1 - padPct * 2);
    const availH = ch * Math.max(0.05, 1 - padPct * 2);
    const scale = Math.min(availW / sw, availH / sh) * (st.design.scale / 100);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;

    const factor = Math.max(0.55, cw / 900);
    const radiusPx = (Math.min(dw, dh) * st.effects.radius) / 400;
    const filter = this._filter(st, factor);
    const needLayer =
      radiusPx > 0.5 || st.effects.outline > 0 || st.effects.shadow > 0 || (filter && filter !== 'none');

    const layer = needLayer
      ? this._subjectLayer(subject, dw, dh, radiusPx, filter, st.design.flip)
      : null;

    // 描边（绘制在主体下方）
    if (st.effects.outline > 0) {
      const sil = this._silhouette(layer || subject, st.effects.outlineColor);
      const w = st.effects.outline * factor;
      const steps = Math.max(28, Math.round(w * 4));
      ctx.save();
      for (let i = 0; i < steps; i += 1) {
        const a = (i / steps) * Math.PI * 2;
        ctx.drawImage(sil, dx + Math.cos(a) * w, dy + Math.sin(a) * w, dw, dh);
      }
      ctx.restore();
    }

    // 主体
    ctx.save();
    if (st.effects.shadow > 0) {
      ctx.shadowColor = 'rgba(15, 35, 95, 0.34)';
      ctx.shadowBlur = st.effects.shadow * factor;
      ctx.shadowOffsetY = st.effects.shadow * factor * 0.42;
    }
    if (layer) {
      ctx.drawImage(layer, dx, dy, dw, dh);
    } else if (st.design.flip && st.design.flip !== 'none') {
      ctx.translate(dx + dw / 2, dy + dh / 2);
      ctx.scale(st.design.flip === 'h' ? -1 : 1, st.design.flip === 'v' ? -1 : 1);
      ctx.translate(-(dx + dw / 2), -(dy + dh / 2));
      ctx.drawImage(subject, dx, dy, dw, dh);
    } else {
      ctx.drawImage(subject, dx, dy, dw, dh);
    }
    ctx.restore();

    this._fitDisplay(cw, ch);
  }

  _fitDisplay(cw, ch) {
    const rect = this.stage.getBoundingClientRect();
    const availW = Math.max(120, rect.width - 36);
    const availH = Math.max(120, rect.height - 36);
    const s = Math.min(availW / cw, availH / ch, 2);
    this.wrap.style.width = Math.round(cw * s) + 'px';
    this.wrap.style.height = Math.round(ch * s) + 'px';
  }

  /* ----------------------------------------------------------- 导出 */

  _exportBlob(mime, quality) {
    const src = this.canvas;
    if (mime === 'image/jpeg') {
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const cx = c.getContext('2d');
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(src, 0, 0);
      return new Promise((resolve) => c.toBlob(resolve, mime, quality));
    }
    return new Promise((resolve) => src.toBlob(resolve, mime, quality));
  }

  _fileName(mime) {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime] || 'png';
    const base = (this.active?.name || 'image')
      .replace(/\.[^.]+$/, '')
      .replace(/[\\/:*?"<>|]+/g, '_');
    return `${base}-removebg.${ext}`;
  }

  async download(mime, quality) {
    if (!this.active) return;
    const blob = await this._exportBlob(mime, quality);
    if (!blob) {
      toast('导出失败，请重试');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this._fileName(mime);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`已导出 ${a.download}`);
  }

  /* -------------------------------------------------------- 面板与控件 */

  _bind() {
    /* 工具切换 */
    const tools = Array.from(document.querySelectorAll('.tool[data-panel]'));
    tools.forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.dataset.panel;
        if (btn.classList.contains('is-active')) {
          this.closePanel();
          return;
        }
        this.openPanel(name);
      });
    });

    const closeBtn = document.getElementById('panel-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.closePanel());

    /* 工具栏右端滑动提示（移动端）：溢出时显示，点击右滑，滑到底自动隐藏 */
    const toolbar = document.querySelector('.toolbar');
    const moreBtn = document.getElementById('toolbar-more');
    if (toolbar && moreBtn) {
      const updateMore = () => {
        const overflow = toolbar.scrollWidth - toolbar.clientWidth > 8;
        const atEnd = toolbar.scrollLeft + toolbar.clientWidth >= toolbar.scrollWidth - 8;
        moreBtn.hidden = !overflow || atEnd;
      };
      moreBtn.addEventListener('click', () => {
        toolbar.scrollBy({ left: Math.round(toolbar.clientWidth * 0.8), behavior: 'smooth' });
      });
      toolbar.addEventListener('scroll', updateMore, { passive: true });
      window.addEventListener('resize', updateMore);
      this._updateToolbarMore = updateMore;
      updateMore();
    }

    /* 分段控件 */
    SEG_CONTROLS.forEach(([name, path]) => {
      const seg = document.querySelector(`.seg[data-seg="${name}"]`);
      if (!seg) return;
      seg.addEventListener('click', (e) => {
        const btn = e.target.closest('.seg__item');
        if (!btn) return;
        this.set(path, btn.dataset.value, { commit: true });
        this._syncSeg(name, btn.dataset.value);
      });
    });

    /* 滑杆 */
    RANGE_CONTROLS.forEach(([id, valId, path, fmt]) => {
      const input = document.getElementById(id);
      const out = document.getElementById(valId);
      if (!input) return;
      const paint = () => {
        if (out) out.textContent = fmt(Number(input.value));
      };
      input.addEventListener('input', () => {
        this.set(path, Number(input.value), { render: true });
        paint();
      });
      input.addEventListener('change', () => this.commit());
      paint();
    });

    /* 取色器 */
    COLOR_CONTROLS.forEach(([id, path]) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('input', () => this.set(path, input.value, { render: true }));
      input.addEventListener('change', () => this.commit());
    });

    /* 色板 */
    const swatchBox = document.getElementById('swatches');
    if (swatchBox) {
      SWATCHES.forEach((sw) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.style.background = sw.value;
        b.title = sw.title;
        b.dataset.color = sw.value;
        b.addEventListener('click', () => {
          this.set('background.type', 'color', { render: false });
          this.set('background.color', sw.value, { render: false });
          const colorInput = document.getElementById('bg-color');
          if (colorInput) colorInput.value = sw.value;
          this._syncSeg('bgtype', 'color');
          this._syncBgBlocks();
          this.render();
          this.commit();
        });
        swatchBox.appendChild(b);
      });
    }

    /* 背景图片 */
    const bgBtn = document.getElementById('btn-bg-image');
    const bgInput = document.getElementById('bg-image-input');
    if (bgBtn && bgInput) {
      bgBtn.addEventListener('click', () => bgInput.click());
      bgInput.addEventListener('change', async () => {
        const file = bgInput.files && bgInput.files[0];
        if (!file) return;
        try {
          const bmp = await toBitmap(file);
          this.set('background.image', bmp, { render: false });
          this.set('background.type', 'image', { render: false });
          this._syncSeg('bgtype', 'image');
          this._syncBgBlocks();
          this.render();
          this.commit();
        } catch (_) {
          toast('背景图片读取失败');
        }
        bgInput.value = '';
      });
    }

    /* 重新抠图 */
    const recut = document.getElementById('btn-recut');
    if (recut) {
      recut.addEventListener('click', () => {
        const item = this.active;
        if (item) this.onRecut(item);
      });
    }

    /* 重置调整 */
    const reset = document.getElementById('btn-adj-reset');
    if (reset) {
      reset.addEventListener('click', () => {
        Object.assign(this.state.adjust, { brightness: 100, contrast: 100, saturate: 100, hue: 0 });
        this.syncControls();
        this.render();
        this.commit();
      });
    }

    /* 撤销 / 重做 / 适应窗口 */
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
    if (redoBtn) redoBtn.addEventListener('click', () => this.redo());

    const fitBtn = document.getElementById('btn-fit');
    if (fitBtn) {
      fitBtn.addEventListener('click', () => {
        Object.assign(this.state.design, { padding: 6, scale: 100 });
        this.syncControls();
        this.render();
        this.commit();
        toast('已适应窗口');
      });
    }

    /* 下载 */
    const dlBtn = document.getElementById('btn-download');
    const dlMenu = document.getElementById('download-menu');
    if (dlBtn && dlMenu) {
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dlMenu.hidden = !dlMenu.hidden;
      });
      document.addEventListener('click', (e) => {
        if (!dlMenu.hidden && !dlMenu.contains(e.target) && e.target !== dlBtn) dlMenu.hidden = true;
      });
    }

    const qualityRow = document.getElementById('quality-row');
    const quality = document.getElementById('quality');
    const qualityVal = document.getElementById('quality-val');
    if (quality && qualityVal) {
      quality.addEventListener('input', () => {
        qualityVal.textContent = quality.value;
      });
    }
    document.querySelectorAll('input[name="fmt"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const lossy = radio.value !== 'image/png';
        if (qualityRow) qualityRow.hidden = !lossy;
      });
    });

    const doDl = document.getElementById('btn-do-download');
    if (doDl) {
      doDl.addEventListener('click', async () => {
        const picked = document.querySelector('input[name="fmt"]:checked');
        const mime = picked ? picked.value : 'image/png';
        const q = quality ? Number(quality.value) / 100 : 0.92;
        if (dlMenu) dlMenu.hidden = true;
        await this.download(mime, q);
      });
    }

    this._syncBgBlocks();
  }

  openPanel(name) {
    const panel = document.getElementById('panel');
    if (!panel) return;
    panel.hidden = false;
    document.querySelectorAll('.tool[data-panel]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.panel === name);
    });
    document.querySelectorAll('.panel__body').forEach((b) => {
      b.hidden = b.dataset.body !== name;
    });
  }

  closePanel() {
    const panel = document.getElementById('panel');
    if (panel) panel.hidden = true;
    document.querySelectorAll('.tool[data-panel]').forEach((b) => b.classList.remove('is-active'));
  }

  get panelOpen() {
    const panel = document.getElementById('panel');
    return !!panel && !panel.hidden;
  }

  /* 视图从隐藏变为可见后，工具栏尺寸才有效，需要重新评估滑动提示 */
  refreshToolbarHint() {
    if (this._updateToolbarMore) this._updateToolbarMore();
  }

  _syncSeg(name, value) {
    const seg = document.querySelector(`.seg[data-seg="${name}"]`);
    if (!seg) return;
    seg.querySelectorAll('.seg__item').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.value === value);
    });
  }

  _syncBgBlocks() {
    const type = this.state.background.type;
    document.querySelectorAll('.panel__block').forEach((b) => {
      b.hidden = b.dataset.block !== type;
    });
    const swatchBox = document.getElementById('swatches');
    if (swatchBox) {
      swatchBox.querySelectorAll('.swatch').forEach((s) => {
        s.classList.toggle('is-active', s.dataset.color === this.state.background.color);
      });
    }
  }

  /** 用当前状态回写所有控件（撤销/重做/切换图片后调用） */
  syncControls() {
    const st = this.state;
    RANGE_CONTROLS.forEach(([id, valId, path, fmt]) => {
      const input = document.getElementById(id);
      if (!input) return;
      const v = getPath(st, path);
      if (v == null) return;
      input.value = String(v);
      const out = document.getElementById(valId);
      if (out) out.textContent = fmt(Number(v));
    });
    COLOR_CONTROLS.forEach(([id, path]) => {
      const input = document.getElementById(id);
      if (!input) return;
      const v = getPath(st, path);
      if (typeof v === 'string') input.value = v;
    });
    SEG_CONTROLS.forEach(([name, path]) => {
      const v = getPath(st, path);
      if (v != null) this._syncSeg(name, v);
    });
    this._syncSeg('model', this.model);
    this._syncBgBlocks();
    this._emit();
  }

  setEngineDescription(text) {
    const el = document.getElementById('engine-desc');
    if (el) el.textContent = text;
  }

  /** 抠图结果更新后清空派生缓存 */
  invalidateCache() {
    this._silCache = null;
    this._layerCache = null;
  }

  /* ----------------------------------------------------- 处理中星星闪烁 */

  /**
   * 处理中在画布上覆盖「深灰底 + 金色星星闪烁」层。
   * @param {boolean} on  开/关
   * @param {string} [id] 触发该项的 id（关闭时校验归属，避免队列竞态误删）
   */
  setProcessing(on, id) {
    if (on) {
      this._processingFor = id || null;
      this._spawnSparkles();
    } else if (!id || this._processingFor === id) {
      this._processingFor = null;
      this._removeSparkles();
    }
  }

  _spawnSparkles() {
    this._removeSparkles();
    const layer = document.createElement('div');
    layer.className = 'sparkles';
    layer.setAttribute('aria-hidden', 'true');
    const STAR =
      '<svg viewBox="0 0 24 24"><path d="M12 1.5c.7 5.8 4.7 9.8 10.5 10.5-5.8.7-9.8 4.7-10.5 10.5C11.3 16.7 7.3 12.7 1.5 12 7.3 11.3 11.3 7.3 12 1.5Z"/></svg>';
    const COUNT = 14;
    for (let i = 0; i < COUNT; i += 1) {
      const s = document.createElement('span');
      s.className = 'sparkles__star';
      s.innerHTML = STAR;
      s.style.left = (5 + Math.random() * 90).toFixed(1) + '%';
      s.style.top = (5 + Math.random() * 90).toFixed(1) + '%';
      const size = 9 + Math.random() * 17;
      s.style.width = size.toFixed(0) + 'px';
      s.style.height = size.toFixed(0) + 'px';
      s.style.animationDelay = (Math.random() * 1.6).toFixed(2) + 's';
      s.style.animationDuration = (1.1 + Math.random() * 1.2).toFixed(2) + 's';
      layer.appendChild(s);
    }
    this.wrap.appendChild(layer);
    this._sparkles = layer;
  }

  _removeSparkles() {
    if (this._sparkles) {
      this._sparkles.remove();
      this._sparkles = null;
    }
  }

  /** 处理完成：结果图淡入揭示 */
  reveal() {
    this.wrap.classList.remove('is-reveal');
    // 强制 reflow 以便动画可重复触发
    void this.wrap.offsetWidth;
    this.wrap.classList.add('is-reveal');
    clearTimeout(this._revealTimer);
    this._revealTimer = setTimeout(() => this.wrap.classList.remove('is-reveal'), 650);
  }
}
