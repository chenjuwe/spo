/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// 擴展 ImportMeta 接口添加環境變量類型
interface ImportMetaEnv {
  readonly VITE_APP_ENV: 'development' | 'production' | 'test';
  readonly VITE_API_URL: string;
  readonly VITE_ENABLE_LOGS: string;
  readonly VITE_DEBUG_MODE: string;
  // 更多環境變量...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
