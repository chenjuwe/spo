/**
 * 多層級特徵融合系統
 * 結合低級特徵（哈希）、中級特徵（顏色直方圖、紋理）和高級特徵（深度學習）
 */

import { HashResult } from './integratedHasher';
import { calculateHashSimilarity } from './integratedHasher';
import { calculateCosineSimilarity } from './dimensionReduction';
import { getFeatureExtractor } from './deepFeatureExtractor';

/**
 * 特徵級別枚舉
 */
export enum FeatureLevel {
  LOW = 'low',     // 低級特徵：感知哈希、差值哈希等
  MID = 'mid',     // 中級特徵：顏色直方圖、紋理特徵
  HIGH = 'high'    // 高級特徵：深度學習特徵
}

/**
 * 多層級特徵
 */
export interface MultiLevelFeature {
  /**
   * 圖像 ID
   */
  id: string;
  
  /**
   * 低級特徵（哈希）
   */
  lowLevelFeatures?: HashResult;
  
  /**
   * 中級特徵（顏色、紋理）
   */
  midLevelFeatures?: {
    colorHistogram?: number[];
    textureFeatures?: number[];
  };
  
  /**
   * 高級特徵（深度學習）
   */
  highLevelFeatures?: number[];
  
  /**
   * 元數據（可以存儲圖像相關信息）
   */
  metadata?: any;
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
 * 特徵融合選項
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
}

/**
 * 默認特徵融合選項
 */
export const DEFAULT_FUSION_OPTIONS: FeatureFusionOptions = {
  weights: DEFAULT_FUSION_WEIGHTS,
  similarityThreshold: 90,
  useAdaptiveWeights: true,
  usedLevels: [FeatureLevel.LOW, FeatureLevel.MID, FeatureLevel.HIGH]
};

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
  lowLevelFeatures?: HashResult,
  midLevelFeatures?: { colorHistogram?: number[], textureFeatures?: number[] },
  highLevelFeatures?: number[],
  metadata?: any
): MultiLevelFeature {
  return {
    id,
    lowLevelFeatures,
    midLevelFeatures,
    highLevelFeatures,
    metadata
  };
} 