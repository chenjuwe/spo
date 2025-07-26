/**
 * 增強圖像相似性系統
 * 整合深度學習模型和多層級特徵融合
 * 
 * @module enhancedImageSimilarity
 */

import { PhotoFile } from "../lib/types";
import { HashResult, calculateMultipleHashes } from "./integratedHasher";
import { getFeatureExtractor, DeepFeatureExtractor } from "./deepFeatureExtractor";
import { 
  MultiLevelFeatureFusion, 
  MultiLevelFeature, 
  createMultiLevelFeature,
  FeatureFusionOptions, 
  FeatureLevel 
} from "./multiLevelFeatureFusion";
import { ErrorType, ErrorSeverity } from "./errorHandlingService";
import { handleError } from "./utils";

/**
 * 為EnhancedImageSimilaritySystem擴展類型定義
 */
declare module "./enhancedImageSimilarity" {
  interface EnhancedImageSimilaritySystem {
    extractMultiLevelFeatures(photo: PhotoFile): Promise<MultiLevelFeature | null>;
  }
}

/**
 * 增強型相似度組
 */
export interface EnhancedSimilarityGroup {
  /**
   * 主要照片
   */
  keyPhoto: PhotoFile;
  
  /**
   * 相似照片列表
   */
  similarPhotos: Array<{
    photo: PhotoFile;
    similarity: number;
    method: string;
  }>;
}

/**
 * 增強相似度計算選項
 */
export interface EnhancedSimilarityOptions {
  /**
   * 相似度閾值 (0-100)
   */
  threshold: number;
  
  /**
   * 是否使用深度特徵
   */
  useDeepFeatures: boolean;
  
  /**
   * 使用的特徵級別
   */
  enabledLevels: FeatureLevel[];
  
  /**
   * 特徵融合選項
   */
  fusionOptions?: Partial<FeatureFusionOptions>;
  
  /**
   * 批處理大小
   */
  batchSize?: number;
  
  /**
   * 最大並行任務數
   */
  maxParallelTasks?: number;
  
  /**
   * 是否顯示進度日誌
   */
  showProgress?: boolean;
}

/**
 * 默認增強相似度選項
 */
export const DEFAULT_ENHANCED_OPTIONS: EnhancedSimilarityOptions = {
  threshold: 90,
  useDeepFeatures: true,
  enabledLevels: [FeatureLevel.LOW, FeatureLevel.MID, FeatureLevel.HIGH],
  batchSize: 20,
  maxParallelTasks: 4,
  showProgress: true
};

/**
 * 增強圖像相似性系統
 * 使用多層級特徵融合和深度學習特徵
 */
export class EnhancedImageSimilaritySystem {
  /**
   * 多層級特徵融合系統
   */
  private fusion: MultiLevelFeatureFusion;
  
  /**
   * 深度特徵提取器
   */
  private featureExtractor: DeepFeatureExtractor | null = null;
  
  /**
   * 系統選項
   */
  private options: EnhancedSimilarityOptions;
  
  /**
   * 圖像 ID 到 PhotoFile 的映射
   */
  private photoMap: Map<string, PhotoFile> = new Map();
  
  /**
   * 構造函數
   * @param options 增強相似度選項
   */
  constructor(options: Partial<EnhancedSimilarityOptions> = {}) {
    // 合併選項
    this.options = { ...DEFAULT_ENHANCED_OPTIONS, ...options };
    
    // 創建融合系統
    this.fusion = new MultiLevelFeatureFusion(
      this.options.fusionOptions || {
        similarityThreshold: this.options.threshold,
        usedLevels: this.options.enabledLevels
      }
    );
    
    // 如果啟用深度特徵，初始化特徵提取器
    if (this.options.useDeepFeatures && this.options.enabledLevels.includes(FeatureLevel.HIGH)) {
      this.initializeFeatureExtractor();
    }
  }
  
  /**
   * 初始化深度特徵提取器
   */
  private async initializeFeatureExtractor(): Promise<boolean> {
    try {
      if (!this.featureExtractor) {
        this.featureExtractor = getFeatureExtractor();
      }
      
      return await this.featureExtractor.initialize();
    } catch (error) {
      console.error('初始化深度特徵提取器失敗:', error);
      return false;
    }
  }
  
  /**
   * 處理單個照片
   * @param photo 照片
   * @returns 多層級特徵
   */
  public async processPhoto(photo: PhotoFile): Promise<MultiLevelFeature> {
    try {
      // 檢查輸入
      if (!photo || !photo.id) {
        throw new Error('無效的照片物件');
      }

      // 儲存照片對象
      this.photoMap.set(photo.id, photo);
      
      // 提取多層級特徵
      const feature = await this.extractMultiLevelFeatures(photo);
      
      // 若特徵存在，則添加到融合系統
      if (feature) {
        this.fusion.addFeature(feature);
        return feature;
      }
      
      // 若特徵提取失敗，返回基本特徵
      const basicFeature: MultiLevelFeature = {
        id: photo.id,
        metadata: { photo }
      };
      
      this.fusion.addFeature(basicFeature);
      return basicFeature;
    } catch (error) {
      // 使用新的統一錯誤處理函數
      const errorDetails = `無法提取照片特徵: ${photo?.file?.name || '未知檔案'}`;
      handleError(
        error,
        ErrorType.PHOTO_PROCESSING_ERROR,
        errorDetails,
        true,
        undefined,
        ErrorSeverity.MEDIUM
      );
      
      // 返回只有 ID 的基本特徵
      const basicFeature: MultiLevelFeature = {
        id: photo.id || `unknown-${Date.now()}`,
        metadata: { photo }
      };
      
      this.fusion.addFeature(basicFeature);
      return basicFeature;
    }
  }
  
  /**
   * 提取照片的多層級特徵
   * @param photo 照片
   * @returns 多層級特徵
   */
  public async extractMultiLevelFeatures(photo: PhotoFile): Promise<MultiLevelFeature | null> {
    try {
      // 檢查輸入參數
      if (!photo || !photo.id) {
        throw new Error('無效的照片物件');
      }
      
      // 定義特徵變數
      let lowLevelFeatures: HashResult | undefined = undefined;
      let midLevelFeatures: { colorHistogram?: number[], textureFeatures?: number[] } | undefined = undefined;
      let highLevelFeatures: number[] | undefined = undefined;
      
      // 提取低級特徵 (哈希)
      if (this.options.enabledLevels.includes(FeatureLevel.LOW)) {
        lowLevelFeatures = await this.extractLowLevelFeatures(photo);
      }
      
      // 提取中級特徵 (顏色和紋理)
      if (this.options.enabledLevels.includes(FeatureLevel.MID)) {
        midLevelFeatures = await this.extractMidLevelFeatures(photo);
      }
      
      // 提取高級特徵 (深度學習)
      if (
        this.options.enabledLevels.includes(FeatureLevel.HIGH) && 
        this.options.useDeepFeatures
      ) {
        // 確保特徵提取器已初始化
        if (this.featureExtractor !== null) {
          highLevelFeatures = await this.extractHighLevelFeatures(photo);
        } else {
          console.warn('深度特徵提取器未初始化，跳過高級特徵提取');
        }
      }
      
      // 創建多層級特徵
      return createMultiLevelFeature(
        photo.id,
        lowLevelFeatures,
        midLevelFeatures,
        highLevelFeatures,
        { photo }
      );
    } catch (error) {
      const photoId = photo?.id || '未知ID';
      const errorMessage = `提取照片 ${photoId} 的多層級特徵失敗`;
      console.error(`${errorMessage}:`, error);
      
      // 使用新的統一錯誤處理函數
      handleError(
        error,
        ErrorType.PHOTO_EXTRACTION_ERROR,
        errorMessage,
        false
      );
      
      return null;
    }
  }
  
  /**
   * 批量處理照片
   * @param photos 照片數組
   * @returns 處理完成的照片數量
   */
  public async processPhotos(photos: PhotoFile[]): Promise<number> {
    try {
      // 檢查輸入參數
      if (!photos || !Array.isArray(photos)) {
        throw new Error('無效的照片陣列');
      }
      
      const batchSize = this.options.batchSize || 20;
      const maxParallelTasks = this.options.maxParallelTasks || 4;
      let processedCount = 0;
      
      // 清空之前的數據
      this.fusion.clear();
      this.photoMap.clear();
      
      // 分批處理
      for (let i = 0; i < photos.length; i += batchSize) {
        const batch = photos.slice(i, i + batchSize);
        
        // 並行處理批次，但限制最大並行數
        for (let j = 0; j < batch.length; j += maxParallelTasks) {
          const tasks = batch
            .slice(j, j + maxParallelTasks)
            .map(photo => this.processPhoto(photo));
          
          await Promise.all(tasks);
          processedCount += tasks.length;
          
          // 顯示進度
          if (this.options.showProgress) {
            const progress = Math.round((processedCount / photos.length) * 100);
            console.info(`照片處理進度: ${progress}% (${processedCount}/${photos.length})`);
          }
        }
      }
      
      return processedCount;
    } catch (error) {
      // 使用新的統一錯誤處理函數
      handleError(
        error,
        ErrorType.SYSTEM_ERROR,
        "批量處理照片失敗",
        false
      );
      
      return 0;
    }
  }
  
  /**
   * 提取低級特徵 (哈希)
   * @param photo 照片
   * @returns 哈希結果
   */
  private async extractLowLevelFeatures(photo: PhotoFile): Promise<HashResult> {
    try {
      // 創建 Image 對象
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
            
            // 設置畫布大小
            const maxDimension = 256;
            const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
            const width = Math.floor(img.width * scale);
            const height = Math.floor(img.height * scale);
            
            canvas.width = width;
            canvas.height = height;
            
            // 繪製圖像
            ctx.drawImage(img, 0, 0, width, height);
            
            // 獲取圖像數據
            const imageData = ctx.getImageData(0, 0, width, height);
            
            // 計算哈希
            const hashes = calculateMultipleHashes(imageData);
            
            // 釋放資源
            canvas.width = 0;
            canvas.height = 0;
            
            // 返回結果
            resolve(hashes);
          } catch (error) {
            reject(error);
          }
        };
        
        img.onerror = () => {
          reject(new Error(`無法加載圖片 ${photo.file.name}`));
        };
        
        // 設置圖片源
        img.src = photo.preview;
      });
    } catch (error) {
      console.error(`計算照片哈希失敗: ${photo.file.name}`, error);
      return {};
    }
  }
  
  /**
   * 提取中級特徵 (顏色和紋理)
   * @param photo 照片
   * @returns 中級特徵對象
   */
  private async extractMidLevelFeatures(
    photo: PhotoFile
  ): Promise<{ colorHistogram?: number[], textureFeatures?: number[] }> {
    try {
      // 創建 Image 對象
      const img = new Image();
      
      // 返回 Promise 以支持異步操作
      return new Promise((resolve, reject) => {
        img.onload = () => {
          try {
            // 創建畫布
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            if (!ctx) {
              reject(new Error("無法獲取畫布上下文"));
              return;
            }
            
            // 設置畫布大小
            const maxDimension = 256;
            const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
            const width = Math.floor(img.width * scale);
            const height = Math.floor(img.height * scale);
            
            canvas.width = width;
            canvas.height = height;
            
            // 繪製圖像
            ctx.drawImage(img, 0, 0, width, height);
            
            // 獲取圖像數據
            const imageData = ctx.getImageData(0, 0, width, height);
            
            // 提取顏色直方圖
            const colorHistogram = this.extractColorHistogram(imageData);
            
            // 提取紋理特徵
            const textureFeatures = this.extractTextureFeatures(imageData);
            
            // 釋放資源
            canvas.width = 0;
            canvas.height = 0;
            
            // 返回結果
            resolve({ colorHistogram, textureFeatures });
          } catch (error) {
            reject(error);
          }
        };
        
        img.onerror = () => {
          reject(new Error(`無法加載圖片 ${photo.file.name}`));
        };
        
        // 設置圖片源
        img.src = photo.preview;
      });
    } catch (error) {
      console.error(`提取照片中級特徵失敗: ${photo.file.name}`, error);
      return {};
    }
  }
  
  /**
   * 提取顏色直方圖
   * @param imageData 圖像數據
   * @returns 顏色直方圖特徵
   */
  private extractColorHistogram(imageData: ImageData): number[] {
    const { data, width, height } = imageData;
    
    // 為每個通道創建直方圖
    const binCount = 8;
    const histogram = new Array(binCount * 3).fill(0); // R, G, B 三個通道
    
    // 遍歷所有像素
    for (let i = 0; i < data.length; i += 4) {
      const r = Math.floor(data[i] / 256 * binCount);
      const g = Math.floor(data[i + 1] / 256 * binCount);
      const b = Math.floor(data[i + 2] / 256 * binCount);
      
      // 增加對應的直方圖箱計數
      histogram[r]++;
      histogram[binCount + g]++;
      histogram[binCount * 2 + b]++;
    }
    
    // 歸一化直方圖
    const pixelCount = width * height;
    return histogram.map(count => count / pixelCount);
  }
  
  /**
   * 提取紋理特徵
   * @param imageData 圖像數據
   * @returns 紋理特徵
   */
  private extractTextureFeatures(imageData: ImageData): number[] {
    const { data, width, height } = imageData;
    
    // 轉換為灰度圖像
    const grayData = new Uint8ClampedArray(width * height);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      grayData[j] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    
    // 使用局部二進制模式 (LBP) 提取紋理特徵
    const numBins = 16;
    const histogram = new Array(numBins).fill(0);
    
    // 計算簡化的 LBP
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const center = grayData[y * width + x];
        let lbpValue = 0;
        
        // 計算 4 點 LBP (上下左右)
        lbpValue |= (grayData[(y - 1) * width + x] >= center) ? 1 : 0;
        lbpValue |= (grayData[(y + 1) * width + x] >= center) ? 2 : 0;
        lbpValue |= (grayData[y * width + (x - 1)] >= center) ? 4 : 0;
        lbpValue |= (grayData[y * width + (x + 1)] >= center) ? 8 : 0;
        
        // 映射到直方圖箱
        const binIndex = Math.floor(lbpValue / 16 * numBins);
        histogram[binIndex]++;
      }
    }
    
    // 歸一化
    const totalPixels = (height - 2) * (width - 2);
    return histogram.map(count => count / totalPixels);
  }
  
  /**
   * 提取高級特徵 (深度學習)
   * @param photo 照片
   * @returns 深度學習特徵向量
   */
  private async extractHighLevelFeatures(photo: PhotoFile): Promise<number[]> {
    try {
      // 確保特徵提取器已初始化
      if (!this.featureExtractor) {
        const initialized = await this.initializeFeatureExtractor();
        if (!initialized) {
          throw new Error('深度特徵提取器初始化失敗');
        }
      }
      
      // 提取特徵
      const features = await this.featureExtractor.extractAndReduceFeatures(
        photo.preview,
        128
      );
      
      return features;
    } catch (error) {
      console.error(`提取照片高級特徵失敗: ${photo.file.name}`, error);
      return [];
    }
  }
  
  /**
   * 查找相似照片組
   * @param threshold 相似度閾值 (可選，默認使用構造函數中的閾值)
   * @returns 相似照片組
   */
  public findSimilarGroups(threshold?: number): EnhancedSimilarityGroup[] {
    try {
      // 使用多層級特徵融合系統查找相似組
      const similarGroups = this.fusion.findSimilarGroups(
        threshold || this.options.threshold
      );
      
      // 轉換為增強型相似度組
      const enhancedGroups: EnhancedSimilarityGroup[] = [];
      
      for (const group of similarGroups) {
        const keyPhotoFeature = this.fusion.getFeature(group.keyId);
        
        if (!keyPhotoFeature || !keyPhotoFeature.metadata?.photo) {
          continue; // 跳過無效組
        }
        
        // 創建增強型相似組
        const enhancedGroup: EnhancedSimilarityGroup = {
          keyPhoto: keyPhotoFeature.metadata.photo,
          similarPhotos: []
        };
        
        // 添加相似照片
        for (const similar of group.similarFeatures) {
          const similarFeature = this.fusion.getFeature(similar.id);
          
          if (similarFeature && similarFeature.metadata?.photo) {
            enhancedGroup.similarPhotos.push({
              photo: similarFeature.metadata.photo,
              similarity: similar.similarity,
              method: similar.method
            });
          }
        }
        
        // 如果有相似照片，添加到結果
        if (enhancedGroup.similarPhotos.length > 0) {
          enhancedGroups.push(enhancedGroup);
        }
      }
      
      return enhancedGroups;
    } catch (error) {
      handleError({
        type: ErrorType.SYSTEM_ERROR,
        message: "查找相似照片組失敗",
        details: `查找相似照片組時發生錯誤: ${error}`,
        timestamp: new Date(),
        recoverable: false,
        technicalDetails: error
      });
      
      return [];
    }
  }
  
  /**
   * 比較兩張照片
   * @param photo1 第一張照片
   * @param photo2 第二張照片
   * @returns 相似度結果
   */
  public async compareTwoPhotos(
    photo1: PhotoFile,
    photo2: PhotoFile
  ): Promise<{ similarity: number; method: string }> {
    try {
      // 處理兩張照片
      const feature1 = await this.processPhoto(photo1);
      const feature2 = await this.processPhoto(photo2);
      
      // 計算相似度
      return this.fusion.calculateSimilarity(feature1, feature2);
    } catch (error) {
      console.error('比較照片失敗:', error);
      return { similarity: 0, method: 'error' };
    }
  }
  
  /**
   * 釋放資源
   */
  public dispose(): void {
    // 清空融合系統
    this.fusion.clear();
    
    // 釋放特徵提取器資源
    if (this.featureExtractor) {
      this.featureExtractor.dispose();
      this.featureExtractor = null;
    }
    
    // 清空照片映射
    this.photoMap.clear();
  }
  
  /**
   * 獲取系統狀態統計
   */
  public getStats(): {
    totalPhotos: number;
    processedFeatures: number;
    deepFeaturesEnabled: boolean;
    enabledLevels: FeatureLevel[];
    threshold: number;
  } {
    return {
      totalPhotos: this.photoMap.size,
      processedFeatures: this.fusion.size(),
      deepFeaturesEnabled: this.options.useDeepFeatures,
      enabledLevels: [...this.options.enabledLevels],
      threshold: this.options.threshold
    };
  }
  
  /**
   * 更新選項
   * @param options 新選項
   */
  public async updateOptions(options: Partial<EnhancedSimilarityOptions>): Promise<void> {
    // 更新選項
    this.options = { ...this.options, ...options };
    
    // 更新融合系統選項
    if (options.threshold !== undefined || options.enabledLevels !== undefined) {
      this.fusion.updateOptions({
        similarityThreshold: this.options.threshold,
        usedLevels: this.options.enabledLevels
      });
    }
    
    // 如果啟用深度特徵但提取器尚未初始化，則初始化
    if (
      this.options.useDeepFeatures &&
      this.options.enabledLevels.includes(FeatureLevel.HIGH) &&
      !this.featureExtractor
    ) {
      await this.initializeFeatureExtractor();
    }
  }
}

/**
 * 創建並導出一個全局實例
 */
let globalSimilaritySystem: EnhancedImageSimilaritySystem | null = null;

/**
 * 獲取全局相似度系統實例
 */
export function getEnhancedSimilaritySystem(
  options?: Partial<EnhancedSimilarityOptions>
): EnhancedImageSimilaritySystem {
  if (!globalSimilaritySystem) {
    globalSimilaritySystem = new EnhancedImageSimilaritySystem(options);
  } else if (options) {
    // 如果提供了新選項，更新現有實例
    globalSimilaritySystem.updateOptions(options);
  }
  
  return globalSimilaritySystem;
} 