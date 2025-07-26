import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { HashResult, HashType } from './types';
import { errorHandler, ErrorType, ErrorSeverity } from './errorHandlingService';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 優化的漢明距離計算 - 使用位元運算
 * @param hash1 第一個二進制哈希字符串
 * @param hash2 第二個二進制哈希字符串
 * @returns 兩個哈希的漢明距離
 */
export function calculateHammingDistance(hash1: string, hash2: string): number {
  // 確保哈希長度相同
  const minLength = Math.min(hash1.length, hash2.length);
  let distance = 0;
  
  // 每32位元處理一次，轉換為整數進行位元運算
  for (let i = 0; i < minLength; i += 32) {
    const chunk1 = parseInt(hash1.substr(i, Math.min(32, minLength - i)), 2) || 0;
    const chunk2 = parseInt(hash2.substr(i, Math.min(32, minLength - i)), 2) || 0;
    let xor = chunk1 ^ chunk2;
    
    // 計算設置的位元數（1的數量）
    while (xor) {
      distance += xor & 1;
      xor = xor >>> 1;
    }
  }
  
  // 如果長度不同，將剩餘部分視為不同
  distance += Math.abs(hash1.length - hash2.length);
  
  return distance;
}

/**
 * 計算兩個二進制哈希的相似度百分比
 * @param hash1 第一個哈希字符串
 * @param hash2 第二個哈希字符串
 * @returns 相似度百分比 (0-100)
 */
export function calculateSimilarity(hash1: string, hash2: string): number {
  const distance = calculateHammingDistance(hash1, hash2);
  const maxLength = Math.max(hash1.length, hash2.length);
  
  // 轉換為相似度百分比
  return ((maxLength - distance) / maxLength) * 100;
}

/**
 * 計算兩個哈希結果集的加權相似度
 * @param hashes1 第一個哈希結果集
 * @param hashes2 第二個哈希結果集
 * @param weights 各種哈希類型的權重
 * @returns 加權相似度百分比 (0-100)
 */
export function calculateWeightedSimilarity(
  hashes1: HashResult, 
  hashes2: HashResult, 
  weights: Record<HashType, number> = { pHash: 0.4, dHash: 0.4, aHash: 0.2 }
): number {
  let totalSimilarity = 0;
  let totalWeight = 0;
  
  for (const type of Object.keys(weights) as HashType[]) {
    if (hashes1[type] && hashes2[type]) {
      const similarity = calculateSimilarity(hashes1[type], hashes2[type]);
      totalSimilarity += similarity * weights[type];
      totalWeight += weights[type];
    }
  }
  
  return totalWeight > 0 ? totalSimilarity / totalWeight : 0;
}

/**
 * 考慮亮度和對比度差異的相似度計算
 * @param hashes1 第一個哈希結果集
 * @param hashes2 第二個哈希結果集
 * @param brightness1 第一張照片的亮度 (0-100)
 * @param brightness2 第二張照片的亮度 (0-100)
 * @param contrast1 第一張照片的對比度 (0-100)
 * @param contrast2 第二張照片的對比度 (0-100)
 * @param weights 各種因素的權重
 * @returns 綜合相似度百分比 (0-100)
 */
export function calculateAdjustedSimilarity(
  hashes1: HashResult,
  hashes2: HashResult,
  brightness1: number,
  brightness2: number,
  contrast1: number,
  contrast2: number,
  weights = {
    hash: 0.7,         // 哈希相似度權重
    brightness: 0.15,  // 亮度差異權重
    contrast: 0.15     // 對比度差異權重
  }
): number {
  // 計算哈希相似度
  const hashSimilarity = calculateWeightedSimilarity(hashes1, hashes2);
  
  // 計算亮度相似度 (亮度差異越小，相似度越高)
  const brightnessDiff = Math.abs(brightness1 - brightness2);
  const brightnessSimilarity = 100 - brightnessDiff;
  
  // 計算對比度相似度 (對比度差異越小，相似度越高)
  const contrastDiff = Math.abs(contrast1 - contrast2);
  const contrastSimilarity = 100 - contrastDiff;
  
  // 綜合計算加權相似度
  return (
    hashSimilarity * weights.hash +
    brightnessSimilarity * weights.brightness +
    contrastSimilarity * weights.contrast
  );
}

// 局部敏感哈希 (LSH) 索引類，用於快速查找潛在相似照片
export class LSHIndex {
  private bandSize: number;
  private numBands: number;
  private hashTables: Map<string, string[]>[] = [];
  
  /**
   * 創建一個局部敏感哈希索引
   * @param hashSize 哈希長度，默認64位
   * @param numBands 分段數量，越多分段越敏感
   */
  constructor(hashSize = 64, numBands = 4) {
    this.numBands = numBands;
    this.bandSize = Math.floor(hashSize / numBands);
    
    // 初始化哈希表
    for (let i = 0; i < numBands; i++) {
      this.hashTables.push(new Map<string, string[]>());
    }
  }
  
  /**
   * 將哈希字符串轉換為位元陣列
   */
  private hashToBits(hash: string): number[] {
    const bits: number[] = [];
    for (let i = 0; i < hash.length; i++) {
      bits.push(hash[i] === '1' ? 1 : 0);
    }
    return bits;
  }
  
  /**
   * 添加照片到索引
   * @param photoId 照片ID
   * @param hash 照片的二進制哈希
   */
  addPhoto(photoId: string, hash: string): void {
    const bits = this.hashToBits(hash);
    
    for (let b = 0; b < this.numBands; b++) {
      // 計算當前帶的哈希值
      const bandBits = bits.slice(b * this.bandSize, (b + 1) * this.bandSize);
      const bandHashKey = bandBits.join('');
      
      // 將照片ID添加到對應的桶中
      if (!this.hashTables[b].has(bandHashKey)) {
        this.hashTables[b].set(bandHashKey, []);
      }
      this.hashTables[b].get(bandHashKey)!.push(photoId);
    }
  }
  
  /**
   * 查詢與給定哈希值相似的照片IDs
   * @param hash 要查詢的哈希值
   * @returns 可能相似的照片ID列表
   */
  query(hash: string): string[] {
    const bits = this.hashToBits(hash);
    const candidateSet = new Set<string>();
    
    for (let b = 0; b < this.numBands; b++) {
      const bandBits = bits.slice(b * this.bandSize, (b + 1) * this.bandSize);
      const bandHashKey = bandBits.join('');
      
      const candidates = this.hashTables[b].get(bandHashKey) || [];
      candidates.forEach(id => candidateSet.add(id));
    }
    
    return Array.from(candidateSet);
  }
  
  /**
   * 清空索引
   */
  clear(): void {
    for (let i = 0; i < this.numBands; i++) {
      this.hashTables[i].clear();
    }
  }
  
  /**
   * 獲取索引大小（已索引照片的總數）
   */
  get size(): number {
    const uniquePhotoIds = new Set<string>();
    
    this.hashTables.forEach(table => {
      table.forEach(ids => {
        ids.forEach(id => uniquePhotoIds.add(id));
      });
    });
    
    return uniquePhotoIds.size;
  }
}

/**
 * 計算兩個向量的餘弦相似度
 * @param vecA 第一個向量
 * @param vecB 第二個向量
 * @returns 餘弦相似度 (0-1)
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('向量維度必須相同');
  }
  
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  
  if (normA === 0 || normB === 0) return 0;
  return dot / (normA * normB);
}

/**
 * 統一的錯誤處理工具函數
 * 用於簡化錯誤處理流程並確保類型安全
 * 
 * @param error 錯誤對象或錯誤訊息
 * @param type 錯誤類型
 * @param details 錯誤詳細資訊
 * @param recoverable 是否可恢復
 * @param recoveryAction 恢復動作
 * @param severity 錯誤嚴重程度
 * @returns 錯誤ID
 */
export function handleError(
  error: unknown,
  type: ErrorType = ErrorType.UNKNOWN_ERROR,
  details?: string,
  recoverable: boolean = false,
  recoveryAction?: () => void,
  severity: ErrorSeverity = ErrorSeverity.MEDIUM
): string {
  // 確保錯誤是 Error 類型
  const errorObj = error instanceof Error 
    ? error 
    : new Error(typeof error === 'string' ? error : String(error));
  
  return errorHandler.handleError(
    errorObj,
    type,
    details,
    recoverable,
    recoveryAction,
    severity
  );
}

/**
 * 與錯誤處理集成的異步函數包裝器
 * 
 * @param fn 要執行的異步函數
 * @param errorType 發生錯誤時的類型
 * @param errorMessage 錯誤訊息
 * @returns 包裝後的函數
 */
export function withErrorHandlingAsync<T, Args extends any[]>(
  fn: (...args: Args) => Promise<T>,
  errorType: ErrorType,
  errorMessage: string
): (...args: Args) => Promise<T | null> {
  return async (...args: Args): Promise<T | null> => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error, errorType, errorMessage);
      return null;
    }
  };
}
