/**
 * 局部敏感哈希 (LSH) 實現
 * 用於加速大規模圖片比對，減少需要詳細比較的圖片對數
 */

/**
 * LSH 桶配置接口
 */
export interface LSHConfig {
  // 哈希函數數量
  numHashFunctions: number;
  // 桶的數量
  numBuckets: number;
  // 表的數量 (每個表使用不同的哈希函數)
  numTables: number;
  // 位元數 (哈希長度)
  numBits: number;
}

/**
 * 默認 LSH 配置
 */
export const DEFAULT_LSH_CONFIG: LSHConfig = {
  numHashFunctions: 8,
  numBuckets: 256,
  numTables: 4,
  numBits: 64
};

/**
 * LSH 桶索引
 */
type Bucket = Set<string>;

/**
 * LSH 表 (每個表使用一組獨立的哈希函數)
 */
type Table = Map<number, Bucket>;

/**
 * LSH 索引
 */
export class LSHIndex {
  private tables: Table[] = [];
  private config: LSHConfig;
  private projections: number[][][] = [];
  private itemCount = 0;

  /**
   * 創建 LSH 索引
   * @param config LSH 配置
   */
  constructor(config: Partial<LSHConfig> = {}) {
    this.config = { ...DEFAULT_LSH_CONFIG, ...config };
    this.initialize();
  }

  /**
   * 初始化 LSH 索引
   */
  private initialize(): void {
    // 創建哈希表
    for (let i = 0; i < this.config.numTables; i++) {
      this.tables.push(new Map());
    }
    
    // 生成隨機投影向量 (用於 LSH 哈希函數)
    this.generateRandomProjections();
  }

  /**
   * 生成隨機投影向量
   * 對於二進制哈希，我們為每個哈希位生成一個隨機的投影向量
   */
  private generateRandomProjections(): void {
    // 對每個表生成一組投影向量
    for (let t = 0; t < this.config.numTables; t++) {
      const tableProjections: number[][] = [];
      
      // 每個表有多個哈希函數
      for (let h = 0; h < this.config.numHashFunctions; h++) {
        const projection: number[] = [];
        
        // 每個哈希函數有一個與哈希維度相同長度的隨機向量
        for (let i = 0; i < this.config.numBits; i++) {
          // 生成 -1 或 1 的隨機值
          projection.push(Math.random() > 0.5 ? 1 : -1);
        }
        
        tableProjections.push(projection);
      }
      
      this.projections.push(tableProjections);
    }
  }

  /**
   * 將二進制哈希轉換為特徵向量
   * @param binaryHash 二進制哈希字符串
   * @returns 特徵向量
   */
  private hashToFeatureVector(binaryHash: string): number[] {
    const vector: number[] = [];
    
    // 將每個字符轉換為 1/-1 值
    for (let i = 0; i < binaryHash.length; i++) {
      vector.push(binaryHash[i] === '1' ? 1 : -1);
    }
    
    // 填充到指定位數
    while (vector.length < this.config.numBits) {
      vector.push(0);
    }
    
    return vector;
  }

  /**
   * 對特徵向量生成 LSH 簽名
   * @param vector 特徵向量
   * @param tableIndex 表索引
   * @returns LSH 簽名
   */
  private generateSignature(vector: number[], tableIndex: number): number {
    let signature = 0;
    const tableProjections = this.projections[tableIndex];
    
    // 對每個哈希函數
    for (let h = 0; h < this.config.numHashFunctions; h++) {
      const projection = tableProjections[h];
      let dotProduct = 0;
      
      // 計算點積
      for (let i = 0; i < Math.min(vector.length, projection.length); i++) {
        dotProduct += vector[i] * projection[i];
      }
      
      // 根據點積結果設置對應位
      if (dotProduct > 0) {
        signature |= (1 << h);
      }
    }
    
    // 映射到桶範圍內
    return signature % this.config.numBuckets;
  }

  /**
   * 將項目添加到 LSH 索引
   * @param id 項目 ID
   * @param binaryHash 二進制哈希
   */
  public insert(id: string, binaryHash: string): void {
    const vector = this.hashToFeatureVector(binaryHash);
    
    // 將項目添加到每個表的相應桶中
    for (let t = 0; t < this.config.numTables; t++) {
      const signature = this.generateSignature(vector, t);
      const table = this.tables[t];
      
      if (!table.has(signature)) {
        table.set(signature, new Set());
      }
      
      table.get(signature)!.add(id);
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
   * 查詢與給定哈希相似的項目
   * @param binaryHash 二進制哈希
   * @returns 候選項目集合
   */
  public query(binaryHash: string): Set<string> {
    const vector = this.hashToFeatureVector(binaryHash);
    const candidates = new Set<string>();
    
    // 從每個表中查詢候選項
    for (let t = 0; t < this.config.numTables; t++) {
      const signature = this.generateSignature(vector, t);
      const table = this.tables[t];
      
      if (table.has(signature)) {
        const bucket = table.get(signature)!;
        for (const id of bucket) {
          candidates.add(id);
        }
      }
    }
    
    return candidates;
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
    const vector = this.hashToFeatureVector(binaryHash);
    
    for (let t = 0; t < this.config.numTables; t++) {
      const signature = this.generateSignature(vector, t);
      const table = this.tables[t];
      
      if (table.has(signature)) {
        const bucket = table.get(signature)!;
        bucket.delete(id);
        
        if (bucket.size === 0) {
          table.delete(signature);
        }
      }
    }
    
    this.itemCount--;
  }
  
  /**
   * 清空索引
   */
  public clear(): void {
    for (const table of this.tables) {
      table.clear();
    }
    this.itemCount = 0;
  }
  
  /**
   * 獲取索引中的項目數
   */
  public size(): number {
    return this.itemCount;
  }
  
  /**
   * 獲取所有表的桶數統計
   */
  public getBucketStats(): { tableIndex: number, bucketCount: number, avgBucketSize: number }[] {
    const stats = [];
    
    for (let i = 0; i < this.tables.length; i++) {
      const table = this.tables[i];
      const bucketCount = table.size;
      let totalItems = 0;
      
      for (const bucket of table.values()) {
        totalItems += bucket.size;
      }
      
      const avgBucketSize = bucketCount > 0 ? totalItems / bucketCount : 0;
      
      stats.push({
        tableIndex: i,
        bucketCount,
        avgBucketSize
      });
    }
    
    return stats;
  }
  
  /**
   * 獲取索引配置
   */
  public getConfig(): LSHConfig {
    return { ...this.config };
  }
}

/**
 * 將哈希字符串轉換為二進制字符串
 * @param hash 十六進制哈希字符串
 * @returns 二進制哈希字符串
 */
export function hexToBinary(hash: string): string {
  let binary = '';
  
  for (let i = 0; i < hash.length; i++) {
    const hexChar = parseInt(hash[i], 16);
    const binChar = hexChar.toString(2).padStart(4, '0');
    binary += binChar;
  }
  
  return binary;
}

/**
 * 組合多個哈希為一個長哈希
 * @param hashes 多個哈希值
 * @returns 組合後的長哈希
 */
export function combineHashes(hashes: { aHash?: string; dHash?: string; pHash?: string }): string {
  let combinedBinary = '';
  
  if (hashes.aHash) {
    combinedBinary += hexToBinary(hashes.aHash);
  }
  
  if (hashes.dHash) {
    combinedBinary += hexToBinary(hashes.dHash);
  }
  
  if (hashes.pHash) {
    combinedBinary += hexToBinary(hashes.pHash);
  }
  
  return combinedBinary;
}

/**
 * 創建並返回一個 LSH 索引
 * @param config LSH 配置
 * @returns LSH 索引
 */
export function createLSHIndex(config?: Partial<LSHConfig>): LSHIndex {
  return new LSHIndex(config);
} 