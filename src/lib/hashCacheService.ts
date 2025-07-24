import { HashResult } from './types';

/**
 * 緩存項目介面 - 優化版本，包含更多元數據
 */
interface CacheItem {
  // 唯一標識符
  id: string;
  // 哈希值相關
  hash?: string;
  hashes?: HashResult;
  features?: number[];
  // 緩存元數據
  timestamp: number;
  accessCount: number;       // 訪問次數
  lastAccessed: number;      // 最後訪問時間
  priority: number;          // 優先級 (越高越不容易被清除)
  // 文件元數據
  fileSize: number;
  fileName?: string;         // 文件名，用於除錯和統計
  fileType?: string;         // 文件類型
  lastModified?: number;
  // 品質指標
  quality?: {
    sharpness: number;
    brightness: number;
    contrast: number;
    score: number;
  };
  // 版本和來源信息
  version?: number;          // 緩存格式版本號
  source?: string;           // 緩存來源 (如 'hash', 'features', 'quality')
}

/**
 * 哈希緩存服務，使用IndexedDB持久化儲存照片的哈希值和特徵向量
 */
/**
 * 緩存設定界面
 */
export interface CacheConfig {
  dbName: string;
  dbVersion: number;
  maxCacheSize: number;      // 最大緩存項目數
  maxCacheSizeMB: number;    // 最大緩存大小 (MB)
  defaultExpiryDays: number; // 默認過期天數
  autoCleanThreshold: number; // 自動清理閾值 (0-1)，表示達到最大大小的比例時開始清理
  priorityWeights: {         // 優先級權重
    recency: number;         // 最近訪問權重
    frequency: number;       // 訪問頻率權重
    size: number;            // 文件大小權重 (負相關)
  };
}

/**
 * 緩存統計信息
 */
export interface CacheStats {
  totalItems: number;
  totalSizeBytes: number;
  oldestItemDate: Date;
  newestItemDate: Date;
  averageItemSize: number;
  hashCount: number;
  multiHashCount: number;
  featuresCount: number;
  qualityCount: number;
  hitRate: number;
  missRate: number;
  lastCleanupDate?: Date;
}

/**
 * 增強版哈希緩存服務
 */
export class HashCacheService {
  private dbName = 'photo-hash-cache';
  private dbVersion = 2; // 增加版本號以支持新的索引和結構
  private storeName = 'hashes';
  private metaStoreName = 'metadata'; // 存儲緩存元數據
  private db: IDBDatabase | null = null;
  private pendingOperations = new Map<string, Promise<unknown>>();
  private isInitialized = false;
  private initPromise: Promise<boolean> | null = null;
  
  // 緩存統計數據
  private stats: CacheStats = {
    totalItems: 0,
    totalSizeBytes: 0,
    oldestItemDate: new Date(),
    newestItemDate: new Date(),
    averageItemSize: 0,
    hashCount: 0,
    multiHashCount: 0,
    featuresCount: 0,
    qualityCount: 0,
    hitRate: 0,
    missRate: 0
  };
  
  // 記錄緩存命中和未命中
  private hits = 0;
  private misses = 0;
  
  // 設定
  private config: CacheConfig = {
    dbName: this.dbName,
    dbVersion: this.dbVersion,
    maxCacheSize: 5000,       // 預設最多5000個緩存項
    maxCacheSizeMB: 100,      // 預設最大100MB
    defaultExpiryDays: 30,    // 預設30天過期
    autoCleanThreshold: 0.8,  // 達到80%容量時開始自動清理
    priorityWeights: {
      recency: 0.5,           // 最近使用權重
      frequency: 0.3,         // 使用頻率權重
      size: 0.2               // 大小權重
    }
  };
  
  /**
   * 構造函數 - 接受可選的配置參數
   * @param customConfig 自定義配置
   */
  constructor(customConfig?: Partial<CacheConfig>) {
    if (customConfig) {
      this.config = {
        ...this.config,
        ...customConfig
      };
      
      // 更新內部變數
      this.dbName = this.config.dbName;
      this.dbVersion = this.config.dbVersion;
    }
    
    // 在空閒時間進行緩存維護
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => {
        this.init().then(() => this.performMaintenance());
      });
    } else {
      // 後備方案
      setTimeout(() => {
        this.init().then(() => this.performMaintenance());
      }, 5000);
    }
  }

  /**
   * 初始化數據庫 - 增強版
   * @returns Promise 解析為布爾值表示成功與否
   */
  async init(): Promise<boolean> {
    if (this.initPromise) {
      return this.initPromise;
    }
    
    this.initPromise = new Promise((resolve) => {
      // 檢查瀏覽器支援
      if (!window.indexedDB) {
        console.warn('瀏覽器不支持IndexedDB，哈希緩存將被禁用');
        resolve(false);
        return;
      }
      
      try {
        // 打開數據庫連接
        const request = window.indexedDB.open(this.dbName, this.dbVersion);
        
        // 錯誤處理
        request.onerror = (event) => {
          const error = (event.target as IDBOpenDBRequest).error;
          console.error('無法打開IndexedDB數據庫:', error?.message || '未知錯誤');
          
          // 如果是版本錯誤，嘗試刪除數據庫並重新創建
          if (error && error.name === 'VersionError') {
            console.warn('數據庫版本錯誤，嘗試重建...');
            this.resetDatabase().then(success => resolve(success));
          } else {
            resolve(false);
          }
        };
        
        // 數據庫升級處理
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const oldVersion = event.oldVersion;
          
          // 創建或更新主數據存儲
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
            
            // 創建索引 - 提高查詢效率
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
            store.createIndex('accessCount', 'accessCount', { unique: false });
            store.createIndex('fileSize', 'fileSize', { unique: false });
            store.createIndex('priority', 'priority', { unique: false });
            store.createIndex('fileName', 'fileName', { unique: false });
            store.createIndex('fileType', 'fileType', { unique: false });
            store.createIndex('lastModified', 'lastModified', { unique: false });
            store.createIndex('version', 'version', { unique: false });
            
            // 複合索引 - 優化高級查詢
            store.createIndex('priority_lastAccessed', ['priority', 'lastAccessed'], { unique: false });
            store.createIndex('fileType_fileSize', ['fileType', 'fileSize'], { unique: false });
          } else {
            // 更新現有存儲的索引
            const store = event.target?.transaction?.objectStore(this.storeName);
            
            // 添加新索引，如果不存在
            if (store && !store.indexNames.contains('lastAccessed')) {
              store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
            }
            if (store && !store.indexNames.contains('accessCount')) {
              store.createIndex('accessCount', 'accessCount', { unique: false });
            }
            if (store && !store.indexNames.contains('priority')) {
              store.createIndex('priority', 'priority', { unique: false });
            }
            if (store && !store.indexNames.contains('priority_lastAccessed')) {
              store.createIndex('priority_lastAccessed', ['priority', 'lastAccessed'], { unique: false });
            }
          }
          
          // 創建元數據存儲
          if (!db.objectStoreNames.contains(this.metaStoreName)) {
            const metaStore = db.createObjectStore(this.metaStoreName, { keyPath: 'id' });
            metaStore.put({
              id: 'stats',
              version: this.dbVersion,
              created: new Date().toISOString(),
              lastUpdated: new Date().toISOString(),
              totalItems: 0,
              totalSizeBytes: 0,
              hits: 0,
              misses: 0,
              lastCleanup: null
            });
          }
          
          console.info(`數據庫從版本 ${oldVersion} 升級到 ${this.dbVersion}`);
        };
        
        // 成功打開數據庫
        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          this.isInitialized = true;
          
          // 加載統計信息
          this.loadStats().then(() => {
            console.info(`緩存統計: ${this.stats.totalItems} 項, ${Math.round(this.stats.totalSizeBytes / 1024 / 1024)}MB`);
          });
          
          // 數據庫錯誤監聽
          this.db.onerror = (event) => {
            console.error('數據庫錯誤:', (event.target as any).errorCode);
          };
          
          resolve(true);
        };
      } catch (error) {
        console.error('初始化IndexedDB失敗:', error);
        resolve(false);
      }
    });
    
    return this.initPromise;
  }
  
  /**
   * 重置數據庫 - 當版本不兼容時使用
   */
  private async resetDatabase(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!window.indexedDB) {
        resolve(false);
        return;
      }
      
      // 嘗試刪除現有數據庫
      const deleteRequest = window.indexedDB.deleteDatabase(this.dbName);
      
      deleteRequest.onerror = () => {
        console.error('無法刪除舊版本數據庫');
        resolve(false);
      };
      
      deleteRequest.onsuccess = () => {
        console.info('成功刪除舊版本數據庫，正在重建...');
        
        // 重新創建數據庫
        const request = window.indexedDB.open(this.dbName, this.dbVersion);
        
        request.onerror = () => {
          console.error('重建數據庫失敗');
          resolve(false);
        };
        
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          
          // 創建主數據存儲
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
          store.createIndex('accessCount', 'accessCount', { unique: false });
          store.createIndex('fileSize', 'fileSize', { unique: false });
          store.createIndex('priority', 'priority', { unique: false });
          
          // 創建元數據存儲
          const metaStore = db.createObjectStore(this.metaStoreName, { keyPath: 'id' });
          metaStore.put({
            id: 'stats',
            version: this.dbVersion,
            created: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            totalItems: 0,
            totalSizeBytes: 0,
            hits: 0,
            misses: 0,
            lastCleanup: null
          });
        };
        
        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          this.isInitialized = true;
          resolve(true);
        };
      };
    });
  }
  
  /**
   * 加載統計信息
   */
  private async loadStats(): Promise<void> {
    if (!this.db) return;
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([this.metaStoreName], 'readonly');
        const store = transaction.objectStore(this.metaStoreName);
        const request = store.get('stats');
        
        request.onsuccess = () => {
          const data = request.result;
          
          if (data) {
            this.hits = data.hits || 0;
            this.misses = data.misses || 0;
            this.stats.totalItems = data.totalItems || 0;
            this.stats.totalSizeBytes = data.totalSizeBytes || 0;
            this.stats.hitRate = this.hits / (this.hits + this.misses || 1);
            this.stats.missRate = this.misses / (this.hits + this.misses || 1);
            
            if (data.lastCleanup) {
              this.stats.lastCleanupDate = new Date(data.lastCleanup);
            }
          }
          
          resolve();
        };
        
        request.onerror = () => {
          console.error('無法讀取緩存統計信息');
          resolve();
        };
      } catch (error) {
        console.error('讀取統計數據時出錯:', error);
        resolve();
      }
    });
  }
  
  /**
   * 保存統計信息
   */
  private async saveStats(): Promise<void> {
    if (!this.db) return;
    
    return new Promise((resolve) => {
      try {
        const transaction = this.db.transaction([this.metaStoreName], 'readwrite');
        const store = transaction.objectStore(this.metaStoreName);
        
        const statsData = {
          id: 'stats',
          version: this.dbVersion,
          lastUpdated: new Date().toISOString(),
          totalItems: this.stats.totalItems,
          totalSizeBytes: this.stats.totalSizeBytes,
          hits: this.hits,
          misses: this.misses,
          lastCleanup: this.stats.lastCleanupDate ? this.stats.lastCleanupDate.toISOString() : null
        };
        
        const request = store.put(statsData);
        
        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.error('無法保存緩存統計信息');
          resolve();
        };
      } catch (error) {
        console.error('保存統計數據時出錯:', error);
        resolve();
      }
    });
  }
  
  /**
   * 執行緩存維護
   */
  public async performMaintenance(): Promise<void> {
    if (!this.isInitialized || !this.db) {
      return;
    }
    
    // 檢查上次清理時間，避免頻繁執行
    const now = Date.now();
    if (
      this.stats.lastCleanupDate && 
      now - this.stats.lastCleanupDate.getTime() < 24 * 60 * 60 * 1000 // 一天內不重複清理
    ) {
      console.log('上次緩存維護時間在24小時內，跳過此次維護');
      return;
    }
    
    console.log('開始緩存維護...');
    
    try {
      // 獲取緩存大小和數量
      await this.refreshCacheStats();
      
      // 檢查是否需要清理
      const cacheSizeInMB = this.stats.totalSizeBytes / (1024 * 1024);
      const sizeLimitReached = cacheSizeInMB > this.config.maxCacheSizeMB * this.config.autoCleanThreshold;
      const countLimitReached = this.stats.totalItems > this.config.maxCacheSize * this.config.autoCleanThreshold;
      
      if (sizeLimitReached || countLimitReached) {
        console.log(`緩存大小: ${Math.round(cacheSizeInMB)}MB / ${this.config.maxCacheSizeMB}MB, 項目數: ${this.stats.totalItems} / ${this.config.maxCacheSize}`);
        console.log('觸發自動緩存清理...');
        
        // 計算需要刪除的項目比例
        const targetSizeRatio = sizeLimitReached ? 0.7 : 1; // 目標為降至70%
        const targetCountRatio = countLimitReached ? 0.7 : 1;
        
        // 執行自適應清理
        await this.adaptiveCleanup(targetSizeRatio, targetCountRatio);
        
        // 更新統計數據
        await this.refreshCacheStats();
        console.log(`清理後緩存大小: ${Math.round(this.stats.totalSizeBytes / (1024 * 1024))}MB, 項目數: ${this.stats.totalItems}`);
      } else {
        console.log(`緩存狀態正常: ${Math.round(cacheSizeInMB)}MB / ${this.config.maxCacheSizeMB}MB, 項目數: ${this.stats.totalItems} / ${this.config.maxCacheSize}`);
      }
      
      // 記錄維護時間
      this.stats.lastCleanupDate = new Date();
      await this.saveStats();
      
      console.log('緩存維護完成');
    } catch (error) {
      console.error('緩存維護出錯:', error);
    }
  }
  
  /**
   * 更新緩存統計信息
   */
  private async refreshCacheStats(): Promise<void> {
    if (!this.db) return;
    
    return new Promise<void>((resolve) => {
      try {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        
        // 獲取數據總數
        const countRequest = store.count();
        countRequest.onsuccess = () => {
          this.stats.totalItems = countRequest.result;
        };
        
        // 使用游標計算總大小
        let totalSize = 0;
        let oldestDate = new Date();
        let newestDate = new Date(0);
        
        let hashCount = 0;
        let multiHashCount = 0;
        let featuresCount = 0;
        let qualityCount = 0;
        
        const cursorRequest = store.openCursor();
        
        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          
          if (cursor) {
            const item = cursor.value as CacheItem;
            
            // 更新大小
            totalSize += item.fileSize || 0;
            
            // 更新日期範圍
            const itemDate = new Date(item.timestamp);
            if (itemDate < oldestDate) oldestDate = itemDate;
            if (itemDate > newestDate) newestDate = itemDate;
            
            // 更新類型計數
            if (item.hash) hashCount++;
            if (item.hashes) multiHashCount++;
            if (item.features) featuresCount++;
            if (item.quality) qualityCount++;
            
            cursor.continue();
          } else {
            // 所有數據處理完成
            this.stats.totalSizeBytes = totalSize;
            this.stats.oldestItemDate = oldestDate;
            this.stats.newestItemDate = newestDate;
            this.stats.averageItemSize = this.stats.totalItems > 0 ? 
              totalSize / this.stats.totalItems : 0;
            
            this.stats.hashCount = hashCount;
            this.stats.multiHashCount = multiHashCount;
            this.stats.featuresCount = featuresCount;
            this.stats.qualityCount = qualityCount;
            
            resolve();
          }
        };
        
        cursorRequest.onerror = () => {
          console.error('無法讀取緩存統計數據');
          resolve();
        };
        
        transaction.oncomplete = () => {
          // 確保所有操作完成
          resolve();
        };
      } catch (error) {
        console.error('讀取緩存統計數據時出錯:', error);
        resolve();
      }
    });
  }
  
  /**
   * 自適應清理緩存
   * @param targetSizeRatio 目標大小比例 (0-1)
   * @param targetCountRatio 目標數量比例 (0-1)
   */
  private async adaptiveCleanup(targetSizeRatio: number, targetCountRatio: number): Promise<void> {
    if (!this.db) return;
    
    // 計算優先級 - 訪問頻率、最近使用時間、文件大小的加權綜合
    const calculatePriority = (item: CacheItem): number => {
      const recency = Math.max(0, (Date.now() - item.lastAccessed) / (1000 * 60 * 60 * 24 * 30)); // 最近30天內的訪問權重較高
      const frequency = item.accessCount || 0;
      const size = item.fileSize / (1024 * 1024); // MB
      
      // 優先級公式: 較高的訪問頻率和最近訪問有正面影響，較大的文件大小有負面影響
      return (
        this.config.priorityWeights.recency * (1 / (recency + 1)) + 
        this.config.priorityWeights.frequency * Math.log(frequency + 1) - 
        this.config.priorityWeights.size * size
      );
    };
    
    return new Promise<void>((resolve) => {
      try {
        // 獲取所有項目並計算優先級
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const items: (CacheItem & { priority: number })[] = [];
        
        const cursorRequest = store.openCursor();
        
        cursorRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          
          if (cursor) {
            const item = cursor.value as CacheItem;
            items.push({
              ...item,
              priority: calculatePriority(item)
            });
            cursor.continue();
          } else {
            // 項目收集完成，根據優先級排序
            items.sort((a, b) => a.priority - b.priority); // 從低優先級到高優先級
            
            const targetSize = this.stats.totalSizeBytes * targetSizeRatio;
            const targetCount = Math.floor(this.stats.totalItems * targetCountRatio);
            
            let currentSize = this.stats.totalSizeBytes;
            let itemsToRemove = [];
            
            // 從低優先級開始移除，直到達到目標
            for (const item of items) {
              if (items.length - itemsToRemove.length <= targetCount && currentSize <= targetSize) {
                break;
              }
              
              itemsToRemove.push(item.id);
              currentSize -= item.fileSize || 0;
            }
            
            // 執行刪除操作
            if (itemsToRemove.length > 0) {
              console.log(`清理緩存: 移除 ${itemsToRemove.length} 個低優先級項目`);
              this.batchRemoveItems(itemsToRemove)
                .then(() => resolve())
                .catch(err => {
                  console.error('緩存清理失敗:', err);
                  resolve();
                });
            } else {
              resolve();
            }
          }
        };
        
        cursorRequest.onerror = () => {
          console.error('無法讀取緩存項目');
          resolve();
        };
      } catch (error) {
        console.error('緩存清理時出錯:', error);
        resolve();
      }
    });
  }
  
  /**
   * 批量刪除緩存項目
   * @param ids 項目ID列表
   */
  private async batchRemoveItems(ids: string[]): Promise<void> {
    if (!this.db || ids.length === 0) return;
    
    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        let completed = 0;
        let errors = 0;
        
        for (const id of ids) {
          const request = store.delete(id);
          
          request.onsuccess = () => {
            completed++;
            if (completed + errors === ids.length) {
              if (errors > 0) {
                console.warn(`批量刪除完成，但有 ${errors} 個項目刪除失敗`);
              }
              resolve();
            }
          };
          
          request.onerror = () => {
            errors++;
            if (completed + errors === ids.length) {
              if (errors === ids.length) {
                reject(new Error('批量刪除操作完全失敗'));
              } else {
                console.warn(`批量刪除完成，但有 ${errors} 個項目刪除失敗`);
                resolve();
              }
            }
          };
        }
        
        transaction.oncomplete = () => {
          resolve();
        };
        
        transaction.onerror = () => {
          reject(new Error('批量刪除事務失敗'));
        };
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 獲取緩存統計信息
   */
  public async getCacheStats(): Promise<CacheStats> {
    await this.init();
    await this.refreshCacheStats();
    return { ...this.stats };
  }
  
  /**
   * 更新緩存項目的訪問統計
   * @param id 項目ID
   * @param data 現有數據
   */
  private async updateItemAccessStats(id: string, data: CacheItem): Promise<void> {
    if (!this.db) return;
    
    return new Promise<void>((resolve) => {
      try {
        const transaction = this.db.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        
        // 更新訪問統計
        const updatedData = {
          ...data,
          accessCount: (data.accessCount || 0) + 1,
          lastAccessed: Date.now()
        };
        
        const request = store.put(updatedData);
        request.onsuccess = () => resolve();
        request.onerror = () => {
          console.warn('更新訪問統計失敗');
          resolve();
        };
      } catch (error) {
        console.warn('更新訪問統計時出錯:', error);
        resolve();
      }
    });
  }
  
  /**
   * 預熱緩存 - 提前加載常用哈希
   * 當應用啟動時可以調用此方法來預熱緩存
   */
  public async preloadCache(): Promise<void> {
    if (!await this.init()) return;
    
    console.log('預熱緩存中...');
    
    try {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      
      // 使用優先級索引獲取最常用的項目
      const index = store.index('priority_lastAccessed');
      const request = index.openCursor(null, 'prev'); // 從高到低順序
      let count = 0;
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor && count < 100) { // 預加載前100個最常用項
          // 只需訪問即可，不需實際處理
          count++;
          cursor.continue();
        } else {
          console.log(`緩存預熱完成，已預加載 ${count} 個項目`);
        }
      };
      
      request.onerror = () => {
        console.warn('緩存預熱失敗');
      };
    } catch (error) {
      console.error('緩存預熱出錯:', error);
    }
  }
  
  /**
   * 生成照片的唯一緩存ID
   * @param file 照片文件
   * @returns 唯一ID
   */
  private generateCacheId(file: File): string {
    // 使用文件名、大小和修改時間生成唯一ID
    return `${file.name}_${file.size}_${file.lastModified}`;
  }
  
  /**
   * 將照片的哈希值存入緩存
   * @param file 照片文件
   * @param hash 感知哈希值
   */
  async storeHash(file: File, hash: string): Promise<void> {
    if (!await this.init()) return;
    
    const id = this.generateCacheId(file);
    
    const operation = new Promise<void>((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        
        const getRequest = store.get(id);
        
        getRequest.onsuccess = () => {
          const existingData = getRequest.result || {};
          
          const data = {
            id,
            hash,
            fileSize: file.size,
            lastModified: file.lastModified,
            timestamp: Date.now(),
            ...existingData
          };
          
          const putRequest = store.put(data);
          
          putRequest.onsuccess = () => {
            resolve();
          };
          
          putRequest.onerror = () => {
            reject(new Error('存儲哈希失敗'));
          };
        };
        
        getRequest.onerror = () => {
          reject(new Error('讀取現有緩存失敗'));
        };
      } catch (error) {
        reject(error);
      }
    });
    
    this.pendingOperations.set(id, operation);
    
    try {
      await operation;
    } finally {
      this.pendingOperations.delete(id);
    }
  }
  
  /**
   * 將照片的多哈希值存入緩存
   * @param file 照片文件
   * @param hashes 多種哈希值
   */
  async storeMultiHash(file: File, hashes: HashResult): Promise<void> {
    if (!await this.init()) return;
    
    const id = this.generateCacheId(file);
    
    const operation = new Promise<void>((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        
        const getRequest = store.get(id);
        
        getRequest.onsuccess = () => {
          const existingData = getRequest.result || {};
          
          const data = {
            id,
            hashes,
            fileSize: file.size,
            lastModified: file.lastModified,
            timestamp: Date.now(),
            ...existingData
          };
          
          const putRequest = store.put(data);
          
          putRequest.onsuccess = () => {
            resolve();
          };
          
          putRequest.onerror = () => {
            reject(new Error('存儲多哈希失敗'));
          };
        };
        
        getRequest.onerror = () => {
          reject(new Error('讀取現有緩存失敗'));
        };
      } catch (error) {
        reject(error);
      }
    });
    
    this.pendingOperations.set(id, operation);
    
    try {
      await operation;
    } finally {
      this.pendingOperations.delete(id);
    }
  }
  
  /**
   * 存儲照片的特徵向量
   * @param file 照片文件
   * @param features 特徵向量
   */
  async storeFeatures(file: File, features: number[]): Promise<void> {
    if (!await this.init()) return;
    
    const id = this.generateCacheId(file);
    
    const operation = new Promise<void>((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        
        const getRequest = store.get(id);
        
        getRequest.onsuccess = () => {
          const existingData = getRequest.result || {};
          
          const data = {
            id,
            features,
            fileSize: file.size,
            lastModified: file.lastModified,
            timestamp: Date.now(),
            ...existingData
          };
          
          const putRequest = store.put(data);
          
          putRequest.onsuccess = () => {
            resolve();
          };
          
          putRequest.onerror = () => {
            reject(new Error('存儲特徵向量失敗'));
          };
        };
        
        getRequest.onerror = () => {
          reject(new Error('讀取現有緩存失敗'));
        };
      } catch (error) {
        reject(error);
      }
    });
    
    this.pendingOperations.set(id, operation);
    
    try {
      await operation;
    } finally {
      this.pendingOperations.delete(id);
    }
  }
  
  /**
   * 存儲照片的品質資訊
   * @param file 照片文件
   * @param quality 品質指標
   */
  async storeQuality(file: File, quality: {
    sharpness: number;
    brightness: number;
    contrast: number;
    score: number;
  }): Promise<void> {
    if (!await this.init()) return;
    
    const id = this.generateCacheId(file);
    
    const operation = new Promise<void>((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        
        const getRequest = store.get(id);
        
        getRequest.onsuccess = () => {
          const existingData = getRequest.result || {};
          
          const data = {
            id,
            quality,
            fileSize: file.size,
            lastModified: file.lastModified,
            timestamp: Date.now(),
            ...existingData
          };
          
          const putRequest = store.put(data);
          
          putRequest.onsuccess = () => {
            resolve();
          };
          
          putRequest.onerror = () => {
            reject(new Error('存儲品質指標失敗'));
          };
        };
        
        getRequest.onerror = () => {
          reject(new Error('讀取現有緩存失敗'));
        };
      } catch (error) {
        reject(error);
      }
    });
    
    this.pendingOperations.set(id, operation);
    
    try {
      await operation;
    } finally {
      this.pendingOperations.delete(id);
    }
  }
  
  /**
   * 從緩存中獲取照片的哈希值
   * @param file 照片文件
   * @returns 哈希字符串，如果不存在則返回null
   */
  async getHash(file: File): Promise<string | null> {
    if (!await this.init()) return null;
    
    const id = this.generateCacheId(file);
    
    // 如果有等待中的操作，先等待完成
    const pendingOp = this.pendingOperations.get(id);
    if (pendingOp) {
      await pendingOp;
    }
    
    return new Promise<string | null>((resolve) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(id);
        
        request.onsuccess = () => {
          const data = request.result as CacheItem | undefined;
          if (data && data.hash) {
            // 記錄緩存命中
            this.hits++;
            
            // 異步更新訪問統計，不影響主要操作
            this.updateItemAccessStats(id, data).catch(e => 
              console.warn('更新訪問統計失敗:', e)
            );
            
            resolve(data.hash);
          } else {
            // 記錄緩存未命中
            this.misses++;
            resolve(null);
          }
          
          // 每 100 次操作更新統計數據
          if ((this.hits + this.misses) % 100 === 0) {
            this.saveStats().catch(e => 
              console.warn('保存統計數據失敗:', e)
            );
          }
        };
        
        request.onerror = () => {
          this.misses++;
          resolve(null);
        };
      } catch (error) {
        console.error('讀取緩存失敗:', error);
        this.misses++;
        resolve(null);
      }
    });
  }
  
  /**
   * 從緩存中獲取照片的多哈希值
   * @param file 照片文件
   * @returns 哈希結果集，如果不存在則返回null
   */
  async getMultiHash(file: File): Promise<HashResult | null> {
    if (!await this.init()) return null;
    
    const id = this.generateCacheId(file);
    
    // 如果有等待中的操作，先等待完成
    const pendingOp = this.pendingOperations.get(id);
    if (pendingOp) {
      await pendingOp;
    }
    
    return new Promise<HashResult | null>((resolve) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(id);
        
        request.onsuccess = () => {
          const data = request.result as CacheItem | undefined;
          if (data && data.hashes) {
            resolve(data.hashes);
          } else {
            resolve(null);
          }
        };
        
        request.onerror = () => {
          resolve(null);
        };
      } catch (error) {
        console.error('讀取多哈希緩存失敗:', error);
        resolve(null);
      }
    });
  }
  
  /**
   * 從緩存中獲取照片的特徵向量
   * @param file 照片文件
   * @returns 特徵向量，如果不存在則返回null
   */
  async getFeatures(file: File): Promise<number[] | null> {
    if (!await this.init()) return null;
    
    const id = this.generateCacheId(file);
    
    // 如果有等待中的操作，先等待完成
    const pendingOp = this.pendingOperations.get(id);
    if (pendingOp) {
      await pendingOp;
    }
    
    return new Promise<number[] | null>((resolve) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(id);
        
        request.onsuccess = () => {
          const data = request.result as CacheItem | undefined;
          if (data && data.features) {
            resolve(data.features);
          } else {
            resolve(null);
          }
        };
        
        request.onerror = () => {
          resolve(null);
        };
      } catch (error) {
        console.error('讀取特徵向量緩存失敗:', error);
        resolve(null);
      }
    });
  }
  
  /**
   * 從緩存中獲取照片的品質信息
   * @param file 照片文件
   * @returns 品質信息，如果不存在則返回null
   */
  async getQuality(file: File): Promise<{
    sharpness: number;
    brightness: number;
    contrast: number;
    score: number;
  } | null> {
    if (!await this.init()) return null;
    
    const id = this.generateCacheId(file);
    
    // 如果有等待中的操作，先等待完成
    const pendingOp = this.pendingOperations.get(id);
    if (pendingOp) {
      await pendingOp;
    }
    
    return new Promise((resolve) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(id);
        
        request.onsuccess = () => {
          const data = request.result as CacheItem | undefined;
          if (data && data.quality) {
            resolve(data.quality);
          } else {
            resolve(null);
          }
        };
        
        request.onerror = () => {
          resolve(null);
        };
      } catch (error) {
        console.error('讀取品質緩存失敗:', error);
        resolve(null);
      }
    });
  }
  
  /**
   * 從緩存中獲取完整的緩存項目
   * @param file 照片文件
   * @returns 緩存項目，如果不存在則返回null
   */
  async getCacheItem(file: File): Promise<CacheItem | null> {
    if (!await this.init()) return null;
    
    const id = this.generateCacheId(file);
    
    // 如果有等待中的操作，先等待完成
    const pendingOp = this.pendingOperations.get(id);
    if (pendingOp) {
      await pendingOp;
    }
    
    return new Promise<CacheItem | null>((resolve) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(id);
        
        request.onsuccess = () => {
          const data = request.result as CacheItem | undefined;
          if (data) {
            resolve(data);
          } else {
            resolve(null);
          }
        };
        
        request.onerror = () => {
          resolve(null);
        };
      } catch (error) {
        console.error('讀取緩存項目失敗:', error);
        resolve(null);
      }
    });
  }
  
  /**
   * 清除超過一定時間的緩存項
   * @param maxAgeMs 最大緩存時間（毫秒），默認為7天
   */
  async pruneOldEntries(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    if (!await this.init()) return;
    
    const cutoffTime = Date.now() - maxAgeMs;
    
    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const index = store.index('timestamp');
        
        const range = IDBKeyRange.upperBound(cutoffTime);
        const request = index.openCursor(range);
        
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        
        request.onerror = () => {
          reject(new Error('清理舊緩存項失敗'));
        };
      } catch (error) {
        console.error('清理舊緩存項時出錯:', error);
        reject(error);
      }
    });
  }
  
  /**
   * 刪除特定照片的緩存
   * @param file 照片文件
   */
  async deleteCache(file: File): Promise<void> {
    if (!await this.init()) return;
    
    const id = this.generateCacheId(file);
    
    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.delete(id);
        
        request.onsuccess = () => {
          resolve();
        };
        
        request.onerror = () => {
          reject(new Error('刪除緩存項失敗'));
        };
      } catch (error) {
        console.error('刪除緩存項時出錯:', error);
        reject(error);
      }
    });
  }
  
  /**
   * 清空緩存
   */
  async clearAll(): Promise<void> {
    if (!await this.init()) return;
    
    return new Promise<void>((resolve, reject) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readwrite');
        const store = transaction.objectStore(this.storeName);
        const request = store.clear();
        
        request.onsuccess = () => {
          resolve();
        };
        
        request.onerror = () => {
          reject(new Error('清空緩存失敗'));
        };
      } catch (error) {
        console.error('清空緩存時出錯:', error);
        reject(error);
      }
    });
  }
  
  /**
   * 獲取當前緩存的大小
   * @returns 緩存項目數量
   */
  async getSize(): Promise<number> {
    if (!await this.init()) return 0;
    
    return new Promise<number>((resolve) => {
      try {
        const transaction = this.db!.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.count();
        
        request.onsuccess = () => {
          resolve(request.result);
        };
        
        request.onerror = () => {
          resolve(0);
        };
      } catch (error) {
        console.error('獲取緩存大小失敗:', error);
        resolve(0);
      }
    });
  }
  
  /**
   * 關閉數據庫連接
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      this.initPromise = null;
    }
  }
}

// 創建單例實例
export const hashCache = new HashCacheService(); 