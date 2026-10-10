/**
 * app.js — 应用入口：视图切换、上传、抠图调度、PWA 安装
 */

import { Editor, toBitmap } from './editor.js';
import { cutout, detectDevice } from './remover.js';
import { initHome } from './home.js';
import { toast, hideToast, toastProgress, progress } from './ui.js';

/* ------------------------------------------------------------ 元素引用 */

const viewHome = document.getElementById('view-home');
const viewEditor = document.getElementById('view-editor');
const topbar = document.querySelector('.topbar');
const fileInput = document.getElementById('file-input');
const stageHint = document.getElementById('stage-hint');

const editor = new Editor({
  canvas: document.getElementById('canvas'),
  wrap: document.getElementById('canvas-wrap'),
  stage: document.getElementById('stage'),
  listEl: document.getElementById('filmstrip-list'),
  onRecut: (item) => enqueue(item),
});
window.__editor = editor; // 调试句柄（控制台可直接操作编辑器）

/* ------------------------------------------------------------ 视图切换 */

function activateHome() {
  document.body.classList.remove('is-editing');
  viewHome.hidden = false;
  viewEditor.hidden = true;
  editor.closePanel();
  editor.closeDownloadMenu();
  if (topbar) topbar.style.display = '';
}

function activateEditor() {
  document.body.classList.add('is-editing');
  viewHome.hidden = true;
  viewEditor.hidden = false;
  if (topbar) topbar.style.display = 'none';
  requestAnimationFrame(() => {
    editor.scheduleRender();
    editor.refreshToolbarHint();
  });
}

function goEditor() {
  if (location.hash !== '#/edit') location.hash = '#/edit';
  else activateEditor();
}

function goHome() {
  if (location.hash && location.hash !== '#/') location.hash = '#/';
  else activateHome();
}

window.addEventListener('hashchange', () => {
  if (location.hash === '#/edit') activateEditor();
  else activateHome();
});

/* ------------------------------------------------------------ 抠图调度 */

const queue = [];
let running = false;

/* 模型是否已就绪（首次下载成功后持久化，之后传新图只提示「正在处理」）
 * key 带模型名：切换模型后视为未就绪，重新提示下载进度 */
const MODEL_READY_KEY = `rbg-model-ready:${editor.model}`;
let modelReady = false;
try {
  modelReady = localStorage.getItem(MODEL_READY_KEY) === '1';
} catch (_) {
  /* 隐私模式等场景忽略 */
}

function enqueue(item) {
  if (!item || item.processing) return;
  queue.push(item);
  if (!running) drain();
}

async function drain() {
  running = true;
  while (queue.length) {
    const item = queue.shift();
    // eslint-disable-next-line no-await-in-loop
    await processItem(item);
  }
  running = false;
}

async function processItem(item) {
  const showModelToast = !modelReady; // 仅首次（模型未缓存）提示下载
  item.processing = true;
  editor.updateThumb(item);
  // 处理中：画布覆盖星星闪烁层（仅当前项处理时），不再弹框
  if (editor.activeId === item.id) editor.setProcessing(true, item.id);
  if (showModelToast) {
    toast('正在下载模型… 0%（仅首次，下载后自动开始抠图）', 0);
  }

  try {
    const blob = await cutout(item.file, {
      model: editor.model,
      stallMs: 180000, // 移动端慢网兜底：3 分钟无任何进展才判定卡死
      onProgress: ({ percent }) => {
        // 画布闪烁层底部进度条始终跟随真实进度（下载 0~70% → 推理 70~100%）
        if (editor.activeId === item.id) editor.setProgress(percent);
        if (!showModelToast) return;
        if (percent < 0.7) {
          // 下载阶段（整体进度 0~70%）→ 实时显示下载百分比，避免用户以为卡死
          const dl = Math.min(99, Math.round((percent / 0.7) * 100));
          toastProgress(`正在下载模型… ${dl}%（仅首次，下载后自动开始抠图）`);
        } else {
          hideToast();
        }
      },
    });
    if (showModelToast) hideToast();

    const bitmap = await toBitmap(blob);
    item.cutoutBlob = blob;
    item.cutout = bitmap;
    item.hasRun = true;
    editor.invalidateCache();

    if (editor.activeId === item.id) {
      editor.render();
      editor.reveal(); // 闪烁结束，淡入展示处理后的图
    } else {
      editor.updateThumb(item);
    }

    if (!modelReady) {
      modelReady = true;
      try {
        localStorage.setItem(MODEL_READY_KEY, '1');
      } catch (_) {
        /* ignore */
      }
      showStageHint('模型已缓存，下次打开可离线使用');
    }
  } catch (err) {
    console.error(err);
    if (showModelToast) hideToast();
    toast(err && err.message ? err.message : '抠图失败，请重试', 5000);
  } finally {
    item.processing = false;
    editor.updateThumb(item);
    editor.setProcessing(false, item.id);
  }
}

let hintTimer = 0;
function showStageHint(text) {
  if (!stageHint) return;
  stageHint.textContent = text;
  stageHint.hidden = false;
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    stageHint.hidden = true;
  }, 4200);
}

/* ------------------------------------------------------------ 图片入口 */

async function handleBlob(blob, name) {
  if (!blob || !blob.type.startsWith('image/')) {
    toast('请选择图片文件');
    return;
  }
  try {
    const source = await toBitmap(blob);
    const item = editor.addItem({ name, file: blob, source });
    // 新图始终成为当前项：画布立即显示新图原图，处理完成后自动换成抠图结果
    editor.setActive(item.id);
    goEditor();
    enqueue(item);
  } catch (_) {
    toast('图片读取失败，请换一张试试');
  }
}

async function handleFiles(fileList) {
  const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
  if (!files.length) {
    toast('请选择图片文件');
    return;
  }
  for (const file of files) {
    // 顺序解码，避免一次性占用过多内存
    // eslint-disable-next-line no-await-in-loop
    await handleBlob(file, file.name);
  }
}

/* 上传按钮 */
document.getElementById('btn-upload').addEventListener('click', () => fileInput.click());
document.getElementById('btn-add').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
  fileInput.value = '';
});

/* 示例图片 */
document.getElementById('samples-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.sample');
  if (!btn) return;
  const url = btn.dataset.src;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    handleBlob(blob, url.split('/').pop());
  } catch (_) {
    toast('示例图片加载失败');
  }
});

/* 拖拽：由 home.js 的全窗口遮罩统一接管（见 initHome → initDropzone） */

/* 粘贴（图片或 URL） */
document.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const file = it.getAsFile();
      if (file) {
        e.preventDefault();
        handleBlob(file, file.name || 'pasted-image.png');
      }
      return;
    }
  }
  const text = e.clipboardData.getData('text');
  if (text && /^https?:\/\/\S+$/i.test(text.trim()) && !viewEditor.hidden) return;
  if (text && /^https?:\/\/\S+$/i.test(text.trim())) {
    e.preventDefault();
    loadFromUrl(text.trim());
  }
});

/* URL 输入 */
document.querySelector('.drop-card__sub').addEventListener('click', () => {
  let url = null;
  try {
    url = window.prompt('粘贴图片网址（URL）');
  } catch (_) {
    url = null;
  }
  if (url == null) {
    toast('也可以直接按 ⌘/Ctrl + V 粘贴图片');
    return;
  }
  if (/^https?:\/\/\S+$/i.test(url.trim())) loadFromUrl(url.trim());
  else if (url.trim()) toast('请填写以 http/https 开头的图片地址');
});

async function loadFromUrl(url) {
  progress.show('正在获取图片…', url);
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error('目标不是图片');
    progress.hide();
    handleBlob(blob, decodeURIComponent(url.split('/').pop() || 'image'));
  } catch (_) {
    progress.hide();
    toast('无法直接读取该网址（对方可能未开放跨域）。请把图片保存到本地后再上传。');
  }
}

/* ------------------------------------------------------------ 其它交互 */

document.getElementById('btn-back').addEventListener('click', goHome);
document.getElementById('brand').addEventListener('click', () => {
  if (document.body.classList.contains('is-editing')) goHome();
});

document.addEventListener('keydown', (e) => {
  const editing = document.body.classList.contains('is-editing');
  const mod = e.metaKey || e.ctrlKey;

  if (e.key === 'Escape') {
    if (editor.downloadMenuOpen) {
      editor.closeDownloadMenu();
    } else if (editor.panelOpen) {
      editor.closePanel();
    } else if (editing) {
      goHome();
    }
    return;
  }
  if (!editing) return;

  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) editor.redo();
    else editor.undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    editor.redo();
  } else if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    const picked = document.querySelector('input[name="fmt"]:checked');
    editor.download(picked ? picked.value : 'image/png', 0.92);
  }
});

window.addEventListener(
  'scroll',
  () => {
    if (topbar) topbar.classList.toggle('is-scrolled', window.scrollY > 8);
  },
  { passive: true }
);

/* ------------------------------------------------------------ PWA */

let deferredPrompt = null;
const installBtn = document.getElementById('btn-install');

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (installBtn && !isStandalone) installBtn.hidden = false;
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  if (installBtn) installBtn.hidden = true;
  toast('已安装到桌面，可以像 App 一样直接打开');
});

if (installBtn) {
  if (isIOS && !isStandalone) installBtn.hidden = false;

  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted' && installBtn) installBtn.hidden = true;
      } catch (_) {
        /* ignore */
      }
      deferredPrompt = null;
      return;
    }
    if (isIOS) {
      toast('在 Safari 中点击底部「分享」→「添加到主屏幕」，即可像 App 一样打开。', 6000);
    } else {
      toast('在浏览器地址栏右侧找到「安装」图标，或菜单里的「安装应用」。', 6000);
    }
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service Worker 注册失败', err);
    });
  });
}

/* ------------------------------------------------------------ 启动 */

(async function boot() {
  initHome({ onFiles: handleFiles });

  const device = await detectDevice();
  editor.setEngineDescription(`本机推理后端：${device}（自动降级 WebGPU → WebGL → WASM）`);

  if (location.hash === '#/edit') activateEditor();
  else activateHome();
})();
