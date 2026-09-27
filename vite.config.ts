import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base so the same build works at the site root and under
// /pr-preview/pr-N/ on GitHub Pages.
export default defineConfig({
  base: './',
  plugins: [react()],
});
