/**
 * 記憶體優化器
 * 提供漸進式載入、記憶體使用監控和智能釋放機制
 */

import { PhotoFile } from './types';

// 記憶體使用級別
type MemoryUsageLevel = 'normal' | 'high' | 'critical';

// 記憶體優化配置
interface MemoryOptimizerConfig {
  // 記憶體使用閾值 (MB)
  highMemoryThreshold: number;      // 高記憶體使用閾值
  criticalMemoryThreshold: number;  // 危險記憶體使用閾值
  
  // 自動釋放設置
  autoReleaseEnabled: boolean;      // 是否啟用自動釋放
  releaseInterval: number;          // 釋放檢查間隔 (ms)
  idleReleaseTime: number;          // 空閒釋放時間 (ms)
  maxPreviewsInMemory: number;      // 最大內存中預覽數量
  
  // 漸進式載入設置
  progressiveLoadEnabled: boolean;  // 是否啟用漸進式載入
  loadBatchSize: number;            // 批次載入數量
  loadBatchDelay: number;           // 批次載入延遲 (ms)
  loadPriorityDistance: number;     // 優先載入距離 (px)
  
  // 記錄和監控
  logMemoryUsage: boolean;          // 是否記錄記憶體使用
  monitorInterval: number;          // 監控間隔 (ms)
}

interface PreviewItem {
  id: string;
  url: string;
  loadTime: number;
  lastAccessed: number;
  size: number;
  viewportVisible: boolean;
}

/**
 * 記憶體優化器
 * 提供漸進式載入和記憶體管理功能
 */
export class MemoryOptimizer {
  private config: MemoryOptimizerConfig;
  private previewCache: Map<string, PreviewItem> = new Map();
  private releaseTimer: number | null = null;
  private monitorTimer: number | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  
  // 統計
  private stats = {
    peakMemoryUsage: 0,
    totalPreviews: 0,
    totalReleased: 0,
    totalGenerated: 0,
    totalRevokedUrls: 0,
    totalBytes: 0,
    forcedGcCount: 0,
    memoryEvents: [] as Array<{ timestamp: number; usage: number; event: string }>
  };
  
  /**
   * 構造函數
   * @param config 配置選項
   */
  constructor(config?: Partial<MemoryOptimizerConfig>) {
    // 默認配置
    this.config = {
      highMemoryThreshold: 300,        // 300MB
      criticalMemoryThreshold: 500,    // 500MB
      autoReleaseEnabled: true,
      releaseInterval: 30000,          // 30秒
      idleReleaseTime: 60000,          // 1分鐘
      maxPreviewsInMemory: 200,        // 最多 200 個預覽
      progressiveLoadEnabled: true,
      loadBatchSize: 10,
      loadBatchDelay: 50,
      loadPriorityDistance: 1000,
      logMemoryUsage: true,
      monitorInterval: 10000,          // 10秒
      ...config
    };
    
    // 初始化
    this.setupIntersectionObserver();
    
    if (this.config.autoReleaseEnabled) {
      this.startAutoRelease();
    }
    
    if (this.config.logMemoryUsage) {
      this.startMemoryMonitor();
    }
  }
  
  /**
   * 創建預覽URL
   * @param file 檔案
   * @returns 預覽URL
   */
  public createPreview(file: File): string {
    const url = URL.createObjectURL(file);
    
    // 估計大小 - 保守估計為文件大小的 1.2 倍（考慮到解壓縮和內存對齊）
    const estimatedSize = Math.ceil(file.size * 1.2);
    
    this.previewCache.set(url, {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      url,
      loadTime: Date.now(),
      lastAccessed: Date.now(),
      size: estimatedSize,
      viewportVisible: false
    });
    
    // 更新統計
    this.stats.totalPreviews++;
    this.stats.totalGenerated++;
    this.stats.totalBytes += estimatedSize;
    
    // 檢查記憶體使用
    this.checkMemoryUsage();
    
    return url;
  }
  
  /**
   * 釋放預覽URL
   * @param url 要釋放的URL
   */
  public releasePreview(url: string): void {
    const item = this.previewCache.get(url);
    if (!item) return;
    
    try {
      URL.revokeObjectURL(url);
      this.stats.totalRevokedUrls++;
      this.stats.totalReleased++;
      this.stats.totalBytes -= item.size;
      
      this.previewCache.delete(url);
    } catch (error) {
      console.warn('釋放預覽失敗:', error);
    }
  }
  
  /**
   * 標記預覽URL已訪問
   * @param url 預覽URL
   */
  public touchPreview(url: string): void {
    const item = this.previewCache.get(url);
    if (item) {
      item.lastAccessed = Date.now();
    }
  }
  
  /**
   * 設置預覽元素可見性
   * @param url 預覽URL
   * @param element DOM元素
   */
  public observePreviewElement(url: string, element: HTMLElement): void {
    if (!this.intersectionObserver) return;
    
    // 將元素與URL關聯
    element.dataset.previewUrl = url;
    
    // 開始觀察
    this.intersectionObserver.observe(element);
  }
  
  /**
   * 停止觀察預覽元素
   * @param element DOM元素
   */
  public unobservePreviewElement(element: HTMLElement): void {
    if (!this.intersectionObserver) return;
    this.intersectionObserver.unobserve(element);
    
    // 清除數據關聯
    delete element.dataset.previewUrl;
  }
  
  /**
   * 批次釋放指定URL的預覽
   * @param urls 要釋放的URL列表
   */
  public batchReleasePreview(urls: string[]): void {
    for (const url of urls) {
      this.releasePreview(url);
    }
  }
  
  /**
   * 釋放所有預覽URL
   */
  public releaseAllPreviews(): void {
    for (const [url] of this.previewCache) {
      this.releasePreview(url);
    }
  }
  
  /**
   * 釋放閒置的預覽URL
   * @param maxIdle 最長閒置時間 (ms)
   * @param maxCount 最多釋放數量 (0 表示無限制)
   * @returns 釋放的數量
   */
  public releaseIdlePreviews(maxIdle?: number, maxCount: number = 0): number {
    const idleTime = maxIdle || this.config.idleReleaseTime;
    const now = Date.now();
    let releasedCount = 0;
    
    // 收集需要釋放的URL
    const urlsToRelease: string[] = [];
    
    for (const [url, item] of this.previewCache) {
      if (now - item.lastAccessed > idleTime) {
        urlsToRelease.push(url);
        
        // 達到最大釋放數量時停止
        if (maxCount > 0 && ++releasedCount >= maxCount) {
          break;
        }
      }
    }
    
    // 執行批次釋放
    this.batchReleasePreview(urlsToRelease);
    
    if (urlsToRelease.length > 0) {
      console.info(`釋放了 ${urlsToRelease.length} 個閒置預覽`);
    }
    
    return urlsToRelease.length;
  }
  
  /**
   * 釋放過多的預覽URL（當總數超過上限時）
   */
  public releaseExcessPreviews(): number {
    if (this.previewCache.size <= this.config.maxPreviewsInMemory) {
      return 0;
    }
    
    // 計算需要釋放的數量
    const excessCount = this.previewCache.size - this.config.maxPreviewsInMemory;
    
    // 按最後訪問時間排序
    const sortedItems = Array.from(this.previewCache.entries())
      .map(([url, item]) => ({ url, item }))
      .sort((a, b) => a.item.lastAccessed - b.item.lastAccessed);
    
    // 釋放最久未訪問的
    const urlsToRelease = sortedItems
      .slice(0, excessCount)
      .filter(({ item }) => !item.viewportVisible) // 不釋放可見的
      .map(({ url }) => url);
    
    this.batchReleasePreview(urlsToRelease);
    
    if (urlsToRelease.length > 0) {
      console.info(`釋放了 ${urlsToRelease.length} 個過多預覽`);
    }
    
    return urlsToRelease.length;
  }
  
  /**
   * 強制進行垃圾回收
   */
  public requestGarbageCollection(): void {
    if (window.gc) {
      try {
        window.gc();
        this.stats.forcedGcCount++;
        console.info('已請求垃圾回收');
      } catch (e) {
        console.warn('垃圾回收請求失敗', e);
      }
    }
  }
  
  /**
   * 設置批次載入照片
   * @param photos 照片列表
   * @param containerElement 容器元素
   * @param renderer 渲染函數
   */
  public progressiveLoadPhotos<T extends PhotoFile>(
    photos: T[],
    containerElement: HTMLElement,
    renderer: (photo: T, index: number) => void
  ): void {
    if (!this.config.progressiveLoadEnabled || photos.length === 0) {
      // 禁用漸進式載入時，直接渲染全部
      photos.forEach(renderer);
      return;
    }
    
    const batchSize = this.config.loadBatchSize;
    const delay = this.config.loadBatchDelay;
    
    // 獲取可見區域優先級
    let visiblePriorities: number[] = [];
    
    // 使用視窗大小作為參考
    const viewportHeight = window.innerHeight;
    const containerRect = containerElement.getBoundingClientRect();
    
    // 計算每個項目的優先級
    const prioritize = () => {
      const newVisiblePriorities = photos.map((_, index) => {
        // 簡單估算元素位置 (這裡假設每個元素高度相同)
        const elementEstimatedTop = containerRect.top + Math.floor(index / 3) * 200; // 假設每行3個項目，每個高200px
        
        // 計算到視口中心的距離
        const distanceToCenter = Math.abs(elementEstimatedTop - viewportHeight / 2);
        
        // 優先級 = 1000 - 距離 (最近的優先級最高，最低為0)
        return Math.max(0, 1000 - distanceToCenter);
      });
      
      visiblePriorities = newVisiblePriorities;
    };
    
    // 初始計算優先級
    prioritize();
    
    // 批次處理函數
    const processBatch = (startIndex: number) => {
      if (startIndex >= photos.length) return;
      
      // 計算本批次結束位置
      const endIndex = Math.min(startIndex + batchSize, photos.length);
      
      // 獲取本批次照片及其優先級
      const batch = photos
        .slice(startIndex, endIndex)
        .map((photo, idx) => ({
          photo,
          index: startIndex + idx,
          priority: visiblePriorities[startIndex + idx] || 0
        }));
      
      // 根據優先級排序
      batch.sort((a, b) => b.priority - a.priority);
      
      // 渲染
      batch.forEach(({ photo, index }) => renderer(photo, index));
      
      // 檢查記憶體使用
      this.checkMemoryUsage();
      
      // 安排下一批
      setTimeout(() => processBatch(endIndex), delay);
    };
    
    // 開始處理第一批
    processBatch(0);
    
    // 添加滾動處理器重新計算優先級
    const handleScroll = () => {
      prioritize();
    };
    
    // 添加滾動監聽
    window.addEventListener('scroll', handleScroll, { passive: true });
    
    // 60秒後移除滾動監聽
    setTimeout(() => {
      window.removeEventListener('scroll', handleScroll);
    }, 60000);
  }
  
  /**
   * 檢查記憶體使用情況並採取措施
   */
  private checkMemoryUsage(): void {
    if (!this.config.autoReleaseEnabled) return;
    
    const memoryInfo = this.getMemoryUsage();
    
    // 更新峰值
    if (memoryInfo.jsHeapSizeMB > this.stats.peakMemoryUsage) {
      this.stats.peakMemoryUsage = memoryInfo.jsHeapSizeMB;
    }
    
    // 記錄記憶體使用情況
    if (this.config.logMemoryUsage) {
      let event = '';
      
      if (memoryInfo.level === 'critical') {
        event = '記憶體使用到達危險水平';
      } else if (memoryInfo.level === 'high') {
        event = '記憶體使用到達高水平';
      }
      
      if (event) {
        this.stats.memoryEvents.push({
          timestamp: Date.now(),
          usage: memoryInfo.jsHeapSizeMB,
          event
        });
      }
    }
    
    // 根據記憶體級別採取措施
    switch (memoryInfo.level) {
      case 'critical':
        // 緊急釋放記憶體
        const releasedCount1 = this.releaseIdlePreviews(5000, 0); // 釋放5秒內未使用的
        const releasedCount2 = this.releaseExcessPreviews();
        
        console.warn(
          `記憶體使用達到危險級別 (${memoryInfo.jsHeapSizeMB}MB)，` + 
          `已釋放 ${releasedCount1 + releasedCount2} 個預覽`
        );
        
        // 請求垃圾回收
        this.requestGarbageCollection();
        break;
        
      case 'high':
        // 釋放閒置時間較長的預覽
        const releasedCount = this.releaseIdlePreviews(30000, 30); // 釋放30秒內未使用的，最多30個
        
        if (releasedCount > 0) {
          console.info(
            `記憶體使用較高 (${memoryInfo.jsHeapSizeMB}MB)，` +
            `已釋放 ${releasedCount} 個預覽`
          );
        }
        break;
        
      default:
        // 正常範圍，無需特殊處理
        break;
    }
  }
  
  /**
   * 獲取當前記憶體使用情況
   */
  private getMemoryUsage(): { 
    jsHeapSizeMB: number; 
    level: MemoryUsageLevel 
  } {
    let jsHeapSizeMB = 0;
    
    // 嘗試獲取記憶體信息
    const performance = window.performance as any;
    if (performance && performance.memory) {
      const memoryInfo = performance.memory;
      jsHeapSizeMB = Math.round(memoryInfo.usedJSHeapSize / (1024 * 1024));
    } else {
      // 無法獲取實際記憶體使用，使用估算值
      jsHeapSizeMB = Math.round(this.stats.totalBytes / (1024 * 1024));
    }
    
    // 確定記憶體使用級別
    let level: MemoryUsageLevel = 'normal';
    
    if (jsHeapSizeMB >= this.config.criticalMemoryThreshold) {
      level = 'critical';
    } else if (jsHeapSizeMB >= this.config.highMemoryThreshold) {
      level = 'high';
    }
    
    return { jsHeapSizeMB, level };
  }
  
  /**
   * 設置自動釋放計時器
   */
  private startAutoRelease(): void {
    if (this.releaseTimer !== null) {
      clearInterval(this.releaseTimer);
    }
    
    this.releaseTimer = window.setInterval(
      () => this.performAutoRelease(),
      this.config.releaseInterval
    );
  }
  
  /**
   * 執行自動釋放
   */
  private performAutoRelease(): void {
    // 釋放超過閒置時間的預覽
    const releasedIdle = this.releaseIdlePreviews();
    
    // 釋放超過最大數量的預覽
    const releasedExcess = this.releaseExcessPreviews();
    
    const totalReleased = releasedIdle + releasedExcess;
    
    if (totalReleased > 0 && this.config.logMemoryUsage) {
      const memoryInfo = this.getMemoryUsage();
      console.info(
        `自動釋放: ${totalReleased} 個預覽，` +
        `當前記憶體: ${memoryInfo.jsHeapSizeMB}MB，` +
        `剩餘預覽: ${this.previewCache.size}`
      );
    }
  }
  
  /**
   * 開始記憶體監控
   */
  private startMemoryMonitor(): void {
    if (this.monitorTimer !== null) {
      clearInterval(this.monitorTimer);
    }
    
    this.monitorTimer = window.setInterval(
      () => this.logMemoryStats(),
      this.config.monitorInterval
    );
  }
  
  /**
   * 記錄記憶體統計
   */
  private logMemoryStats(): void {
    const memoryInfo = this.getMemoryUsage();
    
    console.debug('記憶體使用統計:', {
      jsHeapSize: `${memoryInfo.jsHeapSizeMB}MB`,
      level: memoryInfo.level,
      previews: this.previewCache.size,
      peak: `${this.stats.peakMemoryUsage}MB`,
      totalGenerated: this.stats.totalGenerated,
      totalReleased: this.stats.totalReleased
    });
  }
  
  /**
   * 設置交叉觀察器
   */
  private setupIntersectionObserver(): void {
    // 檢查是否支援 IntersectionObserver
    if (!('IntersectionObserver' in window)) {
      console.warn('瀏覽器不支援 IntersectionObserver，無法追蹤元素可見性');
      return;
    }
    
    // 創建觀察器
    this.intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const url = element.dataset.previewUrl;
        
        if (!url) continue;
        
        const item = this.previewCache.get(url);
        if (!item) continue;
        
        // 更新可見性
        const isVisible = entry.isIntersecting;
        item.viewportVisible = isVisible;
        
        if (isVisible) {
          // 元素可見時更新訪問時間
          item.lastAccessed = Date.now();
        }
      }
    }, {
      rootMargin: '100px', // 提前 100px 檢測
      threshold: 0.01 // 1% 可見即算
    });
  }
  
  /**
   * 獲取統計數據
   */
  public getStats(): any {
    return {
      ...this.stats,
      activePreviews: this.previewCache.size,
      memoryUsage: this.getMemoryUsage()
    };
  }
  
  /**
   * 銷毀實例，清理資源
   */
  public destroy(): void {
    // 停止計時器
    if (this.releaseTimer !== null) {
      clearInterval(this.releaseTimer);
      this.releaseTimer = null;
    }
    
    if (this.monitorTimer !== null) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    
    // 停止觀察
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }
    
    // 釋放所有預覽
    this.releaseAllPreviews();
  }
}

// 導出默認實例
export default MemoryOptimizer; 