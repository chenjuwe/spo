/**
 * 輸入數據驗證工具
 * 
 * 用於驗證使用者上傳的文件和其他輸入數據是否符合要求
 */

import { PhotoFile } from "./types";
import { ErrorType, ErrorSeverity, errorHandler } from "./errorHandlingService";

/**
 * 驗證錯誤類型
 */
export enum ValidationErrorType {
  // 文件類型錯誤
  INVALID_FILE_TYPE = 'INVALID_FILE_TYPE',
  
  // 文件大小錯誤
  INVALID_FILE_SIZE = 'INVALID_FILE_SIZE',
  
  // 圖像維度錯誤
  INVALID_DIMENSION = 'INVALID_DIMENSION',
  
  // 空文件
  EMPTY_FILE = 'EMPTY_FILE',
  
  // 已損壞的文件
  CORRUPTED_FILE = 'CORRUPTED_FILE',
  
  // 格式錯誤
  FORMAT_ERROR = 'FORMAT_ERROR',
  
  // 其他錯誤
  OTHER_ERROR = 'OTHER_ERROR'
}

/**
 * 驗證錯誤接口
 */
export interface ValidationError {
  /**
   * 錯誤類型
   */
  type: ValidationErrorType;
  
  /**
   * 錯誤消息
   */
  message: string;
  
  /**
   * 詳細信息
   */
  details?: string;
}

/**
 * 驗證選項
 */
export interface ValidationOptions {
  /**
   * 是否檢查尺寸
   */
  checkDimensions?: boolean;
  
  /**
   * 最小寬度 (像素)
   */
  minWidth?: number;
  
  /**
   * 最小高度 (像素)
   */
  minHeight?: number;
  
  /**
   * 最大文件大小 (位元組)
   */
  maxFileSize?: number;
  
  /**
   * 是否在錯誤時自動顯示通知
   */
  showErrorNotification?: boolean;
}

// 默認驗證選項
const DEFAULT_VALIDATION_OPTIONS: ValidationOptions = {
  checkDimensions: false,
  minWidth: 100,
  minHeight: 100,
  maxFileSize: 20 * 1024 * 1024, // 20MB
  showErrorNotification: false
};

/**
 * 驗證照片批次
 * 
 * @param photos 照片數組
 * @param options 驗證選項
 * @returns 有效照片和驗證錯誤
 */
export async function validatePhotoBatch(
  photos: PhotoFile[],
  options: ValidationOptions = {}
): Promise<{
  validPhotos: PhotoFile[];
  errors: Array<{photo: PhotoFile; error: ValidationError}>;
}> {
  // 合併選項
  const mergedOptions = { ...DEFAULT_VALIDATION_OPTIONS, ...options };
  const validPhotos: PhotoFile[] = [];
  const errors: Array<{photo: PhotoFile; error: ValidationError}> = [];
  
  // 使用 Promise.all 並行處理所有照片驗證
  const validationPromises = photos.map(async (photo) => {
    // 基本驗證
    const basicValidation = validatePhoto(photo, mergedOptions);
    
    if (!basicValidation.valid) {
      if (basicValidation.error) {
        // 添加到錯誤列表
        errors.push({
          photo,
          error: basicValidation.error
        });
        
        // 如果需要顯示錯誤通知
        if (mergedOptions.showErrorNotification) {
          errorHandler.handleError(
            new Error(basicValidation.error.message),
            mapValidationErrorToErrorType(basicValidation.error.type),
            basicValidation.error.details,
            false,
            undefined,
            ErrorSeverity.MEDIUM
          );
        }
      }
      return;
    }
    
    // 如果需要檢查尺寸
    if (mergedOptions.checkDimensions) {
      const dimensionValidation = await validatePhotoDimensions(
        photo,
        mergedOptions.minWidth,
        mergedOptions.minHeight
      );
      
      if (!dimensionValidation.valid) {
        if (dimensionValidation.error) {
          // 添加到錯誤列表
          errors.push({
            photo,
            error: dimensionValidation.error
          });
          
          // 如果需要顯示錯誤通知
          if (mergedOptions.showErrorNotification) {
            errorHandler.handleError(
              new Error(dimensionValidation.error.message),
              ErrorType.PHOTO_FORMAT_ERROR,
              dimensionValidation.error.details,
              false,
              undefined,
              ErrorSeverity.MEDIUM
            );
          }
        }
        return;
      }
    }
    
    // 如果通過所有驗證，添加到有效照片列表
    validPhotos.push(photo);
  });
  
  // 等待所有驗證完成
  await Promise.all(validationPromises);
  
  // 如果所有照片都無效且設置了顯示錯誤通知
  if (validPhotos.length === 0 && photos.length > 0 && mergedOptions.showErrorNotification) {
    errorHandler.handleError(
      new Error('沒有有效的照片可處理'),
      ErrorType.INPUT_ERROR,
      '請上傳有效的照片',
      true,
      undefined,
      ErrorSeverity.MEDIUM
    );
  }
  
  return { validPhotos, errors };
}

/**
 * 將驗證錯誤類型映射到錯誤處理服務的錯誤類型
 * 
 * @param validationType 驗證錯誤類型
 * @returns 對應的錯誤處理服務錯誤類型
 */
export function mapValidationErrorToErrorType(validationType: ValidationErrorType): ErrorType {
  switch (validationType) {
    case ValidationErrorType.INVALID_FILE_TYPE:
      return ErrorType.FILE_TYPE_ERROR;
    case ValidationErrorType.INVALID_FILE_SIZE:
      return ErrorType.PHOTO_FORMAT_ERROR;
    case ValidationErrorType.INVALID_DIMENSION:
      return ErrorType.PHOTO_FORMAT_ERROR;
    case ValidationErrorType.EMPTY_FILE:
      return ErrorType.PHOTO_LOADING_ERROR;
    case ValidationErrorType.CORRUPTED_FILE:
      return ErrorType.PHOTO_LOADING_ERROR;
    case ValidationErrorType.FORMAT_ERROR:
      return ErrorType.PHOTO_FORMAT_ERROR;
    case ValidationErrorType.OTHER_ERROR:
    default:
      return ErrorType.INPUT_ERROR;
  }
}

/**
 * 驗證單個照片
 * 
 * @param photo 照片
 * @param options 驗證選項
 * @returns 驗證結果
 */
export function validatePhoto(
  photo: PhotoFile,
  options: ValidationOptions = {}
): {
  valid: boolean;
  error?: ValidationError;
} {
  // 合併選項
  const mergedOptions = { ...DEFAULT_VALIDATION_OPTIONS, ...options };
  
  // 檢查文件是否存在
  if (!photo.file) {
    return {
      valid: false,
      error: {
        type: ValidationErrorType.EMPTY_FILE,
        message: '照片文件不存在',
        details: '無法處理不存在的文件'
      }
    };
  }
  
  // 檢查文件大小
  const maxSize = mergedOptions.maxFileSize || 20 * 1024 * 1024; // 20MB
  if (photo.file.size > maxSize) {
    return {
      valid: false,
      error: {
        type: ValidationErrorType.INVALID_FILE_SIZE,
        message: '照片文件過大',
        details: `文件大小超過上限 (${formatFileSize(maxSize)})`
      }
    };
  }
  
  // 檢查文件是否為空
  if (photo.file.size === 0) {
    return {
      valid: false,
      error: {
        type: ValidationErrorType.EMPTY_FILE,
        message: '照片文件為空',
        details: '無法處理空文件'
      }
    };
  }
  
  // 檢查文件類型
  // 基於 MIME 類型檢查
  const isValidMime = isValidImageType(photo.file.type);
  
  // 基於文件擴展名檢查 (對於 HEIC 和某些瀏覽器可能無法識別的文件)
  const isValidExtension = isValidImageExtension(photo.file.name);
  
  // 文件類型必須符合 MIME 類型或擴展名
  if (!isValidMime && !isValidExtension) {
    return {
      valid: false,
      error: {
        type: ValidationErrorType.INVALID_FILE_TYPE,
        message: '不支持的照片格式',
        details: `僅支持 JPEG、PNG、WebP、GIF、HEIC/HEIF 等常見格式，當前格式: ${photo.file.type || '未知'}, 擴展名: ${photo.file.name.split('.').pop() || '未知'}`
      }
    };
  }
  
  // 照片通過所有基本驗證
  return { valid: true };
}

/**
 * 驗證照片尺寸
 * 
 * @param photo 照片
 * @param minWidth 最小寬度
 * @param minHeight 最小高度
 * @returns Promise<驗證結果>
 */
export function validatePhotoDimensions(
  photo: PhotoFile,
  minWidth: number = 100,
  minHeight: number = 100
): Promise<{
  valid: boolean;
  error?: ValidationError;
  width?: number;
  height?: number;
}> {
  return new Promise((resolve) => {
    const img = new Image();
    
    img.onload = () => {
      const { width, height } = img;
      
      if (width < minWidth || height < minHeight) {
        resolve({
          valid: false,
          error: {
            type: ValidationErrorType.INVALID_DIMENSION,
            message: '照片尺寸太小',
            details: `照片必須至少 ${minWidth}x${minHeight} 像素，當前尺寸: ${width}x${height}`
          },
          width,
          height
        });
      } else {
        resolve({
          valid: true,
          width,
          height
        });
      }
    };
    
    img.onerror = () => {
      resolve({
        valid: false,
        error: {
          type: ValidationErrorType.CORRUPTED_FILE,
          message: '照片文件已損壞',
          details: '無法加載圖像數據'
        }
      });
    };
    
    img.src = photo.preview;
  });
}

/**
 * 檢查是否為有效的圖像文件類型
 * 
 * @param mimeType MIME 類型
 * @returns 是否為有效的圖像文件類型
 */
export function isValidImageType(mimeType: string): boolean {
  // 擴展支持的MIME類型列表
  const validTypes = [
    'image/jpeg', 
    'image/png', 
    'image/webp', 
    'image/gif', 
    'image/heic', 
    'image/heif',
    'image/bmp',
    'image/tiff'
  ];
  return validTypes.includes(mimeType);
}

/**
 * 檢查文件擴展名是否為有效的圖像格式
 * 
 * @param filename 文件名
 * @returns 是否為有效的圖像擴展名
 */
export function isValidImageExtension(filename: string): boolean {
  // 確保文件名存在
  if (!filename || typeof filename !== 'string') {
    return false;
  }
  
  // 獲取文件擴展名，處理沒有擴展名的情況
  const extensionMatch = filename.match(/\.([^.]+)$/);
  if (!extensionMatch) {
    return false;
  }
  
  const extension = extensionMatch[1].toLowerCase();
  // 擴展支持的文件擴展名
  const validExtensions = [
    'jpg', 'jpeg', 'png', 'webp', 'gif', 
    'heic', 'heif', 'bmp', 'tif', 'tiff'
  ];
  
  return validExtensions.includes(extension);
}

/**
 * 檢查是否為有效的文件大小
 * 
 * @param size 文件大小 (位元組)
 * @param maxSize 最大文件大小 (位元組，默認 20MB)
 * @returns 是否為有效的文件大小
 */
export function isValidFileSize(size: number, maxSize: number = 20 * 1024 * 1024): boolean {
  return size > 0 && size <= maxSize;
}

/**
 * 格式化文件大小
 * 
 * @param bytes 文件大小 (位元組)
 * @returns 格式化後的文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
} 