import { toast } from "sonner";

/**
 * 瀏覽器功能相容性檢測結果
 */
export interface CompatibilityResult {
  isCompatible: boolean;
  missingFeatures: string[];
  warnings: string[];
  browserInfo: {
    name: string;
    version: string;
    os: string;
    isMobile: boolean;
  };
}

/**
 * 獲取瀏覽器資訊
 */
function getBrowserInfo(): CompatibilityResult['browserInfo'] {
  const ua = navigator.userAgent;
  let browserName = "未知瀏覽器";
  let version = "未知版本";
  let os = "未知操作系統";
  let isMobile = false;

  // 檢測作業系統
  if (/Windows/.test(ua)) {
    os = "Windows";
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    os = "macOS";
  } else if (/Linux/.test(ua)) {
    os = "Linux";
  } else if (/Android/.test(ua)) {
    os = "Android";
    isMobile = true;
  } else if (/iPhone|iPad|iPod/.test(ua)) {
    os = "iOS";
    isMobile = true;
  }

  // 檢測瀏覽器
  if (/Edge|Edg/.test(ua)) {
    browserName = "Edge";
    version = ua.match(/Edge?\/([0-9\.]+)/)?.[1] || version;
  } else if (/Chrome/.test(ua)) {
    browserName = "Chrome";
    version = ua.match(/Chrome\/([0-9\.]+)/)?.[1] || version;
  } else if (/Firefox/.test(ua)) {
    browserName = "Firefox";
    version = ua.match(/Firefox\/([0-9\.]+)/)?.[1] || version;
  } else if (/Safari/.test(ua) && !/Chrome/.test(ua)) {
    browserName = "Safari";
    version = ua.match(/Version\/([0-9\.]+)/)?.[1] || version;
  }

  return {
    name: browserName,
    version,
    os,
    isMobile
  };
}

/**
 * 檢查瀏覽器 API 相容性
 */
function checkApiSupport(): { missingFeatures: string[], warnings: string[] } {
  const missingFeatures: string[] = [];
  const warnings: string[] = [];

  // 檢查 File API
  if (!window.File || !window.FileReader || !window.FileList || !window.Blob) {
    missingFeatures.push("File API");
  }

  // 檢查 Web Workers
  if (!window.Worker) {
    missingFeatures.push("Web Workers");
  }

  // 檢查 Canvas API
  if (!document.createElement('canvas').getContext) {
    missingFeatures.push("Canvas API");
  }

  // 檢查 URL.createObjectURL
  if (!window.URL || !URL.createObjectURL) {
    missingFeatures.push("URL.createObjectURL");
  }

  // 檢查 OffscreenCanvas (用於 Web Workers)
  if (typeof OffscreenCanvas === 'undefined') {
    warnings.push("OffscreenCanvas");
  }

  // 檢查 AbortController (用於取消操作)
  if (typeof AbortController === 'undefined') {
    warnings.push("AbortController");
  }

  return { missingFeatures, warnings };
}

/**
 * 檢查特定功能支援
 */
export function checkFeatureSupport(feature: string): boolean {
  switch (feature) {
    case "heic":
      return typeof window.createImageBitmap !== 'undefined';
    case "webp":
      const canvas = document.createElement('canvas');
      if (!canvas || !canvas.getContext('2d')) return false;
      return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    case "worker-canvas":
      return typeof OffscreenCanvas !== 'undefined';
    case "filesystem-api":
      return 'showDirectoryPicker' in window;
    default:
      return false;
  }
}

/**
 * 檢查瀏覽器相容性
 */
export function checkBrowserCompatibility(): CompatibilityResult {
  const browserInfo = getBrowserInfo();
  const { missingFeatures, warnings } = checkApiSupport();
  
  // 決定整體相容性
  const isCompatible = missingFeatures.length === 0;

  return {
    isCompatible,
    missingFeatures,
    warnings,
    browserInfo
  };
}

/**
 * 顯示相容性警告
 */
export function showCompatibilityWarnings(): void {
  const compatibility = checkBrowserCompatibility();
  
  if (!compatibility.isCompatible) {
    toast.error(
      `您的瀏覽器缺少關鍵功能：${compatibility.missingFeatures.join(", ")}。請使用最新版本的 Chrome、Firefox 或 Edge。`,
      { duration: 10000, id: "browser-compatibility-error" }
    );
    return;
  }
  
  if (compatibility.warnings.length > 0) {
    toast.warning(
      `您的瀏覽器可能不支援某些進階功能：${compatibility.warnings.join(", ")}。如需完整體驗，請使用最新版本的 Chrome 或 Edge。`,
      { duration: 8000, id: "browser-compatibility-warning" }
    );
  }
  
  // 特定瀏覽器警告
  const { name, version, isMobile } = compatibility.browserInfo;
  
  if (isMobile) {
    toast.warning(
      "您正在使用行動裝置。此應用程式在桌面設備上效果最佳。",
      { duration: 5000, id: "mobile-device-warning" }
    );
  }
  
  if (name === "Safari") {
    toast.warning(
      "Safari 瀏覽器的部分功能可能受限。若遇到問題，請嘗試使用 Chrome 或 Firefox。",
      { duration: 5000, id: "safari-warning" }
    );
  }
}

/**
 * 檢查並報告性能相容性
 */
export function checkPerformanceCompatibility(): { 
  isHighPerformance: boolean; 
  hasWebGPU: boolean;
  hasSharedArrayBuffer: boolean;
  processorCores: number;
} {
  const hasWebGPU = 'gpu' in navigator;
  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  const processorCores = navigator.hardwareConcurrency || 1;
  const isHighPerformance = processorCores >= 4 && hasSharedArrayBuffer;

  return {
    isHighPerformance,
    hasWebGPU,
    hasSharedArrayBuffer,
    processorCores
  };
}

/**
 * 獲取建議的工作者數量
 */
export function getRecommendedWorkerCount(): number {
  const { processorCores } = checkPerformanceCompatibility();
  // 推薦的工作者數量 = 邏輯核心數 - 1（至少為 1）
  return Math.max(1, processorCores - 1);
}

/**
 * 根據設備能力調整設置
 */
export function getOptimizedSettings(): {
  maxBatchSize: number;
  useHighPrecision: boolean;
  maxFileSizeMB: number;
} {
  const { isHighPerformance, processorCores } = checkPerformanceCompatibility();
  
  return {
    maxBatchSize: isHighPerformance ? 10 : 3,
    useHighPrecision: isHighPerformance,
    maxFileSizeMB: isHighPerformance ? 50 : 20
  };
} 