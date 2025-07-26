/**
 * WebGPU 加速的哈希比較模塊
 * 提供基於 GPU 的高效能漢明距離計算
 */

import { getWebGPUContext } from './webGpuAcceleration';
import { calculateHammingDistanceSync, hammingDistanceJS } from './wasmHashCompare';

// 是否已初始化 WebGPU
let gpuInitialized = false;

// 預先編譯的 GPU 哈希比較管線
let hammingDistancePipeline: GPUComputePipeline | null = null;

// 默認工作組大小
const DEFAULT_WORKGROUP_SIZE = 256;

/**
 * WebGPU 漢明距離計算的 WGSL 著色器代碼
 */
const HAMMING_DISTANCE_SHADER = `
@group(0) @binding(0) var<storage, read> inputA: array<u32>;
@group(0) @binding(1) var<storage, read> inputB: array<u32>;
@group(0) @binding(2) var<storage, read_write> output: array<u32>;

// 每個工作組的大小
const WORKGROUP_SIZE: u32 = ${DEFAULT_WORKGROUP_SIZE};

// 計算 32 位整數中設置的位數（位計數）
fn popcount(x: u32) -> u32 {
  // Brian Kernighan 算法（最優位計數）
  var count: u32 = 0u;
  var n = x;
  while (n != 0u) {
    n &= n - 1u;  // 清除最低設置位
    count += 1u;
  }
  return count;
}

// 計算兩個哈希數組之間的漢明距離
@compute @workgroup_size(WORKGROUP_SIZE)
fn computeHammingDistance(
  @builtin(global_invocation_id) global_id: vec3<u32>
) {
  let idx = global_id.x;
  if (idx >= arrayLength(&output)) {
    return; // 避免越界
  }
  
  // 這裡處理的是每個 u32 值之間的比較
  let xor_result = inputA[idx] ^ inputB[idx];
  output[idx] = popcount(xor_result);
}

// 批量計算漢明距離（一對多比較）
@compute @workgroup_size(WORKGROUP_SIZE)
fn batchHammingDistance(
  @builtin(global_invocation_id) global_id: vec3<u32>
) {
  let idx = global_id.x;
  if (idx >= arrayLength(&output)) {
    return; // 避免越界
  }
  
  // 計算一個哈希與多個哈希之間的距離
  let hashLen = arrayLength(&inputA) / arrayLength(&output);
  var distance: u32 = 0u;
  
  for (var i: u32 = 0u; i < hashLen; i++) {
    let baseIdx = i;
    let compareIdx = idx * hashLen + i;
    if (compareIdx < arrayLength(&inputB)) {
      let xor_result = inputA[baseIdx] ^ inputB[compareIdx];
      distance += popcount(xor_result);
    }
  }
  
  output[idx] = distance;
}
`;

/**
 * 初始化 GPU 哈希比較
 * @returns 是否初始化成功
 */
export async function initializeGPUHashCompare(): Promise<boolean> {
  if (gpuInitialized) return true;
  
  try {
    const context = getWebGPUContext();
    const support = await context.checkSupport();
    
    if (!support.supported) {
      console.info('此瀏覽器不支援 WebGPU，將使用回退實現');
      return false;
    }
    
    // 初始化 WebGPU
    const initialized = await context.initialize();
    if (!initialized) {
      console.warn('WebGPU 初始化失敗，將使用回退實現');
      return false;
    }
    
    const device = context.getDevice();
    if (!device) {
      console.warn('無法獲取 GPU 裝置，將使用回退實現');
      return false;
    }
    
    // 創建管線
    hammingDistancePipeline = await createHammingDistancePipeline(device);
    
    gpuInitialized = hammingDistancePipeline !== null;
    
    if (gpuInitialized) {
      console.info('GPU 哈希比較管線初始化成功');
    } else {
      console.warn('GPU 哈希比較管線創建失敗，將使用回退實現');
    }
    
    return gpuInitialized;
  } catch (error) {
    console.error('初始化 GPU 哈希比較失敗:', error);
    return false;
  }
}

/**
 * 創建漢明距離計算管線
 * @param device GPU 裝置
 * @returns 計算管線
 */
async function createHammingDistancePipeline(
  device: GPUDevice
): Promise<GPUComputePipeline | null> {
  try {
    // 創建著色器模塊
    const shaderModule = device.createShaderModule({
      code: HAMMING_DISTANCE_SHADER
    });
    
    // 創建綁定組佈局
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" }
        }
      ]
    });
    
    // 創建管線佈局
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });
    
    // 創建計算管線
    const pipeline = await device.createComputePipelineAsync({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: "computeHammingDistance"
      }
    });
    
    return pipeline;
  } catch (error) {
    console.error('創建漢明距離管線失敗:', error);
    return null;
  }
}

/**
 * 創建批量漢明距離計算管線
 * @param device GPU 裝置
 * @returns 計算管線
 */
async function createBatchHammingDistancePipeline(
  device: GPUDevice
): Promise<GPUComputePipeline | null> {
  try {
    // 創建著色器模塊
    const shaderModule = device.createShaderModule({
      code: HAMMING_DISTANCE_SHADER
    });
    
    // 創建綁定組佈局
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" }
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" }
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" }
        }
      ]
    });
    
    // 創建管線佈局
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout]
    });
    
    // 創建計算管線
    const pipeline = await device.createComputePipelineAsync({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: "batchHammingDistance"
      }
    });
    
    return pipeline;
  } catch (error) {
    console.error('創建批量漢明距離管線失敗:', error);
    return null;
  }
}

/**
 * 將十六進制字符串轉換為 Uint32Array
 * @param hexHash 十六進制哈希字符串
 * @returns Uint32Array 表示
 */
function hexHashToUint32Array(hexHash: string): Uint32Array {
  // 確保長度是 8 的倍數（每 8 個十六進制字符構成一個 32 位整數）
  const paddedHex = hexHash.padEnd(Math.ceil(hexHash.length / 8) * 8, '0');
  const uint32Array = new Uint32Array(paddedHex.length / 8);
  
  for (let i = 0; i < paddedHex.length; i += 8) {
    const hexChunk = paddedHex.substring(i, i + 8);
    uint32Array[i / 8] = parseInt(hexChunk, 16);
  }
  
  return uint32Array;
}

/**
 * 使用 GPU 計算兩個哈希之間的漢明距離
 * @param hash1 第一個哈希字符串
 * @param hash2 第二個哈希字符串
 * @returns 漢明距離
 */
export async function calculateHammingDistanceGPU(
  hash1: string,
  hash2: string
): Promise<number> {
  // 如果 GPU 未初始化，嘗試初始化
  if (!gpuInitialized) {
    const initialized = await initializeGPUHashCompare();
    if (!initialized) {
      // 回退到 WebAssembly 或 JS 實現
      return calculateHammingDistanceSync(hash1, hash2);
    }
  }
  
  try {
    // 獲取 GPU 上下文
    const context = getWebGPUContext();
    const device = context.getDevice();
    
    if (!device || !hammingDistancePipeline) {
      // 回退到 WebAssembly 或 JS 實現
      return calculateHammingDistanceSync(hash1, hash2);
    }
    
    // 轉換哈希為 Uint32Array
    const hash1Array = hexHashToUint32Array(hash1);
    const hash2Array = hexHashToUint32Array(hash2);
    
    // 確保兩個數組具有相同長度
    const maxLength = Math.max(hash1Array.length, hash2Array.length);
    const alignedHash1 = new Uint32Array(maxLength);
    const alignedHash2 = new Uint32Array(maxLength);
    
    alignedHash1.set(hash1Array);
    alignedHash2.set(hash2Array);
    
    // 創建緩衝區
    const inputBufferA = device.createBuffer({
      size: alignedHash1.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(inputBufferA.getMappedRange()).set(alignedHash1);
    inputBufferA.unmap();
    
    const inputBufferB = device.createBuffer({
      size: alignedHash2.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(inputBufferB.getMappedRange()).set(alignedHash2);
    inputBufferB.unmap();
    
    // 創建輸出緩衝區
    const outputBuffer = device.createBuffer({
      size: maxLength * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    // 創建綁定組
    const bindGroup = device.createBindGroup({
      layout: hammingDistancePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inputBufferA } },
        { binding: 1, resource: { buffer: inputBufferB } },
        { binding: 2, resource: { buffer: outputBuffer } }
      ]
    });
    
    // 創建命令編碼器
    const commandEncoder = device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();
    
    computePass.setPipeline(hammingDistancePipeline);
    computePass.setBindGroup(0, bindGroup);
    
    // 分派計算
    const workgroupCount = Math.ceil(maxLength / DEFAULT_WORKGROUP_SIZE);
    computePass.dispatchWorkgroups(workgroupCount);
    computePass.end();
    
    // 創建讀取緩衝區
    const readBuffer = device.createBuffer({
      size: maxLength * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    
    // 複製結果到讀取緩衝區
    commandEncoder.copyBufferToBuffer(
      outputBuffer, 0,
      readBuffer, 0,
      maxLength * Uint32Array.BYTES_PER_ELEMENT
    );
    
    // 提交命令
    device.queue.submit([commandEncoder.finish()]);
    
    // 讀取結果
    await readBuffer.mapAsync(GPUMapMode.READ);
    const resultArray = new Uint32Array(readBuffer.getMappedRange());
    
    // 計算總距離
    let distance = 0;
    for (let i = 0; i < resultArray.length; i++) {
      distance += resultArray[i];
    }
    
    // 釋放資源
    readBuffer.unmap();
    inputBufferA.destroy();
    inputBufferB.destroy();
    outputBuffer.destroy();
    readBuffer.destroy();
    
    return distance;
  } catch (error) {
    console.error('GPU 漢明距離計算出錯，使用回退實現:', error);
    // 回退到 WebAssembly 或 JS 實現
    return calculateHammingDistanceSync(hash1, hash2);
  }
}

/**
 * 使用 GPU 計算批量漢明距離（一對多比較）
 * @param baseHash 基準哈希
 * @param compareHashes 要比較的哈希數組
 * @returns 距離數組
 */
export async function calculateBatchHammingDistancesGPU(
  baseHash: string,
  compareHashes: string[]
): Promise<number[]> {
  // 如果沒有要比較的哈希或只有一個，使用標準方法
  if (compareHashes.length === 0) {
    return [];
  }
  if (compareHashes.length === 1) {
    const distance = await calculateHammingDistanceGPU(baseHash, compareHashes[0]);
    return [distance];
  }
  
  // 如果 GPU 未初始化，嘗試初始化
  if (!gpuInitialized) {
    const initialized = await initializeGPUHashCompare();
    if (!initialized) {
      // 回退到非 GPU 實現
      return compareHashes.map(hash => hammingDistanceJS(baseHash, hash));
    }
  }
  
  try {
    // 獲取 GPU 上下文
    const context = getWebGPUContext();
    const device = context.getDevice();
    
    if (!device) {
      // 回退到非 GPU 實現
      return compareHashes.map(hash => hammingDistanceJS(baseHash, hash));
    }
    
    // 創建批量處理管線
    const batchPipeline = await createBatchHammingDistancePipeline(device);
    if (!batchPipeline) {
      // 回退到非 GPU 實現
      return compareHashes.map(hash => hammingDistanceJS(baseHash, hash));
    }
    
    // 轉換基準哈希
    const baseHashArray = hexHashToUint32Array(baseHash);
    const hashSize = baseHashArray.length;
    
    // 轉換比較哈希並合併到一個大數組中
    const totalCompareHashArray = new Uint32Array(hashSize * compareHashes.length);
    
    for (let i = 0; i < compareHashes.length; i++) {
      const compareHash = compareHashes[i];
      const compareHashArray = hexHashToUint32Array(compareHash);
      
      // 複製到合併數組
      for (let j = 0; j < hashSize; j++) {
        const idx = i * hashSize + j;
        if (j < compareHashArray.length) {
          totalCompareHashArray[idx] = compareHashArray[j];
        }
      }
    }
    
    // 創建緩衝區
    const baseBuffer = device.createBuffer({
      size: baseHashArray.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(baseBuffer.getMappedRange()).set(baseHashArray);
    baseBuffer.unmap();
    
    const compareBuffer = device.createBuffer({
      size: totalCompareHashArray.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(compareBuffer.getMappedRange()).set(totalCompareHashArray);
    compareBuffer.unmap();
    
    // 創建輸出緩衝區
    const outputBuffer = device.createBuffer({
      size: compareHashes.length * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    
    // 創建綁定組
    const bindGroup = device.createBindGroup({
      layout: batchPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: baseBuffer } },
        { binding: 1, resource: { buffer: compareBuffer } },
        { binding: 2, resource: { buffer: outputBuffer } }
      ]
    });
    
    // 創建命令編碼器
    const commandEncoder = device.createCommandEncoder();
    const computePass = commandEncoder.beginComputePass();
    
    computePass.setPipeline(batchPipeline);
    computePass.setBindGroup(0, bindGroup);
    
    // 分派計算
    const workgroupCount = Math.ceil(compareHashes.length / DEFAULT_WORKGROUP_SIZE);
    computePass.dispatchWorkgroups(workgroupCount);
    computePass.end();
    
    // 創建讀取緩衝區
    const readBuffer = device.createBuffer({
      size: compareHashes.length * Uint32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    
    // 複製結果到讀取緩衝區
    commandEncoder.copyBufferToBuffer(
      outputBuffer, 0,
      readBuffer, 0,
      compareHashes.length * Uint32Array.BYTES_PER_ELEMENT
    );
    
    // 提交命令
    device.queue.submit([commandEncoder.finish()]);
    
    // 讀取結果
    await readBuffer.mapAsync(GPUMapMode.READ);
    const resultArray = new Uint32Array(readBuffer.getMappedRange());
    
    // 轉換為普通數組
    const distances: number[] = Array.from(resultArray);
    
    // 釋放資源
    readBuffer.unmap();
    baseBuffer.destroy();
    compareBuffer.destroy();
    outputBuffer.destroy();
    readBuffer.destroy();
    
    return distances;
  } catch (error) {
    console.error('GPU 批量漢明距離計算出錯，使用回退實現:', error);
    // 回退到非 GPU 實現
    return compareHashes.map(hash => hammingDistanceJS(baseHash, hash));
  }
}

/**
 * 智能選擇最佳哈希比較實現
 * 根據輸入大小和可用性自動選擇 GPU, WebAssembly 或 JS 實現
 * @param hash1 第一個哈希
 * @param hash2 第二個哈希
 * @returns 漢明距離
 */
export async function smartHammingDistance(
  hash1: string,
  hash2: string
): Promise<number> {
  // 對於非常小的哈希，直接使用 JS 實現可能更快
  if (hash1.length <= 8 && hash2.length <= 8) {
    return hammingDistanceJS(hash1, hash2);
  }
  
  // 嘗試使用 GPU
  if (gpuInitialized || await initializeGPUHashCompare()) {
    return calculateHammingDistanceGPU(hash1, hash2);
  }
  
  // 回退到 WebAssembly 或 JS
  return calculateHammingDistanceSync(hash1, hash2);
}

/**
 * 智能批量計算漢明距離
 * @param baseHash 基準哈希
 * @param compareHashes 要比較的哈希數組
 * @returns 距離數組
 */
export async function smartBatchHammingDistance(
  baseHash: string,
  compareHashes: string[]
): Promise<number[]> {
  // 對於小批量，可能直接使用基本實現更快
  if (compareHashes.length <= 10) {
    return compareHashes.map(hash => hammingDistanceJS(baseHash, hash));
  }
  
  // 嘗試使用 GPU
  if (gpuInitialized || await initializeGPUHashCompare()) {
    return calculateBatchHammingDistancesGPU(baseHash, compareHashes);
  }
  
  // 回退到非 GPU 實現
  return compareHashes.map(hash => calculateHammingDistanceSync(baseHash, hash));
}

/**
 * 初始化 GPU 哈希比較功能
 * 在應用程序啟動時預熱調用
 */
export function preInitializeGPUHashCompare(): void {
  setTimeout(() => {
    initializeGPUHashCompare().then(initialized => {
      if (initialized) {
        console.info('GPU 哈希比較預初始化完成');
      }
    });
  }, 2000); // 延遲 2 秒，避免阻塞主線程
} 