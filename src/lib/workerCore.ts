/**
 * Worker 核心模組 - 包含所有 Worker 共用的分析函數
 * 設計為可在 Web Worker 或主線程中使用
 */
import { 
  ImageQuality, 
  HashResult, 
  HashType 
} from './types';

// 圖像品質分析
export const analyzeImageQuality = async (imageFile: File): Promise<ImageQuality> => {
  return new Promise((resolve, reject) => {
    try {
      // 檢查是否在 Worker 中
      const isInWorker = typeof self !== 'undefined' && !('document' in self);
      
      // 建立 canvas (適用於主線程和 Worker)
      let canvas;
      if (isInWorker && typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(1, 1);
      } else {
        canvas = document.createElement('canvas');
      }
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('無法獲取畫布上下文');
      }

      const img = new Image();
      
      const timeout = setTimeout(() => {
        reject(new Error('圖片載入超時'));
      }, 15000); // 15秒超時
      
      img.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error('圖片載入失敗'));
      };
      
      const objectURL = URL.createObjectURL(imageFile);
      img.src = objectURL;

      // 確保釋放 objectURL
      img.onload = async () => { // 將onload改為async函數
        clearTimeout(timeout);
        URL.revokeObjectURL(objectURL);

        try {
          // 限制最大尺寸，避免記憶體溢出
          const maxDimension = 1024;
          const scaleFactor = Math.min(1, maxDimension / Math.max(img.width, img.height));
          const scaledWidth = Math.round(img.width * scaleFactor);
          const scaledHeight = Math.round(img.height * scaleFactor);
          
          canvas.width = scaledWidth;
          canvas.height = scaledHeight;
          
          // 確保圖片有效尺寸
          if (scaledWidth <= 0 || scaledHeight <= 0) {
            throw new Error('圖片尺寸無效');
          }
          
          ctx.drawImage(img, 0, 0, scaledWidth, scaledHeight);
          const imageData = ctx.getImageData(0, 0, scaledWidth, scaledHeight);
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
          const width = canvas.width;
          const height = canvas.height;
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
          const resolution = canvas.width * canvas.height;
          const originalResolution = img.width * img.height;
          const fileSize = imageFile.size;
          const normalizedBrightness = Math.max(0, 100 - Math.abs(avgBrightness - 128) / 128 * 100);
          const normalizedContrast = Math.min(100, (contrast / 50) * 100);
          const normalizedSharpness = Math.min(100, sharpness);
          const resolutionScore = Math.min(100, (originalResolution / 2073600) * 50);
          const fileSizeScore = Math.min(100, (fileSize / 1048576) * 25);
          
          const score = (
            normalizedBrightness * 0.2 +
            normalizedContrast * 0.2 +
            normalizedSharpness * 0.3 +
            resolutionScore * 0.2 +
            fileSizeScore * 0.1
          );
          
          resolve({
            sharpness: normalizedSharpness,
            brightness: normalizedBrightness,
            contrast: normalizedContrast,
            score: Math.round(score)
          });
          
          // 幫助釋放記憶體
          if (canvas instanceof OffscreenCanvas && canvas.width > 0) {
            canvas.width = 0;
            canvas.height = 0;
          }
        } catch (error) {
          reject(error);
        }
      };
    } catch (error) {
      reject(error);
    }
  });
};

// 計算感知哈希 (pHash)
export const calculatePerceptualHash = async (imageFile: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      // 檢查是否在 Worker 中
      const isInWorker = typeof self !== 'undefined' && !('document' in self);
      
      // 建立 canvas (適用於主線程和 Worker)
      let canvas;
      if (isInWorker && typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(8, 8);
      } else {
        canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
      }
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('無法獲取畫布上下文');
      }

      const img = new Image();
      
      const timeout = setTimeout(() => {
        reject(new Error('圖片載入超時'));
      }, 15000); // 15秒超時
      
      img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('圖片載入失敗'));
      };
      
      const objectURL = URL.createObjectURL(imageFile);
      img.src = objectURL;
      
      img.onload = () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(objectURL);
        
        try {
          ctx.drawImage(img, 0, 0, 8, 8);
          const imageData = ctx.getImageData(0, 0, 8, 8);
          const pixels = imageData.data;
          let sum = 0;
          
          for (let i = 0; i < pixels.length; i += 4) {
            const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            sum += gray;
          }
          
          const average = sum / 64;
          let hash = '';
          
          for (let i = 0; i < pixels.length; i += 4) {
            const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            hash += gray > average ? '1' : '0';
          }
          
          resolve(hash);
          
          // 幫助釋放記憶體
          if (canvas instanceof OffscreenCanvas && canvas.width > 0) {
            canvas.width = 0;
            canvas.height = 0;
          }
        } catch (error) {
          reject(error);
        }
      };
    } catch (error) {
      reject(error);
    }
  });
};

// 計算平均哈希 (aHash)
export const calculateAverageHash = async (imageFile: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const isInWorker = typeof self !== 'undefined' && !('document' in self);
      
      let canvas;
      if (isInWorker && typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(8, 8);
      } else {
        canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
      }
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('無法獲取畫布上下文');
      }
      
      const img = new Image();
      const timeout = setTimeout(() => {
        reject(new Error('圖片載入超時'));
      }, 15000);
      
      img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('圖片載入失敗'));
      };
      
      const objectURL = URL.createObjectURL(imageFile);
      img.src = objectURL;
      
      img.onload = () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(objectURL);
        
        try {
          ctx.drawImage(img, 0, 0, 8, 8);
          const imageData = ctx.getImageData(0, 0, 8, 8);
          const pixels = imageData.data;
          let sum = 0;
          
          for (let i = 0; i < pixels.length; i += 4) {
            const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            sum += gray;
          }
          
          const average = sum / 64;
          let hash = '';
          
          for (let i = 0; i < pixels.length; i += 4) {
            const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            hash += gray > average ? '1' : '0';
          }
          
          resolve(hash);
          
          // 幫助釋放記憶體
          if (canvas instanceof OffscreenCanvas && canvas.width > 0) {
            canvas.width = 0;
            canvas.height = 0;
          }
        } catch (error) {
          reject(error);
        }
      };
    } catch (error) {
      reject(error);
    }
  });
};

// 計算差分哈希 (dHash)
export const calculateDifferenceHash = async (imageFile: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    try {
      const isInWorker = typeof self !== 'undefined' && !('document' in self);
      
      let canvas;
      if (isInWorker && typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(9, 8);
      } else {
        canvas = document.createElement('canvas');
        canvas.width = 9;
        canvas.height = 8;
      }
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('無法獲取畫布上下文');
      }
      
      const img = new Image();
      const timeout = setTimeout(() => {
        reject(new Error('圖片載入超時'));
      }, 15000);
      
      img.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('圖片載入失敗'));
      };
      
      const objectURL = URL.createObjectURL(imageFile);
      img.src = objectURL;
      
      img.onload = () => {
        clearTimeout(timeout);
        URL.revokeObjectURL(objectURL);
        
        try {
          ctx.drawImage(img, 0, 0, 9, 8);
          const imageData = ctx.getImageData(0, 0, 9, 8);
          const pixels = imageData.data;
          
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
          
          resolve(hash);
          
          // 幫助釋放記憶體
          if (canvas instanceof OffscreenCanvas && canvas.width > 0) {
            canvas.width = 0;
            canvas.height = 0;
          }
        } catch (error) {
          reject(error);
        }
      };
    } catch (error) {
      reject(error);
    }
  });
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