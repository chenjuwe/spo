/**
 * 圖像處理優化模塊
 * 包含分段處理大型圖像和金字塔縮放策略的優化技術
 */

// 導入RegionOfInterest類型
import type { RegionOfInterest } from './contentAwareProcessing';

/**
 * 圖像金字塔層級
 */
export interface PyramidLevel {
  /**
   * 圖像數據
   */
  imageData: ImageData;
  
  /**
   * 縮放比例
   */
  scale: number;
  
  /**
   * 層級 (0為最低解析度)
   */
  level: number;
}

/**
 * 圖像分割區塊
 */
export interface ImageTile {
  /**
   * 圖像數據
   */
  imageData: ImageData;
  
  /**
   * X坐標 (左上角)
   */
  x: number;
  
  /**
   * Y坐標 (左上角)
   */
  y: number;
  
  /**
   * 寬度
   */
  width: number;
  
  /**
   * 高度
   */
  height: number;
}

/**
 * 圖像金字塔選項
 */
export interface PyramidOptions {
  /**
   * 層級數量
   */
  levels: number;
  
  /**
   * 縮放因子
   */
  scaleFactor: number;
  
  /**
   * 最小尺寸
   */
  minSize: number;
}

/**
 * 默認金字塔選項
 */
export const DEFAULT_PYRAMID_OPTIONS: PyramidOptions = {
  levels: 3,
  scaleFactor: 0.5,
  minSize: 32
};

/**
 * 圖像分割選項
 */
export interface TileOptions {
  /**
   * 分割塊大小
   */
  tileSize: number;
  
  /**
   * 重疊像素數
   */
  overlap: number;
}

/**
 * 默認分割選項
 */
export const DEFAULT_TILE_OPTIONS: TileOptions = {
  tileSize: 256,
  overlap: 16
};

/**
 * 哈希計算緩存項
 */
interface HashCacheItem {
  hash: string;
  lastAccessed: number;
  accessCount: number;
  createdAt?: number;
  imageType?: string; // 圖像類型 (如 'portrait', 'landscape')
}

/**
 * 哈希計算緩存
 */
const hashCache = new Map<string, HashCacheItem>();

/**
 * 最大緩存項數量
 */
const MAX_CACHE_ITEMS = 1000;

/**
 * 圖像處理共享緩存
 * 用於優化多種哈希算法對同一圖像的處理
 */
class SharedImageProcessingCache {
  private imageCache: Map<string, { 
    data: ImageData | null;
    scaledData: Map<string, ImageData | Uint8ClampedArray>;
    lastAccessed: number;
    accessCount: number;
  }> = new Map();
  
  private maxItems: number;
  
  constructor(maxItems = 30) {
    this.maxItems = maxItems;
  }
  
  /**
   * 存儲原始圖像數據
   */
  storeImageData(cacheKey: string, data: ImageData): void {
    // 如果緩存已滿，清除最舊的項目
    if (this.imageCache.size >= this.maxItems) {
      this.pruneCache();
    }
    
    this.imageCache.set(cacheKey, {
      data,
      scaledData: new Map(),
      lastAccessed: Date.now(),
      accessCount: 1
    });
  }
  
  /**
   * 獲取圖像數據
   */
  getImageData(cacheKey: string): ImageData | null {
    const entry = this.imageCache.get(cacheKey);
    if (entry) {
      // 更新訪問統計
      entry.lastAccessed = Date.now();
      entry.accessCount++;
      return entry.data;
    }
    return null;
  }
  
  /**
   * 存儲縮放後的圖像數據
   */
  storeScaledData(cacheKey: string, scaleKey: string, data: ImageData | Uint8ClampedArray): void {
    const entry = this.imageCache.get(cacheKey);
    if (entry) {
      entry.scaledData.set(scaleKey, data);
      entry.lastAccessed = Date.now();
      entry.accessCount++;
    }
  }
  
  /**
   * 獲取縮放後的圖像數據
   */
  getScaledData(cacheKey: string, scaleKey: string): ImageData | Uint8ClampedArray | null {
    const entry = this.imageCache.get(cacheKey);
    if (entry && entry.scaledData.has(scaleKey)) {
      entry.lastAccessed = Date.now();
      entry.accessCount++;
      return entry.scaledData.get(scaleKey) || null;
    }
    return null;
  }
  
  /**
   * 清理緩存
   */
  private pruneCache(): void {
    // 按上次訪問時間排序
    const entries = Array.from(this.imageCache.entries())
      .sort((a, b) => {
        // 訪問頻率高的項目更可能保留
        const freqA = a[1].accessCount;
        const freqB = b[1].accessCount;
        
        if (Math.abs(freqA - freqB) > 5) {
          return freqA - freqB; // 訪問頻率差異大，保留高頻率項目
        }
        
        // 否則按最近訪問時間排序
        return a[1].lastAccessed - b[1].lastAccessed;
      });
    
    // 刪除 25% 最舊/最少使用的項目
    const itemsToRemove = Math.max(1, Math.floor(this.imageCache.size * 0.25));
    
    for (let i = 0; i < itemsToRemove; i++) {
      if (entries[i]) {
        this.imageCache.delete(entries[i][0]);
      }
    }
  }
  
  /**
   * 清除緩存
   */
  clear(): void {
    this.imageCache.clear();
  }
  
  /**
   * 獲取緩存大小
   */
  size(): number {
    return this.imageCache.size;
  }
  
  /**
   * 獲取緩存統計信息
   */
  getStats(): { size: number; hitRate?: number; averageItemSize?: number } {
    return {
      size: this.imageCache.size
    };
  }
}

/**
 * 全局共享的圖像處理緩存實例
 */
export const sharedImageCache = new SharedImageProcessingCache(30); // 最多緩存30個圖像

/**
 * 緩存命中統計
 */
let cacheHits = 0;

/**
 * 緩存未命中統計
 */
let cacheMisses = 0;

/**
 * 建立圖像金字塔
 * 從原始圖像建立多個不同解析度的層級
 * 
 * @param imageData 原始圖像數據
 * @param options 金字塔選項
 * @returns 多層級圖像金字塔
 */
export function buildImagePyramid(
  imageData: ImageData,
  options: Partial<PyramidOptions> = {}
): PyramidLevel[] {
  const { levels, scaleFactor, minSize } = {
    ...DEFAULT_PYRAMID_OPTIONS,
    ...options
  };
  
  const pyramid: PyramidLevel[] = [];
  
  // 添加原始圖像作為最高解析度層級
  pyramid.push({
    imageData,
    scale: 1.0,
    level: levels - 1
  });
  
  let currentImageData = imageData;
  let currentScale = 1.0;
  
  // 建立剩餘層級
  for (let i = levels - 2; i >= 0; i--) {
    // 計算新尺寸
    const newWidth = Math.max(minSize, Math.round(currentImageData.width * scaleFactor));
    const newHeight = Math.max(minSize, Math.round(currentImageData.height * scaleFactor));
    
    // 如果達到最小尺寸，不再縮小
    if (newWidth === minSize && newHeight === minSize) {
      break;
    }
    
    // 縮放圖像
    const scaledImage = scaleImage(currentImageData, newWidth, newHeight);
    
    currentImageData = scaledImage;
    currentScale *= scaleFactor;
    
    pyramid.push({
      imageData: scaledImage,
      scale: currentScale,
      level: i
    });
  }
  
  // 按照解析度升序排序 (從低解析度到高解析度)
  return pyramid.sort((a, b) => a.level - b.level);
}

/**
 * 縮放圖像
 * 使用雙線性插值法縮放圖像
 * 
 * @param imageData 原始圖像數據
 * @param newWidth 新寬度
 * @param newHeight 新高度
 * @returns 縮放後的圖像數據
 */
export function scaleImage(
  imageData: ImageData,
  newWidth: number,
  newHeight: number
): ImageData {
  const { width: oldWidth, height: oldHeight, data: oldData } = imageData;
  
  // 創建新圖像數據
  const newData = new Uint8ClampedArray(newWidth * newHeight * 4);
  const resultImageData = new ImageData(newWidth, newHeight);
  
  // 縮放比例
  const xRatio = oldWidth / newWidth;
  const yRatio = oldHeight / newHeight;
  
  // 雙線性插值
  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      // 計算源圖像對應位置
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      
      // 四個最近的像素
      const x1 = Math.floor(srcX);
      const y1 = Math.floor(srcY);
      const x2 = Math.min(x1 + 1, oldWidth - 1);
      const y2 = Math.min(y1 + 1, oldHeight - 1);
      
      // 計算權重
      const xWeight = srcX - x1;
      const yWeight = srcY - y1;
      
      // 計算新像素位置
      const newPos = (y * newWidth + x) * 4;
      
      // 對RGBA四個通道進行雙線性插值
      for (let c = 0; c < 4; c++) {
        const oldPos1 = (y1 * oldWidth + x1) * 4 + c;
        const oldPos2 = (y1 * oldWidth + x2) * 4 + c;
        const oldPos3 = (y2 * oldWidth + x1) * 4 + c;
        const oldPos4 = (y2 * oldWidth + x2) * 4 + c;
        
        // 雙線性插值公式
        const value = Math.round(
          oldData[oldPos1] * (1 - xWeight) * (1 - yWeight) +
          oldData[oldPos2] * xWeight * (1 - yWeight) +
          oldData[oldPos3] * (1 - xWeight) * yWeight +
          oldData[oldPos4] * xWeight * yWeight
        );
        
        newData[newPos + c] = value;
      }
    }
  }
  
  resultImageData.data.set(newData);
  return resultImageData;
}

/**
 * 分割圖像
 * 將大型圖像分割成小塊以便於處理
 * 
 * @param imageData 圖像數據
 * @param options 分割選項
 * @returns 圖像分割塊數組
 */
export function tileImage(
  imageData: ImageData,
  options: Partial<TileOptions> = {}
): ImageTile[] {
  const { tileSize, overlap } = {
    ...DEFAULT_TILE_OPTIONS,
    ...options
  };
  
  const { width, height } = imageData;
  const tiles: ImageTile[] = [];
  
  // 計算有效分割大小 (實際分割大小減去重疊部分)
  const effectiveTileSize = tileSize - overlap;
  
  // 計算行列數
  const cols = Math.ceil(width / effectiveTileSize);
  const rows = Math.ceil(height / effectiveTileSize);
  
  // 創建臨時畫布
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  if (!ctx) {
    throw new Error('無法創建畫布上下文');
  }
  
  // 將 ImageData 繪製到畫布上
  canvas.width = width;
  canvas.height = height;
  ctx.putImageData(imageData, 0, 0);
  
  // 分割圖像
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // 計算分割塊坐標和大小
      const x = col * effectiveTileSize;
      const y = row * effectiveTileSize;
      
      // 調整最後一列/行的尺寸以適應圖像邊界
      const tileWidth = Math.min(tileSize, width - x + overlap);
      const tileHeight = Math.min(tileSize, height - y + overlap);
      
      // 獲取分割塊圖像數據
      const tileImageData = ctx.getImageData(x, y, tileWidth, tileHeight);
      
      tiles.push({
        imageData: tileImageData,
        x,
        y,
        width: tileWidth,
        height: tileHeight
      });
    }
  }
  
  // 清理資源
  canvas.width = 0;
  canvas.height = 0;
  
  return tiles;
}

/**
 * 為特定區域計算哈希值
 * 
 * @param imageData 圖像數據
 * @param x 起始x坐標
 * @param y 起始y坐標
 * @param width 寬度
 * @param height 高度
 * @param hashFunction 哈希計算函數
 * @returns 區域哈希值
 */
export function calculateRegionHash(
  imageData: ImageData,
  x: number,
  y: number,
  width: number,
  height: number,
  hashFunction: (data: ImageData) => string
): string {
  // 創建區域的唯一緩存鍵
  const cacheKey = `${hashFunction.name}_${x}_${y}_${width}_${height}_${imageData.width}_${imageData.height}`;
  
  // 檢查緩存
  const cachedItem = hashCache.get(cacheKey);
  if (cachedItem) {
    // 更新訪問統計
    cachedItem.lastAccessed = Date.now();
    cachedItem.accessCount++;
    cacheHits++;
    
    return cachedItem.hash;
  }
  
  // 緩存未命中
  cacheMisses++;
  
  // 創建臨時畫布
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('無法創建畫布上下文');
  }
  
  // 設置畫布大小
  canvas.width = width;
  canvas.height = height;
  
  // 創建臨時 ImageData
  const tempImageData = ctx.createImageData(width, height);
  
  // 複製區域數據
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      const sourceIdx = ((y + i) * imageData.width + (x + j)) * 4;
      const targetIdx = (i * width + j) * 4;
      
      // 複製 RGBA 四個通道
      for (let k = 0; k < 4; k++) {
        tempImageData.data[targetIdx + k] = imageData.data[sourceIdx + k];
      }
    }
  }
  
  // 計算哈希
  const hash = hashFunction(tempImageData);
  
  // 清理資源
  canvas.width = 0;
  canvas.height = 0;
  
  // 添加到緩存
  hashCache.set(cacheKey, {
    hash,
    lastAccessed: Date.now(),
    accessCount: 1
  });
  
  // 檢查緩存大小，必要時清理
  if (hashCache.size > MAX_CACHE_ITEMS) {
    pruneCache();
  }
  
  return hash;
}

/**
 * 清理哈希緩存
 * 移除最不常用的緩存項
 */
function pruneCache(): void {
  // 如果緩存小於閾值，不執行清理
  if (hashCache.size <= MAX_CACHE_ITEMS * 0.9) {
    return;
  }
  
  // 將緩存項轉換為數組並按最後訪問時間和訪問次數排序
  const entries = Array.from(hashCache.entries())
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => {
      // 優先考慮訪問次數 (訪問越少越先移除)
      const countDiff = a.value.accessCount - b.value.accessCount;
      
      // 訪問次數相同時考慮最後訪問時間 (訪問越早越先移除)
      if (countDiff === 0) {
        return a.value.lastAccessed - b.value.lastAccessed;
      }
      
      return countDiff;
    });
  
  // 移除約 30% 的最不常用緩存項
  const removeCount = Math.ceil(hashCache.size * 0.3);
  
  for (let i = 0; i < removeCount; i++) {
    if (i < entries.length) {
      hashCache.delete(entries[i].key);
    }
  }
  
  // 輸出緩存統計
  console.info(`哈希緩存已清理，移除 ${removeCount} 項，剩餘 ${hashCache.size} 項，命中率: ${(cacheHits / (cacheHits + cacheMisses) * 100).toFixed(2)}%`);
}

/**
 * 金字塔哈希比較
 * 使用圖像金字塔進行多解析度哈希比較
 * 
 * @param imageData1 第一個圖像數據
 * @param imageData2 第二個圖像數據
 * @param hashFunction 哈希計算函數
 * @param similarityFunction 相似度計算函數
 * @param threshold 相似度閾值 (0-100)
 * @param options 金字塔選項
 * @returns 是否相似
 */
export async function pyramidHashCompare(
  imageData1: ImageData,
  imageData2: ImageData,
  hashFunction: (data: ImageData) => string,
  similarityFunction: (hash1: string, hash2: string) => number,
  threshold: number = 90,
  options: Partial<PyramidOptions> = {}
): Promise<boolean> {
  // 構建兩個圖像金字塔
  const pyramid1 = buildImagePyramid(imageData1, options);
  const pyramid2 = buildImagePyramid(imageData2, options);
  
  // 從最低解析度開始比較
  for (let i = 0; i < Math.min(pyramid1.length, pyramid2.length); i++) {
    const level1 = pyramid1[i];
    const level2 = pyramid2[i];
    
    // 計算當前層級的閾值 (較低層級使用較寬鬆的閾值)
    const levelThreshold = threshold * (0.7 + 0.3 * (i / Math.min(pyramid1.length, pyramid2.length - 1)));
    
    // 計算哈希
    const hash1 = hashFunction(level1.imageData);
    const hash2 = hashFunction(level2.imageData);
    
    // 計算相似度
    const similarity = similarityFunction(hash1, hash2);
    
    // 如果在某個層級相似度低於閾值，則直接返回不相似
    if (similarity < levelThreshold) {
      return false;
    }
    
    // 如果這是最後一層 (最高解析度) 或相似度遠高於閾值，則返回相似
    if (i === Math.min(pyramid1.length, pyramid2.length) - 1 || similarity > threshold + 5) {
      return true;
    }
    
    // 否則繼續檢查下一個更高解析度層級
  }
  
  // 默認情況下認為相似 (通過了所有層級的檢查)
  return true;
}

/**
 * 分段處理大型圖像
 * 將大型圖像分割成小塊進行處理，然後合併結果
 * 
 * @param imageData 圖像數據
 * @param processor 處理函數
 * @param options 分割選項
 * @returns 處理結果
 */
export async function processLargeImage<T>(
  imageData: ImageData,
  processor: (tile: ImageTile) => Promise<T>,
  options: Partial<TileOptions> = {}
): Promise<T[]> {
  // 判斷是否需要分割處理
  const isLargeImage = imageData.width > 1024 || imageData.height > 1024;
  
  if (!isLargeImage) {
    // 小圖像直接處理
    const result = await processor({
      imageData,
      x: 0,
      y: 0,
      width: imageData.width,
      height: imageData.height
    });
    
    return [result];
  }
  
  // 分割圖像
  const tiles = tileImage(imageData, options);
  
  // 處理每個分割塊
  const results: T[] = [];
  
  for (const tile of tiles) {
    const result = await processor(tile);
    results.push(result);
  }
  
  return results;
}

/**
 * 獲取哈希緩存統計
 * @returns 緩存統計數據
 */
export function getCacheStats(): {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
} {
  return {
    size: hashCache.size,
    hits: cacheHits,
    misses: cacheMisses,
    hitRate: cacheHits / (cacheHits + cacheMisses) || 0
  };
}

/**
 * 清空哈希緩存
 */
export function clearHashCache(): void {
  hashCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
  console.info('哈希緩存已清空');
} 

/**
 * 使用共享緩存的圖像哈希計算
 * 
 * @param imageData 圖像數據
 * @param hashFunction 哈希函數
 * @param cacheKey 緩存鍵
 * @returns 哈希值
 */
export function calculateOptimizedHash(
  imageData: ImageData,
  hashFunction: (data: ImageData) => string,
  cacheKey: string
): string {
  // 檢查緩存
  const cacheKeyHash = `${cacheKey}_${hashFunction.name}`;
  const cachedItem = hashCache.get(cacheKeyHash);
  if (cachedItem) {
    // 更新訪問統計
    cachedItem.lastAccessed = Date.now();
    cachedItem.accessCount++;
    return cachedItem.hash;
  }
  
  // 緩存未命中，計算哈希
  const hash = hashFunction(imageData);
  
  // 添加到緩存
  hashCache.set(cacheKeyHash, {
    hash,
    lastAccessed: Date.now(),
    accessCount: 1,
    createdAt: Date.now()
  });
  
  // 檢查緩存大小，必要時清理
  if (hashCache.size > MAX_CACHE_ITEMS) {
    pruneCache();
  }
  
  return hash;
}

/**
 * 內容感知優化的圖像處理
 * 
 * @param imageData 圖像數據
 * @param processor 處理函數
 * @param options 選項
 * @returns 處理結果
 */
export async function processWithContentAwareness<T>(
  imageData: ImageData,
  processor: (data: ImageData, regions?: RegionOfInterest[]) => Promise<T>,
  options: {
    detectFaces?: boolean;
    detectSaliency?: boolean;
    skipForSmallImages?: boolean;
  } = {}
): Promise<T> {
  // 小圖像不需要進行內容感知處理
  if (options.skipForSmallImages && (imageData.width < 500 || imageData.height < 500)) {
    return processor(imageData);
  }
  
  // 提取內容區域
  let regions: RegionOfInterest[] = [];
  
  if (options.detectFaces) {
    try {
      // 從外部導入以避免循環依賴
      const { extractContentRegionsEnhanced } = await import('./contentAwareProcessing');
      regions = extractContentRegionsEnhanced(imageData);
    } catch (e) {
      console.warn('內容感知區域提取失敗，使用原始圖像:', e);
    }
  }
  
  // 使用提取的區域進行處理
  return processor(imageData, regions);
}

/**
 * 圖像分割和哈希融合，用於大圖像處理
 * 
 * @param imageData 圖像數據
 * @param hashFunction 哈希函數
 * @param options 分割選項
 * @returns 融合後的哈希值
 */
export async function segmentedHashCalculation(
  imageData: ImageData,
  hashFunction: (data: ImageData) => string,
  options: Partial<TileOptions> = {}
): Promise<string> {
  // 如果圖像較小，直接計算哈希
  if (imageData.width <= 1024 && imageData.height <= 1024) {
    return hashFunction(imageData);
  }
  
  // 分割圖像
  const tiles = tileImage(imageData, options);
  
  // 計算每個分割塊的哈希
  const tileHashes: string[] = [];
  
  for (const tile of tiles) {
    const tileHash = hashFunction(tile.imageData);
    tileHashes.push(tileHash);
  }
  
  // 融合哈希值 (簡單版本：連接所有哈希並取 SHA-256)
  const combinedHash = await combineHashes(tileHashes);
  
  return combinedHash;
}

/**
 * 結合多個哈希值
 * @param hashes 哈希值數組
 * @returns 融合後的哈希
 */
async function combineHashes(hashes: string[]): Promise<string> {
  // 使用 Web Crypto API 計算 SHA-256
  try {
    const encoder = new TextEncoder();
    const combinedText = hashes.join('');
    const data = encoder.encode(combinedText);
    
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    // 如果 Web Crypto API 不可用，使用簡單方法
    console.warn('Web Crypto API 不可用，使用簡單哈希組合');
    
    // 簡單方法：XOR 所有哈希的每個字符位置
    const maxLength = Math.max(...hashes.map(h => h.length));
    let result = '';
    
    for (let i = 0; i < maxLength; i++) {
      let combined = 0;
      for (const hash of hashes) {
        if (i < hash.length) {
          const charCode = parseInt(hash[i], 16);
          combined ^= charCode;
        }
      }
      result += combined.toString(16);
    }
    
    return result;
  }
} 