import { toast } from "sonner";
import { Result, ok, err } from './result';

// 定義瀏覽器特定 API 的接口
interface MemoryInfo {
  totalJSHeapSize: number;
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceMemory extends Performance {
  memory?: MemoryInfo;
}

// 類型守衛
function hasMemoryInfo(perf: Performance): perf is PerformanceMemory {
  return 'memory' in perf && 
         perf.memory !== undefined && 
         typeof perf.memory.usedJSHeapSize === 'number';
}

/**
 * 錯誤處理服務
 * 集中處理應用程序錯誤，支持日誌記錄和遙測上報
 */

/**
 * 錯誤類型枚舉
 */
export enum ErrorType {
  // 系統錯誤
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  
  // 網絡錯誤
  NETWORK_ERROR = 'NETWORK_ERROR',
  
  // 照片處理錯誤
  PHOTO_PROCESSING_ERROR = 'PHOTO_PROCESSING_ERROR',
  
  // 照片提取特徵錯誤
  PHOTO_EXTRACTION_ERROR = 'PHOTO_EXTRACTION_ERROR',
  
  // 文件系統錯誤
  FILE_SYSTEM_ERROR = 'FILE_SYSTEM_ERROR',
  
  // 用戶輸入錯誤
  INPUT_ERROR = 'INPUT_ERROR',
  
  // 未知錯誤
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  
  // 數據庫錯誤 
  DATABASE_ERROR = 'DATABASE_ERROR',
  
  // 照片格式錯誤
  PHOTO_FORMAT_ERROR = 'PHOTO_FORMAT_ERROR',
  
  // 照片載入錯誤
  PHOTO_LOADING_ERROR = 'PHOTO_LOADING_ERROR',
  
  // 記憶體限制錯誤
  MEMORY_LIMIT_ERROR = 'MEMORY_LIMIT_ERROR',
  
  // 檔案類型錯誤
  FILE_TYPE_ERROR = 'FILE_TYPE_ERROR'
}

/**
 * 錯誤嚴重程度枚舉
 */
export enum ErrorSeverity {
  // 低嚴重度 - 警告，不會影響核心功能
  LOW = 'LOW',
  
  // 中等嚴重度 - 錯誤，可能影響部分功能
  MEDIUM = 'MEDIUM',
  
  // 高嚴重度 - 嚴重錯誤，會影響核心功能
  HIGH = 'HIGH',
  
  // 致命錯誤 - 導致應用崩潰或無法使用
  FATAL = 'FATAL',
  
  // 非常嚴重
  CRITICAL = 'CRITICAL'
}

/**
 * 應用錯誤接口
 */
export interface AppError extends Error {
  // 錯誤類型
  type: ErrorType;
  
  // 詳細信息
  details?: string | undefined;
  
  // 時間戳
  timestamp: Date;
  
  // 是否可恢復
  recoverable: boolean;
  
  // 恢復操作
  recoveryAction?: (() => void) | undefined;
  
  // 嚴重程度
  severity: ErrorSeverity;
  
  // 技術細節
  technicalDetails?: any;
  
  // 用戶友好的恢復指導
  recoveryGuidance?: string;
}

// 錯誤國際化接口
export interface ErrorMessages {
  title: string;
  details?: string | undefined;
  recoveryGuidance?: string | undefined;
}

// 重試配置接口
interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  backoffFactor: number;
  retryableErrorTypes: ErrorType[]; // 指定哪些錯誤類型可重試
}

// 報告配置接口
interface ReportConfig {
  reportErrors: boolean;
  includeStack: boolean;
  includeUserInfo: boolean;
}

/**
 * 錯誤處理服務類
 */
class ErrorHandlingService {
  /**
   * 重試次數映射
   */
  private retryMap: Map<string, number> = new Map();
  
  /**
   * 遙測隊列
   */
  private telemetryQueue: Array<{
    error: Error | string;
    type: ErrorType;
    details?: string | undefined;
    timestamp: Date;
    severity: ErrorSeverity;
  }> = [];
  
  /**
   * 錯誤歷史記錄
   */
  private errorHistory: Array<AppError> = [];
  
  /**
   * 重試計時器映射
   */
  private retryTimers: Map<string, number> = new Map();
  
  /**
   * 當前語言
   */
  private locale: string = 'zh-TW';
  
  /**
   * 重試配置
   */
  private retryConfig: RetryConfig = {
    maxRetries: 3,
    initialDelay: 1000,
    backoffFactor: 2,
    retryableErrorTypes: [
      ErrorType.NETWORK_ERROR,
      ErrorType.PHOTO_PROCESSING_ERROR,
      ErrorType.PHOTO_EXTRACTION_ERROR
    ] // 指定默認可重試的錯誤類型
  };
  
  /**
   * 報告配置
   */
  private reportConfig: ReportConfig = {
    reportErrors: true,
    includeStack: true,
    includeUserInfo: false
  };
  
  /**
   * 創建自定義應用錯誤
   * 
   * @param error 原始錯誤或錯誤信息
   * @param type 錯誤類型
   * @param details 詳細信息
   * @param recoverable 是否可恢復
   * @param recoveryAction 恢復操作
   * @param severity 嚴重程度
   * @returns 應用錯誤
   */
  public createAppError(
    error: Error | string,
    type: ErrorType = ErrorType.UNKNOWN_ERROR,
    details?: string,
    recoverable: boolean = false,
    recoveryAction?: () => void,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    recoveryGuidance?: string // 用戶友好的恢復指導
  ): AppError {
    // 創建錯誤對象
    const appError: AppError = error instanceof Error
      ? error as AppError
      : new Error(error) as AppError;
    
    // 添加自定義屬性
    appError.type = type;
    appError.details = details;
    appError.timestamp = new Date();
    appError.recoverable = recoverable;
    appError.recoveryAction = recoveryAction;
    appError.severity = severity;
    
    // 添加默認恢復指導
    appError.recoveryGuidance = recoveryGuidance || this.getRecoveryRecommendation(type);
    
    return appError;
  }
  
  /**
   * 處理錯誤並返回Result
   * 
   * @param error 錯誤對象或錯誤信息
   * @param type 錯誤類型
   * @param details 詳細信息
   * @param recoverable 是否可恢復
   * @param recoveryAction 恢復操作
   * @param severity 嚴重程度
   * @returns Result包裹的錯誤結果
   */
  public handleErrorWithResult<T = void>(
    error: unknown,
    type: ErrorType = ErrorType.UNKNOWN_ERROR,
    details?: string,
    recoverable: boolean = false,
    recoveryAction?: () => void,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM
  ): Result<T, AppError> {
    const errorId = this.handleError(
      error, type, details, recoverable, recoveryAction, severity
    );
    
    // 獲取創建的AppError對象
    const appError = this.getErrorById(errorId);
    if (!appError) {
      // 如果找不到錯誤對象，創建一個新的
      const fallbackError = this.createAppError(
        error instanceof Error ? error : String(error),
        type,
        details,
        recoverable,
        recoveryAction,
        severity
      );
      return err(fallbackError);
    }
    
    return err(appError);
  }
  
  /**
   * 處理錯誤
   * 
   * @param error 錯誤對象或錯誤信息
   * @param type 錯誤類型
   * @param details 詳細信息
   * @param recoverable 是否可恢復
   * @param recoveryAction 恢復操作
   * @param severity 嚴重程度
   * @returns 錯誤ID，用於引用
   */
  public handleError(
    error: unknown,
    type: ErrorType = ErrorType.UNKNOWN_ERROR,
    details?: string,
    recoverable: boolean = false,
    recoveryAction?: () => void,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    autoRetry: boolean = false // 是否自動嘗試重試
  ): string {
    // 將 unknown 轉換為 Error 或 string
    let errorObj: Error | string;
    if (error instanceof Error) {
      errorObj = error;
    } else if (typeof error === 'string') {
      errorObj = error;
    } else {
      errorObj = new Error(String(error));
    }
    
    // 創建應用錯誤
    const appError = this.createAppError(
      errorObj,
      type,
      details,
      recoverable,
      recoveryAction,
      severity
    );
    
    // 生成錯誤ID
    const errorId = this.generateErrorId();
    
    // 記錄錯誤
    this.logError(errorId, appError);
    
    // 將錯誤添加到遙測隊列
    this.queueTelemetry(errorId, appError);
    
    // 添加到錯誤歷史記錄
    this.errorHistory.push(appError);
    
    // 如果錯誤嚴重，觸發全局錯誤處理
    if (severity === ErrorSeverity.FATAL) {
      this.handleFatalError(errorId, appError);
    }
    
    // 顯示錯誤通知
    this.showErrorNotification(appError);
    
    // 檢查是否自動重試和錯誤是否可重試
    if (autoRetry && recoverable && this.isErrorRetryable(type)) {
      if (recoveryAction) {
        this.scheduleRetry(errorId, recoveryAction);
      }
    }
    // 如果錯誤可恢復且有恢復操作，但不自動重試
    else if (recoverable && recoveryAction) {
      // 提供恢復選項
      this.provideRecoveryOption(errorId, appError);
    }
    
    return errorId;
  }
  
  /**
   * 提供恢復選項
   * 
   * @param errorId 錯誤ID
   * @param error 錯誤對象
   */
  private provideRecoveryOption(errorId: string, error: AppError): void {
    // 使用 toast 提供一個恢復按鈕
    if (error.recoveryAction) {
      toast.warning(error.message, { 
        description: error.details,
        action: {
          label: "嘗試恢復",
          onClick: () => this.tryRecover(errorId)
        },
        duration: 10000 // 給用戶足夠時間看到並點擊按鈕
      });
    }
  }
  
  /**
   * 檢查錯誤類型是否可重試
   * 
   * @param type 錯誤類型
   * @returns 是否可重試
   */
  private isErrorRetryable(type: ErrorType): boolean {
    return this.retryConfig.retryableErrorTypes.includes(type);
  }
  
  /**
   * 獲取當前語言的錯誤訊息
   * 
   * @param error 錯誤對象
   * @param locale 語言代碼
   * @returns 錯誤訊息
   */
  public getErrorMessages(
    error: AppError, 
    locale: string = this.locale
  ): ErrorMessages {
    // 默認使用現有的錯誤訊息
    const defaultMessages: ErrorMessages = {
      title: error.message,
      details: error.details,
      recoveryGuidance: error.recoveryGuidance
    };
    
    // 這裡可以實現從國際化資源獲取訊息的邏輯
    // 根據 error.type, locale 等參數
    return defaultMessages;
  }
  
  /**
   * 顯示錯誤通知，包含恢復指南
   * 
   * @param error 錯誤
   */
  private showErrorNotification(error: AppError): void {
    // 獲取當前語言的錯誤訊息
    const messages = this.getErrorMessages(error);
    
    // 合併詳細信息和恢復指南
    const description = messages.recoveryGuidance 
      ? `${messages.details || ''}\n${messages.recoveryGuidance}`
      : messages.details;
      
    switch (error.severity) {
      case ErrorSeverity.FATAL:
      case ErrorSeverity.CRITICAL:
        toast.error(messages.title, { description });
        break;
      case ErrorSeverity.HIGH:
        toast.error(messages.title, { description });
        break;
      case ErrorSeverity.MEDIUM:
        toast.warning(messages.title, { description });
        break;
      case ErrorSeverity.LOW:
        toast.info(messages.title, { description });
        break;
    }
  }
  
  /**
   * 安排重試操作，使用指數退避策略
   * 
   * @param errorId 錯誤ID
   * @param action 重試操作
   * @param attempt 當前重試次數
   */
  private scheduleRetry(errorId: string, action: () => void, attempt: number = 1): void {
    if (attempt > this.retryConfig.maxRetries) {
      return;
    }
    
    // 使用指數退避計算延遲
    const delay = this.retryConfig.initialDelay * Math.pow(this.retryConfig.backoffFactor, attempt - 1);
    
    // 設置計時器
    const timerId = window.setTimeout(() => {
      // 顯示重試通知
      toast.info(`正在重試操作 (${attempt}/${this.retryConfig.maxRetries})...`);
      
      try {
        // 執行重試操作
        action();
        
        // 如果成功，清除計時器
        this.retryTimers.delete(errorId);
        
        // 顯示成功通知
        toast.success('操作成功完成');
      } catch (error) {
        // 如果失敗，安排下一次重試
        this.scheduleRetry(errorId, action, attempt + 1);
      }
    }, delay);
    
    // 存儲計時器ID，以便可以取消
    this.retryTimers.set(errorId, timerId);
  }
  
  /**
   * 嘗試恢復錯誤
   * 
   * @param errorId 錯誤ID
   * @returns 是否成功恢復
   */
  public tryRecover(errorId: string): boolean {
    // 查找錯誤
    const error = this.getErrorById(errorId);
    
    if (!error || !error.recoverable || !error.recoveryAction) {
      return false;
    }
    
    try {
      error.recoveryAction();
      toast.success('操作已成功恢復');
      return true;
    } catch (e) {
      toast.error('恢復操作失敗');
      return false;
    }
  }
  
  /**
   * 嘗試重試操作
   * 
   * @param operationId 操作ID
   * @param operation 操作函數
   * @param maxRetries 最大重試次數
   * @param delay 重試延遲 (毫秒)
   * @returns 操作結果的Promise
   */
  public async retry<T>(
    operationId: string,
    operation: () => Promise<T>,
    maxRetries: number = this.retryConfig.maxRetries,
    delay: number = this.retryConfig.initialDelay
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const retryCount = (this.retryMap.get(operationId) || 0) + 1;
      this.retryMap.set(operationId, retryCount);
      
      if (retryCount <= maxRetries) {
        console.warn(`Retrying operation ${operationId} (${retryCount}/${maxRetries})...`);
        
        // 使用指數退避計算延遲
        const currentDelay = delay * Math.pow(this.retryConfig.backoffFactor, retryCount - 1);
        
        await new Promise(resolve => setTimeout(resolve, currentDelay));
        return this.retry(operationId, operation, maxRetries, delay);
      } else {
        this.retryMap.delete(operationId);
        throw error;
      }
    }
  }
  
  /**
   * 取消指定錯誤的重試
   * 
   * @param errorId 錯誤ID
   */
  public cancelRetry(errorId: string): void {
    const timerId = this.retryTimers.get(errorId);
    if (timerId !== undefined) {
      clearTimeout(timerId);
      this.retryTimers.delete(errorId);
    }
  }
  
  /**
   * 取消所有重試
   */
  public cancelAllRetries(): void {
    for (const timerId of this.retryTimers.values()) {
      clearTimeout(timerId);
    }
    this.retryTimers.clear();
  }
  
  /**
   * 獲取錯誤歷史記錄
   * 
   * @param limit 限制數量
   * @returns 錯誤歷史記錄
   */
  public getErrorHistory(limit?: number): AppError[] {
    if (limit !== undefined) {
      return [...this.errorHistory].slice(-limit);
    }
    return [...this.errorHistory];
  }
  
  /**
   * 清除錯誤歷史記錄
   */
  public clearErrorHistory(): void {
    this.errorHistory = [];
  }
  
  /**
   * 根據ID獲取錯誤
   * 
   * @param errorId 錯誤ID
   * @returns 找到的錯誤，如果沒找到則返回 undefined
   */
  public getErrorById(errorId: string): AppError | undefined {
    // 在實際實現中，應該有一個映射表來快速查找錯誤
    // 這裡為了簡單，假設ID是包含在錯誤消息中的
    return this.errorHistory.find(error => 
      error.message.includes(errorId) || error.details?.includes(errorId)
    );
  }
  
  /**
   * 獲取錯誤統計信息
   * 
   * @returns 錯誤統計信息
   */
  public getErrorStats(): {
    total: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
    recoverable: number;
    nonRecoverable: number;
  } {
    const stats = {
      total: this.errorHistory.length,
      byType: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
      recoverable: 0,
      nonRecoverable: 0
    };
    
    // 計算各種統計
    this.errorHistory.forEach(error => {
      // 按類型統計
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
      
      // 按嚴重程度統計
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
      
      // 按可恢復性統計
      if (error.recoverable) {
        stats.recoverable++;
      } else {
        stats.nonRecoverable++;
      }
    });
    
    return stats;
  }
  
  /**
   * 設置重試配置
   * 
   * @param config 重試配置
   */
  public setRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
  }
  
  /**
   * 設置報告配置
   * 
   * @param config 報告配置
   */
  public setReportConfig(config: Partial<ReportConfig>): void {
    this.reportConfig = { ...this.reportConfig, ...config };
  }
  
  /**
   * 設置當前語言
   * 
   * @param locale 語言代碼
   */
  public setLocale(locale: string): void {
    this.locale = locale;
  }
  
  /**
   * 獲取恢復建議
   * 
   * @param errorType 錯誤類型
   * @returns 恢復建議
   */
  public getRecoveryRecommendation(errorType: ErrorType): string {
    // 根據錯誤類型返回不同的建議
    switch (errorType) {
      case ErrorType.NETWORK_ERROR:
        return '請檢查您的網絡連接，然後點擊重試按鈕。如果問題持續存在，請確認您能夠訪問網絡。';
      
      case ErrorType.PHOTO_PROCESSING_ERROR:
        return '圖像處理失敗，可能的原因包括格式不支持或文件損壞。請嘗試使用不同的圖像或轉換為標準格式（如JPG或PNG）後重試。';
      
      case ErrorType.PHOTO_EXTRACTION_ERROR:
        return '特徵提取失敗，可能是因為圖像質量過低或格式特殊。嘗試上傳更高質量的圖像，或檢查圖像是否正確顯示。';
      
      case ErrorType.FILE_SYSTEM_ERROR:
        return '文件系統操作失敗，請確認您有適當的權限，並檢查是否有足夠的磁盤空間。您可能需要重新啟動應用程序。';
      
      case ErrorType.INPUT_ERROR:
        return '請檢查輸入數據是否正確。確保所有必填字段都已填寫，並且格式符合要求。';
      
      case ErrorType.MEMORY_LIMIT_ERROR:
        return '應用程序內存不足，請嘗試減少處理的圖像數量，或關閉其他應用程序後重試。';
        
      case ErrorType.PHOTO_FORMAT_ERROR:
        return '不支持的照片格式，請轉換為JPG、PNG、WebP或其他常見格式後重試。';
        
      case ErrorType.PHOTO_LOADING_ERROR:
        return '照片載入失敗，可能是因為文件損壞或不完整。請檢查文件是否可以在其他程序中正常開啟。';
      
      default:
        return '請重新啟動應用程序，如果問題仍然存在，請聯繫支持團隊並提供發生錯誤時的操作步驟。';
    }
  }
  
  /**
   * 檢測錯誤處理的反模式
   * 僅在開發環境中使用
   * 
   * @returns 發現的問題和建議
   */
  public detectErrorAntiPatterns(): { issues: string[], suggestions: string[] } {
    const issues: string[] = [];
    const suggestions: string[] = [];
    
    // 檢測標記為可恢復但沒有恢復操作的錯誤
    const recoverableWithoutAction = this.errorHistory.filter(
      e => e.recoverable && !e.recoveryAction
    );
    
    if (recoverableWithoutAction.length > 0) {
      issues.push(`發現 ${recoverableWithoutAction.length} 個標記為可恢復但沒有恢復操作的錯誤`);
      suggestions.push('為所有可恢復的錯誤提供 recoveryAction 函數');
    }
    
    // 檢測使用不一致的嚴重性級別
    const errorTypeToSeverity = new Map<string, Set<string>>();
    this.errorHistory.forEach(error => {
      const set = errorTypeToSeverity.get(error.type) || new Set();
      set.add(error.severity);
      errorTypeToSeverity.set(error.type, set);
    });
    
    const inconsistentSeverity = Array.from(errorTypeToSeverity.entries())
      .filter(([_, severities]) => severities.size > 1);
    
    if (inconsistentSeverity.length > 0) {
      issues.push(`發現 ${inconsistentSeverity.length} 種錯誤類型使用了不一致的嚴重性級別`);
      suggestions.push('為每種錯誤類型使用一致的嚴重性級別');
    }
    
    return { issues, suggestions };
  }
  
  /**
   * 生成錯誤ID
   * 
   * @returns 錯誤ID
   */
  private generateErrorId(): string {
    return `err-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * 記錄錯誤
   * 
   * @param errorId 錯誤ID
   * @param error 錯誤
   */
  private logError(errorId: string, error: AppError): void {
    // 打印到控制台
    console.error(`[${error.type}] [${error.severity}] ${error.message}`, {
      errorId,
      details: error.details,
      timestamp: error.timestamp,
      recoverable: error.recoverable,
      stack: error.stack,
      recoveryGuidance: error.recoveryGuidance
    });
    
    // 實際應用中，這裡可以將錯誤發送到日誌服務
  }
  
  /**
   * 將錯誤添加到遙測隊列
   * 
   * @param errorId 錯誤ID
   * @param error 錯誤
   */
  private queueTelemetry(errorId: string, error: AppError): void {
    // 添加到隊列
    this.telemetryQueue.push({
      error,
      type: error.type,
      details: error.details,
      timestamp: error.timestamp,
      severity: error.severity
    });
    
    // 如果隊列達到一定大小，發送遙測數據
    if (this.telemetryQueue.length >= 10) {
      this.sendTelemetry();
    }
  }
  
  /**
   * 發送遙測數據
   */
  private sendTelemetry(): void {
    // 實際應用中，這裡應該發送遙測數據到服務器
    // 例如，使用 fetch API 發送數據
    
    // 清空隊列
    this.telemetryQueue = [];
  }
  
  /**
   * 處理致命錯誤
   * 
   * @param errorId 錯誤ID
   * @param error 錯誤
   */
  private handleFatalError(errorId: string, error: AppError): void {
    // 實際應用中，這裡可以顯示全局錯誤頁面
    // 或者重新加載應用等
    console.error(`Fatal error occurred: ${errorId}`);
  }
  
  /**
   * 檢查記憶體使用情況
   */
  private checkMemoryUsage(): void {
    try {
      if (hasMemoryInfo(performance)) {
        const memoryInfo = performance.memory!; // 使用非空斷言，因為我們已經通過 hasMemoryInfo 確認了它存在
        const usedMemoryMB = memoryInfo.usedJSHeapSize / (1024 * 1024);
        
        // 記錄當前記憶體使用情況（僅在開發環境）
        if (process.env.NODE_ENV === 'development') {
          console.debug(`[ErrorHandlingService] 當前記憶體使用: ${Math.round(usedMemoryMB)} MB`);
        }
      }
    } catch (error) {
      console.error('[ErrorHandlingService] 檢查記憶體使用時出錯:', error);
    }
  }
}

// 導出單例
export const errorHandler = new ErrorHandlingService();

// 全局錯誤捕獲
export const setupGlobalErrorHandler = (): void => {
  window.addEventListener("error", (event) => {
    errorHandler.handleError(
      event.error || event.message, 
      ErrorType.SYSTEM_ERROR, 
      "全局未處理的錯誤",
      false,
      undefined,
      ErrorSeverity.HIGH
    );
    
    // 避免控制台顯示額外的錯誤
    event.preventDefault();
  });
  
  window.addEventListener("unhandledrejection", (event) => {
    errorHandler.handleError(
      event.reason?.message || "未處理的 Promise 拒絕",
      ErrorType.SYSTEM_ERROR,
      "未處理的 Promise 異常",
      false,
      undefined,
      ErrorSeverity.HIGH
    );
    
    // 避免控制台顯示額外的錯誤
    event.preventDefault();
  });
};

// 統一的錯誤處理函數，使用 Result 模式
export function handleErrorWithResult<T>(
  error: unknown,
  type: ErrorType = ErrorType.UNKNOWN_ERROR,
  details?: string,
  recoverable: boolean = false,
  recoveryAction?: () => void,
  severity: ErrorSeverity = ErrorSeverity.MEDIUM
): Result<T, AppError> {
  return errorHandler.handleErrorWithResult<T>(
    error,
    type,
    details,
    recoverable,
    recoveryAction,
    severity
  );
}

// 有用的錯誤處理包裝函數，使用重試機制
export function withErrorHandling<T>(
  func: (...args: any[]) => Promise<T>,
  errorType: ErrorType,
  errorMessage: string,
  recoverable: boolean = false,
  recoveryAction?: () => void,
  severity: ErrorSeverity = ErrorSeverity.MEDIUM
): (...args: any[]) => Promise<T | null> {
  return async (...args: any[]): Promise<T | null> => {
    try {
      return await func(...args);
    } catch (error) {
      errorHandler.handleError(
        error as Error,
        errorType,
        errorMessage,
        recoverable,
        recoveryAction,
        severity
      );
      return null;
    }
  };
}

// 使用自動重試功能的包裝函數
export function withRetry<T>(
  func: (...args: any[]) => Promise<T>,
  options: {
    maxAttempts?: number,
    initialDelay?: number,
    errorType?: ErrorType,
    errorMessage?: string,
    severity?: ErrorSeverity,
    autoRetry?: boolean
  } = {}
): (...args: any[]) => Promise<T> {
  const maxAttempts = options.maxAttempts || 3;
  const initialDelay = options.initialDelay || 1000;
  const errorType = options.errorType || ErrorType.UNKNOWN_ERROR;
  const errorMessage = options.errorMessage || "操作失敗";
  const severity = options.severity || ErrorSeverity.MEDIUM;
  const autoRetry = options.autoRetry !== undefined ? options.autoRetry : true;
  
  return async (...args: any[]): Promise<T> => {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await func(...args);
      } catch (error) {
        lastError = error as Error;
        
        // 如果這是最後一次嘗試，不再重試
        if (attempt === maxAttempts) {
          break;
        }
        
        console.log(`嘗試 ${attempt}/${maxAttempts} 失敗，將在 ${initialDelay * Math.pow(2, attempt - 1)}ms 後重試`);
        
        // 使用延遲來等待指定時間，採用指數退避策略
        await new Promise(resolve => setTimeout(resolve, initialDelay * Math.pow(2, attempt - 1)));
      }
    }
    
    // 全部嘗試都失敗
    errorHandler.handleError(
      lastError as Error,
      errorType,
      `${errorMessage} (已重試 ${maxAttempts} 次)`,
      true, // 設為可恢復
      autoRetry ? () => func(...args) : undefined, // 如果自動重試，提供恢復函數
      severity,
      autoRetry // 是否自動重試
    );
    
    throw lastError;
  };
}

/**
 * 統一的錯誤處理工具函數
 * 適用於所有異步操作和事件處理
 */
export function safeExecute<T>(
  operation: () => Promise<T>,
  options: {
    errorType?: ErrorType;
    errorMessage?: string;
    details?: string;
    recoverable?: boolean;
    recoveryAction?: () => void;
    severity?: ErrorSeverity;
    autoRetry?: boolean;
  } = {}
): Promise<Result<T, AppError>> {
  return new Promise<Result<T, AppError>>(async (resolve) => {
    try {
      const result = await operation();
      resolve(ok(result));
    } catch (error) {
      const errorResult = handleErrorWithResult<T>(
        error,
        options.errorType || ErrorType.UNKNOWN_ERROR,
        options.details || options.errorMessage || '操作失敗',
        options.recoverable || false,
        options.recoveryAction,
        options.severity || ErrorSeverity.MEDIUM
      );
      resolve(errorResult);
    }
  });
}

// 在組件中使用的錯誤處理 Hook
export function useErrorHandler() {
  return {
    handleError: errorHandler.handleError.bind(errorHandler),
    handleErrorWithResult: errorHandler.handleErrorWithResult.bind(errorHandler),
    getErrorHistory: errorHandler.getErrorHistory.bind(errorHandler),
    clearErrorHistory: errorHandler.clearErrorHistory.bind(errorHandler),
    getErrorStats: errorHandler.getErrorStats.bind(errorHandler),
    getErrorById: errorHandler.getErrorById.bind(errorHandler),
    getRecoveryRecommendation: errorHandler.getRecoveryRecommendation.bind(errorHandler),
    setRetryConfig: errorHandler.setRetryConfig.bind(errorHandler),
    setReportConfig: errorHandler.setReportConfig.bind(errorHandler),
    setLocale: errorHandler.setLocale.bind(errorHandler),
    cancelRetry: errorHandler.cancelRetry.bind(errorHandler),
    cancelAllRetries: errorHandler.cancelAllRetries.bind(errorHandler),
    tryRecover: errorHandler.tryRecover.bind(errorHandler),
    detectErrorAntiPatterns: errorHandler.detectErrorAntiPatterns.bind(errorHandler)
  };
} 