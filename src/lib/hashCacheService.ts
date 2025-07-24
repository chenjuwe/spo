import { HashResult } from './types';

/**
 * 緩存項目介面
 */
interface CacheItem {
  hash?: string;
  hashes?: HashResult;
  features?: number[];
  timestamp: number;
  fileSize: number;
  lastModified?: number;
  quality?: {
    sharpness: number;
    brightness: number;
    contrast: number;
    score: number;
  };
}

/**
 * 哈希緩存服務，使用IndexedDB持久化儲存照片的哈希值和特徵向量
 */
export class HashCacheService {
  private dbName = 'photo-hash-cache';
  private dbVersion = 1;
  private storeName = 'hashes';
  private db: IDBDatabase | null = null;
  private pendingOperations = new Map<string, Promise<unknown>>();
  private isInitialized = false;
  private initPromise: Promise<boolean> | null = null;
  
  /**
   * 初始化數據庫
   * @returns Promise 解析為布爾值表示成功與否
   */
  async init(): Promise<boolean> {
    if (this.initPromise) {
      return this.initPromise;
    }
    
    this.initPromise = new Promise((resolve) => {
      if (!window.indexedDB) {
        console.warn('瀏覽器不支持IndexedDB，哈希緩存將被禁用');
        resolve(false);
        return;
      }
      
      try {
        const request = window.indexedDB.open(this.dbName, this.dbVersion);
        
        request.onerror = () => {
          console.error('無法打開IndexedDB數據庫，哈希緩存將被禁用');
          resolve(false);
        };
        
        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('fileSize', 'fileSize', { unique: false });
            store.createIndex('lastModified', 'lastModified', { unique: false });
          }
        };
        
        request.onsuccess = (event) => {
          this.db = (event.target as IDBOpenDBRequest).result;
          this.isInitialized = true;
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
            resolve(data.hash);
          } else {
            resolve(null);
          }
        };
        
        request.onerror = () => {
          resolve(null);
        };
      } catch (error) {
        console.error('讀取緩存失敗:', error);
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