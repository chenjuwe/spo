/**
 * 特徵數據存儲系統
 * 使用 IndexedDB 存儲大量特徵數據，實現高效的分層緩存策略
 */

import { FeaturePoint } from "./incrementalLearning";
import { PhotoFile } from "./types";
import { errorHandler, ErrorType } from "./errorHandlingService";

/**
 * 存儲層級
 * 定義不同層級的緩存
 */
export enum StorageLevel {
  /**
   * 內存層：最快速的訪問，但容量有限
   */
  MEMORY = "memory",
  
  /**
   * IndexedDB 層：較快的持久化存儲
   */
  INDEXED_DB = "indexedDB",
  
  /**
   * 遠端層：可選的雲存儲
   */
  REMOTE = "remote"
}

/**
 * 存儲配置
 */
export interface FeatureStorageConfig {
  /**
   * 數據庫名稱
   */
  dbName: string;
  
  /**
   * 特徵存儲名稱
   */
  storeName: string;
  
  /**
   * 數據庫版本
   */
  version: number;
  
  /**
   * 內存緩存大小（特徵點數量）
   */
  memoryCacheSize: number;
  
  /**
   * IndexedDB 緩存大小（MB）
   * 0 表示不限制
   */
  indexedDBCacheSize: number;
  
  /**
   * 緩存淘汰策略
   * "lru": 最近最少使用
   * "lfu": 最不經常使用
   */
  evictionPolicy: "lru" | "lfu";
  
  /**
   * 緩存命中統計間隔（毫秒）
   */
  statsInterval: number;
  
  /**
   * 是否啟用遠端存儲
   */
  enableRemoteStorage: boolean;
}

/**
 * 默認存儲配置
 */
export const DEFAULT_STORAGE_CONFIG: FeatureStorageConfig = {
  dbName: "photo-features-db",
  storeName: "features",
  version: 1,
  memoryCacheSize: 1000, // 1000 個特徵點
  indexedDBCacheSize: 100, // 100MB
  evictionPolicy: "lru",
  statsInterval: 60000, // 1 分鐘
  enableRemoteStorage: false
};

/**
 * 緩存項
 * 用於內存緩存中跟踪使用情況
 */
interface CacheItem<T> {
  /**
   * 項目鍵
   */
  key: string;
  
  /**
   * 項目數據
   */
  data: T;
  
  /**
   * 最後訪問時間
   */
  lastAccessed: number;
  
  /**
   * 訪問次數
   */
  accessCount: number;
  
  /**
   * 大小（字節）
   */
  size: number;
}

/**
 * 存儲統計信息
 */
export interface StorageStats {
  /**
   * 內存緩存大小（項目數）
   */
  memoryCacheItemCount: number;
  
  /**
   * 內存緩存大小（字節）
   */
  memoryCacheSizeBytes: number;
  
  /**
   * IndexedDB 大小（項目數）
   */
  indexedDBItemCount: number;
  
  /**
   * IndexedDB 大小（字節）
   */
  indexedDBSizeBytes: number;
  
  /**
   * 內存緩存命中次數
   */
  memoryHits: number;
  
  /**
   * IndexedDB 緩存命中次數
   */
  indexedDBHits: number;
  
  /**
   * 未命中次數
   */
  misses: number;
  
  /**
   * 統計開始時間
   */
  statsStartTime: number;
}

/**
 * 特徵存儲系統
 * 實現分層緩存存儲，優先使用內存緩存，然後是 IndexedDB，最後是可選的遠端存儲
 */
export class FeatureStorage {
  /**
   * 配置
   */
  private config: FeatureStorageConfig;
  
  /**
   * 數據庫實例
   */
  private db: IDBDatabase | null = null;
  
  /**
   * 內存緩存
   */
  private memoryCache: Map<string, CacheItem<FeaturePoint>> = new Map();
  
  /**
   * 照片 ID 到特徵點 ID 的映射
   */
  private photoToFeatures: Map<string, string[]> = new Map();
  
  /**
   * 統計信息
   */
  private stats: StorageStats = {
    memoryCacheItemCount: 0,
    memoryCacheSizeBytes: 0,
    indexedDBItemCount: 0,
    indexedDBSizeBytes: 0,
    memoryHits: 0,
    indexedDBHits: 0,
    misses: 0,
    statsStartTime: Date.now()
  };
  
  /**
   * 統計重置定時器
   */
  private statsTimer: number | null = null;
  
  /**
   * 初始化承諾
   * 用於確保數據庫已打開
   */
  private initPromise: Promise<void>;
  
  /**
   * 初始化狀態
   */
  private initialized: boolean = false;

  /**
   * 建立特徵存儲系統
   * @param config 配置選項
   */
  constructor(config: Partial<FeatureStorageConfig> = {}) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
    this.initPromise = this.initialize();
    
    // 啟動統計定時器
    this.startStatsTimer();
  }

  /**
   * 初始化存儲系統
   * 打開 IndexedDB 數據庫
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      await this.openDatabase();
      this.initialized = true;
    } catch (error) {
      errorHandler.handleError(
        error instanceof Error ? error : String(error),
        ErrorType.SYSTEM_ERROR,
        '初始化特徵存儲失敗',
        true
      );
      throw error;
    }
  }

  /**
   * 打開數據庫
   */
  private async openDatabase(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('瀏覽器不支持 IndexedDB'));
        return;
      }
      
      const request = window.indexedDB.open(this.config.dbName, this.config.version);
      
      request.onerror = (event) => {
        console.error('打開數據庫失敗:', event);
        reject(new Error('打開數據庫失敗'));
      };
      
      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        console.info('數據庫打開成功:', this.config.dbName);
        
        this.db.onerror = (event) => {
          console.error('數據庫錯誤:', event);
        };
        
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // 創建特徵存儲
        if (!db.objectStoreNames.contains(this.config.storeName)) {
          const store = db.createObjectStore(this.config.storeName, { keyPath: 'id' });
          store.createIndex('photoId', 'photoId', { unique: false });
          store.createIndex('level', 'level', { unique: false });
          store.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }
        
        // 創建照片映射存儲
        if (!db.objectStoreNames.contains('photoMapping')) {
          const mapStore = db.createObjectStore('photoMapping', { keyPath: 'photoId' });
        }
        
        // 創建元數據存儲
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
        
        console.info('數據庫架構已創建');
      };
    });
  }

  /**
   * 確保數據庫已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initPromise;
    }
  }

  /**
   * 獲取特徵點
   * 從最快的存儲層開始查詢
   * 
   * @param id 特徵點 ID
   * @returns 特徵點，如果不存在則返回 null
   */
  public async getFeaturePoint(id: string): Promise<FeaturePoint | null> {
    await this.ensureInitialized();
    
    // 先檢查內存緩存
    const cacheItem = this.memoryCache.get(id);
    if (cacheItem) {
      // 更新訪問統計
      cacheItem.lastAccessed = Date.now();
      cacheItem.accessCount++;
      this.stats.memoryHits++;
      
      return cacheItem.data;
    }
    
    // 檢查 IndexedDB
    try {
      const feature = await this.getFromIndexedDB(id);
      if (feature) {
        // 找到了，添加到內存緩存
        this.addToMemoryCache(id, feature);
        this.stats.indexedDBHits++;
        
        return feature;
      }
    } catch (error) {
      console.error('從 IndexedDB 獲取特徵失敗:', error);
    }
    
    // 未找到
    this.stats.misses++;
    return null;
  }

  /**
   * 從 IndexedDB 獲取特徵
   * @param id 特徵點 ID
   * @returns 特徵點，如果不存在則返回 null
   */
  private async getFromIndexedDB(id: string): Promise<FeaturePoint | null> {
    if (!this.db) return null;
    
    return new Promise<FeaturePoint | null>((resolve, reject) => {
      const transaction = this.db!.transaction(this.config.storeName, 'readonly');
      const store = transaction.objectStore(this.config.storeName);
      const request = store.get(id);
      
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result as FeaturePoint);
        } else {
          resolve(null);
        }
      };
      
      request.onerror = (event) => {
        console.error('獲取特徵失敗:', event);
        reject(new Error('獲取特徵失敗'));
      };
    });
  }

  /**
   * 保存特徵點
   * 保存到所有層級的存儲
   * 
   * @param featurePoint 特徵點
   * @param photoId 照片 ID
   * @returns 保存是否成功
   */
  public async saveFeaturePoint(
    featurePoint: FeaturePoint,
    photoId: string
  ): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      // 保存到內存緩存
      this.addToMemoryCache(featurePoint.id, featurePoint);
      
      // 更新照片到特徵的映射
      this.updatePhotoFeatureMapping(photoId, featurePoint.id);
      
      // 保存到 IndexedDB
      await this.saveToIndexedDB(featurePoint, photoId);
      
      return true;
    } catch (error) {
      console.error('保存特徵失敗:', error);
      return false;
    }
  }

  /**
   * 保存到 IndexedDB
   * @param featurePoint 特徵點
   * @param photoId 照片 ID
   */
  private async saveToIndexedDB(
    featurePoint: FeaturePoint,
    photoId: string
  ): Promise<void> {
    if (!this.db) throw new Error('數據庫未打開');
    
    return new Promise<void>((resolve, reject) => {
      // 計算對象大小
      const size = this.estimateObjectSize(featurePoint);
      
      // 創建要保存的記錄
      const record = {
        ...featurePoint,
        photoId, // 添加照片 ID 用於索引
        size
      };
      
      const transaction = this.db!.transaction([this.config.storeName, 'metadata'], 'readwrite');
      const store = transaction.objectStore(this.config.storeName);
      const metadataStore = transaction.objectStore('metadata');
      
      // 獲取當前存儲大小
      const getDbSizeReq = metadataStore.get('dbSize');
      
      getDbSizeReq.onsuccess = () => {
        let currentSize = getDbSizeReq.result ? (getDbSizeReq.result as any).value : 0;
        
        // 檢查是否需要清理空間
        if (this.config.indexedDBCacheSize > 0 && 
            (currentSize + size) / (1024 * 1024) > this.config.indexedDBCacheSize) {
          this.evictFromIndexedDB(size);
        }
        
        // 保存特徵點
        const request = store.put(record);
        
        request.onsuccess = () => {
          // 更新數據庫大小
          currentSize += size;
          this.stats.indexedDBSizeBytes = currentSize;
          this.stats.indexedDBItemCount++;
          
          metadataStore.put({ key: 'dbSize', value: currentSize });
          resolve();
        };
        
        request.onerror = (event) => {
          console.error('保存特徵失敗:', event);
          reject(new Error('保存特徵失敗'));
        };
      };
      
      getDbSizeReq.onerror = (event) => {
        console.error('獲取數據庫大小失敗:', event);
        reject(new Error('獲取數據庫大小失敗'));
      };
    });
  }

  /**
   * 添加到內存緩存
   * @param id 特徵點 ID
   * @param featurePoint 特徵點
   */
  private addToMemoryCache(id: string, featurePoint: FeaturePoint): void {
    // 檢查緩存大小
    if (this.memoryCache.size >= this.config.memoryCacheSize) {
      this.evictFromMemoryCache();
    }
    
    // 計算特徵點大小
    const size = this.estimateObjectSize(featurePoint);
    
    // 添加到緩存
    const cacheItem: CacheItem<FeaturePoint> = {
      key: id,
      data: featurePoint,
      lastAccessed: Date.now(),
      accessCount: 1,
      size
    };
    
    this.memoryCache.set(id, cacheItem);
    
    // 更新統計信息
    this.stats.memoryCacheItemCount = this.memoryCache.size;
    this.stats.memoryCacheSizeBytes += size;
  }

  /**
   * 更新照片特徵映射
   * @param photoId 照片 ID
   * @param featureId 特徵 ID
   */
  private updatePhotoFeatureMapping(photoId: string, featureId: string): void {
    // 獲取現有映射
    let featureIds = this.photoToFeatures.get(photoId) || [];
    
    // 添加新的特徵 ID（如果不存在）
    if (!featureIds.includes(featureId)) {
      featureIds.push(featureId);
      this.photoToFeatures.set(photoId, featureIds);
    }
    
    // 同步到 IndexedDB（異步）
    this.savePhotoMappingToIndexedDB(photoId, featureIds).catch(error => {
      console.error('保存照片映射失敗:', error);
    });
  }

  /**
   * 保存照片映射到 IndexedDB
   * @param photoId 照片 ID
   * @param featureIds 特徵 ID 數組
   */
  private async savePhotoMappingToIndexedDB(
    photoId: string,
    featureIds: string[]
  ): Promise<void> {
    if (!this.db) return;
    
    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction('photoMapping', 'readwrite');
      const store = transaction.objectStore('photoMapping');
      
      const request = store.put({
        photoId,
        featureIds
      });
      
      request.onsuccess = () => {
        resolve();
      };
      
      request.onerror = (event) => {
        console.error('保存照片映射失敗:', event);
        reject(new Error('保存照片映射失敗'));
      };
    });
  }

  /**
   * 獲取照片的所有特徵
   * @param photoId 照片 ID
   * @returns 特徵點數組
   */
  public async getPhotoFeatures(photoId: string): Promise<FeaturePoint[]> {
    await this.ensureInitialized();
    
    // 從內存中獲取映射
    let featureIds = this.photoToFeatures.get(photoId);
    
    // 如果內存中沒有，嘗試從 IndexedDB 加載
    if (!featureIds) {
      try {
        const mapping = await this.getPhotoMappingFromIndexedDB(photoId);
        if (mapping) {
          featureIds = mapping.featureIds;
          this.photoToFeatures.set(photoId, featureIds);
        } else {
          return [];
        }
      } catch (error) {
        console.error('獲取照片映射失敗:', error);
        return [];
      }
    }
    
    // 獲取所有特徵點
    const features: FeaturePoint[] = [];
    for (const featureId of featureIds) {
      const feature = await this.getFeaturePoint(featureId);
      if (feature) {
        features.push(feature);
      }
    }
    
    return features;
  }

  /**
   * 從 IndexedDB 獲取照片映射
   * @param photoId 照片 ID
   */
  private async getPhotoMappingFromIndexedDB(photoId: string): Promise<{ photoId: string, featureIds: string[] } | null> {
    if (!this.db) return null;
    
    return new Promise<{ photoId: string, featureIds: string[] } | null>((resolve, reject) => {
      const transaction = this.db!.transaction('photoMapping', 'readonly');
      const store = transaction.objectStore('photoMapping');
      
      const request = store.get(photoId);
      
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result as { photoId: string, featureIds: string[] });
        } else {
          resolve(null);
        }
      };
      
      request.onerror = (event) => {
        console.error('獲取照片映射失敗:', event);
        reject(new Error('獲取照片映射失敗'));
      };
    });
  }

  /**
   * 從內存緩存中淘汰項目
   */
  private evictFromMemoryCache(): void {
    if (this.memoryCache.size === 0) return;
    
    let itemToRemove: CacheItem<FeaturePoint> | null = null;
    
    // 根據淘汰策略選擇要移除的項目
    if (this.config.evictionPolicy === 'lru') {
      // 最近最少使用：選擇最早訪問的項目
      let earliestAccess = Date.now();
      
      for (const item of this.memoryCache.values()) {
        if (item.lastAccessed < earliestAccess) {
          earliestAccess = item.lastAccessed;
          itemToRemove = item;
        }
      }
    } else if (this.config.evictionPolicy === 'lfu') {
      // 最不經常使用：選擇訪問次數最少的項目
      let lowestCount = Number.MAX_SAFE_INTEGER;
      
      for (const item of this.memoryCache.values()) {
        if (item.accessCount < lowestCount) {
          lowestCount = item.accessCount;
          itemToRemove = item;
        }
      }
    }
    
    if (itemToRemove) {
      // 從緩存中移除
      this.memoryCache.delete(itemToRemove.key);
      
      // 更新統計信息
      this.stats.memoryCacheSizeBytes -= itemToRemove.size;
      this.stats.memoryCacheItemCount = this.memoryCache.size;
    }
  }

  /**
   * 從 IndexedDB 淘汰數據
   * @param requiredSpace 需要釋放的空間（字節）
   */
  private async evictFromIndexedDB(requiredSpace: number): Promise<void> {
    if (!this.db) return;
    
    return new Promise<void>((resolve, reject) => {
      // 獲取當前數據庫大小
      const transaction = this.db!.transaction(['metadata', this.config.storeName], 'readwrite');
      const metadataStore = transaction.objectStore('metadata');
      const featureStore = transaction.objectStore(this.config.storeName);
      
      const getDbSizeReq = metadataStore.get('dbSize');
      
      getDbSizeReq.onsuccess = () => {
        const currentSize = getDbSizeReq.result ? (getDbSizeReq.result as any).value : 0;
        const maxSizeBytes = this.config.indexedDBCacheSize * 1024 * 1024;
        
        // 計算需要釋放的空間
        let spaceToFree = Math.max(
          requiredSpace,
          currentSize - maxSizeBytes + requiredSpace
        );
        
        if (spaceToFree <= 0) {
          resolve();
          return;
        }
        
        // 按上次更新時間排序獲取特徵
        const index = featureStore.index('lastUpdated');
        const request = index.openCursor();
        
        let freedSpace = 0;
        const itemsToDelete: string[] = [];
        
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result as IDBCursorWithValue;
          
          if (cursor && freedSpace < spaceToFree) {
            const item = cursor.value as FeaturePoint & { size: number };
            freedSpace += item.size || 0;
            itemsToDelete.push(item.id);
            cursor.continue();
          } else {
            // 刪除選定的項目
            const deleteTransaction = this.db!.transaction(this.config.storeName, 'readwrite');
            const deleteStore = deleteTransaction.objectStore(this.config.storeName);
            
            for (const id of itemsToDelete) {
              deleteStore.delete(id);
            }
            
            // 更新數據庫大小
            const newSize = Math.max(0, currentSize - freedSpace);
            this.stats.indexedDBSizeBytes = newSize;
            this.stats.indexedDBItemCount -= itemsToDelete.length;
            
            const updateSizeReq = metadataStore.put({ key: 'dbSize', value: newSize });
            
            updateSizeReq.onsuccess = () => {
              console.info(`從 IndexedDB 中釋放了 ${(freedSpace / (1024 * 1024)).toFixed(2)} MB 空間`);
              resolve();
            };
            
            updateSizeReq.onerror = (error) => {
              console.error('更新數據庫大小失敗:', error);
              reject(new Error('更新數據庫大小失敗'));
            };
          }
        };
        
        request.onerror = (error) => {
          console.error('淘汰 IndexedDB 數據失敗:', error);
          reject(new Error('淘汰 IndexedDB 數據失敗'));
        };
      };
      
      getDbSizeReq.onerror = (error) => {
        console.error('獲取數據庫大小失敗:', error);
        reject(new Error('獲取數據庫大小失敗'));
      };
    });
  }

  /**
   * 刪除照片相關的所有特徵
   * @param photoId 照片 ID
   * @returns 是否成功
   */
  public async deletePhotoFeatures(photoId: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      // 獲取照片的所有特徵 ID
      const mapping = await this.getPhotoMappingFromIndexedDB(photoId);
      
      if (mapping) {
        // 從內存中刪除
        for (const featureId of mapping.featureIds) {
          const cacheItem = this.memoryCache.get(featureId);
          if (cacheItem) {
            this.memoryCache.delete(featureId);
            this.stats.memoryCacheSizeBytes -= cacheItem.size;
          }
        }
        
        this.stats.memoryCacheItemCount = this.memoryCache.size;
        
        // 從映射中刪除
        this.photoToFeatures.delete(photoId);
        
        // 從 IndexedDB 中刪除
        await this.deleteFromIndexedDB(photoId, mapping.featureIds);
        
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('刪除照片特徵失敗:', error);
      return false;
    }
  }

  /**
   * 從 IndexedDB 中刪除特徵和映射
   * @param photoId 照片 ID
   * @param featureIds 特徵 ID 數組
   */
  private async deleteFromIndexedDB(
    photoId: string,
    featureIds: string[]
  ): Promise<void> {
    if (!this.db) return;
    
    return new Promise<void>((resolve, reject) => {
      // 刪除特徵點
      const transaction = this.db!.transaction([this.config.storeName, 'photoMapping', 'metadata'], 'readwrite');
      const store = transaction.objectStore(this.config.storeName);
      const mappingStore = transaction.objectStore('photoMapping');
      const metadataStore = transaction.objectStore('metadata');
      
      // 獲取當前數據庫大小
      const getDbSizeReq = metadataStore.get('dbSize');
      
      getDbSizeReq.onsuccess = () => {
        let currentSize = getDbSizeReq.result ? (getDbSizeReq.result as any).value : 0;
        let deletedSize = 0;
        
        // 刪除照片映射
        mappingStore.delete(photoId);
        
        // 刪除所有特徵點
        const deletePromises = featureIds.map(id => 
          new Promise<number>((resolveSize, rejectSize) => {
            // 先獲取項目大小
            const getRequest = store.get(id);
            
            getRequest.onsuccess = () => {
              const item = getRequest.result as any;
              const size = item ? (item.size || 0) : 0;
              
              // 刪除項目
              const deleteRequest = store.delete(id);
              
              deleteRequest.onsuccess = () => {
                resolveSize(size);
              };
              
              deleteRequest.onerror = (error) => {
                console.error(`刪除特徵 ${id} 失敗:`, error);
                rejectSize(error);
              };
            };
            
            getRequest.onerror = (error) => {
              console.error(`獲取特徵 ${id} 失敗:`, error);
              rejectSize(error);
            };
          })
        );
        
        // 等待所有刪除操作完成
        Promise.all(deletePromises).then(sizes => {
          // 計算刪除的總大小
          deletedSize = sizes.reduce((sum, size) => sum + size, 0);
          
          // 更新數據庫大小
          const newSize = Math.max(0, currentSize - deletedSize);
          this.stats.indexedDBSizeBytes = newSize;
          this.stats.indexedDBItemCount -= sizes.length;
          
          // 更新元數據
          metadataStore.put({ key: 'dbSize', value: newSize });
          
          resolve();
        }).catch(error => {
          console.error('刪除特徵失敗:', error);
          reject(error);
        });
      };
      
      getDbSizeReq.onerror = (error) => {
        console.error('獲取數據庫大小失敗:', error);
        reject(error);
      };
    });
  }

  /**
   * 獲取存儲統計信息
   * @returns 存儲統計
   */
  public getStats(): StorageStats {
    return { ...this.stats };
  }

  /**
   * 重置統計信息
   */
  public resetStats(): void {
    this.stats = {
      memoryCacheItemCount: this.memoryCache.size,
      memoryCacheSizeBytes: this.calculateMemoryCacheSize(),
      indexedDBItemCount: this.stats.indexedDBItemCount,
      indexedDBSizeBytes: this.stats.indexedDBSizeBytes,
      memoryHits: 0,
      indexedDBHits: 0,
      misses: 0,
      statsStartTime: Date.now()
    };
  }

  /**
   * 計算內存緩存大小
   * @returns 內存緩存大小（字節）
   */
  private calculateMemoryCacheSize(): number {
    let size = 0;
    for (const item of this.memoryCache.values()) {
      size += item.size;
    }
    return size;
  }

  /**
   * 估算對象大小
   * @param obj 要估算的對象
   * @returns 估算的大小（字節）
   */
  private estimateObjectSize(obj: any): number {
    if (obj === null || obj === undefined) return 0;
    
    // 對於數組，遞歸計算每個元素的大小
    if (Array.isArray(obj)) {
      return obj.reduce((size, item) => size + this.estimateObjectSize(item), 0);
    }
    
    // 對於簡單類型，使用固定大小
    switch (typeof obj) {
      case 'boolean': return 4;
      case 'number': return 8;
      case 'string': return obj.length * 2; // Unicode 字符，每個字符 2 字節
      
      case 'object': {
        // 特殊處理 TypedArray
        if (ArrayBuffer.isView(obj)) {
          return obj.byteLength;
        }
        
        // 對於一般對象，計算所有屬性的大小
        let size = 0;
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) {
            // 屬性名大小 + 屬性值大小
            size += key.length * 2 + this.estimateObjectSize(obj[key]);
          }
        }
        return size;
      }
      
      default: return 0;
    }
  }

  /**
   * 啟動統計定時器
   */
  private startStatsTimer(): void {
    if (this.statsTimer !== null) {
      return;
    }
    
    this.statsTimer = window.setInterval(() => {
      this.resetStats();
    }, this.config.statsInterval) as unknown as number;
  }

  /**
   * 清除所有數據
   * 刪除緩存和數據庫中的所有數據
   */
  public async clearAll(): Promise<void> {
    await this.ensureInitialized();
    
    // 清除內存緩存
    this.memoryCache.clear();
    this.photoToFeatures.clear();
    
    this.stats.memoryCacheItemCount = 0;
    this.stats.memoryCacheSizeBytes = 0;
    
    // 清除 IndexedDB 數據
    if (!this.db) return;
    
    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction([
        this.config.storeName, 
        'photoMapping', 
        'metadata'
      ], 'readwrite');
      
      const featureStore = transaction.objectStore(this.config.storeName);
      const mappingStore = transaction.objectStore('photoMapping');
      const metadataStore = transaction.objectStore('metadata');
      
      // 清除所有存儲
      const clearFeatures = featureStore.clear();
      const clearMappings = mappingStore.clear();
      
      // 重置數據庫大小
      metadataStore.put({ key: 'dbSize', value: 0 });
      
      // 統計信息
      this.stats.indexedDBItemCount = 0;
      this.stats.indexedDBSizeBytes = 0;
      
      clearFeatures.onerror = (error) => {
        console.error('清除特徵存儲失敗:', error);
        reject(new Error('清除特徵存儲失敗'));
      };
      
      clearMappings.onerror = (error) => {
        console.error('清除照片映射失敗:', error);
        reject(new Error('清除照片映射失敗'));
      };
      
      transaction.oncomplete = () => {
        console.info('已清除所有特徵數據');
        resolve();
      };
      
      transaction.onerror = (error) => {
        console.error('清除數據失敗:', error);
        reject(new Error('清除數據失敗'));
      };
    });
  }

  /**
   * 關閉存儲
   * 釋放資源
   */
  public close(): void {
    // 停止統計定時器
    if (this.statsTimer !== null) {
      clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    
    // 關閉數據庫
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    
    // 清除內存緩存
    this.memoryCache.clear();
    this.photoToFeatures.clear();
    
    this.initialized = false;
    
    console.info('特徵存儲已關閉');
  }
} 