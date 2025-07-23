import { analyzeImageQuality, calculatePerceptualHash, calculateDifferenceHash, calculateAverageHash, calculateAllHashes } from './workerCore';

/**
 * Worker 入口處理函數
 * 支援分析圖片品質、計算感知哈希等任務
 */
self.onmessage = async (e) => {
  const { task, file, id, options = {} } = e.data;

  try {
    let result;
    
    switch (task) {
      case 'analyzeImageQuality':
        result = await analyzeImageQuality(file);
        break;
        
      case 'calculatePerceptualHash':
        result = await calculatePerceptualHash(file);
        break;
        
      case 'calculateDifferenceHash':
        result = await calculateDifferenceHash(file);
        break;
        
      case 'calculateAverageHash':
        result = await calculateAverageHash(file);
        break;
        
      case 'calculateAllHashes':
        result = await calculateAllHashes(file);
        break;
        
      default:
        throw new Error(`不支援的任務類型: ${task}`);
    }
    
    self.postMessage({ id, result });
  } catch (error) {
    console.error(`Worker 錯誤 (${task}):`, error);
    self.postMessage({ 
      id, 
      error: error instanceof Error ? error.message : '處理照片時發生未知錯誤'
    });
  }
};

// 確保 Worker 可以在不支援 OffscreenCanvas 的瀏覽器中工作
if (typeof OffscreenCanvas === 'undefined') {
  // 為舊瀏覽器提供 polyfill
  // @ts-ignore: 添加全局類型定義以避免類型錯誤
  self.OffscreenCanvas = class {
    private _width: number;
    private _height: number;
    private _canvas: any;
    
    constructor(width: number, height: number) {
      this._width = width;
      this._height = height;
      // 使用一個簡單的代理物件，實際在主線程中不會使用此polyfill
      this._canvas = {};
    }
    
    getContext(type: string): any {
      // 在worker中不會實際使用，僅作為類型兼容的橋接
      return null;
    }
    
    get width(): number { return this._width; }
    get height(): number { return this._height; }
    
    set width(w: number) { this._width = w; }
    set height(h: number) { this._height = h; }
  };
} 