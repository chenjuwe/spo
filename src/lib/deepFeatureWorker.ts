/**
 * 深度特徵提取 Web Worker
 * 用於在背景執行緒中運行 TensorFlow.js 以避免阻塞 UI
 */

import * as comlink from 'comlink';
import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';

/**
 * 特徵提取器類
 */
class FeatureExtractorWorker {
  private model: any = null;
  private isInitialized: boolean = false;
  
  /**
   * 初始化模型
   */
  async initialize(): Promise<boolean> {
    try {
      if (this.isInitialized) return true;
      
      // 設置 WebGL
      await tf.setBackend('webgl');
      
      // 加載模型
      this.model = await mobilenet.load({
        version: 2,
        alpha: 0.5
      });
      
      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error('[Worker] 初始化深度特徵提取器失敗:', error);
      return false;
    }
  }
  
  /**
   * 從 ImageData 中提取特徵
   * @param imageData 圖像數據
   */
  async extractFeatures(imageData: ImageData): Promise<number[]> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (!this.model) {
      throw new Error('模型未初始化');
    }
    
    try {
      // 創建張量
      const tensor = tf.browser.fromPixels(imageData);
      
      // 調整大小
      const resized = tf.image.resizeBilinear(tensor, [224, 224]);
      
      // 正規化
      const normalized = resized.toFloat().div(127.5).sub(1);
      
      // 添加批次維度
      const batched = normalized.expandDims(0);
      
      // 獲取特徵
      const activation = await this.model.model.executeAsync(
        batched, 
        ['MobilenetV2/Logits/AvgPool']
      ) as tf.Tensor;
      
      // 獲取數據
      const features = Array.from(await (activation as tf.Tensor).data());
      
      // 釋放張量
      tensor.dispose();
      resized.dispose();
      normalized.dispose();
      batched.dispose();
      activation.dispose();
      
      return features;
    } catch (error) {
      console.error('[Worker] 特徵提取失敗:', error);
      return [];
    }
  }
  
  /**
   * 釋放資源
   */
  dispose(): void {
    if (this.model) {
      try {
        // 使用 any 類型來訪問 dispose 方法
        if (typeof this.model.dispose === 'function') {
          this.model.dispose();
        }
        this.model = null;
        this.isInitialized = false;
      } catch (error) {
        console.error('[Worker] 釋放資源失敗:', error);
      }
    }
  }
}

// 使用 Comlink 暴露類
comlink.expose(new FeatureExtractorWorker());

// 為 TypeScript 添加空導出，使其成為模塊
export {}; 