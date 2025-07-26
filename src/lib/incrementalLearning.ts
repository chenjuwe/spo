/**
 * 增量特徵學習與索引系統
 * 支持增量特徵學習和高效特徵索引結構
 * 
 * 該模塊實現了增量式特徵學習和索引系統，用於高效管理和檢索圖像特徵。
 * 系統使用 KD 樹結構來索引多維特徵向量，並支持增量更新和維護。
 * 
 * @module incrementalLearning
 */

import { errorHandler, ErrorType } from "./errorHandlingService";
import { PhotoFile } from "./types";
import { MultiLevelFeature, FeatureLevel } from "./multiLevelFeatureFusion";
import { EnhancedImageSimilaritySystem } from "./enhancedImageSimilarity";

/**
 * 檢查 SharedArrayBuffer 是否可用
 * 
 * @returns SharedArrayBuffer 是否可用並且啟用了跨源隔離
 */
export function isSharedArrayBufferAvailable(): boolean {
  return typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated === true;
}

/**
 * 增量索引配置
 * 用於設定增量特徵索引的運行參數
 */
export interface IncrementalIndexConfig {
  /**
   * 增量更新閾值
   * 當新增照片數量達到此閾值時，觸發索引更新
   */
  incrementalThreshold: number;
  
  /**
   * 重建閾值
   * 當增量更新次數達到此閾值時，觸發完全重建
   */
  rebuildThreshold: number;
  
  /**
   * 壓縮比例
   * 用於壓縮特徵向量以節省內存，值域 0-1
   */
  compressionRatio: number;
  
  /**
   * GC 間隔 (毫秒)
   * 垃圾回收間隔時間
   */
  gcInterval: number;

  /**
   * 使用 SharedArrayBuffer
   * 是否使用 SharedArrayBuffer 優化數據傳輸
   */
  useSharedArrayBuffer: boolean;

  /**
   * Worker 池配置
   * 控制 Worker 池的大小和行為
   */
  workerPoolConfig?: {
    /**
     * 最小 Worker 數量
     */
    minWorkers: number;
    
    /**
     * 最大 Worker 數量
     */
    maxWorkers: number;
    
    /**
     * Worker 閒置超時（毫秒）
     * 超過此時間的閒置 Worker 將被釋放（不低於最小數量）
     */
    idleTimeout: number;
  };
}

/**
 * 預設增量索引配置
 */
export const DEFAULT_INCREMENTAL_INDEX_CONFIG: IncrementalIndexConfig = {
  incrementalThreshold: 50,
  rebuildThreshold: 5,
  compressionRatio: 0.8,
  gcInterval: 60000 * 10, // 10分鐘
  useSharedArrayBuffer: isSharedArrayBufferAvailable(),
  workerPoolConfig: {
    minWorkers: 2,
    maxWorkers: navigator.hardwareConcurrency || 4,
    idleTimeout: 60000 // 1分鐘
  }
};

/**
 * 特徵點
 * 表示特徵向量及其元數據
 */
export interface FeaturePoint {
  /**
   * 照片ID
   */
  id: string;
  
  /**
   * 特徵向量
   * 該向量可能是壓縮過的
   */
  vector: number[];
  
  /**
   * 特徵級別
   * 指示該特徵來自哪一級別的特徵提取
   */
  level: FeatureLevel;
  
  /**
   * 最後更新時間
   * 用於垃圾回收策略
   */
  lastUpdated: number;
  
  /**
   * 訪問次數
   * 用於垃圾回收策略
   */
  accessCount: number;

  /**
   * 緩衝區引用
   * 用於 SharedArrayBuffer 優化
   */
  bufferRef?: {
    buffer: SharedArrayBuffer | ArrayBuffer;
    byteOffset: number;
    length: number;
  };
}

/**
 * KD-Tree節點
 * 用於快速檢索多維向量
 */
export interface KDTreeNode {
  /**
   * 節點中的特徵點
   */
  point: FeaturePoint;
  
  /**
   * 分割維度
   * 指示該節點在哪個維度上分割數據
   */
  dimension: number;
  
  /**
   * 左子樹
   */
  left: KDTreeNode | null;
  
  /**
   * 右子樹
   */
  right: KDTreeNode | null;
}

/**
 * 增量學習結果
 * 表示一次增量學習的統計信息
 */
export interface IncrementalLearningResult {
  /**
   * 新增特徵數量
   */
  addedFeatures: number;
  
  /**
   * 更新特徵數量
   */
  updatedFeatures: number;
  
  /**
   * 索引時間 (毫秒)
   */
  indexingTime: number;
  
  /**
   * 是否進行了完全重建
   */
  fullRebuild: boolean;
  
  /**
   * 當前索引大小
   */
  currentIndexSize: number;
}

/**
 * 搜索結果
 * 包含相似度匹配結果
 */
export interface SearchResult {
  /**
   * 相似照片的 ID
   */
  id: string;
  
  /**
   * 相似度得分 (0-1)
   * 1 表示完全匹配，0 表示完全不同
   */
  similarity: number;
  
  /**
   * 特徵級別
   * 指示匹配是基於哪一級別的特徵
   */
  level: FeatureLevel;
  
  /**
   * 距離
   * 特徵向量之間的歐氏距離
   */
  distance: number;
}

/**
 * 搜索選項
 * 用於配置搜索行為
 */
export interface SearchOptions {
  /**
   * 搜索的特徵級別
   * 默認為全部級別
   */
  level?: FeatureLevel | 'ALL';
  
  /**
   * 搜索結果數量限制
   */
  limit?: number;
  
  /**
   * 相似度閾值 (0-1)
   * 只返回相似度高於此閾值的結果
   */
  threshold?: number;
}

/**
 * 增量特徵索引類
 * 
 * 該類負責管理和索引照片特徵，支持增量學習和高效檢索。
 * 使用 KD 樹結構來組織特徵向量，並提供增量更新和垃圾回收機制。
 * 
 * @example
 * ```typescript
 * // 創建索引實例
 * const featureIndex = new IncrementalFeatureIndex();
 * 
 * // 設置相似度系統
 * featureIndex.setSimilaritySystem(similaritySystem);
 * 
 * // 添加照片特徵
 * const result = await featureIndex.addOrUpdateFeatures(photos);
 * console.log(`Added ${result.addedFeatures} features, updated ${result.updatedFeatures} features`);
 * ```
 */
export class IncrementalFeatureIndex {
  /**
   * 索引配置
   */
  private config: IncrementalIndexConfig;
  
  /**
   * KD 樹根節點
   */
  private root: KDTreeNode | null = null;
  
  /**
   * 特徵映射
   * 快速訪問特定特徵點的查找表
   */
  private featureMap: Map<string, FeaturePoint> = new Map();
  
  /**
   * 增量計數器
   * 記錄自上次索引更新後新增的照片數量
   */
  private incrementalCount: number = 0;
  
  /**
   * 重建計數器
   * 記錄增量更新次數，用於觸發完全重建
   */
  private rebuildCount: number = 0;
  
  /**
   * 相似度系統
   * 用於提取照片特徵
   */
  private similaritySystem: EnhancedImageSimilaritySystem | null = null;
  
  /**
   * 最後垃圾回收時間
   */
  private lastGCTime: number = 0;
  
  /**
   * 更新隊列
   * 存儲等待處理的特徵點 ID
   */
  private updateQueue: string[] = [];
  
  /**
   * 是否正在建構索引
   * 用於防止並發操作
   */
  private building: boolean = false;
  
  /**
   * 共享緩衝池
   * 用於 SharedArrayBuffer 優化
   */
  private sharedBufferPool: SharedArrayBuffer[] = [];

  /**
   * 緩衝區分配表
   * 追蹤 SharedArrayBuffer 的使用情況
   */
  private bufferAllocationMap: Map<SharedArrayBuffer, {
    allocations: { offset: number, length: number, inUse: boolean }[]
  }> = new Map();

  /**
   * 創建增量特徵索引
   * @param config 索引配置，可選，默認使用 DEFAULT_INCREMENTAL_INDEX_CONFIG
   */
  constructor(config: Partial<IncrementalIndexConfig> = {}) {
    this.config = { ...DEFAULT_INCREMENTAL_INDEX_CONFIG, ...config };
    
    // 如果瀏覽器不支援 SharedArrayBuffer，強制關閉相關功能
    if (!isSharedArrayBufferAvailable()) {
      this.config.useSharedArrayBuffer = false;
    }

    // 初始化共享緩衝池（如果啟用）
    if (this.config.useSharedArrayBuffer) {
      this.initSharedBufferPool();
    }
  }
  
  /**
   * 設置相似度系統
   * 必須在使用索引前調用此方法
   * 
   * @param system 增強相似度系統
   */
  public setSimilaritySystem(system: EnhancedImageSimilaritySystem): void {
    this.similaritySystem = system;
  }

  /**
   * 初始化共享緩衝池
   * 創建用於特徵向量的共享內存池
   */
  private initSharedBufferPool(): void {
    try {
      // 創建一個 32MB 的共享緩衝區
      const buffer = new SharedArrayBuffer(32 * 1024 * 1024);
      this.sharedBufferPool.push(buffer);
      this.bufferAllocationMap.set(buffer, { allocations: [] });
      console.info('已初始化共享緩衝池');
    } catch (error) {
      console.error('初始化共享緩衝池失敗:', error);
      this.config.useSharedArrayBuffer = false;
    }
  }

  /**
   * 分配共享緩衝區
   * 為特徵向量分配共享內存空間
   * 
   * @param byteLength 所需字節數
   * @returns 緩衝區引用，如果分配失敗則返回 null
   */
  private allocateSharedBuffer(byteLength: number): { 
    buffer: SharedArrayBuffer, 
    byteOffset: number, 
    length: number 
  } | null {
    if (!this.config.useSharedArrayBuffer || this.sharedBufferPool.length === 0) {
      return null;
    }

    // 先嘗試查找現有緩衝區中的可用空間
    for (const buffer of this.sharedBufferPool) {
      const allocInfo = this.bufferAllocationMap.get(buffer);
      if (!allocInfo) continue;

      // 查找可用空間
      let startOffset = 0;
      for (const alloc of [...allocInfo.allocations].sort((a, b) => a.offset - b.offset)) {
        // 檢查當前位置和下一個已分配區間之間是否有足夠空間
        if (alloc.offset - startOffset >= byteLength) {
          // 有足夠空間
          const newAlloc = { offset: startOffset, length: byteLength, inUse: true };
          allocInfo.allocations.push(newAlloc);
          return { 
            buffer, 
            byteOffset: startOffset, 
            length: byteLength 
          };
        }
        startOffset = alloc.offset + alloc.length;
      }

      // 檢查末尾是否有足夠空間
      const bufferEnd = buffer.byteLength;
      if (bufferEnd - startOffset >= byteLength) {
        const newAlloc = { offset: startOffset, length: byteLength, inUse: true };
        allocInfo.allocations.push(newAlloc);
        return { 
          buffer, 
          byteOffset: startOffset, 
          length: byteLength 
        };
      }
    }

    // 沒有足夠空間，創建新緩衝區
    try {
      // 創建新的共享緩衝區，大小為請求字節數的兩倍或 16MB，取較大者
      const newBufferSize = Math.max(byteLength * 2, 16 * 1024 * 1024);
      const buffer = new SharedArrayBuffer(newBufferSize);
      this.sharedBufferPool.push(buffer);
      
      const newAlloc = { offset: 0, length: byteLength, inUse: true };
      this.bufferAllocationMap.set(buffer, { allocations: [newAlloc] });
      
      return { 
        buffer, 
        byteOffset: 0, 
        length: byteLength 
      };
    } catch (error) {
      console.error('創建新共享緩衝區失敗:', error);
      return null;
    }
  }

  /**
   * 釋放共享緩衝區
   * 釋放不再使用的共享內存空間
   * 
   * @param bufferRef 緩衝區引用
   */
  private freeSharedBuffer(bufferRef: { buffer: SharedArrayBuffer, byteOffset: number, length: number }): void {
    if (!this.config.useSharedArrayBuffer) return;

    const allocInfo = this.bufferAllocationMap.get(bufferRef.buffer);
    if (!allocInfo) return;

    // 尋找並標記為未使用
    const alloc = allocInfo.allocations.find(a => 
      a.offset === bufferRef.byteOffset && a.length === bufferRef.length);
    
    if (alloc) {
      alloc.inUse = false;
    }

    // 執行簡單合併，將相鄰的未使用塊合併
    this.compactBufferAllocations(bufferRef.buffer);
  }

  /**
   * 整理緩衝區分配
   * 合併相鄰的未使用內存塊
   * 
   * @param buffer 要整理的緩衝區
   */
  private compactBufferAllocations(buffer: SharedArrayBuffer): void {
    const allocInfo = this.bufferAllocationMap.get(buffer);
    if (!allocInfo || allocInfo.allocations.length === 0) return;

    // 按偏移量排序
    allocInfo.allocations.sort((a, b) => a.offset - b.offset);

    // 合併相鄰的未使用塊
    for (let i = 0; i < allocInfo.allocations.length - 1; i++) {
      const current = allocInfo.allocations[i];
      const next = allocInfo.allocations[i + 1];
      
      if (!current.inUse && !next.inUse && current.offset + current.length === next.offset) {
        // 合併兩個塊
        current.length += next.length;
        allocInfo.allocations.splice(i + 1, 1);
        i--; // 重新檢查當前位置
      }
    }
    
    // 檢查是否所有塊都未使用，可以完全釋放緩衝區
    const allFree = allocInfo.allocations.every(a => !a.inUse);
    if (allFree && this.sharedBufferPool.length > 1) {
      // 從緩衝池移除緩衝區
      const bufferIndex = this.sharedBufferPool.indexOf(buffer);
      if (bufferIndex !== -1) {
        this.sharedBufferPool.splice(bufferIndex, 1);
        this.bufferAllocationMap.delete(buffer);
        console.info('釋放了整個共享緩衝區');
      }
    }
  }

  /**
   * 釋放所有未使用的共享緩衝區
   * 主動清理未使用的記憶體
   */
  public cleanupUnusedBuffers(): void {
    if (!this.config.useSharedArrayBuffer) return;

    for (const buffer of [...this.sharedBufferPool]) {
      const allocInfo = this.bufferAllocationMap.get(buffer);
      if (!allocInfo) continue;

      // 檢查是否所有塊都未使用
      const allFree = allocInfo.allocations.every(a => !a.inUse);
      if (allFree && this.sharedBufferPool.length > 1) {
        // 從緩衝池移除緩衝區
        const bufferIndex = this.sharedBufferPool.indexOf(buffer);
        if (bufferIndex !== -1) {
          this.sharedBufferPool.splice(bufferIndex, 1);
          this.bufferAllocationMap.delete(buffer);
        }
      }
    }
    
    console.info(`記憶體清理完成，當前共享緩衝區數量: ${this.sharedBufferPool.length}`);
  }

  /**
   * 將特徵向量轉移到共享緩衝區
   * 
   * @param vector 特徵向量
   * @returns 緩衝區引用，如果轉移失敗則返回 null
   */
  private transferVectorToSharedBuffer(vector: number[]): { 
    buffer: SharedArrayBuffer | ArrayBuffer, 
    byteOffset: number, 
    length: number 
  } | null {
    if (!this.config.useSharedArrayBuffer || vector.length === 0) {
      return null;
    }

    const byteLength = vector.length * Float32Array.BYTES_PER_ELEMENT;
    const bufferRef = this.allocateSharedBuffer(byteLength);
    
    if (!bufferRef) {
      return null;
    }

    // 複製數據到共享緩衝區
    const sharedArray = new Float32Array(
      bufferRef.buffer, 
      bufferRef.byteOffset, 
      vector.length
    );
    
    for (let i = 0; i < vector.length; i++) {
      sharedArray[i] = vector[i];
    }

    return bufferRef;
  }

  /**
   * 從共享緩衝區讀取向量
   * 
   * @param bufferRef 緩衝區引用
   * @returns 特徵向量
   */
  private readVectorFromSharedBuffer(bufferRef: { 
    buffer: SharedArrayBuffer | ArrayBuffer, 
    byteOffset: number, 
    length: number 
  }): number[] {
    const vectorLength = bufferRef.length / Float32Array.BYTES_PER_ELEMENT;
    const sharedArray = new Float32Array(
      bufferRef.buffer,
      bufferRef.byteOffset,
      vectorLength
    );
    
    // 複製到普通數組
    return Array.from(sharedArray);
  }
  
  /**
   * 從多級特徵創建特徵點
   * 將 MultiLevelFeature 轉換為 FeaturePoint 數組
   * 
   * @param id 照片ID
   * @param feature 多級特徵
   * @returns 特徵點數組 (不同級別)
   */
  private createFeaturePointsFromMultiLevel(
    id: string,
    feature: MultiLevelFeature
  ): FeaturePoint[] {
    const result: FeaturePoint[] = [];
    const now = Date.now();
    
    // 高級特徵 (深度學習模型提取的特徵)
    if (feature.highLevelFeatures) {
      // 使用並行壓縮特徵向量
      const vector = this.compressVector(feature.highLevelFeatures);
      
      const point: FeaturePoint = {
        id,
        vector,
        level: FeatureLevel.HIGH,
        lastUpdated: now,
        accessCount: 0
      };

      // 如果啟用 SharedArrayBuffer，嘗試將向量轉移到共享緩衝區
      if (this.config.useSharedArrayBuffer) {
        const bufferRef = this.transferVectorToSharedBuffer(vector);
        if (bufferRef) {
          point.bufferRef = bufferRef;
        }
      }
      
      result.push(point);
    }
    
    // 中級特徵 (紋理和顏色特徵)
    if (feature.midLevelFeatures) {
      // 將中級特徵轉換為向量
      const midVector = this.midLevelToVector(feature.midLevelFeatures);
      const vector = this.compressVector(midVector);
      
      const point: FeaturePoint = {
        id,
        vector,
        level: FeatureLevel.MID,
        lastUpdated: now,
        accessCount: 0
      };

      // 如果啟用 SharedArrayBuffer，嘗試將向量轉移到共享緩衝區
      if (this.config.useSharedArrayBuffer) {
        const bufferRef = this.transferVectorToSharedBuffer(vector);
        if (bufferRef) {
          point.bufferRef = bufferRef;
        }
      }
      
      result.push(point);
    }
    
    // 低級特徵 (哈希和基本特徵)
    if (feature.lowLevelFeatures) {
      // 轉換哈希為特徵向量
      const hashVector = this.hashToVector(feature.lowLevelFeatures);
      const vector = this.compressVector(hashVector);
      
      const point: FeaturePoint = {
        id,
        vector,
        level: FeatureLevel.LOW,
        lastUpdated: now,
        accessCount: 0
      };

      // 如果啟用 SharedArrayBuffer，嘗試將向量轉移到共享緩衝區
      if (this.config.useSharedArrayBuffer) {
        const bufferRef = this.transferVectorToSharedBuffer(vector);
        if (bufferRef) {
          point.bufferRef = bufferRef;
        }
      }
      
      result.push(point);
    }
    
    return result;
  }
  
  /**
   * 將中級特徵轉換為向量
   * @param midLevelFeatures 中級特徵
   * @returns 特徵向量
   */
  private midLevelToVector(midLevelFeatures: { colorHistogram?: number[], textureFeatures?: number[] }): number[] {
    const vector: number[] = [];
    
    // 添加顏色直方圖
    if (midLevelFeatures.colorHistogram) {
      vector.push(...midLevelFeatures.colorHistogram);
    }
    
    // 添加紋理特徵
    if (midLevelFeatures.textureFeatures) {
      vector.push(...midLevelFeatures.textureFeatures);
    }
    
    return vector;
  }
  
  /**
   * 將哈希結果轉換為特徵向量
   * 將哈希字符串轉換為數值向量以便索引
   * 
   * @param hashResult 哈希結果
   * @returns 特徵向量
   */
  private hashToVector(hashResult: any): number[] {
    // 從哈希提取特徵
    const vector: number[] = [];
    
    // 處理 aHash (平均哈希)
    if (hashResult.aHash) {
      const aHashBits = this.hexToBits(hashResult.aHash);
      vector.push(...aHashBits.map(bit => bit ? 1 : -1));
    }
    
    // 處理 dHash (差分哈希)
    if (hashResult.dHash) {
      const dHashBits = this.hexToBits(hashResult.dHash);
      vector.push(...dHashBits.map(bit => bit ? 1 : -1));
    }
    
    // 處理 pHash (感知哈希)
    if (hashResult.pHash) {
      const pHashBits = this.hexToBits(hashResult.pHash);
      vector.push(...pHashBits.map(bit => bit ? 1 : -1));
    }
    
    return vector;
  }
  
  /**
   * 將十六進制字符串轉換為位數組
   * @param hex 十六進制字符串
   * @returns 位數組
   */
  private hexToBits(hex: string): boolean[] {
    const bits: boolean[] = [];
    
    for (let i = 0; i < hex.length; i++) {
      const decimal = parseInt(hex[i], 16);
      
      // 轉換為4位二進制
      for (let j = 3; j >= 0; j--) {
        bits.push(((decimal >> j) & 1) === 1);
      }
    }
    
    return bits;
  }
  
  /**
   * 壓縮特徵向量
   * 使用自適應採樣的方式壓縮向量維度以節省內存
   * 
   * @param vector 特徵向量
   * @returns 壓縮後的向量
   */
  private compressVector(vector: number[]): number[] {
    if (this.config.compressionRatio >= 1) {
      return [...vector];
    }
    
    const targetLength = Math.max(
      16,
      Math.round(vector.length * this.config.compressionRatio)
    );
    
    // 如果壓縮比例小於1，使用自適應採樣壓縮
    if (vector.length <= targetLength) {
      return [...vector];
    }
    
    // 使用自適應採樣而非均勻採樣
    // 保留變化最大的部分，丟棄冗餘部分
    return this.adaptiveSampling(vector, targetLength);
  }
  
  /**
   * 自適應採樣
   * 基於梯度變化保留重要特徵，減少冗餘
   * 
   * @param vector 原始向量
   * @param targetLength 目標長度
   * @returns 採樣後的向量
   */
  private adaptiveSampling(vector: number[], targetLength: number): number[] {
    // 計算梯度（相鄰元素的差值）
    const gradients: {index: number, value: number}[] = [];
    for (let i = 0; i < vector.length - 1; i++) {
      gradients.push({
        index: i,
        value: Math.abs(vector[i+1] - vector[i])
      });
    }
    
    // 按梯度大小排序
    gradients.sort((a, b) => b.value - a.value);
    
    // 選擇變化最大的點作為關鍵點
    const keyIndices = gradients.slice(0, targetLength - 2).map(g => g.index);
    // 添加起點和終點
    keyIndices.push(0, vector.length - 1);
    // 排序索引
    keyIndices.sort((a, b) => a - b);
    
    // 移除相鄰過近的索引，確保採樣分布均勻
    const filteredIndices: number[] = [];
    const minDistance = Math.max(1, Math.floor(vector.length / targetLength / 2));
    
    for (let i = 0; i < keyIndices.length; i++) {
      if (i === 0 || keyIndices[i] - keyIndices[i-1] >= minDistance) {
        filteredIndices.push(keyIndices[i]);
      }
    }
    
    // 如果過濾後的索引不足，使用均勻採樣補充
    if (filteredIndices.length < targetLength) {
      const step = vector.length / (targetLength - filteredIndices.length);
      for (let i = 0; i < targetLength - filteredIndices.length; i++) {
        const index = Math.min(Math.floor(i * step), vector.length - 1);
        if (!filteredIndices.includes(index)) {
          filteredIndices.push(index);
        }
      }
      filteredIndices.sort((a, b) => a - b);
    }
    
    // 如果過濾後的索引過多，取前 targetLength 個
    const finalIndices = filteredIndices.slice(0, targetLength);
    finalIndices.sort((a, b) => a - b);
    
    // 生成結果向量
    const result = finalIndices.map(index => vector[index]);
    
    return result;
  }
  
  /**
   * 添加或更新照片特徵
   * 這是主要的公開方法，用於處理新照片或更新現有照片的特徵
   * 
   * @param photos 照片文件數組
   * @returns 更新結果，包含統計信息
   * @throws 如果未設置相似度系統，會拋出錯誤
   */
  public async addOrUpdateFeatures(photos: PhotoFile[]): Promise<IncrementalLearningResult> {
    if (!this.similaritySystem) {
      throw new Error('未設置相似度系統，無法提取特徵');
    }
    
    const startTime = performance.now();
    let addedCount = 0;
    let updatedCount = 0;
    let fullRebuild = false;
    
    try {
      // 使用Promise.all並行處理多張照片
      const processingPromises = photos.map(async (photo) => {
        try {
          // 確保 similaritySystem 不為空
          if (!this.similaritySystem) {
            console.error('相似度系統未初始化');
            return { added: 0, updated: 0 };
          }
          
          const feature = await this.similaritySystem.extractMultiLevelFeatures(photo);
          
          if (!feature) {
            console.warn(`無法從照片 ${photo.id} 提取特徵`);
            return { added: 0, updated: 0 };
          }
          
          const featurePoints = this.createFeaturePointsFromMultiLevel(photo.id, feature);
          let added = 0;
          let updated = 0;
          
          // 更新特徵映射
          for (const point of featurePoints) {
            const existing = this.featureMap.get(`${photo.id}:${point.level}`);
            
            if (existing) {
              // 更新現有特徵
              existing.vector = point.vector;
              existing.lastUpdated = point.lastUpdated;
              updated++;
            } else {
              // 添加新特徵
              this.featureMap.set(`${photo.id}:${point.level}`, point);
              added++;
              
              // 添加到更新隊列
              this.updateQueue.push(`${photo.id}:${point.level}`);
            }
          }
          
          return { added, updated };
        } catch (error) {
          console.error(`處理照片 ${photo.id} 時出錯:`, error);
          return { added: 0, updated: 0 };
        }
      });
      
      // 等待所有照片處理完成
      const results = await Promise.all(processingPromises);
      
      // 統計總數
      for (const result of results) {
        addedCount += result.added;
        updatedCount += result.updated;
      }
      
      // 檢查是否需要重建索引
      this.incrementalCount += photos.length;
      
      if (this.incrementalCount >= this.config.incrementalThreshold) {
        this.rebuildCount++;
        this.incrementalCount = 0;
        
        if (this.rebuildCount >= this.config.rebuildThreshold) {
          // 完全重建索引
          await this.rebuildIndex();
          this.rebuildCount = 0;
          fullRebuild = true;
        } else {
          // 增量更新索引
          await this.updateIndex();
        }
      } else if (this.updateQueue.length > 0) {
        // 只處理更新隊列中的項目
        await this.processUpdateQueue();
      }
      
      const endTime = performance.now();
      
      return {
        addedFeatures: addedCount,
        updatedFeatures: updatedCount,
        indexingTime: endTime - startTime,
        fullRebuild,
        currentIndexSize: this.featureMap.size
      };
    } catch (error) {
      errorHandler.handleError(
        error instanceof Error ? error : String(error),
        ErrorType.SYSTEM_ERROR,
        '增量特徵更新失敗',
        true
      );
      
      const endTime = performance.now();
      
      return {
        addedFeatures: addedCount,
        updatedFeatures: updatedCount,
        indexingTime: endTime - startTime,
        fullRebuild: false,
        currentIndexSize: this.featureMap.size
      };
    }
  }
  
  /**
   * 處理更新隊列
   * 處理等待索引的特徵點
   */
  private async processUpdateQueue(): Promise<void> {
    if (this.building || this.updateQueue.length === 0) {
      return;
    }
    
    this.building = true;
    
    try {
      // 獲取更新隊列中的所有點
      const points: FeaturePoint[] = [];
      
      for (const key of this.updateQueue) {
        const point = this.featureMap.get(key);
        if (point) {
          points.push(point);
        }
      }
      
      // 清空更新隊列
      this.updateQueue = [];
      
      // 增量更新索引
      if (points.length > 0) {
        for (const point of points) {
          this.insertPoint(point);
        }
      }
    } catch (error) {
      console.error('處理更新隊列失敗:', error);
    } finally {
      this.building = false;
    }
  }
  
  /**
   * 完全重建索引
   * 清除現有索引結構並重新構建
   */
  private async rebuildIndex(): Promise<void> {
    if (this.building) {
      return;
    }
    
    this.building = true;
    
    try {
      // 清除現有的索引
      this.root = null;
      
      // 獲取所有特徵點
      const points = [...this.featureMap.values()];
      
      // 構建KD樹
      if (points.length > 0) {
        this.root = this.buildKdTree(points);
      }
      
      console.info(`索引完全重建完成，包含 ${points.length} 個特徵點`);
    } catch (error) {
      console.error('重建索引失敗:', error);
    } finally {
      this.building = false;
    }
  }
  
  /**
   * 計算KD樹的高度
   * @param node KD樹節點
   * @returns 樹高度
   */
  private getTreeHeight(node: KDTreeNode | null): number {
    if (!node) {
      return 0;
    }
    
    const leftHeight = this.getTreeHeight(node.left);
    const rightHeight = this.getTreeHeight(node.right);
    
    return Math.max(leftHeight, rightHeight) + 1;
  }
  
  /**
   * 檢查KD樹是否平衡
   * 檢查左右子樹高度差是否超過閾值
   * 
   * @param node KD樹節點
   * @returns 是否平衡
   */
  private isBalanced(node: KDTreeNode | null): boolean {
    if (!node) {
      return true;
    }
    
    const leftHeight = this.getTreeHeight(node.left);
    const rightHeight = this.getTreeHeight(node.right);
    
    // 高度差不超過2視為平衡
    if (Math.abs(leftHeight - rightHeight) > 2) {
      return false;
    }
    
    // 遞歸檢查左右子樹
    return this.isBalanced(node.left) && this.isBalanced(node.right);
  }
  
  /**
   * 檢查並重建KD樹
   * 當樹不平衡時進行重建
   */
  private checkAndRebalanceTree(): void {
    if (!this.root) {
      return;
    }
    
    if (!this.isBalanced(this.root)) {
      console.info('KD樹不平衡，進行重建');
      
      // 收集所有點
      const points: FeaturePoint[] = [];
      this.collectPoints(this.root, points);
      
      // 重建樹
      this.root = this.buildKdTree(points);
      
      console.info('KD樹重建完成');
    }
  }
  
  /**
   * 收集KD樹中的所有點
   * @param node KD樹節點
   * @param points 用於存儲收集到的點
   */
  private collectPoints(node: KDTreeNode | null, points: FeaturePoint[]): void {
    if (!node) {
      return;
    }
    
    // 添加當前節點的點
    points.push(node.point);
    
    // 遞歸收集左右子樹的點
    this.collectPoints(node.left, points);
    this.collectPoints(node.right, points);
  }
  
  /**
   * 增量更新索引
   * 更新索引結構而不完全重建
   */
  private async updateIndex(): Promise<void> {
    if (this.building) {
      return;
    }
    
    this.building = true;
    
    try {
      // 處理更新隊列中的所有項目
      await this.processUpdateQueue();
      
      // 檢查樹平衡性並在必要時重建
      if (this.rebuildCount % 2 === 0) {
        this.checkAndRebalanceTree();
      }
      
      // 檢查是否應該進行垃圾回收
      const now = Date.now();
      if (now - this.lastGCTime >= this.config.gcInterval) {
        this.performGarbageCollection();
        this.lastGCTime = now;
      }
    } catch (error) {
      console.error('更新索引失敗:', error);
    } finally {
      this.building = false;
    }
  }
  
  /**
   * 插入點到KD樹
   * @param point 特徵點
   */
  private insertPoint(point: FeaturePoint): void {
    if (!this.root) {
      this.root = {
        point,
        dimension: 0,
        left: null,
        right: null
      };
      return;
    }
    
    let current = this.root;
    let depth = 0;
    
    while (true) {
      const dim = depth % point.vector.length;
      
      if (point.vector[dim] < current.point.vector[dim]) {
        if (current.left === null) {
          current.left = {
            point,
            dimension: dim,
            left: null,
            right: null
          };
          break;
        }
        current = current.left;
      } else {
        if (current.right === null) {
          current.right = {
            point,
            dimension: dim,
            left: null,
            right: null
          };
          break;
        }
        current = current.right;
      }
      
      depth++;
    }
  }
  
  /**
   * 構建KD樹
   * 使用遞歸方式構建平衡的KD樹
   * 
   * @param points 特徵點數組
   * @param depth 當前深度
   * @returns KD樹節點
   */
  private buildKdTree(points: FeaturePoint[], depth: number = 0): KDTreeNode | null {
    if (points.length === 0) {
      return null;
    }
    
    if (points.length === 1) {
      return {
        point: points[0],
        dimension: 0,
        left: null,
        right: null
      };
    }
    
    // 選擇分割軸
    const k = points[0].vector.length;
    const axis = depth % k;
    
    // 根據當前軸對點進行排序
    points.sort((a, b) => a.vector[axis] - b.vector[axis]);
    
    // 選擇中位數作為分割點
    const medianIdx = Math.floor(points.length / 2);
    const medianPoint = points[medianIdx];
    
    // 遞歸構建左右子樹
    const node: KDTreeNode = {
      point: medianPoint,
      dimension: axis,
      left: this.buildKdTree(points.slice(0, medianIdx), depth + 1),
      right: this.buildKdTree(points.slice(medianIdx + 1), depth + 1)
    };
    
    return node;
  }
  
  /**
   * 執行垃圾回收
   * 刪除不再使用的特徵點以節省內存
   * 
   * @param forcedCleanupRatio 強制清理比例，如果指定，將清理指定比例的特徵點
   */
  private performGarbageCollection(forcedCleanupRatio?: number): void {
    // 獲取所有特徵點
    const points = [...this.featureMap.values()];
    
    // 按上次訪問時間和訪問次數排序
    points.sort((a, b) => {
      // 優先考慮訪問次數
      if (a.accessCount === 0 && b.accessCount > 0) return -1;
      if (a.accessCount > 0 && b.accessCount === 0) return 1;
      
      // 然後考慮最後訪問時間
      return a.lastUpdated - b.lastUpdated;
    });
    
    // 決定清理比例
    let cleanupRatio: number;
    
    if (forcedCleanupRatio !== undefined) {
      // 使用強制指定的清理比例
      cleanupRatio = forcedCleanupRatio;
    } else {
      // 動態決定清理比例
      cleanupRatio = this.determineCleanupRatio();
    }
    
    // 計算要移除的特徵點數量
    const removeCount = Math.floor(this.featureMap.size * cleanupRatio);
    
    // 如果清理比例太小，不執行清理
    if (removeCount < 10) {
      console.info('垃圾回收：當前無需清理');
      return;
    }
    
    const pointsToRemove = points.slice(0, removeCount);
    
    for (const point of pointsToRemove) {
      // 釋放共享緩衝區（如果有）
      if (point.bufferRef && point.bufferRef.buffer instanceof SharedArrayBuffer) {
        this.freeSharedBuffer(point.bufferRef as { 
          buffer: SharedArrayBuffer, 
          byteOffset: number, 
          length: number 
        });
      }
      
      this.featureMap.delete(`${point.id}:${point.level}`);
    }
    
    // 清理完後，也檢查並釋放未使用的共享緩衝區
    this.cleanupUnusedBuffers();
    
    console.info(`垃圾回收完成，清理比例：${(cleanupRatio * 100).toFixed(1)}%，刪除了 ${pointsToRemove.length} 個特徵點，當前特徵點數: ${this.featureMap.size}`);
  }
  
  /**
   * 決定垃圾回收清理比例
   * 根據系統狀態動態調整清理比例
   * 
   * @returns 清理比例（0-1 之間）
   */
  private determineCleanupRatio(): number {
    const totalFeatures = this.featureMap.size;
    let ratio = 0.1; // 默認清理 10%
    
    // 根據特徵點數量調整
    if (totalFeatures > 10000) {
      ratio = 0.2; // 特徵點很多時，清理更多
    } else if (totalFeatures < 1000) {
      ratio = 0.05; // 特徵點較少時，清理較少
    }
    
    // 嘗試檢測記憶體壓力
    try {
      // @ts-ignore
      if (performance.memory && performance.memory.usedJSHeapSize) {
        // @ts-ignore
        const usedHeap = performance.memory.usedJSHeapSize;
        // @ts-ignore
        const totalHeap = performance.memory.jsHeapSizeLimit;
        
        const memoryUsageRatio = usedHeap / totalHeap;
        
        // 根據記憶體使用情況調整清理比例
        if (memoryUsageRatio > 0.8) {
          // 記憶體壓力大，清理更多
          ratio = Math.max(ratio, 0.3);
        } else if (memoryUsageRatio < 0.5) {
          // 記憶體充足，可以少清理
          ratio = Math.min(ratio, 0.1);
        }
      }
    } catch (error) {
      console.warn('檢測記憶體使用情況失敗:', error);
    }
    
    // 確保清理比例在合理範圍內
    return Math.max(0.05, Math.min(0.5, ratio));
  }
  
  /**
   * 強制執行垃圾回收
   * 該方法可從外部調用，用於在系統判斷記憶體壓力較大時主動清理
   * 
   * @param ratio 強制清理比例（0-1 之間）
   */
  public forceGarbageCollection(ratio: number = 0.3): void {
    // 確保清理比例在合理範圍內
    const cleanupRatio = Math.max(0.05, Math.min(0.5, ratio));
    this.performGarbageCollection(cleanupRatio);
  }
  
  /**
   * 提取照片的多層級特徵
   * 使用相似度系統提取照片的多層級特徵
   * 
   * @param photo 照片
   * @returns 多層級特徵，如果提取失敗則返回 null
   * @throws 如果未設置相似度系統，會拋出錯誤
   */
  public async extractMultiLevelFeatures(photo: PhotoFile): Promise<MultiLevelFeature | null> {
    if (!this.similaritySystem) {
      throw new Error('未設置相似度系統，無法提取特徵');
    }
    
    try {
      return await this.similaritySystem.extractMultiLevelFeatures(photo);
    } catch (error) {
      console.error(`提取照片 ${photo.id} 的多層級特徵失敗:`, error);
      return null;
    }
  }

  /**
   * 計算歐氏距離
   * @param a 向量 A
   * @param b 向量 B
   * @returns 歐氏距離
   */
  private calculateDistance(a: number[], b: number[]): number {
    // 確保長度相同，取較短長度
    const length = Math.min(a.length, b.length);
    let sum = 0;
    
    for (let i = 0; i < length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    
    return Math.sqrt(sum);
  }
  
  /**
   * 將歐氏距離轉換為相似度分數
   * @param distance 歐氏距離
   * @param maxDistance 參考最大距離
   * @returns 相似度得分 (0-1)
   */
  private distanceToSimilarity(distance: number, maxDistance: number): number {
    // 使用指數衰減函數，距離越小相似度越高
    if (distance <= 0) return 1.0;
    if (distance >= maxDistance) return 0.0;
    
    return Math.exp(-Math.pow(distance / maxDistance, 2) * 5);
  }
  
  /**
   * 查找最近的 K 個鄰居
   * @param point 查詢點
   * @param k 返回的鄰居數量
   * @param level 特徵級別
   * @returns 最近的 K 個鄰居及其距離
   */
  private findKNearest(
    point: number[],
    k: number,
    level: FeatureLevel | 'ALL' = 'ALL'
  ): { point: FeaturePoint; distance: number }[] {
    if (!this.root) {
      return [];
    }
    
    // 使用優先隊列（堆）來維護 K 個最近鄰
    // 距離大的在頂部，方便移除
    const nearestNeighbors: { point: FeaturePoint; distance: number }[] = [];
    
    // 遞歸搜索
    this.searchKNN(this.root, point, k, nearestNeighbors, level);
    
    // 按距離排序
    nearestNeighbors.sort((a, b) => a.distance - b.distance);
    
    return nearestNeighbors;
  }
  
  /**
   * 遞歸 KNN 搜索
   * @param node 當前節點
   * @param point 查詢點
   * @param k 鄰居數量
   * @param neighbors 當前找到的鄰居
   * @param level 特徵級別
   */
  private searchKNN(
    node: KDTreeNode | null,
    point: number[],
    k: number,
    neighbors: { point: FeaturePoint; distance: number }[],
    level: FeatureLevel | 'ALL'
  ): void {
    if (!node) {
      return;
    }
    
    // 如果指定了級別，而當前節點不是該級別，則跳過
    if (level !== 'ALL' && node.point.level !== level) {
      this.searchKNN(node.left, point, k, neighbors, level);
      this.searchKNN(node.right, point, k, neighbors, level);
      return;
    }
    
    // 計算當前節點與查詢點的距離
    const distance = this.calculateDistance(node.point.vector, point);
    
    // 更新節點的訪問統計
    node.point.accessCount++;
    node.point.lastUpdated = Date.now();
    
    // 如果我們還沒有收集到 k 個鄰居，直接添加當前節點
    if (neighbors.length < k) {
      neighbors.push({ point: node.point, distance });
      // 如果正好收集到 k 個，按距離排序（距離大的在前）
      if (neighbors.length === k) {
        neighbors.sort((a, b) => b.distance - a.distance);
      }
    } else if (distance < neighbors[0].distance) {
      // 如果當前節點距離小於最遠的鄰居，替換它
      neighbors[0] = { point: node.point, distance };
      // 重新排序
      neighbors.sort((a, b) => b.distance - a.distance);
    }
    
    // 決定搜索順序
    const dim = node.dimension;
    const diff = point[dim] - node.point.vector[dim];
    
    // 先搜索更可能包含近鄰的子樹
    const firstSearch = diff < 0 ? node.left : node.right;
    const secondSearch = diff < 0 ? node.right : node.left;
    
    // 先搜索更可能的方向
    this.searchKNN(firstSearch, point, k, neighbors, level);
    
    // 判斷是否需要搜索另一側
    // 如果最遠鄰居的距離大於當前維度的差值，則可能在另一側有更近的點
    if (neighbors.length < k || Math.abs(diff) < neighbors[0].distance) {
      this.searchKNN(secondSearch, point, k, neighbors, level);
    }
  }

  /**
   * 搜索相似照片
   * 這是主要的公開搜索方法
   * 
   * @param photo 查詢照片
   * @param options 搜索選項
   * @returns 相似照片列表
   */
  public async searchSimilarPhotos(
    photo: PhotoFile,
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    if (!this.similaritySystem) {
      throw new Error('未設置相似度系統，無法提取特徵');
    }
    
    // 設置默認選項
    const level = options.level || 'ALL';
    const limit = options.limit || 10;
    const threshold = options.threshold || 0.5;
    
    try {
      // 提取查詢照片的特徵
      const feature = await this.similaritySystem.extractMultiLevelFeatures(photo);
      
      if (!feature) {
        throw new Error(`無法從照片提取特徵`);
      }
      
      // 根據特徵級別選擇不同的搜索策略
      let searchVector: number[] = [];
      let searchLevel: FeatureLevel = FeatureLevel.HIGH;
      
      if (level === FeatureLevel.HIGH || level === 'ALL') {
        if (feature.highLevelFeatures && feature.highLevelFeatures.length > 0) {
          searchVector = this.compressVector(feature.highLevelFeatures);
          searchLevel = FeatureLevel.HIGH;
        }
      }
      
      if ((level === FeatureLevel.MID || level === 'ALL') && searchVector.length === 0) {
        if (feature.midLevelFeatures) {
          const midVector = this.midLevelToVector(feature.midLevelFeatures);
          if (midVector.length > 0) {
            searchVector = this.compressVector(midVector);
            searchLevel = FeatureLevel.MID;
          }
        }
      }
      
      if ((level === FeatureLevel.LOW || level === 'ALL') && searchVector.length === 0) {
        if (feature.lowLevelFeatures) {
          const lowVector = this.hashToVector(feature.lowLevelFeatures);
          if (lowVector.length > 0) {
            searchVector = this.compressVector(lowVector);
            searchLevel = FeatureLevel.LOW;
          }
        }
      }
      
      if (searchVector.length === 0) {
        throw new Error('無法創建搜索向量');
      }
      
      // 使用 KNN 搜索
      const neighbors = this.findKNearest(searchVector, limit * 2, level === 'ALL' ? searchLevel : level);
      
      // 計算相似度並過濾結果
      const maxDistance = neighbors.length > 0 ? Math.max(...neighbors.map(n => n.distance)) : 1.0;
      
      const results: SearchResult[] = neighbors.map(neighbor => ({
        id: neighbor.point.id,
        similarity: this.distanceToSimilarity(neighbor.distance, maxDistance),
        level: neighbor.point.level,
        distance: neighbor.distance
      }))
      .filter(result => result.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
      
      return results;
    } catch (error) {
      console.error('搜索相似照片時出錯:', error);
      return [];
    }
  }
  
  /**
   * 查詢相似照片 ID
   * 根據指定照片 ID 查詢相似照片
   * 
   * @param photoId 照片 ID
   * @param options 搜索選項
   * @returns 相似照片列表
   */
  public findSimilarById(
    photoId: string,
    options: SearchOptions = {}
  ): SearchResult[] {
    // 設置默認選項
    const level = options.level || 'ALL';
    const limit = options.limit || 10;
    const threshold = options.threshold || 0.5;
    
    try {
      // 獲取查詢照片的特徵向量
      const searchLevels = level === 'ALL' 
        ? [FeatureLevel.HIGH, FeatureLevel.MID, FeatureLevel.LOW]
        : [level];
      
      let foundVector: number[] | null = null;
      let foundLevel: FeatureLevel | null = null;
      
      // 依照特徵級別優先順序尋找
      for (const searchLevel of searchLevels) {
        const featurePoint = this.featureMap.get(`${photoId}:${searchLevel}`);
        if (featurePoint) {
          foundVector = featurePoint.vector;
          foundLevel = searchLevel;
          break;
        }
      }
      
      if (!foundVector || foundLevel === null) {
        console.warn(`找不到照片 ${photoId} 的特徵向量`);
        return [];
      }
      
      // 更新特徵點的訪問統計
      const featurePoint = this.featureMap.get(`${photoId}:${foundLevel}`);
      if (featurePoint) {
        featurePoint.accessCount++;
        featurePoint.lastUpdated = Date.now();
      }
      
      // 使用 KNN 搜索
      const neighbors = this.findKNearest(
        foundVector, 
        limit * 2, 
        level === 'ALL' ? foundLevel : level
      );
      
      // 計算相似度並過濾結果
      const maxDistance = neighbors.length > 0 ? Math.max(...neighbors.map(n => n.distance)) : 1.0;
      
      const results: SearchResult[] = neighbors
        .filter(neighbor => neighbor.point.id !== photoId)  // 排除自身
        .map(neighbor => ({
          id: neighbor.point.id,
          similarity: this.distanceToSimilarity(neighbor.distance, maxDistance),
          level: neighbor.point.level,
          distance: neighbor.distance
        }))
        .filter(result => result.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
      
      return results;
    } catch (error) {
      console.error(`查詢相似照片 ${photoId} 時出錯:`, error);
      return [];
    }
  }
} 