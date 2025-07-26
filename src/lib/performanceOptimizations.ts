/**
 * 性能優化集成模組
 * 將各種優化整合到系統中
 */

import { EnhancedWorkerPool } from './enhancedWorkerPool';
import MemoryOptimizer from './memoryOptimizer';
import * as enhancedWasm from './enhancedWasm';
import { convertHeicToJpegEnhanced, batchConvertHeicFiles } from './enhancedHeicConverter';
import { PhotoFile } from './types';
import ImageWorker from "./imageWorker.ts?worker&inline";

// 記錄效能指標
export interface PerformanceMetrics {
  id: string;
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  batchSize?: number;
  memoryUsage?: number;
  success: boolean;
  details?: Record<string, any>;
}

// 全局效能指標記錄
const performanceMetrics: PerformanceMetrics[] = [];

// 創建全局工作者池
export const workerPool = new EnhancedWorkerPool(ImageWorker, {
  maxWorkers: Math.max(2, navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 : 4),
  minIdleWorkers: 1,
  taskPriorityLevels: 3,
  enableAdaptiveScaling: true
});

// 創建全局記憶體優化器
export const memoryOptimizer = new MemoryOptimizer({
  highMemoryThreshold: 350,
  criticalMemoryThreshold: 550,
  autoReleaseEnabled: true,
  maxPreviewsInMemory: 150,
  progressiveLoadEnabled: true
});

/**
 * 初始化效能優化
 * 預熱關鍵組件
 */
export async function initializePerformanceOptimizations(): Promise<boolean> {
  const startTime = performance.now();
  const metricsId = `init-${Date.now()}`;
  
  try {
    // 記錄開始指標
    performanceMetrics.push({
      id: metricsId,
      operation: 'initialize-optimizations',
      startTime,
      success: false
    });
    
    // 異步初始化 WASM 模組
    const wasmInitPromise = enhancedWasm.initializeWasmModule()
      .then(success => {
        console.info(`WASM 模組初始化${success ? '成功' : '失敗'}`);
        return success;
      })
      .catch(err => {
        console.warn('WASM 初始化錯誤:', err);
        return false;
      });
    
    // 等待初始化完成
    const wasmInitialized = await wasmInitPromise;
    
    // 記錄完成指標
    const endTime = performance.now();
    const durationMs = endTime - startTime;
    
    // 更新效能指標
    const metricsIndex = performanceMetrics.findIndex(m => m.id === metricsId);
    if (metricsIndex >= 0) {
      performanceMetrics[metricsIndex] = {
        ...performanceMetrics[metricsIndex],
        endTime,
        duration: durationMs,
        success: true,
        details: {
          wasmInitialized
        }
      };
    }
    
    console.info(`效能優化初始化完成，耗時 ${durationMs.toFixed(2)}ms`);
    return true;
  } catch (error) {
    // 更新效能指標錯誤信息
    const metricsIndex = performanceMetrics.findIndex(m => m.id === metricsId);
    if (metricsIndex >= 0) {
      performanceMetrics[metricsIndex] = {
        ...performanceMetrics[metricsIndex],
        endTime: performance.now(),
        duration: performance.now() - startTime,
        success: false,
        details: {
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
    
    console.error('效能優化初始化失敗:', error);
    return false;
  }
}

/**
 * 記錄效能指標
 * @param operation 操作名稱
 * @param details 附加詳情
 * @returns 指標ID，用於更新結束時間
 */
export function recordPerformanceMetric(
  operation: string,
  details?: Record<string, any>
): string {
  const id = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  
  performanceMetrics.push({
    id,
    operation,
    startTime: performance.now(),
    success: false,
    details
  });
  
  return id;
}

/**
 * 完成效能指標記錄
 * @param id 指標ID
 * @param success 是否成功
 * @param additionalDetails 附加詳情
 */
export function completePerformanceMetric(
  id: string,
  success: boolean = true,
  additionalDetails?: Record<string, any>
): void {
  const index = performanceMetrics.findIndex(m => m.id === id);
  if (index >= 0) {
    const endTime = performance.now();
    const metric = performanceMetrics[index];
    
    performanceMetrics[index] = {
      ...metric,
      endTime,
      duration: endTime - metric.startTime,
      success,
      details: {
        ...metric.details,
        ...additionalDetails,
        memoryUsage: getMemoryUsage()
      }
    };
  }
}

/**
 * 獲取當前記憶體使用
 */
export function getMemoryUsage(): number {
  if (window.performance && (window.performance as any).memory) {
    const memoryInfo = (window.performance as any).memory;
    return Math.round(memoryInfo.usedJSHeapSize / (1024 * 1024));
  }
  return 0;
}

/**
 * 使用漸進式載入方式渲染照片網格
 * @param photos 照片列表
 * @param containerElement 容器元素
 * @param renderFunction 渲染函數
 */
export function renderPhotoGrid<T extends PhotoFile>(
  photos: T[],
  containerElement: HTMLElement,
  renderFunction: (photo: T, index: number) => void
): void {
  memoryOptimizer.progressiveLoadPhotos(photos, containerElement, renderFunction);
}

/**
 * 為照片創建預覽URL，並自動管理記憶體
 * @param file 檔案
 * @returns 預覽URL
 */
export function createPhotoPreview(file: File): string {
  return memoryOptimizer.createPreview(file);
}

/**
 * 釋放照片預覽URL
 * @param url 預覽URL
 */
export function releasePhotoPreview(url: string): void {
  memoryOptimizer.releasePreview(url);
}

/**
 * 獲取工作者進行任務處理
 * @param options 選項
 * @returns 工作者
 */
export function getWorker(options: {
  priority?: number;
  taskSize?: number;
  timeout?: number;
  taskId?: string;
} = {}): Promise<Worker> {
  return workerPool.getWorker(options);
}

/**
 * 釋放工作者
 * @param worker 工作者
 * @param taskId 任務ID
 */
export function releaseWorker(worker: Worker, taskId?: string): void {
  workerPool.releaseWorker(worker, taskId);
}

/**
 * 使用增強的 HEIC 轉換
 * @param file 檔案
 * @param options 選項
 * @returns 轉換結果
 */
export function convertHeic(file: File, options: any = {}): Promise<any> {
  const metricId = recordPerformanceMetric('convert-heic', { fileSize: file.size });
  
  return convertHeicToJpegEnhanced(file, options)
    .then(result => {
      completePerformanceMetric(metricId, true, { 
        compressionRatio: result.compressionRatio,
        processingTime: result.processingTime
      });
      return result;
    })
    .catch(error => {
      completePerformanceMetric(metricId, false, { error: String(error) });
      throw error;
    });
}

/**
 * 批量轉換 HEIC 檔案
 * @param files 檔案列表
 * @param options 選項
 * @returns 轉換結果陣列
 */
export function batchConvertHeic(files: File[], options: any = {}): Promise<any[]> {
  const metricId = recordPerformanceMetric('batch-convert-heic', { 
    fileCount: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0)
  });
  
  return batchConvertHeicFiles(files, options)
    .then(results => {
      completePerformanceMetric(metricId, true, {
        successCount: results.filter(r => r !== null).length,
        failCount: results.filter(r => r === null).length
      });
      return results;
    })
    .catch(error => {
      completePerformanceMetric(metricId, false, { error: String(error) });
      throw error;
    });
}

/**
 * 強制釋放記憶體
 */
export function forceMemoryRelease(): void {
  // 釋放閒置的預覽
  memoryOptimizer.releaseIdlePreviews(10000, 0);
  
  // 請求垃圾回收
  memoryOptimizer.requestGarbageCollection();
}

/**
 * 獲取效能指標統計
 */
export function getPerformanceStats(): Record<string, any> {
  return {
    metrics: performanceMetrics,
    memory: {
      current: getMemoryUsage(),
      optimizer: memoryOptimizer.getStats()
    },
    workers: workerPool.getStats()
  };
}

/**
 * 關閉和清理所有資源
 */
export function cleanup(): void {
  // 銷毀記憶體優化器
  memoryOptimizer.destroy();
  
  // 終止工作者池
  workerPool.terminate();
}

// 在載入時初始化
initializePerformanceOptimizations().catch(console.error);

// 導出默認接口
export default {
  initializePerformanceOptimizations,
  renderPhotoGrid,
  createPhotoPreview,
  releasePhotoPreview,
  getWorker,
  releaseWorker,
  convertHeic,
  batchConvertHeic,
  forceMemoryRelease,
  getPerformanceStats,
  cleanup,
  memoryOptimizer,
  workerPool
}; 