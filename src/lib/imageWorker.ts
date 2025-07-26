// Web Worker for image processing operations
// This file is used with ?worker&inline plugin to be bundled as a Web Worker

import { ImageQuality, HashResult } from './types';

// 檢測環境是否支持 OffscreenCanvas
const supportsOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';

interface IHashOptions {
  size?: number;
  highQuality?: boolean;
}

// 消息處理函數
self.onmessage = async (e: MessageEvent) => {
  const { task, file, id, fileUrl, fileName, fileType } = e.data;
  
  try {
    let result;
    
    // 根據任務類型執行相應的處理
    switch (task) {
      case 'analyzeImageQuality':
        result = await analyzeImageQuality(fileUrl ? await fetchFile(fileUrl, fileType) : file);
        break;
      case 'calculatePerceptualHash':
        result = await calculatePerceptualHash(fileUrl ? await fetchFile(fileUrl, fileType) : file);
        break;
      case 'calculateAllHashes':
        result = await calculateAllHashes(fileUrl ? await fetchFile(fileUrl, fileType) : file);
        break;
      default:
        throw new Error(`未知任務類型: ${task}`);
    }
    
    self.postMessage({ result, id });
  } catch (error) {
    self.postMessage({ 
      error: error instanceof Error ? error.message : String(error), 
      id 
    });
    console.error(`工作線程錯誤 (${fileName || 'unknown'}):`, error);
  }
};

// 從 URL 獲取文件
async function fetchFile(fileUrl: string, fileType: string): Promise<File> {
  try {
    const response = await fetch(fileUrl);
    const blob = await response.blob();
    return new File([blob], "fetched_file", { type: fileType || blob.type });
  } catch (error) {
    console.error("無法從 URL 獲取文件:", error);
    throw error;
  }
}

// 使用 createImageBitmap 將文件轉換為圖像位圖
async function fileToImageBitmap(file: File): Promise<ImageBitmap> {
  try {
    // 直接使用 createImageBitmap API
    return await createImageBitmap(file);
  } catch (error) {
    console.error("圖像位圖創建失敗:", error);
    
    // 回退到舊方法，如果 createImageBitmap 失敗
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          // 將 canvas 轉換為 ImageBitmap
          if ('createImageBitmap' in self) {
            createImageBitmap(canvas)
              .then(resolve)
              .catch(reject);
          } else {
            // 沒有 createImageBitmap API 的極端情況
            reject(new Error("瀏覽器不支持 createImageBitmap API"));
          }
        } else {
          reject(new Error("無法獲取畫布上下文"));
        }
      };
      
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("圖像載入失敗"));
      };
      
      img.src = url;
    });
  }
}

// 使用 OffscreenCanvas 或 普通 Canvas 創建畫布
function createCanvas(width: number, height: number): { 
  canvas: OffscreenCanvas | HTMLCanvasElement;
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
} {
  if (supportsOffscreenCanvas) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  } else {
    const canvas = new (self as any).OffscreenCanvas 
      ? new (self as any).OffscreenCanvas(width, height)
      : new (self as any).Canvas(width, height);
    const ctx = canvas.getContext('2d');
    return { canvas, ctx };
  }
}

// 分析圖像品質
async function analyzeImageQuality(file: File): Promise<ImageQuality> {
  const imageBitmap = await fileToImageBitmap(file);
  
  // 為分析創建畫布
  const { canvas, ctx } = createCanvas(imageBitmap.width, imageBitmap.height);
  
  if (!ctx) {
    throw new Error('無法獲取畫布上下文');
  }
  
  // 將圖像繪製到畫布上
  ctx.drawImage(imageBitmap, 0, 0);
  
  // 釋放圖像位圖資源
  imageBitmap.close();
  
  // 獲取畫布像素數據
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  
  // 計算清晰度 (使用 Laplacian 算法)
  let laplacian = 0;
  const kernel = [0, -1, 0, -1, 4, -1, 0, -1, 0];
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const offset = (y * width + x) * 4;
      let sumR = 0, sumG = 0, sumB = 0;
      
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const kernelIdx = (ky + 1) * 3 + (kx + 1);
          const pixelOffset = ((y + ky) * width + (x + kx)) * 4;
          
          sumR += data[pixelOffset] * kernel[kernelIdx];
          sumG += data[pixelOffset + 1] * kernel[kernelIdx];
          sumB += data[pixelOffset + 2] * kernel[kernelIdx];
        }
      }
      
      laplacian += Math.sqrt(sumR * sumR + sumG * sumG + sumB * sumB);
    }
  }
  
  const normLaplacian = Math.min(100, Math.max(0, laplacian / (width * height) / 5));
  const sharpness = normLaplacian * 1.2;
  
  // 計算亮度和對比度
  let totalBrightness = 0;
  let totalContrast = 0;
  let minBrightness = 255;
  let maxBrightness = 0;
  let histogramData = new Array(256).fill(0);
  
  for (let i = 0; i < data.length; i += 4) {
    // 將 RGB 轉換為亮度
    const brightness = Math.floor((data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114));
    
    totalBrightness += brightness;
    minBrightness = Math.min(minBrightness, brightness);
    maxBrightness = Math.max(maxBrightness, brightness);
    histogramData[brightness]++;
  }
  
  const avgBrightness = totalBrightness / (width * height);
  const normalizedBrightness = Math.min(100, Math.max(0, (avgBrightness / 255) * 100));
  
  // 計算對比度 (使用標準差)
  for (let i = 0; i < data.length; i += 4) {
    const brightness = Math.floor((data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114));
    totalContrast += Math.pow(brightness - avgBrightness, 2);
  }
  
  const contrast = Math.sqrt(totalContrast / (width * height)) / 255 * 100;
  
  // 綜合評分
  const brightnessScore = normalizedBrightness > 50 
    ? (1 - Math.abs(normalizedBrightness - 65) / 35) * 100 
    : normalizedBrightness * 1.5;
    
  const contrastScore = contrast > 15 
    ? (1 - Math.abs(contrast - 25) / 25) * 100 
    : contrast * 5;
  
  // 使用加權平均計算最終分數
  const score = Math.min(100, Math.round(sharpness * 0.5 + brightnessScore * 0.25 + contrastScore * 0.25));
  
  return {
    sharpness: Math.round(sharpness),
    brightness: Math.round(normalizedBrightness),
    contrast: Math.round(contrast),
    score
  };
}

// 計算感知哈希 (pHash)
async function calculatePerceptualHash(file: File): Promise<string> {
  const result = await calculateAllHashes(file, { size: 32, highQuality: false });
  return result.pHash;
}

// 計算所有類型的哈希
async function calculateAllHashes(file: File, options: IHashOptions = {}): Promise<HashResult> {
  const { size = 32, highQuality = true } = options;
  const imageBitmap = await fileToImageBitmap(file);
  
  // 為哈希計算創建畫布
  const { canvas, ctx } = createCanvas(size, size);
  
  if (!ctx) {
    throw new Error('無法獲取畫布上下文');
  }
  
  // 繪製圖像，使用高質量選項
  if (highQuality) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  
  ctx.drawImage(imageBitmap, 0, 0, size, size);
  
  // 釋放圖像位圖資源
  imageBitmap.close();
  
  // 獲取像素數據
  const imageData = ctx.getImageData(0, 0, size, size);
  const { data } = imageData;
  
  // 將圖像轉換為灰度
  const grayScale = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    grayScale[i] = Math.floor(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
  }
  
  // 計算 DCT (離散餘弦變換) - pHash 用
  const dctSize = 8; // 使用低頻區域
  const dctValues = calculateDCT(grayScale, size, dctSize);
  
  // 計算 DCT 均值 (不包含第一個 DC 係數)
  let sum = 0;
  let count = 0;
  
  for (let y = 0; y < dctSize; y++) {
    for (let x = 0; x < dctSize; x++) {
      if (!(x === 0 && y === 0)) { // 跳過 DC 係數 (第一個值)
        sum += dctValues[y * dctSize + x];
        count++;
      }
    }
  }
  
  const avg = sum / count;
  
  // 計算 pHash (根據 DCT 值與均值比較)
  let pHashValue = '';
  for (let y = 0; y < dctSize; y++) {
    for (let x = 0; x < dctSize; x++) {
      if (!(x === 0 && y === 0)) { // 跳過 DC 係數
        pHashValue += dctValues[y * dctSize + x] > avg ? '1' : '0';
      }
    }
  }
  
  // 計算 dHash (相鄰像素比較)
  let dHashValue = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i1 = (y * size + x);
      const i2 = (y * size + x + 1);
      dHashValue += grayScale[i1] < grayScale[i2] ? '1' : '0';
    }
  }
  
  // 計算 aHash (均值哈希)
  let avgGray = 0;
  for (let i = 0; i < size * size; i++) {
    avgGray += grayScale[i];
  }
  avgGray /= (size * size);
  
  let aHashValue = '';
  for (let i = 0; i < size * size; i++) {
    aHashValue += grayScale[i] > avgGray ? '1' : '0';
  }
  
  // 將二進制哈希轉換為十六進制
  return {
    pHash: binaryToHex(pHashValue),
    dHash: binaryToHex(dHashValue),
    aHash: binaryToHex(aHashValue.substring(0, 64)) // 僅使用前 64 位
  };
}

// 計算離散餘弦變換 (DCT)
function calculateDCT(grayScale: Uint8Array, size: number, dctSize: number): number[] {
  const result = new Array(dctSize * dctSize).fill(0);
  
  for (let u = 0; u < dctSize; u++) {
    for (let v = 0; v < dctSize; v++) {
      let sum = 0;
      
      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          sum += grayScale[i * size + j] * 
                 Math.cos((2 * i + 1) * u * Math.PI / (2 * size)) * 
                 Math.cos((2 * j + 1) * v * Math.PI / (2 * size));
        }
      }
      
      // 應用 DCT 係數
      sum *= ((u === 0 ? 1 / Math.sqrt(2) : 1) * (v === 0 ? 1 / Math.sqrt(2) : 1)) * (2 / size);
      result[u * dctSize + v] = sum;
    }
  }
  
  return result;
}

// 將二進制字符串轉換為十六進制
function binaryToHex(binary: string): string {
  let hex = '';
  for (let i = 0; i < binary.length; i += 4) {
    const chunk = binary.substring(i, i + 4);
    hex += parseInt(chunk, 2).toString(16);
  }
  return hex;
} 