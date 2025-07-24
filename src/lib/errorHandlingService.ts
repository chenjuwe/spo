import { toast } from "sonner";

/**
 * 應用錯誤類型枚舉
 */
export enum ErrorType {
  // 系統錯誤
  SYSTEM_ERROR = "system_error",
  NETWORK_ERROR = "network_error",
  DATABASE_ERROR = "database_error",
  
  // 照片處理錯誤
  PHOTO_PROCESSING_ERROR = "photo_processing_error",
  PHOTO_LOADING_ERROR = "photo_loading_error",
  PHOTO_SAVING_ERROR = "photo_saving_error",
  PHOTO_FORMAT_ERROR = "photo_format_error",
  
  // 檔案操作錯誤
  FILE_ACCESS_ERROR = "file_access_error",
  FILE_SIZE_ERROR = "file_size_error",
  FILE_TYPE_ERROR = "file_type_error",
  
  // 記憶體相關錯誤
  MEMORY_LIMIT_ERROR = "memory_limit_error",
  WORKER_CRASH_ERROR = "worker_crash_error",
  
  // 資源錯誤
  RESOURCE_LIMIT_ERROR = "resource_limit_error",
  
  // 功能支援錯誤
  UNSUPPORTED_BROWSER_ERROR = "unsupported_browser_error",
  UNSUPPORTED_FEATURE_ERROR = "unsupported_feature_error",
  
  // 未知錯誤
  UNKNOWN_ERROR = "unknown_error"
}

/**
 * 應用錯誤介面
 */
export interface AppError {
  type: ErrorType;
  message: string;
  details: string | undefined;
  timestamp: Date;
  recoverable: boolean;
  recoveryAction: (() => void) | undefined;
  technicalDetails: unknown | undefined;
  browserInfo?: {
    name: string;
    version: string;
    os: string;
  };
}

/**
 * 錯誤處理服務
 */
class ErrorHandlingService {
  private errors: AppError[] = [];
  private errorListeners: ((error: AppError) => void)[] = [];
  
  /**
   * 處理錯誤
   * @param error 錯誤對象或字符串
   * @param type 錯誤類型
   * @param details 詳細信息
   * @param recoverable 是否可恢復
   * @param recoveryAction 恢復操作
   */
  public handleError(
    error: Error | string,
    type: ErrorType = ErrorType.UNKNOWN_ERROR,
    details?: string,
    recoverable: boolean = false,
    recoveryAction?: () => void
  ): void {
    // 構建錯誤對象
    const errorObj: AppError = {
      type,
      message: typeof error === 'string' ? error : error.message,
      details,
      timestamp: new Date(),
      recoverable,
      recoveryAction,
      technicalDetails: typeof error !== 'string' ? error : undefined
    };
    
    // 記錄錯誤
    console.error(`[${errorObj.type}] ${errorObj.message}`, errorObj);
    this.errors.push(errorObj);
    
    // 顯示適合的用戶提示
    this.showUserFriendlyError(errorObj);
    
    // 通知監聽器
    this.notifyListeners(errorObj);
    
    // 如果是嚴重錯誤，發送遙測數據
    if (this.isCriticalError(type)) {
      this.sendErrorTelemetry(errorObj);
    }
  }
  
  /**
   * 顯示用戶友好的錯誤提示
   */
  private showUserFriendlyError(error: AppError): void {
    // 根據錯誤類型提供具體的錯誤提示和建議
    const errorInfo = this.getUserFriendlyErrorInfo(error);
    
         // 根據錯誤可恢復性決定顯示方式
     if (error.recoverable) {
       toast.error(
         errorInfo.title,
         {
           description: errorInfo.suggestion 
             ? `${errorInfo.message} ${errorInfo.suggestion}`
             : errorInfo.message,
           duration: 8000,
           action: {
             label: errorInfo.actionLabel || "重試",
             onClick: () => error.recoveryAction?.()
           }
         }
       );
     } else {
       toast.error(
         errorInfo.title,
         {
           description: errorInfo.suggestion 
             ? `${errorInfo.message} ${errorInfo.suggestion}`
             : errorInfo.message,
           duration: 10000,
         }
       );
     }
  }
  
  /**
   * 獲取用戶友好的錯誤信息
   */
  private getUserFriendlyErrorInfo(error: AppError): {
    title: string;
    message: string;
    suggestion?: string;
    actionLabel?: string;
  } {
    switch (error.type) {
      case ErrorType.PHOTO_PROCESSING_ERROR:
        return {
          title: "照片處理失敗",
          message: "處理照片時發生錯誤，可能是照片格式不支援或照片已損壞。",
          suggestion: "請嘗試使用不同的照片，或轉換為常見格式如 JPG 或 PNG。",
          actionLabel: "重新處理"
        };
        
      case ErrorType.PHOTO_LOADING_ERROR:
        return {
          title: "照片載入失敗",
          message: "無法載入照片，可能是檔案已損壞或格式不支援。",
          suggestion: "請嘗試重新選擇照片，或檢查檔案是否完整。",
          actionLabel: "重新選擇"
        };
        
      case ErrorType.MEMORY_LIMIT_ERROR:
        return {
          title: "記憶體不足",
          message: "處理大量或高解析度照片時記憶體不足。",
          suggestion: "請嘗試關閉其他應用程式，或分批處理較少量的照片。",
          actionLabel: "釋放記憶體並重試"
        };
        
      case ErrorType.WORKER_CRASH_ERROR:
        return {
          title: "處理引擎崩潰",
          message: "照片處理程序意外停止，可能是因為照片太大或格式特殊。",
          suggestion: "請嘗試使用較小的照片或轉換為標準格式。",
          actionLabel: "重啟處理引擎"
        };
        
      case ErrorType.DATABASE_ERROR:
        return {
          title: "資料儲存錯誤",
          message: "無法儲存處理結果至本地資料庫。",
          suggestion: "請檢查瀏覽器儲存空間是否足夠，或嘗試清除瀏覽器快取。",
          actionLabel: "清理空間並重試"
        };
        
      case ErrorType.FILE_SIZE_ERROR:
        return {
          title: "檔案過大",
          message: "所選檔案超出處理上限。",
          suggestion: "請使用圖片壓縮工具減少檔案大小，或選擇較小的檔案。",
          actionLabel: "了解更多"
        };
        
      case ErrorType.FILE_TYPE_ERROR:
        return {
          title: "不支援的檔案類型",
          message: "所選檔案類型不受支援。",
          suggestion: "請使用常見的圖片格式，如 JPG、PNG、WebP 或 HEIC。",
          actionLabel: "查看支援的格式"
        };
        
      case ErrorType.UNSUPPORTED_BROWSER_ERROR:
        return {
          title: "瀏覽器不支援",
          message: "您的瀏覽器不支援此功能。",
          suggestion: "請嘗試使用最新版本的 Chrome、Firefox 或 Edge。",
          actionLabel: "了解更多"
        };
        
      case ErrorType.NETWORK_ERROR:
        return {
          title: "網路錯誤",
          message: "無法連線至網路資源，請檢查您的網路連線。",
          suggestion: "如果您的網路正常，請稍後再試。",
          actionLabel: "重試"
        };
        
      case ErrorType.RESOURCE_LIMIT_ERROR:
        return {
          title: "系統資源不足",
          message: "您的設備資源不足，無法完成此操作。",
          suggestion: "請關閉其他程式或分批處理較少量的照片。",
          actionLabel: "簡化處理"
        };
        
      default:
        return {
          title: "發生錯誤",
          message: error.message || "應用程式遇到未預期的錯誤。",
          suggestion: "請重新整理頁面後再試。若問題持續發生，請聯絡支援團隊。",
          actionLabel: "重新整理"
        };
    }
  }
  
  /**
   * 檢查是否為嚴重錯誤
   */
  private isCriticalError(type: ErrorType): boolean {
    return [
      ErrorType.SYSTEM_ERROR,
      ErrorType.DATABASE_ERROR,
      ErrorType.WORKER_CRASH_ERROR
    ].includes(type);
  }
  
  /**
   * 發送錯誤遙測數據（僅在生產環境啟用）
   */
  private sendErrorTelemetry(error: AppError): void {
    // 在生產環境中，可以發送到錯誤跟踪服務
    // 這裡只做簡單的日誌記錄
    if (import.meta.env.PROD) {
      console.info("發送錯誤遙測數據：", {
        type: error.type,
        message: error.message,
        timestamp: error.timestamp,
        userAgent: navigator.userAgent,
      });
    }
  }
  
  /**
   * 添加錯誤監聽器
   */
  public addErrorListener(listener: (error: AppError) => void): void {
    this.errorListeners.push(listener);
  }
  
  /**
   * 移除錯誤監聽器
   */
  public removeErrorListener(listener: (error: AppError) => void): void {
    this.errorListeners = this.errorListeners.filter(l => l !== listener);
  }
  
  /**
   * 通知所有錯誤監聽器
   */
  private notifyListeners(error: AppError): void {
    this.errorListeners.forEach(listener => {
      try {
        listener(error);
      } catch (e) {
        console.error("Error in error listener:", e);
      }
    });
  }
  
  /**
   * 獲取錯誤歷史
   */
  public getErrorHistory(): AppError[] {
    return [...this.errors];
  }
  
  /**
   * 清除錯誤歷史
   */
  public clearErrorHistory(): void {
    this.errors = [];
  }
  
  /**
   * 根據錯誤類型和細節，提供自動恢復建議
   */
  public getRecoveryRecommendation(error: AppError): string {
    switch (error.type) {
      case ErrorType.MEMORY_LIMIT_ERROR:
        return "建議關閉其他應用程式，釋放記憶體，並嘗試分批處理較少量的照片。";
        
      case ErrorType.PHOTO_PROCESSING_ERROR:
        return "建議重新啟動處理引擎，並嘗試使用標準圖片格式如 JPG 或 PNG。";
        
      case ErrorType.DATABASE_ERROR:
        return "建議清理瀏覽器緩存和儲存空間，然後重新整理頁面。";
        
      case ErrorType.WORKER_CRASH_ERROR:
        return "建議重新載入頁面，並嘗試減少同時處理的照片數量。";
        
      default:
        return "建議重新整理頁面，如問題持續出現，請使用其他瀏覽器嘗試。";
    }
  }
}

// 導出單例實例
export const errorHandler = new ErrorHandlingService();

// 全局錯誤捕獲
export const setupGlobalErrorHandler = (): void => {
  window.addEventListener("error", (event) => {
    errorHandler.handleError(
      event.error || event.message, 
      ErrorType.SYSTEM_ERROR, 
      "全局未處理的錯誤"
    );
  });
  
  window.addEventListener("unhandledrejection", (event) => {
    errorHandler.handleError(
      event.reason?.message || "未處理的 Promise 拒絕",
      ErrorType.SYSTEM_ERROR,
      "未處理的 Promise 異常"
    );
  });
};

// 有用的錯誤處理包裝函數
export function withErrorHandling<T>(
  func: (...args: any[]) => Promise<T>,
  errorType: ErrorType,
  errorMessage: string,
  recoverable: boolean = false,
  recoveryAction?: () => void
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
        recoveryAction
      );
      return null;
    }
  };
}

// 在組件中使用的錯誤處理 Hook
export function useErrorHandler() {
  return {
    handleError: errorHandler.handleError.bind(errorHandler),
    getErrorHistory: errorHandler.getErrorHistory.bind(errorHandler),
    clearErrorHistory: errorHandler.clearErrorHistory.bind(errorHandler)
  };
} 