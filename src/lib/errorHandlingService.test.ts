import { errorHandler, ErrorType, ErrorSeverity, withRetry, withErrorHandling } from './errorHandlingService';
import { toast } from 'sonner';
import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';

// 模擬 toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }
}));

describe('ErrorHandlingService', () => {
  // 在每個測試之前重置模擬函數
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('基本錯誤處理', () => {
    test('handleError 應該處理 Error 對象', () => {
      const error = new Error('測試錯誤');
      const errorId = errorHandler.handleError(
        error, 
        ErrorType.PHOTO_PROCESSING_ERROR,
        '處理照片時發生錯誤'
      );
      
      // 檢查是否返回錯誤ID
      expect(errorId).toBeDefined();
      expect(typeof errorId).toBe('string');
      
      // 檢查是否顯示 toast 通知
      expect(toast.warning).toHaveBeenCalled();
    });
    
    test('handleError 應該處理字符串錯誤', () => {
      const errorId = errorHandler.handleError(
        '字符串錯誤', 
        ErrorType.DATABASE_ERROR,
        '數據庫操作失敗'
      );
      
      expect(errorId).toBeDefined();
      expect(toast.warning).toHaveBeenCalled();
    });
    
    test('錯誤嚴重程度應該影響 toast 類型', () => {
      errorHandler.handleError(
        'Critical錯誤', 
        ErrorType.SYSTEM_ERROR,
        '系統錯誤',
        false,
        undefined,
        ErrorSeverity.CRITICAL
      );
      
      expect(toast.error).toHaveBeenCalled();
      
      vi.clearAllMocks();
      
      errorHandler.handleError(
        '普通錯誤', 
        ErrorType.PHOTO_FORMAT_ERROR,
        '格式錯誤',
        false,
        undefined,
        ErrorSeverity.LOW
      );
      
      expect(toast.info).toHaveBeenCalled();
    });
  });
  
  describe('錯誤管理功能', () => {
    test('getErrorHistory 應該返回錯誤歷史', () => {
      // 清除歷史記錄
      errorHandler.clearErrorHistory();
      
      // 添加兩個新錯誤
      errorHandler.handleError('錯誤1', ErrorType.PHOTO_LOADING_ERROR);
      errorHandler.handleError('錯誤2', ErrorType.MEMORY_LIMIT_ERROR);
      
      // 檢查歷史記錄
      const history = errorHandler.getErrorHistory();
      expect(history.length).toBe(2);
      expect(history[0].message).toBe('錯誤1');
      expect(history[1].message).toBe('錯誤2');
      
      // 測試帶有限制的歷史記錄
      const limitedHistory = errorHandler.getErrorHistory(1);
      expect(limitedHistory.length).toBe(1);
      expect(limitedHistory[0].message).toBe('錯誤2'); // 最新的錯誤
    });
    
    test('應該能通過ID獲取錯誤', () => {
      errorHandler.clearErrorHistory();
      
      const errorId = errorHandler.handleError('可檢索的錯誤', ErrorType.FILE_TYPE_ERROR);
      const error = errorHandler.getErrorById(errorId);
      
      expect(error).toBeDefined();
      expect(error?.message).toBe('可檢索的錯誤');
      expect(error?.type).toBe(ErrorType.FILE_TYPE_ERROR);
      
      // 測試無效ID
      const nonExistentError = errorHandler.getErrorById('不存在的ID');
      expect(nonExistentError).toBeUndefined();
    });
    
    test('getErrorStats 應該返回統計信息', () => {
      errorHandler.clearErrorHistory();
      
      errorHandler.handleError('錯誤1', ErrorType.FILE_TYPE_ERROR, '', false, undefined, ErrorSeverity.LOW);
      errorHandler.handleError('錯誤2', ErrorType.FILE_TYPE_ERROR, '', false, undefined, ErrorSeverity.LOW);
      errorHandler.handleError('錯誤3', ErrorType.MEMORY_LIMIT_ERROR, '', true, () => {}, ErrorSeverity.HIGH);
      
      const stats = errorHandler.getErrorStats();
      
      expect(stats.total).toBe(3);
      expect(stats.byType[ErrorType.FILE_TYPE_ERROR]).toBe(2);
      expect(stats.byType[ErrorType.MEMORY_LIMIT_ERROR]).toBe(1);
      expect(stats.bySeverity[ErrorSeverity.LOW]).toBe(2);
      expect(stats.bySeverity[ErrorSeverity.HIGH]).toBe(1);
      expect(stats.recoverable).toBe(1);
      expect(stats.nonRecoverable).toBe(2);
    });
  });
  
  describe('自動重試機制', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    
    afterEach(() => {
      vi.useRealTimers();
    });
    
    test('應該安排重試可恢復的錯誤', () => {
      const recoveryAction = vi.fn();
      
      errorHandler.handleError(
        'retryable-error',
        ErrorType.NETWORK_ERROR,
        '網絡連接問題',
        true, // 可恢復的
        recoveryAction
      );
      
      // 在重試之前，恢復操作不應被調用
      expect(recoveryAction).not.toHaveBeenCalled();
      
      // 前進計時器
      vi.advanceTimersByTime(1500);
      
      // 恢復操作應被調用
      expect(recoveryAction).toHaveBeenCalledTimes(1);
    });
    
    test('應該使用指數退避進行多次重試', () => {
      const failingAction = vi.fn().mockImplementation(() => {
        throw new Error('仍然失敗');
      });
      
      errorHandler.handleError(
        'failing-error',
        ErrorType.NETWORK_ERROR,
        '持續的網絡問題',
        true,
        failingAction
      );
      
      // 第一次重試 (1秒)
      vi.advanceTimersByTime(1500);
      expect(failingAction).toHaveBeenCalledTimes(1);
      expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('1/3'), expect.anything());
      
      // 第二次重試 (2秒後)
      vi.advanceTimersByTime(2500);
      expect(failingAction).toHaveBeenCalledTimes(2);
      expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('2/3'), expect.anything());
      
      // 第三次重試 (4秒後)
      vi.advanceTimersByTime(4500);
      expect(failingAction).toHaveBeenCalledTimes(3);
      expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('3/3'), expect.anything());
      
      // 不應該再重試
      vi.advanceTimersByTime(10000);
      expect(failingAction).toHaveBeenCalledTimes(3); // 仍然是3次
    });
    
    test('應該能夠取消重試', () => {
      const recoveryAction = vi.fn();
      
      const errorId = errorHandler.handleError(
        'cancelable-error',
        ErrorType.NETWORK_ERROR,
        '可取消的網絡問題',
        true,
        recoveryAction
      );
      
      // 取消重試
      errorHandler.cancelRetry(errorId);
      
      // 前進計時器
      vi.advanceTimersByTime(5000);
      
      // 恢復操作不應被調用
      expect(recoveryAction).not.toHaveBeenCalled();
    });
    
    test('應該能夠取消所有重試', () => {
      const action1 = vi.fn();
      const action2 = vi.fn();
      
      errorHandler.handleError('error1', ErrorType.NETWORK_ERROR, '', true, action1);
      errorHandler.handleError('error2', ErrorType.DATABASE_ERROR, '', true, action2);
      
      // 取消所有重試
      errorHandler.cancelAllRetries();
      
      // 前進計時器
      vi.advanceTimersByTime(5000);
      
      // 兩個動作都不應被調用
      expect(action1).not.toHaveBeenCalled();
      expect(action2).not.toHaveBeenCalled();
    });
  });
  
  describe('高級功能封裝', () => {
    test('withErrorHandling 應該捕獲並處理錯誤', async () => {
      const failingFunction = vi.fn().mockRejectedValue(new Error('函數失敗'));
      
      const wrappedFunction = withErrorHandling(
        failingFunction,
        ErrorType.PHOTO_PROCESSING_ERROR,
        '處理照片時出錯'
      );
      
      const result = await wrappedFunction('arg1', 'arg2');
      
      expect(failingFunction).toHaveBeenCalledWith('arg1', 'arg2');
      expect(result).toBeNull();
      expect(toast.warning).toHaveBeenCalled();
    });
    
    test('withRetry 應該重試失敗的操作', async () => {
      // 前兩次失敗，第三次成功的函數
      const eventuallySuccessfulFn = vi.fn()
        .mockRejectedValueOnce(new Error('失敗1'))
        .mockRejectedValueOnce(new Error('失敗2'))
        .mockResolvedValueOnce('成功');
      
      const wrappedFunction = withRetry(
        eventuallySuccessfulFn,
        { maxAttempts: 3, initialDelay: 10 } // 低延遲以便快速測試
      );
      
      // 改用真實計時器以避免 vi.advanceTimersByTime 的問題
      vi.useRealTimers();
      
      const result = await wrappedFunction();
      
      expect(eventuallySuccessfulFn).toHaveBeenCalledTimes(3);
      expect(result).toBe('成功');
    });
    
    test('withRetry 在所有重試都失敗時應該拋出錯誤', async () => {
      const alwaysFailingFn = vi.fn().mockRejectedValue(new Error('總是失敗'));
      
      const wrappedFunction = withRetry(
        alwaysFailingFn,
        { maxAttempts: 2, initialDelay: 10 }
      );
      
      await expect(wrappedFunction()).rejects.toThrow('總是失敗');
      expect(alwaysFailingFn).toHaveBeenCalledTimes(2);
      expect(toast.warning).toHaveBeenCalled();
    });
  });
}); 