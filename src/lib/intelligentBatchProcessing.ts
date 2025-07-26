/**
 * 智能批量處理模塊
 * 用於優化大規模圖像處理，動態調整批量大小和並行度
 */

import { AdaptiveSampling, AdaptiveSamplingConfig } from './adaptiveSampling';
import { PhotoFile } from '@/lib/types';
import { errorHandler, ErrorType } from './errorHandlingService';

/**
 * 批量處理配置
 */
export interface BatchProcessingConfig {
  /**
   * 最大並行任務數
   */
  maxConcurrentTasks: number;
  
  /**
   * 任務間隔時間 (ms)
   */
  taskInterval: number;
  
  /**
   * 批次間隔時間 (ms)
   */
  batchInterval: number;
  
  /**
   * 記憶體使用閾值 (MB)，超過此值將暫停處理
   */
  memoryThreshold: number;
  
  /**
   * 最大處理時間 (ms)，超過此時間將暫停處理
   */
  maxProcessingTime: number;
  
  /**
   * 自動暫停閾值 (ms)
   * 當瀏覽器響應時間超過此值時，自動暫停處理
   */
  autoPauseThreshold: number;
  
  /**
   * 暫停後恢復時間 (ms)
   */
  pauseRecoveryTime: number;
  
  /**
   * 性能監視間隔 (ms)
   */
  performanceMonitorInterval: number;
  
  /**
   * 自適應採樣配置
   */
  adaptiveSamplingConfig: Partial<AdaptiveSamplingConfig>;
  
  /**
   * 是否啟用 Web Workers
   */
  useWebWorkers: boolean;
  
  /**
   * 是否啟用 WebGPU 加速
   */
  useWebGPU: boolean;
}

/**
 * 默認批量處理配置
 */
export const DEFAULT_BATCH_PROCESSING_CONFIG: BatchProcessingConfig = {
  maxConcurrentTasks: 4,
  taskInterval: 50,
  batchInterval: 300,
  memoryThreshold: 500, // MB
  maxProcessingTime: 30000, // 30 秒
  autoPauseThreshold: 100, // 100ms
  pauseRecoveryTime: 1000, // 1 秒
  performanceMonitorInterval: 1000, // 1 秒
  adaptiveSamplingConfig: {},
  useWebWorkers: true,
  useWebGPU: true
};

/**
 * 性能測量結果
 */
export interface PerformanceMetrics {
  /**
   * 幀率 (FPS)
   */
  fps: number;
  
  /**
   * 記憶體使用情況 (MB)
   */
  memory: {
    used: number;
    total: number;
    limit: number;
  };
  
  /**
   * 響應延遲 (ms)
   */
  responseDelay: number;
  
  /**
   * 主線程阻塞時間 (ms)
   */
  mainThreadBlockTime: number;
}

/**
 * 處理任務狀態
 */
export enum TaskStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused'
}

/**
 * 處理任務
 */
export interface ProcessingTask<T = any> {
  /**
   * 任務 ID
   */
  id: string;
  
  /**
   * 任務狀態
   */
  status: TaskStatus;
  
  /**
   * 任務數據
   */
  data: T;
  
  /**
   * 任務優先級
   */
  priority: number;
  
  /**
   * 開始時間
   */
  startTime?: number;
  
  /**
   * 完成時間
   */
  completeTime?: number;
  
  /**
   * 處理時間 (ms)
   */
  processingTime?: number;
  
  /**
   * 重試次數
   */
  retryCount: number;
  
  /**
   * 最大重試次數
   */
  maxRetries: number;
  
  /**
   * 錯誤
   */
  error?: Error;
  
  /**
   * 處理結果
   */
  result?: any;
}

/**
 * 批量處理事件類型
 */
export enum BatchProcessingEventType {
  TASK_START = 'task_start',
  TASK_COMPLETE = 'task_complete',
  TASK_ERROR = 'task_error',
  BATCH_START = 'batch_start',
  BATCH_COMPLETE = 'batch_complete',
  ALL_COMPLETE = 'all_complete',
  PAUSED = 'paused',
  RESUMED = 'resumed',
  PERFORMANCE_ISSUE = 'performance_issue',
  MEMORY_ISSUE = 'memory_issue'
}

/**
 * 批量處理事件
 */
export interface BatchProcessingEvent<T = any> {
  /**
   * 事件類型
   */
  type: BatchProcessingEventType;
  
  /**
   * 事件數據
   */
  data?: any;
  
  /**
   * 相關任務
   */
  task?: ProcessingTask<T>;
  
  /**
   * 批次信息
   */
  batch?: {
    /**
     * 批次索引
     */
    index: number;
    
    /**
     * 批次大小
     */
    size: number;
    
    /**
     * 已完成批次數
     */
    completed: number;
    
    /**
     * 總批次數
     */
    total: number;
  };
  
  /**
   * 性能指標
   */
  performance?: PerformanceMetrics;
  
  /**
   * 時間戳
   */
  timestamp: number;
}

/**
 * 批量處理事件監聽器
 */
export type BatchProcessingEventListener<T = any> = (event: BatchProcessingEvent<T>) => void;

/**
 * 智能批量處理類
 */
export class IntelligentBatchProcessing<T extends PhotoFile> {
  private config: BatchProcessingConfig;
  private adaptiveSampling: AdaptiveSampling;
  private tasks: ProcessingTask<T>[] = [];
  private activeTasks: Set<string> = new Set();
  private completedTasks: Set<string> = new Set();
  private failedTasks: Set<string> = new Set();
  private processingBatches: T[][] = [];
  private currentBatchIndex: number = 0;
  private isProcessing: boolean = false;
  private isPaused: boolean = false;
  private processingStartTime: number = 0;
  private lastPerformanceCheck: number = 0;
  private performanceMetrics: PerformanceMetrics = {
    fps: 60,
    memory: { used: 0, total: 0, limit: 0 },
    responseDelay: 0,
    mainThreadBlockTime: 0
  };
  private performanceMonitorId: number | null = null;
  private eventListeners: Map<BatchProcessingEventType, BatchProcessingEventListener<T>[]> = new Map();
  private processingFunction: (item: T) => Promise<any>;
  private lastUserInteractionTime: number = 0;
  
  /**
   * 創建智能批量處理實例
   * @param config 處理配置
   * @param processingFunction 處理函數
   */
  constructor(
    config: Partial<BatchProcessingConfig> = {},
    processingFunction: (item: T) => Promise<any>
  ) {
    this.config = { ...DEFAULT_BATCH_PROCESSING_CONFIG, ...config };
    this.adaptiveSampling = new AdaptiveSampling(this.config.adaptiveSamplingConfig);
    this.processingFunction = processingFunction;
    
    // 監聽用戶交互
    this.setupInteractionListeners();
  }
  
  /**
   * 設置用戶交互監聽器
   * 用於偵測用戶何時與頁面交互，以避免在用戶操作時執行密集計算
   */
  private setupInteractionListeners(): void {
    const updateInteractionTime = () => {
      this.lastUserInteractionTime = Date.now();
    };
    
    // 監聽常見的交互事件
    window.addEventListener('mousedown', updateInteractionTime);
    window.addEventListener('keydown', updateInteractionTime);
    window.addEventListener('touchstart', updateInteractionTime);
    window.addEventListener('scroll', updateInteractionTime);
    
    // 初始化交互時間
    updateInteractionTime();
  }
  
  /**
   * 啟動性能監視
   */
  private startPerformanceMonitoring(): void {
    if (this.performanceMonitorId !== null) return;
    
    let lastFrameTime = performance.now();
    let frameCount = 0;
    let totalFrameTime = 0;
    
    const checkPerformance = () => {
      const now = performance.now();
      const timeSinceLastFrame = now - lastFrameTime;
      lastFrameTime = now;
      
      // 計算 FPS
      frameCount++;
      totalFrameTime += timeSinceLastFrame;
      
      if (totalFrameTime >= 1000) {
        this.performanceMetrics.fps = Math.round((frameCount * 1000) / totalFrameTime);
        frameCount = 0;
        totalFrameTime = 0;
      }
      
      // 獲取記憶體使用
      const memory = (performance as any).memory;
      if (memory) {
        this.performanceMetrics.memory = {
          used: memory.usedJSHeapSize / (1024 * 1024),
          total: memory.totalJSHeapSize / (1024 * 1024),
          limit: memory.jsHeapSizeLimit / (1024 * 1024)
        };
      }
      
      // 檢測主線程阻塞
      if (timeSinceLastFrame > this.config.autoPauseThreshold) {
        this.performanceMetrics.mainThreadBlockTime = timeSinceLastFrame;
        
        // 發送性能問題事件
        this.emitEvent({
          type: BatchProcessingEventType.PERFORMANCE_ISSUE,
          performance: { ...this.performanceMetrics },
          timestamp: now
        });
        
        // 如果阻塞嚴重，自動暫停處理
        if (timeSinceLastFrame > this.config.autoPauseThreshold * 2 && this.isProcessing) {
          this.pause('性能問題：主線程阻塞');
          
          // 延遲恢復
          setTimeout(() => {
            if (this.isPaused) {
              this.resume();
            }
          }, this.config.pauseRecoveryTime);
        }
      }
      
      // 檢測記憶體使用
      if (this.performanceMetrics.memory.used > this.config.memoryThreshold) {
        // 發送記憶體問題事件
        this.emitEvent({
          type: BatchProcessingEventType.MEMORY_ISSUE,
          performance: { ...this.performanceMetrics },
          timestamp: now
        });
        
        // 如果記憶體使用過高，暫停處理
        if (this.isProcessing) {
          this.pause('記憶體使用過高');
          
          // 觸發垃圾回收（如果瀏覽器支持）
          if (window.gc) {
            try {
              window.gc();
            } catch (e) {
              // 忽略錯誤
            }
          }
          
          // 延遲恢復
          setTimeout(() => {
            if (this.isPaused) {
              this.resume();
            }
          }, this.config.pauseRecoveryTime * 2);
        }
      }
      
      this.lastPerformanceCheck = now;
    };
    
    // 每幀檢查性能
    const performanceLoop = () => {
      checkPerformance();
      this.performanceMonitorId = requestAnimationFrame(performanceLoop);
    };
    
    this.performanceMonitorId = requestAnimationFrame(performanceLoop);
  }
  
  /**
   * 停止性能監視
   */
  private stopPerformanceMonitoring(): void {
    if (this.performanceMonitorId !== null) {
      cancelAnimationFrame(this.performanceMonitorId);
      this.performanceMonitorId = null;
    }
  }
  
  /**
   * 添加事件監聽器
   * @param type 事件類型
   * @param listener 監聽器函數
   */
  public addEventListener(type: BatchProcessingEventType, listener: BatchProcessingEventListener<T>): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, []);
    }
    
    this.eventListeners.get(type)!.push(listener);
  }
  
  /**
   * 移除事件監聽器
   * @param type 事件類型
   * @param listener 監聽器函數
   */
  public removeEventListener(type: BatchProcessingEventType, listener: BatchProcessingEventListener<T>): void {
    if (!this.eventListeners.has(type)) return;
    
    const listeners = this.eventListeners.get(type)!;
    const index = listeners.indexOf(listener);
    
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  }
  
  /**
   * 發送事件
   * @param event 事件
   */
  private emitEvent(event: BatchProcessingEvent<T>): void {
    const listeners = this.eventListeners.get(event.type) || [];
    
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('事件處理錯誤:', error);
      }
    }
  }
  
  /**
   * 設置要處理的項目
   * @param items 項目數組
   */
  public async setItems(items: T[]): Promise<void> {
    // 清除當前任務
    this.reset();
    
    // 使用自適應採樣對項目進行優先級排序
    await this.adaptiveSampling.prioritize(items);
    
    // 創建處理任務
    for (const item of items) {
      const complexity = this.adaptiveSampling.getImageComplexity(item.id);
      
      this.tasks.push({
        id: item.id,
        status: TaskStatus.PENDING,
        data: item,
        priority: complexity?.priority || 5,
        retryCount: 0,
        maxRetries: 3
      });
    }
    
    // 根據優先級排序任務
    this.tasks.sort((a, b) => b.priority - a.priority);
    
    // 創建處理批次
    this.createBatches();
  }
  
  /**
   * 創建處理批次
   */
  private createBatches(): void {
    this.processingBatches = [];
    this.currentBatchIndex = 0;
    
    // 按照自適應採樣創建批次
    let remainingItems = this.tasks.map(task => task.data);
    
    while (remainingItems.length > 0) {
      const batchSize = this.adaptiveSampling.getCurrentBatchSize();
      const batch = remainingItems.slice(0, batchSize);
      this.processingBatches.push(batch);
      remainingItems = remainingItems.slice(batchSize);
    }
  }
  
  /**
   * 開始批量處理
   */
  public start(): void {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    this.isPaused = false;
    this.processingStartTime = performance.now();
    
    // 開始性能監視
    this.startPerformanceMonitoring();
    
    // 開始處理第一批
    this.processBatch(this.currentBatchIndex);
  }
  
  /**
   * 處理指定批次
   * @param batchIndex 批次索引
   */
  private async processBatch(batchIndex: number): Promise<void> {
    if (batchIndex >= this.processingBatches.length || this.isPaused) return;
    
    const batch = this.processingBatches[batchIndex];
    
    // 發送批次開始事件
    this.emitEvent({
      type: BatchProcessingEventType.BATCH_START,
      batch: {
        index: batchIndex,
        size: batch.length,
        completed: batchIndex,
        total: this.processingBatches.length
      },
      timestamp: performance.now()
    });
    
    // 處理批次中的每個項目
    const processPromises: Promise<void>[] = [];
    
    for (const item of batch) {
      // 查找對應的任務
      const task = this.tasks.find(t => t.id === item.id);
      if (!task) continue;
      
      // 檢查是否已處理
      if (task.status !== TaskStatus.PENDING) continue;
      
      // 檢查是否達到並行限制
      if (this.activeTasks.size >= this.config.maxConcurrentTasks) {
        // 將剩餘項目添加到下一批
        if (batchIndex + 1 === this.processingBatches.length) {
          this.processingBatches.push([]);
        }
        this.processingBatches[batchIndex + 1] = [
          ...this.processingBatches[batchIndex + 1],
          ...batch.slice(batch.indexOf(item))
        ];
        break;
      }
      
      // 標記為處理中
      task.status = TaskStatus.PROCESSING;
      task.startTime = performance.now();
      this.activeTasks.add(task.id);
      
      // 發送任務開始事件
      this.emitEvent({
        type: BatchProcessingEventType.TASK_START,
        task: { ...task },
        timestamp: performance.now()
      });
      
      // 處理項目
      const processPromise = this.processItem(task)
        .catch(error => {
          // 處理錯誤
          console.error('項目處理錯誤:', error);
          task.status = TaskStatus.FAILED;
          task.error = error;
          this.failedTasks.add(task.id);
          
          // 發送任務錯誤事件
          this.emitEvent({
            type: BatchProcessingEventType.TASK_ERROR,
            task: { ...task },
            data: error,
            timestamp: performance.now()
          });
          
          // 嘗試重試
          if (task.retryCount < task.maxRetries) {
            task.retryCount++;
            task.status = TaskStatus.PENDING;
            
            // 將任務添加到未來批次
            const targetBatchIndex = Math.min(
              this.currentBatchIndex + 2,
              this.processingBatches.length
            );
            
            // 如果需要，創建新批次
            if (targetBatchIndex === this.processingBatches.length) {
              this.processingBatches.push([]);
            }
            
            this.processingBatches[targetBatchIndex].push(task.data);
          } else {
            // 記錄嚴重錯誤
            errorHandler.handleError(
              error instanceof Error ? error : new Error(String(error)),
              ErrorType.PHOTO_PROCESSING_ERROR,
              `處理照片 ${task.id} 失敗，已達到最大重試次數`,
              true
            );
          }
        })
        .finally(() => {
          // 移除活動任務
          this.activeTasks.delete(task.id);
        });
      
      processPromises.push(processPromise);
      
      // 添加間隔
      if (this.config.taskInterval > 0) {
        await new Promise(resolve => setTimeout(resolve, this.config.taskInterval));
      }
    }
    
    // 等待批次完成
    Promise.all(processPromises).then(() => {
      // 發送批次完成事件
      this.emitEvent({
        type: BatchProcessingEventType.BATCH_COMPLETE,
        batch: {
          index: batchIndex,
          size: batch.length,
          completed: batchIndex + 1,
          total: this.processingBatches.length
        },
        timestamp: performance.now()
      });
      
      // 處理下一批
      this.currentBatchIndex = batchIndex + 1;
      
      if (this.currentBatchIndex < this.processingBatches.length) {
        // 添加批次間隔
        setTimeout(() => {
          if (!this.isPaused && this.isProcessing) {
            this.processBatch(this.currentBatchIndex);
          }
        }, this.config.batchInterval);
      } else {
        // 所有批次處理完成
        this.completeProcessing();
      }
    });
  }
  
  /**
   * 處理單個項目
   * @param task 處理任務
   */
  private async processItem(task: ProcessingTask<T>): Promise<void> {
    try {
      // 使用提供的處理函數處理項目
      const result = await this.processingFunction(task.data);
      
      // 記錄處理結果
      task.status = TaskStatus.COMPLETED;
      task.completeTime = performance.now();
      task.processingTime = task.completeTime - (task.startTime || 0);
      task.result = result;
      
      this.completedTasks.add(task.id);
      
      // 發送任務完成事件
      this.emitEvent({
        type: BatchProcessingEventType.TASK_COMPLETE,
        task: { ...task },
        data: result,
        timestamp: performance.now()
      });
      
      // 更新自適應採樣統計
      this.adaptiveSampling.reportProcessingComplete(
        [task.id],
        task.processingTime || 0
      );
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * 完成所有處理
   */
  private completeProcessing(): void {
    this.isProcessing = false;
    
    // 計算總處理時間
    const totalTime = performance.now() - this.processingStartTime;
    
    // 發送所有完成事件
    this.emitEvent({
      type: BatchProcessingEventType.ALL_COMPLETE,
      data: {
        totalTime,
        processedCount: this.completedTasks.size,
        failedCount: this.failedTasks.size,
        totalCount: this.tasks.length
      },
      timestamp: performance.now()
    });
    
    // 停止性能監視
    this.stopPerformanceMonitoring();
  }
  
  /**
   * 暫停處理
   * @param reason 暫停原因
   */
  public pause(reason: string = '用戶暫停'): void {
    if (!this.isProcessing || this.isPaused) return;
    
    this.isPaused = true;
    
    // 發送暫停事件
    this.emitEvent({
      type: BatchProcessingEventType.PAUSED,
      data: { reason },
      timestamp: performance.now()
    });
  }
  
  /**
   * 恢復處理
   */
  public resume(): void {
    if (!this.isPaused) return;
    
    this.isPaused = false;
    
    // 發送恢復事件
    this.emitEvent({
      type: BatchProcessingEventType.RESUMED,
      timestamp: performance.now()
    });
    
    // 恢復處理
    if (this.isProcessing) {
      this.processBatch(this.currentBatchIndex);
    }
  }
  
  /**
   * 停止處理
   */
  public stop(): void {
    this.isProcessing = false;
    this.isPaused = false;
    
    // 停止性能監視
    this.stopPerformanceMonitoring();
  }
  
  /**
   * 重置處理
   */
  public reset(): void {
    this.stop();
    this.tasks = [];
    this.activeTasks.clear();
    this.completedTasks.clear();
    this.failedTasks.clear();
    this.processingBatches = [];
    this.currentBatchIndex = 0;
    this.adaptiveSampling.reset();
  }
  
  /**
   * 獲取處理統計
   */
  public getStats(): {
    total: number;
    completed: number;
    failed: number;
    active: number;
    pending: number;
    batchesTotal: number;
    batchesCompleted: number;
    performance: PerformanceMetrics;
  } {
    const pending = this.tasks.filter(
      t => t.status === TaskStatus.PENDING
    ).length;
    
    return {
      total: this.tasks.length,
      completed: this.completedTasks.size,
      failed: this.failedTasks.size,
      active: this.activeTasks.size,
      pending,
      batchesTotal: this.processingBatches.length,
      batchesCompleted: this.currentBatchIndex,
      performance: { ...this.performanceMetrics }
    };
  }
  
  /**
   * 獲取任務
   * @param id 任務 ID
   */
  public getTask(id: string): ProcessingTask<T> | undefined {
    return this.tasks.find(t => t.id === id);
  }
  
  /**
   * 獲取所有任務
   */
  public getAllTasks(): ProcessingTask<T>[] {
    return [...this.tasks];
  }
  
  /**
   * 更改配置
   * @param config 新配置
   */
  public updateConfig(config: Partial<BatchProcessingConfig>): void {
    this.config = { ...this.config, ...config };
    
    // 更新自適應採樣配置
    if (config.adaptiveSamplingConfig) {
      this.adaptiveSampling.setConfig(config.adaptiveSamplingConfig);
    }
  }
  
  /**
   * 獲取當前配置
   */
  public getConfig(): BatchProcessingConfig {
    return { ...this.config };
  }
}

/**
 * 創建智能批量處理器
 * @param config 配置
 * @param processingFunction 處理函數
 * @returns 智能批量處理器
 */
export function createIntelligentBatchProcessing<T extends PhotoFile>(
  config: Partial<BatchProcessingConfig> = {},
  processingFunction: (item: T) => Promise<any>
): IntelligentBatchProcessing<T> {
  return new IntelligentBatchProcessing<T>(config, processingFunction);
} 