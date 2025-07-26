import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { 
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import {
  Tag, Search, X, Star, FileImage, Calendar, SortAsc, SortDesc
} from "lucide-react";
import { PhotoTag, PhotoCategory } from '@/lib/types';

interface SortAndFilterTabProps {
  sortOption: 'date' | 'name' | 'size' | 'quality';
  sortDirection: 'asc' | 'desc';
  activeFilters: Array<{
    type: 'quality' | 'date' | 'tag' | 'category';
    value: string;
    operator?: 'gt' | 'lt' | 'eq';
  }>;
  searchTerm: string;
  tags: PhotoTag[];
  categories: PhotoCategory[];
  onSortChange: (option: 'date' | 'name' | 'size' | 'quality') => void;
  onFilterChange: (filter: {
    type: 'quality' | 'date' | 'tag' | 'category';
    value: string;
    operator?: 'gt' | 'lt' | 'eq';
  }) => void;
  onSearchChange: (value: string) => void;
  onClearFilters: () => void;
}

const SortAndFilterTab: React.FC<SortAndFilterTabProps> = ({
  sortOption,
  sortDirection,
  activeFilters,
  searchTerm,
  tags,
  categories,
  onSortChange,
  onFilterChange,
  onSearchChange,
  onClearFilters
}) => {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-2">排序方式</h3>
        <div className="flex flex-wrap gap-2">
          <Button 
            size="sm" 
            variant={sortOption === 'date' ? "default" : "outline"}
            onClick={() => onSortChange('date')}
            className="flex items-center gap-1"
          >
            <Calendar className="w-3 h-3" />
            日期
            {sortOption === 'date' && (
              sortDirection === 'asc' ? 
                <SortAsc className="w-3 h-3" /> : 
                <SortDesc className="w-3 h-3" />
            )}
          </Button>
          
          <Button 
            size="sm" 
            variant={sortOption === 'name' ? "default" : "outline"}
            onClick={() => onSortChange('name')}
            className="flex items-center gap-1"
          >
            文件名
            {sortOption === 'name' && (
              sortDirection === 'asc' ? 
                <SortAsc className="w-3 h-3" /> : 
                <SortDesc className="w-3 h-3" />
            )}
          </Button>
          
          <Button 
            size="sm" 
            variant={sortOption === 'size' ? "default" : "outline"}
            onClick={() => onSortChange('size')}
            className="flex items-center gap-1"
          >
            檔案大小
            {sortOption === 'size' && (
              sortDirection === 'asc' ? 
                <SortAsc className="w-3 h-3" /> : 
                <SortDesc className="w-3 h-3" />
            )}
          </Button>
          
          <Button 
            size="sm" 
            variant={sortOption === 'quality' ? "default" : "outline"}
            onClick={() => onSortChange('quality')}
            className="flex items-center gap-1"
          >
            <Star className="w-3 h-3" />
            品質
            {sortOption === 'quality' && (
              sortDirection === 'asc' ? 
                <SortAsc className="w-3 h-3" /> : 
                <SortDesc className="w-3 h-3" />
            )}
          </Button>
        </div>
      </div>
      
      <Separator />
      
      <div>
        <h3 className="font-semibold mb-2">篩選選項</h3>
        <div className="flex items-center gap-2 mb-3">
          <div className="relative max-w-xs">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input 
              placeholder="搜尋檔案名稱..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8"
            />
          </div>
          
          <Select onValueChange={(value) => {
            const [type, val] = value.split(':');
            onFilterChange({
              type: type as 'quality' | 'date' | 'tag' | 'category',
              value: val
            });
          }}>
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
        </div>
        
        <div className="flex flex-wrap gap-2">
          {/* 已啟用的過濾器 */}
          {activeFilters.map((filter, index) => {
            let label = '';
            let icon = null;
            
            if (filter.type === 'quality') {
              if (filter.value === 'high') {
                label = '高品質';
                icon = <Star className="w-3 h-3" />;
              } else if (filter.value === 'medium') {
                label = '中等品質';
                icon = <Star className="w-3 h-3" />;
              } else {
                label = '低品質';
                icon = <Star className="w-3 h-3" />;
              }
            } else if (filter.type === 'tag') {
              const tag = tags.find(t => t.id === filter.value);
              if (tag) {
                label = `標籤: ${tag.name}`;
                icon = <Tag className="w-3 h-3" />;
              }
            } else if (filter.type === 'category') {
              const category = categories.find(c => c.id === filter.value);
              if (category) {
                label = `分類: ${category.name}`;
                icon = <FileImage className="w-3 h-3" />;
              }
            }
            
            return (
              <Badge key={index} variant="outline" className="flex gap-1 items-center">
                {icon}
                {label}
                <X 
                  className="w-3 h-3 ml-1 cursor-pointer" 
                  onClick={() => onFilterChange(filter)}
                />
              </Badge>
            );
          })}
          
          {/* 搜尋詞 */}
          {searchTerm.trim() !== '' && (
            <Badge variant="outline" className="flex gap-1 items-center">
              <Search className="w-3 h-3" />
              搜尋: {searchTerm}
              <X 
                className="w-3 h-3 ml-1 cursor-pointer" 
                onClick={() => onSearchChange('')}
              />
            </Badge>
          )}
          
          {/* 清除所有 */}
          {(activeFilters.length > 0 || searchTerm.trim() !== '') && (
            <Button size="sm" variant="ghost" onClick={onClearFilters}>
              清除所有篩選條件
            </Button>
          )}
          
          {activeFilters.length === 0 && searchTerm.trim() === '' && (
            <div className="text-sm text-muted-foreground">
              未啟用任何篩選條件
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SortAndFilterTab; 