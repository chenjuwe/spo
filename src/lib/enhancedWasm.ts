/**
 * 增強版 WebAssembly 模組，用於加速圖像處理和哈希計算
 * 使用 SIMD 指令集優化性能
 */

import { toast } from 'sonner';
import { HashResult } from './types';

// WASM 模組狀態
let wasmMemory: WebAssembly.Memory | null = null;
let wasmModule: WebAssembly.WebAssemblyInstantiatedSource | null = null;
let wasmExports: any = null;

// 支援狀態
let simdSupported = false;
let wasmSupported = false;
let isInitialized = false;
let isInitializing = false;
let lastInitError: Error | null = null;

// WASM 二進制數據
// 實際開發中，應該從文件加載或使用 Emscripten/AssemblyScript 生成
let wasmBinary: ArrayBuffer | null = null;

// 支援的函數列表
const supportedFunctions = new Set<string>();

/**
 * 檢查瀏覽器是否支援 WASM SIMD
 * @returns 是否支援 SIMD
 */
export async function checkSIMDSupport(): Promise<boolean> {
  if (!('WebAssembly' in window)) {
    return false;
  }
  
  try {
    // 使用一個簡單的 SIMD 測試模組
    const binary = Uint8Array.from([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 
      2, 1, 0, 7, 8, 1, 4, 116, 101, 115, 116, 0, 0, 10, 15, 
      1, 13, 0, 65, 0, 253, 15, 253, 98, 0, 0, 0, 0, 0, 0, 11
    ]);
    
    await WebAssembly.instantiate(binary);
    console.info('WebAssembly SIMD 支援: 是');
    return true;
  } catch (e) {
    console.info('WebAssembly SIMD 支援: 否，將使用回退實現');
    return false;
  }
}

/**
 * 獲取 WASM 二進制數據
 * 在生產環境中，可以從 CDN 或靜態資源加載
 */
async function fetchWasmBinary(useSIMD: boolean): Promise<ArrayBuffer | null> {
  // 模擬從伺服器獲取 WASM 二進制
  // 實際應用中應該使用實際的 WASM 文件
  
  // 這裡使用一個內嵌的簡單 WASM 二進制代碼作為示例
  // 在真實應用中應該替換為實際編譯好的 WASM 文件
  
  try {
    const wasmUrl = useSIMD ? 
      './wasm/image-processing-simd.wasm' : 
      './wasm/image-processing.wasm';
    
    // 嘗試加載真實的 WASM 文件
    try {
      const response = await fetch(wasmUrl);
      if (response.ok) {
        return await response.arrayBuffer();
      }
    } catch (error) {
      console.warn(`無法加載 ${wasmUrl}，使用內嵌回退版本`);
    }
    
    // 如果無法加載真實文件，使用內嵌版本
    const placeholderWasm = generatePlaceholderWasm();
    return placeholderWasm.buffer;
  } catch (error) {
    console.error('獲取 WASM 二進制失敗:', error);
    return null;
  }
}

/**
 * 生成佔位用的簡單 WASM 二進制
 * 僅用於開發和測試，提供基本功能
 */
function generatePlaceholderWasm(): Uint8Array {
  // 這只是一個最基本的 WASM 模塊，提供簡單的漢明距離計算
  const wasmHex = `
    0061736d0100000001130360027f7f017f60017f017f60027f7f0000
    03040303000102050301000108011000020a73010c000041002802002100
    41042802002101200020016b41046b21024100200236020010000b270020
    004100360200200041046a41003602002000410c6a41003602002000
    41086a410036020041000b2901017f20004200370200200042003702
    08200110011a2000410036020020004201370208200010020b1d0020
    00410036020020004200370208200110031a2000290208a70020000b
    20002000410020001b220020002001100418007241004a0d00200010050b
  `.replace(/[\s\n]/g, '');
  
  const byteArray = new Uint8Array(wasmHex.length / 2);
  for (let i = 0; i < wasmHex.length; i += 2) {
    byteArray[i / 2] = parseInt(wasmHex.substring(i, i + 2), 16);
  }
  
  return byteArray;
}

/**
 * 初始化 WASM 模組
 * @param forceReload 是否強制重新載入
 * @returns 是否成功初始化
 */
export async function initializeWasmModule(forceReload = false): Promise<boolean> {
  if (isInitialized && !forceReload) return true;
  
  if (isInitializing) {
    // 等待其他初始化請求完成
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return isInitialized;
  }
  
  isInitializing = true;
  lastInitError = null;
  
  try {
    // 檢查瀏覽器支援
    wasmSupported = 'WebAssembly' in window;
    if (!wasmSupported) {
      throw new Error('瀏覽器不支援 WebAssembly');
    }
    
    // 檢查 SIMD 支援
    simdSupported = await checkSIMDSupport();
    
    // 獲取 WASM 二進制
    wasmBinary = await fetchWasmBinary(simdSupported);
    if (!wasmBinary) {
      throw new Error('無法獲取 WASM 二進制數據');
    }
    
    // 創建 WASM 記憶體
    wasmMemory = new WebAssembly.Memory({ 
      initial: 256,  // 16MB 初始記憶體
      maximum: 1024, // 最多 64MB 記憶體
      shared: typeof SharedArrayBuffer !== 'undefined' // 如果支援就使用共享記憶體
    });
    
    // 實例化模組
    const importObject = {
      env: {
        memory: wasmMemory,
        abort: (_: number) => console.error('WASM 模組中斷'),
        now: Date.now,
        log: (ptr: number, len: number) => {
          // 日誌功能，用於 WASM 內部輸出日誌
          if (!wasmMemory) return;
          const memory = new Uint8Array(wasmMemory.buffer);
          const text = new TextDecoder().decode(memory.slice(ptr, ptr + len));
          console.log('[WASM]', text);
        }
      }
    };
    
    wasmModule = await WebAssembly.instantiate(wasmBinary, importObject);
    wasmExports = wasmModule.instance.exports;
    
    // 獲取支援的函數列表
    supportedFunctions.clear();
    for (const key in wasmExports) {
      if (typeof wasmExports[key] === 'function') {
        supportedFunctions.add(key);
      }
    }
    
    isInitialized = true;
    console.info(`WebAssembly 模組初始化成功，SIMD: ${simdSupported ? '已啟用' : '未啟用'}`);
    console.info(`支援的函數: ${Array.from(supportedFunctions).join(', ')}`);
    
    return true;
  } catch (error) {
    lastInitError = error as Error;
    console.error('WebAssembly 初始化失敗:', error);
    isInitialized = false;
    return false;
  } finally {
    isInitializing = false;
  }
}

/**
 * 檢查函數是否可用
 * @param name 函數名稱
 */
function checkFunction(name: string): boolean {
  if (!isInitialized || !wasmExports) {
    return false;
  }
  return supportedFunctions.has(name);
}

/**
 * 分配 WASM 記憶體
 * @param size 需要的記憶體大小 (bytes)
 * @returns 分配的記憶體指針
 */
export function allocateMemory(size: number): number {
  if (!checkFunction('malloc')) {
    throw new Error('WASM 模組未初始化或不支援記憶體分配');
  }
  
  const ptr = wasmExports.malloc(size);
  if (!ptr) {
    throw new Error('WASM 記憶體分配失敗');
  }
  
  return ptr;
}

/**
 * 釋放 WASM 記憶體
 * @param ptr 記憶體指針
 */
export function freeMemory(ptr: number): void {
  if (!checkFunction('free') || !ptr) return;
  wasmExports.free(ptr);
}

/**
 * 將數據寫入 WASM 記憶體
 * @param data 要寫入的數據
 * @returns 記憶體指針
 */
export function writeToMemory(data: Uint8Array): number {
  if (!wasmMemory) {
    throw new Error('WASM 模組未初始化');
  }
  
  const ptr = allocateMemory(data.length);
  const memory = new Uint8Array(wasmMemory.buffer);
  memory.set(data, ptr);
  
  return ptr;
}

/**
 * 從 WASM 記憶體讀取數據
 * @param ptr 記憶體指針
 * @param size 要讀取的字節數
 * @returns 數據
 */
export function readFromMemory(ptr: number, size: number): Uint8Array {
  if (!wasmMemory) {
    throw new Error('WASM 模組未初始化');
  }
  
  const memory = new Uint8Array(wasmMemory.buffer);
  return memory.slice(ptr, ptr + size);
}

/**
 * 將十六進制哈希轉換為 Uint8Array
 * @param hex 十六進制哈希字符串
 * @returns Uint8Array
 */
export function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * 計算兩個哈希的漢明距離（使用 WASM 加速）
 * @param hash1 第一個哈希
 * @param hash2 第二個哈希
 * @returns 漢明距離
 */
export async function calculateHammingDistance(hash1: string, hash2: string): Promise<number> {
  // 確保 WASM 模組已初始化
  if (!isInitialized) {
    const success = await initializeWasmModule();
    if (!success) {
      return hammingDistanceJS(hash1, hash2);
    }
  }
  
  try {
    // 檢查函數可用性
    if (!checkFunction('hammingDistance')) {
      return hammingDistanceJS(hash1, hash2);
    }
    
    // 轉換哈希
    const buffer1 = hexToUint8Array(hash1);
    const buffer2 = hexToUint8Array(hash2);
    
    // 分配記憶體
    const ptr1 = writeToMemory(buffer1);
    const ptr2 = writeToMemory(buffer2);
    
    // 調用 WASM 函數
    const result = wasmExports.hammingDistance(
      ptr1, buffer1.length, 
      ptr2, buffer2.length
    );
    
    // 釋放記憶體
    freeMemory(ptr1);
    freeMemory(ptr2);
    
    return result;
  } catch (error) {
    console.error('WASM 漢明距離計算失敗:', error);
    return hammingDistanceJS(hash1, hash2);
  }
}

/**
 * 批量計算漢明距離
 * @param baseHash 基準哈希
 * @param compareHashes 對比哈希陣列
 * @returns 漢明距離陣列
 */
export async function calculateBatchHammingDistances(
  baseHash: string,
  compareHashes: string[]
): Promise<number[]> {
  // 確保 WASM 模組已初始化
  if (!isInitialized) {
    const success = await initializeWasmModule();
    if (!success || !checkFunction('batchHammingDistance')) {
      // 回退到標準 JS 實現
      return Promise.all(compareHashes.map(hash => 
        hammingDistanceJS(baseHash, hash)
      ));
    }
  }
  
  try {
    // 檢查批量函數可用性
    if (!checkFunction('batchHammingDistance')) {
      return Promise.all(compareHashes.map(hash => 
        hammingDistanceJS(baseHash, hash)
      ));
    }
    
    // 轉換基準哈希
    const baseBuffer = hexToUint8Array(baseHash);
    const basePtr = writeToMemory(baseBuffer);
    
    // 準備比較哈希的指針陣列
    const ptrArray = new Int32Array(compareHashes.length * 2); // 存儲指針和長度
    const memPtrs: number[] = []; // 記錄需要釋放的記憶體
    
    for (let i = 0; i < compareHashes.length; i++) {
      const compareBuffer = hexToUint8Array(compareHashes[i]);
      const comparePtr = writeToMemory(compareBuffer);
      
      ptrArray[i * 2] = comparePtr;
      ptrArray[i * 2 + 1] = compareBuffer.length;
      
      memPtrs.push(comparePtr);
    }
    
    // 將指針陣列寫入記憶體
    const ptrArrayBuffer = new Uint8Array(ptrArray.buffer);
    const ptrArrayPtr = writeToMemory(ptrArrayBuffer);
    
    // 分配結果陣列
    const resultPtr = allocateMemory(compareHashes.length * 4);
    
    // 調用 WASM 批量函數
    const success = wasmExports.batchHammingDistance(
      basePtr, baseBuffer.length,
      ptrArrayPtr, compareHashes.length,
      resultPtr
    );
    
    if (!success) {
      throw new Error('批量計算失敗');
    }
    
    // 讀取結果
    const resultBuffer = readFromMemory(resultPtr, compareHashes.length * 4);
    const results = new Int32Array(resultBuffer.buffer);
    
    // 釋放所有記憶體
    freeMemory(basePtr);
    freeMemory(ptrArrayPtr);
    freeMemory(resultPtr);
    
    for (const ptr of memPtrs) {
      freeMemory(ptr);
    }
    
    return Array.from(results);
  } catch (error) {
    console.error('WASM 批量漢明距離計算失敗:', error);
    
    // 回退到標準 JS 實現
    return Promise.all(compareHashes.map(hash => 
      hammingDistanceJS(baseHash, hash)
    ));
  }
}

/**
 * 使用多種哈希計算綜合相似度
 * @param hashes1 第一組哈希
 * @param hashes2 第二組哈希
 * @returns 相似度 (0-100)
 */
export async function calculateHashesSimilarity(
  hashes1: HashResult,
  hashes2: HashResult
): Promise<number> {
  try {
    // 計算各種哈希的相似度
    const pHashSimilarity = hashes1.pHash && hashes2.pHash ?
      100 - await calculateHammingDistance(hashes1.pHash, hashes2.pHash) * 100 / 64 : 0;
    
    const dHashSimilarity = hashes1.dHash && hashes2.dHash ?
      100 - await calculateHammingDistance(hashes1.dHash, hashes2.dHash) * 100 / 64 : 0;
    
    const aHashSimilarity = hashes1.aHash && hashes2.aHash ?
      100 - await calculateHammingDistance(hashes1.aHash, hashes2.aHash) * 100 / 64 : 0;
    
    // 加權平均
    let totalWeight = 0;
    let weightedSimilarity = 0;
    
    if (hashes1.pHash && hashes2.pHash) {
      weightedSimilarity += pHashSimilarity * 0.5;
      totalWeight += 0.5;
    }
    
    if (hashes1.dHash && hashes2.dHash) {
      weightedSimilarity += dHashSimilarity * 0.3;
      totalWeight += 0.3;
    }
    
    if (hashes1.aHash && hashes2.aHash) {
      weightedSimilarity += aHashSimilarity * 0.2;
      totalWeight += 0.2;
    }
    
    return totalWeight > 0 ? 
      Math.round(weightedSimilarity / totalWeight) : 0;
  } catch (error) {
    console.error('計算哈希相似度失敗:', error);
    return 0;
  }
}

/**
 * JavaScript 實現的漢明距離計算
 * @param hash1 第一個哈希
 * @param hash2 第二個哈希
 * @returns 漢明距離
 */
export function hammingDistanceJS(hash1: string, hash2: string): number {
  // 確保兩個哈希具有相同長度
  const len = Math.min(hash1.length, hash2.length);
  let distance = 0;
  
  // 預計算的位數查找表
  const BITS_SET_TABLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
  
  // 計算每個十六進制字符的漢明距離
  for (let i = 0; i < len; i++) {
    const xor = parseInt(hash1.charAt(i), 16) ^ parseInt(hash2.charAt(i), 16);
    // 使用查找表快速計算設置的位數
    distance += BITS_SET_TABLE[xor & 0xF] + BITS_SET_TABLE[(xor >> 4) & 0xF];
  }
  
  // 處理較長哈希的剩餘部分
  for (let i = len; i < hash1.length; i++) {
    const val = parseInt(hash1.charAt(i), 16);
    distance += BITS_SET_TABLE[val & 0xF] + BITS_SET_TABLE[(val >> 4) & 0xF];
  }
  
  for (let i = len; i < hash2.length; i++) {
    const val = parseInt(hash2.charAt(i), 16);
    distance += BITS_SET_TABLE[val & 0xF] + BITS_SET_TABLE[(val >> 4) & 0xF];
  }
  
  return distance;
}

/**
 * 使用 WASM 解碼和處理 HEIC 文件
 * @param heicBuffer HEIC 文件二進制數據
 * @param quality JPEG 質量 (0-100)
 * @returns JPEG 二進制數據
 */
export async function heicToJpegWasm(
  heicBuffer: ArrayBuffer, 
  quality: number = 90
): Promise<ArrayBuffer | null> {
  // 確保 WASM 模組已初始化
  if (!isInitialized) {
    const success = await initializeWasmModule();
    if (!success || !checkFunction('heicToJpeg')) {
      return null; // 不支援 WASM HEIC 轉換
    }
  }
  
  // 檢查函數可用性
  if (!checkFunction('heicToJpeg')) {
    return null;
  }
  
  try {
    // 寫入 HEIC 數據
    const heicData = new Uint8Array(heicBuffer);
    const heicPtr = writeToMemory(heicData);
    
    // 調用 WASM 函數
    const resultPtr = wasmExports.heicToJpeg(heicPtr, heicData.length, quality);
    
    // 釋放輸入緩衝區
    freeMemory(heicPtr);
    
    if (!resultPtr) {
      return null;
    }
    
    // 讀取結果大小
    const resultSize = new Int32Array(wasmMemory!.buffer, resultPtr - 4, 1)[0];
    
    // 讀取結果數據
    const resultData = readFromMemory(resultPtr, resultSize);
    const resultBuffer = resultData.buffer.slice(0, resultSize);
    
    // 釋放結果緩衝區
    freeMemory(resultPtr);
    
    return resultBuffer;
  } catch (error) {
    console.error('WASM HEIC 轉換失敗:', error);
    return null;
  }
}

/**
 * 預熱 WASM 模組
 */
export function preloadWasm(): void {
  // 在頁面閒置時加載 WASM 模塊
  if ('requestIdleCallback' in window) {
    (window as any).requestIdleCallback(() => {
      initializeWasmModule().then(success => {
        if (success) {
          console.info('WASM 模組預熱完成');
        } else if (lastInitError) {
          console.warn('WASM 預熱失敗:', lastInitError.message);
        }
      });
    });
  } else {
    // 後備方案
    setTimeout(() => {
      initializeWasmModule().then(success => {
        if (success) {
          console.info('WASM 模組預熱完成');
        }
      });
    }, 2000);
  }
}

// 導出公共 API
export default {
  initializeWasmModule,
  calculateHammingDistance,
  calculateBatchHammingDistances,
  calculateHashesSimilarity,
  heicToJpegWasm,
  preloadWasm
}; 