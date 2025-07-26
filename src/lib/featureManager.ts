/**
 * 特徵管理器
 * 
 * 管理特徵提取、計算、比較和持久化存儲，使用 WebWorker 池來提升性能
 * 
 * @module featureManager
 */

import { wrap, Remote } from 'comlink';
import { PhotoFile } from './types';
import { HashResult } from './integratedHasher';
import { MultiLevelFeature, FeatureLevel } from './multiLevelFeatureFusion';
import { Result, ok, err } from './result';

// 定義特徵緩存接口
interface FeatureCache {
  [key: string]: {
    timestamp: number;
    feature: MultiLevelFeature;
  };
}

// 定義工作線程接口 (應與 featureWorker.ts 中一致)
interface FeatureWorkerInterface {
  initialize(): Promise<boolean>;
  extractHashFeatures(imageData: ImageData): Promise<HashResult>;
  calculateVectorSimilarity(vector1: number[], vector2: number[]): Promise<number>;
  calculateBatchSimilarity(baseVector: number[], vectors: number[][]): Promise<number[]>;
  compressVector(vector: number[], ratio: number): Promise<number[]>;
}

/**
 * 特徵管理器類
 * 
 * 管理特徵的提取、計算、比較和持久化存儲
 */
export class FeatureManager {
  // 工作線程池
  private workers: Remote<FeatureWorkerInterface>[] = [];
  
  // 特徵緩存
  private cache: FeatureCache = {};
  
  // 上次使用的工作線程索引
  private lastWorkerIndex = 0;
  
  // 是否已初始化
  private initialized = false;
  
  /**
   * 初始化特徵管理器
   * @param workerCount 工作線程數量
   */
  public async initialize(workerCount = navigator.hardwareConcurrency || 4): Promise<Result<boolean, Error>> {
    try {
      if (this.initialized) {
        return ok(true);
      }
      
      // 創建工作線程
      for (let i = 0; i < workerCount; i++) {
        const worker = new Worker(new URL('./featureWorker.ts', import.meta.url), { type: 'module' });
        const workerInterface = wrap<FeatureWorkerInterface>(worker);
        
        // 初始化工作線程
        const initialized = await workerInterface.initialize();
        if (!initialized) {
          throw new Error(`工作線程 ${i} 初始化失敗`);
        }
        
        this.workers.push(workerInterface);
      }
      
      // 加載緩存
      await this.loadCacheFromStorage();
      
      this.initialized = true;
      console.info(`[FeatureManager] 初始化成功，創建了 ${workerCount} 個工作線程`);
      return ok(true);
    } catch (error) {
      console.error('[FeatureManager] 初始化失敗:', error);
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  /**
   * 獲取可用的工作線程
   */
  private getNextWorker(): Remote<FeatureWorkerInterface> {
    this.lastWorkerIndex = (this.lastWorkerIndex + 1) % this.workers.length;
    return this.workers[this.lastWorkerIndex];
  }
  
  /**
   * 從持久化存儲加載緩存
   */
  private async loadCacheFromStorage(): Promise<void> {
    try {
      const cacheData = localStorage.getItem('featureCache');
      if (cacheData) {
        this.cache = JSON.parse(cacheData);
        
        // 清理過期的緩存 (超過7天)
        const now = Date.now();
        const expireTime = 7 * 24 * 60 * 60 * 1000; // 7天
        
        Object.keys(this.cache).forEach(key => {
          if (now - this.cache[key].timestamp > expireTime) {
            delete this.cache[key];
          }
        });
        
        console.info(`[FeatureManager] 從存儲加載了 ${Object.keys(this.cache).length} 個特徵緩存`);
      }
    } catch (error) {
      console.warn('[FeatureManager] 加載緩存失敗:', error);
      // 如果加載失敗，重置緩存
      this.cache = {};
    }
  }
  
  /**
   * 保存緩存到持久化存儲
   */
  private async saveCacheToStorage(): Promise<void> {
    try {
      const cacheData = JSON.stringify(this.cache);
      localStorage.setItem('featureCache', cacheData);
    } catch (error) {
      console.warn('[FeatureManager] 保存緩存失敗:', error);
    }
  }
  
  /**
   * 生成照片緩存鍵
   * @param photo 照片
   * @param level 特徵級別
   */
  private generateCacheKey(photo: PhotoFile, level: FeatureLevel): string {
    // 使用文件最後修改時間和大小作為緩存鍵的一部分
    const { id, file } = photo;
    const lastModified = file.lastModified || 0;
    const size = file.size || 0;
    
    return `${id}:${lastModified}:${size}:${level}`;
  }
  
  /**
   * 獲取緩存中的特徵
   * @param photo 照片
   * @param level 特徵級別
   */
  public getCachedFeature(photo: PhotoFile, level: FeatureLevel): MultiLevelFeature | null {
    const key = this.generateCacheKey(photo, level);
    const cached = this.cache[key];
    
    if (cached) {
      return cached.feature;
    }
    
    return null;
  }
  
  /**
   * 從圖像數據提取哈希特徵
   * @param imageData 圖像數據
   */
  public async extractHashFeatures(imageData: ImageData): Promise<Result<HashResult, Error>> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const worker = this.getNextWorker();
      const hashResult = await worker.extractHashFeatures(imageData);
      
      return ok(hashResult);
    } catch (error) {
      console.error('[FeatureManager] 提取哈希特徵失敗:', error);
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  /**
   * 從照片提取特徵並緩存
   * @param photo 照片
   * @param level 特徵級別
   * @param options 提取選項
   */
  public async extractAndCacheFeature(
    photo: PhotoFile,
    level: FeatureLevel,
    options: { forceUpdate?: boolean } = {}
  ): Promise<Result<MultiLevelFeature, Error>> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      // 檢查緩存
      if (!options.forceUpdate) {
        const cachedFeature = this.getCachedFeature(photo, level);
        if (cachedFeature) {
          return ok(cachedFeature);
        }
      }
      
      // 提取特徵
      let feature: MultiLevelFeature;
      
      // 根據特徵級別提取不同的特徵
      switch (level) {
        case FeatureLevel.LOW:
          // 提取低級特徵 (哈希)
          feature = await this.extractLowLevelFeature(photo);
          break;
        
        case FeatureLevel.MID:
          // 提取中級特徵 (顏色、紋理)
          feature = await this.extractMidLevelFeature(photo);
          break;
        
        case FeatureLevel.HIGH:
          // 提取高級特徵 (深度學習)
          feature = await this.extractHighLevelFeature(photo);
          break;
        
        default:
          return err(new Error(`不支持的特徵級別: ${level}`));
      }
      
      // 緩存特徵
      const key = this.generateCacheKey(photo, level);
      this.cache[key] = {
        timestamp: Date.now(),
        feature
      };
      
      // 如果緩存達到一定大小，異步保存到存儲
      if (Object.keys(this.cache).length % 10 === 0) {
        this.saveCacheToStorage();
      }
      
      return ok(feature);
    } catch (error) {
      console.error(`[FeatureManager] 提取 ${level} 級特徵失敗:`, error);
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  /**
   * 提取低級特徵 (哈希)
   * @param photo 照片
   */
  private async extractLowLevelFeature(photo: PhotoFile): Promise<MultiLevelFeature> {
    // 從照片創建圖像數據
    const imageData = await this.createImageDataFromPhoto(photo);
    
    // 使用工作線程提取哈希
    const worker = this.getNextWorker();
    const hashResult = await worker.extractHashFeatures(imageData);
    
    // 創建多層級特徵
    return {
      id: photo.id,
      lowLevelFeatures: hashResult,
      metadata: { photo }
    };
  }
  
  /**
   * 提取中級特徵 (顏色、紋理)
   * @param photo 照片
   */
  private async extractMidLevelFeature(photo: PhotoFile): Promise<MultiLevelFeature> {
    // 從照片創建圖像數據
    const imageData = await this.createImageDataFromPhoto(photo);
    
    // 提取顏色直方圖
    const colorHistogram = await this.extractColorHistogram(imageData);
    
    // 提取紋理特徵 (暫時返回空陣列)
    const textureFeatures: number[] = [];
    
    // 創建多層級特徵
    return {
      id: photo.id,
      midLevelFeatures: {
        colorHistogram,
        textureFeatures
      },
      metadata: { photo }
    };
  }
  
  /**
   * 提取高級特徵 (深度學習)
   * @param photo 照片
   */
  private async extractHighLevelFeature(photo: PhotoFile): Promise<MultiLevelFeature> {
    // 這裡應該使用深度學習模型提取特徵
    // 在實際項目中，這可能會調用 TensorFlow.js 或其他深度學習模型
    // 為了示例，我們返回一個模擬的特徵向量
    
    return {
      id: photo.id,
      highLevelFeatures: Array(128).fill(0).map(() => Math.random() * 2 - 1),
      metadata: { photo }
    };
  }
  
  /**
   * 從照片創建圖像數據
   * @param photo 照片
   */
  private async createImageDataFromPhoto(photo: PhotoFile): Promise<ImageData> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        try {
          const maxSize = 256; // 限制圖像大小以提高性能
          
          // 計算縮放比例
          const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
          const width = Math.round(img.width * scale);
          const height = Math.round(img.height * scale);
          
          // 創建 Canvas 並繪製圖像
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('無法創建 Canvas 上下文'));
            return;
          }
          
          ctx.drawImage(img, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);
          
          // 清理資源
          canvas.width = 0;
          canvas.height = 0;
          
          resolve(imageData);
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = () => {
        reject(new Error(`無法加載圖片: ${photo.file.name}`));
      };
      
      // 設置圖片源
      img.src = photo.preview;
    });
  }
  
  /**
   * 提取顏色直方圖
   * @param imageData 圖像數據
   */
  private async extractColorHistogram(imageData: ImageData): Promise<number[]> {
    const { data, width, height } = imageData;
    const binCount = 8; // 每個通道的箱數
    const histogram = new Array(binCount * 3).fill(0); // R, G, B 三個通道
    
    // 遍歷像素計算直方圖
    for (let i = 0; i < data.length; i += 4) {
      const r = Math.floor(data[i] / 256 * binCount);
      const g = Math.floor(data[i + 1] / 256 * binCount);
      const b = Math.floor(data[i + 2] / 256 * binCount);
      
      histogram[r]++;
      histogram[binCount + g]++;
      histogram[binCount * 2 + b]++;
    }
    
    // 歸一化直方圖
    const pixelCount = width * height;
    return histogram.map(count => count / pixelCount);
  }
  
  /**
   * 計算兩個向量的相似度
   * @param vector1 向量1
   * @param vector2 向量2
   */
  public async calculateSimilarity(vector1: number[], vector2: number[]): Promise<Result<number, Error>> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const worker = this.getNextWorker();
      const similarity = await worker.calculateVectorSimilarity(vector1, vector2);
      
      return ok(similarity);
    } catch (error) {
      console.error('[FeatureManager] 計算相似度失敗:', error);
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  /**
   * 批量計算相似度
   * @param baseVector 基準向量
   * @param vectors 向量列表
   */
  public async calculateBatchSimilarity(
    baseVector: number[],
    vectors: number[][]
  ): Promise<Result<number[], Error>> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const worker = this.getNextWorker();
      const similarities = await worker.calculateBatchSimilarity(baseVector, vectors);
      
      return ok(similarities);
    } catch (error) {
      console.error('[FeatureManager] 批量計算相似度失敗:', error);
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  /**
   * 壓縮特徵向量
   * @param vector 向量
   * @param ratio 壓縮比例 (0-1)
   */
  public async compressVector(vector: number[], ratio: number): Promise<Result<number[], Error>> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      const worker = this.getNextWorker();
      const compressed = await worker.compressVector(vector, ratio);
      
      return ok(compressed);
    } catch (error) {
      console.error('[FeatureManager] 壓縮向量失敗:', error);
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  /**
   * 清空緩存
   */
  public clearCache(): void {
    this.cache = {};
    localStorage.removeItem('featureCache');
    console.info('[FeatureManager] 已清空特徵緩存');
  }
  
  /**
   * 釋放資源
   */
  public async dispose(): Promise<void> {
    try {
      // 保存緩存到存儲
      await this.saveCacheToStorage();
      
      // 終止所有工作線程
      for (const worker of this.workers) {
        // @ts-ignore - 直接訪問 worker 的底層 worker 對象
        if (worker[Symbol.toStringTag] === 'Comlink.proxy') {
          // @ts-ignore
          worker[Symbol.dispose]();
        }
      }
      
      this.workers = [];
      this.initialized = false;
      
      console.info('[FeatureManager] 已釋放所有資源');
    } catch (error) {
      console.error('[FeatureManager] 釋放資源時出錯:', error);
    }
  }
}

// 導出全局單例
export const featureManager = new FeatureManager(); 