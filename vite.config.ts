import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3003';

const earlyDarkPaint = () => ({
  name: 'mirage-early-dark-paint',
  transformIndexHtml: {
    order: 'pre' as const,
    handler(html: string) {
      const style = `<style id="mirage-early-dark-paint">html,body,#root{min-height:100%;margin:0;background:#141418;color:#e5e5e5}#root:empty::before{content:"";position:fixed;inset:0;background:#141418 radial-gradient(ellipse 80% 50% at 50% -20%,rgba(99,102,241,.08),transparent)}</style>`;
      return html.replace('<head>', `<head>\n    ${style}`);
    },
  },
});

export default defineConfig({
  server: {
    port: 3002,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: true,
      },
      '/storage': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: true,
      },
    }
  },
  plugins: [earlyDarkPaint(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    }
  }
});
