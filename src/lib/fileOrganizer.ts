import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export interface PhotoFile {
  file: File;
  preview: string;
  id: string;
  similarity?: number;
  isSelected?: boolean;
  group?: string;
  quality?: {
    sharpness: number;
    brightness: number;
    contrast: number;
    score: number;
  };
  hash?: string;
  path?: string; // 原始路徑
}

export interface OrganizationResult {
  keptPhotos: PhotoFile[];
  deletedPhotos: PhotoFile[];
  renamedPhotos: { original: string; newName: string }[];
}

// 生成標準化檔名
export const generateStandardFileName = (
  originalFile: File,
  index: number,
  timestamp?: Date
): string => {
  const date = timestamp || new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  const ext = originalFile.name.split('.').pop() || 'jpg';
  return `IMG_${year}${month}${day}_${String(index).padStart(4, '0')}.${ext}`;
};

// 調整圖片大小
export const resizeImage = (
  file: File,
  maxDimension: number,
  quality = 0.9
): Promise<Blob> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    
    img.onload = () => {
      // 計算新尺寸
      let { width, height } = img;
      
      if (width > height && width > maxDimension) {
        height = (height * maxDimension) / width;
        width = maxDimension;
      } else if (height > maxDimension) {
        width = (width * maxDimension) / height;
        height = maxDimension;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // 繪製圖片
      ctx.drawImage(img, 0, 0, width, height);
      
      // 轉換為Blob
      canvas.toBlob(
        (blob) => {
          resolve(blob!);
        },
        file.type,
        quality
      );
    };
    
    img.src = URL.createObjectURL(file);
  });
};

// 優化圖片品質
export const optimizeImageQuality = (
  file: File,
  adjustments: {
    brightness?: number;
    contrast?: number;
    sharpness?: number;
  } = {}
): Promise<Blob> => {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      
      // 應用濾鏡
      const brightness = adjustments.brightness || 0;
      const contrast = adjustments.contrast || 0;
      
      ctx.filter = `brightness(${100 + brightness}%) contrast(${100 + contrast}%)`;
      ctx.drawImage(img, 0, 0);
      
      // 如果需要銳化，應用邊緣增強
      if (adjustments.sharpness && adjustments.sharpness > 0) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const sharpened = applySharpenFilter(imageData, adjustments.sharpness / 100);
        ctx.putImageData(sharpened, 0, 0);
      }
      
      canvas.toBlob(
        (blob) => {
          resolve(blob!);
        },
        file.type,
        0.95
      );
    };
    
    img.src = URL.createObjectURL(file);
  });
};

// 應用銳化濾鏡
const applySharpenFilter = (imageData: ImageData, amount: number): ImageData => {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const output = new ImageData(width, height);
  
  // 銳化卷積核
  const kernel = [
    0, -amount, 0,
    -amount, 1 + 4 * amount, -amount,
    0, -amount, 0
  ];
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const kidx = ((y + ky) * width + (x + kx)) * 4 + c;
            const kernelIdx = (ky + 1) * 3 + (kx + 1);
            sum += data[kidx] * kernel[kernelIdx];
          }
        }
        
        output.data[idx + c] = Math.max(0, Math.min(255, sum));
      }
      
      output.data[idx + 3] = data[idx + 3]; // Alpha通道
    }
  }
  
  return output;
};

// 組織檔案並創建下載包
export const organizeAndPackageFiles = async (
  photos: PhotoFile[],
  groups: { id: string; photos: string[]; bestPhoto: string }[],
  options: {
    autoRename?: boolean;
    preserveOriginal?: boolean;
    maxDimension?: number;
    optimizeQuality?: boolean;
  } = {}
): Promise<Blob> => {
  const zip = new JSZip();
  const result: OrganizationResult = {
    keptPhotos: [],
    deletedPhotos: [],
    renamedPhotos: []
  };
  
  // 創建資料夾結構
  const keptFolder = zip.folder("organized_photos");
  const deletedFolder = zip.folder("deleted_duplicates");
  
  let fileIndex = 1;
  
  // 處理每個分組
  for (const group of groups) {
    const groupPhotos = photos.filter(p => group.photos.includes(p.id));
    const bestPhotoId = group.bestPhoto;
    
    for (const photo of groupPhotos) {
      if (photo.id === bestPhotoId) {
        // 保留最佳照片
        let fileName = photo.file.name;
        let fileBlob: Blob = photo.file;
        
        // 重新命名
        if (options.autoRename) {
          fileName = generateStandardFileName(photo.file, fileIndex++);
          result.renamedPhotos.push({
            original: photo.file.name,
            newName: fileName
          });
        }
        
        // 調整大小
        if (options.maxDimension && options.maxDimension < 4000) {
          fileBlob = await resizeImage(photo.file, options.maxDimension);
        }
        
        // 品質優化
        if (options.optimizeQuality) {
          const quality = photo.quality;
          const adjustments: any = {};
          
          if (quality) {
            // 根據品質分析調整參數
            if (quality.brightness < 40) adjustments.brightness = 20;
            if (quality.brightness > 80) adjustments.brightness = -10;
            if (quality.contrast < 30) adjustments.contrast = 15;
            if (quality.sharpness < 50) adjustments.sharpness = 25;
          }
          
          if (Object.keys(adjustments).length > 0) {
            fileBlob = await optimizeImageQuality(photo.file, adjustments);
          }
        }
        
        // 保持原始資料夾結構
        const originalPath = photo.path || '';
        const folderPath = originalPath.split('/').slice(0, -1).join('/');
        
        if (folderPath && keptFolder) {
          const subFolder = keptFolder.folder(folderPath);
          subFolder?.file(fileName, fileBlob);
        } else {
          keptFolder?.file(fileName, fileBlob);
        }
        
        result.keptPhotos.push(photo);
      } else {
        // 移到刪除資料夾
        const deletedFileName = `duplicate_${photo.file.name}`;
        const originalPath = photo.path || '';
        const folderPath = originalPath.split('/').slice(0, -1).join('/');
        
        if (folderPath && deletedFolder) {
          const subFolder = deletedFolder.folder(folderPath);
          subFolder?.file(deletedFileName, photo.file);
        } else {
          deletedFolder?.file(deletedFileName, photo.file);
        }
        
        result.deletedPhotos.push(photo);
      }
    }
  }
  
  // 處理沒有分組的照片（單獨照片）
  const ungroupedPhotos = photos.filter(photo => 
    !groups.some(group => group.photos.includes(photo.id))
  );
  
  for (const photo of ungroupedPhotos) {
    let fileName = photo.file.name;
    let fileBlob: Blob = photo.file;
    
    if (options.autoRename) {
      fileName = generateStandardFileName(photo.file, fileIndex++);
      result.renamedPhotos.push({
        original: photo.file.name,
        newName: fileName
      });
    }
    
    if (options.maxDimension && options.maxDimension < 4000) {
      fileBlob = await resizeImage(photo.file, options.maxDimension);
    }
    
    if (options.optimizeQuality && photo.quality) {
      const adjustments: any = {};
      const quality = photo.quality;
      
      if (quality.brightness < 40) adjustments.brightness = 20;
      if (quality.brightness > 80) adjustments.brightness = -10;
      if (quality.contrast < 30) adjustments.contrast = 15;
      if (quality.sharpness < 50) adjustments.sharpness = 25;
      
      if (Object.keys(adjustments).length > 0) {
        fileBlob = await optimizeImageQuality(photo.file, adjustments);
      }
    }
    
    const originalPath = photo.path || '';
    const folderPath = originalPath.split('/').slice(0, -1).join('/');
    
    if (folderPath && keptFolder) {
      const subFolder = keptFolder.folder(folderPath);
      subFolder?.file(fileName, fileBlob);
    } else {
      keptFolder?.file(fileName, fileBlob);
    }
    
    result.keptPhotos.push(photo);
  }
  
  // 添加處理報告
  const report = {
    summary: {
      totalPhotos: photos.length,
      keptPhotos: result.keptPhotos.length,
      deletedPhotos: result.deletedPhotos.length,
      duplicateGroups: groups.length
    },
    groups: groups.map(group => ({
      id: group.id,
      photoCount: group.photos.length,
      bestPhoto: result.keptPhotos.find(p => p.id === group.bestPhoto)?.file.name || 'Unknown'
    })),
    renamedFiles: result.renamedPhotos,
    processedAt: new Date().toISOString()
  };
  
  zip.file("organization_report.json", JSON.stringify(report, null, 2));
  
  return await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
};

// 下載整理後的檔案
export const downloadOrganizedFiles = async (
  photos: PhotoFile[],
  groups: { id: string; photos: string[]; bestPhoto: string }[],
  options: {
    autoRename?: boolean;
    preserveOriginal?: boolean;
    maxDimension?: number;
    optimizeQuality?: boolean;
  } = {}
) => {
  const BATCH_SIZE = 200;
  if (photos.length <= BATCH_SIZE) {
    const zipBlob = await organizeAndPackageFiles(photos, groups, options);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    saveAs(zipBlob, `organized_photos_${timestamp}.zip`);
    return;
  }
  // 分批處理
  let batchIndex = 1;
  for (let i = 0; i < photos.length; i += BATCH_SIZE) {
    const batchPhotos = photos.slice(i, i + BATCH_SIZE);
    // 只取屬於 batchPhotos 的分組
    const batchGroups = groups.filter(g => g.photos.some(pid => batchPhotos.some(p => p.id === pid)));
    const zipBlob = await organizeAndPackageFiles(batchPhotos, batchGroups, options);
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    saveAs(zipBlob, `organized_photos_${timestamp}_part${batchIndex}.zip`);
    batchIndex++;
  }
};