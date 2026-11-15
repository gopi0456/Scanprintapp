import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('jspdf') || id.includes('html2canvas')) return 'vendor-pdf';
          if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
          if (id.includes('@capacitor') || id.includes('@capgo')) return 'vendor-capacitor';
          if (id.includes('@supabase')) return 'vendor-supabase';
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
          return undefined;
        }
      }
    },
    chunkSizeWarningLimit: 1200
  }
});
