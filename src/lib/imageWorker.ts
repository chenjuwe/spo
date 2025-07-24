import { analyzeImageQuality, calculatePerceptualHash, calculateDifferenceHash, calculateAverageHash, calculateAllHashes } from './workerCore';

/**
 * Worker 入口處理函數
 * 支援分析圖片品質、計算感知哈希等任務
 * 增強版：支持通過 URL 傳輸文件和優先級處理
 */
self.onmessage = async (e) => {
  const { task, id, options = {}, priority = 0 } = e.data;
  const startTime = performance.now();

  try {
    let result;
    let source;
    
    // 處理輸入源 - 支持 File 對象或 URL
    if (e.data.file) {
      source = e.data.file;
    } else if (e.data.fileUrl && e.data.useFileUrl) {
      // 使用傳遞的文件 URL
      source = {
        fileUrl: e.data.fileUrl,
        fileName: e.data.fileName || '',
        fileType: e.data.fileType || '',
        fileSize: e.data.fileSize || 0,
        useFileUrl: true
      };
    } else if (e.data.files && Array.isArray(e.data.files)) {
      // 支援批量處理
      source = e.data.files;
    } else {
      throw new Error(`缺少有效的輸入源`);
    }
    
    // 處理任務
    switch (task) {
      case 'analyzeImageQuality':
        if (Array.isArray(source)) {
          // 批量處理
          result = await Promise.all(source.map(async (item) => {
            try {
              return { id: item.id || null, result: await analyzeImageQuality(item) };
            } catch (err) {
              return { id: item.id || null, error: err.message || String(err) };
            }
          }));
        } else {
          result = await analyzeImageQuality(source);
        }
        break;
        
      case 'calculatePerceptualHash':
        if (Array.isArray(source)) {
          result = await Promise.all(source.map(async (item) => {
            try {
              return { id: item.id || null, result: await calculatePerceptualHash(item) };
            } catch (err) {
              return { id: item.id || null, error: err.message || String(err) };
            }
          }));
        } else {
          result = await calculatePerceptualHash(source);
        }
        break;
        
      case 'calculateDifferenceHash':
        if (Array.isArray(source)) {
          result = await Promise.all(source.map(async (item) => {
            try {
              return { id: item.id || null, result: await calculateDifferenceHash(item) };
            } catch (err) {
              return { id: item.id || null, error: err.message || String(err) };
            }
          }));
        } else {
          result = await calculateDifferenceHash(source);
        }
        break;
        
      case 'calculateAverageHash':
        if (Array.isArray(source)) {
          result = await Promise.all(source.map(async (item) => {
            try {
              return { id: item.id || null, result: await calculateAverageHash(item) };
            } catch (err) {
              return { id: item.id || null, error: err.message || String(err) };
            }
          }));
        } else {
          result = await calculateAverageHash(source);
        }
        break;
        
      case 'calculateAllHashes':
        if (Array.isArray(source)) {
          result = await Promise.all(source.map(async (item) => {
            try {
              return { id: item.id || null, result: await calculateAllHashes(item) };
            } catch (err) {
              return { id: item.id || null, error: err.message || String(err) };
            }
          }));
        } else {
          result = await calculateAllHashes(source);
        }
        break;
        
      default:
        throw new Error(`不支援的任務類型: ${task}`);
    }
    
    const endTime = performance.now();
    const processingTime = Math.round(endTime - startTime);
    
    // 如果處理時間超過警告閾值，記錄警告
    if (processingTime > 1000) {
      console.warn(`Worker 處理任務 ${task} 花費了 ${processingTime}ms，可能導致性能問題`);
    }
    
    self.postMessage({ id, result, processingTime, priority });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Worker 錯誤: ${errorMessage}`);
    self.postMessage({ id, error: errorMessage, priority });
  }
};

// 處理優先級中斷機制
self.addEventListener('message', (e) => {
  // 如果收到高優先級中斷信號，可以選擇中斷當前低優先級任務
  if (e.data.type === 'interrupt' && e.data.priority > 5) {
    console.log('收到高優先級中斷信號，準備切換任務');
    // 在這裡可以實現任務切換邏輯，例如通過全局變量標記中斷狀態
  }
});

// 確保 Worker 可以在不支援 OffscreenCanvas 的瀏覽器中工作
if (typeof OffscreenCanvas === 'undefined') {
  // 為舊瀏覽器提供 polyfill
  // @ts-expect-error 在 Worker 中擴展全局物件
  self.OffscreenCanvas = class {
    private _width: number;
    private _height: number;
    private _canvas: Record<string, unknown>;
    
    constructor(width: number, height: number) {
      this._width = width;
      this._height = height;
      // 使用一個簡單的代理物件，實際在主線程中不會使用此polyfill
      this._canvas = {};
    }
    
    getContext(type: string): CanvasRenderingContext2D | null {
      // 在worker中不會實際使用，僅作為類型兼容的橋接
      return null;
    }
    
    get width(): number { return this._width; }
    get height(): number { return this._height; }
    
    set width(w: number) { this._width = w; }
    set height(h: number) { this._height = h; }
  };
} 