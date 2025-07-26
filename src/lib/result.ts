/**
 * Result 模式實現
 * 
 * 提供類似 Rust Result 的錯誤處理機制，避免異常拋出，並使用類型系統標記錯誤狀態
 * 
 * @module result
 */

/**
 * Result 類型
 * 表示一個可能成功或失敗的操作結果
 * 
 * @typeparam T - 成功值的類型
 * @typeparam E - 錯誤的類型
 */
export type Result<T, E> = Success<T, E> | Failure<T, E>;

/**
 * 成功結果
 * 
 * @typeparam T - 成功值的類型
 * @typeparam E - 錯誤的類型
 */
export interface Success<T, E> {
  /**
   * 成功標記
   */
  success: true;
  
  /**
   * 成功值
   */
  value: T;
  
  /**
   * 確認這是一個成功結果 (類型守衛)
   */
  isOk(): this is Success<T, E>;
  
  /**
   * 確認這不是一個失敗結果 (類型守衛)
   */
  isErr(): false;
  
  /**
   * 獲取成功值，如果是失敗則拋出異常
   */
  unwrap(): T;
  
  /**
   * 獲取成功值，如果是失敗則返回提供的默認值
   * @param defaultValue 默認值
   */
  unwrapOr<U>(defaultValue: U): T;
  
  /**
   * 映射成功值
   * @param fn 映射函數
   */
  map<U>(fn: (value: T) => U): Result<U, E>;
  
  /**
   * 鏈式映射
   * @param fn 返回新 Result 的映射函數
   */
  flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E>;
  
  /**
   * 映射錯誤
   * @param fn 映射函數
   */
  mapErr<F>(fn: (error: never) => F): Result<T, F>;
}

/**
 * 失敗結果
 * 
 * @typeparam T - 成功值的類型
 * @typeparam E - 錯誤的類型
 */
export interface Failure<T, E> {
  /**
   * 成功標記
   */
  success: false;
  
  /**
   * 錯誤
   */
  error: E;
  
  /**
   * 確認這不是一個成功結果 (類型守衛)
   */
  isOk(): false;
  
  /**
   * 確認這是一個失敗結果 (類型守衛)
   */
  isErr(): this is Failure<T, E>;
  
  /**
   * 獲取成功值，如果是失敗則拋出異常
   */
  unwrap(): never;
  
  /**
   * 獲取成功值，如果是失敗則返回提供的默認值
   * @param defaultValue 默認值
   */
  unwrapOr<U>(defaultValue: U): U;
  
  /**
   * 映射成功值
   * @param fn 映射函數
   */
  map<U>(fn: (value: never) => U): Result<U, E>;
  
  /**
   * 鏈式映射
   * @param fn 返回新 Result 的映射函數
   */
  flatMap<U>(fn: (value: never) => Result<U, E>): Result<U, E>;
  
  /**
   * 映射錯誤
   * @param fn 映射函數
   */
  mapErr<F>(fn: (error: E) => F): Result<T, F>;
}

/**
 * 創建成功結果
 * 
 * @param value 成功值
 */
export function ok<T, E = Error>(value: T): Result<T, E> {
  return {
    success: true,
    value,
    
    isOk(): this is Success<T, E> {
      return true;
    },
    
    isErr(): false {
      return false;
    },
    
    unwrap(): T {
      return value;
    },
    
    unwrapOr<U>(_defaultValue: U): T {
      return value;
    },
    
    map<U>(fn: (value: T) => U): Result<U, E> {
      return ok(fn(value));
    },
    
    flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
      return fn(value);
    },
    
    mapErr<F>(_fn: (error: never) => F): Result<T, F> {
      return ok(value);
    }
  };
}

/**
 * 創建失敗結果
 * 
 * @param error 錯誤
 */
export function err<T = never, E = Error>(error: E): Result<T, E> {
  return {
    success: false,
    error,
    
    isOk(): false {
      return false;
    },
    
    isErr(): this is Failure<T, E> {
      return true;
    },
    
    unwrap(): never {
      throw error;
    },
    
    unwrapOr<U>(defaultValue: U): U {
      return defaultValue;
    },
    
    map<U>(_fn: (value: never) => U): Result<U, E> {
      return err(error);
    },
    
    flatMap<U>(_fn: (value: never) => Result<U, E>): Result<U, E> {
      return err(error);
    },
    
    mapErr<F>(fn: (error: E) => F): Result<T, F> {
      return err(fn(error));
    }
  };
}

/**
 * 嘗試捕獲函數執行中的異常，並將其轉換為 Result
 * 
 * @param fn 要執行的函數
 */
export function tryResult<T>(fn: () => T): Result<T, Error> {
  try {
    return ok(fn());
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 嘗試捕獲異步函數執行中的異常，並將其轉換為 Result
 * 
 * @param fn 要執行的異步函數
 */
export async function tryResultAsync<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * 將 Promise<Result<T, E>> 轉換為 Promise<T>，在錯誤情況下拋出異常
 * 
 * @param resultPromise Result Promise
 */
export async function unwrapAsync<T, E>(resultPromise: Promise<Result<T, E>>): Promise<T> {
  const result = await resultPromise;
  if (result.isOk()) {
    return result.value;
  } else {
    throw result.error;
  }
}

/**
 * 將 Promise<Result<T, E>> 轉換為 Promise<T>，在錯誤情況下返回默認值
 * 
 * @param resultPromise Result Promise
 * @param defaultValue 默認值
 */
export async function unwrapOrAsync<T, E, U>(resultPromise: Promise<Result<T, E>>, defaultValue: U): Promise<T | U> {
  const result = await resultPromise;
  if (result.isOk()) {
    return result.value;
  } else {
    return defaultValue;
  }
} 