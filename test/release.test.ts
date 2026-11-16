import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {pluginManifestSchema} from '@delivery/plugin-sdk/manifest';
test('all release manifests derive catalog metadata and are self-contained',async t=>{
 const catalog=JSON.parse(await fs.readFile('dist/catalog.json','utf8'));assert.ok(catalog.releases.length>=9);
 assert.ok(!catalog.releases.some((release:any)=>['jira','confluence'].includes(release.id)), 'fixed integrations must not be published as duplicate custom plugins');
 for(const release of catalog.releases){
  const bytes=await fs.readFile(path.join('dist',release.package));assert.equal(createHash('sha256').update(bytes).digest('hex'),release.sha256);
  const envelope=JSON.parse(bytes.toString()), manifest=pluginManifestSchema.parse(JSON.parse(Buffer.from(envelope.files['plugin.json'],'base64').toString()));assert.deepEqual(manifest,release.manifest);
  assert.ok(['capability','tool','application'].includes(manifest.category!));assert.equal(manifest.compatibility?.sdk,'2.1.0');
  if(manifest.application){const server=Buffer.from(envelope.files['server.mjs'],'base64').toString();assert.ok(!server.includes('/Users/lywo/'));const root=await fs.mkdtemp(path.join(os.tmpdir(),'detached-release-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'server.mjs'),server);const module=await import(pathToFileURL(path.join(root,'server.mjs')).href);assert.equal(typeof module.createPlugin,'function');}
 }
});
