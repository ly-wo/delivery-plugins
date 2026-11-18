import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url)),outDir=path.join(root,'package');
await build({configFile:false,root,plugins:[vue()],define:{'process.env.NODE_ENV':'"production"'},build:{outDir,emptyOutDir:true,lib:{entry:path.join(root,'main.ts'),name:'DailyChromePlugin',formats:['iife'],fileName:()=> 'ui.js',cssFileName:'ui'},cssCodeSplit:false}});
await build({configFile:false,root,ssr:{noExternal:['zod','ws']},build:{outDir,emptyOutDir:false,ssr:path.join(root,'application.ts'),rollupOptions:{output:{entryFileNames:'server.mjs',inlineDynamicImports:true}}}});
await fs.copyFile(path.join(root,'plugin.json'),path.join(outDir,'plugin.json'));
