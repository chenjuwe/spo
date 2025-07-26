/**
 * 效能測試框架
 * 提供各種圖像處理和特徵提取的效能基準測試
 */

import { WebGpuAccelerator, VectorCompareConfig } from './webGpuAcceleration';
import { EnhancedWorkerPool } from './enhancedWorkerPool';
import { FeatureStorage } from './featureStorage';
import { IncrementalFeatureIndex } from './incrementalLearning';
import { PhotoFile } from './types';
import { randomBytes } from 'crypto';

/**
 * 效能測試結果
 */
export interface PerformanceTestResult {
  /**
   * 測試名稱
   */
  name: string;
  
  /**
   * 執行時間（毫秒）
   */
  executionTimeMs: number;
  
  /**
   * 處理項目數量
   */
  itemCount: number;
  
  /**
   * 每秒處理項目數
   */
  itemsPerSecond: number;
  
  /**
   * 記憶體使用增量（字節）
   * 如果為負值，表示記憶體減少
   */
  memoryDelta?: number;
  
  /**
   * 其他測量指標
   */
  metrics?: Record<string, number>;
  
  /**
   * 錯誤信息（如果有）
   */
  error?: string;
}

/**
 * 效能測試選項
 */
export interface PerformanceTestOptions {
  /**
   * 是否顯示詳細日誌
   */
  verbose?: boolean;
  
  /**
   * 預熱運行次數
   */
  warmupRuns?: number;
  
  /**
   * 測試運行次數
   */
  testRuns?: number;
  
  /**
   * 是否測量記憶體使用
   */
  measureMemory?: boolean;
  
  /**
   * 是否啟用 GPU 測試
   */
  enableGpu?: boolean;
  
  /**
   * 是否跳過大型測試
   */
  skipLargeTests?: boolean;
}

/**
 * 效能測試框架
 * 用於測試各種功能的效能表現
 */
export class PerformanceTester {
  /**
   * 測試選項
   */
  private options: Required<PerformanceTestOptions>;
  
  /**
   * WebGPU 加速器
   */
  private gpuAccelerator: WebGpuAccelerator | null = null;
  
  /**
   * GPU 可用性
   */
  private gpuAvailable: boolean = false;
  
  /**
   * 是否已初始化
   */
  private initialized: boolean = false;

  /**
   * 創建效能測試框架
   * @param options 測試選項
   */
  constructor(options: PerformanceTestOptions = {}) {
    this.options = {
      verbose: options.verbose ?? false,
      warmupRuns: options.warmupRuns ?? 2,
      testRuns: options.testRuns ?? 5,
      measureMemory: options.measureMemory ?? true,
      enableGpu: options.enableGpu ?? true,
      skipLargeTests: options.skipLargeTests ?? false
    };
  }

  /**
   * 初始化測試環境
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    
    if (this.options.enableGpu) {
      this.gpuAccelerator = new WebGpuAccelerator();
      this.gpuAvailable = await this.gpuAccelerator.isGpuAvailable();
      
      if (this.options.verbose) {
        console.info(`WebGPU 可用性: ${this.gpuAvailable ? '可用' : '不可用'}`);
      }
    }
    
    this.initialized = true;
  }

  /**
   * 運行單個測試
   * @param name 測試名稱
   * @param fn 測試函數
   * @param itemCount 處理項目數量
   * @param metrics 其他指標計算函數
   * @returns 測試結果
   */
  public async runTest(
    name: string,
    fn: () => Promise<any>,
    itemCount: number = 1,
    metrics?: () => Record<string, number>
  ): Promise<PerformanceTestResult> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    try {
      // 預熱運行
      for (let i = 0; i < this.options.warmupRuns; i++) {
        await fn();
      }
      
      // 執行垃圾回收（如果可用）
      if (global.gc) {
        global.gc();
      }
      
      // 測量記憶體使用
      let memoryBefore = 0;
      if (this.options.measureMemory) {
        memoryBefore = process.memoryUsage().heapUsed;
      }
      
      // 測量執行時間
      const startTime = performance.now();
      
      // 執行測試
      const testRunResults = [];
      for (let i = 0; i < this.options.testRuns; i++) {
        const runStart = performance.now();
        await fn();
        const runEnd = performance.now();
        testRunResults.push(runEnd - runStart);
      }
      
      const endTime = performance.now();
      
      // 計算平均執行時間（排除最高和最低值）
      const sortedResults = [...testRunResults].sort((a, b) => a - b);
      const trimmedResults = sortedResults.slice(1, -1);
      const avgExecutionTime = trimmedResults.reduce((sum, time) => sum + time, 0) / trimmedResults.length;
      
      // 測量記憶體使用
      let memoryDelta: number | undefined;
      if (this.options.measureMemory) {
        const memoryAfter = process.memoryUsage().heapUsed;
        memoryDelta = memoryAfter - memoryBefore;
      }
      
      // 計算每秒處理項目數
      const itemsPerSecond = itemCount / (avgExecutionTime / 1000);
      
      // 獲取其他指標
      const metricsValues = metrics ? metrics() : {};
      
      if (this.options.verbose) {
        console.info(`測試 "${name}" 完成，平均執行時間: ${avgExecutionTime.toFixed(2)}ms，每秒處理: ${itemsPerSecond.toFixed(2)} 項`);
      }
      
      return {
        name,
        executionTimeMs: avgExecutionTime,
        itemCount,
        itemsPerSecond,
        memoryDelta,
        metrics: metricsValues
      };
    } catch (error) {
      console.error(`測試 "${name}" 失敗:`, error);
      
      return {
        name,
        executionTimeMs: 0,
        itemCount,
        itemsPerSecond: 0,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 運行一組測試
   * @param tests 測試配置數組
   * @returns 測試結果數組
   */
  public async runTestSuite(
    tests: Array<{
      name: string;
      fn: () => Promise<any>;
      itemCount?: number;
      metrics?: () => Record<string, number>;
      skipIf?: () => boolean;
    }>
  ): Promise<PerformanceTestResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const results: PerformanceTestResult[] = [];
    
    for (const test of tests) {
      // 檢查是否應該跳過測試
      if (test.skipIf && test.skipIf()) {
        if (this.options.verbose) {
          console.info(`跳過測試 "${test.name}"`);
        }
        continue;
      }
      
      const result = await this.runTest(
        test.name,
        test.fn,
        test.itemCount,
        test.metrics
      );
      
      results.push(result);
    }
    
    return results;
  }

  /**
   * 測試向量比較效能
   * @param dimensions 維度數組
   * @param counts 向量數量數組
   * @param distanceMeasures 距離度量
   * @returns 測試結果
   */
  public async testVectorComparison(
    dimensions: number[] = [128, 256, 512],
    counts: number[] = [1000, 10000],
    distanceMeasures: Array<'cosine' | 'euclidean'> = ['cosine', 'euclidean']
  ): Promise<PerformanceTestResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const results: PerformanceTestResult[] = [];
    
    // 跳過大型測試如果選項設置為 true
    if (this.options.skipLargeTests) {
      dimensions = [128];
      counts = [1000];
    }
    
    for (const dimension of dimensions) {
      for (const count of counts) {
        for (const measure of distanceMeasures) {
          // 生成測試數據
          const reference = Array(dimension).fill(0).map(() => Math.random());
          const vectors = Array(count).fill(0).map(() => 
            Array(dimension).fill(0).map(() => Math.random())
          );
          
          // CPU 測試
          const cpuResult = await this.runTest(
            `CPU 向量比較 (${measure}, ${dimension}d, ${count} 向量)`,
            async () => {
              const results = [];
              if (measure === 'cosine') {
                for (let i = 0; i < count; i++) {
                  let dotProduct = 0;
                  let normA = 0;
                  let normB = 0;
                  
                  for (let j = 0; j < dimension; j++) {
                    dotProduct += reference[j] * vectors[i][j];
                    normA += reference[j] * reference[j];
                    normB += vectors[i][j] * vectors[i][j];
                  }
                  
                  const norm = Math.sqrt(normA) * Math.sqrt(normB);
                  results.push(norm < 0.000001 ? 0 : dotProduct / norm);
                }
              } else {
                for (let i = 0; i < count; i++) {
                  let sum = 0;
                  for (let j = 0; j < dimension; j++) {
                    const diff = reference[j] - vectors[i][j];
                    sum += diff * diff;
                  }
                  results.push(Math.sqrt(sum));
                }
              }
              return results;
            },
            count
          );
          
          results.push(cpuResult);
          
          // GPU 測試 (如果可用)
          if (this.gpuAvailable && this.gpuAccelerator) {
            const config: Partial<VectorCompareConfig> = {
              distanceMeasure: measure,
              batchSize: 5000
            };
            
            const gpuResult = await this.runTest(
              `GPU 向量比較 (${measure}, ${dimension}d, ${count} 向量)`,
              async () => {
                return this.gpuAccelerator!.compareVectors(reference, vectors, config);
              },
              count
            );
            
            results.push(gpuResult);
          }
        }
      }
    }
    
    return results;
  }

  /**
   * 測試矩陣乘法效能
   * @param sizes 矩陣尺寸數組 [M, K, N]
   * @returns 測試結果
   */
  public async testMatrixMultiplication(
    sizes: Array<[number, number, number]> = [[64, 64, 64], [128, 128, 128], [256, 256, 256]]
  ): Promise<PerformanceTestResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const results: PerformanceTestResult[] = [];
    
    // 跳過大型測試如果選項設置為 true
    if (this.options.skipLargeTests) {
      sizes = [[64, 64, 64]];
    }
    
    for (const [M, K, N] of sizes) {
      // 生成測試數據
      const matrixA = Array(M).fill(0).map(() => 
        Array(K).fill(0).map(() => Math.random())
      );
      
      const matrixB = Array(K).fill(0).map(() => 
        Array(N).fill(0).map(() => Math.random())
      );
      
      // CPU 測試
      const cpuResult = await this.runTest(
        `CPU 矩陣乘法 (${M}x${K} × ${K}x${N})`,
        async () => {
          const result: number[][] = Array(M);
          for (let i = 0; i < M; i++) {
            result[i] = Array(N).fill(0);
            for (let j = 0; j < N; j++) {
              let sum = 0;
              for (let k = 0; k < K; k++) {
                sum += matrixA[i][k] * matrixB[k][j];
              }
              result[i][j] = sum;
            }
          }
          return result;
        },
        M * N * K
      );
      
      results.push(cpuResult);
      
      // GPU 測試 (如果可用)
      if (this.gpuAvailable && this.gpuAccelerator) {
        const gpuResult = await this.runTest(
          `GPU 矩陣乘法 (${M}x${K} × ${K}x${N})`,
          async () => {
            return this.gpuAccelerator!.multiplyMatrices(matrixA, matrixB);
          },
          M * N * K
        );
        
        results.push(gpuResult);
      }
    }
    
    return results;
  }

  /**
   * 測試 Worker 池效能
   * @param workerScriptUrl Worker 腳本 URL
   * @param taskCounts 任務數量數組
   * @param taskComplexity 任務複雜度 (0-1)
   * @returns 測試結果
   */
  public async testWorkerPool(
    workerScriptUrl: string,
    taskCounts: number[] = [10, 50, 100],
    taskComplexity: number = 0.5
  ): Promise<PerformanceTestResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const results: PerformanceTestResult[] = [];
    
    // 跳過大型測試如果選項設置為 true
    if (this.options.skipLargeTests) {
      taskCounts = [10];
    }
    
    for (const taskCount of taskCounts) {
      // 準備測試
      const standardPoolResult = await this.runTest(
        `標準 Worker 池 (${taskCount} 任務)`,
        async () => {
          const workerPool = new EnhancedWorkerPool({
            scriptUrl: workerScriptUrl,
            minWorkers: 2,
            maxWorkers: 4,
            useSharedArrayBuffer: false
          });
          
          // 提交所有任務
          const promises = [];
          for (let i = 0; i < taskCount; i++) {
            const taskId = workerPool.submitTask({
              action: 'computeIntensive',
              complexity: taskComplexity,
              data: { index: i }
            });
            
            promises.push(workerPool.waitForTask(taskId));
          }
          
          // 等待所有任務完成
          const results = await Promise.all(promises);
          
          // 關閉 Worker 池
          workerPool.shutdown();
          
          return results;
        },
        taskCount,
        () => ({
          tasksPerWorker: taskCount / 4
        })
      );
      
      results.push(standardPoolResult);
      
      // 自適應 Worker 池測試
      const adaptivePoolResult = await this.runTest(
        `自適應 Worker 池 (${taskCount} 任務)`,
        async () => {
          const workerPool = new EnhancedWorkerPool({
            scriptUrl: workerScriptUrl,
            minWorkers: 2,
            maxWorkers: navigator.hardwareConcurrency || 8,
            idleTimeout: 1000,
            useSharedArrayBuffer: false
          });
          
          // 提交所有任務
          const promises = [];
          for (let i = 0; i < taskCount; i++) {
            const taskId = workerPool.submitTask({
              action: 'computeIntensive',
              complexity: taskComplexity,
              data: { index: i }
            });
            
            promises.push(workerPool.waitForTask(taskId));
          }
          
          // 等待所有任務完成
          const results = await Promise.all(promises);
          
          // 獲取工作池統計信息
          const stats = workerPool.getStatistics();
          
          // 關閉 Worker 池
          workerPool.shutdown();
          
          return { results, stats };
        },
        taskCount,
        () => ({
          tasksPerWorker: taskCount / (navigator.hardwareConcurrency || 8)
        })
      );
      
      results.push(adaptivePoolResult);
    }
    
    return results;
  }

  /**
   * 測試 IndexedDB 存儲效能
   * @param itemCounts 特徵點數量數組
   * @returns 測試結果
   */
  public async testIndexedDBStorage(
    itemCounts: number[] = [100, 500]
  ): Promise<PerformanceTestResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const results: PerformanceTestResult[] = [];
    
    // 跳過大型測試如果選項設置為 true
    if (this.options.skipLargeTests) {
      itemCounts = [100];
    }
    
    for (const itemCount of itemCounts) {
      // 生成測試數據
      const testFeatures = Array(itemCount).fill(0).map((_, i) => ({
        id: `feature_${i}`,
        photoId: `photo_${Math.floor(i / 3)}`, // 每 3 個特徵對應一張照片
        vector: Array(128).fill(0).map(() => Math.random()),
        level: i % 3, // 0, 1, 或 2 表示不同級別
        lastUpdated: Date.now(),
        accessCount: 0
      }));
      
      // 測試寫入效能
      const dbName = `test_db_${Date.now()}`;
      
      const writeResult = await this.runTest(
        `IndexedDB 寫入 (${itemCount} 項)`,
        async () => {
          // 創建存儲實例
          const storage = new FeatureStorage({
            dbName,
            storeName: 'features',
            version: 1,
            memoryCacheSize: Math.min(1000, itemCount)
          });
          
          // 寫入數據
          for (const feature of testFeatures) {
            await storage.saveFeaturePoint(feature, feature.photoId);
          }
          
          // 關閉存儲
          storage.close();
          
          return { count: itemCount };
        },
        itemCount
      );
      
      results.push(writeResult);
      
      // 測試讀取效能
      const readResult = await this.runTest(
        `IndexedDB 讀取 (${itemCount} 項)`,
        async () => {
          // 創建存儲實例
          const storage = new FeatureStorage({
            dbName,
            storeName: 'features',
            version: 1,
            memoryCacheSize: Math.min(1000, itemCount / 2) // 設置較小的緩存以測試 DB 讀取
          });
          
          // 讀取數據
          const features = [];
          for (const feature of testFeatures) {
            const retrieved = await storage.getFeaturePoint(feature.id);
            if (retrieved) {
              features.push(retrieved);
            }
          }
          
          // 獲取緩存統計信息
          const stats = storage.getStats();
          
          // 關閉存儲
          storage.close();
          
          return { 
            count: features.length, 
            memoryHits: stats.memoryHits,
            dbHits: stats.indexedDBHits,
            misses: stats.misses
          };
        },
        itemCount,
        () => ({
          hitRate: 1.0
        })
      );
      
      results.push(readResult);
      
      // 測試帶緩存的讀取效能
      const cachedReadResult = await this.runTest(
        `IndexedDB 緩存讀取 (${itemCount} 項)`,
        async () => {
          // 創建存儲實例
          const storage = new FeatureStorage({
            dbName,
            storeName: 'features',
            version: 1,
            memoryCacheSize: itemCount * 2 // 足夠大的緩存
          });
          
          // 首次讀取，填充緩存
          for (const feature of testFeatures) {
            await storage.getFeaturePoint(feature.id);
          }
          
          // 重置統計信息
          storage.resetStats();
          
          // 再次讀取，從緩存獲取
          const features = [];
          const startTime = performance.now();
          
          for (const feature of testFeatures) {
            const retrieved = await storage.getFeaturePoint(feature.id);
            if (retrieved) {
              features.push(retrieved);
            }
          }
          
          const endTime = performance.now();
          
          // 獲取緩存統計信息
          const stats = storage.getStats();
          
          // 關閉存儲
          storage.close();
          
          return { 
            count: features.length, 
            memoryHits: stats.memoryHits,
            dbHits: stats.indexedDBHits,
            misses: stats.misses,
            timeMs: endTime - startTime
          };
        },
        itemCount,
        () => ({
          cacheHitRate: 1.0
        })
      );
      
      results.push(cachedReadResult);
      
      // 刪除測試數據庫
      const deleteRequest = indexedDB.deleteDatabase(dbName);
      await new Promise<void>((resolve) => {
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => resolve();
      });
    }
    
    return results;
  }

  /**
   * 測試 KD 樹和特徵索引效能
   * @param dimensions 特徵維度數組
   * @param itemCounts 項目數量數組
   * @returns 測試結果
   */
  public async testFeatureIndexing(
    dimensions: number[] = [64, 128],
    itemCounts: number[] = [100, 500]
  ): Promise<PerformanceTestResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const results: PerformanceTestResult[] = [];
    
    // 跳過大型測試如果選項設置為 true
    if (this.options.skipLargeTests) {
      dimensions = [64];
      itemCounts = [100];
    }
    
    for (const dimension of dimensions) {
      for (const itemCount of itemCounts) {
        // 生成測試數據
        const testPhotos: PhotoFile[] = Array(itemCount).fill(0).map((_, i) => ({
          id: `photo_${i}`,
          file: null as any,
          name: `photo_${i}.jpg`,
          type: 'image/jpeg',
          size: 1024,
          path: `/fake/path/photo_${i}.jpg`,
          lastModified: Date.now()
        }));
        
        // 模擬特徵提取系統
        const mockSimilaritySystem = {
          extractMultiLevelFeatures: async (photo: PhotoFile) => {
            // 生成隨機特徵
            return {
              highLevelFeatures: Array(dimension).fill(0).map(() => Math.random()),
              midLevelFeatures: {
                colorHistogram: Array(32).fill(0).map(() => Math.random()),
                textureFeatures: Array(32).fill(0).map(() => Math.random())
              },
              lowLevelFeatures: {
                aHash: Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
                dHash: Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
                pHash: Array(16).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')
              }
            };
          }
        };
        
        // 測試特徵索引構建
        const buildResult = await this.runTest(
          `特徵索引構建 (${dimension}d, ${itemCount} 項)`,
          async () => {
            // 創建增量特徵索引
            const featureIndex = new IncrementalFeatureIndex({
              incrementalThreshold: Math.max(10, Math.floor(itemCount / 5)),
              rebuildThreshold: 3,
              compressionRatio: 0.8
            });
            
            // 設置相似度系統
            featureIndex.setSimilaritySystem(mockSimilaritySystem as any);
            
            // 添加特徵
            const result = await featureIndex.addOrUpdateFeatures(testPhotos);
            
            return result;
          },
          itemCount
        );
        
        results.push(buildResult);
      }
    }
    
    return results;
  }

  /**
   * 格式化測試結果為 CSV
   * @param results 測試結果
   * @returns CSV 格式的結果
   */
  public formatResultsAsCsv(results: PerformanceTestResult[]): string {
    if (results.length === 0) return '';
    
    // 獲取所有度量名稱
    const allMetricNames = new Set<string>();
    results.forEach(result => {
      if (result.metrics) {
        Object.keys(result.metrics).forEach(key => allMetricNames.add(key));
      }
    });
    
    // 準備表頭
    const headers = ['測試名稱', '執行時間 (ms)', '項目數量', '每秒項目數'];
    
    if (results.some(r => r.memoryDelta !== undefined)) {
      headers.push('記憶體增量 (bytes)');
    }
    
    // 添加所有度量名稱
    allMetricNames.forEach(name => headers.push(name));
    
    // 添加錯誤列
    headers.push('錯誤');
    
    // 生成 CSV 行
    const lines = [headers.join(',')];
    
    for (const result of results) {
      const line = [
        `"${result.name}"`,
        result.executionTimeMs.toFixed(2),
        result.itemCount,
        result.itemsPerSecond.toFixed(2)
      ];
      
      // 添加記憶體增量
      if (headers.includes('記憶體增量 (bytes)')) {
        line.push(result.memoryDelta !== undefined ? result.memoryDelta.toString() : '');
      }
      
      // 添加度量
      for (const name of Array.from(allMetricNames)) {
        const value = result.metrics?.[name];
        line.push(value !== undefined ? value.toString() : '');
      }
      
      // 添加錯誤
      line.push(result.error ? `"${result.error}"` : '');
      
      lines.push(line.join(','));
    }
    
    return lines.join('\n');
  }

  /**
   * 運行所有效能測試
   * @param workerScriptUrl Worker 腳本 URL
   * @returns 測試結果
   */
  public async runAllTests(workerScriptUrl: string): Promise<PerformanceTestResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const results: PerformanceTestResult[] = [];
    
    // 向量比較測試
    const vectorResults = await this.testVectorComparison();
    results.push(...vectorResults);
    
    // 矩陣乘法測試
    const matrixResults = await this.testMatrixMultiplication();
    results.push(...matrixResults);
    
    // Worker 池測試
    const workerResults = await this.testWorkerPool(workerScriptUrl);
    results.push(...workerResults);
    
    // IndexedDB 存儲測試
    const storageResults = await this.testIndexedDBStorage();
    results.push(...storageResults);
    
    // 特徵索引測試
    const indexingResults = await this.testFeatureIndexing();
    results.push(...indexingResults);
    
    return results;
  }
}

/**
 * 生成隨機數據
 * @param size 數據大小（字節）
 * @returns 隨機數據
 */
export function generateRandomData(size: number): Uint8Array {
  return new Uint8Array(Array(size).fill(0).map(() => Math.floor(Math.random() * 256)));
}

/**
 * 創建隨機矩陣
 * @param rows 行數
 * @param cols 列數
 * @returns 隨機矩陣
 */
export function createRandomMatrix(rows: number, cols: number): number[][] {
  return Array(rows).fill(0).map(() => 
    Array(cols).fill(0).map(() => Math.random())
  );
} 