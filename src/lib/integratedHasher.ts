/**
 * 整合式哈希計算模塊
 * 優化圖片哈希計算效率，同時計算多種哈希以減少重複操作
 */

/**
 * 哈希類型
 */
export enum HashType {
  AHASH = 'aHash',
  DHASH = 'dHash',
  PHASH = 'pHash'
}

/**
 * 哈希結果接口
 */
export interface HashResult {
  aHash?: string;
  dHash?: string;
  pHash?: string;
}

/**
 * 哈希計算選項
 */
export interface HashOptions {
  size?: number;        // 縮放尺寸 (通常為 8 或 16)
  includeAHash?: boolean;
  includeDHash?: boolean;
  includePHash?: boolean;
  convertToGrayscale?: boolean;
  precise?: boolean;    // 是否使用更精確的算法 (可能更慢)
}

/**
 * 默認哈希選項
 */
export const DEFAULT_HASH_OPTIONS: HashOptions = {
  size: 8,
  includeAHash: true,
  includeDHash: true,
  includePHash: true,
  convertToGrayscale: true,
  precise: false
};

/**
 * 計算多個圖像哈希
 * 通過共享圖像處理步驟來提高效率
 * 
 * @param imageData ImageData 數據
 * @param options 哈希計算選項
 * @returns 包含多個哈希的結果對象
 */
export function calculateMultipleHashes(
  imageData: ImageData,
  options: HashOptions = DEFAULT_HASH_OPTIONS
): HashResult {
  const result: HashResult = {};
  const size = options.size || 8;
  
  // 準備圖像數據
  const { grayscaleData, width, height } = prepareImageData(imageData, options);
  
  // 縮放圖像 (共用此操作以提高效率)
  const scaledData = resizeImageData(grayscaleData, width, height, size, size);
  
  // 計算請求的哈希值
  if (options.includeAHash || options.includeAHash === undefined) {
    result.aHash = calculateAverageHash(scaledData, size);
  }
  
  if (options.includeDHash || options.includeDHash === undefined) {
    result.dHash = calculateDifferenceHash(scaledData, size);
  }
  
  if (options.includePHash || options.includePHash === undefined) {
    result.pHash = calculatePerceptualHash(scaledData, size, options.precise);
  }
  
  return result;
}

/**
 * 準備圖像數據
 * @param imageData 原始圖像數據
 * @param options 選項
 * @returns 預處理的圖像數據
 */
function prepareImageData(
  imageData: ImageData,
  options: HashOptions
): { grayscaleData: Uint8ClampedArray, width: number, height: number } {
  const { width, height, data } = imageData;
  
  // 如果不需要灰階轉換，直接返回原始數據
  if (!options.convertToGrayscale) {
    return { grayscaleData: data, width, height };
  }
  
  // 轉換為灰階
  const grayscaleData = new Uint8ClampedArray(width * height);
  
  // 使用明亮度加權公式: Y = 0.299*R + 0.587*G + 0.114*B
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    
    const grayValue = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    grayscaleData[i / 4] = grayValue;
  }
  
  return { grayscaleData, width, height };
}

/**
 * 縮放圖像數據
 * 使用雙線性插值來獲得更好的結果
 */
function resizeImageData(
  data: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  destWidth: number,
  destHeight: number
): Uint8ClampedArray {
  const result = new Uint8ClampedArray(destWidth * destHeight);
  
  const xRatio = srcWidth / destWidth;
  const yRatio = srcHeight / destHeight;
  
  // 使用雙線性插值進行縮放
  for (let y = 0; y < destHeight; y++) {
    for (let x = 0; x < destWidth; x++) {
      const srcX = x * xRatio;
      const srcY = y * yRatio;
      
      const x1 = Math.floor(srcX);
      const y1 = Math.floor(srcY);
      const x2 = Math.min(x1 + 1, srcWidth - 1);
      const y2 = Math.min(y1 + 1, srcHeight - 1);
      
      // 計算插值權重
      const xWeight = srcX - x1;
      const yWeight = srcY - y1;
      
      // 獲取四個相鄰像素
      const p1 = data[y1 * srcWidth + x1];
      const p2 = data[y1 * srcWidth + x2];
      const p3 = data[y2 * srcWidth + x1];
      const p4 = data[y2 * srcWidth + x2];
      
      // 雙線性插值
      const value = Math.round(
        p1 * (1 - xWeight) * (1 - yWeight) +
        p2 * xWeight * (1 - yWeight) +
        p3 * (1 - xWeight) * yWeight +
        p4 * xWeight * yWeight
      );
      
      result[y * destWidth + x] = value;
    }
  }
  
  return result;
}

/**
 * 計算平均哈希 (aHash)
 */
function calculateAverageHash(data: Uint8ClampedArray, size: number): string {
  // 計算所有像素的平均值
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }
  const avg = sum / data.length;
  
  // 基於平均值生成位圖
  let hashValue = 0n;
  for (let i = 0; i < data.length; i++) {
    if (data[i] >= avg) {
      hashValue |= 1n << BigInt(i);
    }
  }
  
  // 將 BigInt 轉換為十六進制字符串
  return hashValue.toString(16).padStart(size * size / 4, '0');
}

/**
 * 計算差值哈希 (dHash)
 */
function calculateDifferenceHash(data: Uint8ClampedArray, size: number): string {
  // 比較相鄰像素差異來生成哈希
  let hashValue = 0n;
  let bitPos = 0;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size - 1; x++) {
      const idx = y * size + x;
      const rightIdx = y * size + x + 1;
      
      if (data[idx] > data[rightIdx]) {
        hashValue |= 1n << BigInt(bitPos);
      }
      
      bitPos++;
    }
  }
  
  // 將 BigInt 轉換為十六進制字符串
  const hexLength = Math.ceil(size * (size - 1) / 4);
  return hashValue.toString(16).padStart(hexLength, '0');
}

/**
 * 計算感知哈希 (pHash)
 */
function calculatePerceptualHash(
  data: Uint8ClampedArray, 
  size: number,
  precise: boolean = false
): string {
  // 如果需要精確的 pHash，使用 DCT 變換
  if (precise && size >= 32) {
    return calculateDCTHash(data, size);
  }
  
  // 簡化版的 pHash 計算
  // 1. 計算整個圖像的平均值
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
  }
  const totalAvg = sum / data.length;
  
  // 2. 將圖像分為多個區塊並計算每個區塊的平均值
  const blockSize = Math.max(2, Math.floor(size / 4));
  const blockData = new Uint8ClampedArray(size * size);
  
  for (let y = 0; y < size; y += blockSize) {
    for (let x = 0; x < size; x += blockSize) {
      let blockSum = 0;
      let blockCount = 0;
      
      // 計算區塊平均值
      for (let by = 0; by < blockSize && y + by < size; by++) {
        for (let bx = 0; bx < blockSize && x + bx < size; bx++) {
          const idx = (y + by) * size + (x + bx);
          blockSum += data[idx];
          blockCount++;
        }
      }
      
      const blockAvg = blockSum / blockCount;
      
      // 填充區塊數據
      for (let by = 0; by < blockSize && y + by < size; by++) {
        for (let bx = 0; bx < blockSize && x + bx < size; bx++) {
          const idx = (y + by) * size + (x + bx);
          // 使用相對於總體平均值的差異
          blockData[idx] = data[idx] > blockAvg ? 255 : 0;
        }
      }
    }
  }
  
  // 3. 生成哈希
  let hashValue = 0n;
  for (let i = 0; i < blockData.length; i++) {
    if (blockData[i] > totalAvg) {
      hashValue |= 1n << BigInt(i);
    }
  }
  
  // 將 BigInt 轉換為十六進制字符串
  return hashValue.toString(16).padStart(size * size / 4, '0');
}

/**
 * 使用 DCT 變換計算感知哈希
 * 更精確但計算成本較高
 */
function calculateDCTHash(data: Uint8ClampedArray, size: number): string {
  // 應用離散餘弦變換 (DCT)
  const dct = applyDCT(data, size, size);
  
  // 截取 DCT 的左上角 (低頻部分)
  const reducedSize = Math.min(8, Math.floor(size / 2));
  const dctData = new Float32Array(reducedSize * reducedSize);
  
  for (let y = 0; y < reducedSize; y++) {
    for (let x = 0; x < reducedSize; x++) {
      dctData[y * reducedSize + x] = dct[y * size + x];
    }
  }
  
  // 跳過 DC 係數 (左上角第一個值)，計算其餘係數的平均值
  let sum = 0;
  for (let i = 1; i < dctData.length; i++) {
    sum += dctData[i];
  }
  const avg = sum / (dctData.length - 1);
  
  // 生成哈希
  let hashValue = 0n;
  for (let i = 0; i < dctData.length; i++) {
    // 跳過 DC 係數
    if (i > 0 && dctData[i] > avg) {
      hashValue |= 1n << BigInt(i - 1);
    }
  }
  
  // 將 BigInt 轉換為十六進制字符串
  const hexLength = Math.ceil((dctData.length - 1) / 4);
  return hashValue.toString(16).padStart(hexLength, '0');
}

/**
 * 應用離散餘弦變換 (DCT)
 */
function applyDCT(data: Uint8ClampedArray, width: number, height: number): Float32Array {
  const size = width; // 假設圖像是正方形
  const result = new Float32Array(size * size);
  
  // 對於每個頻率坐標 (u, v)
  for (let v = 0; v < size; v++) {
    for (let u = 0; u < size; u++) {
      let sum = 0;
      
      // 對於每個像素坐標 (x, y)
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const pixel = data[y * size + x];
          
          // DCT 基本方程
          const cosU = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * size));
          const cosV = Math.cos(((2 * y + 1) * v * Math.PI) / (2 * size));
          
          sum += pixel * cosU * cosV;
        }
      }
      
      // 應用 DCT 係數
      let coefficient = 0;
      if (u === 0) coefficient = 1 / Math.sqrt(size);
      else coefficient = Math.sqrt(2) / Math.sqrt(size);
      
      if (v === 0) coefficient *= 1 / Math.sqrt(size);
      else coefficient *= Math.sqrt(2) / Math.sqrt(size);
      
      result[v * size + u] = sum * coefficient;
    }
  }
  
  return result;
}

/**
 * 計算漢明距離 - 用於比較哈希的相似度
 * 使用位操作以提高效率
 * 
 * @param hash1 第一個哈希字符串 (16進制)
 * @param hash2 第二個哈希字符串 (16進制)
 * @returns 漢明距離
 */
export function calculateHammingDistance(hash1: string, hash2: string): number {
  // 確保兩個哈希長度相同
  const maxLength = Math.max(hash1.length, hash2.length);
  const paddedHash1 = hash1.padStart(maxLength, '0');
  const paddedHash2 = hash2.padStart(maxLength, '0');
  
  let distance = 0;
  
  // 遍歷每個十六進制字符
  for (let i = 0; i < maxLength; i++) {
    // 將十六進制字符轉換為整數
    const byte1 = parseInt(paddedHash1.charAt(i), 16);
    const byte2 = parseInt(paddedHash2.charAt(i), 16);
    
    // 計算 XOR，然後計算設置的位數
    const xor = byte1 ^ byte2;
    
    // 查表計算位數 - 這比循環計算更高效
    distance += BITS_SET_TABLE[xor];
  }
  
  return distance;
}

/**
 * 預計算的位數查找表 (0-15 的每個數字中設置的位數)
 */
const BITS_SET_TABLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/**
 * 計算加權漢明距離 - 對不同哈希類型應用不同權重
 * 
 * @param hash1 第一個哈希結果
 * @param hash2 第二個哈希結果
 * @param weights 不同哈希類型的權重
 * @returns 加權漢明距離
 */
export function calculateWeightedHammingDistance(
  hash1: HashResult,
  hash2: HashResult,
  weights: { [key in HashType]?: number } = { 
    [HashType.AHASH]: 0.25, 
    [HashType.DHASH]: 0.35, 
    [HashType.PHASH]: 0.40 
  }
): number {
  let totalDistance = 0;
  let totalWeight = 0;
  
  // 計算 aHash 距離
  if (hash1.aHash && hash2.aHash && weights[HashType.AHASH]) {
    const distance = calculateHammingDistance(hash1.aHash, hash2.aHash);
    const weight = weights[HashType.AHASH]!;
    totalDistance += distance * weight;
    totalWeight += weight;
  }
  
  // 計算 dHash 距離
  if (hash1.dHash && hash2.dHash && weights[HashType.DHASH]) {
    const distance = calculateHammingDistance(hash1.dHash, hash2.dHash);
    const weight = weights[HashType.DHASH]!;
    totalDistance += distance * weight;
    totalWeight += weight;
  }
  
  // 計算 pHash 距離
  if (hash1.pHash && hash2.pHash && weights[HashType.PHASH]) {
    const distance = calculateHammingDistance(hash1.pHash, hash2.pHash);
    const weight = weights[HashType.PHASH]!;
    totalDistance += distance * weight;
    totalWeight += weight;
  }
  
  // 如果沒有共同的哈希類型，返回最大距離
  if (totalWeight === 0) return Number.MAX_SAFE_INTEGER;
  
  // 返回加權平均距離
  return totalDistance / totalWeight;
}

/**
 * 計算哈希相似度
 * 
 * @param hash1 第一個哈希結果
 * @param hash2 第二個哈希結果
 * @param weights 不同哈希類型的權重
 * @returns 相似度百分比 (0-100)
 */
export function calculateHashSimilarity(
  hash1: HashResult,
  hash2: HashResult,
  weights?: { [key in HashType]?: number }
): number {
  const distance = calculateWeightedHammingDistance(hash1, hash2, weights);
  
  // 估計哈希的最大長度
  let maxBits = 0;
  
  // 計算所有哈希的總位數
  if (hash1.aHash && hash2.aHash) {
    maxBits += hash1.aHash.length * 4; // 每個十六進制字符代表4位
  }
  
  if (hash1.dHash && hash2.dHash) {
    maxBits += hash1.dHash.length * 4;
  }
  
  if (hash1.pHash && hash2.pHash) {
    maxBits += hash1.pHash.length * 4;
  }
  
  // 如果沒有可比較的哈希，返回 0% 相似度
  if (maxBits === 0) return 0;
  
  // 計算相似度百分比
  const similarity = 100 * (1 - distance / maxBits);
  
  // 確保結果在 0-100 範圍內
  return Math.max(0, Math.min(100, similarity));
} 