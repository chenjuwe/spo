import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { visualizer } from "rollup-plugin-visualizer";
import { VitePWA } from 'vite-plugin-pwa';
import viteImagemin from 'vite-plugin-imagemin';
import strip from '@rollup/plugin-strip';

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const isProd = mode === 'production';
  const isDev = mode === 'development';
  
  return {
    server: {
      host: "::",
      port: 8080,
      // 啟用 HMR 和快速刷新
      hmr: {
        overlay: true,
      },
      // 啟用開發服務器的壓縮
      compress: true,
      // 解決 CORS 問題
      cors: true,
    },
    
    // 基礎配置
    base: '/',
    publicDir: 'public',
    cacheDir: 'node_modules/.vite',
    
    // 構建配置
    build: {
      // 添加代碼分割與優化配置
      target: 'es2020',
      sourcemap: isDev,
      minify: isProd ? 'terser' : false,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 600,
      reportCompressedSize: false, // 提高構建速度
      assetsDir: 'assets',
      outDir: 'dist',
      emptyOutDir: true,
      // 使用 Terser 進行額外的壓縮（生產環境）
      terserOptions: isProd ? {
        compress: {
          drop_console: true,
          drop_debugger: true,
          pure_funcs: ['console.log', 'console.info', 'console.debug'],
        },
      } : undefined,
      // 分包策略 - 更精細的樹搖優化
      rollupOptions: {
        output: {
          manualChunks: {
            // 將 React 相關代碼打包到一個 chunk
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            // UI 元件庫打包到一個 chunk
            'vendor-ui': ['@/components/ui'],
            // 圖像處理相關庫打包到一個 chunk
            'vendor-image-processing': ['heic2any'],
            // 工具庫
            'vendor-utils': ['lucide-react', 'sonner', 'zod', 'uuid'],
            // 機器學習庫
            'vendor-ml': ['@tensorflow/tfjs', '@tensorflow-models/mobilenet', 'comlink'],
          },
          // 根據入口點、異步和動態導入自動拆分 chunks
          chunkFileNames: isProd ? 'assets/js/[name]-[hash].js' : 'assets/js/[name].js',
          entryFileNames: isProd ? 'assets/js/[name]-[hash].js' : 'assets/js/[name].js',
          assetFileNames: isProd ? 'assets/[ext]/[name]-[hash].[ext]' : 'assets/[ext]/[name].[ext]',
        },
        // 外部化某些大型第三方庫（如果需要）
        // external: [],
      },
    },
    
    // 依賴優化配置
    optimizeDeps: {
      // 預構建這些依賴項，加速開發環境加載
      include: ['react', 'react-dom', 'react-router-dom', 'heic2any', 'sonner', 
               '@tensorflow/tfjs', '@tensorflow-models/mobilenet', 'comlink'],
      // 使用 esbuild 加速構建過程
      esbuildOptions: {
        target: 'es2020',
        // 改進樹搖優化
        treeShaking: true,
        // 定義環境變量
        define: {
          'process.env.NODE_ENV': JSON.stringify(mode),
        },
        // 更快的 JSX 轉換
        jsxFactory: 'React.createElement',
        jsxFragment: 'React.Fragment',
      },
    },
    
    // Esbuild 轉換選項
    esbuild: {
      // 是否保留 JSX
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
    },
    
    // CSS 處理配置
    css: {
      // 開發環境下啟用源映射
      devSourcemap: isDev,
      // CSS 模塊配置
      modules: {
        localsConvention: 'camelCaseOnly',
      },
    },
    
    // 插件配置 - 開發與生產環境分離
    plugins: [
      react(),
      
      // 開發環境特定插件
      isDev && componentTagger(),
      isDev && visualizer({
        open: true,
        filename: 'reports/dev-visualizer.html',
        gzipSize: true,
        brotliSize: true,
        title: '開發模式打包分析',
      }),
      
      // 生產環境特定插件
      isProd && strip({
        include: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],
        functions: ['console.log', 'console.info', 'console.debug', 'debugger'],
      }),
      isProd && visualizer({ 
        open: true, 
        filename: 'reports/rollup-visualizer.html',
        gzipSize: true,
        brotliSize: true,
      }),
      
      // 生產環境的圖像優化
      isProd && viteImagemin({
        gifsicle: {
          optimizationLevel: 7,
          interlaced: false,
        },
        optipng: {
          optimizationLevel: 7,
        },
        mozjpeg: {
          quality: 80,
          progressive: true,
        },
        pngquant: {
          quality: [0.8, 0.9],
          speed: 4,
        },
        svgo: {
          plugins: [
            {
              name: 'removeViewBox',
            },
            {
              name: 'removeEmptyAttrs',
              active: false,
            },
          ],
        },
        webp: {
          quality: 85
        }
      }),
      
      // PWA 插件 (共用)
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'robots.txt', 'placeholder.svg'],
        manifest: {
          name: 'Smart Photo Organizer',
          short_name: 'SPO',
          description: '智能照片整理和管理工具',
          theme_color: '#ffffff',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            }
          ],
          display: 'standalone',
          start_url: '/',
          background_color: '#ffffff'
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365 // <== 365 天
                }
              }
            },
            {
              urlPattern: ({ url }) => url.pathname.endsWith('.jpg') || 
                                      url.pathname.endsWith('.png') ||
                                      url.pathname.endsWith('.jpeg'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'images-cache',
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 * 24 * 30 // <== 30 天
                }
              }
            },
            // 添加常用資源 StaleWhileRevalidate 策略
            {
              urlPattern: /\.(?:js|css|json)$/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'static-resources',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 7 // 7 天
                }
              }
            },
            // API 請求的緩存策略
            {
              urlPattern: /\/api\/.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-cache',
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 60 * 60 // 1 小時
                },
                networkTimeoutSeconds: 10 // 10 秒網絡超時
              }
            }
          ],
          // 啟用流式編譯
          inlineWorkboxRuntime: true,
          skipWaiting: true,
          clientsClaim: true
        }
      })
    ].filter(Boolean),
    
    // 路徑解析配置
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      // 擴展名省略
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue'],
    },
    
    // 自定義環境變數前綴
    envPrefix: ['VITE_', 'APP_'],
    
    // 性能指標收集
    define: {
      __COLLECT_METRICS__: isDev || JSON.stringify(process.env.COLLECT_METRICS) === 'true',
    },
  };
});
