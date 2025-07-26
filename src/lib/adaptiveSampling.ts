/**
 * 自適應採樣與批量處理模塊
 * 根據圖像複雜性動態調整處理順序和批量大小
 */

import { PhotoFile } from "@/lib/types";

/**
 * 圖像複雜性指標
 */
export interface ImageComplexity {
  /**
   * 圖像識別碼
   */
  id: string;
  
  /**
   * 文件大小 (位元組)
   */
  fileSize: number;
  
  /**
   * 圖像尺寸 (像素)
   */
  dimensions?: { width: number; height: number };
  
  /**
   * 圖像格式
   */
  format?: string;
  
  /**
   * 估計的視覺複雜度得分 (0-100)
   * 更高的值表示圖像更複雜
   */
  visualComplexity?: number;
  
  /**
   * 處理優先級 (0-10)
   * 更高的值表示處理優先級更高
   */
  priority: number;
  
  /**
   * 圖像的特定特性標記
   * 例如："highDetail", "largeSize", "animation"
   */
  features?: string[];
  
  /**
   * 估計的處理時間 (毫秒)
   */
  estimatedProcessingTime?: number;
  
  /**
   * 圖像中的主要顏色數量
   */
  colorCount?: number;
}

/**
 * 自適應採樣配置
 */
export interface AdaptiveSamplingConfig {
  /**
   * 基礎批量大小
   */
  baseBatchSize: number;
  
  /**
   * 最大批量大小
   */
  maxBatchSize: number;
  
  /**
   * 最小批量大小
   */
  minBatchSize: number;
  
  /**
   * 記憶體閾值 (MB)
   * 當可用記憶體低於此值時，減小批量大小
   */
  memoryThreshold: number;
  
  /**
   * 複雜性閾值 (0-100)
   * 當圖像複雜度超過此值時，將其視為複雜圖像
   */
  complexityThreshold: number;
  
  /**
   * 是否啟用自適應批量大小
   */
  enableAdaptiveBatching: boolean;
  
  /**
   * 是否啟用優先級排序
   */
  enablePrioritySort: boolean;
  
  /**
   * 優先處理的文件格式
   */
  priorityFormats: string[];
  
  /**
   * 最大並行工作數
   */
  maxParallelTasks: number;
}

/**
 * 默認自適應採樣配置
 */
export const DEFAULT_ADAPTIVE_SAMPLING_CONFIG: AdaptiveSamplingConfig = {
  baseBatchSize: 20,
  maxBatchSize: 50,
  minBatchSize: 5,
  memoryThreshold: 200, // MB
  complexityThreshold: 70,
  enableAdaptiveBatching: true,
  enablePrioritySort: true,
  priorityFormats: ["heic", "raw", "tiff", "png"],
  maxParallelTasks: 4
};

/**
 * 記憶體使用信息
 */
export interface MemoryUsage {
  /**
   * 總記憶體 (MB)
   */
  total: number;
  
  /**
   * 已使用記憶體 (MB)
   */
  used: number;
  
  /**
   * 可用記憶體 (MB)
   */
  available: number;
  
  /**
   * 瀏覽器限制 (MB)
   */
  limit: number;
}

/**
 * 自適應採樣策略
 * 根據圖像複雜性和系統資源動態調整處理順序和批量大小
 */
export class AdaptiveSampling {
  private config: AdaptiveSamplingConfig;
  private imageComplexityMap: Map<string, ImageComplexity> = new Map();
  private processingQueue: string[] = [];
  private processingBatches: string[][] = [];
  private currentBatchSize: number;
  private processingStats: {
    processedCount: number;
    totalProcessingTime: number;
    averageProcessingTime: number;
    batchHistory: number[];
  };
  
  /**
   * 創建自適應採樣策略
   * @param config 採樣配置
   */
  constructor(config: Partial<AdaptiveSamplingConfig> = {}) {
    this.config = { ...DEFAULT_ADAPTIVE_SAMPLING_CONFIG, ...config };
    this.currentBatchSize = this.config.baseBatchSize;
    this.processingStats = {
      processedCount: 0,
      totalProcessingTime: 0,
      averageProcessingTime: 0,
      batchHistory: []
    };
  }
  
  /**
   * 估計圖像複雜性
   * @param photo 照片文件
   * @returns 複雜性指標
   */
  private async estimateComplexity(photo: PhotoFile): Promise<ImageComplexity> {
    // 基本複雜性估計
    const fileSize = photo.file.size;
    const format = photo.file.name.split('.').pop()?.toLowerCase() || '';
    let priority = 5; // 默認優先級
    const features: string[] = [];
    
    // 根據文件大小調整複雜性
    if (fileSize > 10 * 1024 * 1024) { // > 10MB
      priority -= 2;
      features.push('largeSize');
    } else if (fileSize < 100 * 1024) { // < 100KB
      priority += 1;
      features.push('smallSize');
    }
    
    // 根據格式調整優先級
    if (this.config.priorityFormats.includes(format)) {
      priority += 2;
      features.push('priorityFormat');
    }
    
    // 讀取圖像尺寸和顏色數量 (異步)
    let dimensions;
    let colorCount;
    let visualComplexity = 50; // 默認值
    
    try {
      // 創建圖像並加載
      const img = new Image();
      const loadPromise = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(photo.file);
      });
      
      // 等待圖像加載
      await loadPromise;
      
      dimensions = { width: img.width, height: img.height };
      
      // 計算圖像尺寸的複雜性影響
      const pixelCount = img.width * img.height;
      if (pixelCount > 4000 * 3000) { // > 12MP
        priority -= 1;
        features.push('highResolution');
        visualComplexity += 10;
      }
      
      // 估計視覺複雜性和顏色數量（使用簡化採樣）
      const { complexity, colors } = await this.estimateVisualComplexity(img);
      visualComplexity = complexity;
      colorCount = colors;
      
      // 清理
      URL.revokeObjectURL(img.src);
    } catch (error) {
      console.warn('無法分析圖像:', error);
    }
    
    // 根據視覺複雜性調整優先級
    if (visualComplexity > this.config.complexityThreshold) {
      priority -= 1;
      features.push('highComplexity');
    }
    
    // 估計處理時間 (毫秒)
    const estimatedProcessingTime = this.estimateProcessingTime(fileSize, visualComplexity, format);
    
    return {
      id: photo.id,
      fileSize,
      dimensions,
      format,
      visualComplexity,
      colorCount,
      priority,
      features,
      estimatedProcessingTime
    };
  }
  
  /**
   * 估計圖像的視覺複雜性和顏色數量
   * @param img 圖像元素
   * @returns 複雜性得分和顏色數量
   */
  private async estimateVisualComplexity(img: HTMLImageElement): Promise<{
    complexity: number;
    colors: number;
  }> {
    // 創建畫布並繪製圖像
    const canvas = document.createElement('canvas');
    const maxSampleSize = 200; // 限制採樣大小以提高性能
    
    // 計算採樣尺寸
    const sampleWidth = Math.min(img.width, maxSampleSize);
    const sampleHeight = Math.min(img.height, maxSampleSize);
    const scaleFactor = Math.min(sampleWidth / img.width, sampleHeight / img.height);
    
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return { complexity: 50, colors: 0 };
    
    ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, sampleWidth, sampleHeight);
    
    // 獲取像素數據
    const imageData = ctx.getImageData(0, 0, sampleWidth, sampleHeight);
    const data = imageData.data;
    
    // 計算邊緣和顏色統計
    let edgeCount = 0;
    const colorMap = new Map<string, number>();
    
    for (let y = 1; y < sampleHeight - 1; y++) {
      for (let x = 1; x < sampleWidth - 1; x++) {
        const idx = (y * sampleWidth + x) * 4;
        const prevRowIdx = ((y - 1) * sampleWidth + x) * 4;
        const nextColIdx = (y * sampleWidth + (x + 1)) * 4;
        
        // 簡化的邊緣檢測 (相鄰像素差異)
        const rDiff = Math.abs(data[idx] - data[prevRowIdx]);
        const gDiff = Math.abs(data[idx + 1] - data[prevRowIdx + 1]);
        const bDiff = Math.abs(data[idx + 2] - data[prevRowIdx + 2]);
        
        const hDiff = Math.abs(data[idx] - data[nextColIdx]);
        const vDiff = Math.abs(data[idx + 1] - data[nextColIdx + 1]);
        const dDiff = Math.abs(data[idx + 2] - data[nextColIdx + 2]);
        
        const diff = (rDiff + gDiff + bDiff + hDiff + vDiff + dDiff) / 6;
        
        if (diff > 20) {
          edgeCount++;
        }
        
        // 顏色統計 (按桶分組以減少總數)
        const r = Math.floor(data[idx] / 16) * 16;
        const g = Math.floor(data[idx + 1] / 16) * 16;
        const b = Math.floor(data[idx + 2] / 16) * 16;
        const colorKey = `${r},${g},${b}`;
        
        colorMap.set(colorKey, (colorMap.get(colorKey) || 0) + 1);
      }
    }
    
    // 計算複雜性得分 (0-100)
    const pixelCount = sampleWidth * sampleHeight;
    const edgeRatio = edgeCount / pixelCount;
    const uniqueColors = colorMap.size;
    
    // 複雜性公式：邊緣比例 (70%) + 顏色多樣性 (30%)
    const maxExpectedColors = 256; // 預期的最大顏色數
    const normalizedColors = Math.min(uniqueColors / maxExpectedColors, 1);
    
    const complexity = Math.min(
      Math.round((edgeRatio * 70 + normalizedColors * 30) * 100),
      100
    );
    
    return {
      complexity,
      colors: uniqueColors
    };
  }
  
  /**
   * 估計處理時間
   * @param fileSize 文件大小 (位元組)
   * @param complexity 複雜度得分 (0-100)
   * @param format 文件格式
   * @returns 估計的處理時間 (毫秒)
   */
  private estimateProcessingTime(
    fileSize: number,
    complexity: number,
    format: string
  ): number {
    // 基本處理時間，根據文件大小
    let baseTime = fileSize / 1024 / 10; // 每 10KB 大約 1ms
    
    // 根據複雜度調整
    const complexityFactor = 0.5 + (complexity / 100) * 1.5; // 0.5 - 2.0
    
    // 特殊格式的額外處理時間
    const formatFactors: Record<string, number> = {
      'heic': 3.0,
      'raw': 4.0,
      'tiff': 2.0,
      'gif': 1.5
    };
    
    const formatFactor = formatFactors[format] || 1.0;
    
    // 計算最終估計時間
    const estimatedTime = baseTime * complexityFactor * formatFactor;
    
    return Math.max(50, Math.min(10000, Math.round(estimatedTime)));
  }
  
  /**
   * 獲取當前記憶體使用情況
   * @returns 記憶體使用信息
   */
  private getMemoryUsage(): MemoryUsage {
    // 獲取記憶體使用（如果可用）
    const memory = (performance as any).memory;
    const jsHeapSizeLimit = memory?.jsHeapSizeLimit || 2147483648; // 默認 2GB
    const usedJSHeapSize = memory?.usedJSHeapSize || 0;
    const totalJSHeapSize = memory?.totalJSHeapSize || 0;
    
    return {
      total: totalJSHeapSize / (1024 * 1024), // MB
      used: usedJSHeapSize / (1024 * 1024), // MB
      available: (jsHeapSizeLimit - usedJSHeapSize) / (1024 * 1024), // MB
      limit: jsHeapSizeLimit / (1024 * 1024) // MB
    };
  }
  
  /**
   * 調整批量大小
   */
  private adjustBatchSize(): void {
    if (!this.config.enableAdaptiveBatching) {
      this.currentBatchSize = this.config.baseBatchSize;
      return;
    }
    
    // 獲取記憶體使用
    const memory = this.getMemoryUsage();
    
    // 根據可用記憶體調整
    if (memory.available < this.config.memoryThreshold) {
      this.currentBatchSize = Math.max(
        this.config.minBatchSize,
        this.currentBatchSize * 0.8
      );
    } else if (memory.available > this.config.memoryThreshold * 2) {
      this.currentBatchSize = Math.min(
        this.config.maxBatchSize,
        this.currentBatchSize * 1.2
      );
    }
    
    // 根據平均處理時間調整
    if (this.processingStats.processedCount > 10) {
      const avgTime = this.processingStats.averageProcessingTime;
      
      if (avgTime > 500) {
        this.currentBatchSize = Math.max(
          this.config.minBatchSize,
          this.currentBatchSize * 0.9
        );
      } else if (avgTime < 100) {
        this.currentBatchSize = Math.min(
          this.config.maxBatchSize,
          this.currentBatchSize * 1.1
        );
      }
    }
    
    // 記錄批量大小歷史
    this.processingStats.batchHistory.push(this.currentBatchSize);
    if (this.processingStats.batchHistory.length > 10) {
      this.processingStats.batchHistory.shift();
    }
    
    // 整數化批量大小
    this.currentBatchSize = Math.round(this.currentBatchSize);
  }
  
  /**
   * 對圖像進行優先級排序
   * @param photos 照片文件數組
   */
  public async prioritize(photos: PhotoFile[]): Promise<void> {
    // 估計每張照片的複雜性
    const complexityPromises = photos.map(async (photo) => {
      const complexity = await this.estimateComplexity(photo);
      this.imageComplexityMap.set(photo.id, complexity);
      return complexity;
    });
    
    await Promise.all(complexityPromises);
    
    // 根據優先級和複雜性排序
    this.processingQueue = photos
      .map(photo => photo.id)
      .sort((a, b) => {
        const complexityA = this.imageComplexityMap.get(a);
        const complexityB = this.imageComplexityMap.get(b);
        
        if (!complexityA || !complexityB) return 0;
        
        // 優先級高的排前面
        if (complexityA.priority !== complexityB.priority) {
          return complexityB.priority - complexityA.priority;
        }
        
        // 處理時間短的排前面
        return (complexityA.estimatedProcessingTime || 0) - (complexityB.estimatedProcessingTime || 0);
      });
    
    // 將隊列分成批次
    this.adjustBatchSize();
    this.createBatches();
  }
  
  /**
   * 創建處理批次
   */
  private createBatches(): void {
    this.processingBatches = [];
    
    // 將隊列分成批次
    for (let i = 0; i < this.processingQueue.length; i += this.currentBatchSize) {
      const batch = this.processingQueue.slice(i, i + this.currentBatchSize);
      this.processingBatches.push(batch);
    }
    
    // 平衡批次的複雜性
    this.balanceBatchComplexity();
  }
  
  /**
   * 平衡批次的複雜性
   */
  private balanceBatchComplexity(): void {
    if (this.processingBatches.length <= 1) return;
    
    // 計算每個批次的總複雜性
    const batchComplexity: number[] = this.processingBatches.map(batch => {
      return batch.reduce((sum, id) => {
        const complexity = this.imageComplexityMap.get(id);
        return sum + (complexity?.estimatedProcessingTime || 100);
      }, 0);
    });
    
    // 將複雜圖像分散到不同批次
    for (let i = 0; i < 3; i++) { // 進行多次迭代
      // 找出最不平衡的兩個批次
      let maxIdx = 0;
      let minIdx = 0;
      
      for (let j = 1; j < batchComplexity.length; j++) {
        if (batchComplexity[j] > batchComplexity[maxIdx]) {
          maxIdx = j;
        }
        if (batchComplexity[j] < batchComplexity[minIdx]) {
          minIdx = j;
        }
      }
      
      // 如果差異不大，停止平衡
      if (batchComplexity[maxIdx] < batchComplexity[minIdx] * 1.3) {
        break;
      }
      
      // 從複雜性最高的批次移動一個複雜項目到複雜性最低的批次
      const maxBatch = this.processingBatches[maxIdx];
      const minBatch = this.processingBatches[minIdx];
      
      // 找到最複雜的項目
      let maxItemIdx = -1;
      let maxItemComplexity = 0;
      
      for (let j = 0; j < maxBatch.length; j++) {
        const complexity = this.imageComplexityMap.get(maxBatch[j]);
        const processingTime = complexity?.estimatedProcessingTime || 0;
        
        if (processingTime > maxItemComplexity) {
          maxItemComplexity = processingTime;
          maxItemIdx = j;
        }
      }
      
      // 移動項目
      if (maxItemIdx >= 0) {
        const item = maxBatch[maxItemIdx];
        maxBatch.splice(maxItemIdx, 1);
        minBatch.push(item);
        
        // 更新複雜性
        batchComplexity[maxIdx] -= maxItemComplexity;
        batchComplexity[minIdx] += maxItemComplexity;
      }
    }
  }
  
  /**
   * 獲取下一批處理項目
   * @returns 下一批項目 ID
   */
  public getNextBatch(): string[] {
    if (this.processingBatches.length === 0) {
      return [];
    }
    
    // 取出下一批
    const batch = this.processingBatches.shift() || [];
    
    // 調整下一批的批量大小
    this.adjustBatchSize();
    
    return batch;
  }
  
  /**
   * 報告處理完成
   * @param photoIds 已處理的照片 ID
   * @param processingTime 處理時間 (毫秒)
   */
  public reportProcessingComplete(photoIds: string[], processingTime: number): void {
    // 更新處理統計
    this.processingStats.processedCount += photoIds.length;
    this.processingStats.totalProcessingTime += processingTime;
    this.processingStats.averageProcessingTime = 
      this.processingStats.totalProcessingTime / this.processingStats.processedCount;
    
    // 移除已處理的項目
    for (const id of photoIds) {
      const index = this.processingQueue.indexOf(id);
      if (index >= 0) {
        this.processingQueue.splice(index, 1);
      }
    }
  }
  
  /**
   * 獲取剩餘的待處理項目數量
   * @returns 剩餘項目數
   */
  public getRemainingCount(): number {
    return this.processingQueue.length;
  }
  
  /**
   * 獲取批次數量
   * @returns 批次數
   */
  public getBatchCount(): number {
    return this.processingBatches.length;
  }
  
  /**
   * 獲取當前批量大小
   * @returns 批量大小
   */
  public getCurrentBatchSize(): number {
    return this.currentBatchSize;
  }
  
  /**
   * 獲取處理統計
   * @returns 處理統計
   */
  public getProcessingStats(): {
    processedCount: number;
    totalProcessingTime: number;
    averageProcessingTime: number;
    batchSizes: number[];
  } {
    return {
      processedCount: this.processingStats.processedCount,
      totalProcessingTime: this.processingStats.totalProcessingTime,
      averageProcessingTime: this.processingStats.averageProcessingTime,
      batchSizes: [...this.processingStats.batchHistory]
    };
  }
  
  /**
   * 重置處理隊列
   */
  public reset(): void {
    this.processingQueue = [];
    this.processingBatches = [];
    this.currentBatchSize = this.config.baseBatchSize;
    this.imageComplexityMap.clear();
    this.processingStats = {
      processedCount: 0,
      totalProcessingTime: 0,
      averageProcessingTime: 0,
      batchHistory: []
    };
  }
  
  /**
   * 獲取圖像複雜性
   * @param photoId 照片 ID
   * @returns 複雜性指標，如果不存在則返回 undefined
   */
  public getImageComplexity(photoId: string): ImageComplexity | undefined {
    return this.imageComplexityMap.get(photoId);
  }
  
  /**
   * 獲取所有圖像的複雜性
   * @returns 圖像複雜性映射
   */
  public getAllImageComplexity(): Map<string, ImageComplexity> {
    return new Map(this.imageComplexityMap);
  }
  
  /**
   * 設置自適應採樣配置
   * @param config 部分配置
   */
  public setConfig(config: Partial<AdaptiveSamplingConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * 獲取自適應採樣配置
   * @returns 當前配置
   */
  public getConfig(): AdaptiveSamplingConfig {
    return { ...this.config };
  }
}

/**
 * 創建自適應採樣策略
 * @param config 採樣配置
 * @returns 自適應採樣策略
 */
export function createAdaptiveSampling(config?: Partial<AdaptiveSamplingConfig>): AdaptiveSampling {
  return new AdaptiveSampling(config);
} 