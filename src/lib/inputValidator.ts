/**
 * 輸入驗證模塊
 * 
 * 提供嚴格的輸入驗證功能，確保用戶提供的數據安全可靠
 * 
 * @module inputValidator
 */

import { PhotoFile } from './types';
import { Result, ok, err } from './result';

/**
 * 支持的圖片MIME類型
 */
export const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg', 
  'image/png', 
  'image/gif', 
  'image/webp', 
  'image/heic', 
  'image/heif'
];

/**
 * 檔案大小限制 (20MB)
 */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * 驗證錯誤類型
 */
export enum ValidationErrorType {
  INVALID_TYPE = 'INVALID_TYPE',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  EMPTY_FILE = 'EMPTY_FILE',
  CORRUPTED_FILE = 'CORRUPTED_FILE',
  INVALID_FORMAT = 'INVALID_FORMAT',
  OTHER = 'OTHER'
}

/**
 * 驗證錯誤
 */
export class ValidationError extends Error {
  /**
   * 錯誤類型
   */
  public type: ValidationErrorType;
  
  /**
   * 詳細信息
   */
  public details?: Record<string, any>;
  
  /**
   * 創建驗證錯誤
   * 
   * @param type 錯誤類型
   * @param message 錯誤消息
   * @param details 詳細信息
   */
  constructor(type: ValidationErrorType, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'ValidationError';
    this.type = type;
    this.details = details;
  }
}

/**
 * 驗證單個文件
 * 
 * @param file 文件對象
 * @returns 驗證結果
 */
export function validateFile(file: File): Result<File, ValidationError> {
  try {
    // 驗證文件類型
    if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
      return err(
        new ValidationError(
          ValidationErrorType.INVALID_TYPE,
          `不支持的文件類型: ${file.type}`,
          { fileType: file.type, supportedTypes: SUPPORTED_IMAGE_TYPES }
        )
      );
    }
    
    // 驗證文件大小
    if (file.size > MAX_FILE_SIZE) {
      return err(
        new ValidationError(
          ValidationErrorType.FILE_TOO_LARGE,
          `文件過大: ${(file.size / (1024 * 1024)).toFixed(2)}MB (最大限制: ${MAX_FILE_SIZE / (1024 * 1024)}MB)`,
          { fileSize: file.size, maxSize: MAX_FILE_SIZE }
        )
      );
    }
    
    // 驗證文件不為空
    if (file.size === 0) {
      return err(
        new ValidationError(
          ValidationErrorType.EMPTY_FILE,
          `文件為空: ${file.name}`,
          { fileName: file.name }
        )
      );
    }
    
    return ok(file);
  } catch (error) {
    return err(
      new ValidationError(
        ValidationErrorType.OTHER,
        `驗證文件時發生錯誤: ${error instanceof Error ? error.message : String(error)}`,
        { fileName: file.name, originalError: error }
      )
    );
  }
}

/**
 * 驗證照片文件
 * 
 * @param photo 照片文件對象
 * @returns 驗證結果
 */
export function validatePhotoFile(photo: PhotoFile): Result<PhotoFile, ValidationError> {
  try {
    // 驗證基本屬性
    if (!photo.id) {
      return err(
        new ValidationError(
          ValidationErrorType.INVALID_FORMAT,
          '照片缺少ID',
          { photo }
        )
      );
    }
    
    if (!photo.file) {
      return err(
        new ValidationError(
          ValidationErrorType.INVALID_FORMAT,
          '照片缺少文件數據',
          { photoId: photo.id }
        )
      );
    }
    
    if (!photo.preview) {
      return err(
        new ValidationError(
          ValidationErrorType.INVALID_FORMAT,
          '照片缺少預覽圖',
          { photoId: photo.id }
        )
      );
    }
    
    // 驗證文件
    const fileResult = validateFile(photo.file);
    if (fileResult.isErr()) {
      return fileResult.mapErr(error => {
        error.details = { ...error.details, photoId: photo.id };
        return error;
      });
    }
    
    return ok(photo);
  } catch (error) {
    return err(
      new ValidationError(
        ValidationErrorType.OTHER,
        `驗證照片時發生錯誤: ${error instanceof Error ? error.message : String(error)}`,
        { photoId: photo.id, originalError: error }
      )
    );
  }
}

/**
 * 批量驗證照片文件
 * 
 * @param photos 照片文件數組
 * @returns 驗證結果，包含有效照片和錯誤信息
 */
export function validatePhotoBatch(
  photos: PhotoFile[]
): { validPhotos: PhotoFile[], errors: Array<{ photo: PhotoFile, error: ValidationError }> } {
  const validPhotos: PhotoFile[] = [];
  const errors: Array<{ photo: PhotoFile, error: ValidationError }> = [];
  
  for (const photo of photos) {
    const result = validatePhotoFile(photo);
    
    if (result.isOk()) {
      validPhotos.push(photo);
    } else {
      errors.push({
        photo,
        error: result.error
      });
    }
  }
  
  return { validPhotos, errors };
}

/**
 * 驗證圖像數據
 * 
 * @param imageData 圖像數據
 * @returns 驗證結果
 */
export function validateImageData(imageData: ImageData): Result<ImageData, ValidationError> {
  try {
    // 驗證尺寸
    if (imageData.width <= 0 || imageData.height <= 0) {
      return err(
        new ValidationError(
          ValidationErrorType.INVALID_FORMAT,
          `無效的圖像尺寸: ${imageData.width}x${imageData.height}`,
          { width: imageData.width, height: imageData.height }
        )
      );
    }
    
    // 驗證數據
    if (!imageData.data || imageData.data.length !== imageData.width * imageData.height * 4) {
      return err(
        new ValidationError(
          ValidationErrorType.CORRUPTED_FILE,
          '圖像數據不完整',
          { 
            dataLength: imageData.data?.length,
            expectedLength: imageData.width * imageData.height * 4 
          }
        )
      );
    }
    
    return ok(imageData);
  } catch (error) {
    return err(
      new ValidationError(
        ValidationErrorType.OTHER,
        `驗證圖像數據時發生錯誤: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }
}

/**
 * 從 URL 加載並驗證圖像
 * 
 * @param url 圖像URL
 * @returns 驗證結果，包含圖像數據
 */
export async function loadAndValidateImage(url: string): Promise<Result<ImageData, ValidationError>> {
  try {
    // 創建圖像對象
    const img = new Image();
    
    // 等待圖像加載
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    
    // 繪製到 Canvas
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return err(
        new ValidationError(
          ValidationErrorType.OTHER,
          '無法創建 Canvas 上下文'
        )
      );
    }
    
    ctx.drawImage(img, 0, 0);
    
    // 獲取圖像數據
    const imageData = ctx.getImageData(0, 0, img.width, img.height);
    
    // 驗證圖像數據
    return validateImageData(imageData);
  } catch (error) {
    return err(
      new ValidationError(
        ValidationErrorType.OTHER,
        `加載圖像失敗: ${error instanceof Error ? error.message : String(error)}`,
        { url }
      )
    );
  }
} 