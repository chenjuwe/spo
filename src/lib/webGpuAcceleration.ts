/**
 * WebGPU 加速模組
 * 提供 GPU 加速的特徵比較和矩陣運算功能
 */

import { errorHandler, ErrorType } from './errorHandlingService';

// WebGPU 上下文單例
let webGpuAccelerator: WebGpuAccelerator | null = null;

/**
 * 預初始化 WebGPU - 提前觸發 WebGPU 初始化過程
 * 這樣可以在用戶實際需要時減少等待時間
 */
export async function preInitializeWebGPU(): Promise<boolean> {
  try {
    const context = getWebGPUContext();
    return await context.isGpuAvailable();
  } catch (error) {
    console.warn('WebGPU 預初始化失敗:', error);
    return false;
  }
}

/**
 * 獲取 WebGPU 上下文
 * 返回單例實例
 */
export function getWebGPUContext(): WebGpuAccelerator {
  if (!webGpuAccelerator) {
    webGpuAccelerator = new WebGpuAccelerator();
  }
  return webGpuAccelerator;
}

/**
 * WebGPU 功能檢測結果
 */
export interface GpuCapabilityResult {
  /**
   * WebGPU 是否可用
   */
  isAvailable: boolean;
  
  /**
   * 支持的最大工作組尺寸
   */
  maxWorkgroupSize?: number;
  
  /**
   * 支持的最大存儲緩衝區尺寸
   */
  maxStorageBufferSize?: number;
  
  /**
   * 支持的著色器階段
   */
  supportedShaderStages?: string[];
  
  /**
   * 支持的算術格式
   */
  supportedFormats?: string[];
}

/**
 * 向量比較配置
 */
export interface VectorCompareConfig {
  /**
   * 批次大小
   * 每個 GPU 計算批次處理的向量數
   */
  batchSize: number;
  
  /**
   * 距離度量
   * 'cosine': 餘弦相似度 (0-1，越大越相似)
   * 'euclidean': 歐氏距離 (越小越相似)
   */
  distanceMeasure: 'cosine' | 'euclidean';

  /**
   * 是否使用 f16 格式
   * 較少的精度但更快的計算
   */
  useF16?: boolean;
}

/**
 * 矩陣運算配置
 */
export interface MatrixOperationConfig {
  /**
   * 工作組大小 (二維，x 和 y)
   */
  workgroupSize: [number, number];
  
  /**
   * 是否使用 f16 格式
   */
  useF16?: boolean;
}

/**
 * WebGPU 加速器
 * 提供 GPU 加速的特徵比較和矩陣運算功能
 */
export class WebGpuAccelerator {
  /**
   * GPU 設備實例
   */
  private device: GPUDevice | null = null;
  
  /**
   * 向量比較管道
   */
  private vectorComparePipeline: GPUComputePipeline | null = null;
  
  /**
   * 矩陣乘法管道
   */
  private matrixMultiplyPipeline: GPUComputePipeline | null = null;
  
  /**
   * GPU 能力結果
   */
  private gpuCapabilities: GpuCapabilityResult = {
    isAvailable: false
  };
  
  /**
   * 初始化狀態
   */
  private initialized: boolean = false;
  
  /**
   * 初始化承諾
   */
  private initPromise: Promise<boolean>;

  /**
   * 建立 WebGPU 加速器
   */
  constructor() {
    this.initPromise = this.initialize();
  }

  /**
   * 初始化 WebGPU
   * @returns 是否初始化成功
   */
  private async initialize(): Promise<boolean> {
    // 檢查 WebGPU 可用性
    if (!('gpu' in navigator)) {
      console.info('WebGPU 不可用：瀏覽器不支持');
      return false;
    }
    
    try {
      // 獲取 GPU 適配器
      const adapter = await navigator.gpu.requestAdapter();
      
      if (!adapter) {
        console.info('WebGPU 不可用：無法獲取 GPU 適配器');
        return false;
      }
      
      // 獲取 GPU 設備
      this.device = await adapter.requestDevice();
      
      if (!this.device) {
        console.info('WebGPU 不可用：無法創建 GPU 設備');
        return false;
      }
      
      // 獲取 GPU 能力信息
      const adapterInfo = await adapter.requestAdapterInfo();
      const limits = this.device.limits;
      
      this.gpuCapabilities = {
        isAvailable: true,
        maxWorkgroupSize: limits.maxComputeWorkgroupSizeX,
        maxStorageBufferSize: limits.maxStorageBufferBindingSize,
        supportedShaderStages: ['vertex', 'fragment', 'compute'],
        supportedFormats: ['f32', 'f16']
      };
      
      console.info('WebGPU 初始化成功', adapterInfo.description || 'GPU');
      
      // 設置錯誤處理
      this.device.lost.then((info) => {
        console.error('GPU 設備丟失:', info);
        this.gpuCapabilities.isAvailable = false;
        this.device = null;
        
        errorHandler.handleError(
          `GPU 設備丟失: ${info.message}`,
          ErrorType.SYSTEM_ERROR,
          'WebGPU 設備丟失',
          false
        );
      });
      
      // 初始化計算管道
      await this.initializeComputePipelines();
      
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('WebGPU 初始化失敗:', error);
      
      this.gpuCapabilities.isAvailable = false;
      
      errorHandler.handleError(
        error instanceof Error ? error : String(error),
        ErrorType.SYSTEM_ERROR,
        'WebGPU 初始化失敗',
        false
      );
      
      return false;
    }
  }

  /**
   * 初始化計算管道
   */
  private async initializeComputePipelines(): Promise<void> {
    if (!this.device) return;
    
    // 初始化向量比較管道
    this.vectorComparePipeline = await this.createVectorComparePipeline();
    
    // 初始化矩陣乘法管道
    this.matrixMultiplyPipeline = await this.createMatrixMultiplyPipeline();
  }

  /**
   * 創建向量比較計算管道
   */
  private async createVectorComparePipeline(): Promise<GPUComputePipeline> {
    if (!this.device) {
      throw new Error('GPU 設備未初始化');
    }
    
    const shaderModule = this.device.createShaderModule({
      code: `
        // 向量比較計算著色器
        @group(0) @binding(0) var<storage, read> vectorA: array<f32>; // 參考向量
        @group(0) @binding(1) var<storage, read> vectorsB: array<f32>; // 待比較向量列表
        @group(0) @binding(2) var<storage, read> shapes: array<vec2<u32>>; // 向量形狀數組 [維度, 數量]
        @group(0) @binding(3) var<storage, write> results: array<f32>; // 結果數組
        @group(0) @binding(4) var<uniform> params: vec2<u32>; // [距離測量方式, 批次大小]
        
        // 計算餘弦相似度
        fn cosineSimilarity(a: ptr<function, array<f32>>, b: ptr<function, array<f32>>, dim: u32) -> f32 {
          var dotProduct: f32 = 0.0;
          var normA: f32 = 0.0;
          var normB: f32 = 0.0;
          
          for (var i: u32 = 0; i < dim; i++) {
            let ai = (*a)[i];
            let bi = (*b)[i];
            dotProduct += ai * bi;
            normA += ai * ai;
            normB += bi * bi;
          }
          
          let norm = sqrt(normA) * sqrt(normB);
          
          if (norm < 0.000001) {
            return 0.0;
          }
          
          return dotProduct / norm;
        }
        
        // 計算歐氏距離
        fn euclideanDistance(a: ptr<function, array<f32>>, b: ptr<function, array<f32>>, dim: u32) -> f32 {
          var sum: f32 = 0.0;
          
          for (var i: u32 = 0; i < dim; i++) {
            let diff = (*a)[i] - (*b)[i];
            sum += diff * diff;
          }
          
          return sqrt(sum);
        }
        
        // 計算向量相似度或距離
        @compute @workgroup_size(256)
        fn main(
          @builtin(global_invocation_id) global_id: vec3<u32>,
          @builtin(num_workgroups) num_workgroups: vec3<u32>
        ) {
          let index = global_id.x;
          let dim = shapes[0].x;  // 向量維度
          let numVectors = shapes[0].y;  // 向量數量
          let distanceMeasure = params.x;  // 距離測量方式
          
          // 防止越界訪問
          if (index >= numVectors) {
            return;
          }
          
          // 計算比較結果
          if (distanceMeasure == 0u) {  // 餘弦相似度
            results[index] = cosineSimilarity(&vectorA, &vectorsB[index * dim], dim);
          } else {  // 歐氏距離
            results[index] = euclideanDistance(&vectorA, &vectorsB[index * dim], dim);
          }
        }
      `
    });
    
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });
  }

  /**
   * 創建矩陣乘法計算管道
   */
  private async createMatrixMultiplyPipeline(): Promise<GPUComputePipeline> {
    if (!this.device) {
      throw new Error('GPU 設備未初始化');
    }
    
    const shaderModule = this.device.createShaderModule({
      code: `
        // 矩陣乘法計算著色器
        @group(0) @binding(0) var<storage, read> matrixA: array<f32>;
        @group(0) @binding(1) var<storage, read> matrixB: array<f32>;
        @group(0) @binding(2) var<storage, write> matrixOut: array<f32>;
        @group(0) @binding(3) var<uniform> dimensions: vec3<u32>; // M, N, K (A尺寸: M×K, B尺寸: K×N, 輸出: M×N)
        
        // 矩陣乘法計算
        @compute @workgroup_size(16, 16)
        fn main(
          @builtin(global_invocation_id) global_id: vec3<u32>
        ) {
          // 獲取輸出矩陣的坐標
          let row = global_id.x;
          let col = global_id.y;
          
          // 獲取矩陣維度
          let M = dimensions.x; // A 的行數
          let N = dimensions.y; // B 的列數
          let K = dimensions.z; // A 的列數 = B 的行數
          
          // 檢查是否在輸出矩陣範圍內
          if (row >= M || col >= N) {
            return;
          }
          
          // 執行矩陣乘法
          var sum: f32 = 0.0;
          
          for (var k: u32 = 0; k < K; k++) {
            sum += matrixA[row * K + k] * matrixB[k * N + col];
          }
          
          // 寫入結果
          matrixOut[row * N + col] = sum;
        }
      `
    });
    
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: shaderModule,
        entryPoint: 'main'
      }
    });
  }

  /**
   * 檢查 GPU 是否可用
   * @returns 是否可用
   */
  public async isGpuAvailable(): Promise<boolean> {
    if (!this.initialized) {
      await this.initPromise;
    }
    return this.gpuCapabilities.isAvailable;
  }

  /**
   * 獲取 GPU 能力信息
   * @returns GPU 能力結果
   */
  public async getGpuCapabilities(): Promise<GpuCapabilityResult> {
    if (!this.initialized) {
      await this.initPromise;
    }
    return { ...this.gpuCapabilities };
  }

  /**
   * 比較一個向量與一組向量的相似度
   * 
   * @param reference 參考向量
   * @param vectors 要比較的向量數組
   * @param config 比較配置
   * @returns 相似度分數數組（餘弦相似度或歐氏距離）
   */
  public async compareVectors(
    reference: number[],
    vectors: number[][],
    config: Partial<VectorCompareConfig> = {}
  ): Promise<number[]> {
    if (!this.initialized) {
      await this.initPromise;
    }
    
    if (!this.gpuCapabilities.isAvailable || !this.device || !this.vectorComparePipeline) {
      throw new Error('WebGPU 不可用');
    }
    
    // 默認配置
    const defaultConfig: VectorCompareConfig = {
      batchSize: 10000,
      distanceMeasure: 'cosine',
      useF16: false
    };
    
    const finalConfig = { ...defaultConfig, ...config };
    
    try {
      const dimension = reference.length;
      const vectorCount = vectors.length;
      
      // 處理空輸入
      if (vectorCount === 0) {
        return [];
      }
      
      // 驗證所有向量維度一致
      for (let i = 0; i < vectors.length; i++) {
        if (vectors[i].length !== dimension) {
          throw new Error(`向量維度不一致: 參考向量長度為 ${dimension}，但第 ${i} 個向量長度為 ${vectors[i].length}`);
        }
      }
      
      // 創建輸出緩衝區
      const results = new Float32Array(vectorCount);
      
      // 創建參考向量緩衝區
      const referenceBuffer = this.device.createBuffer({
        size: dimension * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      
      this.device.queue.writeBuffer(referenceBuffer, 0, new Float32Array(reference));
      
      // 創建形狀緩衝區
      const shapesBuffer = this.device.createBuffer({
        size: 2 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      
      this.device.queue.writeBuffer(shapesBuffer, 0, new Uint32Array([dimension, vectorCount]));
      
      // 創建參數緩衝區
      const paramsBuffer = this.device.createBuffer({
        size: 2 * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      
      const distanceMeasureValue = finalConfig.distanceMeasure === 'cosine' ? 0 : 1;
      this.device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([distanceMeasureValue, finalConfig.batchSize]));
      
      // 準備計算結果緩衝區
      const resultsBuffer = this.device.createBuffer({
        size: vectorCount * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      
      // 準備一個緩衝區以讀回結果
      const readbackBuffer = this.device.createBuffer({
        size: vectorCount * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      
      // 分批處理以避免創建過大的緩衝區
      const batchSize = finalConfig.batchSize;
      
      for (let offset = 0; offset < vectorCount; offset += batchSize) {
        // 計算當前批次大小
        const currentBatchSize = Math.min(batchSize, vectorCount - offset);
        
        // 為當前批次的向量創建緩衝區
        const batchVectorData = new Float32Array(currentBatchSize * dimension);
        
        // 填充向量數據
        for (let i = 0; i < currentBatchSize; i++) {
          const vector = vectors[offset + i];
          for (let j = 0; j < dimension; j++) {
            batchVectorData[i * dimension + j] = vector[j];
          }
        }
        
        const batchVectorsBuffer = this.device.createBuffer({
          size: currentBatchSize * dimension * Float32Array.BYTES_PER_ELEMENT,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.device.queue.writeBuffer(batchVectorsBuffer, 0, batchVectorData);
        
        // 創建綁定組和命令編碼器
        const bindGroup = this.device.createBindGroup({
          layout: this.vectorComparePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: referenceBuffer } },
            { binding: 1, resource: { buffer: batchVectorsBuffer } },
            { binding: 2, resource: { buffer: shapesBuffer } },
            { binding: 3, resource: { buffer: resultsBuffer } },
            { binding: 4, resource: { buffer: paramsBuffer } },
          ],
        });
        
        // 創建命令編碼器
        const commandEncoder = this.device.createCommandEncoder();
        
        // 創建計算通道
        const passEncoder = commandEncoder.beginComputePass();
        passEncoder.setPipeline(this.vectorComparePipeline);
        passEncoder.setBindGroup(0, bindGroup);
        
        // 計算工作組數量 (根據向量數量調整)
        const workgroupSize = 256;
        const workgroupCount = Math.ceil(currentBatchSize / workgroupSize);
        passEncoder.dispatchWorkgroups(workgroupCount);
        passEncoder.end();
        
        // 將結果複製到可讀取的緩衝區
        commandEncoder.copyBufferToBuffer(
          resultsBuffer,
          0,
          readbackBuffer,
          offset * Float32Array.BYTES_PER_ELEMENT,
          currentBatchSize * Float32Array.BYTES_PER_ELEMENT
        );
        
        // 提交命令
        this.device.queue.submit([commandEncoder.finish()]);
        
        // 釋放臨時緩衝區
        batchVectorsBuffer.destroy();
      }
      
      // 映射緩衝區以讀取結果
      await readbackBuffer.mapAsync(GPUMapMode.READ);
      const readbackData = new Float32Array(readbackBuffer.getMappedRange());
      
      // 複製結果
      results.set(readbackData);
      
      // 取消映射並釋放緩衝區
      readbackBuffer.unmap();
      
      // 釋放資源
      referenceBuffer.destroy();
      shapesBuffer.destroy();
      paramsBuffer.destroy();
      resultsBuffer.destroy();
      readbackBuffer.destroy();
      
      return Array.from(results);
    } catch (error) {
      console.error('GPU 向量比較失敗:', error);
      
      errorHandler.handleError(
        error instanceof Error ? error : String(error),
        ErrorType.SYSTEM_ERROR,
        'GPU 向量比較失敗',
        false
      );
      
      // 回退到 CPU 實現
      return this.compareVectorsOnCpu(reference, vectors, finalConfig);
    }
  }

  /**
   * CPU 回退實現：比較向量
   * 當 GPU 計算失敗時使用
   */
  private compareVectorsOnCpu(
    reference: number[],
    vectors: number[][],
    config: VectorCompareConfig
  ): number[] {
    const results = new Array(vectors.length);
    const dimension = reference.length;
    
    for (let i = 0; i < vectors.length; i++) {
      const vector = vectors[i];
      
      if (config.distanceMeasure === 'cosine') {
        // 計算餘弦相似度
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let j = 0; j < dimension; j++) {
          dotProduct += reference[j] * vector[j];
          normA += reference[j] * reference[j];
          normB += vector[j] * vector[j];
        }
        
        const norm = Math.sqrt(normA) * Math.sqrt(normB);
        results[i] = norm < 0.000001 ? 0 : dotProduct / norm;
      } else {
        // 計算歐氏距離
        let sum = 0;
        for (let j = 0; j < dimension; j++) {
          const diff = reference[j] - vector[j];
          sum += diff * diff;
        }
        results[i] = Math.sqrt(sum);
      }
    }
    
    return results;
  }

  /**
   * 矩陣乘法 C = A × B
   * 
   * @param matrixA 矩陣 A (M×K)
   * @param matrixB 矩陣 B (K×N)
   * @param M A 的行數
   * @param N B 的列數
   * @param K A 的列數 = B 的行數
   * @param config 矩陣運算配置
   * @returns 結果矩陣 C (M×N)
   */
  public async multiplyMatrices(
    matrixA: number[][],
    matrixB: number[][],
    config: Partial<MatrixOperationConfig> = {}
  ): Promise<number[][]> {
    if (!this.initialized) {
      await this.initPromise;
    }
    
    if (!this.gpuCapabilities.isAvailable || !this.device || !this.matrixMultiplyPipeline) {
      throw new Error('WebGPU 不可用');
    }
    
    // 默認配置
    const defaultConfig: MatrixOperationConfig = {
      workgroupSize: [16, 16],
      useF16: false
    };
    
    const finalConfig = { ...defaultConfig, ...config };
    
    try {
      // 獲取矩陣維度
      const M = matrixA.length;
      const K = matrixA[0].length;
      const N = matrixB[0].length;
      
      // 驗證矩陣維度
      if (matrixB.length !== K) {
        throw new Error(`矩陣維度不匹配: A 是 ${M}×${K}, B 是 ${matrixB.length}×${N}`);
      }
      
      // 將矩陣轉換為一維數組
      const flatA = new Float32Array(M * K);
      const flatB = new Float32Array(K * N);
      
      for (let i = 0; i < M; i++) {
        for (let j = 0; j < K; j++) {
          flatA[i * K + j] = matrixA[i][j];
        }
      }
      
      for (let i = 0; i < K; i++) {
        for (let j = 0; j < N; j++) {
          flatB[i * N + j] = matrixB[i][j];
        }
      }
      
      // 創建輸入緩衝區
      const bufferA = this.device.createBuffer({
        size: flatA.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      
      const bufferB = this.device.createBuffer({
        size: flatB.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      
      // 寫入數據
      this.device.queue.writeBuffer(bufferA, 0, flatA);
      this.device.queue.writeBuffer(bufferB, 0, flatB);
      
      // 創建輸出緩衝區
      const bufferOut = this.device.createBuffer({
        size: M * N * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      
      // 創建維度緩衝區
      const dimensionsBuffer = this.device.createBuffer({
        size: 3 * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      
      this.device.queue.writeBuffer(dimensionsBuffer, 0, new Uint32Array([M, N, K]));
      
      // 創建綁定組
      const bindGroup = this.device.createBindGroup({
        layout: this.matrixMultiplyPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: bufferA } },
          { binding: 1, resource: { buffer: bufferB } },
          { binding: 2, resource: { buffer: bufferOut } },
          { binding: 3, resource: { buffer: dimensionsBuffer } },
        ],
      });
      
      // 創建命令編碼器
      const commandEncoder = this.device.createCommandEncoder();
      
      // 創建計算通道
      const passEncoder = commandEncoder.beginComputePass();
      passEncoder.setPipeline(this.matrixMultiplyPipeline);
      passEncoder.setBindGroup(0, bindGroup);
      
      // 計算工作組數量
      const workgroupSizeX = finalConfig.workgroupSize[0];
      const workgroupSizeY = finalConfig.workgroupSize[1];
      
      const workgroupCountX = Math.ceil(M / workgroupSizeX);
      const workgroupCountY = Math.ceil(N / workgroupSizeY);
      
      passEncoder.dispatchWorkgroups(workgroupCountX, workgroupCountY);
      passEncoder.end();
      
      // 創建讀回緩衝區
      const readbackBuffer = this.device.createBuffer({
        size: M * N * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      
      // 複製結果到讀回緩衝區
      commandEncoder.copyBufferToBuffer(
        bufferOut,
        0,
        readbackBuffer,
        0,
        M * N * Float32Array.BYTES_PER_ELEMENT
      );
      
      // 提交命令
      this.device.queue.submit([commandEncoder.finish()]);
      
      // 讀取結果
      await readbackBuffer.mapAsync(GPUMapMode.READ);
      const readbackData = new Float32Array(readbackBuffer.getMappedRange());
      
      // 將一維數組轉換回二維矩陣
      const result: number[][] = Array(M);
      for (let i = 0; i < M; i++) {
        result[i] = Array(N);
        for (let j = 0; j < N; j++) {
          result[i][j] = readbackData[i * N + j];
        }
      }
      
      // 釋放資源
      readbackBuffer.unmap();
      bufferA.destroy();
      bufferB.destroy();
      bufferOut.destroy();
      dimensionsBuffer.destroy();
      readbackBuffer.destroy();
      
      return result;
    } catch (error) {
      console.error('GPU 矩陣乘法失敗:', error);
      
      errorHandler.handleError(
        error instanceof Error ? error : String(error),
        ErrorType.SYSTEM_ERROR,
        'GPU 矩陣乘法失敗',
        false
      );
      
      // 回退到 CPU 實現
      return this.multiplyMatricesOnCpu(matrixA, matrixB);
    }
  }

  /**
   * CPU 回退實現：矩陣乘法
   * 當 GPU 計算失敗時使用
   */
  private multiplyMatricesOnCpu(matrixA: number[][], matrixB: number[][]): number[][] {
    const M = matrixA.length;
    const K = matrixA[0].length;
    const N = matrixB[0].length;
    
    // 驗證矩陣維度
    if (matrixB.length !== K) {
      throw new Error(`矩陣維度不匹配: A 是 ${M}×${K}, B 是 ${matrixB.length}×${N}`);
    }
    
    // 創建結果矩陣
    const result: number[][] = Array(M);
    for (let i = 0; i < M; i++) {
      result[i] = Array(N).fill(0);
    }
    
    // 計算矩陣乘法
    for (let i = 0; i < M; i++) {
      for (let j = 0; j < N; j++) {
        let sum = 0;
        for (let k = 0; k < K; k++) {
          sum += matrixA[i][k] * matrixB[k][j];
        }
        result[i][j] = sum;
      }
    }
    
    return result;
  }

  /**
   * 釋放資源
   */
  public destroy(): void {
    // 檢查並釋放管道
    this.vectorComparePipeline = null;
    this.matrixMultiplyPipeline = null;
    
    // 檢查並釋放設備
    if (this.device) {
      // 在 WebGPU 中，沒有直接的方法釋放設備
      // 但可以確保不再引用它
      this.device = null;
    }
    
    this.initialized = false;
    this.gpuCapabilities.isAvailable = false;
    
    console.info('WebGPU 加速器已釋放');
  }
} 