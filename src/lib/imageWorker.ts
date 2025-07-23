// Web Worker 入口，支援 analyzeImageQuality 與 calculatePerceptualHash
self.onmessage = async (e) => {
  const { task, file, id } = e.data;

  if (task === 'analyzeImageQuality') {
    const result = await analyzeImageQuality(file);
    self.postMessage({ id, result });
  } else if (task === 'calculatePerceptualHash') {
    const result = await calculatePerceptualHash(file);
    self.postMessage({ id, result });
  }
};

// 直接複製 imageAnalysis.ts 內部的 analyzeImageQuality 與 calculatePerceptualHash 實作
// 但移除 export 與型別，並改為 worker 內可用

const analyzeImageQuality = async (imageFile) => {
  return new Promise((resolve) => {
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
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
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const brightness = (r + g + b) / 3;
        brightnessSum += brightness;
      }
      const avgBrightness = brightnessSum / (pixels.length / 4);
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const brightness = (r + g + b) / 3;
        contrastSum += Math.pow(brightness - avgBrightness, 2);
      }
      const contrast = Math.sqrt(contrastSum / (pixels.length / 4));
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
      const resolution = canvas.width * canvas.height;
      const fileSize = imageFile.size;
      const normalizedBrightness = Math.max(0, 100 - Math.abs(avgBrightness - 128) / 128 * 100);
      const normalizedContrast = Math.min(100, (contrast / 50) * 100);
      const normalizedSharpness = Math.min(100, sharpness);
      const resolutionScore = Math.min(100, (resolution / 2073600) * 50);
      const fileSizeScore = Math.min(100, (fileSize / 1048576) * 25);
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

const calculatePerceptualHash = async (imageFile) => {
  return new Promise((resolve) => {
    const canvas = new OffscreenCanvas(8, 8);
    const ctx = canvas.getContext('2d');
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 8, 8);
      const imageData = ctx.getImageData(0, 0, 8, 8);
      const pixels = imageData.data;
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const gray = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
        sum += gray;
      }
      const average = sum / 64;
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