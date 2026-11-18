import {pluginManifestSchema as browserManifestSchema} from '@delivery/plugin-sdk-browser/manifest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pluginManifestSchema } from '@delivery/plugin-sdk/manifest';
const out = path.resolve('dist');
await fs.mkdir(out, {recursive:true});
const releases=[];
for(const folder of (await fs.readdir('plugins')).sort()) {
  const root=path.resolve('plugins',folder);
  let raw; try {raw=JSON.parse(await fs.readFile(path.join(root,'plugin.json'),'utf8'));} catch(error){if(error.code==='ENOENT')continue;throw error;}
  const manifest=(raw.compatibility?.sdk === '2.2.1' ? browserManifestSchema : pluginManifestSchema).parse(raw);
  if(manifest.application) {
    const result=spawnSync(process.execPath,['build.mjs'],{cwd:root,stdio:'inherit'});
    if(result.status!==0) throw new Error(`${folder} 构建失败`);
  } else {await fs.mkdir(path.join(root,'package'),{recursive:true});await fs.copyFile(path.join(root,'plugin.json'),path.join(root,'package/plugin.json'));}
  const files={};
  for(const name of ['plugin.json',...Object.values(manifest.application||{})]) {
    const target=path.join(root,'package',name), stat=await fs.lstat(target);
    if(!stat.isFile()||stat.isSymbolicLink()) throw new Error('发布包只能包含普通文件');
    const bytes=await fs.readFile(target);
    if(bytes.length>(name==='plugin.json'?64000:15000000)) throw new Error('发布文件过大');
    files[name]=bytes.toString('base64');
  }
  const name=`${manifest.id}-${manifest.version}.dwp`, bytes=Buffer.from(JSON.stringify({format:'delivery-plugin/1',files}));
  if(bytes.length>41000000)throw new Error('发布包过大');
  await fs.writeFile(path.join(out,name),bytes);
  releases.push({id:manifest.id,version:manifest.version,manifest,package:name,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await fs.writeFile(path.join(out,'catalog.json'),JSON.stringify({protocol:1,releases},null,2)+'\n');
console.log(`已生成 ${releases.length} 个独立发布包和目录：${out}`);
