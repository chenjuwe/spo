/**
 * 多層級特徵融合模組
 * 
 * 此模組提供用於從影像中提取多種級別特徵並融合它們的功能
 * 幫助增強相似度計算的準確性
 */

import { PhotoFile, HashResult } from './types';
import { errorHandler, ErrorType, ErrorSeverity } from './errorHandlingService';

/**
 * 特徵級別枚舉
 */
export enum FeatureLevel {
  /**
   * 低級特徵 - 基於哈希的特徵
   * 適用於快速比較和初步篩選
   */
  LOW = 'LOW',
  
  /**
   * 中級特徵 - 顏色和紋理特徵
   * 提供比哈希更詳細的比較
   */
  MID = 'MID',
  
  /**
   * 高級特徵 - 基於深度學習的特徵
   * 提供語義層面的比較
   */
  HIGH = 'HIGH'
}

/**
 * 多級別特徵介面
 */
export interface MultiLevelFeature {
  /**
   * 特徵 ID (通常與照片 ID 相同)
   */
  id: string;
  
  /**
   * 低級特徵 - 使用各種哈希
   */
  lowLevelFeatures?: HashResult | undefined;
  
  /**
   * 中級特徵 - 顏色直方圖和紋理描述符
   */
  midLevelFeatures?: {
    colorHistogram?: number[] | undefined;
    textureFeatures?: number[] | undefined;
  } | undefined;
  
  /**
   * 高級特徵 - 深度學習模型提取的特徵向量
   * 例如從 MobileNet 或其他 CNN 模型提取
   */
  highLevelFeatures?: number[] | undefined;
  
  /**
   * 額外的元數據
   */
  metadata?: {
    /**
     * 原始照片
     */
    photo: PhotoFile;
    
    /**
     * 提取時間戳
     */
    timestamp?: number | undefined;
    
    /**
     * 特徵提取花費的時間（毫秒）
     */
    extractionTime?: number | undefined;
    
    /**
     * 使用的模型信息（對於高級特徵）
     */
    modelInfo?: {
      name: string;
      version: string;
    } | undefined;
  } | undefined;
}

/**
 * 特徵相似度結果介面
 */
export interface FeatureSimilarityResult {
  /**
   * 兩個特徵之間的總體相似度得分 (0-1)
   */
  similarityScore: number;
  
  /**
   * 各級別特徵的相似度得分
   */
  levelScores?: {
    low?: number;
    mid?: number;
    high?: number;
  };
  
  /**
   * 比較的特徵 ID
   */
  comparedFeatureIds: [string, string];
  
  /**
   * 用於計算相似度的特徵級別
   */
  levelsUsed: FeatureLevel[];
}

/**
 * 特徵融合權重配置
 */
export interface FeatureFusionWeights {
  /**
   * 低級特徵權重
   */
  lowLevelWeight: number;
  
  /**
   * 中級特徵權重
   */
  midLevelWeight: number;
  
  /**
   * 高級特徵權重
   */
  highLevelWeight: number;
  
  /**
   * 中級特徵內部權重
   */
  midLevelInternalWeights?: {
    colorWeight: number;
    textureWeight: number;
  };
}

/**
 * 特徵融合配置選項
 */
export interface FeatureFusionOptions {
  /**
   * 融合權重
   */
  weights: FeatureFusionWeights;
  
  /**
   * 相似度閾值 (0-100)
   */
  similarityThreshold: number;
  
  /**
   * 自適應權重
   */
  useAdaptiveWeights: boolean;
  
  /**
   * 使用的特徵級別
   */
  usedLevels: FeatureLevel[];
  
  /**
   * 深度學習模型選項
   */
  modelOptions?: {
    modelType: 'mobilenet' | 'efficientnet' | 'custom';
    modelPath?: string;
    inputSize?: number;
    useGPU?: boolean;
  };
}

/**
 * 默認特徵融合權重
 */
export const DEFAULT_FUSION_WEIGHTS: FeatureFusionWeights = {
  lowLevelWeight: 0.30,
  midLevelWeight: 0.30,
  highLevelWeight: 0.40,
  midLevelInternalWeights: {
    colorWeight: 0.6,
    textureWeight: 0.4
  }
};

/**
 * 默認特徵融合選項
 */
export const DEFAULT_FUSION_OPTIONS: FeatureFusionOptions = {
  weights: DEFAULT_FUSION_WEIGHTS,
  similarityThreshold: 90,
  useAdaptiveWeights: true,
  usedLevels: [FeatureLevel.LOW, FeatureLevel.MID, FeatureLevel.HIGH],
  modelOptions: {
    modelType: 'mobilenet',
    inputSize: 224,
    useGPU: true
  }
};

// 深度學習模型狀態變量
let deepLearningModelLoaded = false;
let modelLoadPromise: Promise<any> | null = null;
let deepLearningModel: any = null;

/**
 * 加載深度學習模型（如果存在TensorFlow.js）
 * 
 * @returns 加載模型的Promise
 */
async function loadDeepLearningModel(): Promise<boolean> {
  // 避免重複加載
  if (deepLearningModelLoaded) {
    return true;
  }

  // 如果已經有加載操作進行中，返回該Promise
  if (modelLoadPromise) {
    return modelLoadPromise;
  }

  // 初始化加載Promise
  modelLoadPromise = (async () => {
    try {
      // 檢查是否有 TensorFlow.js
      if (typeof window !== 'undefined' && 'tensorflow' in window) {
        // @ts-ignore - 運行時導入 TF
        const tf = (window as any).tf;
        
        // 如果TensorFlow存在，加載MobileNet模型
        console.info('[Feature Fusion] 正在加載 MobileNet 模型...');
        // @ts-ignore - 運行時訪問 mobilenet
        deepLearningModel = await tf.loadLayersModel('https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json');
        
        deepLearningModelLoaded = true;
        console.info('[Feature Fusion] MobileNet 模型加載成功');
        return true;
      } else {
        console.warn('[Feature Fusion] 未找到 TensorFlow.js，將使用模擬的深度特徵');
        return false;
      }
    } catch (error) {
      console.error('[Feature Fusion] 加載深度學習模型失敗:', error);
      
      errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorType.SYSTEM_ERROR,
        '加載深度學習模型失敗，將使用模擬的特徵向量',
        true,
        undefined,
        ErrorSeverity.LOW
      );
      
      return false;
    } finally {
      modelLoadPromise = null;
    }
  })();

  return modelLoadPromise;
}

/**
 * 使用深度學習模型提取特徵（如果可用）
 * 
 * @param imageElement HTML Image 元素
 * @returns 特徵向量
 */
async function extractDeepFeatures(imageElement: HTMLImageElement): Promise<number[]> {
  const modelLoaded = await loadDeepLearningModel();
  
  if (modelLoaded && deepLearningModel) {
    try {
      // @ts-ignore - 運行時導入 TF
      const tf = (window as any).tf;
      
      // 準備圖像數據
      // @ts-ignore - 運行時使用TF API
      const tfImage = tf.browser.fromPixels(imageElement);
      // @ts-ignore - 運行時使用TF API
      const resizedImage = tf.image.resizeBilinear(tfImage, [224, 224]);
      // @ts-ignore - 運行時使用TF API
      const normalizedImage = resizedImage.div(255).expandDims();
      
      // 提取特徵
      // 使用倒數第二層作為特徵向量
      // @ts-ignore - 運行時使用TF API
      const intermediateModel = tf.model({
        inputs: deepLearningModel.inputs,
        outputs: deepLearningModel.layers[deepLearningModel.layers.length - 2].output
      });
      
      // @ts-ignore - 運行時使用TF API
      const features = intermediateModel.predict(normalizedImage);
      // @ts-ignore - 運行時使用TF API
      const featureData = await features.data();
      // 顯式類型轉換確保類型安全
      const featureArray = Array.from(featureData).map(val => Number(val));
      
      // 釋放 TF 張量
      // @ts-ignore - 運行時使用TF API
      tfImage.dispose();
      // @ts-ignore - 運行時使用TF API
      resizedImage.dispose();
      // @ts-ignore - 運行時使用TF API
      normalizedImage.dispose();
      // @ts-ignore - 運行時使用TF API
      features.dispose();
      
      return featureArray;
    } catch (error) {
      console.error('[Feature Fusion] 提取深度特徵時出錯:', error);
      
      errorHandler.handleError(
        error instanceof Error ? error : new Error(String(error)),
        ErrorType.PHOTO_EXTRACTION_ERROR,
        '提取深度學習特徵時出錯，將使用模擬的特徵向量',
        true,
        undefined,
        ErrorSeverity.LOW
      );
    }
  }
  
  // 如果模型不可用或提取失敗，使用模擬數據
  const featureLength = 128;
  console.warn(`[Feature Fusion] 使用模擬的 ${featureLength} 維度特徵向量`);
  
  // 使用偽隨機數生成器，但基於圖像的一些屬性
  const seed = imageElement.width * imageElement.height + imageElement.naturalWidth;
  const rng = makeSeededRNG(seed);
  
  return Array(featureLength).fill(0).map(() => rng() * 2 - 1);
}

/**
 * 創建一個基於種子的偽隨機數生成器
 * 
 * @param seed 種子值
 * @returns 隨機數生成函數
 */
function makeSeededRNG(seed: number): () => number {
  let s = seed;
  return function() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * 計算餘弦相似度
 * 
 * @param vec1 向量1
 * @param vec2 向量2
 * @returns 餘弦相似度 (0-1)
 */
export function calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
  if (vec1.length !== vec2.length) {
    throw new Error('向量長度不匹配');
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }

  // 避免除以零
  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * 計算哈希相似度
 * 
 * @param hash1 哈希1
 * @param hash2 哈希2
 * @returns 相似度 (0-100)
 */
export function calculateHashSimilarity(hash1: HashResult, hash2: HashResult): number {
  // 檢查兩個哈希是否有共同的類型
  let similarity = 0;
  let count = 0;

  // 遍歷哈希類型
  for (const type in hash1) {
    if (hash1[type] && hash2[type]) {
      // 計算漢明距離
      const hash1Value = hash1[type] as string;
      const hash2Value = hash2[type] as string;
      if (hash1Value && hash2Value) {
        const distance = hammingDistance(hash1Value, hash2Value);
        // 轉換為相似度 (0-100)
        const hashSimilarity = (1 - distance / hash1Value.length) * 100;
        similarity += hashSimilarity;
        count++;
      }
    }
  }

  // 如果沒有共同的哈希類型，返回0
  if (count === 0) {
    return 0;
  }

  // 返回平均相似度
  return similarity / count;
}

/**
 * 計算漢明距離（優化版）
 * 
 * @param str1 字符串1
 * @param str2 字符串2
 * @returns 漢明距離
 */
function hammingDistance(str1: string, str2: string): number {
  if (str1.length !== str2.length) {
    throw new Error('字符串長度不匹配');
  }

  let distance = 0;
  
  // 對於較長的哈希，使用位運算加速
  if (str1.length > 32 && /^[01]+$/.test(str1) && /^[01]+$/.test(str2)) {
    // 分塊計算，每32位一組
    for (let i = 0; i < str1.length; i += 32) {
      const end = Math.min(i + 32, str1.length);
      const chunk1 = parseInt(str1.substring(i, end), 2);
      const chunk2 = parseInt(str2.substring(i, end), 2);
      
      // 使用XOR和位計數來計算不同位的數量
      let diff = chunk1 ^ chunk2;
      while (diff) {
        distance += diff & 1;
        diff >>= 1;
      }
    }
  } else {
    // 對於較短或非二進制哈希，使用標準方法
    for (let i = 0; i < str1.length; i++) {
      if (str1[i] !== str2[i]) {
        distance++;
      }
    }
  }

  return distance;
}

/**
 * 多層級特徵融合系統
 * 結合不同級別的特徵進行相似度計算
 */
export class MultiLevelFeatureFusion {
  private features: Map<string, MultiLevelFeature> = new Map();
  private options: FeatureFusionOptions;
  
  /**
   * 構造函數
   * @param options 特徵融合選項
   */
  constructor(options: Partial<FeatureFusionOptions> = {}) {
    this.options = { ...DEFAULT_FUSION_OPTIONS, ...options };
    
    // 初始化深度學習模型（如果需要高級特徵）
    if (this.options.usedLevels.includes(FeatureLevel.HIGH)) {
      // 非同步加載模型
      loadDeepLearningModel().catch(err => 
        console.error('[MultiLevelFeatureFusion] 加載深度學習模型失敗:', err)
      );
    }
  }
  
  /**
   * 添加特徵
   * @param feature 多層級特徵
   */
  public addFeature(feature: MultiLevelFeature): void {
    this.features.set(feature.id, feature);
  }
  
  /**
   * 批量添加特徵
   * @param features 多層級特徵數組
   */
  public addFeatures(features: MultiLevelFeature[]): void {
    for (const feature of features) {
      this.addFeature(feature);
    }
  }
  
  /**
   * 計算自適應權重
   * 基於特徵的可用性和分布情況動態調整權重
   * @param feature1 第一個特徵
   * @param feature2 第二個特徵
   * @returns 調整後的權重
   */
  private calculateAdaptiveWeights(
    feature1: MultiLevelFeature,
    feature2: MultiLevelFeature
  ): FeatureFusionWeights {
    // 獲取基礎權重
    const baseWeights = { ...this.options.weights };
    
    // 如果不使用自適應權重，直接返回基礎權重
    if (!this.options.useAdaptiveWeights) {
      return baseWeights;
    }
    
    // 計算每個級別的可用性
    const lowLevelAvailable = !!(feature1.lowLevelFeatures && feature2.lowLevelFeatures);
    const midLevelAvailable = !!(feature1.midLevelFeatures && feature2.midLevelFeatures);
    const highLevelAvailable = !!(feature1.highLevelFeatures && feature2.highLevelFeatures);
    
    // 計算可用的級別數量
    const availableLevels = [lowLevelAvailable, midLevelAvailable, highLevelAvailable]
      .filter(Boolean).length;
    
    // 如果沒有可用級別，返回默認權重
    if (availableLevels === 0) {
      return baseWeights;
    }
    
    // 調整權重 - 將不可用級別的權重重新分配給可用級別
    let adjustedWeights = { ...baseWeights };
    let unusedWeight = 0;
    
    if (!lowLevelAvailable) {
      unusedWeight += adjustedWeights.lowLevelWeight;
      adjustedWeights.lowLevelWeight = 0;
    }
    
    if (!midLevelAvailable) {
      unusedWeight += adjustedWeights.midLevelWeight;
      adjustedWeights.midLevelWeight = 0;
    }
    
    if (!highLevelAvailable) {
      unusedWeight += adjustedWeights.highLevelWeight;
      adjustedWeights.highLevelWeight = 0;
    }
    
    // 分配未使用的權重
    if (unusedWeight > 0 && availableLevels > 0) {
      const weightIncrement = unusedWeight / availableLevels;
      
      if (lowLevelAvailable) {
        adjustedWeights.lowLevelWeight += weightIncrement;
      }
      
      if (midLevelAvailable) {
        adjustedWeights.midLevelWeight += weightIncrement;
      }
      
      if (highLevelAvailable) {
        adjustedWeights.highLevelWeight += weightIncrement;
      }
    }
    
    return adjustedWeights;
  }
  
  /**
   * 計算兩個特徵的相似度
   * @param feature1 第一個特徵
   * @param feature2 第二個特徵
   * @returns 相似度 (0-100) 和使用的方法
   */
  public calculateSimilarity(
    feature1: MultiLevelFeature,
    feature2: MultiLevelFeature
  ): { similarity: number; method: string } {
    // 獲取調整後的權重
    const weights = this.calculateAdaptiveWeights(feature1, feature2);
    
    // 存儲各層級的相似度結果
    let lowLevelSimilarity = 0;
    let midLevelSimilarity = 0;
    let highLevelSimilarity = 0;
    
    // 計算低級特徵相似度（哈希）
    if (
      this.options.usedLevels.includes(FeatureLevel.LOW) &&
      feature1.lowLevelFeatures && 
      feature2.lowLevelFeatures
    ) {
      lowLevelSimilarity = calculateHashSimilarity(
        feature1.lowLevelFeatures,
        feature2.lowLevelFeatures
      );
    }
    
    // 計算中級特徵相似度（顏色、紋理）
    if (
      this.options.usedLevels.includes(FeatureLevel.MID) &&
      feature1.midLevelFeatures && 
      feature2.midLevelFeatures
    ) {
      let colorSimilarity = 0;
      let textureSimilarity = 0;
      
      // 顏色相似度
      if (
        feature1.midLevelFeatures.colorHistogram && 
        feature2.midLevelFeatures.colorHistogram
      ) {
        colorSimilarity = calculateCosineSimilarity(
          feature1.midLevelFeatures.colorHistogram,
          feature2.midLevelFeatures.colorHistogram
        ) * 100; // 轉換為 0-100 範圍
      }
      
      // 紋理相似度
      if (
        feature1.midLevelFeatures.textureFeatures && 
        feature2.midLevelFeatures.textureFeatures
      ) {
        textureSimilarity = calculateCosineSimilarity(
          feature1.midLevelFeatures.textureFeatures,
          feature2.midLevelFeatures.textureFeatures
        ) * 100; // 轉換為 0-100 範圍
      }
      
      // 使用內部權重組合顏色和紋理相似度
      const midWeights = weights.midLevelInternalWeights || { colorWeight: 0.6, textureWeight: 0.4 };
      
      // 檢查哪些特徵可用
      const colorAvailable = !!(feature1.midLevelFeatures.colorHistogram && feature2.midLevelFeatures.colorHistogram);
      const textureAvailable = !!(feature1.midLevelFeatures.textureFeatures && feature2.midLevelFeatures.textureFeatures);
      
      // 調整內部權重
      if (colorAvailable && textureAvailable) {
        midLevelSimilarity = colorSimilarity * midWeights.colorWeight + textureSimilarity * midWeights.textureWeight;
      } else if (colorAvailable) {
        midLevelSimilarity = colorSimilarity;
      } else if (textureAvailable) {
        midLevelSimilarity = textureSimilarity;
      }
    }
    
    // 計算高級特徵相似度（深度學習）
    if (
      this.options.usedLevels.includes(FeatureLevel.HIGH) &&
      feature1.highLevelFeatures && 
      feature2.highLevelFeatures &&
      feature1.highLevelFeatures.length > 0 &&
      feature2.highLevelFeatures.length === feature1.highLevelFeatures.length
    ) {
      highLevelSimilarity = calculateCosineSimilarity(
        feature1.highLevelFeatures,
        feature2.highLevelFeatures
      ) * 100; // 轉換為 0-100 範圍
    }
    
    // 組合所有級別的相似度
    const totalSimilarity = 
      lowLevelSimilarity * weights.lowLevelWeight +
      midLevelSimilarity * weights.midLevelWeight +
      highLevelSimilarity * weights.highLevelWeight;
    
    // 確定使用的方法
    let method = 'fusion';
    if (weights.lowLevelWeight === 1) method = 'hash';
    else if (weights.midLevelWeight === 1) method = 'color_texture';
    else if (weights.highLevelWeight === 1) method = 'deep_learning';
    
    // 返回結果
    return {
      similarity: Math.round(totalSimilarity * 10) / 10, // 四捨五入到小數點後一位
      method
    };
  }
  
  /**
   * 查找與特定 ID 相似的特徵
   * @param id 特徵 ID
   * @param threshold 相似度閾值
   * @returns 相似特徵及其相似度
   */
  public findSimilarFeatures(
    id: string,
    threshold: number = this.options.similarityThreshold
  ): { id: string; similarity: number; method: string }[] {
    const feature = this.features.get(id);
    
    if (!feature) {
      throw new Error(`找不到 ID 為 ${id} 的特徵`);
    }
    
    const results: { id: string; similarity: number; method: string }[] = [];
    
    // 比較與所有其他特徵的相似度
    for (const [candidateId, candidateFeature] of this.features.entries()) {
      // 跳過自身
      if (candidateId === id) continue;
      
      // 計算相似度
      const { similarity, method } = this.calculateSimilarity(feature, candidateFeature);
      
      // 如果超過閾值，添加到結果
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
  }
  
  /**
   * 查找所有相似特徵組
   * @param threshold 相似度閾值
   * @returns 相似特徵組
   */
  public findSimilarGroups(
    threshold: number = this.options.similarityThreshold
  ): { keyId: string; similarFeatures: { id: string; similarity: number; method: string }[] }[] {
    const groups: { keyId: string; similarFeatures: { id: string; similarity: number; method: string }[] }[] = [];
    const processedIds = new Set<string>();
    
    // 遍歷所有特徵
    for (const id of this.features.keys()) {
      // 如果已經在某個組中，跳過
      if (processedIds.has(id)) continue;
      
      // 查找相似特徵
      const similarFeatures = this.findSimilarFeatures(id, threshold);
      
      // 如果有相似特徵，創建一個組
      if (similarFeatures.length > 0) {
        groups.push({
          keyId: id,
          similarFeatures
        });
        
        // 標記處理過的特徵
        processedIds.add(id);
        for (const { id: similarId } of similarFeatures) {
          processedIds.add(similarId);
        }
      }
    }
    
    return groups;
  }
  
  /**
   * 提取特徵級別掩碼
   * 用於確定可用的特徵級別
   * @param feature 多層級特徵
   * @returns 掩碼值 (位元表示)
   */
  private getFeatureLevelMask(feature: MultiLevelFeature): number {
    let mask = 0;
    
    // 檢查低級特徵
    if (feature.lowLevelFeatures) {
      mask |= 1; // 0001
    }
    
    // 檢查中級特徵
    if (feature.midLevelFeatures) {
      if (feature.midLevelFeatures.colorHistogram) {
        mask |= 2; // 0010 (顏色)
      }
      if (feature.midLevelFeatures.textureFeatures) {
        mask |= 4; // 0100 (紋理)
      }
    }
    
    // 檢查高級特徵
    if (feature.highLevelFeatures && feature.highLevelFeatures.length > 0) {
      mask |= 8; // 1000 (深度學習)
    }
    
    return mask;
  }
  
  /**
   * 根據特徵掩碼獲取最佳權重配置
   * @param mask1 第一個特徵掩碼
   * @param mask2 第二個特徵掩碼
   * @returns 權重配置
   */
  private getWeightsByMask(mask1: number, mask2: number): FeatureFusionWeights {
    // 組合掩碼 (取交集)
    const combinedMask = mask1 & mask2;
    
    // 基於可用特徵設置權重
    const weights: FeatureFusionWeights = {
      lowLevelWeight: 0,
      midLevelWeight: 0,
      highLevelWeight: 0,
      midLevelInternalWeights: {
        colorWeight: 0,
        textureWeight: 0
      }
    };
    
    // 計算可用的特徵數量
    let availableFeatures = 0;
    
    // 低級特徵 (位 0)
    if (combinedMask & 1) {
      availableFeatures++;
    }
    
    // 中級特徵 - 顏色 (位 1)
    const hasColor = !!(combinedMask & 2);
    if (hasColor) {
      availableFeatures++;
    }
    
    // 中級特徵 - 紋理 (位 2)
    const hasTexture = !!(combinedMask & 4);
    if (hasTexture) {
      availableFeatures++;
    }
    
    // 高級特徵 (位 3)
    if (combinedMask & 8) {
      availableFeatures++;
    }
    
    // 設置權重
    if (availableFeatures === 0) {
      // 如果沒有可用特徵，返回默認權重
      return DEFAULT_FUSION_WEIGHTS;
    }
    
    // 權重計算
    if (combinedMask & 1) { // 低級特徵
      weights.lowLevelWeight = 1 / availableFeatures;
    }
    
    // 計算中級特徵權重
    const midLevelAvailable = hasColor || hasTexture;
    if (midLevelAvailable) {
      weights.midLevelWeight = 1 / availableFeatures;
      
      // 設置內部權重
      const availableMidFeatures = Number(hasColor) + Number(hasTexture);
      if (availableMidFeatures > 0) {
        if (hasColor) {
          weights.midLevelInternalWeights!.colorWeight = 1 / availableMidFeatures;
        }
        if (hasTexture) {
          weights.midLevelInternalWeights!.textureWeight = 1 / availableMidFeatures;
        }
      }
    }
    
    if (combinedMask & 8) { // 高級特徵
      weights.highLevelWeight = 1 / availableFeatures;
    }
    
    return weights;
  }
  
  /**
   * 獲取特徵
   * @param id 特徵 ID
   */
  public getFeature(id: string): MultiLevelFeature | undefined {
    return this.features.get(id);
  }
  
  /**
   * 移除特徵
   * @param id 特徵 ID
   */
  public removeFeature(id: string): boolean {
    return this.features.delete(id);
  }
  
  /**
   * 清空所有特徵
   */
  public clear(): void {
    this.features.clear();
  }
  
  /**
   * 獲取特徵數量
   */
  public size(): number {
    return this.features.size;
  }
  
  /**
   * 更新選項
   * @param options 新選項
   */
  public updateOptions(options: Partial<FeatureFusionOptions>): void {
    this.options = { ...this.options, ...options };
  }
  
  /**
   * 從圖像中提取高級特徵
   * @param imageElement 圖像元素
   * @returns 特徵向量
   */
  public async extractHighLevelFeatures(imageElement: HTMLImageElement): Promise<number[]> {
    // 使用TF.js或其他深度學習模型提取特徵
    return extractDeepFeatures(imageElement);
  }
}

/**
 * 創建多層級特徵
 * @param id 特徵 ID
 * @param lowLevelFeatures 低級特徵 (哈希)
 * @param midLevelFeatures 中級特徵 (顏色、紋理)
 * @param highLevelFeatures 高級特徵 (深度學習)
 * @param metadata 元數據
 * @returns 多層級特徵對象
 */
export function createMultiLevelFeature(
  id: string,
  lowLevelFeatures?: HashResult | undefined,
  midLevelFeatures?: { colorHistogram?: number[], textureFeatures?: number[] } | undefined,
  highLevelFeatures?: number[] | undefined,
  metadata?: any
): MultiLevelFeature {
  return {
    id,
    lowLevelFeatures,
    midLevelFeatures,
    highLevelFeatures,
    metadata: {
      ...metadata,
      timestamp: Date.now()
    }
  };
} 