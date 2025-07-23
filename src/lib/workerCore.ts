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

/**
 * 在 Worker 或主線程環境中載入並處理圖片
 * @param file 圖片文件
 * @param width 輸出畫布寬度
 * @param height 輸出畫布高度
 * @param timeout 超時時間 (毫秒)
 * @returns 帶有圖片數據的畫布上下文
 */
function loadImageToCanvas(file: File, width: number, height: number, timeoutMs = 15000): Promise<{ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, width: number, height: number}> {
  return new Promise((resolve, reject) => {
    // 創建超時計時器
    const timeoutId = setTimeout(() => {
      reject(new Error('圖片載入超時'));
    }, timeoutMs);
    
    // 根據環境創建適當的 Canvas
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    
    if (isInWorker) {
      // Worker 環境使用 OffscreenCanvas
      if (typeof OffscreenCanvas === 'undefined') {
        clearTimeout(timeoutId);
        reject(new Error('此瀏覽器不支援 OffscreenCanvas'));
        return;
      }
      
      canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        clearTimeout(timeoutId);
        reject(new Error('無法獲取畫布上下文'));
        return;
      }
      
      // 使用 createImageBitmap 在 Worker 中處理圖片
      createImageBitmap(file)
        .then(bitmap => {
          clearTimeout(timeoutId);
          
          try {
            // 繪製到畫布
            ctx.drawImage(bitmap, 0, 0, width, height);
            
            // 釋放 bitmap 資源
            bitmap.close();
            
            resolve({ ctx, width, height });
          } catch (err) {
            reject(new Error('繪製圖片失敗: ' + (err instanceof Error ? err.message : String(err))));
          }
        })
        .catch(err => {
          clearTimeout(timeoutId);
          reject(new Error('處理圖片失敗: ' + (err instanceof Error ? err.message : String(err))));
        });
    } else {
      // 主線程環境使用標準 DOM APIs
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        clearTimeout(timeoutId);
        reject(new Error('無法獲取畫布上下文'));
        return;
      }
      
      const img = new Image();
      img.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error('圖片載入失敗'));
      };
      
      const objectURL = URL.createObjectURL(file);
      img.onload = () => {
        clearTimeout(timeoutId);
        URL.revokeObjectURL(objectURL);
        
        try {
          // 繪製到畫布
          ctx.drawImage(img, 0, 0, width, height);
          resolve({ ctx, width, height });
        } catch (err) {
          reject(new Error('繪製圖片失敗: ' + (err instanceof Error ? err.message : String(err))));
        }
      };
      
      img.src = objectURL;
    }
  });
}

// 圖像品質分析
export const analyzeImageQuality = async (imageFile: File): Promise<ImageQuality> => {
  // 先創建一個小畫布來獲取圖片尺寸
  try {
    // 載入圖片並限制尺寸
    const maxDimension = 1024;
    let scaledWidth = maxDimension;
    let scaledHeight = maxDimension;
    
    if (!isInWorker) {
      // 在主線程中，我們可以先獲取圖片尺寸
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        const objectURL = URL.createObjectURL(imageFile);
        img.onload = () => {
          URL.revokeObjectURL(objectURL);
          resolve();
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectURL);
          reject(new Error('圖片載入失敗'));
        };
        img.src = objectURL;
      });
      
      // 計算縮放後的尺寸
      const scaleFactor = Math.min(1, maxDimension / Math.max(img.width, img.height));
      scaledWidth = Math.round(img.width * scaleFactor);
      scaledHeight = Math.round(img.height * scaleFactor);
    }
    
    // 加載圖片到畫布
    const { ctx, width, height } = await loadImageToCanvas(
      imageFile, 
      scaledWidth, 
      scaledHeight
    );
    
    // 獲取像素數據
    const imageData = ctx.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    
    // 計算亮度
    let brightnessSum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const brightness = (r + g + b) / 3;
      brightnessSum += brightness;
    }
    
    const avgBrightness = brightnessSum / (pixels.length / 4);
    
    // 計算對比度
    let contrastSum = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const brightness = (r + g + b) / 3;
      contrastSum += Math.pow(brightness - avgBrightness, 2);
    }
    
    const contrast = Math.sqrt(contrastSum / (pixels.length / 4));
    
    // 計算銳利度 (使用分塊處理減少記憶體使用)
    let edgeCount = 0;
    const blockSize = 200; // 每次處理的行數
    
    for (let blockStart = 1; blockStart < height - 1; blockStart += blockSize) {
      const blockEnd = Math.min(blockStart + blockSize, height - 1);
      
      for (let y = blockStart; y < blockEnd; y++) {
        for (let x = 1; x < width - 1; x++) {
          const idx = (y * width + x) * 4;
          const current = (pixels[idx] + pixels[idx + 1] + pixels[idx + 2]) / 3;
          const right = (pixels[idx + 4] + pixels[idx + 5] + pixels[idx + 6]) / 3;
          const bottom = (pixels[idx + width * 4] + pixels[idx + width * 4 + 1] + pixels[idx + width * 4 + 2]) / 3;
          const gradientX = Math.abs(current - right);
          const gradientY = Math.abs(current - bottom);
          if (gradientX + gradientY > 30) {
            edgeCount++;
          }
        }
      }
      
      // 幫助垃圾回收
      if (blockEnd < height - 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    
    const sharpness = (edgeCount / (width * height)) * 100;
    
    // 計算總分
    const resolution = width * height;
    const fileSize = imageFile.size;
    const normalizedBrightness = Math.max(0, 100 - Math.abs(avgBrightness - 128) / 128 * 100);
    const normalizedContrast = Math.min(100, (contrast / 50) * 100);
    const normalizedSharpness = Math.min(100, sharpness);
    const resolutionScore = Math.min(100, (resolution / 2073600) * 50);
    const fileSizeScore = Math.min(100, (fileSize / 1048576) * 25);
    
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

// 計算感知哈希 (pHash)
export const calculatePerceptualHash = async (imageFile: File): Promise<string> => {
  try {
    // 載入縮小的圖片
    const { ctx } = await loadImageToCanvas(imageFile, 8, 8);
    
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

// 計算平均哈希 (aHash)
export const calculateAverageHash = async (imageFile: File): Promise<string> => {
  try {
    // 載入縮小的圖片
    const { ctx } = await loadImageToCanvas(imageFile, 8, 8);
    
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

// 計算差分哈希 (dHash)
export const calculateDifferenceHash = async (imageFile: File): Promise<string> => {
  try {
    // 載入縮小的圖片 (9x8 用於水平差分)
    const { ctx } = await loadImageToCanvas(imageFile, 9, 8);
    
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

// 計算所有哈希類型
export const calculateAllHashes = async (imageFile: File): Promise<HashResult> => {
  try {
    const [pHash, dHash, aHash] = await Promise.all([
      calculatePerceptualHash(imageFile),
      calculateDifferenceHash(imageFile),
      calculateAverageHash(imageFile)
    ]);
    
    return { pHash, dHash, aHash };
  } catch (error) {
    console.error('計算哈希失敗:', error);
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