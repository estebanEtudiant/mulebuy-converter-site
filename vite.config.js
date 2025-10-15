import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Définissez le nom de votre dépôt GitHub ici (c'est le sous-chemin)
const REPO_NAME = 'mulebuy-converter-site'; 

// https://vitejs.dev/config/
export default defineConfig({
  // 🎯 L'ajout essentiel pour GitHub Pages
  base: `/${REPO_NAME}/`, 
  
  plugins: [react()],
})