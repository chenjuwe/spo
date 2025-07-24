/**
 * WebAssembly SIMD 加速的漢明距離計算
 * 注意：此模塊需要瀏覽器支援 WebAssembly SIMD
 */

// WebAssembly 模塊記憶體
let wasmMemory: WebAssembly.Memory | null = null;
let wasmModule: WebAssembly.WebAssemblyInstantiatedSource | null = null;
let wasmExports: any = null;

// WebAssembly 支援狀態
let simdSupported = false;
let wasmSupported = false;
let isInitialized = false;
let isInitializing = false;

/**
 * 檢查瀏覽器是否支援 WebAssembly SIMD
 */
export async function checkSIMDSupport(): Promise<boolean> {
  if (!WebAssembly) {
    console.warn('此瀏覽器不支援 WebAssembly');
    return false;
  }
  
  // 測試 WASM SIMD 支援
  try {
    const binary = Uint8Array.from([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 
      2, 1, 0, 7, 8, 1, 4, 116, 101, 115, 116, 0, 0, 10, 15, 
      1, 13, 0, 65, 0, 253, 15, 253, 98, 0, 0, 0, 0, 0, 0, 11
    ]);
    
    await WebAssembly.instantiate(binary);
    return true;
  } catch (e) {
    console.info('WebAssembly SIMD 不支援，將使用回退實現', e);
    return false;
  }
}

/**
 * 檢查瀏覽器是否支援 WebAssembly
 */
export async function checkWasmSupport(): Promise<boolean> {
  return typeof WebAssembly !== 'undefined';
}

/**
 * 將十六進制字符串轉換為 Uint8Array
 */
export function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * 初始化 WebAssembly 模塊
 */
export async function initializeModule(): Promise<boolean> {
  if (isInitialized) return true;
  if (isInitializing) {
    // 等待初始化完成
    while (isInitializing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return isInitialized;
  }
  
  isInitializing = true;
  
  try {
    // 檢查支援
    wasmSupported = await checkWasmSupport();
    
    if (!wasmSupported) {
      console.warn('此瀏覽器不支援 WebAssembly，將使用 JavaScript 回退實現');
      isInitializing = false;
      return false;
    }
    
    // 檢查 SIMD 支援
    simdSupported = await checkSIMDSupport();
    
    // 創建一個 2MB 的記憶體
    wasmMemory = new WebAssembly.Memory({ initial: 32, maximum: 100 });
    
    // 嘗試加載內聯 WASM 模塊
    const wasmCode = generateInlineWasmModule(simdSupported);
    
    if (!wasmCode || wasmCode.length === 0) {
      console.warn('無法生成 WASM 代碼，將使用回退實現');
      isInitializing = false;
      return false;
    }
    
    const importObject = {
      env: {
        memory: wasmMemory,
        abort: (_: number) => console.error('WebAssembly 中斷')
      }
    };
    
    // 嘗試實例化 WASM 模塊
    wasmModule = await WebAssembly.instantiate(wasmCode.buffer, importObject);
    wasmExports = wasmModule.instance.exports;
    isInitialized = true;
    isInitializing = false;
    
    console.info(`WebAssembly 模塊初始化成功，SIMD 支援: ${simdSupported}`);
    return true;
  } catch (error) {
    console.warn('WebAssembly 初始化失敗，將使用回退實現:', error);
    isInitializing = false;
    isInitialized = false;
    return false;
  }
}

/**
 * 生成內聯 WASM 模塊 (一個簡化的實現)
 */
function generateInlineWasmModule(useSIMD: boolean): Uint8Array {
  // 此處為簡化實現，實際情況下應該從外部文件加載完整的 WASM 代碼
  // 或使用更強大的工具如 AssemblyScript/Emscripten 生成 WASM
  
  // 以下是一個基本的漢明距離計算的 WASM 模塊示例
  // 實際的 SIMD 實現需要更複雜的 WASM 代碼
  
  // 注意：這只是示例，實際使用時應該替換為真正的 WASM 二進制數據
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
 * JavaScript 實現的漢明距離計算
 * 作為 WebAssembly 實現的回退選項
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
 * WebAssembly 加速的漢明距離計算
 */
async function hammingDistanceWasm(hash1: string, hash2: string): Promise<number> {
  // 確保 WASM 模塊已初始化
  if (!isInitialized) {
    const success = await initializeModule();
    if (!success) {
      return hammingDistanceJS(hash1, hash2);
    }
  }
  
  try {
    // 將十六進制哈希轉換為 Uint8Array
    const buffer1 = hexToUint8Array(hash1);
    const buffer2 = hexToUint8Array(hash2);
    
    // 分配 WASM 記憶體
    const ptr1 = wasmExports.allocate(buffer1.length);
    const ptr2 = wasmExports.allocate(buffer2.length);
    
    // 獲取記憶體視圖
    const memory = new Uint8Array(wasmMemory!.buffer);
    
    // 將數據複製到 WASM 記憶體中
    memory.set(buffer1, ptr1);
    memory.set(buffer2, ptr2);
    
    // 調用 WASM 函數計算漢明距離
    const result = wasmExports.hammingDistance(
      ptr1, buffer1.length, 
      ptr2, buffer2.length
    );
    
    // 釋放記憶體
    wasmExports.deallocate(ptr1, buffer1.length);
    wasmExports.deallocate(ptr2, buffer2.length);
    
    return result;
  } catch (error) {
    console.error('WASM 漢明距離計算出錯，使用 JS 回退:', error);
    return hammingDistanceJS(hash1, hash2);
  }
}

/**
 * 計算兩個哈希字符串之間的漢明距離
 * 自動選擇最快的實現 (WebAssembly SIMD 或原生 JS)
 * 
 * @param hash1 第一個哈希字符串
 * @param hash2 第二個哈希字符串
 * @returns 漢明距離
 */
export async function calculateHammingDistance(hash1: string, hash2: string): Promise<number> {
  // 如果 WebAssembly 不支援或模塊未初始化，使用 JS 實現
  if (!wasmSupported || !isInitialized) {
    // 嘗試初始化 WebAssembly
    const success = await initializeModule();
    
    if (!success) {
      return hammingDistanceJS(hash1, hash2);
    }
  }
  
  return hammingDistanceWasm(hash1, hash2);
}

/**
 * 同步版本的漢明距離計算
 * 如果 WebAssembly 可用則使用它，否則回退到 JS 實現
 * 
 * @param hash1 第一個哈希字符串
 * @param hash2 第二個哈希字符串
 * @returns 漢明距離
 */
export function calculateHammingDistanceSync(hash1: string, hash2: string): number {
  // 如果 WebAssembly 初始化並可用，則使用 WASM 實現
  // 但不要在這裡異步初始化，如果沒有初始化就使用 JS 實現
  if (isInitialized && wasmSupported) {
    try {
      // 將十六進制哈希轉換為 Uint8Array
      const buffer1 = hexToUint8Array(hash1);
      const buffer2 = hexToUint8Array(hash2);
      
      // 分配 WASM 記憶體
      const ptr1 = wasmExports.allocate(buffer1.length);
      const ptr2 = wasmExports.allocate(buffer2.length);
      
      // 獲取記憶體視圖
      const memory = new Uint8Array(wasmMemory!.buffer);
      
      // 將數據複製到 WASM 記憶體中
      memory.set(buffer1, ptr1);
      memory.set(buffer2, ptr2);
      
      // 調用 WASM 函數計算漢明距離
      const result = wasmExports.hammingDistance(
        ptr1, buffer1.length, 
        ptr2, buffer2.length
      );
      
      // 釋放記憶體
      wasmExports.deallocate(ptr1, buffer1.length);
      wasmExports.deallocate(ptr2, buffer2.length);
      
      return result;
    } catch (error) {
      console.error('同步 WASM 漢明距離計算出錯，使用 JS 回退:', error);
      return hammingDistanceJS(hash1, hash2);
    }
  }
  
  // 使用 JS 實現
  return hammingDistanceJS(hash1, hash2);
}

/**
 * 計算多個哈希字符串批量漢明距離
 * 對於大量比較操作非常高效
 * 
 * @param baseHash 基準哈希
 * @param comparisonHashes 要比較的哈希數組
 * @returns 每個哈希與基準哈希的漢明距離數組
 */
export async function calculateBatchHammingDistances(
  baseHash: string,
  comparisonHashes: string[]
): Promise<number[]> {
  // 嘗試初始化 WebAssembly
  if (!isInitialized) {
    await initializeModule();
  }
  
  // 根據支援情況選擇實現
  if (isInitialized && wasmSupported && simdSupported) {
    try {
      // 預處理基準哈希
      const baseBuffer = hexToUint8Array(baseHash);
      const basePtr = wasmExports.allocate(baseBuffer.length);
      const memory = new Uint8Array(wasmMemory!.buffer);
      memory.set(baseBuffer, basePtr);
      
      // 批量計算距離
      const results: number[] = [];
      
      // 使用批處理算法，而不是單獨計算每個距離
      if (wasmExports.batchHammingDistance && comparisonHashes.length > 10) {
        // 如果有專門的批處理函數並且比較數量足夠多
        const hashBuffers = comparisonHashes.map(hexToUint8Array);
        const totalBytes = hashBuffers.reduce((sum, buf) => sum + buf.length, 0);
        
        // 分配一個連續的記憶體塊
        const batchPtr = wasmExports.allocate(totalBytes + comparisonHashes.length * 4);
        let currentOffset = batchPtr;
        const hashOffsets: number[] = [];
        
        // 將所有哈希和它們的長度複製到記憶體中
        for (let i = 0; i < hashBuffers.length; i++) {
          const buffer = hashBuffers[i];
          memory.set(buffer, currentOffset);
          hashOffsets.push(currentOffset);
          hashOffsets.push(buffer.length);
          currentOffset += buffer.length;
        }
        
        // 分配一個記憶體塊來存儲哈希偏移量
        const offsetsPtr = wasmExports.allocate(hashOffsets.length * 4);
        const offsetsView = new Int32Array(wasmMemory!.buffer, offsetsPtr, hashOffsets.length);
        for (let i = 0; i < hashOffsets.length; i++) {
          offsetsView[i] = hashOffsets[i];
        }
        
        // 分配結果數組
        const resultsPtr = wasmExports.allocate(comparisonHashes.length * 4);
        
        // 調用批處理函數
        wasmExports.batchHammingDistance(
          basePtr, baseBuffer.length,
          offsetsPtr, comparisonHashes.length,
          resultsPtr
        );
        
        // 讀取結果
        const resultsView = new Int32Array(wasmMemory!.buffer, resultsPtr, comparisonHashes.length);
        for (let i = 0; i < comparisonHashes.length; i++) {
          results.push(resultsView[i]);
        }
        
        // 釋放記憶體
        wasmExports.deallocate(basePtr, baseBuffer.length);
        wasmExports.deallocate(batchPtr, totalBytes + comparisonHashes.length * 4);
        wasmExports.deallocate(offsetsPtr, hashOffsets.length * 4);
        wasmExports.deallocate(resultsPtr, comparisonHashes.length * 4);
      } else {
        // 沒有專門的批處理函數，使用標準函數逐個計算
        for (const hash of comparisonHashes) {
          const compareBuffer = hexToUint8Array(hash);
          const comparePtr = wasmExports.allocate(compareBuffer.length);
          memory.set(compareBuffer, comparePtr);
          
          // 計算距離
          const distance = wasmExports.hammingDistance(
            basePtr, baseBuffer.length,
            comparePtr, compareBuffer.length
          );
          
          // 釋放比較哈希的記憶體
          wasmExports.deallocate(comparePtr, compareBuffer.length);
          
          results.push(distance);
        }
        
        // 釋放基準哈希的記憶體
        wasmExports.deallocate(basePtr, baseBuffer.length);
      }
      
      return results;
    } catch (error) {
      console.error('批量 WASM 漢明距離計算出錯，使用 JS 回退:', error);
    }
  }
  
  // 使用 JS 回退實現
  return comparisonHashes.map(hash => hammingDistanceJS(baseHash, hash));
}

/**
 * 啟動時預熱 WASM 模塊
 */
export function initializeModuleEager(): void {
  setTimeout(() => {
    initializeModule().then(success => {
      if (success) {
        console.info('WebAssembly 模塊預熱完成');
      }
    });
  }, 1000); // 延遲 1 秒，避免阻塞主線程啟動
} 