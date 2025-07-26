/**
 * 增強的 HEIC 轉換處理器
 * 支援大檔案分段處理、記憶體優化和進度報告
 */

import heic2any from "heic2any";
import { heicToJpegWasm } from "./enhancedWasm";
import { toast } from "sonner";

// 轉換選項
export interface HeicConversionOptions {
  quality?: number;      // JPEG 品質 (0-100)
  maxWidth?: number;     // 最大寬度
  maxHeight?: number;    // 最大高度
  preserveMetadata?: boolean; // 是否保留元數據 (EXIF 等)
  onProgress?: (progress: number) => void; // 進度回調
  signal?: AbortSignal;  // 取消信號
  useWasm?: boolean;     // 是否使用 WASM 加速
  chunkSize?: number;    // 分塊大小 (bytes)
}

// 轉換結果
export interface ConversionResult {
  file: File;
  width: number;
  height: number;
  originalSize: number;
  convertedSize: number;
  compressionRatio: number;
  processingTime: number;
}

/**
 * 檢查文件是否為 HEIC 格式
 * @param file 要檢查的文件
 * @returns 是否為 HEIC 格式
 */
export function isHeicFile(file: File): boolean {
  return (
    file.type === "image/heic" || 
    file.type === "image/heif" ||
    file.name.toLowerCase().endsWith(".heic") || 
    file.name.toLowerCase().endsWith(".heif")
  );
}

/**
 * 分塊讀取大文件
 * @param file 文件
 * @param chunkSize 分塊大小
 * @param onProgress 進度回調
 * @param signal 取消信號
 * @returns 完整的 ArrayBuffer
 */
async function readFileInChunks(
  file: File,
  chunkSize: number = 2 * 1024 * 1024, // 2MB chunks
  onProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    const fileSize = file.size;
    const chunks: ArrayBuffer[] = [];
    let offset = 0;
    
    // 處理取消
    if (signal) {
      signal.addEventListener('abort', () => {
        fileReader.abort();
        reject(new DOMException('讀取操作已取消', 'AbortError'));
      });
    }
    
    // 讀取下一個分塊
    const readNextChunk = () => {
      // 已完成或已取消
      if (signal?.aborted) {
        reject(new DOMException('讀取操作已取消', 'AbortError'));
        return;
      }
      
      if (offset >= fileSize) {
        // 所有分塊讀取完成，合併結果
        const result = new Uint8Array(fileSize);
        let position = 0;
        
        for (const chunk of chunks) {
          result.set(new Uint8Array(chunk), position);
          position += chunk.byteLength;
        }
        
        resolve(result.buffer);
        return;
      }
      
      // 計算當前分塊大小
      const currentChunkSize = Math.min(chunkSize, fileSize - offset);
      
      // 創建分塊
      const chunk = file.slice(offset, offset + currentChunkSize);
      
      // 讀取分塊
      fileReader.readAsArrayBuffer(chunk);
      
      // 更新偏移量
      offset += currentChunkSize;
      
      // 報告進度
      if (onProgress) {
        onProgress(Math.round((offset / fileSize) * 50)); // 最多到 50%（讀取階段）
      }
    };
    
    // 分塊讀取完成
    fileReader.onload = (e) => {
      if (e.target?.result) {
        chunks.push(e.target.result as ArrayBuffer);
        readNextChunk();
      }
    };
    
    // 錯誤處理
    fileReader.onerror = () => {
      reject(new Error('讀取文件時發生錯誤'));
    };
    
    // 開始讀取
    readNextChunk();
  });
}

/**
 * 使用原生 JS 實現進行 HEIC 轉換
 * @param buffer HEIC 文件的 ArrayBuffer
 * @param options 轉換選項
 * @returns 轉換後的 Blob
 */
async function convertWithHeic2any(
  buffer: ArrayBuffer,
  options: HeicConversionOptions
): Promise<Blob> {
  const heic2anyOptions: any = {
    blob: new Blob([buffer], { type: 'image/heic' }),
    toType: 'image/jpeg',
    quality: options.quality ? options.quality / 100 : 0.92
  };
  
  // 設置最大尺寸（如果有）
  if (options.maxWidth || options.maxHeight) {
    heic2anyOptions.maxWidth = options.maxWidth;
    heic2anyOptions.maxHeight = options.maxHeight;
  }
  
  // 轉換
  const result = await heic2any(heic2anyOptions);
  
  // 處理陣列或單一 blob
  return Array.isArray(result) ? result[0] : result;
}

/**
 * 增強的 HEIC 轉 JPEG 轉換器
 * @param file 要轉換的 HEIC 文件
 * @param options 轉換選項
 * @returns 轉換結果
 */
export async function convertHeicToJpegEnhanced(
  file: File,
  options: HeicConversionOptions = {}
): Promise<ConversionResult> {
  // 如果不是 HEIC 文件，直接返回原始文件
  if (!isHeicFile(file)) {
    throw new Error('不是 HEIC 格式文件');
  }
  
  const startTime = performance.now();
  const originalSize = file.size;
  
  try {
    // 默認選項
    const finalOptions = {
      quality: 92,
      maxWidth: 0,
      maxHeight: 0,
      preserveMetadata: true,
      chunkSize: 2 * 1024 * 1024, // 2MB 分塊
      useWasm: true,
      ...options
    };
    
    // 是否使用 WASM 加速
    const useWasm = finalOptions.useWasm && originalSize < 20 * 1024 * 1024; // < 20MB
    
    // 讀取文件
    const buffer = await readFileInChunks(
      file,
      finalOptions.chunkSize,
      finalOptions.onProgress,
      finalOptions.signal
    );
    
    // 檢查取消
    if (finalOptions.signal?.aborted) {
      throw new DOMException('操作已取消', 'AbortError');
    }
    
    // 轉換 HEIC 到 JPEG
    let jpegBlob: Blob | null = null;
    
    // 嘗試使用 WASM 轉換
    if (useWasm) {
      try {
        const jpegBuffer = await heicToJpegWasm(buffer, finalOptions.quality);
        
        if (jpegBuffer) {
          jpegBlob = new Blob([jpegBuffer], { type: 'image/jpeg' });
          
          if (finalOptions.onProgress) {
            finalOptions.onProgress(90); // 轉換完成 90%
          }
        }
      } catch (error) {
        console.warn('WASM HEIC 轉換失敗，降級到 JS 實現:', error);
        jpegBlob = null;
      }
    }
    
    // 如果 WASM 轉換失敗，使用 JS 實現
    if (!jpegBlob) {
      jpegBlob = await convertWithHeic2any(buffer, finalOptions);
      
      if (finalOptions.onProgress) {
        finalOptions.onProgress(90); // 轉換完成 90%
      }
    }
    
    // 取得檔案名稱
    const newFileName = file.name.replace(/\.(heic|heif)$/i, ".jpg");
    
    // 建立檔案
    const jpegFile = new File(
      [jpegBlob],
      newFileName,
      { type: "image/jpeg", lastModified: file.lastModified }
    );
    
    // 獲取圖像尺寸
    const imageDimensions = await getImageDimensions(jpegBlob);
    
    if (finalOptions.onProgress) {
      finalOptions.onProgress(100); // 完成
    }
    
    // 計算處理時間和壓縮率
    const processingTime = performance.now() - startTime;
    const convertedSize = jpegFile.size;
    const compressionRatio = originalSize / convertedSize;
    
    return {
      file: jpegFile,
      width: imageDimensions.width,
      height: imageDimensions.height,
      originalSize,
      convertedSize,
      compressionRatio,
      processingTime
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    
    const errorMessage = `HEIC 轉換失敗: ${file.name}`;
    console.error(errorMessage, error);
    toast.error(errorMessage);
    throw new Error(errorMessage);
  }
}

/**
 * 獲取圖像尺寸
 * @param blob 圖像 Blob
 * @returns 圖像尺寸
 */
async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.width,
        height: img.height
      });
      URL.revokeObjectURL(img.src); // 釋放資源
    };
    img.onerror = () => {
      reject(new Error('無法獲取圖像尺寸'));
      URL.revokeObjectURL(img.src); // 釋放資源
    };
    img.src = URL.createObjectURL(blob);
  });
}

/**
 * 批量轉換多個 HEIC 文件
 * @param files 要轉換的文件陣列
 * @param options 轉換選項
 * @returns 轉換結果陣列
 */
export async function batchConvertHeicFiles(
  files: File[],
  options: HeicConversionOptions = {}
): Promise<Array<ConversionResult | null>> {
  // 過濾出 HEIC 文件
  const heicFiles = files.filter(isHeicFile);
  
  if (heicFiles.length === 0) {
    return [];
  }
  
  // 結果陣列
  const results: Array<ConversionResult | null> = new Array(heicFiles.length).fill(null);
  
  // 限制並行轉換數量
  const maxConcurrent = Math.min(
    navigator.hardwareConcurrency ? navigator.hardwareConcurrency - 1 : 2,
    4 // 最多 4 個並行轉換
  );
  
  // 當前處理索引
  let currentIndex = 0;
  
  // 創建進度報告函數
  const createProgressHandler = (index: number) => {
    return (progress: number) => {
      if (options.onProgress) {
        // 計算總進度
        const individualProgress = results.map((r, i) => {
          if (r) return 100; // 已完成的文件
          if (i === index) return progress; // 當前處理的文件
          return i < currentIndex ? 0 : 0; // 其他文件
        });
        
        // 計算平均進度
        const totalProgress = Math.round(
          individualProgress.reduce((sum, p) => sum + p, 0) / heicFiles.length
        );
        
        options.onProgress(totalProgress);
      }
    };
  };
  
  // 處理任務函數
  const processFile = async (index: number): Promise<void> => {
    const file = heicFiles[index];
    
    // 檢查取消
    if (options.signal?.aborted) {
      return;
    }
    
    try {
      // 轉換文件
      const result = await convertHeicToJpegEnhanced(file, {
        ...options,
        onProgress: createProgressHandler(index)
      });
      
      // 存儲結果
      results[index] = result;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        // 轉發取消錯誤
        throw error;
      }
      
      console.error(`轉換文件失敗: ${file.name}`, error);
      results[index] = null;
    }
  };
  
  // 創建初始任務
  const activeTasks: Promise<void>[] = [];
  const startNext = () => {
    if (currentIndex >= heicFiles.length || options.signal?.aborted) {
      return null;
    }
    
    const index = currentIndex++;
    return processFile(index).then(() => {
      // 任務完成後，嘗試啟動下一個
      const nextTask = startNext();
      if (nextTask) {
        activeTasks.push(nextTask);
      }
    });
  };
  
  // 啟動初始並行任務
  for (let i = 0; i < Math.min(maxConcurrent, heicFiles.length); i++) {
    const task = startNext();
    if (task) {
      activeTasks.push(task);
    }
  }
  
  // 等待所有任務完成
  await Promise.all(activeTasks);
  
  return results;
}

// 導出默認函數
export default {
  convertHeicToJpegEnhanced,
  batchConvertHeicFiles,
  isHeicFile
}; 