import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { X, Star, Eye } from "lucide-react";

interface PhotoFile {
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
}

interface PhotoGridProps {
  photos: PhotoFile[];
  onPhotosChange: (photos: PhotoFile[]) => void;
}

const PhotoGrid = ({ photos, onPhotosChange }: PhotoGridProps) => {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  const handleRemovePhoto = (id: string) => {
    const photoToRemove = photos.find(p => p.id === id);
    if (photoToRemove) {
      URL.revokeObjectURL(photoToRemove.preview);
    }
    onPhotosChange(photos.filter(p => p.id !== id));
  };

  const handleToggleSelect = (id: string) => {
    onPhotosChange(
      photos.map(photo =>
        photo.id === id
          ? { ...photo, isSelected: !photo.isSelected }
          : photo
      )
    );
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = URL.createObjectURL(file);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">已載入的照片</h2>
        <div className="text-sm text-muted-foreground">
          {photos.filter(p => p.isSelected).length} / {photos.length} 張已選取
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {photos.map((photo) => (
          <Card
            key={photo.id}
            className={`
              relative overflow-hidden transition-all duration-200 hover:shadow-photo group
              ${photo.isSelected ? 'ring-2 ring-primary' : ''}
              ${selectedPhoto === photo.id ? 'ring-2 ring-primary shadow-elevation' : ''}
            `}
          >
            {/* Photo */}
            <div className="aspect-square relative bg-photo-bg">
              <img
                src={photo.preview}
                alt={photo.file.name}
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setSelectedPhoto(selectedPhoto === photo.id ? null : photo.id)}
              />
              
              {/* Overlay */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
              
              {/* Selection Checkbox */}
              <div className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Checkbox
                  checked={photo.isSelected}
                  onCheckedChange={() => handleToggleSelect(photo.id)}
                  className="bg-white shadow-md"
                />
              </div>

              {/* Remove Button */}
              <Button
                variant="destructive"
                size="sm"
                className="absolute top-2 right-2 w-6 h-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRemovePhoto(photo.id)}
              >
                <X className="w-3 h-3" />
              </Button>

              {/* Quality Indicators */}
              {photo.similarity && (
                <div className="absolute bottom-2 right-2">
                  <Badge variant={photo.similarity > 95 ? "default" : "secondary"} className="text-xs">
                    <Star className="w-3 h-3 mr-1" />
                    {photo.similarity}%
                  </Badge>
                </div>
              )}

              {/* View Button */}
              <Button
                variant="secondary"
                size="sm"
                className="absolute bottom-2 left-2 w-6 h-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => setSelectedPhoto(selectedPhoto === photo.id ? null : photo.id)}
              >
                <Eye className="w-3 h-3" />
              </Button>
            </div>

            {/* Photo Info */}
            <div className="p-3 space-y-2">
              <h4 className="font-medium text-sm truncate" title={photo.file.name}>
                {photo.file.name}
              </h4>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{formatFileSize(photo.file.size)}</span>
                {photo.group && (
                  <Badge variant="outline" className="text-xs">
                    群組 {photo.group}
                  </Badge>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Selected Photo Preview */}
      {selectedPhoto && (
        <Card className="p-6">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">照片預覽</h3>
            {(() => {
              const photo = photos.find(p => p.id === selectedPhoto);
              if (!photo) return null;
              
              return (
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <img
                      src={photo.preview}
                      alt={photo.file.name}
                      className="w-full rounded-lg shadow-photo"
                    />
                  </div>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">檔案資訊</h4>
                      <dl className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">檔案名稱:</dt>
                          <dd className="font-medium">{photo.file.name}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">檔案大小:</dt>
                          <dd>{formatFileSize(photo.file.size)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-muted-foreground">檔案類型:</dt>
                          <dd>{photo.file.type}</dd>
                        </div>
                        {photo.similarity && (
                          <div className="flex justify-between">
                            <dt className="text-muted-foreground">品質分數:</dt>
                            <dd>
                              <Badge variant={photo.similarity > 95 ? "default" : "secondary"}>
                                {photo.similarity}%
                              </Badge>
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => setSelectedPhoto(null)}
                      className="w-full"
                    >
                      關閉預覽
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        </Card>
      )}
    </div>
  );
};

export default PhotoGrid;