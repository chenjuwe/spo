import { useState, useEffect, lazy, Suspense, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  Tabs, TabsContent, TabsList, TabsTrigger 
} from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";

import {
  Tag, Filter, SortAsc, SortDesc, Search, X, Plus, Save, Calendar, FileImage, Star
} from "lucide-react";
import { PhotoFile, PhotoTag, PhotoCategory } from "@/lib/types";

// 排序選項
type SortOption = 'date' | 'name' | 'size' | 'quality';

// 篩選選項
interface FilterOption {
  type: 'quality' | 'date' | 'tag' | 'category';
  value: string;
  operator?: 'gt' | 'lt' | 'eq';
}

// 選擇器包裝器屬性
interface SelectWrapperProps {
  onValueChange: (value: string) => void;
  tags: PhotoTag[];
  categories: PhotoCategory[];
}

interface PhotoClassifierProps {
  photos: PhotoFile[];
  onUpdatePhoto: (id: string, updates: Partial<PhotoFile>) => void;
  onTagsUpdated?: (tags: PhotoTag[]) => void;
  onCategoriesUpdated?: (categories: PhotoCategory[]) => void;
  onFilterChange?: (filters: FilterOption[]) => void;
  onSortChange?: (sort: SortOption, direction: 'asc' | 'desc') => void;
}

// 使用常規的選擇元件包裝器
const SelectWrapper: React.FC<SelectWrapperProps> = ({ onValueChange, tags, categories }) => {
  return (
    <Select onValueChange={onValueChange}>
      <SelectTrigger className="max-w-[180px]">
        <SelectValue placeholder="選擇篩選條件" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="quality:high">高品質 (80分以上)</SelectItem>
          <SelectItem value="quality:medium">中等品質 (60-80分)</SelectItem>
          <SelectItem value="quality:low">低品質 (60分以下)</SelectItem>
        </SelectGroup>
        <SelectGroup>
          {tags.map(tag => (
            <SelectItem key={tag.id} value={`tag:${tag.id}`}>
              標籤: {tag.name}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          {categories.map(cat => (
            <SelectItem key={cat.id} value={`category:${cat.id}`}>
              分類: {cat.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};

// 懶加載元件
const SortAndFilterTab = lazy(() => import('./SortAndFilterTab'));

export const PhotoClassifier: React.FC<PhotoClassifierProps> = ({
  photos,
  onUpdatePhoto,
  onTagsUpdated,
  onCategoriesUpdated,
  onFilterChange,
  onSortChange
}) => {
  // 標籤和分類狀態
  const [tags, setTags] = useState<PhotoTag[]>([
    { id: "tag1", name: "風景", color: "bg-blue-500" },
    { id: "tag2", name: "人像", color: "bg-red-500" },
    { id: "tag3", name: "建築", color: "bg-amber-500" },
    { id: "tag4", name: "美食", color: "bg-emerald-500" }
  ]);
  
  const [categories, setCategories] = useState<PhotoCategory[]>([
    { id: "cat1", name: "旅遊", description: "旅行中拍攝的照片", color: "bg-indigo-500" },
    { id: "cat2", name: "家庭", description: "家庭聚會照片", color: "bg-rose-500" },
    { id: "cat3", name: "工作", description: "工作相關照片", color: "bg-amber-500" }
  ]);
  
  // 排序和篩選狀態
  const [sortOption, setSortOption] = useState<SortOption>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [activeFilters, setActiveFilters] = useState<FilterOption[]>([]);
  const [searchTerm, setSearchTerm] = useState<string>('');
  
  // 新標籤和分類狀態
  const [newTagName, setNewTagName] = useState<string>('');
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  
  // 懶加載狀態
  const [showSortTab, setShowSortTab] = useState<boolean>(false);
  
  // 當標籤或分類變更時通知父元件
  useEffect(() => {
    if (onTagsUpdated) {
      onTagsUpdated(tags);
    }
  }, [tags, onTagsUpdated]);
  
  useEffect(() => {
    if (onCategoriesUpdated) {
      onCategoriesUpdated(categories);
    }
  }, [categories, onCategoriesUpdated]);
  
  // 處理排序變更
  const handleSortChange = (option: SortOption) => {
    if (option === sortOption) {
      // 如果選擇相同選項，切換排序方向
      const newDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      setSortDirection(newDirection);
      if (onSortChange) {
        onSortChange(option, newDirection);
      }
    } else {
      // 設置新排序選項
      setSortOption(option);
      if (onSortChange) {
        onSortChange(option, sortDirection);
      }
    }
  };
  
  // 處理過濾器變更
  const handleFilterChange = (filter: FilterOption) => {
    // 檢查是否已有相同類型和值的過濾器
    const existingIndex = activeFilters.findIndex(
      f => f.type === filter.type && f.value === filter.value
    );
    
    if (existingIndex !== -1) {
      // 如果已存在，則移除
      const newFilters = [...activeFilters];
      newFilters.splice(existingIndex, 1);
      setActiveFilters(newFilters);
      if (onFilterChange) {
        onFilterChange(newFilters);
      }
    } else {
      // 否則添加
      const newFilters = [...activeFilters, filter];
      setActiveFilters(newFilters);
      if (onFilterChange) {
        onFilterChange(newFilters);
      }
    }
  };
  
  // 清除所有過濾器
  const clearFilters = () => {
    setActiveFilters([]);
    setSearchTerm('');
    if (onFilterChange) {
      onFilterChange([]);
    }
  };
  
  // 為照片添加標籤
  const addTagToPhotos = (photoIds: string[], tagId: string) => {
    photoIds.forEach(photoId => {
      const photo = photos.find(p => p.id === photoId);
      if (photo) {
        const updatedTags = photo.tags ? [...photo.tags, tagId] : [tagId];
        onUpdatePhoto(photoId, { tags: updatedTags });
      }
    });
  };
  
  // 為照片設置分類
  const setCategoryToPhotos = (photoIds: string[], categoryId: string) => {
    photoIds.forEach(photoId => {
      const photo = photos.find(p => p.id === photoId);
      if (photo) {
        onUpdatePhoto(photoId, { category: categoryId });
      }
    });
  };
  
  // 添加新標籤
  const addNewTag = () => {
    if (newTagName.trim() === '') return;
    
    const randomColor = getRandomColor();
    const newTag = {
      id: `tag${Date.now()}`,
      name: newTagName.trim(),
      color: randomColor
    };
    
    setTags([...tags, newTag]);
    setNewTagName('');
  };
  
  // 添加新分類
  const addNewCategory = () => {
    if (newCategoryName.trim() === '') return;
    
    const randomColor = getRandomColor();
    const newCategory = {
      id: `cat${Date.now()}`,
      name: newCategoryName.trim(),
      color: randomColor
    };
    
    setCategories([...categories, newCategory]);
    setNewCategoryName('');
  };
  
  // 獲取隨機顏色
  const getRandomColor = () => {
    const colors = [
      'bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500',
      'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-amber-500',
      'bg-emerald-500', 'bg-rose-500', 'bg-cyan-500', 'bg-lime-500'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };
  
  // 是否應該顯示標籤或分類統計數據
  const shouldShowStats = photos.length > 0;
  
  // 使用 useMemo 優化統計計算
  const { tagStats, categoryStats } = useMemo(() => {
    const tagStats: Record<string, number> = {};
    const categoryStats: Record<string, number> = {};
    
    // 一次性迭代照片，同時計算標籤和分類統計
    photos.forEach(photo => {
      // 計算標籤統計
      if (photo.tags && photo.tags.length > 0) {
        photo.tags.forEach(tagId => {
          tagStats[tagId] = (tagStats[tagId] || 0) + 1;
        });
      }
      
      // 計算分類統計
      if (photo.category) {
        categoryStats[photo.category] = (categoryStats[photo.category] || 0) + 1;
      }
    });
    
    return { tagStats, categoryStats };
  }, [photos]);

  return (
    <Card className="p-4">
      <Tabs 
        defaultValue="classify"
        onValueChange={value => {
          if (value === 'sort' && !showSortTab) {
            setShowSortTab(true);
          }
        }}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="classify" className="flex gap-1">
            <FileImage className="w-4 h-4" /> 分類
          </TabsTrigger>
          <TabsTrigger value="tags" className="flex gap-1">
            <Tag className="w-4 h-4" /> 標籤
          </TabsTrigger>
          <TabsTrigger value="sort" className="flex gap-1">
            <SortAsc className="w-4 h-4" /> 排序與篩選
          </TabsTrigger>
        </TabsList>
        
        {/* 分類頁籤 */}
        <TabsContent value="classify" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">照片分類</h3>
            <div className="flex items-center gap-2">
              <Input 
                placeholder="新增分類..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="w-40 h-8 text-sm"
              />
              <Button 
                size="sm" 
                variant="outline" 
                onClick={addNewCategory}
                disabled={newCategoryName.trim() === ''}
              >
                <Plus className="w-3 h-3 mr-1" />
                新增
              </Button>
            </div>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {categories.map(category => (
              <div 
                key={category.id}
                className="border rounded-md p-3 hover:border-primary cursor-pointer transition-colors"
                onClick={() => setCategoryToPhotos(
                  photos.filter(p => p.isSelected).map(p => p.id), 
                  category.id
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${category.color}`} />
                    <span className="font-medium">{category.name}</span>
                  </div>
                  {shouldShowStats && (
                    <Badge variant="outline">{categoryStats[category.id] || 0}</Badge>
                  )}
                </div>
                {category.description && (
                  <p className="text-xs text-muted-foreground mt-1">{category.description}</p>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
        
        {/* 標籤頁籤 */}
        <TabsContent value="tags" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">照片標籤</h3>
            <div className="flex items-center gap-2">
              <Input 
                placeholder="新增標籤..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                className="w-40 h-8 text-sm"
              />
              <Button 
                size="sm" 
                variant="outline" 
                onClick={addNewTag}
                disabled={newTagName.trim() === ''}
              >
                <Plus className="w-3 h-3 mr-1" />
                新增
              </Button>
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2">
            {tags.map(tag => (
              <Badge 
                key={tag.id}
                className={`${tag.color} text-white cursor-pointer hover:opacity-90 transition-opacity`}
                onClick={() => addTagToPhotos(
                  photos.filter(p => p.isSelected).map(p => p.id), 
                  tag.id
                )}
              >
                <Tag className="w-3 h-3 mr-1" />
                {tag.name}
                {shouldShowStats && tagStats[tag.id] > 0 && (
                  <span className="ml-1 bg-white/30 px-1 rounded-sm text-xs">
                    {tagStats[tag.id]}
                  </span>
                )}
              </Badge>
            ))}
            
            {tags.length === 0 && (
              <div className="text-sm text-muted-foreground">
                尚未創建任何標籤
              </div>
            )}
          </div>
        </TabsContent>
        
        {/* 排序與篩選頁籤 - 懶加載 */}
        <TabsContent value="sort" className="space-y-4">
          {showSortTab ? (
            <Suspense fallback={<div className="space-y-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>}>
              <SortAndFilterTab
                sortOption={sortOption}
                sortDirection={sortDirection}
                activeFilters={activeFilters}
                searchTerm={searchTerm}
                tags={tags}
                categories={categories}
                onSortChange={handleSortChange}
                onFilterChange={handleFilterChange}
                onSearchChange={setSearchTerm}
                onClearFilters={clearFilters}
              />
            </Suspense>
          ) : (
            <div className="space-y-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
};

export default PhotoClassifier; 