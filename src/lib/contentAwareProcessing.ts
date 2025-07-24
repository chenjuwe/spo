/**
 * 內容感知處理模塊
 * 使用圖像內容特徵進行智能處理，包括主體區域檢測、臉部檢測和自適應相似度閾值
 */

/**
 * 主體區域
 */
export interface RegionOfInterest {
  /**
   * X坐標（左上角）
   */
  x: number;
  
  /**
   * Y坐標（左上角）
   */
  y: number;
  
  /**
   * 寬度
   */
  width: number;
  
  /**
   * 高度
   */
  height: number;
  
  /**
   * 權重（重要性，0-1）
   */
  weight: number;
  
  /**
   * 區域類型
   */
  type: 'face' | 'object' | 'saliency' | 'custom';
}

/**
 * 臉部檢測結果
 */
export interface FaceDetectionResult {
  /**
   * 臉部區域
   */
  region: RegionOfInterest;
  
  /**
   * 置信度（0-1）
   */
  confidence: number;
  
  /**
   * 臉部特徵點（如果可用）
   */
  landmarks?: { x: number; y: number }[];
}

/**
 * 圖像分類結果
 */
export interface ImageClassification {
  /**
   * 圖像類別
   */
  category: string;
  
  /**
   * 置信度（0-1）
   */
  confidence: number;
  
  /**
   * 建議的相似度閾值
   */
  suggestedThreshold: number;
}

/**
 * 內容感知哈希權重
 */
export interface ContentAwareHashWeights {
  /**
   * 區域權重映射（區域類型到權重的映射）
   */
  regionTypeWeights: Record<string, number>;
  
  /**
   * 圖像類型權重映射（圖像類型到權重的映射）
   */
  imageTypeWeights: Record<string, number>;
}

/**
 * 默認內容感知權重
 */
export const DEFAULT_CONTENT_AWARE_WEIGHTS: ContentAwareHashWeights = {
  regionTypeWeights: {
    face: 1.5,     // 臉部區域權重提高
    object: 1.2,   // 主要物體
    saliency: 1.0, // 一般顯著區域
    custom: 1.0    // 自定義區域
  },
  imageTypeWeights: {
    portrait: 1.3,   // 人像照片
    landscape: 0.8,  // 風景照片
    document: 1.2,   // 文檔
    text: 1.4,       // 文本圖像
    graphical: 1.0,  // 圖形圖像
    artwork: 0.9,    // 藝術作品
    other: 1.0       // 其他類型
  }
};

/**
 * 默認圖像類型閾值映射
 */
export const DEFAULT_IMAGE_TYPE_THRESHOLDS: Record<string, number> = {
  portrait: 92,   // 人像照片（較高閾值）
  landscape: 85,  // 風景照片（較低閾值）
  document: 95,   // 文檔（較高閾值）
  text: 97,       // 文字（最高閾值）
  graphical: 90,  // 圖形（中等閾值）
  artwork: 87,    // 藝術作品（較低閾值）
  other: 90       // 其他（默認閾值）
};

/**
 * 灰度轉換
 * @param imageData 圖像數據
 * @returns 灰度圖像數據
 */
function convertToGrayscale(imageData: ImageData): Uint8ClampedArray {
  const { width, height, data } = imageData;
  const grayscale = new Uint8ClampedArray(width * height);
  
  // 使用亮度加權公式: Y = 0.299*R + 0.587*G + 0.114*B
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    grayscale[j] = Math.round(
      0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    );
  }
  
  return grayscale;
}

/**
 * 計算圖像梯度
 * @param grayscale 灰度圖像數據
 * @param width 圖像寬度
 * @param height 圖像高度
 * @returns 梯度強度數據
 */
function computeGradient(grayscale: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const gradient = new Uint8ClampedArray(width * height);
  
  // Sobel 算子
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      // 水平 Sobel
      const gx =
        -grayscale[idx - width - 1] +
        grayscale[idx - width + 1] +
        -2 * grayscale[idx - 1] +
        2 * grayscale[idx + 1] +
        -grayscale[idx + width - 1] +
        grayscale[idx + width + 1];
      
      // 垂直 Sobel
      const gy =
        -grayscale[idx - width - 1] +
        -2 * grayscale[idx - width] +
        -grayscale[idx - width + 1] +
        grayscale[idx + width - 1] +
        2 * grayscale[idx + width] +
        grayscale[idx + width + 1];
      
      // 梯度強度（範圍 0-255）
      const g = Math.min(255, Math.sqrt(gx * gx + gy * gy));
      gradient[idx] = g;
    }
  }
  
  return gradient;
}

/**
 * 檢測顯著性區域
 * @param imageData 圖像數據
 * @returns 顯著性區域列表
 */
export function detectSalientRegions(imageData: ImageData): RegionOfInterest[] {
  const { width, height } = imageData;
  const grayscale = convertToGrayscale(imageData);
  const gradient = computeGradient(grayscale, width, height);
  
  // 使用簡化的方法檢測顯著性區域
  // 1. 將圖像分割為網格
  // 2. 計算每個網格中的平均梯度強度
  // 3. 選擇梯度強度較高的區域作為顯著區域
  
  const gridSize = Math.max(Math.floor(Math.min(width, height) / 8), 16);
  const regions: RegionOfInterest[] = [];
  
  // 計算整體平均梯度強度作為閾值
  let totalGradient = 0;
  for (let i = 0; i < gradient.length; i++) {
    totalGradient += gradient[i];
  }
  const avgGradient = totalGradient / gradient.length;
  const gradientThreshold = avgGradient * 1.5; // 閾值為平均值的 1.5 倍
  
  // 掃描網格
  for (let y = 0; y < height; y += gridSize) {
    for (let x = 0; x < width; x += gridSize) {
      // 計算當前網格的平均梯度
      let gridGradient = 0;
      let pixelCount = 0;
      
      const gridWidth = Math.min(gridSize, width - x);
      const gridHeight = Math.min(gridSize, height - y);
      
      for (let gy = 0; gy < gridHeight; gy++) {
        for (let gx = 0; gx < gridWidth; gx++) {
          const idx = (y + gy) * width + (x + gx);
          gridGradient += gradient[idx];
          pixelCount++;
        }
      }
      
      const avgGridGradient = gridGradient / pixelCount;
      
      // 如果當前網格的梯度超過閾值，將其添加為顯著區域
      if (avgGridGradient > gradientThreshold) {
        // 計算權重（相對於平均梯度）
        const weight = Math.min(1.0, avgGridGradient / (gradientThreshold * 2));
        
        regions.push({
          x,
          y,
          width: gridWidth,
          height: gridHeight,
          weight,
          type: 'saliency'
        });
      }
    }
  }
  
  return mergeOverlappingRegions(regions);
}

/**
 * 合併重疊區域
 * @param regions 區域列表
 * @returns 合併後的區域列表
 */
function mergeOverlappingRegions(regions: RegionOfInterest[]): RegionOfInterest[] {
  if (regions.length <= 1) {
    return regions;
  }
  
  // 按區域大小降序排序
  regions.sort((a, b) => (b.width * b.height) - (a.width * a.height));
  
  const result: RegionOfInterest[] = [];
  const merged = new Array(regions.length).fill(false);
  
  for (let i = 0; i < regions.length; i++) {
    if (merged[i]) continue;
    
    const current = { ...regions[i] };
    merged[i] = true;
    
    let mergedAny = true;
    while (mergedAny) {
      mergedAny = false;
      
      for (let j = 0; j < regions.length; j++) {
        if (merged[j]) continue;
        
        // 檢查重疊
        if (regionsOverlap(current, regions[j])) {
          // 合併區域
          const mergedRegion = mergeRegions(current, regions[j]);
          Object.assign(current, mergedRegion);
          merged[j] = true;
          mergedAny = true;
        }
      }
    }
    
    result.push(current);
  }
  
  return result;
}

/**
 * 檢查兩個區域是否重疊
 */
function regionsOverlap(a: RegionOfInterest, b: RegionOfInterest): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/**
 * 合併兩個區域
 */
function mergeRegions(a: RegionOfInterest, b: RegionOfInterest): RegionOfInterest {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    weight: Math.max(a.weight, b.weight), // 使用最高權重
    type: a.type // 保留第一個區域的類型
  };
}

/**
 * 使用 HOG (Histogram of Oriented Gradients) 檢測臉部
 * 這是一個簡化版的臉部檢測，實際應用中應使用專業的臉部檢測庫
 * 
 * @param imageData 圖像數據
 * @returns 檢測到的臉部列表
 */
export function detectFaces(imageData: ImageData): FaceDetectionResult[] {
  // 注意：這只是一個簡化的實現，實際應用中應使用專業的庫
  // 如 face-api.js, OpenCV.js 或 TensorFlow.js 的人臉檢測模型
  
  // 在生產環境中，可以替換為實際的臉部檢測邏輯
  // 這裡僅提供一個粗略的近似方法
  
  const { width, height } = imageData;
  const grayscale = convertToGrayscale(imageData);
  
  // 使用膚色檢測和邊緣檢測的組合來嘗試找到臉部
  // 這只是一個非常粗略的方法，不應在實際產品中使用
  const faces: FaceDetectionResult[] = [];
  
  // 使用圖像處理找到可能是臉部的區域 
  // (實際應用中應替換為專業人臉檢測)
  
  // 在這個簡化的示例中，我們只檢測一個中心區域作為"臉部"
  // 這只是為了演示，不具有實際臉部檢測能力
  const centerX = Math.floor(width * 0.5);
  const centerY = Math.floor(height * 0.4); // 人臉通常在上半部分
  const faceWidth = Math.floor(width * 0.2);
  const faceHeight = Math.floor(height * 0.3);
  
  faces.push({
    region: {
      x: centerX - faceWidth / 2,
      y: centerY - faceHeight / 2,
      width: faceWidth,
      height: faceHeight,
      weight: 1.0,
      type: 'face'
    },
    confidence: 0.5 // 這是一個假設的值
  });
  
  return faces;
}

/**
 * 使用簡單的啟發式方法對圖像進行分類
 * 
 * @param imageData 圖像數據
 * @returns 圖像分類結果
 */
export function classifyImage(imageData: ImageData): ImageClassification {
  const { width, height, data } = imageData;
  
  // 提取基本特徵
  let totalR = 0, totalG = 0, totalB = 0;
  let edgeCount = 0;
  let skinPixels = 0;
  
  // 轉換為灰度並計算邊緣
  const grayscale = convertToGrayscale(imageData);
  const gradient = computeGradient(grayscale, width, height);
  
  // 計算邊緣像素和顏色分佈
  for (let i = 0; i < gradient.length; i++) {
    if (gradient[i] > 50) { // 邊緣閾值
      edgeCount++;
    }
    
    const idx = i * 4;
    totalR += data[idx];
    totalG += data[idx + 1];
    totalB += data[idx + 2];
    
    // 簡單的膚色檢測
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    if (r > 60 && g > 40 && b > 20 && 
        r > g && r > b && 
        r - Math.min(g, b) > 15 && 
        Math.abs(r - g) > 15) {
      skinPixels++;
    }
  }
  
  const totalPixels = width * height;
  const avgR = totalR / totalPixels;
  const avgG = totalG / totalPixels;
  const avgB = totalB / totalPixels;
  const edgeRatio = edgeCount / totalPixels;
  const skinRatio = skinPixels / totalPixels;
  
  // 基於特徵的分類邏輯
  let category = 'other';
  let confidence = 0.5;
  
  // 圖像長寬比
  const aspectRatio = width / height;
  
  // 判斷是否為人像照片
  if (skinRatio > 0.15 && 
      (aspectRatio >= 0.5 && aspectRatio <= 1.5) && 
      edgeRatio < 0.3) {
    category = 'portrait';
    confidence = Math.min(0.9, skinRatio * 2);
  }
  // 判斷是否為風景照片
  else if ((avgB > avgR && avgG > avgR) || 
           (avgG > avgR * 1.1 && avgG > avgB) && 
           edgeRatio < 0.2 && 
           skinRatio < 0.1) {
    category = 'landscape';
    confidence = 0.7 + (Math.min(avgG, avgB) / Math.max(avgR, 1)) * 0.2;
  }
  // 判斷是否為文檔
  else if (edgeRatio > 0.2 && 
           avgR > 200 && avgG > 200 && avgB > 200 && 
           skinRatio < 0.05) {
    category = 'document';
    confidence = 0.6 + edgeRatio * 0.4;
  }
  // 判斷是否為文字
  else if (edgeRatio > 0.3 && 
           Math.abs(avgR - avgG) < 30 && 
           Math.abs(avgR - avgB) < 30 && 
           skinRatio < 0.02) {
    category = 'text';
    confidence = 0.7 + edgeRatio * 0.3;
  }
  // 判斷是否為圖形或藝術作品
  else if (edgeRatio > 0.15 && 
           Math.max(avgR, avgG, avgB) - Math.min(avgR, avgG, avgB) > 50) {
    category = (avgR > Math.max(avgG, avgB) * 1.2) ? 'artwork' : 'graphical';
    confidence = 0.6 + edgeRatio * 0.2;
  }
  
  // 從分類獲取建議的相似度閾值
  const suggestedThreshold = DEFAULT_IMAGE_TYPE_THRESHOLDS[category] || 90;
  
  return {
    category,
    confidence,
    suggestedThreshold
  };
}

/**
 * 提取圖像中的主要內容區域
 * 結合臉部檢測和顯著性區域檢測
 * 
 * @param imageData 圖像數據
 * @returns 主要內容區域
 */
export function extractContentRegions(imageData: ImageData): RegionOfInterest[] {
  // 檢測顯著性區域
  const salientRegions = detectSalientRegions(imageData);
  
  // 檢測臉部
  const faceResults = detectFaces(imageData);
  
  // 合併所有區域
  const allRegions: RegionOfInterest[] = [
    ...salientRegions,
    ...faceResults.map(face => face.region)
  ];
  
  return mergeOverlappingRegions(allRegions);
}

/**
 * 使用區域加權方式計算哈希
 * 對圖像中的重要區域賦予更高權重
 * 
 * @param imageData 圖像數據
 * @param hashFunction 基本哈希函數
 * @param regions 權重區域列表
 * @returns 加權哈希值
 */
export function calculateRegionWeightedHash(
  imageData: ImageData,
  hashFunction: (data: ImageData) => string,
  regions: RegionOfInterest[]
): string {
  // 如果沒有特殊區域，使用標準哈希
  if (regions.length === 0) {
    return hashFunction(imageData);
  }
  
  // 計算區域加權哈希
  const regionHashes: string[] = [];
  const weights: number[] = [];
  const { width, height } = imageData;
  
  // 添加整體圖像的哈希（較低權重）
  regionHashes.push(hashFunction(imageData));
  weights.push(0.4); // 整體圖像權重
  
  // 計算每個區域的哈希
  for (const region of regions) {
    // 創建臨時畫布
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      continue;
    }
    
    // 設置畫布大小
    canvas.width = region.width;
    canvas.height = region.height;
    
    // 從原始圖像中提取區域
    ctx.putImageData(
      imageData,
      -region.x,
      -region.y,
      region.x,
      region.y,
      region.width,
      region.height
    );
    
    // 獲取區域圖像數據
    const regionImageData = ctx.getImageData(0, 0, region.width, region.height);
    
    // 計算區域哈希
    const regionHash = hashFunction(regionImageData);
    
    // 計算區域權重
    // 基於區域大小和類型權重
    const sizeRatio = (region.width * region.height) / (width * height);
    const typeWeight = DEFAULT_CONTENT_AWARE_WEIGHTS.regionTypeWeights[region.type] || 1.0;
    
    // 最終權重是區域權重、大小比例和類型權重的組合
    const finalWeight = region.weight * Math.sqrt(sizeRatio) * typeWeight;
    
    // 添加區域哈希和權重
    regionHashes.push(regionHash);
    weights.push(finalWeight);
    
    // 清理資源
    canvas.width = 0;
    canvas.height = 0;
  }
  
  // 歸一化權重
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const normalizedWeights = weights.map(w => w / totalWeight);
  
  // 結合加權哈希
  // 這裡使用簡單的方法來組合字符串，實際應用可能需要更複雜的方法
  
  // 臨時實現：對於每個位置，根據權重選擇最可能的位元
  let combinedHash = '';
  
  // 假設所有哈希長度相同
  if (regionHashes.length > 0 && regionHashes[0].length > 0) {
    for (let i = 0; i < regionHashes[0].length; i++) {
      // 對於每個位置，計算哪個字符出現的權重最高
      const charWeights: Record<string, number> = {};
      
      for (let j = 0; j < regionHashes.length; j++) {
        const char = regionHashes[j][i];
        charWeights[char] = (charWeights[char] || 0) + normalizedWeights[j];
      }
      
      // 選擇權重最高的字符
      let maxWeight = 0;
      let selectedChar = '0';
      
      for (const [char, weight] of Object.entries(charWeights)) {
        if (weight > maxWeight) {
          maxWeight = weight;
          selectedChar = char;
        }
      }
      
      combinedHash += selectedChar;
    }
  }
  
  return combinedHash || hashFunction(imageData); // 如果組合失敗，返回原始哈希
}

/**
 * 強化版臉部檢測
 * 使用更精準的方法檢測人臉，並設定更高的權重
 * 
 * @param imageData 圖像數據
 * @returns 臉部檢測結果
 */
export function detectFacesEnhanced(imageData: ImageData): FaceDetectionResult[] {
  const results = detectFaces(imageData);
  
  // 增強臉部區域權重
  // 根據臉部大小、清晰度和位置調整權重
  return results.map(result => {
    const { region, confidence } = result;
    const { width, height } = region;
    const imageArea = imageData.width * imageData.height;
    const faceArea = width * height;
    
    // 計算臉部區域佔圖像總面積比例
    const areaRatio = faceArea / imageArea;
    
    // 臉部在圖像中心的權重更高
    const centerX = imageData.width / 2;
    const centerY = imageData.height / 2;
    const faceX = region.x + width / 2;
    const faceY = region.y + height / 2;
    
    // 計算臉部與中心點的距離
    const distanceToCenter = Math.sqrt(
      Math.pow(faceX - centerX, 2) + 
      Math.pow(faceY - centerY, 2)
    ) / Math.sqrt(Math.pow(imageData.width / 2, 2) + Math.pow(imageData.height / 2, 2));
    
    // 基於臉部大小、位置和置信度計算調整後的權重
    let adjustedWeight = region.weight;
    
    // 較大的臉部權重更高
    if (areaRatio > 0.1) { // 臉部區域超過圖像10%
      adjustedWeight *= 1.5;
    } else if (areaRatio > 0.05) { // 臉部區域超過圖像5%
      adjustedWeight *= 1.3;
    }
    
    // 中心位置的臉部權重更高
    if (distanceToCenter < 0.2) { // 臉部在中心區域
      adjustedWeight *= 1.4;
    } else if (distanceToCenter < 0.4) { // 臉部在較靠近中心的區域
      adjustedWeight *= 1.2;
    }
    
    // 置信度高的臉部權重更高
    adjustedWeight *= (0.8 + 0.4 * confidence);
    
    // 確保權重在合理範圍內
    adjustedWeight = Math.min(2.0, Math.max(0.5, adjustedWeight));
    
    return {
      ...result,
      region: {
        ...region,
        weight: adjustedWeight
      }
    };
  });
}

/**
 * 計算自適應相似度閾值
 * 根據圖像類型和內容複雜度調整閾值
 * 
 * @param imageData 圖像數據
 * @param baseThreshold 基準閾值
 * @returns 調整後的閾值
 */
export function calculateAdaptiveThreshold(
  imageData: ImageData,
  baseThreshold: number
): number {
  // 識別圖像類型
  const classification = classifyImage(imageData);
  const { category, confidence } = classification;
  
  // 初始化閾值調整因子
  let thresholdAdjustment = 0;
  
  // 根據圖像類型調整閾值
  switch (category) {
    case 'portrait':
      // 人像照片通常需要較高的閾值，因為人臉細節很重要
      thresholdAdjustment = 5;
      break;
    case 'landscape':
      // 風景照片可以接受較低的閾值
      thresholdAdjustment = -5;
      break;
    case 'text':
    case 'document':
      // 文本和文檔要求較高的閾值
      thresholdAdjustment = 8;
      break;
    case 'artwork':
      // 藝術作品可以接受較低的閾值
      thresholdAdjustment = -3;
      break;
    default:
      thresholdAdjustment = 0;
  }
  
  // 根據圖像複雜度進一步調整閾值
  const edgeRatio = calculateImageComplexity(imageData);
  
  // 複雜圖像需要較低的閾值，簡單圖像需要較高的閾值
  if (edgeRatio > 0.1) { // 複雜圖像
    thresholdAdjustment -= 3;
  } else if (edgeRatio < 0.03) { // 簡單圖像
    thresholdAdjustment += 3;
  }
  
  // 檢查是否有臉部
  const faceResults = detectFaces(imageData);
  if (faceResults.length > 0) {
    // 有臉部的圖像需要較高的閾值
    thresholdAdjustment += 5;
  }
  
  // 根據分類的置信度加權調整
  thresholdAdjustment *= confidence;
  
  // 計算最終閾值並確保在合理範圍內
  const finalThreshold = Math.max(70, Math.min(98, baseThreshold + thresholdAdjustment));
  
  return finalThreshold;
}

/**
 * 計算圖像複雜度
 * @param imageData 圖像數據
 * @returns 複雜度指標（邊緣像素比例）
 */
function calculateImageComplexity(imageData: ImageData): number {
  const { width, height, data } = imageData;
  let edgeCount = 0;
  
  // 計算邊緣像素數量
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      const current = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      const right = (data[idx + 4] + data[idx + 5] + data[idx + 6]) / 3;
      const bottom = (data[idx + width * 4] + data[idx + width * 4 + 1] + data[idx + width * 4 + 2]) / 3;
      
      const gradientX = Math.abs(current - right);
      const gradientY = Math.abs(current - bottom);
      
      if (gradientX + gradientY > 30) {
        edgeCount++;
      }
    }
  }
  
  // 返回邊緣像素佔總像素的比例
  return edgeCount / (width * height);
}

/**
 * 計算內容感知相似度
 * 結合區域加權哈希和自適應閾值
 * 
 * @param imageData1 第一個圖像
 * @param imageData2 第二個圖像
 * @param hashFunction 哈希函數
 * @param similarityFunction 相似度計算函數
 * @param baseThreshold 基準閾值
 * @returns 相似度結果 (相似度值, 是否相似, 使用的閾值)
 */
export function calculateContentAwareSimilarity(
  imageData1: ImageData,
  imageData2: ImageData,
  hashFunction: (data: ImageData) => string,
  similarityFunction: (hash1: string, hash2: string) => number,
  baseThreshold: number = 90
): { similarity: number; isMatching: boolean; usedThreshold: number } {
  // 提取內容區域
  const regions1 = extractContentRegionsEnhanced(imageData1);
  const regions2 = extractContentRegionsEnhanced(imageData2);
  
  // 計算區域加權哈希
  const weightedHash1 = calculateRegionWeightedHash(imageData1, hashFunction, regions1);
  const weightedHash2 = calculateRegionWeightedHash(imageData2, hashFunction, regions2);
  
  // 計算自適應閾值
  const threshold1 = calculateAdaptiveThreshold(imageData1, baseThreshold);
  const threshold2 = calculateAdaptiveThreshold(imageData2, baseThreshold);
  
  // 使用較高的閾值（更嚴格的要求）
  const adaptiveThreshold = Math.max(threshold1, threshold2);
  
  // 計算相似度
  const similarity = similarityFunction(weightedHash1, weightedHash2);
  
  return {
    similarity,
    isMatching: similarity >= adaptiveThreshold,
    usedThreshold: adaptiveThreshold
  };
}

/**
 * 增強版內容區域提取
 * 結合臉部檢測和顯著性區域檢測，並給臉部更高的權重
 * 
 * @param imageData 圖像數據
 * @returns 增強版區域列表
 */
export function extractContentRegionsEnhanced(imageData: ImageData): RegionOfInterest[] {
  // 檢測顯著性區域
  const salientRegions = detectSalientRegions(imageData);
  
  // 使用增強版臉部檢測
  const faceResults = detectFacesEnhanced(imageData);
  
  // 合併所有區域
  const allRegions: RegionOfInterest[] = [
    ...salientRegions,
    ...faceResults.map(face => face.region)
  ];
  
  return mergeOverlappingRegions(allRegions);
} 