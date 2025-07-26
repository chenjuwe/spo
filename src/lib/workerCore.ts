/**
 * Worker 核心模組 - 包含所有 Worker 共用的分析函數
 * 設計為可在 Web Worker 或主線程中使用
 */
import { 
  ImageQuality, 
  HashResult, 
  HashType 
} from './types';

// 使用 OffscreenCanvas 和 createImageBitmap 替代 DOM 的 Image
// 檢查是否在 Worker 上下文中
const isInWorker = typeof self !== 'undefined' && typeof document === 'undefined';

// 支持多種輸入類型 - File、URL或包含文件URL的對象
type ImageSource = File | string | { 
  fileUrl: string; 
  fileName?: string; 
  fileType?: string; 
  fileSize?: number;
  useFileUrl: boolean;
};

/**
 * 在 Worker 或主線程環境中載入並處理圖片
 * @param source 圖片來源 (File, URL字符串或包含URL的對象)
 * @param width 輸出畫布寬度
 * @param height 輸出畫布高度
 * @param timeout 超時時間 (毫秒)
 * @returns 帶有圖片數據的畫布上下文
 */
function loadImageToCanvas(
  source: ImageSource, 
  width: number, 
  height: number, 
  timeoutMs = 15000
): Promise<{ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number}> {
  return new Promise((resolve, reject) => {
    // 創建超時計時器
    const timeoutId = setTimeout(() => {
      reject(new Error('圖片載入超時'));
    }, timeoutMs);
    
    // 提取圖片 URL
    let imageUrl: string | null = null;
    let shouldRevokeUrl = false;
    let sourceIsFile = false;
    
    try {
      if (typeof source === 'string') {
        // 直接使用提供的 URL
        imageUrl = source;
      } else if (source instanceof File) {
        // 從 File 對象創建 URL
        imageUrl = URL.createObjectURL(source);
        shouldRevokeUrl = true;
        sourceIsFile = true;
      } else if (source && typeof source === 'object' && 'fileUrl' in source && source.useFileUrl) {
        // 使用提供的文件 URL
        imageUrl = source.fileUrl;
      } else {
        throw new Error('不支持的圖片源類型');
      }
      
      // 根據環境創建適當的 Canvas
      let canvas: HTMLCanvasElement | OffscreenCanvas;
      
      if (isInWorker) {
        // Worker 環境使用 OffscreenCanvas
        if (typeof OffscreenCanvas === 'undefined') {
          clearTimeout(timeoutId);
          if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
          reject(new Error('此瀏覽器不支援 OffscreenCanvas'));
          return;
        }
        
        canvas = new OffscreenCanvas(width || 1, height || 1);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          clearTimeout(timeoutId);
          if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
          reject(new Error('無法獲取畫布上下文'));
          return;
        }
        
        // 在 Worker 中處理圖片
        if (sourceIsFile && source instanceof File) {
          // 對於文件，使用 createImageBitmap
          createImageBitmap(source)
            .then(bitmap => {
              clearTimeout(timeoutId);
              
              try {
                // 獲取實際尺寸
                const actualWidth = width || bitmap.width;
                const actualHeight = height || bitmap.height;
                
                // 重新設置畫布尺寸
                if (!width || !height) {
                  canvas.width = actualWidth;
                  canvas.height = actualHeight;
                }
                
                // 繪製到畫布
                ctx.drawImage(bitmap, 0, 0, actualWidth, actualHeight);
                
                // 釋放 bitmap 資源
                bitmap.close();
                
                if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
                resolve({ ctx, width: actualWidth, height: actualHeight });
              } catch (err) {
                if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
                reject(new Error('繪製圖片失敗: ' + (err instanceof Error ? err.message : String(err))));
              }
            })
            .catch(err => {
              clearTimeout(timeoutId);
              if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
              reject(new Error('處理圖片失敗: ' + (err instanceof Error ? err.message : String(err))));
            });
        } else if (imageUrl) {
          // 對於 URL，使用 fetch 和 createImageBitmap
          fetch(imageUrl)
            .then(response => response.blob())
            .then(blob => createImageBitmap(blob))
            .then(bitmap => {
              clearTimeout(timeoutId);
              
              try {
                // 獲取實際尺寸
                const actualWidth = width || bitmap.width;
                const actualHeight = height || bitmap.height;
                
                // 重新設置畫布尺寸
                if (!width || !height) {
                  canvas.width = actualWidth;
                  canvas.height = actualHeight;
                }
                
                // 繪製到畫布
                ctx.drawImage(bitmap, 0, 0, actualWidth, actualHeight);
                
                // 釋放 bitmap 資源
                bitmap.close();
                
                if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
                resolve({ ctx, width: actualWidth, height: actualHeight });
              } catch (err) {
                if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
                reject(new Error('繪製圖片失敗: ' + (err instanceof Error ? err.message : String(err))));
              }
            })
            .catch(err => {
              clearTimeout(timeoutId);
              if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
              reject(new Error('處理圖片失敗: ' + (err instanceof Error ? err.message : String(err))));
            });
        }
      } else {
        // 主線程環境使用標準 DOM APIs
        canvas = document.createElement('canvas');
        canvas.width = width || 1;
        canvas.height = height || 1;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          clearTimeout(timeoutId);
          if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
          reject(new Error('無法獲取畫布上下文'));
          return;
        }
        
        const img = new Image();
        img.onerror = () => {
          clearTimeout(timeoutId);
          if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
          reject(new Error('圖片載入失敗'));
        };
        
        img.onload = () => {
          clearTimeout(timeoutId);
          
          try {
            // 獲取實際尺寸
            const actualWidth = width || img.naturalWidth;
            const actualHeight = height || img.naturalHeight;
            
            // 重新設置畫布尺寸
            if (!width || !height) {
              canvas.width = actualWidth;
              canvas.height = actualHeight;
            }
            
            // 繪製到畫布
            ctx.drawImage(img, 0, 0, actualWidth, actualHeight);
            if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
            resolve({ ctx, width: actualWidth, height: actualHeight });
          } catch (err) {
            if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
            reject(new Error('繪製圖片失敗: ' + (err instanceof Error ? err.message : String(err))));
          }
        };
        
        if (imageUrl) img.src = imageUrl;
        else {
          clearTimeout(timeoutId);
          reject(new Error('無效的圖片URL'));
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (shouldRevokeUrl && imageUrl) URL.revokeObjectURL(imageUrl);
      reject(new Error('載入圖片失敗: ' + (err instanceof Error ? err.message : String(err))));
    }
  });
}

// 圖像品質分析 - 優化版本支持多種輸入
export const analyzeImageQuality = async (source: ImageSource): Promise<ImageQuality> => {
  // 先創建一個小畫布來獲取圖片尺寸
  try {
    // 載入圖片並限制尺寸
    const maxDimension = 1024; // 分析時的最大尺寸
    
    // 載入圖片到畫布，不指定尺寸以獲取原始尺寸
    const { ctx, width: originalWidth, height: originalHeight } = await loadImageToCanvas(
      source, 
      0, 
      0, 
      30000 // 增加超時時間
    );
    
    // 計算縮放尺寸
    const scaleFactor = Math.min(1, maxDimension / Math.max(originalWidth, originalHeight));
    const scaledWidth = Math.round(originalWidth * scaleFactor);
    const scaledHeight = Math.round(originalHeight * scaleFactor);
    
    // 如果需要縮放，則創建一個新的畫布
    let analysisCtx = ctx;
    let analysisWidth = originalWidth;
    let analysisHeight = originalHeight;
    
    if (scaleFactor < 1) {
      const scaledCanvas = isInWorker ? 
        new OffscreenCanvas(scaledWidth, scaledHeight) : 
        document.createElement('canvas');
      
      scaledCanvas.width = scaledWidth;
      scaledCanvas.height = scaledHeight;
      
      const scaledCtx = scaledCanvas.getContext('2d');
      if (!scaledCtx) throw new Error('無法創建縮放畫布上下文');
      
      // 繪製縮放後的圖像
      scaledCtx.drawImage(
        isInWorker ? (ctx.canvas as OffscreenCanvas) : (ctx.canvas as HTMLCanvasElement),
        0, 0, originalWidth, originalHeight,
        0, 0, scaledWidth, scaledHeight
      );
      
      analysisCtx = scaledCtx;
      analysisWidth = scaledWidth;
      analysisHeight = scaledHeight;
    }
    
    // 獲取像素數據
    const imageData = analysisCtx.getImageData(0, 0, analysisWidth, analysisHeight);
    const pixels = imageData.data;
    
    // 計算亮度 - 使用採樣以提高效能
    let brightnessSum = 0;
    const sampleStep = Math.max(1, Math.floor(Math.sqrt(pixels.length / 4) / 100));
    let samplesCount = 0;
    
    for (let i = 0; i < pixels.length; i += 4 * sampleStep) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      brightnessSum += (r + g + b) / 3;
      samplesCount++;
    }
    
    const avgBrightness = brightnessSum / samplesCount;
    
    // 計算對比度 - 使用相同的採樣
    let contrastSum = 0;
    samplesCount = 0;
    
    for (let i = 0; i < pixels.length; i += 4 * sampleStep) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const brightness = (r + g + b) / 3;
      contrastSum += Math.pow(brightness - avgBrightness, 2);
      samplesCount++;
    }
    
    const contrast = Math.sqrt(contrastSum / samplesCount);
    
    // 計算銳利度 - 使用更大的採樣步長和分塊處理
    const edgeStep = Math.max(2, Math.floor(Math.sqrt(analysisWidth * analysisHeight) / 50));
    let edgeCount = 0;
    let edgeSamples = 0;
    
    // 分塊處理以減少記憶體壓力
    const blockHeight = Math.min(100, analysisHeight);
    for (let blockY = 1; blockY < analysisHeight - 1; blockY += blockHeight) {
      const endY = Math.min(blockY + blockHeight, analysisHeight - 1);
      
      for (let y = blockY; y < endY; y += edgeStep) {
        for (let x = 1; x < analysisWidth - 1; x += edgeStep) {
          const idx = (y * analysisWidth + x) * 4;
          if (idx >= pixels.length) continue;
          
          const current = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
          
          // 檢查右側像素
          if (x + edgeStep < analysisWidth) {
            const rightIdx = (y * analysisWidth + x + edgeStep) * 4;
            if (rightIdx < pixels.length) {
              const right = (pixels[rightIdx] + pixels[rightIdx + 1] + pixels[rightIdx + 2]) / 3;
              const gradientX = Math.abs(current - right);
              if (gradientX > 20) edgeCount++;
            }
          }
          
          // 檢查下方像素
          if (y + edgeStep < analysisHeight) {
            const bottomIdx = ((y + edgeStep) * analysisWidth + x) * 4;
            if (bottomIdx < pixels.length) {
              const bottom = (pixels[bottomIdx] + pixels[bottomIdx + 1] + pixels[bottomIdx + 2]) / 3;
              const gradientY = Math.abs(current - bottom);
              if (gradientY > 20) edgeCount++;
            }
          }
          
          edgeSamples += 2;
        }
      }
      
      // 幫助垃圾回收
      if (endY < analysisHeight - 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    const sharpness = edgeSamples > 0 ? (edgeCount / edgeSamples) * 200 : 0;
    
    // 獲取文件大小
    let fileSize = 0;
    if (source instanceof File) {
      fileSize = source.size;
    } else if (typeof source === 'object' && source.fileSize) {
      fileSize = source.fileSize;
    }
    
    // 計算總分
    const normalizedBrightness = Math.max(0, 100 - Math.abs(avgBrightness - 128) / 128 * 100);
    const normalizedContrast = Math.min(100, (contrast / 50) * 100);
    const normalizedSharpness = Math.min(100, sharpness);
    const resolutionScore = Math.min(100, (originalWidth * originalHeight / 2073600) * 50);
    const fileSizeScore = Math.min(100, fileSize > 0 ? (fileSize / 1048576) * 25 : 50);
    
    const score = (
      normalizedBrightness * 0.2 +
      normalizedContrast * 0.2 +
      normalizedSharpness * 0.3 +
      resolutionScore * 0.2 +
      fileSizeScore * 0.1
    );
    
    return {
      sharpness: normalizedSharpness,
      brightness: normalizedBrightness,
      contrast: normalizedContrast,
      score: Math.round(score)
    };
  } catch (error) {
    console.error('分析圖片品質失敗:', error);
    throw error;
  }
};

// 計算感知哈希 (pHash) - 支持多種輸入類型
export const calculatePerceptualHash = async (source: ImageSource): Promise<string> => {
  try {
    // 載入縮小的圖片
    const { ctx } = await loadImageToCanvas(source, 8, 8);
    
    // 獲取像素數據
    const imageData = ctx.getImageData(0, 0, 8, 8);
    const pixels = imageData.data;
    
    // 計算平均亮度
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      sum += gray;
    }
    
    const average = sum / 64;
    
    // 生成哈希
    let hash = '';
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      hash += gray > average ? '1' : '0';
    }
    
    return hash;
  } catch (error) {
    console.error('計算感知哈希失敗:', error);
    throw error;
  }
};

// 計算平均哈希 (aHash) - 支持多種輸入類型
export const calculateAverageHash = async (source: ImageSource): Promise<string> => {
  try {
    // 載入縮小的圖片
    const { ctx } = await loadImageToCanvas(source, 8, 8);
    
    // 獲取像素數據
    const imageData = ctx.getImageData(0, 0, 8, 8);
    const pixels = imageData.data;
    
    // 計算平均亮度
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      sum += gray;
    }
    
    const average = sum / 64;
    
    // 生成哈希
    let hash = '';
    for (let i = 0; i < pixels.length; i += 4) {
      const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      hash += gray > average ? '1' : '0';
    }
    
    return hash;
  } catch (error) {
    console.error('計算平均哈希失敗:', error);
    throw error;
  }
};

// 計算差分哈希 (dHash) - 支持多種輸入類型
export const calculateDifferenceHash = async (source: ImageSource): Promise<string> => {
  try {
    // 載入縮小的圖片 (9x8 用於水平差分)
    const { ctx } = await loadImageToCanvas(source, 9, 8);
    
    // 獲取像素數據
    const imageData = ctx.getImageData(0, 0, 9, 8);
    const pixels = imageData.data;
    
    // 生成哈希
    let hash = '';
    // 逐行比較相鄰像素
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const idx1 = (y * 9 + x) * 4;
        const idx2 = (y * 9 + x + 1) * 4;
        
        const gray1 = 0.299 * pixels[idx1] + 0.587 * pixels[idx1 + 1] + 0.114 * pixels[idx1 + 2];
        const gray2 = 0.299 * pixels[idx2] + 0.587 * pixels[idx2 + 1] + 0.114 * pixels[idx2 + 2];
        
        hash += gray1 > gray2 ? '1' : '0';
      }
    }
    
    return hash;
  } catch (error) {
    console.error('計算差分哈希失敗:', error);
    throw error;
  }
};

// 計算所有哈希類型 - 一次性計算，避免重複處理圖像
export const calculateAllHashes = async (source: ImageSource): Promise<HashResult> => {
  try {
    // 載入圖像並計算多種哈希 - 這裡我們使用單一畫布來計算所有哈希
    // 先計算 dHash (需要 9x8 畫布)
    const { ctx } = await loadImageToCanvas(source, 9, 8);
    const imageData = ctx.getImageData(0, 0, 9, 8);
    const pixels = imageData.data;
    
    // 計算 pHash 和 aHash 的平均值 (使用 8x8 部分)
    let brightSum = 0;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const idx = (y * 9 + x) * 4;
        const gray = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
        brightSum += gray;
      }
    }
    const avgBrightness = brightSum / 64;
    
    // 計算 pHash 和 aHash (兩者使用相同的方法)
    let pHash = '';
    let aHash = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const idx = (y * 9 + x) * 4;
        const gray = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
        // 對於這個示例，pHash 和 aHash 使用相同的方法
        pHash += gray > avgBrightness ? '1' : '0';
        aHash += gray > avgBrightness ? '1' : '0';
      }
    }
    
    // 計算 dHash
    let dHash = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const idx1 = (y * 9 + x) * 4;
        const idx2 = (y * 9 + x + 1) * 4;
        
        const gray1 = 0.299 * pixels[idx1] + 0.587 * pixels[idx1 + 1] + 0.114 * pixels[idx1 + 2];
        const gray2 = 0.299 * pixels[idx2] + 0.587 * pixels[idx2 + 1] + 0.114 * pixels[idx2 + 2];
        
        dHash += gray1 > gray2 ? '1' : '0';
      }
    }
    
    return { pHash, dHash, aHash };
  } catch (error) {
    console.error('計算所有哈希失敗:', error);
    throw error;
  }
};

// 優化的漢明距離計算 - 使用位元運算
export const calculateHammingDistance = (hash1: string, hash2: string): number => {
  // 確保哈希長度相同
  const minLength = Math.min(hash1.length, hash2.length);
  let distance = 0;
  
  // 每32位元處理一次，轉換為整數進行位元運算
  for (let i = 0; i < minLength; i += 32) {
    const chunk1 = parseInt(hash1.substr(i, Math.min(32, minLength - i)), 2) || 0;
    const chunk2 = parseInt(hash2.substr(i, Math.min(32, minLength - i)), 2) || 0;
    let xor = chunk1 ^ chunk2;
    
    // 計算設置的位元數（1的數量）
    while (xor) {
      distance += xor & 1;
      xor = xor >>> 1;
    }
  }
  
  // 如果長度不同，將剩餘部分視為不同
  distance += Math.abs(hash1.length - hash2.length);
  
  return distance;
};

// 計算兩個哈希的相似度
export const calculateSimilarity = (hash1: string, hash2: string): number => {
  const distance = calculateHammingDistance(hash1, hash2);
  const maxLength = Math.max(hash1.length, hash2.length);
  
  // 轉換為相似度百分比
  return ((maxLength - distance) / maxLength) * 100;
};

// 圖像品質介面 (用於主線程和 Worker 共享)
export type { ImageQuality, HashResult, HashType };

// 為了使這個模組可以在主線程中使用
export default {
  analyzeImageQuality,
  calculatePerceptualHash,
  calculateAverageHash,
  calculateDifferenceHash,
  calculateAllHashes,
  calculateHammingDistance,
  calculateSimilarity
}; 