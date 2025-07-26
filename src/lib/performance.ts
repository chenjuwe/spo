import { EnhancedWorkerPool } from './enhancedWorkerPool'; // Assuming this will be created next
import MemoryOptimizer from './memoryOptimizer';
import * as enhancedWasm from './enhancedWasm';
import { convertHeicToJpegEnhanced, batchConvertHeicFiles } from './enhancedHeicConverter';
import { PhotoFile } from './types';
import ImageWorker from "./imageWorker.ts?worker&inline";

export interface PerformanceMetrics {
  id: string;
  operation: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  details?: Record<string, any>; // 修正: 使 details 可以為 undefined
}

const performanceMetrics: PerformanceMetrics[] = [];

export const workerPool = new EnhancedWorkerPool(ImageWorker, {
  initialWorkers: 2,
  maxWorkers: navigator.hardwareConcurrency || 4,
  taskTimeout: 30000,
  workerTimeout: 60000,
  maxQueueSize: 100
});

export const memoryOptimizer = new MemoryOptimizer({
  maxCacheSize: 50,
  idleTimeout: 60000,
  monitorInterval: 30000,
  memoryThreshold: 0.8
});

export async function initializePerformanceOptimizations(): Promise<boolean> {
  const wasmInitialized = await enhancedWasm.initializeWasmModule();
  
  try {
    await workerPool.initialize();
    console.log('[效能] 工作者池已初始化');
  } catch (error) {
    console.error('[效能] 工作者池初始化失敗:', error);
  }

  enhancedWasm.preloadWasm();
  
  return wasmInitialized;
}

export function recordPerformanceMetric(operation: string, details?: Record<string, any>): string {
  const id = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  performanceMetrics.push({
    id,
    operation,
    startTime: Date.now(),
    success: true,
    details
  });
  
  return id;
}

export function completePerformanceMetric(id: string, success: boolean = true, additionalDetails?: Record<string, any>): void {
  const metric = performanceMetrics.find(m => m.id === id);
  if (!metric) return;
  
  const endTime = Date.now();
  metric.endTime = endTime;
  metric.duration = endTime - metric.startTime;
  metric.success = success;
  
  if (additionalDetails) {
    metric.details = { ...(metric.details || {}), ...additionalDetails };
  }
  
  if (!success) {
    console.warn(`[效能] 操作 ${metric.operation} 失敗，耗時 ${metric.duration}ms`, metric.details);
  } else if (metric.duration > 1000) {
    console.log(`[效能] 操作 ${metric.operation} 完成，耗時 ${metric.duration}ms`, metric.details);
  }
}

export function getMemoryUsage(): number {
  if (window.performance && window.performance.memory) {
    return window.performance.memory.usedJSHeapSize / window.performance.memory.jsHeapSizeLimit;
  }
  return 0;
}

export function renderPhotoGrid<T extends PhotoFile>(
  photos: T[],
  containerElement: HTMLElement,
  renderFunction: (photo: T, index: number) => void
): void {
  memoryOptimizer.progressiveLoadPhotos(photos, containerElement, renderFunction);
}

export function createPhotoPreview(file: File): string {
  return memoryOptimizer.createPreview(file);
}

export function releasePhotoPreview(url: string): void {
  memoryOptimizer.releasePreview(url);
}

export function getWorker(options: {
  priority?: number;
  timeout?: number;
  id?: string;
} = {}): Promise<Worker> {
  return workerPool.getWorker(options);
}

export function releaseWorker(worker: Worker, taskId?: string): void {
  workerPool.releaseWorker(worker, taskId);
}

export function convertHeic(file: File, options: any = {}): Promise<any> {
  const metricId = recordPerformanceMetric('convertHeic', { fileName: file.name, fileSize: file.size });
  
  return convertHeicToJpegEnhanced(file, options)
    .then(result => {
      completePerformanceMetric(metricId, true, { result: 'success' });
      return result;
    })
    .catch(error => {
      completePerformanceMetric(metricId, false, { error: error.message });
      throw error;
    });
}

export function batchConvertHeic(files: File[], options: any = {}): Promise<any[]> {
  const metricId = recordPerformanceMetric('batchConvertHeic', { fileCount: files.length });
  
  return batchConvertHeicFiles(files, options)
    .then(results => {
      completePerformanceMetric(metricId, true, { successCount: results.filter(Boolean).length });
      return results;
    })
    .catch(error => {
      completePerformanceMetric(metricId, false, { error: error.message });
      throw error;
    });
}

export function forceMemoryRelease(): void {
  const releasedCount = memoryOptimizer.releaseIdlePreviews(10000);
  memoryOptimizer.requestGarbageCollection();
  console.log(`[記憶體] 強制釋放了 ${releasedCount} 個預覽資源`);
}

export function getPerformanceStats(): Record<string, any> {
  return {
    metrics: performanceMetrics,
    memory: {
      usage: getMemoryUsage(),
      memoryOptimizerStats: memoryOptimizer.getStats()
    },
    workers: workerPool.getStats()
  };
}

export function cleanup(): void {
  memoryOptimizer.releaseAllPreviews();
  workerPool.terminateAll();
}

initializePerformanceOptimizations().catch(console.error);

export default {
  memoryOptimizer,
  workerPool,
  recordPerformanceMetric,
  completePerformanceMetric,
  getMemoryUsage,
  renderPhotoGrid,
  createPhotoPreview,
  releasePhotoPreview,
  getWorker,
  releaseWorker,
  convertHeic,
  batchConvertHeic,
  forceMemoryRelease,
  getPerformanceStats,
  cleanup
}; 