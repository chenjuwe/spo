// 為保持 API 兼容性，重新導出所有組件
import Badge, { badgeVariants } from "./badge"
import Button, { buttonVariants } from "./button/index"

// 根據默認導出重新導出命名導出
export { 
  Badge, badgeVariants,
  Button, buttonVariants
} 