import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const API_PORT = Number(process.env.API_PORT ?? 8787)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${API_PORT}` },
  },
  // 무거운 라이브러리를 미리 묶어 둔다. 처음 쓰는 순간 재최적화로 화면 전체가 새로고침되는 일을 막는다.
  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-dom/client', 'react-router', 'zustand', 'zustand/middleware', 'clsx', 'lucide-react',
      'jszip', 'idb-keyval', 'pdf-lib', 'pdfjs-dist', 'docx', 'pptxgenjs', 'mammoth', 'tesseract.js', 'fabric',
      'qr-code-styling', 'bwip-js', 'gifenc', 'mp4-muxer', 'webm-muxer', 'xlsx', '@mediapipe/tasks-vision',
    ],
    exclude: ['@huggingface/transformers'],
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
  worker: { format: 'es' },
})
