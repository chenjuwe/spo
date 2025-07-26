/**
 * 圖片相似度系統
 * 整合所有優化技術，提供易用的API接口
 */

// 導入所有優化模塊
import { createLSHIndex, combineHashes, LSHIndex } from './lsh';
import { 
  calculateMultipleHashes, 
  calculateWeightedHammingDistance,
  calculateHashSimilarity,
  HashResult,
  HashType,
  HashOptions
} from './integratedHasher';
import {
  FeatureVectorComparator,
  calculateCosineSimilarity
} from './dimensionReduction';
import {
  initializeModule as initializeWasmModule,
  calculateHammingDistanceSync
} from './wasmHashCompare';

/**
 * 相似照片分組
 */
export interface SimilarImageGroup {
  /**
   * 主要照片ID
   */
  keyImageId: string;
  
  /**
   * 相似照片ID列表及其相似度
   */
  similarImages: Array<{
    id: string;
    similarity: number;
    method: string;
  }>;
}

/**
 * 相似度計算選項
 */
export interface SimilarityOptions {
  /**
   * 相似度閾值 (0-100)
   */
  threshold: number;
  
  /**
   * 是否使用LSH加速
   */
  useLSH: boolean;
  
  /**
   * 是否使用降維優化
   */
  useDimensionReduction: boolean;
  
  /**
   * 是否使用WebAssembly加速
   */
  useWasm: boolean;
  
  /**
   * 哈希權重
   */
  hashWeights?: {
    [key in HashType]?: number;
  };
  
  /**
   * 降維目標維度
   */
  targetDimension?: number;
  
  /**
   * 批處理大小
   */
  batchSize?: number;
  
  /**
   * 哈希計算選項
   */
  hashOptions?: Partial<HashOptions>;
}

/**
 * 默認相似度選項
 */
export const DEFAULT_SIMILARITY_OPTIONS: SimilarityOptions = {
  threshold: 90,
  useLSH: true,
  useDimensionReduction: true,
  useWasm: true,
  hashWeights: {
    [HashType.AHASH]: 0.25,
    [HashType.DHASH]: 0.35,
    [HashType.PHASH]: 0.40
  },
  targetDimension: 16,
  batchSize: 50,
  hashOptions: {
    size: 8,
    includeAHash: true,
    includeDHash: true,
    includePHash: true,
    convertToGrayscale: true,
    precise: false
  }
};

/**
 * 圖片數據
 */
export interface ImageData {
  /**
   * 圖片ID
   */
  id: string;
  
  /**
   * 圖片對象URL
   */
  url: string;
  
  /**
   * 圖片元數據
   */
  metadata?: any;
}

/**
 * 圖片特徵
 */
interface ImageFeatures {
  /**
   * 哈希結果
   */
  hashes?: HashResult;
  
  /**
   * 二進制哈希字符串 (用於LSH)
   */
  binaryHash?: string;
  
  /**
   * 特徵向量
   */
  features?: number[];
  
  /**
   * 降維後的特徵向量
   */
  reducedFeatures?: number[];
}

/**
 * 圖片相似度系統
 * 整合LSH, 整合式哈希計算, WebAssembly和降維技術
 */
export class ImageSimilaritySystem {
  /**
   * 存儲的圖片數據
   */
  private images: Map<string, ImageData> = new Map();
  
  /**
   * 存儲的圖片特徵
   */
  private features: Map<string, ImageFeatures> = new Map();
  
  /**
   * LSH索引
   */
  private lshIndex: LSHIndex | null = null;
  
  /**
   * 特徵向量比較器
   */
  private featureComparator: FeatureVectorComparator | null = null;
  
  /**
   * 系統選項
   */
  private options: SimilarityOptions;
  
  /**
   * WASM是否初始化
   */
  private wasmInitialized: boolean = false;
  
  /**
   * 構造函數
   * @param options 相似度計算選項
   */
  constructor(options: Partial<SimilarityOptions> = {}) {
    this.options = { ...DEFAULT_SIMILARITY_OPTIONS, ...options };
    
    // 初始化LSH (如果啟用)
    if (this.options.useLSH) {
      this.lshIndex = createLSHIndex();
    }
    
    // 初始化特徵比較器 (如果啟用)
    if (this.options.useDimensionReduction) {
      this.featureComparator = new FeatureVectorComparator(this.options.targetDimension);
    }
    
    // 初始化WebAssembly (如果啟用)
    if (this.options.useWasm) {
      this.initializeWasm();
    }
  }
  
  /**
   * 初始化WebAssembly
   */
  private async initializeWasm(): Promise<void> {
    if (!this.wasmInitialized) {
      try {
        await initializeWasmModule();
        this.wasmInitialized = true;
        console.info('WebAssembly 模塊初始化成功');
      } catch (error) {
        console.warn('WebAssembly 模塊初始化失敗，將使用 JavaScript 實現', error);
        this.options.useWasm = false;
      }
    }
  }
  
  /**
   * 添加圖片
   * @param imageData 圖片數據
   */
  public async addImage(imageData: ImageData): Promise<void> {
    try {
      // 存儲圖片數據
      this.images.set(imageData.id, imageData);
      
      // 為圖片計算特徵
      const imageFeatures: ImageFeatures = {};
      
      // 計算哈希
      imageFeatures.hashes = await this.calculateImageHashes(imageData);
      
      // 如果使用LSH，創建二進制哈希
      if (this.options.useLSH && this.lshIndex && imageFeatures.hashes) {
        imageFeatures.binaryHash = combineHashes(imageFeatures.hashes);
        this.lshIndex.insert(imageData.id, imageFeatures.binaryHash);
      }
      
      // 如果使用降維，提取特徵向量
      if (this.options.useDimensionReduction && this.featureComparator) {
        imageFeatures.features = await this.extractImageFeatures(imageData);
        
        // 如果特徵提取成功並且比較器已經訓練過，則進行降維
        if (imageFeatures.features && this.featureComparator.getTransformMatrix()) {
          imageFeatures.reducedFeatures = this.featureComparator.transform(imageFeatures.features);
        }
      }
      
      // 存儲特徵
      this.features.set(imageData.id, imageFeatures);
    } catch (error) {
      console.error(`添加圖片 ${imageData.id} 時出錯:`, error);
      throw new Error(`添加圖片失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 批量添加圖片
   * @param imagesData 多個圖片數據
   */
  public async addMultipleImages(imagesData: ImageData[]): Promise<void> {
    try {
      const batchSize = this.options.batchSize || 50;
      
      // 分批處理圖片，避免瀏覽器卡頓
      for (let i = 0; i < imagesData.length; i += batchSize) {
        const batch = imagesData.slice(i, i + batchSize);
        
        // 並行處理每批圖片
        await Promise.all(batch.map(async (imageData) => {
          try {
            await this.addImage(imageData);
          } catch (error) {
            console.warn(`處理圖片 ${imageData.id} 時出錯，將跳過:`, error);
          }
        }));
        
        // 每批處理完後，如果有足夠多的特徵向量，訓練比較器
        if (this.options.useDimensionReduction && 
            this.featureComparator &&
            !this.featureComparator.getTransformMatrix() &&
            this.images.size >= 5) {
          await this.trainFeatureComparator();
        }
        
        // 每批處理完後，輸出進度
        if (imagesData.length > batchSize) {
          const progress = Math.min(100, Math.round((i + batch.length) / imagesData.length * 100));
          console.info(`圖片處理進度: ${progress}% (${i + batch.length}/${imagesData.length})`);
        }
      }
      
      // 如果還沒有訓練比較器，現在訓練
      if (this.options.useDimensionReduction && 
          this.featureComparator && 
          !this.featureComparator.getTransformMatrix() && 
          this.images.size > 0) {
        await this.trainFeatureComparator();
      }
    } catch (error) {
      console.error('批量添加圖片時出錯:', error);
      throw new Error(`批量添加圖片失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 計算圖片哈希
   * @param imageData 圖片數據
   * @returns 哈希結果
   */
  private async calculateImageHashes(imageData: ImageData): Promise<HashResult> {
    try {
      // 從URL加載圖片
      const img = new Image();
      
      // 返回 Promise 以支持異步操作
      return new Promise<HashResult>((resolve, reject) => {
        img.onload = () => {
          try {
            // 創建畫布
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            if (!ctx) {
              reject(new Error("無法獲取畫布上下文"));
              return;
            }
            
            // 設置適當的大小 (哈希計算不需要大圖)
            const maxDimension = 256;
            const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
            const width = Math.floor(img.width * scale);
            const height = Math.floor(img.height * scale);
            
            canvas.width = width;
            canvas.height = height;
            
            // 繪製圖像
            ctx.drawImage(img, 0, 0, width, height);
            
            // 獲取像素數據
            const pixelData = ctx.getImageData(0, 0, width, height);
            
            // 計算哈希
            const hashes = calculateMultipleHashes(pixelData, this.options.hashOptions);
            
            // 清理資源
            canvas.width = 0;
            canvas.height = 0;
            
            // 返回哈希結果
            resolve(hashes);
          } catch (error) {
            reject(error);
          }
        };
        
        img.onerror = () => {
          reject(new Error(`無法加載圖片: ${imageData.id}`));
        };
        
        // 設置圖片源
        img.src = imageData.url;
        
        // 設置跨域屬性 (如果需要)
        img.crossOrigin = 'anonymous';
      });
    } catch (error) {
      console.error(`計算圖片 ${imageData.id} 哈希時出錯:`, error);
      return {}; // 返回空結果
    }
  }
  
  /**
   * 提取圖片特徵向量
   * @param imageData 圖片數據
   * @returns 特徵向量
   */
  private async extractImageFeatures(imageData: ImageData): Promise<number[]> {
    try {
      // 從URL加載圖片
      const img = new Image();
      
      // 返回 Promise 以支持異步操作
      return new Promise<number[]>((resolve, reject) => {
        img.onload = () => {
          try {
            // 創建畫布
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            if (!ctx) {
              reject(new Error("無法獲取畫布上下文"));
              return;
            }
            
            // 設置適當的大小 (特徵提取可以使用較大的圖像)
            const maxDimension = 512;
            const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
            const width = Math.floor(img.width * scale);
            const height = Math.floor(img.height * scale);
            
            canvas.width = width;
            canvas.height = height;
            
            // 繪製圖像
            ctx.drawImage(img, 0, 0, width, height);
            
            // 獲取像素數據
            const pixelData = ctx.getImageData(0, 0, width, height);
            
            // 提取顏色特徵
            const colorFeatures = this.extractColorFeatures(pixelData);
            
            // 提取紋理特徵
            const textureFeatures = this.extractTextureFeatures(pixelData);
            
            // 清理資源
            canvas.width = 0;
            canvas.height = 0;
            
            // 返回特徵向量 (合併顏色和紋理特徵)
            resolve([...colorFeatures, ...textureFeatures]);
          } catch (error) {
            reject(error);
          }
        };
        
        img.onerror = () => {
          reject(new Error(`無法加載圖片: ${imageData.id}`));
        };
        
        // 設置圖片源
        img.src = imageData.url;
        
        // 設置跨域屬性 (如果需要)
        img.crossOrigin = 'anonymous';
      });
    } catch (error) {
      console.error(`提取圖片 ${imageData.id} 特徵時出錯:`, error);
      return []; // 返回空特徵向量
    }
  }
  
  /**
   * 提取顏色特徵
   * @param imageData 圖像數據
   * @returns 顏色特徵向量
   */
  private extractColorFeatures(imageData: ImageBitmapSource): number[] {
    const imgData = imageData as ImageData;
    const { data, width, height } = imgData;
    
    // 提取顏色直方圖
    const binCount = 8; // 每個顏色通道的直方圖箱數
    const histogram = new Array(binCount * 3).fill(0); // R, G, B 三個通道
    
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
    const normalizedHistogram = histogram.map(count => count / pixelCount);
    
    return normalizedHistogram;
  }
  
  /**
   * 提取紋理特徵
   * @param imageData 圖像數據
   * @returns 紋理特徵向量
   */
  private extractTextureFeatures(imageData: ImageBitmapSource): number[] {
    const imgData = imageData as ImageData;
    const { data, width, height } = imgData;
    
    // 轉換為灰度圖
    const grayData = new Uint8ClampedArray(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      grayData[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    
    // 簡化的LBP特徵
    const numBins = 16;
    const histogram = new Array(numBins).fill(0);
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const center = grayData[y * width + x];
        let lbpValue = 0;
        
        // 簡化的4點LBP
        if (grayData[(y - 1) * width + x] >= center) lbpValue |= 1;
        if (grayData[(y + 1) * width + x] >= center) lbpValue |= 2;
        if (grayData[y * width + (x - 1)] >= center) lbpValue |= 4;
        if (grayData[y * width + (x + 1)] >= center) lbpValue |= 8;
        
        // 映射到直方圖箱
        const binIndex = Math.floor(lbpValue / 16 * numBins);
        histogram[binIndex]++;
      }
    }
    
    // 歸一化
    const totalPixels = (width - 2) * (height - 2);
    return histogram.map(count => count / totalPixels);
  }
  
  /**
   * 訓練特徵向量比較器
   */
  private async trainFeatureComparator(): Promise<void> {
    if (!this.options.useDimensionReduction || !this.featureComparator) {
      return;
    }
    
    try {
      // 收集所有特徵向量
      const featureVectors: number[][] = [];
      
      for (const [id, imageFeature] of this.features.entries()) {
        if (imageFeature.features && imageFeature.features.length > 0) {
          featureVectors.push(imageFeature.features);
        }
      }
      
      // 如果有足夠的特徵向量，訓練比較器
      if (featureVectors.length >= 5) {
        console.info(`使用 ${featureVectors.length} 個特徵向量訓練比較器...`);
        
        // 訓練比較器
        this.featureComparator.train(featureVectors);
        
        console.info('比較器訓練完成');
        
        // 更新所有圖片的降維特徵
        for (const [id, imageFeature] of this.features.entries()) {
          if (imageFeature.features && imageFeature.features.length > 0) {
            imageFeature.reducedFeatures = this.featureComparator.transform(imageFeature.features);
          }
        }
      } else {
        console.warn(`特徵向量數量不足 (${featureVectors.length} < 5)，無法訓練比較器`);
      }
    } catch (error) {
      console.error('訓練特徵向量比較器時出錯:', error);
    }
  }
  
  /**
   * 查找與指定圖片相似的圖片
   * @param imageId 圖片ID
   * @param threshold 相似度閾值 (0-100)
   * @returns 相似圖片及其相似度
   */
  public async findSimilarImages(
    imageId: string,
    threshold: number = this.options.threshold
  ): Promise<{ id: string; similarity: number; method: string }[]> {
    try {
      const imageFeature = this.features.get(imageId);
      
      if (!imageFeature) {
        throw new Error(`找不到圖片 ${imageId} 的特徵`);
      }
      
      let candidateIds: string[] = [];
      
      // 如果使用LSH，先通過LSH篩選候選項
      if (this.options.useLSH && this.lshIndex && imageFeature.binaryHash) {
        const lshResults = this.lshIndex.query(imageFeature.binaryHash);
        candidateIds = Array.from(lshResults).filter(id => id !== imageId);
      } else {
        // 否則使用所有圖片
        candidateIds = Array.from(this.features.keys()).filter(id => id !== imageId);
      }
      
      // 計算相似度
      const results: { id: string; similarity: number; method: string }[] = [];
      
      for (const candidateId of candidateIds) {
        const candidateFeature = this.features.get(candidateId);
        
        if (!candidateFeature) continue;
        
        // 計算相似度
        const { similarity, method } = this.calculateSimilarity(imageFeature, candidateFeature);
        
        // 如果相似度超過閾值，添加到結果
        if (similarity >= threshold) {
          results.push({
            id: candidateId,
            similarity,
            method
          });
        }
      }
      
      // 按相似度降序排序
      results.sort((a, b) => b.similarity - a.similarity);
      
      return results;
    } catch (error) {
      console.error(`查找與圖片 ${imageId} 相似的圖片時出錯:`, error);
      throw new Error(`查找相似圖片失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 查找所有相似圖片組
   * @param threshold 相似度閾值 (0-100)
   * @returns 相似圖片組
   */
  public async findAllSimilarGroups(
    threshold: number = this.options.threshold
  ): Promise<SimilarImageGroup[]> {
    try {
      const groups: SimilarImageGroup[] = [];
      const processedIds = new Set<string>();
      
      // 遍歷所有圖片
      for (const imageId of this.images.keys()) {
        // 如果已經在某個組中，跳過
        if (processedIds.has(imageId)) {
          continue;
        }
        
        // 查找相似圖片
        const similarImages = await this.findSimilarImages(imageId, threshold);
        
        // 如果有相似圖片，創建一個組
        if (similarImages.length > 0) {
          groups.push({
            keyImageId: imageId,
            similarImages
          });
          
          // 標記所有處理過的圖片
          processedIds.add(imageId);
          for (const { id } of similarImages) {
            processedIds.add(id);
          }
        }
      }
      
      return groups;
    } catch (error) {
      console.error(`查找所有相似圖片組時出錯:`, error);
      throw new Error(`查找相似圖片組失敗: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * 計算兩個圖片特徵的相似度
   * @param feature1 第一個圖片特徵
   * @param feature2 第二個圖片特徵
   * @returns 相似度 (0-100) 和使用的方法
   */
  private calculateSimilarity(
    feature1: ImageFeatures,
    feature2: ImageFeatures
  ): { similarity: number; method: string } {
    // 優先使用降維特徵比較 (如果可用)
    if (this.options.useDimensionReduction && 
        feature1.reducedFeatures && feature2.reducedFeatures && 
        this.featureComparator) {
      const similarity = this.featureComparator.compareReduced(
        feature1.reducedFeatures,
        feature2.reducedFeatures
      );
      
      // 如果降維特徵相似度高，結合哈希進一步確認
      if (similarity >= 0.7 * this.options.threshold && feature1.hashes && feature2.hashes) {
        const hashSimilarity = calculateHashSimilarity(
          feature1.hashes,
          feature2.hashes,
          this.options.hashWeights
        );
        
        // 結合兩種相似度 (60% 特徵 + 40% 哈希)
        return {
          similarity: 0.6 * similarity + 0.4 * hashSimilarity,
          method: 'combined'
        };
      }
      
      return { similarity, method: 'feature' };
    }
    
    // 使用哈希比較 (如果可用)
    if (feature1.hashes && feature2.hashes) {
      const similarity = calculateHashSimilarity(
        feature1.hashes,
        feature2.hashes,
        this.options.hashWeights
      );
      
      return { similarity, method: 'hash' };
    }
    
    // 使用原始特徵向量比較 (如果可用)
    if (feature1.features && feature2.features && 
        feature1.features.length > 0 && feature2.features.length === feature1.features.length) {
      const similarity = 100 * calculateCosineSimilarity(
        feature1.features,
        feature2.features
      );
      
      return { similarity, method: 'raw_feature' };
    }
    
    // 沒有可比較的特徵
    return { similarity: 0, method: 'none' };
  }
  
  /**
   * 比較兩張圖片
   * @param imageId1 第一張圖片ID
   * @param imageId2 第二張圖片ID
   * @returns 相似度 (0-100) 和使用的方法
   */
  public compareTwoImages(
    imageId1: string,
    imageId2: string
  ): { similarity: number; method: string } {
    const feature1 = this.features.get(imageId1);
    const feature2 = this.features.get(imageId2);
    
    if (!feature1) {
      throw new Error(`找不到圖片 ${imageId1} 的特徵`);
    }
    
    if (!feature2) {
      throw new Error(`找不到圖片 ${imageId2} 的特徵`);
    }
    
    return this.calculateSimilarity(feature1, feature2);
  }
  
  /**
   * 獲取圖片
   * @param imageId 圖片ID
   * @returns 圖片數據 (如果存在)
   */
  public getImage(imageId: string): ImageData | undefined {
    return this.images.get(imageId);
  }
  
  /**
   * 移除圖片
   * @param imageId 圖片ID
   */
  public removeImage(imageId: string): void {
    // 從圖片集合中移除
    this.images.delete(imageId);
    
    // 從特徵集合中移除
    this.features.delete(imageId);
    
    // 如果使用LSH，從LSH索引中移除
    if (this.options.useLSH && this.lshIndex) {
      const feature = this.features.get(imageId);
      
      if (feature && feature.binaryHash) {
        this.lshIndex.remove(imageId, feature.binaryHash);
      }
    }
  }
  
  /**
   * 清空所有數據
   */
  public clear(): void {
    this.images.clear();
    this.features.clear();
    
    if (this.lshIndex) {
      this.lshIndex.clear();
    }
  }
  
  /**
   * 獲取統計信息
   */
  public getStats(): {
    imageCount: number;
    featureCount: number;
    hashCount: number;
    reducedFeatureCount: number;
    lshBucketCount?: number;
    featureVectorDimension?: number;
  } {
    // 計算特徵數量
    let hashCount = 0;
    let reducedFeatureCount = 0;
    
    for (const feature of this.features.values()) {
      if (feature.hashes) hashCount++;
      if (feature.reducedFeatures) reducedFeatureCount++;
    }
    
    // 獲取LSH桶數量
    let lshBucketCount: number | undefined;
    if (this.lshIndex) {
      const stats = this.lshIndex.getBucketStats();
      lshBucketCount = stats.reduce((sum, stat) => sum + stat.bucketCount, 0);
    }
    
    // 獲取特徵向量維度
    let featureVectorDimension: number | undefined;
    if (this.featureComparator && this.featureComparator.getTransformMatrix()) {
      featureVectorDimension = this.options.targetDimension;
    }
    
    return {
      imageCount: this.images.size,
      featureCount: this.features.size,
      hashCount,
      reducedFeatureCount,
      lshBucketCount,
      featureVectorDimension
    };
  }
  
  /**
   * 獲取系統選項
   */
  public getOptions(): SimilarityOptions {
    return { ...this.options };
  }
  
  /**
   * 更新系統選項
   * @param options 新選項
   */
  public async updateOptions(options: Partial<SimilarityOptions>): Promise<void> {
    const oldOptions = { ...this.options };
    
    // 更新選項
    this.options = { ...this.options, ...options };
    
    // 處理選項變更
    
    // LSH 狀態變化
    if (!oldOptions.useLSH && this.options.useLSH && !this.lshIndex) {
      // LSH 從關閉到開啟
      this.lshIndex = createLSHIndex();
      
      // 重新索引所有圖片
      for (const [id, feature] of this.features.entries()) {
        if (feature.hashes) {
          feature.binaryHash = combineHashes(feature.hashes);
          this.lshIndex.insert(id, feature.binaryHash);
        }
      }
    } else if (oldOptions.useLSH && !this.options.useLSH && this.lshIndex) {
      // LSH 從開啟到關閉
      this.lshIndex = null;
    }
    
    // 降維狀態變化
    if (!oldOptions.useDimensionReduction && this.options.useDimensionReduction && !this.featureComparator) {
      // 降維從關閉到開啟
      this.featureComparator = new FeatureVectorComparator(this.options.targetDimension);
      
      // 如果有足夠多的特徵，訓練比較器
      await this.trainFeatureComparator();
    } else if (oldOptions.useDimensionReduction && !this.options.useDimensionReduction && this.featureComparator) {
      // 降維從開啟到關閉
      this.featureComparator = null;
      
      // 移除所有降維特徵
      for (const feature of this.features.values()) {
        feature.reducedFeatures = undefined;
      }
    } else if (this.options.useDimensionReduction && 
               oldOptions.targetDimension !== this.options.targetDimension && 
               this.featureComparator) {
      // 降維目標維度變化
      this.featureComparator = new FeatureVectorComparator(this.options.targetDimension);
      
      // 重新訓練比較器
      await this.trainFeatureComparator();
    }
    
    // WASM 狀態變化
    if (!oldOptions.useWasm && this.options.useWasm && !this.wasmInitialized) {
      // WASM 從關閉到開啟
      await this.initializeWasm();
    }
  }
} 