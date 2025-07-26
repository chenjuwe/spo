/**
 * 特徵工作線程
 * 用於在背景執行高性能特徵計算和比較
 */
import { expose } from 'comlink';
import { HashResult } from './integratedHasher';
import { PhotoFile } from './types';
import { FeatureLevel } from './multiLevelFeatureFusion';

/**
 * 工作線程接口
 */
interface FeatureWorkerInterface {
  /**
   * 初始化工作線程
   */
  initialize(): Promise<boolean>;

  /**
   * 提取照片哈希特徵
   * @param imageData 圖像數據
   */
  extractHashFeatures(imageData: ImageData): Promise<HashResult>;

  /**
   * 計算平均哈希
   * @param imageData 圖像數據
   */
  calculateAverageHash(imageData: ImageData): Promise<string>;

  /**
   * 計算差分哈希
   * @param imageData 圖像數據
   */
  calculateDifferenceHash(imageData: ImageData): Promise<string>;

  /**
   * 計算感知哈希
   * @param imageData 圖像數據
   */
  calculatePerceptualHash(imageData: ImageData): Promise<string>;

  /**
   * 計算特徵向量相似度
   * @param vector1 向量1
   * @param vector2 向量2
   */
  calculateVectorSimilarity(vector1: number[], vector2: number[]): Promise<number>;

  /**
   * 批量計算特徵向量相似度
   * @param baseVector 基準向量
   * @param vectors 向量列表
   */
  calculateBatchSimilarity(baseVector: number[], vectors: number[][]): Promise<number[]>;

  /**
   * 壓縮特徵向量
   * @param vector 原始向量
   * @param ratio 壓縮比例
   */
  compressVector(vector: number[], ratio: number): Promise<number[]>;
  
  /**
   * 執行離散餘弦變換
   * @param grayValues 灰度值數組
   * @param width 寬度
   * @param height 高度
   */
  performDCT(grayValues: number[], width: number, height: number): number[];
  
  /**
   * 調整圖像大小
   * @param imageData 原始圖像數據
   * @param newWidth 新寬度
   * @param newHeight 新高度
   */
  resizeImageData(imageData: ImageData, newWidth: number, newHeight: number): ImageData;
  
  /**
   * 將圖像數據轉換為灰度值數組
   * @param imageData 圖像數據
   */
  convertToGrayscale(imageData: ImageData): number[];
}

/**
 * 特徵工作線程實現
 */
const featureWorker: FeatureWorkerInterface = {
  /**
   * 初始化工作線程
   */
  async initialize(): Promise<boolean> {
    try {
      console.log('[FeatureWorker] 初始化成功');
      return true;
    } catch (error) {
      console.error('[FeatureWorker] 初始化失敗:', error);
      return false;
    }
  },

  /**
   * 提取照片哈希特徵
   * 使用高效的算法計算圖像哈希
   * 
   * @param imageData 圖像數據
   */
  async extractHashFeatures(imageData: ImageData): Promise<HashResult> {
    try {
      // 計算 aHash (平均哈希)
      const aHash = await this.calculateAverageHash(imageData);
      
      // 計算 dHash (差分哈希)
      const dHash = await this.calculateDifferenceHash(imageData);
      
      // 計算 pHash (感知哈希)
      const pHash = await this.calculatePerceptualHash(imageData);
      
      return {
        aHash,
        dHash,
        pHash
      };
    } catch (error) {
      console.error('[FeatureWorker] 提取哈希特徵失敗:', error);
      return {};
    }
  },

  /**
   * 計算平均哈希
   * @param imageData 圖像數據
   */
  calculateAverageHash(imageData: ImageData): Promise<string> {
    // 縮小圖像為 8x8
    const smallImage = this.resizeImageData(imageData, 8, 8);
    
    // 轉換為灰度
    const grayValues = this.convertToGrayscale(smallImage);
    
    // 計算平均值
    const avg = grayValues.reduce((sum: number, val: number) => sum + val, 0) / grayValues.length;
    
    // 生成哈希字符串
    let hash = '';
    for (let i = 0; i < grayValues.length; i += 4) {
      let nibble = 0;
      for (let j = 0; j < 4 && (i + j) < grayValues.length; j++) {
        if (grayValues[i + j] >= avg) {
          nibble |= 1 << (3 - j);
        }
      }
      hash += nibble.toString(16);
    }
    
    return Promise.resolve(hash);
  },

  /**
   * 計算差分哈希
   * @param imageData 圖像數據
   */
  calculateDifferenceHash(imageData: ImageData): Promise<string> {
    // 縮小圖像為 9x8 (橫向多一個像素，便於比較相鄰像素)
    const smallImage = this.resizeImageData(imageData, 9, 8);
    
    // 轉換為灰度
    const grayValues = this.convertToGrayscale(smallImage);
    
    // 計算差分哈希
    let hash = '';
    for (let y = 0; y < 8; y++) {
      let nibble = 0;
      for (let x = 0; x < 4; x++) {
        const idx1 = y * 9 + x;
        const idx2 = y * 9 + x + 1;
        if (grayValues[idx1] > grayValues[idx2]) {
          nibble |= 1 << (3 - x);
        }
      }
      hash += nibble.toString(16);
      
      nibble = 0;
      for (let x = 4; x < 8; x++) {
        const idx1 = y * 9 + x;
        const idx2 = y * 9 + x + 1;
        if (grayValues[idx1] > grayValues[idx2]) {
          nibble |= 1 << (7 - x);
        }
      }
      hash += nibble.toString(16);
    }
    
    return Promise.resolve(hash);
  },

  /**
   * 計算感知哈希
   * @param imageData 圖像數據
   */
  calculatePerceptualHash(imageData: ImageData): Promise<string> {
    // 縮小圖像為 32x32
    const smallImage = this.resizeImageData(imageData, 32, 32);
    
    // 轉換為灰度
    const grayValues = this.convertToGrayscale(smallImage);
    
    // 執行離散餘弦變換 (DCT) - 簡化版本
    const dctValues = this.performDCT(grayValues, 32, 32);
    
    // 提取低頻部分 (8x8)
    const lowFrequency = new Array(64);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        lowFrequency[y * 8 + x] = dctValues[y * 32 + x];
      }
    }
    
    // 計算平均值 (不包括直流分量 DC)
    let sum = 0;
    for (let i = 1; i < 64; i++) {
      sum += lowFrequency[i];
    }
    const avg = sum / 63;
    
    // 生成哈希字符串
    let hash = '';
    for (let i = 0; i < 64; i += 4) {
      let nibble = 0;
      for (let j = 0; j < 4 && (i + j) < 64; j++) {
        if (i + j > 0 && lowFrequency[i + j] >= avg) {
          nibble |= 1 << (3 - j);
        }
      }
      hash += nibble.toString(16);
    }
    
    return Promise.resolve(hash);
  },

  /**
   * 執行簡化版的離散餘弦變換 (DCT)
   * @param grayValues 灰度值
   * @param width 寬度
   * @param height 高度
   */
  performDCT(grayValues: number[], width: number, height: number): number[] {
    const result = new Array(width * height).fill(0);
    
    // 簡化的 DCT 實現
    for (let u = 0; u < width; u++) {
      for (let v = 0; v < height; v++) {
        let sum = 0;
        
        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            const cosTermX = Math.cos((2 * x + 1) * u * Math.PI / (2 * width));
            const cosTermY = Math.cos((2 * y + 1) * v * Math.PI / (2 * height));
            sum += grayValues[y * width + x] * cosTermX * cosTermY;
          }
        }
        
        // 歸一化係數
        let alphaU = u === 0 ? 1 / Math.sqrt(width) : Math.sqrt(2 / width);
        let alphaV = v === 0 ? 1 / Math.sqrt(height) : Math.sqrt(2 / height);
        
        result[v * width + u] = alphaU * alphaV * sum;
      }
    }
    
    return result;
  },

  /**
   * 縮小圖像
   * @param imageData 原始圖像數據
   * @param newWidth 新寬度
   * @param newHeight 新高度
   */
  resizeImageData(imageData: ImageData, newWidth: number, newHeight: number): ImageData {
    const { width: oldWidth, height: oldHeight, data } = imageData;
    
    // 創建 Canvas 進行縮放
    const canvas = new OffscreenCanvas(newWidth, newHeight);
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('無法創建 OffscreenCanvas 上下文');
    }
    
    // 將原始圖像數據繪製到另一個 Canvas 上
    const tempCanvas = new OffscreenCanvas(oldWidth, oldHeight);
    const tempCtx = tempCanvas.getContext('2d');
    
    if (!tempCtx) {
      throw new Error('無法創建臨時 OffscreenCanvas 上下文');
    }
    
    const tempImageData = new ImageData(
      new Uint8ClampedArray(data),
      oldWidth,
      oldHeight
    );
    
    tempCtx.putImageData(tempImageData, 0, 0);
    
    // 繪製縮放後的圖像
    ctx.drawImage(tempCanvas, 0, 0, oldWidth, oldHeight, 0, 0, newWidth, newHeight);
    
    // 獲取縮放後的圖像數據
    return ctx.getImageData(0, 0, newWidth, newHeight);
  },

  /**
   * 將圖像數據轉換為灰度值數組
   * @param imageData 圖像數據
   */
  convertToGrayscale(imageData: ImageData): number[] {
    const { data, width, height } = imageData;
    const grayValues = new Array(width * height);
    
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      // 加權平均法計算灰度值
      grayValues[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    
    return grayValues;
  },

  /**
   * 計算特徵向量相似度
   * @param vector1 向量1
   * @param vector2 向量2
   */
  async calculateVectorSimilarity(vector1: number[], vector2: number[]): Promise<number> {
    // 檢查向量長度是否匹配
    if (vector1.length !== vector2.length) {
      throw new Error(`向量長度不匹配: ${vector1.length} vs ${vector2.length}`);
    }
    
    // 計算餘弦相似度
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vector1.length; i++) {
      dotProduct += vector1[i] * vector2[i];
      normA += Math.pow(vector1[i], 2);
      normB += Math.pow(vector2[i], 2);
    }
    
    // 避免除以零
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    // 餘弦相似度範圍為 [-1, 1]，轉換為 [0, 1]
    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return (similarity + 1) / 2; // 將 [-1, 1] 映射到 [0, 1]
  },

  /**
   * 批量計算特徵向量相似度
   * @param baseVector 基準向量
   * @param vectors 向量列表
   */
  async calculateBatchSimilarity(baseVector: number[], vectors: number[][]): Promise<number[]> {
    return Promise.all(
      vectors.map(vector => this.calculateVectorSimilarity(baseVector, vector))
    );
  },

  /**
   * 壓縮特徵向量
   * @param vector 原始向量
   * @param ratio 壓縮比例 (0-1)
   */
  async compressVector(vector: number[], ratio: number): Promise<number[]> {
    if (ratio >= 1) {
      return [...vector];
    }
    
    const targetLength = Math.max(16, Math.round(vector.length * ratio));
    
    // 如果壓縮比例小於1，使用均勻採樣壓縮
    if (vector.length <= targetLength) {
      return [...vector];
    }
    
    const result: number[] = [];
    const step = vector.length / targetLength;
    
    for (let i = 0; i < targetLength; i++) {
      const idx = Math.min(Math.floor(i * step), vector.length - 1);
      result.push(vector[idx]);
    }
    
    return result;
  }
};

// 暴露工作線程接口
expose(featureWorker); 