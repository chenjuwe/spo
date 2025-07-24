/**
 * 優化的圖片相似度比較模塊
 * 整合局部敏感哈希(LSH)、整合式哈希計算和降維技術
 */

import { LSHIndex, combineHashes, createLSHIndex, hexToBinary } from './lsh';
import { HashResult, HashType, calculateHashSimilarity, calculateMultipleHashes, calculateWeightedHammingDistance, calculateHammingDistance as calculateHammingDistanceSync } from './integratedHasher';
import { calculateHammingDistanceSync as wasmCalculateHammingDistanceSync, initializeModule as initializeWasmModule } from './wasmHashCompare';
import { FeatureVectorComparator, calculateCosineSimilarity } from './dimensionReduction';

/**
 * 圖片相似度比較優化級別
 */
export enum OptimizationLevel {
  BASIC = 'basic',           // 基本哈希比較
  STANDARD = 'standard',     // 使用整合式哈希計算
  ADVANCED = 'advanced',     // 使用 LSH 和整合式哈希
  PROFESSIONAL = 'pro'       // 使用 LSH、整合式哈希和降維技術
}

/**
 * 相似度比較選項
 */
export interface ComparisonOptions {
  optimizationLevel: OptimizationLevel;
  similarityThreshold: number;  // 相似度閾值 (0-100)
  useWasm: boolean;             // 是否使用 WebAssembly 加速
  hashWeights?: {               // 不同哈希類型的權重
    [key in HashType]?: number;
  };
  maxCandidates?: number;       // LSH 每個查詢的最大候選項數量
  featureVectorSize?: number;   // 降維後的特徵向量維度
}

/**
 * 默認比較選項
 */
export const DEFAULT_COMPARISON_OPTIONS: ComparisonOptions = {
  optimizationLevel: OptimizationLevel.STANDARD,
  similarityThreshold: 90,
  useWasm: true,
  hashWeights: {
    [HashType.AHASH]: 0.25,
    [HashType.DHASH]: 0.35,
    [HashType.PHASH]: 0.40
  },
  maxCandidates: 200,
  featureVectorSize: 16
};

/**
 * 相似度比較結果
 */
export interface ComparisonResult {
  similarity: number;         // 相似度百分比
  hashDistance?: number;      // 哈希距離
  featureDistance?: number;   // 特徵向量距離
  method: string;             // 使用的比較方法
}

/**
 * 圖片數據項
 */
export interface ImageItem {
  id: string;                           // 唯一ID
  hashResult?: HashResult | undefined;  // 哈希結果
  featureVector?: number[] | undefined; // 特徵向量
  reducedFeatures?: number[] | undefined; // 降維後的特徵向量
  binaryHashString?: string | undefined;  // 二進制哈希字符串 (用於 LSH)
  metadata?: any;                       // 額外元數據
}

/**
 * 相似圖片組
 */
export interface SimilarityGroup {
  keyImage: ImageItem;
  similarImages: { image: ImageItem; similarity: number }[];
}

/**
 * 優化的圖片相似度比較器
 */
export class OptimizedImageComparator {
  private options: ComparisonOptions;
  private lshIndex: LSHIndex | null = null;
  private featureComparator: FeatureVectorComparator | null = null;
  private imageItems: Map<string, ImageItem> = new Map();
  private isWasmInitialized: boolean = false;
  
  /**
   * 創建圖片相似度比較器
   * @param options 比較選項
   */
  constructor(options: Partial<ComparisonOptions> = {}) {
    this.options = { ...DEFAULT_COMPARISON_OPTIONS, ...options };
    
    // 初始化 WASM 模塊 (如果需要)
    if (this.options.useWasm) {
      this.initializeWasm();
    }
    
    // 創建 LSH 索引 (如果需要)
    if (this.options.optimizationLevel === OptimizationLevel.ADVANCED || 
        this.options.optimizationLevel === OptimizationLevel.PROFESSIONAL) {
      this.lshIndex = createLSHIndex();
    }
    
    // 創建特徵向量比較器 (如果需要)
    if (this.options.optimizationLevel === OptimizationLevel.PROFESSIONAL) {
      this.featureComparator = new FeatureVectorComparator(this.options.featureVectorSize);
    }
  }
  
  /**
   * 初始化 WebAssembly 模塊
   */
  private async initializeWasm(): Promise<void> {
    if (!this.isWasmInitialized) {
      try {
        await initializeWasmModule();
        this.isWasmInitialized = true;
        console.info('WebAssembly 模塊初始化成功');
      } catch (error) {
        console.warn('WebAssembly 模塊初始化失敗，將使用 JavaScript 實現', error);
        this.options.useWasm = false;
      }
    }
  }
  
  /**
   * 添加圖片數據
   * @param id 圖片 ID
   * @param hashResult 哈希結果
   * @param featureVector 特徵向量 (可選)
   * @param metadata 元數據 (可選)
   */
  public addImage(
    id: string,
    hashResult: HashResult,
    featureVector?: number[],
    metadata?: any
  ): void {
    // 創建圖片數據項
    const imageItem: ImageItem = { id, hashResult, featureVector, metadata };
    
    // 如果使用 LSH，生成二進制哈希字符串
    if (this.lshIndex && (hashResult.aHash || hashResult.dHash || hashResult.pHash)) {
      imageItem.binaryHashString = combineHashes(hashResult);
      this.lshIndex.insert(id, imageItem.binaryHashString);
    }
    
    // 如果使用特徵向量降維，計算降維特徵
    if (this.featureComparator && featureVector && featureVector.length > 0) {
      // 如果比較器未訓練，添加第一個特徵向量後進行訓練
      if (!this.featureComparator.getTransformMatrix() && this.imageItems.size === 0) {
        this.featureComparator.train([featureVector]);
      }
      
      try {
        // 轉換特徵向量
        imageItem.reducedFeatures = this.featureComparator.transform(featureVector);
      } catch (error) {
        console.warn(`無法降維特徵向量 (ID: ${id}):`, error);
      }
    }
    
    // 添加到集合中
    this.imageItems.set(id, imageItem);
  }
  
  /**
   * 添加多個圖片數據
   * @param items 多個圖片數據項
   */
  public addMultipleImages(items: { id: string; hashResult: HashResult; featureVector?: number[]; metadata?: any }[]): void {
    // 批量添加到 LSH 索引
    if (this.lshIndex) {
      const lshItems: [string, string][] = [];
      
      for (const item of items) {
        const binaryHash = combineHashes(item.hashResult);
        lshItems.push([item.id, binaryHash]);
      }
      
      this.lshIndex.batchInsert(lshItems);
    }
    
    // 如果使用特徵向量，先收集所有特徵向量進行訓練
    if (this.featureComparator) {
      const featureVectors: number[][] = [];
      
      for (const item of items) {
        if (item.featureVector && item.featureVector.length > 0) {
          featureVectors.push(item.featureVector);
        }
      }
      
      // 如果有足夠的特徵向量且比較器尚未訓練，進行訓練
      if (featureVectors.length > 0 && !this.featureComparator.getTransformMatrix()) {
        this.featureComparator.train(featureVectors);
      }
    }
    
    // 添加每個圖片
    for (const item of items) {
      this.addImage(item.id, item.hashResult, item.featureVector, item.metadata);
    }
  }
  
  /**
   * 查詢與給定 ID 相似的圖片
   * @param id 圖片 ID
   * @param similarityThreshold 相似度閾值 (可選，默認使用構造函數中的設置)
   * @returns 相似圖片及其相似度
   */
  public findSimilarImages(
    id: string,
    similarityThreshold: number = this.options.similarityThreshold
  ): { image: ImageItem; similarity: number }[] {
    const imageItem = this.imageItems.get(id);
    
    if (!imageItem) {
      throw new Error(`找不到 ID 為 ${id} 的圖片`);
    }
    
    return this.findSimilarImagesForItem(imageItem, similarityThreshold);
  }
  
  /**
   * 查詢與給定圖片項相似的圖片
   * @param imageItem 圖片項
   * @param similarityThreshold 相似度閾值
   * @returns 相似圖片及其相似度
   */
  public findSimilarImagesForItem(
    imageItem: ImageItem,
    similarityThreshold: number = this.options.similarityThreshold
  ): { image: ImageItem; similarity: number }[] {
    let candidateIds: Set<string> = new Set();
    
    // 根據優化級別選擇不同的查詢策略
    switch (this.options.optimizationLevel) {
      case OptimizationLevel.ADVANCED:
      case OptimizationLevel.PROFESSIONAL:
        if (this.lshIndex && imageItem.binaryHashString) {
          // 使用 LSH 查詢候選項
          candidateIds = this.lshIndex.query(imageItem.binaryHashString);
          
          // 如果候選項過多，限制數量
          if (candidateIds.size > (this.options.maxCandidates || 200)) {
            candidateIds = new Set(Array.from(candidateIds).slice(0, this.options.maxCandidates));
          }
        } else {
          // 如果沒有 LSH 索引或二進制哈希，使用全量比較
          candidateIds = new Set(this.imageItems.keys());
        }
        break;
      
      default:
        // 基本和標準級別使用全量比較
        candidateIds = new Set(this.imageItems.keys());
        break;
    }
    
    // 移除自身 ID
    candidateIds.delete(imageItem.id);
    
    // 對候選圖片進行相似度計算
    const results: { image: ImageItem; similarity: number }[] = [];
    
    for (const candidateId of candidateIds) {
      const candidateImage = this.imageItems.get(candidateId);
      
      if (candidateImage) {
        // 計算相似度
        const comparison = this.compareImageItems(imageItem, candidateImage);
        
        // 如果相似度超過閾值，添加到結果中
        if (comparison.similarity >= similarityThreshold) {
          results.push({
            image: candidateImage,
            similarity: comparison.similarity
          });
        }
      }
    }
    
    // 按相似度降序排序
    results.sort((a, b) => b.similarity - a.similarity);
    
    return results;
  }
  
  /**
   * 比較兩個圖片項的相似度
   * @param imageItem1 第一個圖片項
   * @param imageItem2 第二個圖片項
   * @returns 比較結果
   */
  public compareImageItems(imageItem1: ImageItem, imageItem2: ImageItem): ComparisonResult {
    // 根據優化級別選擇比較策略
    switch (this.options.optimizationLevel) {
      case OptimizationLevel.BASIC:
        // 基本級別只使用一種哈希進行比較
        if (imageItem1.hashResult?.pHash && imageItem2.hashResult?.pHash) {
          const hashDistance = this.calculateHashDistance(
            imageItem1.hashResult.pHash,
            imageItem2.hashResult.pHash
          );
          
          // 計算相似度百分比
          const maxBits = imageItem1.hashResult.pHash.length * 4; // 每個十六進制字符 4 位
          const similarity = 100 * (1 - hashDistance / maxBits);
          
          return {
            similarity: Math.max(0, Math.min(100, similarity)),
            hashDistance,
            method: 'basic_phash'
          };
        }
        break;
      
      case OptimizationLevel.STANDARD:
        // 標準級別使用加權哈希距離
        if (imageItem1.hashResult && imageItem2.hashResult) {
          const weightedDistance = calculateWeightedHammingDistance(
            imageItem1.hashResult,
            imageItem2.hashResult,
            this.options.hashWeights
          );
          
          const similarity = calculateHashSimilarity(
            imageItem1.hashResult,
            imageItem2.hashResult,
            this.options.hashWeights
          );
          
          return {
            similarity,
            hashDistance: weightedDistance,
            method: 'weighted_hash'
          };
        }
        break;
      
      case OptimizationLevel.PROFESSIONAL:
        // 專業級別首先比較降維特徵向量
        if (imageItem1.reducedFeatures && imageItem2.reducedFeatures && 
            this.featureComparator) {
          const featureSimilarity = this.featureComparator.compareReduced(
            imageItem1.reducedFeatures,
            imageItem2.reducedFeatures
          );
          
          // 如果特徵向量相似度高，再使用哈希進一步確認
          if (featureSimilarity >= this.options.similarityThreshold * 0.7) {
            if (imageItem1.hashResult && imageItem2.hashResult) {
              const hashSimilarity = calculateHashSimilarity(
                imageItem1.hashResult,
                imageItem2.hashResult,
                this.options.hashWeights
              );
              
              // 結合特徵向量和哈希相似度
              const combinedSimilarity = featureSimilarity * 0.6 + hashSimilarity * 0.4;
              
              return {
                similarity: combinedSimilarity,
                featureDistance: 100 - featureSimilarity,
                method: 'feature_and_hash'
              };
            }
            
            return {
              similarity: featureSimilarity,
              featureDistance: 100 - featureSimilarity,
              method: 'feature_only'
            };
          }
          
          // 特徵相似度低，直接返回
          return {
            similarity: featureSimilarity,
            featureDistance: 100 - featureSimilarity,
            method: 'feature_only_low'
          };
        }
        // 如果沒有特徵向量，降級為高級比較
        // (下一個 case 不使用 break，直接執行)
      
      case OptimizationLevel.ADVANCED:
        // 高級級別使用綜合哈希比較
        if (imageItem1.hashResult && imageItem2.hashResult) {
          const similarity = calculateHashSimilarity(
            imageItem1.hashResult,
            imageItem2.hashResult,
            this.options.hashWeights
          );
          
          return {
            similarity,
            method: 'advanced_hash'
          };
        }
        break;
    }
    
    // 如果無法使用上述方法，使用基本比較
    return this.fallbackCompare(imageItem1, imageItem2);
  }
  
  /**
   * 計算兩個哈希之間的漢明距離
   * @param hash1 第一個哈希
   * @param hash2 第二個哈希
   * @returns 漢明距離
   */
  private calculateHashDistance(hash1: string, hash2: string): number {
    if (this.options.useWasm && this.isWasmInitialized) {
      return wasmCalculateHammingDistanceSync(hash1, hash2);
    } else {
      // 使用 integratedHasher 中的同步實現
      return calculateHammingDistanceSync(hash1, hash2);
    }
  }
  
  /**
   * 回退的比較方法 (當首選方法不可用時)
   * @param imageItem1 第一個圖片項
   * @param imageItem2 第二個圖片項
   * @returns 比較結果
   */
  private fallbackCompare(imageItem1: ImageItem, imageItem2: ImageItem): ComparisonResult {
    // 嘗試使用任何可用的哈希
    const hash1 = imageItem1.hashResult?.pHash || imageItem1.hashResult?.dHash || imageItem1.hashResult?.aHash;
    const hash2 = imageItem2.hashResult?.pHash || imageItem2.hashResult?.dHash || imageItem2.hashResult?.aHash;
    
    if (hash1 && hash2) {
      const hashDistance = this.calculateHashDistance(hash1, hash2);
      const maxBits = hash1.length * 4; // 每個十六進制字符 4 位
      const similarity = 100 * (1 - hashDistance / maxBits);
      
      return {
        similarity: Math.max(0, Math.min(100, similarity)),
        hashDistance,
        method: 'fallback_hash'
      };
    }
    
    // 嘗試使用特徵向量
    if (imageItem1.featureVector && imageItem2.featureVector) {
      const similarity = 100 * calculateCosineSimilarity(imageItem1.featureVector, imageItem2.featureVector);
      
      return {
        similarity,
        method: 'fallback_feature'
      };
    }
    
    // 實在沒有可比較的數據
    return {
      similarity: 0,
      method: 'no_data'
    };
  }
  
  /**
   * 查找所有相似圖片組
   * @param similarityThreshold 相似度閾值
   * @returns 相似圖片組數組
   */
  public findAllSimilarityGroups(
    similarityThreshold: number = this.options.similarityThreshold
  ): SimilarityGroup[] {
    const groups: SimilarityGroup[] = [];
    const processedIds = new Set<string>();
    
    // 遍歷所有圖片
    for (const [id, imageItem] of this.imageItems.entries()) {
      // 如果已經在某個組中，則跳過
      if (processedIds.has(id)) {
        continue;
      }
      
      // 查詢相似圖片
      const similarImages = this.findSimilarImagesForItem(imageItem, similarityThreshold);
      
      // 如果有相似圖片，創建一個組
      if (similarImages.length > 0) {
        groups.push({
          keyImage: imageItem,
          similarImages
        });
        
        // 標記所有相似圖片為已處理
        processedIds.add(id);
        for (const { image } of similarImages) {
          processedIds.add(image.id);
        }
      }
    }
    
    return groups;
  }
  
  /**
   * 重新訓練特徵向量比較器
   * @param forceRetrain 是否強制重新訓練
   */
  public retrainFeatureComparator(forceRetrain: boolean = false): void {
    if (!this.featureComparator) {
      this.featureComparator = new FeatureVectorComparator(this.options.featureVectorSize);
    }
    
    // 如果已訓練且不強制重新訓練，則返回
    if (this.featureComparator.getTransformMatrix() && !forceRetrain) {
      return;
    }
    
    // 收集所有特徵向量
    const featureVectors: number[][] = [];
    
    for (const imageItem of this.imageItems.values()) {
      if (imageItem.featureVector && imageItem.featureVector.length > 0) {
        featureVectors.push(imageItem.featureVector);
      }
    }
    
    if (featureVectors.length > 0) {
      // 訓練比較器
      this.featureComparator.train(featureVectors);
      
      // 更新所有圖片的降維特徵
      for (const imageItem of this.imageItems.values()) {
        if (imageItem.featureVector && imageItem.featureVector.length > 0) {
          try {
            imageItem.reducedFeatures = this.featureComparator.transform(imageItem.featureVector);
          } catch (error) {
            console.warn(`無法更新圖片 ${imageItem.id} 的降維特徵:`, error);
          }
        }
      }
    }
  }
  
  /**
   * 取得圖片項
   * @param id 圖片 ID
   * @returns 圖片項或 undefined
   */
  public getImageItem(id: string): ImageItem | undefined {
    return this.imageItems.get(id);
  }
  
  /**
   * 從集合中移除圖片
   * @param id 圖片 ID
   */
  public removeImage(id: string): void {
    const imageItem = this.imageItems.get(id);
    
    if (imageItem) {
      // 從 LSH 索引中移除
      if (this.lshIndex && imageItem.binaryHashString) {
        this.lshIndex.remove(id, imageItem.binaryHashString);
      }
      
      // 從集合中移除
      this.imageItems.delete(id);
    }
  }
  
  /**
   * 清空所有數據
   */
  public clear(): void {
    if (this.lshIndex) {
      this.lshIndex.clear();
    }
    
    this.imageItems.clear();
  }
  
  /**
   * 獲取當前狀態統計
   */
  public getStats(): { 
    imageCount: number; 
    lshBucketStats?: { tableIndex: number; bucketCount: number; avgBucketSize: number }[] | undefined
  } {
    let lshBucketStats: { tableIndex: number; bucketCount: number; avgBucketSize: number }[] | undefined = undefined;
    
    if (this.lshIndex) {
      lshBucketStats = this.lshIndex.getBucketStats();
    }
    
    return {
      imageCount: this.imageItems.size,
      lshBucketStats
    };
  }
} 