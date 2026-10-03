/**
 * remover.js — 抠图引擎封装
 *
 * 基于 @imgly/background-removal（ISNet ONNX 模型），纯前端推理，
 * 设备自动降级：WebGPU → WebGL → WASM。图片不上传任何服务器。
 */

const SOURCES = [
  'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm',
  'https://esm.sh/@imgly/background-removal@1.7.0?bundle',
  'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1/+esm',
];

let libPromise = null;

/** 给 Promise 加超时（防止挂死的 CDN 无限阻塞后续源）。 */
function withTimeout(promise, ms, message) {
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** 按顺序尝试多个 CDN，任意一个可用即可。单个源 25s 无响应即换下一个。 */
export function loadLibrary() {
  if (libPromise) return libPromise;
  libPromise = (async () => {
    let lastError = null;
    for (const url of SOURCES) {
      try {
        const mod = await withTimeout(
          import(/* webpackIgnore: true */ url),
          25000,
          '加载超时'
        );
        if (typeof mod.removeBackground === 'function') return mod;
        lastError = new Error('模块未导出 removeBackground');
      } catch (err) {
        lastError = err;
      }
    }
    libPromise = null;
    throw new Error(
      '抠图引擎加载失败，请检查网络后重试。' + (lastError ? `（${lastError.message}）` : '')
    );
  })();
  return libPromise;
}

/** 探测本机推理后端。 */
export async function detectDevice() {
  try {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'WebGPU';
    }
  } catch (_) {
    /* ignore */
  }
  try {
    const c = document.createElement('canvas');
    if (c.getContext('webgl2') || c.getContext('webgl')) return 'WebGL';
  } catch (_) {
    /* ignore */
  }
  return 'WASM';
}

/* 各阶段在总进度中的权重区间 */
const STAGE_RANGE = {
  fetch: [0.0, 0.7],
  load: [0.7, 0.78],
  compute: [0.78, 0.97],
  run: [0.78, 0.97],
  post: [0.97, 1.0],
};

const STAGE_TEXT = {
  fetch: '下载模型',
  load: '加载模型',
  compute: '前向推理',
  run: '前向推理',
  post: '后处理',
};

export function stageText(key) {
  if (!key) return '正在处理';
  const head = String(key).split(/[:\-.]/)[0].toLowerCase();
  return STAGE_TEXT[head] || '正在处理';
}

function overallProgress(key, current, total) {
  const head = String(key || '').split(/[:\-.]/)[0].toLowerCase();
  const [start, end] = STAGE_RANGE[head] || [0.75, 0.95];
  if (!total || total <= 0) return start;
  const ratio = Math.max(0, Math.min(1, current / total));
  return start + (end - start) * ratio;
}

/**
 * 执行抠图。
 * @param {Blob|File|string} source 图片
 * @param {object} options
 * @param {'isnet_quint8'|'isnet_fp16'} [options.model] 模型，默认高精度版
 * @param {(detail:{key:string,label:string,percent:number,current:number,total:number})=>void} [options.onProgress]
 * @returns {Promise<Blob>} 透明 PNG
 */
export async function cutout(source, options = {}) {
  const { model = 'isnet_fp16', onProgress, stallMs = 120000 } = options;
  const mod = await loadLibrary();

  // 停滞看门狗：stallMs 内没有任何进度事件即判定卡死，reject 让调用方收尾，
  // 避免网络挂死导致「处理中」状态永远无法结束。
  let lastTick = Date.now();
  let watchdog = 0;
  const stallGuard = new Promise((_, reject) => {
    watchdog = setInterval(() => {
      if (Date.now() - lastTick > stallMs) {
        reject(new Error('处理超时：模型下载或推理长时间无进展，请检查网络后重试'));
      }
    }, 5000);
  });

  const config = {
    output: { format: 'image/png' },
    progress: (key, current, total) => {
      lastTick = Date.now();
      if (!onProgress) return;
      onProgress({
        key,
        label: stageText(key),
        percent: overallProgress(key, current, total),
        current,
        total,
      });
    },
  };
  if (model) config.model = model;

  const run = (cfg) => Promise.race([mod.removeBackground(source, cfg), stallGuard]);

  try {
    try {
      return await run(config);
    } catch (err) {
      if (config.model && !/超时/.test(err && err.message)) {
        // 个别版本对 model 取值校验更严，退回默认模型再试一次
        const retry = { ...config };
        delete retry.model;
        return await run(retry);
      }
      throw err;
    }
  } finally {
    clearInterval(watchdog);
  }
}
