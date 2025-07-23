import { pipeline } from "@huggingface/transformers";

export interface ImageQuality {
  sharpness: number;
  brightness: number;
  contrast: number;
  score: number;
}

export interface SimilarityGroup {
  id: string;
  photos: string[];
  bestPhoto: string;
  averageSimilarity: number;
}

// 計算圖片的感知哈希（簡化版）
export const calculatePerceptualHash = async (imageFile: File): Promise<string> => {
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
      
      resolve(hash);
    };
    
    img.src = URL.createObjectURL(imageFile);
  });
};

// 計算兩個哈希的相似度
export const calculateSimilarity = (hash1: string, hash2: string): number => {
  let differences = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      differences++;
    }
  }
  
  // 轉換為相似度百分比
  return ((hash1.length - differences) / hash1.length) * 100;
};

// 計算兩個向量的餘弦相似度
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dot / (normA * normB);
}

// 分析圖片品質
export const analyzeImageQuality = async (imageFile: File): Promise<ImageQuality> => {
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
      let sharpnessSum = 0;
      
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
      
      resolve({
        sharpness: normalizedSharpness,
        brightness: normalizedBrightness,
        contrast: normalizedContrast,
        score: Math.round(score)
      });
    };
    
    img.src = URL.createObjectURL(imageFile);
  });
};

// 使用AI模型進行圖片特徵提取（可選）
export const extractImageFeatures = async (imageFile: File) => {
  try {
    const extractor = await pipeline(
      "feature-extraction",
      "microsoft/resnet-50",
      { device: "webgpu" }
    );
    
    const features = await extractor(URL.createObjectURL(imageFile));
    return features;
  } catch (error) {
    console.warn("AI feature extraction failed, falling back to perceptual hash:", error);
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

// 多階段相似度分組：先用 pHash，再用深度特徵
export const groupSimilarPhotosAdvanced = async (
  photos: { id: string; file: File; hash?: string; quality?: ImageQuality }[],
  pHashThreshold: number = 80,
  featureThreshold: number = 0.9
): Promise<SimilarityGroup[]> => {
  const groups: SimilarityGroup[] = [];
  const processed = new Set<string>();
  // 預先計算所有特徵向量
  const featureMap: Record<string, number[] | null> = {};

  for (let i = 0; i < photos.length; i++) {
    if (processed.has(photos[i].id)) continue;
    const currentGroup: string[] = [photos[i].id];
    processed.add(photos[i].id);
    // 先找 pHash 相近的
    for (let j = i + 1; j < photos.length; j++) {
      if (processed.has(photos[j].id)) continue;
      if (photos[i].hash && photos[j].hash) {
        const similarity = calculateSimilarity(photos[i].hash, photos[j].hash);
        if (similarity >= pHashThreshold) {
          // 進行深度特徵比對
          if (!featureMap[photos[i].id]) {
            const features = await extractImageFeatures(photos[i].file);
            featureMap[photos[i].id] = Array.isArray(features) ? features.flat(Infinity) : null;
          }
          if (!featureMap[photos[j].id]) {
            const features = await extractImageFeatures(photos[j].file);
            featureMap[photos[j].id] = Array.isArray(features) ? features.flat(Infinity) : null;
          }
          const vecA = featureMap[photos[i].id];
          const vecB = featureMap[photos[j].id];
          if (vecA && vecB) {
            const featureSim = cosineSimilarity(vecA, vecB);
            if (featureSim >= featureThreshold) {
              currentGroup.push(photos[j].id);
              processed.add(photos[j].id);
            }
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
        averageSimilarity: pHashThreshold
      });
    }
  }
  return groups;
}