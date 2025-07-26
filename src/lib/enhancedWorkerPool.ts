/**
 * 增強版 Worker 池管理器
 * 提供高效的 Web Worker 管理和任務調度
 * 支持自適應擴展和收縮，優化資源使用
 */

import { errorHandler, ErrorType } from "./errorHandlingService";

/**
 * Worker 池配置接口
 */
export interface WorkerPoolConfig {
  /**
   * 腳本 URL
   */
  scriptUrl: string;

  /**
   * 最小 Worker 數量
   */
  minWorkers?: number;

  /**
   * 最大 Worker 數量
   */
  maxWorkers?: number;

  /**
   * Worker 閒置超時（毫秒）
   * 超過此時間的閒置 Worker 將被釋放（不低於最小數量）
   */
  idleTimeout?: number;

  /**
   * 是否啟用 SharedArrayBuffer
   * 用於 Worker 間高效數據傳輸
   */
  useSharedArrayBuffer?: boolean;

  /**
   * 啟動時初始化 Worker 數量
   */
  startupWorkers?: number;

  /**
   * Worker 負載閾值
   * 當系統負載達到此閾值時，觸發擴展
   * 範圍: 0.0-1.0
   */
  loadThreshold?: number;

  /**
   * 任務等待時間閾值（毫秒）
   * 任務等待時間超過此閾值時，觸發擴展
   */
  waitTimeThreshold?: number;
}

/**
 * Worker 任務接口
 */
export interface WorkerTask {
  /**
   * 任務ID
   */
  id: string;
  
  /**
   * 任務數據
   */
  data: any;
  
  /**
   * 任務優先級
   * 較高的值代表較高的優先級
   */
  priority?: number;
  
  /**
   * 任務創建時間
   */
  createdAt: number;

  /**
   * 任務開始執行時間
   */
  startedAt?: number;

  /**
   * 使用 SharedArrayBuffer 的傳輸數據
   */
  transferData?: {
    buffer: SharedArrayBuffer;
    byteOffset: number;
    length: number;
  }[];

  /**
   * 任務超時時間（毫秒）
   * 超過此時間未完成的任務將被取消
   */
  timeout?: number;
}

/**
 * Worker 任務結果接口
 */
export interface WorkerTaskResult {
  /**
   * 任務ID
   */
  id: string;
  
  /**
   * 結果數據
   */
  result: any;
  
  /**
   * 錯誤信息（如果有）
   */
  error?: string;
  
  /**
   * 執行時間（毫秒）
   */
  executionTime: number;
}

/**
 * Worker 狀態
 */
enum WorkerState {
  IDLE = 'idle',
  BUSY = 'busy',
  TERMINATING = 'terminating'
}

/**
 * Worker 包裝類
 */
class WorkerWrapper {
  /**
   * Worker 實例
   */
  worker: Worker;
  
  /**
   * Worker 狀態
   */
  state: WorkerState = WorkerState.IDLE;
  
  /**
   * 當前任務ID
   */
  currentTaskId: string | null = null;
  
  /**
   * 當前任務開始時間
   */
  taskStartTime: number = 0;
  
  /**
   * 最後活動時間
   */
  lastActiveTime: number = Date.now();
  
  /**
   * 任務完成回調
   */
  onTaskComplete: ((result: WorkerTaskResult) => void) | null = null;
  
  /**
   * 已處理任務數量
   */
  completedTaskCount: number = 0;
  
  /**
   * 總處理時間（毫秒）
   */
  totalProcessingTime: number = 0;

  /**
   * 建立 Worker 包裝
   * @param worker Worker 實例
   */
  constructor(worker: Worker) {
    this.worker = worker;
    this.setupMessageHandler();
  }

  /**
   * 設置 Worker 消息處理器
   */
  private setupMessageHandler(): void {
    this.worker.onmessage = (event) => {
      if (this.state === WorkerState.BUSY && this.onTaskComplete) {
        const result: WorkerTaskResult = event.data;
        
        // 計算執行時間並更新統計信息
        const executionTime = Date.now() - this.taskStartTime;
        this.totalProcessingTime += executionTime;
        this.completedTaskCount++;
        
        // 標記 Worker 為空閒狀態
        this.state = WorkerState.IDLE;
        this.lastActiveTime = Date.now();
        this.currentTaskId = null;
        
        // 執行回調
        this.onTaskComplete(result);
        this.onTaskComplete = null;
      }
    };

    this.worker.onerror = (error) => {
      if (this.state === WorkerState.BUSY && this.onTaskComplete) {
        const errorResult: WorkerTaskResult = {
          id: this.currentTaskId || 'unknown',
          result: null,
          error: `Worker 錯誤: ${error.message}`,
          executionTime: Date.now() - this.taskStartTime
        };
        
        // 標記 Worker 為空閒狀態
        this.state = WorkerState.IDLE;
        this.lastActiveTime = Date.now();
        this.currentTaskId = null;
        
        // 執行回調
        this.onTaskComplete(errorResult);
        this.onTaskComplete = null;
      }
    };
  }

  /**
   * 執行任務
   * @param task 要執行的任務
   * @param callback 完成回調
   */
  executeTask(task: WorkerTask, callback: (result: WorkerTaskResult) => void): void {
    if (this.state !== WorkerState.IDLE) {
      throw new Error('Worker 正忙，無法執行任務');
    }
    
    this.state = WorkerState.BUSY;
    this.currentTaskId = task.id;
    this.taskStartTime = Date.now();
    this.onTaskComplete = callback;
    task.startedAt = this.taskStartTime;
    
    // 發送任務到 Worker
    if (task.transferData) {
      this.worker.postMessage(task);
    } else {
      this.worker.postMessage(task);
    }
  }

  /**
   * 終止 Worker
   */
  terminate(): void {
    this.state = WorkerState.TERMINATING;
    this.worker.terminate();
  }

  /**
   * 獲取平均處理時間（毫秒）
   */
  getAverageProcessingTime(): number {
    if (this.completedTaskCount === 0) return 0;
    return this.totalProcessingTime / this.completedTaskCount;
  }

  /**
   * 獲取空閒時間（毫秒）
   */
  getIdleTime(): number {
    if (this.state !== WorkerState.IDLE) return 0;
    return Date.now() - this.lastActiveTime;
  }

  /**
   * 判斷是否長時間空閒
   * @param timeout 閒置超時（毫秒）
   */
  isLongIdle(timeout: number): boolean {
    return this.state === WorkerState.IDLE && this.getIdleTime() > timeout;
  }
}

/**
 * 增強型 Worker 池
 * 提供自適應擴展和收縮的 Worker 管理，優化資源使用
 */
export class EnhancedWorkerPool {
  /**
   * Worker 池配置
   */
  private config: Required<WorkerPoolConfig>;
  
  /**
   * Worker 包裝列表
   */
  private workers: WorkerWrapper[] = [];
  
  /**
   * 待處理任務隊列
   */
  private taskQueue: WorkerTask[] = [];
  
  /**
   * 正在執行的任務 ID 集合
   */
  private activeTasks: Set<string> = new Set();
  
  /**
   * 系統健康狀況檢查定時器
   */
  private healthCheckInterval: number | null = null;
  
  /**
   * 全局任務計數器
   */
  private taskCounter: number = 0;
  
  /**
   * 任務結果映射表
   */
  private taskResults: Map<string, WorkerTaskResult> = new Map();
  
  /**
   * 任務回調映射表
   */
  private taskCallbacks: Map<string, (result: WorkerTaskResult) => void> = new Map();

  /**
   * 任務等待時間統計（毫秒）
   */
  private waitTimeStats: number[] = [];

  /**
   * 系統負載歷史
   * 記錄最近一段時間的系統負載情況，用於動態調整 Worker 數量
   */
  private loadHistory: { timestamp: number, load: number }[] = [];

  /**
   * 最後擴展時間
   */
  private lastScaleUpTime: number = 0;

  /**
   * 最後收縮時間
   */
  private lastScaleDownTime: number = 0;

  /**
   * 冷卻時間（毫秒）
   * 在進行擴展或收縮操作後，需要等待一段時間才能進行下一次操作
   */
  private readonly scaleCooldown: number = 10000; // 10秒

  /**
   * 建立增強型 Worker 池
   * @param config Worker 池配置
   */
  constructor(config: WorkerPoolConfig) {
    // 設置默認配置
    this.config = {
      scriptUrl: config.scriptUrl,
      minWorkers: config.minWorkers || 2,
      maxWorkers: config.maxWorkers || (navigator.hardwareConcurrency || 4),
      idleTimeout: config.idleTimeout || 60000, // 1分鐘
      useSharedArrayBuffer: config.useSharedArrayBuffer || false,
      startupWorkers: config.startupWorkers || 2,
      loadThreshold: config.loadThreshold || 0.75, // 75%
      waitTimeThreshold: config.waitTimeThreshold || 1000 // 1秒
    };
    
    // 初始化 Worker 池
    this.initialize();
  }

  /**
   * 初始化 Worker 池
   */
  private initialize(): void {
    // 創建初始 Worker
    const initialWorkerCount = Math.min(
      this.config.startupWorkers,
      this.config.maxWorkers
    );
    
    for (let i = 0; i < initialWorkerCount; i++) {
      this.createWorker();
    }
    
    // 啟動健康檢查
    this.startHealthCheck();

    console.info(`Worker 池已初始化，初始大小: ${initialWorkerCount}`);
  }

  /**
   * 建立新的 Worker
   * @returns 新創建的 Worker 包裝
   */
  private createWorker(): WorkerWrapper {
    try {
      const worker = new Worker(this.config.scriptUrl);
      const workerWrapper = new WorkerWrapper(worker);
      this.workers.push(workerWrapper);
      
      // 初始化 Worker
      if (this.config.useSharedArrayBuffer) {
        worker.postMessage({
          type: 'init',
          useSharedArrayBuffer: true
        });
      }
      
      return workerWrapper;
    } catch (error) {
      errorHandler.handleError(
        error instanceof Error ? error : String(error),
        ErrorType.SYSTEM_ERROR,
        '創建 Worker 失敗',
        true
      );
      throw error;
    }
  }

  /**
   * 獲取空閒的 Worker
   * @returns 空閒的 Worker 包裝，如果沒有則返回 null
   */
  private getIdleWorker(): WorkerWrapper | null {
    return this.workers.find(w => w.state === WorkerState.IDLE) || null;
  }

  /**
   * 提交任務
   * @param data 任務數據
   * @param priority 任務優先級
   * @param timeout 任務超時時間（毫秒）
   * @param transferData 使用 SharedArrayBuffer 的傳輸數據
   * @returns 任務ID
   */
  public submitTask(
    data: any,
    priority: number = 0,
    timeout: number = 30000,
    transferData?: { buffer: SharedArrayBuffer; byteOffset: number; length: number }[]
  ): string {
    // 生成唯一任務ID
    const taskId = `task_${++this.taskCounter}_${Date.now()}`;
    
    // 建立任務對象
    const task: WorkerTask = {
      id: taskId,
      data,
      priority,
      createdAt: Date.now(),
      timeout,
      transferData
    };
    
    // 添加到任務隊列
    this.addTaskToQueue(task);
    
    // 嘗試處理隊列
    this.processQueue();
    
    return taskId;
  }

  /**
   * 添加任務到隊列
   * @param task 任務對象
   */
  private addTaskToQueue(task: WorkerTask): void {
    // 將任務按優先級插入到隊列中
    const priority = task.priority || 0;
    
    let insertIndex = this.taskQueue.length;
    for (let i = 0; i < this.taskQueue.length; i++) {
      const queuedTaskPriority = this.taskQueue[i].priority || 0;
      if (priority > queuedTaskPriority) {
        insertIndex = i;
        break;
      }
    }
    
    // 插入任務
    this.taskQueue.splice(insertIndex, 0, task);
  }

  /**
   * 處理任務隊列
   */
  private processQueue(): void {
    // 當隊列為空時，無需處理
    if (this.taskQueue.length === 0) {
      return;
    }
    
    // 獲取空閒 Worker
    const idleWorker = this.getIdleWorker();
    
    // 如果沒有空閒 Worker，檢查是否可以擴展
    if (!idleWorker) {
      this.checkAndScaleUp();
      return;
    }
    
    // 獲取隊列中的下一個任務
    const task = this.taskQueue.shift();
    if (!task) return;
    
    // 記錄任務等待時間
    const waitTime = Date.now() - task.createdAt;
    this.waitTimeStats.push(waitTime);
    
    // 限制統計數據大小
    if (this.waitTimeStats.length > 100) {
      this.waitTimeStats.shift();
    }
    
    // 添加到活動任務集合
    this.activeTasks.add(task.id);
    
    // 執行任務
    idleWorker.executeTask(task, (result) => {
      // 保存結果
      this.taskResults.set(task.id, result);
      
      // 從活動任務集合中移除
      this.activeTasks.delete(task.id);
      
      // 執行回調
      const callback = this.taskCallbacks.get(task.id);
      if (callback) {
        callback(result);
        this.taskCallbacks.delete(task.id);
      }
      
      // 繼續處理隊列
      this.processQueue();
    });
  }

  /**
   * 檢查並擴展 Worker 池
   */
  private checkAndScaleUp(): void {
    const now = Date.now();
    
    // 檢查冷卻時間
    if (now - this.lastScaleUpTime < this.scaleCooldown) {
      return;
    }
    
    // 檢查是否已達到最大 Worker 數量
    if (this.workers.length >= this.config.maxWorkers) {
      return;
    }
    
    // 檢查系統負載
    const currentLoad = this.calculateSystemLoad();
    
    // 更新負載歷史
    this.loadHistory.push({ timestamp: now, load: currentLoad });
    
    // 僅保留最近 10 筆記錄
    if (this.loadHistory.length > 10) {
      this.loadHistory.shift();
    }
    
    // 計算平均等待時間
    const avgWaitTime = this.calculateAverageWaitTime();
    
    // 當負載超過閾值或等待時間過長時，擴展 Worker 池
    if (
      currentLoad > this.config.loadThreshold ||
      (avgWaitTime > this.config.waitTimeThreshold && this.taskQueue.length > 0)
    ) {
      // 計算需要添加的 Worker 數量
      const addCount = Math.min(
        Math.ceil(this.taskQueue.length / 3), // 每 3 個等待任務添加 1 個 Worker
        this.config.maxWorkers - this.workers.length
      );
      
      // 添加新 Worker
      for (let i = 0; i < addCount; i++) {
        this.createWorker();
      }
      
      console.info(
        `擴展 Worker 池: +${addCount}, 總數: ${this.workers.length}, ` +
        `系統負載: ${(currentLoad * 100).toFixed(2)}%, ` +
        `平均等待時間: ${avgWaitTime.toFixed(2)}ms, ` +
        `等待任務: ${this.taskQueue.length}`
      );
      
      // 更新最後擴展時間
      this.lastScaleUpTime = now;
      
      // 擴展後，繼續處理隊列
      this.processQueue();
    }
  }

  /**
   * 檢查並收縮 Worker 池
   */
  private checkAndScaleDown(): void {
    const now = Date.now();
    
    // 檢查冷卻時間
    if (now - this.lastScaleDownTime < this.scaleCooldown) {
      return;
    }
    
    // 如果已經達到最小數量，不再收縮
    if (this.workers.length <= this.config.minWorkers) {
      return;
    }
    
    // 計算當前系統負載
    const currentLoad = this.calculateSystemLoad();
    
    // 當系統負載較低且無等待任務時，考慮收縮
    if (currentLoad < this.config.loadThreshold / 2 && this.taskQueue.length === 0) {
      // 查找長時間空閒的 Worker
      const idleWorkers = this.workers.filter(w => 
        w.state === WorkerState.IDLE && 
        w.getIdleTime() > this.config.idleTimeout
      );
      
      // 計算可以移除的 Worker 數量
      const removeCount = Math.min(
        idleWorkers.length,
        this.workers.length - this.config.minWorkers
      );
      
      if (removeCount > 0) {
        // 移除長時間空閒的 Worker
        for (let i = 0; i < removeCount; i++) {
          const worker = idleWorkers[i];
          const index = this.workers.indexOf(worker);
          
          if (index !== -1) {
            // 終止 Worker
            worker.terminate();
            
            // 從列表中移除
            this.workers.splice(index, 1);
          }
        }
        
        console.info(
          `收縮 Worker 池: -${removeCount}, 總數: ${this.workers.length}, ` +
          `系統負載: ${(currentLoad * 100).toFixed(2)}%`
        );
        
        // 更新最後收縮時間
        this.lastScaleDownTime = now;
      }
    }
  }

  /**
   * 計算系統負載
   * @returns 系統負載比例 (0.0-1.0)
   */
  private calculateSystemLoad(): number {
    const busyWorkers = this.workers.filter(w => w.state === WorkerState.BUSY).length;
    return this.workers.length > 0 ? busyWorkers / this.workers.length : 0;
  }

  /**
   * 計算平均等待時間
   * @returns 平均等待時間（毫秒）
   */
  private calculateAverageWaitTime(): number {
    if (this.waitTimeStats.length === 0) return 0;
    
    const sum = this.waitTimeStats.reduce((acc, val) => acc + val, 0);
    return sum / this.waitTimeStats.length;
  }

  /**
   * 獲取任務結果
   * @param taskId 任務ID
   * @returns 任務結果或 null
   */
  public getTaskResult(taskId: string): WorkerTaskResult | null {
    return this.taskResults.get(taskId) || null;
  }

  /**
   * 等待任務完成
   * @param taskId 任務ID
   * @returns Promise，解析為任務結果
   */
  public waitForTask(taskId: string): Promise<WorkerTaskResult> {
    // 檢查任務是否已完成
    const result = this.taskResults.get(taskId);
    if (result) {
      return Promise.resolve(result);
    }
    
    // 檢查任務是否已提交
    const isActive = this.activeTasks.has(taskId);
    const isPending = this.taskQueue.some(task => task.id === taskId);
    
    if (!isActive && !isPending) {
      return Promise.reject(new Error(`任務 ${taskId} 不存在`));
    }
    
    // 等待任務完成
    return new Promise((resolve, reject) => {
      this.taskCallbacks.set(taskId, (result) => {
        if (result.error) {
          reject(new Error(result.error));
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * 取消任務
   * @param taskId 任務ID
   * @returns 是否取消成功
   */
  public cancelTask(taskId: string): boolean {
    // 檢查任務是否在隊列中
    const queueIndex = this.taskQueue.findIndex(task => task.id === taskId);
    
    if (queueIndex !== -1) {
      // 從隊列中移除
      this.taskQueue.splice(queueIndex, 1);
      return true;
    }
    
    // 無法取消已開始的任務
    return false;
  }

  /**
   * 啟動健康檢查
   */
  private startHealthCheck(): void {
    if (this.healthCheckInterval !== null) {
      return;
    }
    
    this.healthCheckInterval = window.setInterval(() => {
      // 檢查並收縮 Worker 池
      this.checkAndScaleDown();
      
      // 清理過期的任務結果
      this.cleanupTaskResults();
      
      // 檢查任務超時
      this.checkTaskTimeouts();
    }, 10000) as unknown as number; // 10秒檢查一次
  }

  /**
   * 清理過期的任務結果
   * 移除超過 5 分鐘的任務結果
   */
  private cleanupTaskResults(): void {
    const now = Date.now();
    const expiryTime = 5 * 60 * 1000; // 5 分鐘
    
    for (const [taskId, result] of this.taskResults.entries()) {
      if (now - result.executionTime > expiryTime) {
        this.taskResults.delete(taskId);
      }
    }
  }

  /**
   * 檢查任務超時
   */
  private checkTaskTimeouts(): void {
    const now = Date.now();
    
    // 檢查隊列中的任務
    for (let i = this.taskQueue.length - 1; i >= 0; i--) {
      const task = this.taskQueue[i];
      
      if (task.timeout && (now - task.createdAt > task.timeout)) {
        // 移除超時任務
        this.taskQueue.splice(i, 1);
        
        // 設置超時結果
        const timeoutResult: WorkerTaskResult = {
          id: task.id,
          result: null,
          error: '任務在執行前超時',
          executionTime: 0
        };
        
        this.taskResults.set(task.id, timeoutResult);
        
        // 執行回調
        const callback = this.taskCallbacks.get(task.id);
        if (callback) {
          callback(timeoutResult);
          this.taskCallbacks.delete(task.id);
        }
      }
    }
    
    // 檢查正在執行的任務
    for (const worker of this.workers) {
      if (worker.state === WorkerState.BUSY && worker.currentTaskId) {
        const taskId = worker.currentTaskId;
        const elapsedTime = now - worker.taskStartTime;
        
        // 查找對應的任務配置
        const task = Array.from(this.activeTasks).includes(taskId) 
          ? this.taskQueue.find(t => t.id === taskId) 
          : undefined;
        
        if (task?.timeout && elapsedTime > task.timeout) {
          // 終止 Worker 並重新創建
          worker.terminate();
          
          // 從 Worker 列表中移除
          const index = this.workers.indexOf(worker);
          if (index !== -1) {
            this.workers.splice(index, 1);
          }
          
          // 創建新的 Worker 替代
          this.createWorker();
          
          // 從活動任務集合中移除
          this.activeTasks.delete(taskId);
          
          // 設置超時結果
          const timeoutResult: WorkerTaskResult = {
            id: taskId,
            result: null,
            error: '任務執行超時',
            executionTime: elapsedTime
          };
          
          this.taskResults.set(taskId, timeoutResult);
          
          // 執行回調
          const callback = this.taskCallbacks.get(taskId);
          if (callback) {
            callback(timeoutResult);
            this.taskCallbacks.delete(taskId);
          }
        }
      }
    }
  }

  /**
   * 獲取 Worker 池統計信息
   */
  public getStatistics() {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter(w => w.state === WorkerState.BUSY).length,
      idleWorkers: this.workers.filter(w => w.state === WorkerState.IDLE).length,
      pendingTasks: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      averageWaitTime: this.calculateAverageWaitTime(),
      systemLoad: this.calculateSystemLoad()
    };
  }

  /**
   * 關閉 Worker 池
   */
  public shutdown(): void {
    // 停止健康檢查
    if (this.healthCheckInterval !== null) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    // 終止所有 Worker
    for (const worker of this.workers) {
      worker.terminate();
    }
    
    // 清空 Worker 列表
    this.workers = [];
    
    // 清空任務隊列
    this.taskQueue = [];
    this.activeTasks.clear();
    this.taskCallbacks.clear();
    
    console.info('Worker 池已關閉');
  }
} 