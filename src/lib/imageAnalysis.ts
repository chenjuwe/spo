import { pipeline } from "@huggingface/transformers";
import {
  calculateSimilarity,
  calculateHammingDistance,
  calculateWeightedSimilarity,
  LSHIndex,
  cosineSimilarity
} from "./utils";
import { hashCache } from "./hashCacheService";
import { HashType, HashResult, ImageQuality, SimilarityGroup } from "./types";

// 計算平均哈希 (aHash)
export const calculateAverageHash = async (imageFile: File): Promise<string> => {
  // 嘗試從緩存獲取
  const cachedHash = await hashCache.getMultiHash(imageFile);
  if (cachedHash?.aHash) {
    return cachedHash.aHash;
  }
  
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    
    img.onload = () => {
      // 縮放到8x8像素
      canvas.width = 8;
      canvas.height = 8;
      ctx.drawImage(img, 0, 0, 8, 8);
      
      // 獲取像素數據並計算平均值
      const imageData = ctx.getImageData(0, 0, 8, 8);
      const pixels = imageData.data;
      let sum = 0;
      
      for (let i = 0; i < pixels.length; i += 4) {
        // 計算灰階值
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
      
      resolve(hash);
    };
    
    img.src = URL.createObjectURL(imageFile);
  });
};

// 計算差分哈希 (dHash) - 相鄰像素比較
export const calculateDifferenceHash = async (imageFile: File): Promise<string> => {
  // 嘗試從緩存獲取
  const cachedHash = await hashCache.getMultiHash(imageFile);
  if (cachedHash?.dHash) {
    return cachedHash.dHash;
  }
  
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    
    img.onload = () => {
      // 差分哈希使用 9x8 縮放，然後比較相鄰像素
      canvas.width = 9;
      canvas.height = 8;
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
    };
    
    img.src = URL.createObjectURL(imageFile);
  });
};

// 計算感知哈希 (pHash) - 原始方法，重命名以明確區分
export const calculatePerceptualHash = async (imageFile: File): Promise<string> => {
  // 嘗試從緩存獲取
  const cachedHash = await hashCache.getHash(imageFile);
  if (cachedHash) {
    return cachedHash;
  }
  
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    
    img.onload = () => {
      // 縮放到8x8像素
      canvas.width = 8;
      canvas.height = 8;
      ctx.drawImage(img, 0, 0, 8, 8);
      
      // 獲取像素數據並計算平均亮度
      const imageData = ctx.getImageData(0, 0, 8, 8);
      const pixels = imageData.data;
      let sum = 0;
      
      for (let i = 0; i < pixels.length; i += 4) {
        // 計算灰階值
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
      
      // 將哈希存入緩存
      (async () => {
        try {
          await hashCache.storeHash(imageFile, hash);
        } catch (e) {
          console.warn('哈希緩存失敗:', e);
        }
      })();
      
      resolve(hash);
    };
    
    img.src = URL.createObjectURL(imageFile);
  });
};

// 計算完整的哈希結果（包含所有類型哈希）
export const calculateAllHashes = async (imageFile: File): Promise<HashResult> => {
  // 嘗試從緩存獲取
  const cachedHashes = await hashCache.getMultiHash(imageFile);
  if (cachedHashes && cachedHashes.pHash && cachedHashes.dHash && cachedHashes.aHash) {
    return cachedHashes;
  }
  
  try {
    const [pHash, dHash, aHash] = await Promise.all([
      calculatePerceptualHash(imageFile),
      calculateDifferenceHash(imageFile),
      calculateAverageHash(imageFile)
    ]);
    
    const hashes = { pHash, dHash, aHash };
    
    // 將哈希存入緩存
    (async () => {
      try {
        await hashCache.storeMultiHash(imageFile, hashes);
      } catch (e) {
        console.warn('哈希緩存失敗:', e);
      }
    })();
    
    return hashes;
  } catch (error) {
    console.error('計算哈希失敗:', error);
    throw error;
  }
};

// 計算顏色直方圖
export const calculateColorHistogram = async (imageFile: File): Promise<number[]> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    
    img.onload = () => {
      canvas.width = Math.min(img.width, 100);
      canvas.height = Math.min(img.height, 100);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      
      // 使用簡化的顏色空間，每個通道分4個桶
      const histSize = 4;
      const histogram = new Array(histSize * histSize * histSize).fill(0);
      
      for (let i = 0; i < pixels.length; i += 4) {
        const r = Math.floor(pixels[i] / 64);     // 0-3
        const g = Math.floor(pixels[i + 1] / 64); // 0-3
        const b = Math.floor(pixels[i + 2] / 64); // 0-3
        
        const idx = r * histSize * histSize + g * histSize + b;
        histogram[idx]++;
      }
      
      // 歸一化直方圖
      const totalPixels = (pixels.length / 4);
      for (let i = 0; i < histogram.length; i++) {
        histogram[i] = histogram[i] / totalPixels;
      }
      
      resolve(histogram);
    };
    
    img.src = URL.createObjectURL(imageFile);
  });
};

// 分析圖片品質
export const analyzeImageQuality = async (imageFile: File): Promise<ImageQuality> => {
  // 嘗試從緩存獲取
  const cachedQuality = await hashCache.getQuality(imageFile);
  if (cachedQuality) {
    return cachedQuality;
  }
  
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      
      let brightnessSum = 0;
      let contrastSum = 0;
      const sharpnessSum = 0;
      
      // 計算亮度和對比度
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        
        const brightness = (r + g + b) / 3;
        brightnessSum += brightness;
      }
      
      const avgBrightness = brightnessSum / (pixels.length / 4);
      
      // 計算對比度（方差）
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        
        const brightness = (r + g + b) / 3;
        contrastSum += Math.pow(brightness - avgBrightness, 2);
      }
      
      const contrast = Math.sqrt(contrastSum / (pixels.length / 4));
      
      // 簡化的銳利度計算（邊緣檢測）
      let edgeCount = 0;
      const width = canvas.width;
      const height = canvas.height;
      
      for (let y = 1; y < height - 1; y++) {
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
      
      const sharpness = (edgeCount / (width * height)) * 100;
      
      // 計算總分（考慮文件大小和分辨率）
      const resolution = canvas.width * canvas.height;
      const fileSize = imageFile.size;
      
      const normalizedBrightness = Math.max(0, 100 - Math.abs(avgBrightness - 128) / 128 * 100);
      const normalizedContrast = Math.min(100, (contrast / 50) * 100);
      const normalizedSharpness = Math.min(100, sharpness);
      const resolutionScore = Math.min(100, (resolution / 2073600) * 50); // 基於1920x1080
      const fileSizeScore = Math.min(100, (fileSize / 1048576) * 25); // 基於1MB
      
      const score = (
        normalizedBrightness * 0.2 +
        normalizedContrast * 0.2 +
        normalizedSharpness * 0.3 +
        resolutionScore * 0.2 +
        fileSizeScore * 0.1
      );
      
      const quality = {
        sharpness: normalizedSharpness,
        brightness: normalizedBrightness,
        contrast: normalizedContrast,
        score: Math.round(score)
      };
      
      // 將品質資訊存入緩存
      (async () => {
        try {
          await hashCache.storeQuality(imageFile, quality);
        } catch (e) {
          console.warn('品質緩存失敗:', e);
        }
      })();
      
      resolve(quality);
    };
    
    img.src = URL.createObjectURL(imageFile);
  });
};

// 定義特徵提取模型類型
interface FeatureExtractor {
  (input: string | ArrayBuffer | Uint8Array | Blob, options?: {
    pooling?: string;
    normalize?: boolean;
  }): Promise<number[] | number[][]>;
}

// 使用AI模型進行圖片特徵提取（增強版）
// 使用泛型類型替代 any
const modelCache = new Map<string, unknown>();
export const extractImageFeatures = async (imageFile: File) => {
  // 嘗試從緩存獲取
  const cachedFeatures = await hashCache.getFeatures(imageFile);
  if (cachedFeatures) {
    return cachedFeatures;
  }
  
  try {
    const modelId = "microsoft/resnet-50";
    let extractor = modelCache.get(modelId);
    
    if (!extractor) {
      try {
        console.log('載入模型中...');
        extractor = await pipeline(
          "feature-extraction",
          modelId,
          { device: "webgpu" }
        );
        modelCache.set(modelId, extractor);
        console.log('模型載入完成');
      } catch (gpuError) {
        console.warn("WebGPU 不支援，嘗試使用 CPU 模式:", gpuError);
        try {
          extractor = await pipeline(
            "feature-extraction",
            modelId,
            { device: "cpu" }
          );
          modelCache.set(modelId, extractor);
          console.log('模型載入完成 (CPU 模式)');
        } catch (cpuError) {
          console.error("模型載入失敗:", cpuError);
          throw new Error("無法載入特徵提取模型");
        }
      }
    }
    
    const objectUrl = URL.createObjectURL(imageFile);
    try {
      const features = await (extractor as FeatureExtractor)(objectUrl, {
        pooling: "mean",
        normalize: true
      });
      
      const featureArray = Array.isArray(features) ? 
        features.flat(Infinity) as number[] : 
        null;
      
      // 存入緩存
      if (featureArray) {
        (async () => {
          try {
            await hashCache.storeFeatures(imageFile, featureArray);
          } catch (e) {
            console.warn('特徵向量緩存失敗:', e);
          }
        })();
      }
      
      return featureArray;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    console.warn("AI 特徵提取失敗，回退到感知哈希:", error);
    return null;
  }
};

// 分組相似照片
export const groupSimilarPhotos = async (
  photos: { id: string; file: File; hash?: string; quality?: ImageQuality }[],
  threshold: number
): Promise<SimilarityGroup[]> => {
  const groups: SimilarityGroup[] = [];
  const processed = new Set<string>();
  
  for (let i = 0; i < photos.length; i++) {
    if (processed.has(photos[i].id)) continue;
    
    const currentGroup: string[] = [photos[i].id];
    processed.add(photos[i].id);
    
    for (let j = i + 1; j < photos.length; j++) {
      if (processed.has(photos[j].id)) continue;
      
      if (photos[i].hash && photos[j].hash) {
        const similarity = calculateSimilarity(photos[i].hash, photos[j].hash);
        
        if (similarity >= threshold) {
          currentGroup.push(photos[j].id);
          processed.add(photos[j].id);
        }
      }
    }
    
    if (currentGroup.length > 1) {
      // 找出品質最好的照片
      const groupPhotos = photos.filter(p => currentGroup.includes(p.id));
      const bestPhoto = groupPhotos.reduce((best, current) => {
        const bestScore = best.quality?.score || 0;
        const currentScore = current.quality?.score || 0;
        return currentScore > bestScore ? current : best;
      });
      
      groups.push({
        id: Math.random().toString(36).substr(2, 9),
        photos: currentGroup,
        bestPhoto: bestPhoto.id,
        averageSimilarity: threshold
      });
    }
  }
  
  return groups;
};

// 改進的多階段相似度分組：顏色直方圖 -> pHash/dHash -> 深度特徵
export const groupSimilarPhotosMultiStage = async (
  photos: { id: string; file: File; hashes?: HashResult; quality?: ImageQuality }[],
  thresholds = { histogram: 0.85, hash: 85, feature: 0.9 }
): Promise<SimilarityGroup[]> => {
  const groups: SimilarityGroup[] = [];
  const processed = new Set<string>();
  
  // 預先計算特徵
  const histograms: Record<string, number[]> = {};
  const features: Record<string, number[] | null> = {};
  
  // 使用局部敏感哈希進行初步索引
  const lshIndex = new LSHIndex(64, 4);
  
  console.log('開始構建 LSH 索引...');
  // 構建 LSH 索引
  for (const photo of photos) {
    if (photo.hashes?.pHash) {
      lshIndex.addPhoto(photo.id, photo.hashes.pHash);
    }
  }
  
  console.log('開始分析相似照片...');
  for (let i = 0; i < photos.length; i++) {
    if (processed.has(photos[i].id) || !photos[i].hashes?.pHash) continue;
    
    const currentGroup: string[] = [photos[i].id];
    processed.add(photos[i].id);
    
    // 使用 LSH 獲取可能的候選項，減少比較次數
    const candidates = lshIndex.query(photos[i].hashes.pHash)
      .filter(id => !processed.has(id) && id !== photos[i].id);
    
    for (const candidateId of candidates) {
      const candidateIdx = photos.findIndex(p => p.id === candidateId);
      if (candidateIdx === -1) continue;
      
      const candidate = photos[candidateIdx];
      if (!candidate.hashes) continue;
      
      // 階段 1: 計算哈希相似度（加權組合所有哈希）
      const hashSimilarity = calculateWeightedSimilarity(
        photos[i].hashes,
        candidate.hashes
      );
      
      if (hashSimilarity >= thresholds.hash) {
        // 階段 2: 進一步比較顏色直方圖
        if (!histograms[photos[i].id]) {
          histograms[photos[i].id] = await calculateColorHistogram(photos[i].file);
        }
        if (!histograms[candidateId]) {
          histograms[candidateId] = await calculateColorHistogram(candidate.file);
        }
        
        const histogramSimilarity = cosineSimilarity(
          histograms[photos[i].id], 
          histograms[candidateId]
        );
        
        if (histogramSimilarity >= thresholds.histogram) {
          // 階段 3: 最後使用深度特徵比對（如果可用）
          if (thresholds.feature > 0) {
            if (!features[photos[i].id]) {
              features[photos[i].id] = await extractImageFeatures(photos[i].file);
            }
            if (!features[candidateId]) {
              features[candidateId] = await extractImageFeatures(candidate.file);
            }
            
            const vecA = features[photos[i].id];
            const vecB = features[candidateId];
            
            if (vecA && vecB && cosineSimilarity(vecA, vecB) >= thresholds.feature) {
              currentGroup.push(candidateId);
              processed.add(candidateId);
            }
          } else {
            // 如果不使用深度特徵，僅基於哈希和直方圖相似度決定
            currentGroup.push(candidateId);
            processed.add(candidateId);
          }
        }
      }
    }
    
    if (currentGroup.length > 1) {
      // 找出品質最好的照片
      const groupPhotos = photos.filter(p => currentGroup.includes(p.id));
      const bestPhoto = groupPhotos.reduce((best, current) => {
        const bestScore = best.quality?.score || 0;
        const currentScore = current.quality?.score || 0;
        return currentScore > bestScore ? current : best;
      });
      
      groups.push({
        id: Math.random().toString(36).substr(2, 9),
        photos: currentGroup,
        bestPhoto: bestPhoto.id,
        averageSimilarity: thresholds.hash
      });
    }
  }
  
  return groups;
}