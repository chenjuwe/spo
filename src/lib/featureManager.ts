/**
 * 特徵管理器
 * 
 * 管理特徵提取、計算、比較和持久化存儲，使用 WebWorker 池來提升性能
 * 
 * @module featureManager
 */

import { wrap, Remote } from 'comlink';
import { PhotoFile, HashResult } from './types';
import { MultiLevelFeature, FeatureLevel } from './multiLevelFeatureFusion';
import { Result, ok, err } from './result';
import { errorHandler, ErrorType, ErrorSeverity, safeExecute } from './errorHandlingService';

// 定義瀏覽器特定 API 的接口
interface MemoryInfo {
  totalJSHeapSize: number;
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceMemory extends Performance {
  memory?: MemoryInfo;
}

// 類型守衛
function hasMemoryInfo(perf: Performance): perf is PerformanceMemory {
  return 'memory' in perf && 
         perf.memory !== undefined && 
         typeof perf.memory.usedJSHeapSize === 'number';
}

// 定義特徵緩存接口
interface FeatureCache {
  [key: string]: {
    timestamp: number;
    feature: MultiLevelFeature;
    lastAccessed?: number;
    usageCount?: number;
  };
}

// 緩存配置接口
interface CacheConfig {
  maxEntries: number;      // 最大緩存項數量
  expirationTime: number;  // 過期時間（毫秒）
  cleanupInterval: number; // 清理間隔（毫秒）
  storageQuota: number;    // 存儲配額（字節）
}

// 記憶體監控配置
interface MemoryConfig {
  lowMemoryThreshold: number; // 低記憶體閾值（MB）
  criticalMemoryThreshold: number; // 嚴重記憶體不足閾值（MB）
  checkInterval: number; // 檢查間隔（毫秒）
}

// 批處理配置
interface BatchConfig {
  defaultBatchSize: number; // 默認批處理大小
  maxConcurrent: number;    // 最大並發數
  highFeatureThreshold: number; // 高級特徵提取閾值
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
  
  // 緩存清理計時器
  private cacheCleanupTimer?: number;
  
  // 記憶體監控計時器
  private memoryMonitorTimer?: number;
  
  // 緩存配置
  private cacheConfig: CacheConfig = {
    maxEntries: 5000,
    expirationTime: 7 * 24 * 60 * 60 * 1000, // 7天
    cleanupInterval: 10 * 60 * 1000, // 10分鐘
    storageQuota: 50 * 1024 * 1024 // 50MB
  };
  
  // 記憶體配置
  private memoryConfig: MemoryConfig = {
    lowMemoryThreshold: 200, // 200MB
    criticalMemoryThreshold: 100, // 100MB
    checkInterval: 30 * 1000 // 30秒
  };
  
  // 批處理配置
  private batchConfig: BatchConfig = {
    defaultBatchSize: 5,
    maxConcurrent: 3,
    highFeatureThreshold: 100
  };
  
  /**
   * 初始化特徵管理器
   * @param workerCount 工作線程數量
   */
  public async initialize(workerCount = navigator.hardwareConcurrency || 4): Promise<Result<boolean, Error>> {
    // 使用 safeExecute 包裝初始化邏輯
    return safeExecute<boolean>(
      async () => {
        if (this.initialized) {
          return true;
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
        
        // 啟動緩存清理定時器
        this.startCacheCleanup();
        
        // 啟動記憶體監控
        this.startMemoryMonitoring();
        
        this.initialized = true;
        console.info(`[FeatureManager] 初始化成功，創建了 ${workerCount} 個工作線程`);
        return true;
      },
      {
        errorType: ErrorType.SYSTEM_ERROR,
        errorMessage: '特徵管理器初始化失敗',
        details: '無法創建或初始化工作線程池',
        severity: ErrorSeverity.HIGH,
        recoverable: true,
        recoveryAction: () => this.initialize(Math.max(1, workerCount - 1))
      }
    );
  }
  
  /**
   * 獲取可用的工作線程
   */
  private getNextWorker(): Remote<FeatureWorkerInterface> {
    this.lastWorkerIndex = (this.lastWorkerIndex + 1) % this.workers.length;
    return this.workers[this.lastWorkerIndex];
  }
  
  /**
   * 啟動緩存清理定時器
   */
  private startCacheCleanup(): void {
    // 清除舊的計時器
    if (this.cacheCleanupTimer) {
      window.clearInterval(this.cacheCleanupTimer);
    }
    
    // 設置新計時器
    this.cacheCleanupTimer = window.setInterval(() => {
      this.cleanupCache();
    }, this.cacheConfig.cleanupInterval);
  }
  
  /**
   * 啟動記憶體監控
   */
  private startMemoryMonitoring(): void {
    // 清除舊的計時器
    if (this.memoryMonitorTimer) {
      window.clearInterval(this.memoryMonitorTimer);
    }
    
    // 設置新計時器
    this.memoryMonitorTimer = window.setInterval(() => {
      this.checkMemoryUsage();
    }, this.memoryConfig.checkInterval);
  }
  
  /**
   * 檢查記憶體使用情況
   */
  private async checkMemoryUsage(): Promise<void> {
    try {
      // 使用類型安全的方式檢查記憶體
      if (hasMemoryInfo(performance)) {
        const memoryInfo = performance.memory!; // 已經通過類型守衛確認存在
        const usedMemoryMB = memoryInfo.usedJSHeapSize / (1024 * 1024);
        
        // 記錄當前記憶體使用情況（僅在開發環境）
        if (process.env.NODE_ENV === 'development') {
          console.debug(`[FeatureManager] 當前記憶體使用: ${Math.round(usedMemoryMB)} MB`);
        }
        
        // 檢查是否達到嚴重記憶體不足閾值
        if (usedMemoryMB >= this.memoryConfig.criticalMemoryThreshold) {
          console.warn(`[FeatureManager] 嚴重記憶體不足: ${Math.round(usedMemoryMB)} MB，進行緊急緩存清理`);
          
          // 執行緊急清理，保留較少的緩存
          this.cleanupCache(true);
          
          // 嘗試釋放更多資源
          this.emergencyResourceRelease();
          
          // 報告記憶體不足錯誤
          errorHandler.handleError(
            new Error('應用程序記憶體不足'),
            ErrorType.MEMORY_LIMIT_ERROR,
            '已進行緩存清理以釋放記憶體。如果問題持續，請減少同時處理的照片數量或關閉其他應用。',
            true,
            // 添加恢復操作
            () => {
              this.cleanupCache(true);
              this.emergencyResourceRelease();
            },
            ErrorSeverity.MEDIUM
          );
          
        } else if (usedMemoryMB >= this.memoryConfig.lowMemoryThreshold) {
          console.warn(`[FeatureManager] 記憶體不足: ${Math.round(usedMemoryMB)} MB，進行常規緩存清理`);
          this.cleanupCache();
        }
      }
    } catch (error) {
      console.error('[FeatureManager] 檢查記憶體使用時出錯:', error);
      errorHandler.handleError(
        error instanceof Error ? error : new Error('記憶體監控失敗'),
        ErrorType.SYSTEM_ERROR,
        '檢查系統記憶體使用時出錯',
        false,
        undefined,
        ErrorSeverity.LOW
      );
    }
  }
  
  /**
   * 清理緩存
   * @param emergency 是否為緊急清理
   */
  private cleanupCache(emergency: boolean = false): void {
    const now = Date.now();
    const entries = Object.entries(this.cache);
    
    // 按上次訪問時間排序
    entries.sort((a, b) => {
      const lastAccessedA = a[1].lastAccessed || a[1].timestamp;
      const lastAccessedB = b[1].lastAccessed || b[1].timestamp;
      return lastAccessedB - lastAccessedA;
    });
    
    // 確定要保留的項目數量
    const keepCount = emergency 
      ? Math.floor(this.cacheConfig.maxEntries / 4) // 緊急情況下，只保留 1/4
      : this.cacheConfig.maxEntries;
    
    if (entries.length > keepCount) {
      // 刪除多餘的條目
      const entriesToRemove = entries.slice(keepCount);
      for (const [key] of entriesToRemove) {
        delete this.cache[key];
      }
      console.info(`[FeatureManager] 已清理 ${entriesToRemove.length} 個緩存條目，當前緩存大小: ${entries.length - entriesToRemove.length}`);
    }
    
    // 刪除過期的條目
    for (const [key, value] of Object.entries(this.cache)) {
      if (now - value.timestamp > this.cacheConfig.expirationTime) {
        delete this.cache[key];
      }
    }
    
    // 如果不是緊急情況，保存緩存到存儲
    if (!emergency) {
      this.saveCacheToStorage();
    }
  }
  
  /**
   * 提取並緩存特徵
   * 
   * @param photo 照片
   * @param level 特徵級別
   * @param options 選項
   * @returns 特徵結果
   */
  public async extractAndCacheFeature(
    photo: PhotoFile,
    level: FeatureLevel,
    options: { forceUpdate?: boolean } = {}
  ): Promise<Result<MultiLevelFeature, Error>> {
    return safeExecute<MultiLevelFeature>(
      async () => {
        // 檢查是否已初始化
        if (!this.initialized) {
          await this.initialize();
        }
        
        // 生成緩存鍵
        const cacheKey = this.generateCacheKey(photo, level);
        
        // 檢查緩存
        if (!options.forceUpdate && this.cache[cacheKey]) {
          // 更新訪問時間和計數
          const cacheEntry = this.cache[cacheKey];
          cacheEntry.lastAccessed = Date.now();
          cacheEntry.usageCount = (cacheEntry.usageCount ?? 0) + 1;
          
          // 返回緩存的特徵
          return cacheEntry.feature;
        }
        
        // 根據不同級別提取特徵
        let feature: MultiLevelFeature;
        switch (level) {
          case FeatureLevel.LOW:
            feature = await this.extractLowLevelFeature(photo);
            break;
          case FeatureLevel.MID:
            feature = await this.extractMidLevelFeature(photo);
            break;
          case FeatureLevel.HIGH:
            feature = await this.extractHighLevelFeature(photo);
            break;
          default:
            throw new Error(`不支持的特徵級別: ${level}`);
        }
        
        // 緩存特徵
        this.cache[cacheKey] = {
          timestamp: Date.now(),
          lastAccessed: Date.now(),
          usageCount: 1,
          feature
        };
        
        // 檢查並清理緩存
        if (Object.keys(this.cache).length > this.cacheConfig.maxEntries) {
          this.cleanupCache();
        }
        
        return feature;
      },
      {
        errorType: ErrorType.PHOTO_EXTRACTION_ERROR,
        errorMessage: `提取照片 ${photo.file.name} 的 ${level} 級特徵失敗`,
        details: '無法處理照片數據',
        severity: ErrorSeverity.MEDIUM,
        recoverable: true
      }
    );
  }

  /**
   * 緊急釋放資源
   */
  private emergencyResourceRelease(): void {
    // 清除未使用的變量引用
    for (const key in this.cache) {
      // 只保留最近使用的項目的完整引用
      const cacheEntry = this.cache[key];
      const lastAccessed = cacheEntry.lastAccessed ?? cacheEntry.timestamp;
      
      if (Date.now() - lastAccessed > 10 * 60 * 1000) { // 10分鐘未使用
        // 保留基本引用，釋放大型數據
        const feature = cacheEntry.feature;
        
        // 釋放高級特徵
        if (feature.highLevelFeatures && feature.highLevelFeatures.length > 0) {
          // 替換為空數組，但保持類型一致
          feature.highLevelFeatures = [];
        }
        
        // 釋放中級特徵
        if (feature.midLevelFeatures) {
          // 釋放顏色直方圖
          if (feature.midLevelFeatures.colorHistogram && 
              feature.midLevelFeatures.colorHistogram.length > 0) {
            feature.midLevelFeatures.colorHistogram = [];
          }
          
          // 釋放紋理特徵
          if (feature.midLevelFeatures.textureFeatures && 
              feature.midLevelFeatures.textureFeatures.length > 0) {
            feature.midLevelFeatures.textureFeatures = [];
          }
        }
      }
    }
    
    // 觸發垃圾回收（如果可用）
    if (typeof window !== 'undefined' && 'gc' in window) {
      try {
        (window as any).gc();
      } catch (e) {
        // 忽略錯誤
      }
    }
  }
  
  /**
   * 從持久化存儲加載緩存
   */
  private async loadCacheFromStorage(): Promise<void> {
    try {
      const cacheData = localStorage.getItem('featureCache');
      if (cacheData) {
        try {
          const parsedCache = JSON.parse(cacheData);
          
          // 檢查並轉換舊格式緩存
          if (parsedCache && typeof parsedCache === 'object') {
            // 初始化新緩存
            this.cache = {};
            
            // 遍歷並轉換條目
            for (const [key, value] of Object.entries(parsedCache)) {
              if (value && typeof value === 'object' && 'timestamp' in value && 'feature' in value) {
                // 添加新字段（如果不存在）
                const entry = value as any;
                this.cache[key] = {
                  timestamp: entry.timestamp,
                  feature: entry.feature,
                  lastAccessed: entry.lastAccessed || entry.timestamp,
                  usageCount: entry.usageCount || 0
                };
              }
            }
            
            console.info(`[FeatureManager] 從存儲加載了 ${Object.keys(this.cache).length} 個特徵緩存`);
            
            // 清理過期或多餘的緩存
            this.cleanupCache();
          } else {
            throw new Error('緩存格式無效');
          }
        } catch (parseError) {
          // 使用 errorHandler 記錄 JSON 解析錯誤
          errorHandler.handleError(
            parseError,
            ErrorType.FILE_SYSTEM_ERROR,
            '特徵緩存 JSON 解析失敗',
            true,
            undefined,
            ErrorSeverity.LOW
          );
          // 如果解析失敗，重置緩存
          this.cache = {};
        }
      }
    } catch (error) {
      errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorType.FILE_SYSTEM_ERROR,
        '加載特徵緩存失敗',
        true,
        undefined,
        ErrorSeverity.LOW
      );
      // 如果加載失敗，重置緩存
      this.cache = {};
    }
  }
  
  /**
   * 保存緩存到持久化存儲
   */
  private async saveCacheToStorage(): Promise<void> {
    try {
      // 檢查緩存大小
      const cacheSize = Object.keys(this.cache).length;
      
      if (cacheSize === 0) {
        localStorage.removeItem('featureCache');
        return;
      }
      
      // 如果緩存項目過多，進行清理
      if (cacheSize > this.cacheConfig.maxEntries) {
        this.cleanupCache();
      }
      
      // 估算緩存數據大小
      const cacheData = JSON.stringify(this.cache);
      const estimatedSize = new Blob([cacheData]).size;
      
      // 如果數據太大，進行清理
      if (estimatedSize > this.cacheConfig.storageQuota) {
        console.warn(`[FeatureManager] 緩存數據過大 (${Math.round(estimatedSize / 1024 / 1024)} MB)，超過配額 (${Math.round(this.cacheConfig.storageQuota / 1024 / 1024)} MB)，進行清理...`);
        this.cleanupCache(true);
        return this.saveCacheToStorage(); // 遞歸調用，嘗試再次保存
      }
      
      // 檢查存儲空間是否充足
      try {
        // 估計當前剩餘存儲空間 (簡單檢查)
        const testKey = `__storage_test_${Date.now()}`;
        const testData = new Array(1024).fill('A').join(''); // 1KB 數據
        localStorage.setItem(testKey, testData);
        localStorage.removeItem(testKey);
      } catch (storageError) {
        // 存儲空間可能不足
        errorHandler.handleError(
          storageError instanceof Error ? storageError : new Error(String(storageError)),
          ErrorType.FILE_SYSTEM_ERROR,
          '存儲空間不足，無法保存特徵緩存',
          true,
          undefined,
          ErrorSeverity.LOW
        );
        return;
      }
      
      localStorage.setItem('featureCache', JSON.stringify(this.cache));
    } catch (error) {
      errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorType.FILE_SYSTEM_ERROR,
        '保存特徵緩存失敗',
        true,
        undefined,
        ErrorSeverity.LOW
      );
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
      // 更新最後訪問時間和使用計數
      cached.lastAccessed = Date.now();
      cached.usageCount = (cached.usageCount || 0) + 1;
      
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
      errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorType.PHOTO_EXTRACTION_ERROR,
        '[FeatureManager] 提取哈希特徵失敗',
        false,
        undefined,
        ErrorSeverity.MEDIUM
      );
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
      errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorType.SYSTEM_ERROR,
        '[FeatureManager] 計算相似度失敗',
        false,
        undefined,
        ErrorSeverity.LOW
      );
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
      errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorType.SYSTEM_ERROR,
        '[FeatureManager] 批量計算相似度失敗',
        false,
        undefined,
        ErrorSeverity.MEDIUM
      );
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
      errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorType.SYSTEM_ERROR,
        '[FeatureManager] 壓縮向量失敗',
        false,
        undefined,
        ErrorSeverity.LOW
      );
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
  
  /**
   * 設置批處理配置
   * @param config 批處理配置
   */
  public setBatchConfig(config: Partial<BatchConfig>): void {
    this.batchConfig = { ...this.batchConfig, ...config };
  }
  
  /**
   * 獲取批處理配置
   */
  public getBatchConfig(): BatchConfig {
    return { ...this.batchConfig };
  }
  
  /**
   * 設置緩存配置
   * @param config 緩存配置
   */
  public setCacheConfig(config: Partial<CacheConfig>): void {
    const prevCleanupInterval = this.cacheConfig.cleanupInterval;
    
    this.cacheConfig = { ...this.cacheConfig, ...config };
    
    // 如果清理間隔改變了，重新啟動清理計時器
    if (prevCleanupInterval !== this.cacheConfig.cleanupInterval) {
      this.startCacheCleanup();
    }
  }
  
  /**
   * 獲取緩存狀態信息
   */
  public getCacheStatus(): {
    totalEntries: number,
    oldestEntry: number,
    newestEntry: number,
    estimatedSize: number
  } {
    let oldestTimestamp = Date.now();
    let newestTimestamp = 0;
    
    // 計算最舊和最新的條目
    Object.values(this.cache).forEach(entry => {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
      if (entry.timestamp > newestTimestamp) {
        newestTimestamp = entry.timestamp;
      }
    });
    
    // 估算緩存大小
    const cacheData = JSON.stringify(this.cache);
    const estimatedSize = new Blob([cacheData]).size;
    
    return {
      totalEntries: Object.keys(this.cache).length,
      oldestEntry: oldestTimestamp,
      newestEntry: newestTimestamp,
      estimatedSize
    };
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
      
      // 清除計時器
      if (this.cacheCleanupTimer) {
        window.clearInterval(this.cacheCleanupTimer);
        this.cacheCleanupTimer = undefined;
      }
      
      if (this.memoryMonitorTimer) {
        window.clearInterval(this.memoryMonitorTimer);
        this.memoryMonitorTimer = undefined;
      }
      
      // 終止所有工作線程
      for (const worker of this.workers) {
        try {
          // 嘗試多種方法來釋放/終止 worker
          // 方法 1: 使用 Comlink 的 releaseProxy (如果可用)
          if ('releaseProxy' in worker && typeof worker.releaseProxy === 'function') {
            worker.releaseProxy();
            continue;
          }
          
          // 方法 2: 使用較新的 Symbol.dispose (如果存在)
          const disposeSymbol = Symbol.for('dispose');
          if (disposeSymbol in worker && typeof worker[disposeSymbol as keyof typeof worker] === 'function') {
            (worker[disposeSymbol as keyof typeof worker] as Function)();
            continue;
          }
          
          // 方法 3: 嘗試通過 comlink 內部屬性獲取原始 worker
          // 這是不穩定的，但是是一個備用方案
          // @ts-ignore - 使用內部 Comlink 結構
          const comlinkObj = worker[Symbol.for('comlink.remoteObject')];
          if (comlinkObj && comlinkObj.port && comlinkObj.port.source) {
            const sourceObj = comlinkObj.port.source;
            if ('terminate' in sourceObj && typeof sourceObj.terminate === 'function') {
              sourceObj.terminate();
              continue;
            }
          }
          
          // 如果所有方法都失敗，記錄警告
          console.warn('無法終止工作線程:', worker);
          
        } catch (err) {
          console.warn('終止工作線程時出錯:', err);
        }
      }
      
      this.workers = [];
      this.initialized = false;
      
      console.info('[FeatureManager] 已釋放所有資源');
    } catch (error) {
      errorHandler.handleError(
        error,
        ErrorType.SYSTEM_ERROR,
        '釋放特徵管理器資源時出錯',
        false,
        undefined,
        ErrorSeverity.MEDIUM
      );
    }
  }
}

// 導出全局單例
export const featureManager = new FeatureManager(); 