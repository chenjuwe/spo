import { toast } from "sonner";

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
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
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
  FATAL = 'FATAL'
}

/**
 * 應用錯誤接口
 */
export interface AppError extends Error {
  // 錯誤類型
  type: ErrorType;
  
  // 詳細信息
  details?: string;
  
  // 時間戳
  timestamp: Date;
  
  // 是否可恢復
  recoverable: boolean;
  
  // 恢復操作
  recoveryAction?: () => void;
  
  // 嚴重程度
  severity: ErrorSeverity;
  
  // 技術細節
  technicalDetails?: any;
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
    details?: string;
    timestamp: Date;
    severity: ErrorSeverity;
  }> = [];
  
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
    severity: ErrorSeverity = ErrorSeverity.MEDIUM
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
    
    return appError;
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
    error: Error | string,
    type: ErrorType = ErrorType.UNKNOWN_ERROR,
    details?: string,
    recoverable: boolean = false,
    recoveryAction?: () => void,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM
  ): string {
    // 創建應用錯誤
    const appError = this.createAppError(
      error,
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
    
    // 如果錯誤嚴重，觸發全局錯誤處理
    if (severity === ErrorSeverity.FATAL) {
      this.handleFatalError(errorId, appError);
    }
    
    return errorId;
  }
  
  /**
   * 嘗試恢復錯誤
   * 
   * @param errorId 錯誤ID
   * @returns 是否成功恢復
   */
  public tryRecover(errorId: string): boolean {
    // 實際應用中，這裡應該查找錯誤並嘗試恢復
    return false;
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
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const retryCount = (this.retryMap.get(operationId) || 0) + 1;
      this.retryMap.set(operationId, retryCount);
      
      if (retryCount <= maxRetries) {
        console.warn(`Retrying operation ${operationId} (${retryCount}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.retry(operationId, operation, maxRetries, delay);
      } else {
        this.retryMap.delete(operationId);
        throw error;
      }
    }
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
      stack: error.stack
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
    severity?: ErrorSeverity
  } = {}
): (...args: any[]) => Promise<T> {
  const maxAttempts = options.maxAttempts || 3;
  const initialDelay = options.initialDelay || 1000;
  const errorType = options.errorType || ErrorType.UNKNOWN_ERROR;
  const errorMessage = options.errorMessage || "操作失敗";
  const severity = options.severity || ErrorSeverity.MEDIUM;
  
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
        
        console.log(`嘗試 ${attempt}/${maxAttempts} 失敗，將在 ${initialDelay * attempt}ms 後重試`);
        
        // 使用延遲來等待指定時間
        await new Promise(resolve => setTimeout(resolve, initialDelay * attempt));
      }
    }
    
    // 全部嘗試都失敗
    errorHandler.handleError(
      lastError as Error,
      errorType,
      `${errorMessage} (已重試 ${maxAttempts} 次)`,
      false,
      undefined,
      severity
    );
    
    throw lastError;
  };
}

// 在組件中使用的錯誤處理 Hook
export function useErrorHandler() {
  return {
    handleError: errorHandler.handleError.bind(errorHandler),
    getErrorHistory: errorHandler.getErrorHistory.bind(errorHandler),
    clearErrorHistory: errorHandler.clearErrorHistory.bind(errorHandler),
    getErrorStats: errorHandler.getErrorStats.bind(errorHandler),
    getErrorById: errorHandler.getErrorById.bind(errorHandler),
    getRecoveryRecommendation: errorHandler.getRecoveryRecommendation.bind(errorHandler),
    setRetryConfig: errorHandler.setRetryConfig.bind(errorHandler),
    setReportConfig: errorHandler.setReportConfig.bind(errorHandler),
    cancelRetry: errorHandler.cancelRetry.bind(errorHandler),
    cancelAllRetries: errorHandler.cancelAllRetries.bind(errorHandler)
  };
} 