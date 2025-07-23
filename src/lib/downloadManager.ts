import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';
import { PhotoFile, SimilarityGroup, ProcessingOptions, OrganizationResult } from './types';
import { getOptimizedSettings } from './compatibilityChecker';

/**
 * 下載進度事件監聽器
 */
export interface DownloadProgressListener {
  onStart?: () => void;
  onProgress?: (current: number, total: number, percentage: number) => void;
  onChunkComplete?: (chunkIndex: number, totalChunks: number) => void;
  onComplete?: (result: OrganizationResult) => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
}

/**
 * 下載狀態
 */
export interface DownloadStatus {
  isDownloading: boolean;
  progress: number;
  currentChunk: number;
  totalChunks: number;
  startTime: Date | null;
  estimatedTimeRemaining: number | null;
  abortController: AbortController | null;
}

/**
 * 下載管理器類
 */
export class DownloadManager {
  private static instance: DownloadManager;
  private status: DownloadStatus = {
    isDownloading: false,
    progress: 0,
    currentChunk: 0,
    totalChunks: 0,
    startTime: null,
    estimatedTimeRemaining: null,
    abortController: null
  };
  private listeners: DownloadProgressListener[] = [];

  // 單例模式
  public static getInstance(): DownloadManager {
    if (!DownloadManager.instance) {
      DownloadManager.instance = new DownloadManager();
    }
    return DownloadManager.instance;
  }

  private constructor() {}

  /**
   * 添加事件監聽器
   */
  public addListener(listener: DownloadProgressListener): void {
    this.listeners.push(listener);
  }

  /**
   * 移除事件監聽器
   */
  public removeListener(listener: DownloadProgressListener): void {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * 取消下載
   */
  public cancelDownload(): void {
    if (this.status.abortController) {
      this.status.abortController.abort();
      this.status.abortController = null;
      this.status.isDownloading = false;
      
      toast.info("已取消下載");
      this.listeners.forEach(listener => listener.onCancel?.());
    }
  }

  /**
   * 獲取下載狀態
   */
  public getStatus(): DownloadStatus {
    return {...this.status};
  }

  /**
   * 下載整理後的檔案
   */
  public async downloadOrganizedFiles(
    photos: PhotoFile[],
    groups: SimilarityGroup[],
    options: ProcessingOptions = {}
  ): Promise<void> {
    // 已經在下載中，防止重複觸發
    if (this.status.isDownloading) {
      toast.error("已有下載任務正在進行中");
      return;
    }
    
    // 重置狀態
    this.status = {
      isDownloading: true,
      progress: 0,
      currentChunk: 0,
      totalChunks: 0,
      startTime: new Date(),
      estimatedTimeRemaining: null,
      abortController: new AbortController()
    };
    
    // 設備優化設置
    const { maxBatchSize } = getOptimizedSettings();
    const BATCH_SIZE = Math.min(maxBatchSize * 50, 200); // 每個壓縮包最多包含的照片數量
    
    // 通知開始下載
    this.listeners.forEach(listener => listener.onStart?.());
    
    try {
      // 計算總批次
      const totalPhotos = photos.length;
      const totalChunks = Math.ceil(totalPhotos / BATCH_SIZE);
      this.status.totalChunks = totalChunks;
      
      if (totalChunks > 1) {
        toast.info(`照片數量較多，將分成 ${totalChunks} 個壓縮檔以避免瀏覽器記憶體不足。請耐心等待所有檔案下載完成。`, 
          { duration: 8000 });
      }
      
      const result: OrganizationResult = {
        keptPhotos: [],
        deletedPhotos: [],
        renamedPhotos: []
      };
      
      // 分批處理
      for (let i = 0; i < totalPhotos; i += BATCH_SIZE) {
        // 檢查是否已取消
        if (this.status.abortController?.signal.aborted) {
          throw new DOMException('下載已取消', 'AbortError');
        }
        
        this.status.currentChunk = Math.floor(i / BATCH_SIZE) + 1;
        
        // 切分批次
        const batchPhotos = photos.slice(i, i + BATCH_SIZE);
        
        // 只取屬於 batchPhotos 的分組
        const batchGroups = groups.filter(g => 
          g.photos.some(pid => batchPhotos.some(p => p.id === pid))
        );
        
        // 生成壓縮檔
        const { zipBlob, chunkResult } = await this.organizeAndPackageFiles(
          batchPhotos, 
          batchGroups, 
          options,
          (progress) => {
            // 計算總體進度
            const chunkProgress = progress / 100;
            const overallProgress = (((this.status.currentChunk - 1) + chunkProgress) / totalChunks) * 100;
            this.status.progress = Math.round(overallProgress);
            
            // 更新剩餘時間估計
            if (this.status.startTime) {
              const elapsedMs = new Date().getTime() - this.status.startTime.getTime();
              const estimatedTotalMs = (elapsedMs / (this.status.progress / 100));
              this.status.estimatedTimeRemaining = Math.max(0, estimatedTotalMs - elapsedMs);
            }
            
            // 通知監聽器
            this.listeners.forEach(listener => 
              listener.onProgress?.(this.status.currentChunk, totalChunks, this.status.progress)
            );
          }
        );
        
        // 合併結果
        result.keptPhotos.push(...chunkResult.keptPhotos);
        result.deletedPhotos.push(...chunkResult.deletedPhotos);
        result.renamedPhotos.push(...chunkResult.renamedPhotos);
        
        // 下載檔案
        const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
        const fileName = totalChunks > 1 
          ? `organized_photos_${timestamp}_part${this.status.currentChunk}.zip`
          : `organized_photos_${timestamp}.zip`;
          
        saveAs(zipBlob, fileName);
        
        // 通知分塊完成
        this.listeners.forEach(listener => 
          listener.onChunkComplete?.(this.status.currentChunk, totalChunks)
        );
        
        // 添加延遲，讓瀏覽器有時間進行垃圾回收
        if (totalChunks > 1 && this.status.currentChunk < totalChunks) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // 完成所有下載
      toast.success(`所有檔案已成功準備下載！共處理 ${photos.length} 張照片，${totalChunks} 個壓縮檔。`);
      this.status.isDownloading = false;
      
      // 通知完成
      this.listeners.forEach(listener => listener.onComplete?.(result));
      
    } catch (error) {
      // 處理錯誤
      if (error instanceof DOMException && error.name === 'AbortError') {
        // 已通過 cancelDownload 處理
        return;
      }
      
      console.error("下載檔案時發生錯誤:", error);
      toast.error("下載檔案時發生錯誤，請重試");
      this.status.isDownloading = false;
      
      // 通知錯誤
      const typedError = error instanceof Error ? error : new Error(String(error));
      this.listeners.forEach(listener => listener.onError?.(typedError));
    } finally {
      this.status.abortController = null;
    }
  }

  /**
   * 生成組織後的壓縮檔
   */
  private async organizeAndPackageFiles(
    photos: PhotoFile[],
    groups: SimilarityGroup[],
    options: ProcessingOptions = {},
    onProgress?: (progress: number) => void
  ): Promise<{zipBlob: Blob, chunkResult: OrganizationResult}> {
    const zip = new JSZip();
    const result: OrganizationResult = {
      keptPhotos: [],
      deletedPhotos: [],
      renamedPhotos: []
    };
    
    // 創建資料夾結構
    const keptFolder = zip.folder("organized_photos");
    const deletedFolder = zip.folder("deleted_duplicates");
    
    let fileIndex = 1;
    const totalSteps = groups.length + 1; // +1 for ungrouped photos
    let currentStep = 0;
    
    // 處理每個分組
    for (const group of groups) {
      // 檢查是否已取消
      if (this.status.abortController?.signal.aborted) {
        throw new DOMException('下載已取消', 'AbortError');
      }
      
      const groupPhotos = photos.filter(p => group.photos.includes(p.id));
      const bestPhotoId = group.bestPhoto;
      
      for (const photo of groupPhotos) {
        if (photo.id === bestPhotoId) {
          // 保留最佳照片
          let fileName = photo.file.name;
          let fileBlob: Blob = photo.file;
          
          // 重新命名
          if (options.autoRename) {
            fileName = this.generateStandardFileName(photo.file, fileIndex++);
            result.renamedPhotos.push({
              original: photo.file.name,
              newName: fileName
            });
          }
          
          // 調整大小
          if (options.maxDimension && options.maxDimension < 4000) {
            fileBlob = await this.resizeImage(photo.file, options.maxDimension);
          }
          
          // 品質優化
          if (options.optimizeQuality) {
            const quality = photo.quality;
            const adjustments: any = {};
            
            if (quality) {
              // 根據品質分析調整參數
              if (quality.brightness < 40) adjustments.brightness = 20;
              if (quality.brightness > 80) adjustments.brightness = -10;
              if (quality.contrast < 30) adjustments.contrast = 15;
              if (quality.sharpness < 50) adjustments.sharpness = 25;
            }
            
            if (Object.keys(adjustments).length > 0) {
              fileBlob = await this.optimizeImageQuality(photo.file, adjustments);
            }
          }
          
          // 保持原始資料夾結構
          const originalPath = photo.path || '';
          const folderPath = originalPath.split('/').slice(0, -1).join('/');
          
          if (folderPath && keptFolder) {
            const subFolder = keptFolder.folder(folderPath);
            subFolder?.file(fileName, fileBlob);
          } else {
            keptFolder?.file(fileName, fileBlob);
          }
          
          result.keptPhotos.push(photo);
        } else {
          // 移到刪除資料夾
          if (options.preserveOriginal) {
            const deletedFileName = `duplicate_${photo.file.name}`;
            const originalPath = photo.path || '';
            const folderPath = originalPath.split('/').slice(0, -1).join('/');
            
            if (folderPath && deletedFolder) {
              const subFolder = deletedFolder.folder(folderPath);
              subFolder?.file(deletedFileName, photo.file);
            } else {
              deletedFolder?.file(deletedFileName, photo.file);
            }
          }
          
          result.deletedPhotos.push(photo);
        }
      }
      
      currentStep++;
      if (onProgress) {
        const halfProgress = 50 * (currentStep / totalSteps);
        onProgress(halfProgress);
      }
    }
    
    // 處理沒有分組的照片（單獨照片）
    const ungroupedPhotos = photos.filter(photo => 
      !groups.some(group => group.photos.includes(photo.id))
    );
    
    for (const photo of ungroupedPhotos) {
      // 檢查是否已取消
      if (this.status.abortController?.signal.aborted) {
        throw new DOMException('下載已取消', 'AbortError');
      }
      
      let fileName = photo.file.name;
      let fileBlob: Blob = photo.file;
      
      if (options.autoRename) {
        fileName = this.generateStandardFileName(photo.file, fileIndex++);
        result.renamedPhotos.push({
          original: photo.file.name,
          newName: fileName
        });
      }
      
      if (options.maxDimension && options.maxDimension < 4000) {
        fileBlob = await this.resizeImage(photo.file, options.maxDimension);
      }
      
      if (options.optimizeQuality && photo.quality) {
        const adjustments: any = {};
        const quality = photo.quality;
        
        if (quality.brightness < 40) adjustments.brightness = 20;
        if (quality.brightness > 80) adjustments.brightness = -10;
        if (quality.contrast < 30) adjustments.contrast = 15;
        if (quality.sharpness < 50) adjustments.sharpness = 25;
        
        if (Object.keys(adjustments).length > 0) {
          fileBlob = await this.optimizeImageQuality(photo.file, adjustments);
        }
      }
      
      const originalPath = photo.path || '';
      const folderPath = originalPath.split('/').slice(0, -1).join('/');
      
      if (folderPath && keptFolder) {
        const subFolder = keptFolder.folder(folderPath);
        subFolder?.file(fileName, fileBlob);
      } else {
        keptFolder?.file(fileName, fileBlob);
      }
      
      result.keptPhotos.push(photo);
    }
    
    currentStep++;
    if (onProgress) {
      const halfProgress = 50 * (currentStep / totalSteps);
      onProgress(halfProgress);
    }
    
    // 添加處理報告
    const report = {
      summary: {
        totalPhotos: photos.length,
        keptPhotos: result.keptPhotos.length,
        deletedPhotos: result.deletedPhotos.length,
        duplicateGroups: groups.length
      },
      groups: groups.map(group => ({
        id: group.id,
        photoCount: group.photos.length,
        bestPhoto: result.keptPhotos.find(p => p.id === group.bestPhoto)?.file.name || 'Unknown'
      })),
      renamedFiles: result.renamedPhotos,
      processedAt: new Date().toISOString(),
      processingOptions: options
    };
    
    zip.file("organization_report.json", JSON.stringify(report, null, 2));
    
    // 生成壓縮檔
    const zipBlob = await zip.generateAsync({ 
      type: "blob", 
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
      onUpdate: (metadata) => {
        // 在 0-50% 我們處理檔案添加，在 50-100% 處理壓縮
        if (onProgress) {
          const zipProgress = (metadata.percent || 0) / 2; // 0-50%
          onProgress(50 + zipProgress); // 50-100%
        }
      }
    });
    
    return { zipBlob, chunkResult: result };
  }
  
  /**
   * 生成標準化檔名
   */
  private generateStandardFileName(
    originalFile: File,
    index: number,
    timestamp?: Date
  ): string {
    const date = timestamp || new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    const ext = originalFile.name.split('.').pop() || 'jpg';
    return `IMG_${year}${month}${day}_${String(index).padStart(4, '0')}.${ext}`;
  }
  
  /**
   * 調整圖片大小
   */
  private resizeImage(
    file: File,
    maxDimension: number,
    quality = 0.9
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          throw new Error('無法獲取畫布上下文');
        }
        
        const img = new Image();
        img.onerror = () => reject(new Error('圖片載入失敗'));
        
        img.onload = () => {
          // 計算新尺寸
          let { width, height } = img;
          
          if (width > height && width > maxDimension) {
            height = (height * maxDimension) / width;
            width = maxDimension;
          } else if (height > maxDimension) {
            width = (width * maxDimension) / height;
            height = maxDimension;
          }
          
          // 調整畫布大小
          canvas.width = Math.round(width);
          canvas.height = Math.round(height);
          
          // 繪製圖片
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          
          // 轉換為Blob
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('圖片轉換失敗'));
              }
            },
            file.type,
            quality
          );
          
          // 釋放記憶體
          URL.revokeObjectURL(img.src);
        };
        
        img.src = URL.createObjectURL(file);
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 優化圖片品質
   */
  private optimizeImageQuality(
    file: File,
    adjustments: {
      brightness?: number;
      contrast?: number;
      sharpness?: number;
    } = {}
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          throw new Error('無法獲取畫布上下文');
        }
        
        const img = new Image();
        img.onerror = () => reject(new Error('圖片載入失敗'));
        
        img.onload = () => {
          // 設置畫布大小
          canvas.width = img.width;
          canvas.height = img.height;
          
          // 應用濾鏡
          const brightness = adjustments.brightness || 0;
          const contrast = adjustments.contrast || 0;
          
          ctx.filter = `brightness(${100 + brightness}%) contrast(${100 + contrast}%)`;
          ctx.drawImage(img, 0, 0);
          
          // 如果需要銳化，應用邊緣增強
          if (adjustments.sharpness && adjustments.sharpness > 0) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const sharpened = this.applySharpenFilter(imageData, adjustments.sharpness / 100);
            ctx.putImageData(sharpened, 0, 0);
          }
          
          // 轉換為Blob
          canvas.toBlob(
            (blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('圖片轉換失敗'));
              }
            },
            file.type,
            0.95
          );
          
          // 釋放記憶體
          URL.revokeObjectURL(img.src);
        };
        
        img.src = URL.createObjectURL(file);
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * 應用銳化濾鏡
   */
  private applySharpenFilter(imageData: ImageData, amount: number): ImageData {
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const output = new ImageData(width, height);
    
    // 銳化卷積核
    const kernel = [
      0, -amount, 0,
      -amount, 1 + 4 * amount, -amount,
      0, -amount, 0
    ];
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              const kidx = ((y + ky) * width + (x + kx)) * 4 + c;
              const kernelIdx = (ky + 1) * 3 + (kx + 1);
              sum += data[kidx] * kernel[kernelIdx];
            }
          }
          
          output.data[idx + c] = Math.max(0, Math.min(255, sum));
        }
        
        output.data[idx + 3] = data[idx + 3]; // Alpha通道
      }
    }
    
    return output;
  }
}

// 導出單例實例
export const downloadManager = DownloadManager.getInstance();

// 便捷下載函數
export async function downloadOrganizedFiles(
  photos: PhotoFile[],
  groups: SimilarityGroup[],
  options: ProcessingOptions = {}
): Promise<void> {
  return downloadManager.downloadOrganizedFiles(photos, groups, options);
} 