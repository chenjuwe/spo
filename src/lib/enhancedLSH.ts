/**
 * 增強版局部敏感哈希 (LSH) 實現
 * 提供多級 LSH (Multi-probe LSH) 和 E2LSH 實現
 */

import { LSHIndex, LSHConfig, DEFAULT_LSH_CONFIG } from './lsh';

/**
 * 增強型 LSH 配置接口
 */
export interface EnhancedLSHConfig extends LSHConfig {
  // 多級 LSH 探測次數
  numProbes: number;
  // 使用 E2LSH (歐氏距離敏感哈希)
  useE2LSH: boolean;
  // 分層 LSH 的級別數
  numLevels: number;
  // 複製查詢時的擾動向量數量
  numPerturbations: number;
}

/**
 * 默認增強 LSH 配置
 */
export const DEFAULT_ENHANCED_LSH_CONFIG: EnhancedLSHConfig = {
  ...DEFAULT_LSH_CONFIG,
  numProbes: 3,
  useE2LSH: true,
  numLevels: 2,
  numPerturbations: 5
};

/**
 * 多級 LSH 索引
 * 實現了多級探測策略，可以減少需要的哈希表數量同時提高召回率
 */
export class MultiProbeLSHIndex {
  private indices: LSHIndex[] = [];
  private config: EnhancedLSHConfig;
  private itemCount = 0;
  
  // 扰动向量，用于多级探测
  private perturbationVectors: number[][][] = [];

  /**
   * 創建多級 LSH 索引
   * @param config LSH 配置
   */
  constructor(config: Partial<EnhancedLSHConfig> = {}) {
    this.config = { ...DEFAULT_ENHANCED_LSH_CONFIG, ...config };
    this.initialize();
  }

  /**
   * 初始化 LSH 索引
   */
  private initialize(): void {
    // 创建不同级别的 LSH 索引
    for (let i = 0; i < this.config.numLevels; i++) {
      // 隨著層級增加，哈希函數和桶的數量會相應調整
      const levelConfig = {
        ...this.config,
        numHashFunctions: this.config.numHashFunctions - i, // 降低哈希函數數量
        numBuckets: this.config.numBuckets * (i + 1) // 增加桶數量
      };
      
      this.indices.push(new LSHIndex(levelConfig));
    }
    
    // 生成擾動向量用於多級探測
    this.generatePerturbationVectors();
  }
  
  /**
   * 生成擾動向量用於多級探測
   * 這些向量用於探測鄰近桶
   */
  private generatePerturbationVectors(): void {
    for (let level = 0; level < this.config.numLevels; level++) {
      const levelPerturbations: number[][] = [];
      
      for (let p = 0; p < this.config.numPerturbations; p++) {
        // 生成長度等於哈希函數數量的擾動向量
        const perturbation: number[] = [];
        const numFunctions = this.config.numHashFunctions - level;
        
        for (let i = 0; i < numFunctions; i++) {
          // 生成 -1、0、1 三種值作為擾動
          perturbation.push(Math.floor(Math.random() * 3) - 1);
        }
        
        levelPerturbations.push(perturbation);
      }
      
      this.perturbationVectors.push(levelPerturbations);
    }
  }
  
  /**
   * 應用擾動向量到哈希向量上
   * @param hashVector 原始哈希向量
   * @param perturbation 擾動向量
   * @returns 擾動後的哈希向量
   */
  private applyPerturbation(hashVector: number[], perturbation: number[]): number[] {
    const result = [...hashVector];
    
    for (let i = 0; i < Math.min(result.length, perturbation.length); i++) {
      result[i] += perturbation[i];
    }
    
    return result;
  }

  /**
   * 將項目添加到 LSH 索引
   * @param id 項目 ID
   * @param binaryHash 二進制哈希
   */
  public insert(id: string, binaryHash: string): void {
    // 將項目添加到每個層級的索引
    for (let i = 0; i < this.indices.length; i++) {
      this.indices[i].insert(id, binaryHash);
    }
    
    this.itemCount++;
  }

  /**
   * 批量插入項目
   * @param items 項目數組 [id, binaryHash]
   */
  public batchInsert(items: [string, string][]): void {
    for (const [id, binaryHash] of items) {
      this.insert(id, binaryHash);
    }
  }

  /**
   * 多級探測查詢
   * 使用多級探測策略查詢相似項目
   * @param binaryHash 二進制哈希
   * @returns 候選項目集合
   */
  public query(binaryHash: string): Set<string> {
    const candidates = new Set<string>();
    
    // 從每個層級獲取候選項
    for (let level = 0; level < this.indices.length; level++) {
      const index = this.indices[level];
      
      // 基本查詢
      const baseResults = index.query(binaryHash);
      for (const id of baseResults) {
        candidates.add(id);
      }
      
      // 多級探測：使用擾動向量查詢鄰近桶
      if (this.config.numProbes > 1) {
        const hashVector = this.binaryHashToVector(binaryHash);
        
        for (let p = 0; p < Math.min(this.config.numProbes - 1, this.perturbationVectors[level].length); p++) {
          // 應用擾動向量
          const perturbedVector = this.applyPerturbation(hashVector, this.perturbationVectors[level][p]);
          const perturbedHash = this.vectorToBinaryHash(perturbedVector);
          
          // 查詢相鄰桶
          const probeResults = index.query(perturbedHash);
          for (const id of probeResults) {
            candidates.add(id);
          }
        }
      }
    }
    
    return candidates;
  }
  
  /**
   * 將二進制哈希轉換為向量表示
   * @param binaryHash 二進制哈希字符串
   * @returns 數字向量
   */
  private binaryHashToVector(binaryHash: string): number[] {
    return binaryHash.split('').map(bit => parseInt(bit, 2));
  }
  
  /**
   * 將向量轉換為二進制哈希
   * @param vector 數字向量
   * @returns 二進制哈希字符串
   */
  private vectorToBinaryHash(vector: number[]): string {
    return vector.map(v => (v > 0 ? '1' : '0')).join('');
  }

  /**
   * 查詢多個哈希的候選項目
   * @param binaryHashes 二進制哈希數組
   * @returns 候選項目集合
   */
  public queryMultiple(binaryHashes: string[]): Set<string> {
    const candidates = new Set<string>();
    
    for (const hash of binaryHashes) {
      const results = this.query(hash);
      for (const id of results) {
        candidates.add(id);
      }
    }
    
    return candidates;
  }
  
  /**
   * 移除項目
   * @param id 項目 ID
   * @param binaryHash 二進制哈希
   */
  public remove(id: string, binaryHash: string): void {
    for (const index of this.indices) {
      index.remove(id, binaryHash);
    }
    
    this.itemCount--;
  }
  
  /**
   * 清空索引
   */
  public clear(): void {
    for (const index of this.indices) {
      index.clear();
    }
    this.itemCount = 0;
  }
  
  /**
   * 獲取索引中的項目數
   */
  public size(): number {
    return this.itemCount;
  }
}

/**
 * 歐氏 LSH (E2LSH) 索引
 * 專為歐氏空間中的數據設計，比傳統 LSH 在連續特徵向量上效果更好
 */
export class E2LSHIndex {
  private config: EnhancedLSHConfig;
  private projections: number[][][] = [];
  private thresholds: number[][] = [];
  private buckets: Map<string, Set<string>> = new Map();
  private itemCount = 0;

  /**
   * 創建 E2LSH 索引
   * @param config LSH 配置
   */
  constructor(config: Partial<EnhancedLSHConfig> = {}) {
    this.config = { ...DEFAULT_ENHANCED_LSH_CONFIG, ...config };
    this.initialize();
  }

  /**
   * 初始化 E2LSH 索引
   */
  private initialize(): void {
    // 生成隨機投影向量和閾值
    this.generateProjectionsAndThresholds();
  }

  /**
   * 生成隨機投影向量和閾值
   */
  private generateProjectionsAndThresholds(): void {
    // 對每個表
    for (let t = 0; t < this.config.numTables; t++) {
      const tableProjections: number[][] = [];
      const tableThresholds: number[] = [];
      
      // 每個表有多個哈希函數
      for (let h = 0; h < this.config.numHashFunctions; h++) {
        const projection: number[] = [];
        
        // 為每個維度生成標準正態分佈的隨機值
        for (let i = 0; i < this.config.numBits; i++) {
          // 使用 Box-Muller 變換生成標準正態分佈的隨機數
          const u1 = Math.random();
          const u2 = Math.random();
          const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
          projection.push(z);
        }
        
        tableProjections.push(projection);
        
        // 生成均勻分佈的隨機閾值 [0, w)
        // w 是桶寬度參數，這里使用固定值 4.0 
        const w = 4.0;
        tableThresholds.push(Math.random() * w);
      }
      
      this.projections.push(tableProjections);
      this.thresholds.push(tableThresholds);
    }
  }

  /**
   * 將向量哈希到桶
   * @param vector 特徵向量
   * @returns 桶 ID 數組 (每個表一個)
   */
  private hashVector(vector: number[]): string[] {
    const bucketIds: string[] = [];
    
    // 對每個表
    for (let t = 0; t < this.projections.length; t++) {
      const tableProjections = this.projections[t];
      const tableThresholds = this.thresholds[t];
      const hashValues: number[] = [];
      
      // 對每個哈希函數
      for (let h = 0; h < tableProjections.length; h++) {
        const projection = tableProjections[h];
        const threshold = tableThresholds[h];
        
        // 計算點積
        let dotProduct = 0;
        for (let i = 0; i < Math.min(vector.length, projection.length); i++) {
          dotProduct += vector[i] * projection[i];
        }
        
        // 應用 E2LSH 哈希函數 h(x) = floor((a·x + b) / w)
        // 其中 a 是投影向量，b 是閾值，w 是桶寬度
        const w = 4.0; // 桶寬度參數
        const hashValue = Math.floor((dotProduct + threshold) / w);
        hashValues.push(hashValue);
      }
      
      // 將哈希值組合為桶 ID
      bucketIds.push(hashValues.join(':'));
    }
    
    return bucketIds;
  }
  
  /**
   * 將浮點特徵向量轉換為字符串
   * @param vector 特徵向量
   * @param precision 精度位數
   * @returns 向量字符串表示
   */
  private vectorToString(vector: number[], precision: number = 6): string {
    return vector.map(v => v.toFixed(precision)).join(',');
  }
  
  /**
   * 將向量字符串轉換回浮點向量
   * @param str 向量字符串表示
   * @returns 浮點特徵向量
   */
  private stringToVector(str: string): number[] {
    return str.split(',').map(s => parseFloat(s));
  }

  /**
   * 將項目添加到 E2LSH 索引
   * @param id 項目 ID
   * @param featureVector 特徵向量
   */
  public insert(id: string, featureVector: number[]): void {
    // 將特徵向量哈希到每個表的桶中
    const bucketIds = this.hashVector(featureVector);
    
    // 存儲到各個桶
    for (const bucketId of bucketIds) {
      if (!this.buckets.has(bucketId)) {
        this.buckets.set(bucketId, new Set());
      }
      
      this.buckets.get(bucketId)!.add(id);
    }
    
    this.itemCount++;
  }

  /**
   * 批量插入項目
   * @param items 項目數組 [id, featureVector]
   */
  public batchInsert(items: [string, number[]][]): void {
    for (const [id, featureVector] of items) {
      this.insert(id, featureVector);
    }
  }

  /**
   * 查詢與給定特徵向量相似的項目
   * @param featureVector 特徵向量
   * @param multiProbe 是否使用多級探測
   * @returns 候選項目集合
   */
  public query(featureVector: number[], multiProbe: boolean = true): Set<string> {
    const candidates = new Set<string>();
    
    // 哈希查詢向量
    const bucketIds = this.hashVector(featureVector);
    
    // 從每個表的對應桶中獲取候選項
    for (let t = 0; t < bucketIds.length; t++) {
      const bucketId = bucketIds[t];
      
      if (this.buckets.has(bucketId)) {
        const bucket = this.buckets.get(bucketId)!;
        for (const id of bucket) {
          candidates.add(id);
        }
      }
    }
    
    // 多級探測：查詢相鄰桶
    if (multiProbe && this.config.numProbes > 1) {
      const probeCount = Math.min(this.config.numProbes, 11) - 1; // 最多查詢 10 個相鄰桶
      
      for (let t = 0; t < bucketIds.length; t++) {
        const bucketParts = bucketIds[t].split(':').map(part => parseInt(part, 10));
        
        // 擾動每個哈希函數的結果
        for (let h = 0; h < bucketParts.length && h < probeCount; h++) {
          // 向上和向下擾動
          for (const offset of [-1, 1]) {
            const probeParts = [...bucketParts];
            probeParts[h] += offset;
            
            const probeBucketId = probeParts.join(':');
            
            if (this.buckets.has(probeBucketId)) {
              const bucket = this.buckets.get(probeBucketId)!;
              for (const id of bucket) {
                candidates.add(id);
              }
            }
          }
        }
      }
    }
    
    return candidates;
  }
  
  /**
   * 移除項目
   * @param id 項目 ID
   * @param featureVector 特徵向量
   */
  public remove(id: string, featureVector: number[]): void {
    // 計算項目所在的桶
    const bucketIds = this.hashVector(featureVector);
    
    // 從各個桶中移除項目
    for (const bucketId of bucketIds) {
      if (this.buckets.has(bucketId)) {
        const bucket = this.buckets.get(bucketId)!;
        bucket.delete(id);
        
        if (bucket.size === 0) {
          this.buckets.delete(bucketId);
        }
      }
    }
    
    this.itemCount--;
  }
  
  /**
   * 清空索引
   */
  public clear(): void {
    this.buckets.clear();
    this.itemCount = 0;
  }
  
  /**
   * 獲取索引中的項目數
   */
  public size(): number {
    return this.itemCount;
  }
  
  /**
   * 獲取索引統計信息
   */
  public getStats(): {
    numBuckets: number,
    avgBucketSize: number,
    maxBucketSize: number,
    minBucketSize: number,
    numEmptyBuckets: number
  } {
    let totalSize = 0;
    let maxSize = 0;
    let minSize = Number.MAX_SAFE_INTEGER;
    let emptyBuckets = 0;
    
    for (const bucket of this.buckets.values()) {
      const size = bucket.size;
      totalSize += size;
      maxSize = Math.max(maxSize, size);
      minSize = Math.min(minSize, size);
      
      if (size === 0) {
        emptyBuckets++;
      }
    }
    
    return {
      numBuckets: this.buckets.size,
      avgBucketSize: this.buckets.size > 0 ? totalSize / this.buckets.size : 0,
      maxBucketSize: maxSize,
      minBucketSize: minSize === Number.MAX_SAFE_INTEGER ? 0 : minSize,
      numEmptyBuckets: emptyBuckets
    };
  }
}

/**
 * 合併後的增強 LSH 索引
 * 結合多級 LSH 和 E2LSH 的功能
 */
export class EnhancedLSHIndex {
  private multiProbeLSH: MultiProbeLSHIndex | null = null;
  private e2lsh: E2LSHIndex | null = null;
  private config: EnhancedLSHConfig;
  private useMultiProbe: boolean;
  private useE2LSH: boolean;
  private itemCount = 0;
  private vectorMap = new Map<string, number[]>();
  
  /**
   * 創建增強 LSH 索引
   * @param config LSH 配置
   */
  constructor(config: Partial<EnhancedLSHConfig> = {}) {
    this.config = { ...DEFAULT_ENHANCED_LSH_CONFIG, ...config };
    this.useMultiProbe = true;
    this.useE2LSH = this.config.useE2LSH;
    this.initialize();
  }
  
  /**
   * 初始化索引
   */
  private initialize(): void {
    if (this.useMultiProbe) {
      this.multiProbeLSH = new MultiProbeLSHIndex(this.config);
    }
    
    if (this.useE2LSH) {
      this.e2lsh = new E2LSHIndex(this.config);
    }
  }
  
  /**
   * 將二進制哈希轉換為特徵向量
   * @param binaryHash 二進制哈希字符串
   * @returns 特徵向量
   */
  private hashToFeatureVector(binaryHash: string): number[] {
    return binaryHash.split('').map(bit => bit === '1' ? 1 : -1);
  }
  
  /**
   * 將項目添加到索引
   * @param id 項目 ID
   * @param binaryHash 二進制哈希字符串
   * @param featureVector 可選的特徵向量（用於 E2LSH）
   */
  public insert(id: string, binaryHash: string, featureVector?: number[]): void {
    if (this.multiProbeLSH) {
      this.multiProbeLSH.insert(id, binaryHash);
    }
    
    if (this.useE2LSH && this.e2lsh) {
      // 如果沒有提供特徵向量，從哈希生成
      const vector = featureVector || this.hashToFeatureVector(binaryHash);
      this.e2lsh.insert(id, vector);
      
      // 存儲向量以便後續使用
      this.vectorMap.set(id, vector);
    }
    
    this.itemCount++;
  }
  
  /**
   * 批量插入項目
   * @param items 項目數組 [id, binaryHash, featureVector?]
   */
  public batchInsert(items: Array<[string, string, number[]?]>): void {
    for (const item of items) {
      this.insert(item[0], item[1], item[2]);
    }
  }
  
  /**
   * 查詢與給定哈希相似的項目
   * @param binaryHash 二進制哈希
   * @param featureVector 可選的特徵向量（用於 E2LSH）
   * @param useE2LSH 是否使用 E2LSH（如果可用）
   * @returns 候選項目集合
   */
  public query(
    binaryHash: string,
    featureVector?: number[],
    useE2LSH: boolean = this.useE2LSH
  ): Set<string> {
    const candidates = new Set<string>();
    
    // 從多級 LSH 獲取候選項
    if (this.multiProbeLSH) {
      const multiProbeResults = this.multiProbeLSH.query(binaryHash);
      for (const id of multiProbeResults) {
        candidates.add(id);
      }
    }
    
    // 如果啟用且可用，從 E2LSH 獲取候選項
    if (useE2LSH && this.e2lsh) {
      // 如果沒有提供特徵向量，從哈希生成
      const vector = featureVector || this.hashToFeatureVector(binaryHash);
      const e2lshResults = this.e2lsh.query(vector, true);
      
      for (const id of e2lshResults) {
        candidates.add(id);
      }
    }
    
    return candidates;
  }
  
  /**
   * 移除項目
   * @param id 項目 ID
   * @param binaryHash 二進制哈希字符串
   */
  public remove(id: string, binaryHash: string): void {
    if (this.multiProbeLSH) {
      this.multiProbeLSH.remove(id, binaryHash);
    }
    
    if (this.useE2LSH && this.e2lsh) {
      // 嘗試從存儲的向量中獲取
      const vector = this.vectorMap.get(id) || this.hashToFeatureVector(binaryHash);
      this.e2lsh.remove(id, vector);
      this.vectorMap.delete(id);
    }
    
    this.itemCount--;
  }
  
  /**
   * 清空索引
   */
  public clear(): void {
    if (this.multiProbeLSH) {
      this.multiProbeLSH.clear();
    }
    
    if (this.e2lsh) {
      this.e2lsh.clear();
    }
    
    this.vectorMap.clear();
    this.itemCount = 0;
  }
  
  /**
   * 獲取索引中的項目數
   */
  public size(): number {
    return this.itemCount;
  }
  
  /**
   * 設置是否使用 E2LSH
   * @param use 是否使用
   */
  public setUseE2LSH(use: boolean): void {
    this.useE2LSH = use;
    
    // 如果啟用 E2LSH 但尚未初始化，則初始化
    if (use && !this.e2lsh) {
      this.e2lsh = new E2LSHIndex(this.config);
      
      // 需要將所有項目重新添加到 E2LSH
      if (this.multiProbeLSH && this.multiProbeLSH.size() > 0) {
        console.warn('啟用 E2LSH 時索引已有數據。請考慮重建索引以獲得最佳性能。');
      }
    }
  }
  
  /**
   * 獲取索引配置
   */
  public getConfig(): EnhancedLSHConfig {
    return { ...this.config };
  }
}

/**
 * 創建並返回增強 LSH 索引
 * @param config 增強 LSH 配置
 * @returns 增強 LSH 索引
 */
export function createEnhancedLSHIndex(config?: Partial<EnhancedLSHConfig>): EnhancedLSHIndex {
  return new EnhancedLSHIndex(config);
} 