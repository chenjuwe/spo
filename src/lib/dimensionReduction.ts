/**
 * 降維處理模塊
 * 實現主成分分析(PCA)等降維技術，用於優化特徵向量比較
 */

/**
 * 降維方法
 */
export enum DimensionReductionMethod {
  PCA = 'pca',
  TSNE = 'tsne',
  SVD = 'svd'
}

/**
 * 降維選項
 */
export interface DimensionReductionOptions {
  method: DimensionReductionMethod;
  targetDimensions: number;
  normalizeInput?: boolean;
  iterationLimit?: number; // 用於迭代式方法
  learningRate?: number;   // 用於迭代式方法
}

/**
 * 預處理選項
 */
export interface PreprocessOptions {
  normalize?: boolean;     // 歸一化到 [0,1] 或 [-1,1]
  centerData?: boolean;    // 中心化數據
  standardize?: boolean;   // 標準化 (減去平均值並除以標準差)
}

/**
 * 默認預處理選項
 */
export const DEFAULT_PREPROCESS_OPTIONS: PreprocessOptions = {
  normalize: true,
  centerData: true,
  standardize: false
};

/**
 * 降維結果
 */
export interface DimensionReductionResult {
  reducedVectors: number[][];      // 降維後的向量
  explainedVariance?: number[];    // 每個主成分解釋的方差比例 (僅適用於 PCA)
  transformMatrix?: number[][];    // 轉換矩陣
  originalDimension: number;       // 原始維度
  targetDimension: number;         // 目標維度
}

/**
 * 預處理特徵數據
 * @param vectors 輸入特徵向量
 * @param options 預處理選項
 * @returns 預處理後的向量
 */
function preprocessVectors(
  vectors: number[][],
  options: PreprocessOptions = DEFAULT_PREPROCESS_OPTIONS
): { processedVectors: number[][], mean?: number[] | undefined, std?: number[] | undefined } {
  if (vectors.length === 0) {
    return { processedVectors: [] };
  }

  const numFeatures = vectors[0].length;
  const processedVectors = [...vectors.map(v => [...v])]; // 深複製

  // 計算每個特徵的平均值
  let mean: number[] | undefined;
  if (options.centerData || options.standardize) {
    mean = new Array(numFeatures).fill(0);
    
    for (const vector of vectors) {
      for (let i = 0; i < numFeatures; i++) {
        mean[i] += vector[i];
      }
    }
    
    for (let i = 0; i < numFeatures; i++) {
      mean[i] /= vectors.length;
    }
  }

  // 計算每個特徵的標準差
  let std: number[] | undefined;
  if (options.standardize) {
    std = new Array(numFeatures).fill(0);
    
    for (const vector of vectors) {
      for (let i = 0; i < numFeatures; i++) {
        std[i] += Math.pow(vector[i] - mean![i], 2);
      }
    }
    
    for (let i = 0; i < numFeatures; i++) {
      std[i] = Math.sqrt(std[i] / vectors.length);
      // 避免除以零
      if (std[i] < 1e-10) std[i] = 1;
    }
  }

  // 應用預處理
  for (let i = 0; i < vectors.length; i++) {
    for (let j = 0; j < numFeatures; j++) {
      // 中心化
      if (options.centerData && mean) {
        processedVectors[i][j] -= mean[j];
      }
      
      // 標準化
      if (options.standardize && std) {
        processedVectors[i][j] /= std[j];
      }
      
      // 歸一化到 [0,1]
      if (options.normalize) {
        const min = Math.min(...vectors.map(v => v[j]));
        const max = Math.max(...vectors.map(v => v[j]));
        const range = max - min;
        
        if (range > 1e-10) {
          processedVectors[i][j] = (vectors[i][j] - min) / range;
        } else {
          processedVectors[i][j] = 0.5; // 如果所有值相同
        }
      }
    }
  }

  return { processedVectors, mean, std };
}

/**
 * 計算協方差矩陣
 * @param vectors 中心化後的特徵向量
 * @returns 協方差矩陣
 */
function calculateCovarianceMatrix(vectors: number[][]): number[][] {
  const numFeatures = vectors[0].length;
  const numSamples = vectors.length;
  const covariance: number[][] = Array(numFeatures)
    .fill(0)
    .map(() => Array(numFeatures).fill(0));

  for (let i = 0; i < numFeatures; i++) {
    for (let j = i; j < numFeatures; j++) {
      let sum = 0;
      for (let k = 0; k < numSamples; k++) {
        sum += vectors[k][i] * vectors[k][j];
      }
      
      const cov = sum / (numSamples - 1);
      covariance[i][j] = cov;
      covariance[j][i] = cov; // 協方差矩陣是對稱的
    }
  }

  return covariance;
}

/**
 * 計算特徵值和特徵向量
 * @param matrix 對稱矩陣
 * @param iterations 最大迭代次數
 * @returns 特徵值和特徵向量
 */
function calculateEigenvaluesAndEigenvectors(
  matrix: number[][],
  iterations: number = 100
): { eigenvalues: number[]; eigenvectors: number[][] } {
  const n = matrix.length;
  
  // 初始化特徵值和特徵向量
  let eigenvalues: number[] = new Array(n).fill(0);
  let eigenvectors: number[][] = Array(n).fill(0).map((_, i) => {
    // 起始為單位矩陣
    const v = new Array(n).fill(0);
    v[i] = 1;
    return v;
  });

  // 使用冪迭代法計算主要特徵值和特徵向量
  for (let k = 0; k < n; k++) {
    let vector = new Array(n).fill(Math.random());
    
    // 歸一化
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    vector = vector.map(v => v / norm);
    
    // 冪迭代
    for (let iter = 0; iter < iterations; iter++) {
      // 矩陣-向量乘法
      const newVector = new Array(n).fill(0);
      
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          newVector[i] += matrix[i][j] * vector[j];
        }
      }
      
      // 找最大絕對值元素
      let maxVal = Math.abs(newVector[0]);
      let maxIdx = 0;
      for (let i = 1; i < n; i++) {
        const absVal = Math.abs(newVector[i]);
        if (absVal > maxVal) {
          maxVal = absVal;
          maxIdx = i;
        }
      }
      
      // 近似特徵值
      const eigenvalue = newVector[maxIdx] / vector[maxIdx];
      
      // 歸一化
      const norm = Math.sqrt(newVector.reduce((sum, val) => sum + val * val, 0));
      const normalizedVector = newVector.map(v => v / norm);
      
      // 檢查收斂
      let converged = true;
      for (let i = 0; i < n; i++) {
        if (Math.abs(Math.abs(normalizedVector[i]) - Math.abs(vector[i])) > 1e-6) {
          converged = false;
          break;
        }
      }
      
      // 更新向量
      vector = normalizedVector;
      
      if (converged) {
        eigenvalues[k] = eigenvalue;
        eigenvectors[k] = vector;
        break;
      }
      
      if (iter === iterations - 1) {
        eigenvalues[k] = eigenvalue;
        eigenvectors[k] = vector;
      }
    }
    
    // 從矩陣中移除已找到的特徵值和特徵向量的影響
    // (缺陷方法，但在簡單情況下足夠)
    if (k < n - 1) {
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          matrix[i][j] -= eigenvalues[k] * eigenvectors[k][i] * eigenvectors[k][j];
        }
      }
    }
  }
  
  // 排序特徵值和特徵向量
  const indices = eigenvalues.map((_, i) => i);
  indices.sort((a, b) => Math.abs(eigenvalues[b]) - Math.abs(eigenvalues[a]));
  
  const sortedEigenvalues = indices.map(i => eigenvalues[i]);
  const sortedEigenvectors = indices.map(i => eigenvectors[i]);
  
  return { eigenvalues: sortedEigenvalues, eigenvectors: sortedEigenvectors };
}

/**
 * 使用主成分分析 (PCA) 進行降維
 * @param vectors 輸入特徵向量
 * @param targetDimensions 目標維度
 * @param preprocessOptions 預處理選項
 * @returns 降維結果
 */
export function reduceDimensionsByPCA(
  vectors: number[][],
  targetDimensions: number,
  preprocessOptions: PreprocessOptions = DEFAULT_PREPROCESS_OPTIONS
): DimensionReductionResult {
  if (vectors.length === 0) {
    return {
      reducedVectors: [],
      explainedVariance: [],
      transformMatrix: [],
      originalDimension: 0,
      targetDimension: targetDimensions
    };
  }

  const originalDimension = vectors[0].length;
  
  // 確保目標維度不超過原始維度
  targetDimensions = Math.min(targetDimensions, originalDimension);
  
  // 預處理數據
  const { processedVectors, mean } = preprocessVectors(vectors, preprocessOptions);
  
  // 計算協方差矩陣
  const covarianceMatrix = calculateCovarianceMatrix(processedVectors);
  
  // 計算特徵值和特徵向量
  const { eigenvalues, eigenvectors } = calculateEigenvaluesAndEigenvectors(covarianceMatrix);
  
  // 取前 k 個特徵向量作為轉換矩陣
  const transformMatrix: number[][] = eigenvectors.slice(0, targetDimensions);
  
  // 投影數據到主成分空間
  const reducedVectors = processedVectors.map(vector => {
    return transformMatrix.map(pc => {
      let sum = 0;
      for (let i = 0; i < vector.length; i++) {
        sum += vector[i] * pc[i];
      }
      return sum;
    });
  });
  
  // 計算解釋方差比例
  const totalVariance = eigenvalues.reduce((sum, val) => sum + val, 0);
  const explainedVariance = eigenvalues
    .slice(0, targetDimensions)
    .map(val => val / totalVariance);
  
  return {
    reducedVectors,
    explainedVariance,
    transformMatrix,
    originalDimension,
    targetDimension: targetDimensions
  };
}

/**
 * 將單個向量使用現有的 PCA 轉換矩陣進行降維
 * @param vector 輸入特徵向量
 * @param transformMatrix PCA 轉換矩陣
 * @param mean 均值向量 (用於中心化)
 * @returns 降維後的向量
 */
export function projectVectorToPCA(
  vector: number[],
  transformMatrix: number[][],
  mean?: number[]
): number[] {
  // 如果提供了均值向量，則中心化數據
  const centeredVector = mean
    ? vector.map((val, i) => val - mean[i])
    : vector;
  
  // 投影到主成分空間
  return transformMatrix.map(pc => {
    let sum = 0;
    for (let i = 0; i < vector.length; i++) {
      sum += centeredVector[i] * pc[i];
    }
    return sum;
  });
}

/**
 * 使用餘弦相似度比較降維後的向量
 * @param vector1 第一個向量
 * @param vector2 第二個向量
 * @returns 相似度 (範圍 0-1，1 表示完全相同)
 */
export function calculateCosineSimilarity(vector1: number[], vector2: number[]): number {
  if (vector1.length !== vector2.length) {
    throw new Error('向量維度不匹配');
  }
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vector1.length; i++) {
    dotProduct += vector1[i] * vector2[i];
    norm1 += vector1[i] * vector1[i];
    norm2 += vector2[i] * vector2[i];
  }
  
  norm1 = Math.sqrt(norm1);
  norm2 = Math.sqrt(norm2);
  
  // 避免除以零
  if (norm1 === 0 || norm2 === 0) {
    return 0;
  }
  
  const similarity = dotProduct / (norm1 * norm2);
  
  // 確保結果在 0-1 範圍內 (由於浮點數誤差，可能略大於 1)
  return Math.max(0, Math.min(1, similarity));
}

/**
 * 使用歐氏距離比較降維後的向量
 * @param vector1 第一個向量
 * @param vector2 第二個向量
 * @returns 距離 (值越小表示越相似)
 */
export function calculateEuclideanDistance(vector1: number[], vector2: number[]): number {
  if (vector1.length !== vector2.length) {
    throw new Error('向量維度不匹配');
  }
  
  let sumSquared = 0;
  
  for (let i = 0; i < vector1.length; i++) {
    const diff = vector1[i] - vector2[i];
    sumSquared += diff * diff;
  }
  
  return Math.sqrt(sumSquared);
}

/**
 * 計算歐氏距離的相似度百分比
 * @param distance 歐氏距離
 * @param maxDistance 最大距離參考值 (可選)
 * @returns 相似度百分比 (0-100)
 */
export function euclideanDistanceToSimilarity(
  distance: number,
  maxDistance: number = 10
): number {
  // 將距離轉換為 0-100 的相似度百分比
  // 使用指數衰減確保距離越大，相似度越接近 0
  const similarity = 100 * Math.exp(-distance / maxDistance);
  
  return Math.max(0, Math.min(100, similarity));
}

/**
 * 計算相似度矩陣
 * @param vectors 向量集
 * @param similarityFn 相似度函數
 * @returns 相似度矩陣
 */
export function calculateSimilarityMatrix(
  vectors: number[][],
  similarityFn: (a: number[], b: number[]) => number = calculateCosineSimilarity
): number[][] {
  const n = vectors.length;
  const matrix: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));
  
  for (let i = 0; i < n; i++) {
    // 對角線元素 (自身相似度為 1)
    matrix[i][i] = 1;
    
    // 只計算上三角矩陣
    for (let j = i + 1; j < n; j++) {
      const similarity = similarityFn(vectors[i], vectors[j]);
      matrix[i][j] = similarity;
      matrix[j][i] = similarity; // 相似度矩陣是對稱的
    }
  }
  
  return matrix;
}

/**
 * 特徵向量比較器
 * 使用降維技術優化特徵向量的相似度比較
 */
export class FeatureVectorComparator {
  private transformMatrix: number[][] | null = null;
  private mean: number[] | null = null;
  private dimensions: number;
  private originalDimension: number;
  
  /**
   * 創建特徵向量比較器
   * @param dimensions 降維目標維度
   */
  constructor(dimensions: number = 16) {
    this.dimensions = dimensions;
    this.originalDimension = 0;
  }
  
  /**
   * 訓練 PCA 轉換矩陣
   * @param trainingVectors 訓練用特徵向量
   */
  public train(trainingVectors: number[][]): void {
    if (trainingVectors.length === 0) {
      return;
    }
    
    this.originalDimension = trainingVectors[0].length;
    
    // 確保目標維度不超過原始維度
    const targetDims = Math.min(this.dimensions, this.originalDimension);
    
    // 使用 PCA 降維
    const { transformMatrix, reducedVectors } = reduceDimensionsByPCA(
      trainingVectors,
      targetDims
    );
    
    // 保存轉換矩陣
    this.transformMatrix = transformMatrix;
    
    // 計算均值向量
    this.mean = new Array(this.originalDimension).fill(0);
    for (const vector of trainingVectors) {
      for (let i = 0; i < this.originalDimension; i++) {
        this.mean[i] += vector[i];
      }
    }
    for (let i = 0; i < this.originalDimension; i++) {
      this.mean[i] /= trainingVectors.length;
    }
  }
  
  /**
   * 將特徵向量降維
   * @param vector 特徵向量
   * @returns 降維後的向量
   */
  public transform(vector: number[]): number[] {
    if (!this.transformMatrix) {
      throw new Error('比較器尚未訓練，請先調用 train 方法');
    }
    
    if (vector.length !== this.originalDimension) {
      throw new Error(`向量維度不匹配，預期 ${this.originalDimension}，實際 ${vector.length}`);
    }
    
    return projectVectorToPCA(vector, this.transformMatrix, this.mean || undefined);
  }
  
  /**
   * 比較兩個特徵向量的相似度
   * @param vector1 第一個特徵向量
   * @param vector2 第二個特徵向量
   * @returns 相似度百分比 (0-100)
   */
  public compare(vector1: number[], vector2: number[]): number {
    const transformed1 = this.transform(vector1);
    const transformed2 = this.transform(vector2);
    
    // 計算相似度
    const similarity = calculateCosineSimilarity(transformed1, transformed2);
    
    // 轉換為百分比
    return Math.round(similarity * 100);
  }
  
  /**
   * 比較兩個已降維的向量的相似度
   * @param reduced1 第一個已降維向量
   * @param reduced2 第二個已降維向量
   * @returns 相似度百分比 (0-100)
   */
  public compareReduced(reduced1: number[], reduced2: number[]): number {
    // 計算相似度
    const similarity = calculateCosineSimilarity(reduced1, reduced2);
    
    // 轉換為百分比
    return Math.round(similarity * 100);
  }
  
  /**
   * 獲取轉換矩陣
   * @returns PCA 轉換矩陣
   */
  public getTransformMatrix(): number[][] | null {
    return this.transformMatrix;
  }
  
  /**
   * 獲取均值向量
   * @returns 均值向量
   */
  public getMean(): number[] | null {
    return this.mean;
  }
  
  /**
   * 保存模型參數
   * @returns 模型參數對象
   */
  public saveModel(): { transformMatrix: number[][] | null, mean: number[] | null, dimensions: number, originalDimension: number } {
    return {
      transformMatrix: this.transformMatrix,
      mean: this.mean,
      dimensions: this.dimensions,
      originalDimension: this.originalDimension
    };
  }
  
  /**
   * 加載模型參數
   * @param model 保存的模型參數
   */
  public loadModel(model: { transformMatrix: number[][] | null, mean: number[] | null, dimensions: number, originalDimension: number }): void {
    this.transformMatrix = model.transformMatrix;
    this.mean = model.mean;
    this.dimensions = model.dimensions;
    this.originalDimension = model.originalDimension;
  }
} 