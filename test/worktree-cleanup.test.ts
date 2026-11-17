import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PluginApplicationHost, PluginWorkspaceUsage } from '@delivery/plugin-sdk/server';
import { createPlugin } from '../plugins/worktree-cleanup/application.js';

async function fixture(t: any) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanup-plugin-'));
 let now = Date.now(), calls = 0, failure = '', eligible = true;
 const access = { read: true, cleanup: true, background: true };
 const items: PluginWorkspaceUsage[] = [{ path: '/managed/session', branch: 'feature/test', bytes: 2048, sessions: [{id:'session',title:'测试会话',updatedAt:new Date(now-20*86400000).toISOString()}], eligible:true, managed:true, lastUsedAt:new Date(now-20*86400000).toISOString() }];
 const removed: any[] = [];
 const host = { dataDirectory: root, workspaces: {
  access: async () => ({ ...access }), list: async () => { if (!access.read) throw new Error('未授权'); return structuredClone(items); },
  preview: async (path: string) => ({ path, revision:'rev-1', eligible, reason: eligible ? '' : '正在使用' }),
  remove: async (input: any) => { calls++; if (!access.cleanup) throw new Error('未授权'); if (failure) throw new Error(failure); if (!eligible) throw new Error('正在使用'); removed.push(input); return {path:input.path,deleted:true}; },
 } } as unknown as PluginApplicationHost;
 let plugin = await createPlugin(host, () => now);
 t.after(async () => { await plugin.close(); await fs.rm(root,{recursive:true,force:true}); });
 return { root, items, access, removed, request:(method:string,input?:unknown)=>plugin.request(method,input),
  advance:(ms:number)=>{now+=ms;}, busy:()=>{eligible=false;}, fail:(text:string)=>{failure=text;}, calls:()=>calls,
  reopen:async()=>{await plugin.close();plugin=await createPlugin(host,()=>now);},close:()=>plugin.close() };
}
const day=86400000;
async function enable(f:Awaited<ReturnType<typeof fixture>>) {
 const state:any=await f.request('status');
 await f.request('policy',{policy:{enabled:true,idleDays:7,intervalHours:1},revision:state.revision,confirmed:true});
}

test('默认不删除；只读授权可扫描，拒绝预览和定时启用',async t=>{
 const f=await fixture(t);await f.request('tick');assert.equal(f.calls(),0);
 f.access.cleanup=false;f.access.background=false;
 const state:any=await f.request('scan');assert.equal(state.items[0].sessions[0].title,'测试会话');
 await assert.rejects(f.request('preview',{paths:[f.items[0].path]}),/未授予/);
 await assert.rejects(enable(f),/授权/);assert.equal(f.calls(),0);
});
test('手动清理绑定预览与确认；重复令牌不重放，保留审计并重载',async t=>{
 const f=await fixture(t);await f.request('scan');
 const p:any=await f.request('preview',{paths:[f.items[0].path]});
 await assert.rejects(f.request('clean',{token:p.token,confirmed:false}));assert.equal(f.calls(),0);
 const result:any=await f.request('clean',{token:p.token,confirmed:true});assert.equal(result.results[0].status,'deleted');
 assert.deepEqual(f.removed[0],{path:f.items[0].path,revision:'rev-1',confirmName:'session'});
 await assert.rejects(f.request('clean',{token:p.token,confirmed:true}),/已过期或使用/);
 await f.reopen();const state:any=await f.request('status');assert.equal(state.history[0].status,'deleted');assert.equal(f.calls(),1);
});
test('预览后占用变化、过期、未列出目录与撤权均不能清理',async t=>{
 const f=await fixture(t);await f.request('scan');
 await assert.rejects(f.request('preview',{paths:['/outside']}),/重新扫描/);
 const expired:any=await f.request('preview',{paths:[f.items[0].path]});f.advance(300001);
 await assert.rejects(f.request('clean',{token:expired.token,confirmed:true}),/过期/);assert.equal(f.calls(),0);
 const p:any=await f.request('preview',{paths:[f.items[0].path]});f.busy();
 const result:any=await f.request('clean',{token:p.token,confirmed:true});assert.equal(result.results[0].status,'blocked');assert.equal(f.removed.length,0);
});
test('定时策略持久化，达到间隔后只处理符合条件的宿主管理 worktree',async t=>{
 const f=await fixture(t);
 f.items.push({...f.items[0],path:'/external/worktree',managed:false},{...f.items[0],path:'/managed/recent',lastUsedAt:new Date().toISOString()},{...f.items[0],path:'/managed/dirty',eligible:false});
 await enable(f);await f.request('tick');assert.equal(f.calls(),0);
 await f.reopen();f.advance(3600001);await f.request('tick');assert.equal(f.calls(),1);assert.ok(f.removed[0].idleBefore);
 await f.request('tick');assert.equal(f.calls(),1);
});
test('撤回后台权限、清理权限、停用和关闭策略均停止后续定时执行',async t=>{
 const f=await fixture(t);await enable(f);f.advance(day);f.access.background=false;await f.request('tick');assert.equal(f.calls(),0);
 f.access.background=true;f.access.cleanup=false;await f.request('tick');assert.equal(f.calls(),0);
 const s:any=await f.request('status');await f.request('policy',{policy:{...s.policy,enabled:false},revision:s.revision,confirmed:true});
 f.access.cleanup=true;await f.request('tick');assert.equal(f.calls(),0);
 await f.close();await assert.rejects(f.request('tick'),/停止/);
});
test('策略保存防覆盖；取消或缺少确认无副作用',async t=>{
 const f=await fixture(t);const s:any=await f.request('status');
 await assert.rejects(f.request('policy',{policy:{enabled:true,idleDays:7,intervalHours:1},revision:s.revision,confirmed:false}));
 await enable(f);await assert.rejects(f.request('policy',{policy:s.policy,revision:s.revision,confirmed:true}),/已变化/);
});
test('超时结果标记待核对，重启及后续周期均不重放',async t=>{
 const f=await fixture(t);await enable(f);f.fail('能力调用超时，结果待核对');f.advance(day);await f.request('tick');
 const s:any=await f.request('status');assert.equal(s.history[0].status,'unknown');assert.equal(f.calls(),1);
 await f.reopen();f.advance(day);await f.request('tick');assert.equal(f.calls(),1);
});
test('运行中断的持久化 pending 在重启后变为待核对',async t=>{
 const f=await fixture(t);await enable(f);await f.close();
 const file=path.join(f.root,'cleanup.json');const stored=JSON.parse(await fs.readFile(file,'utf8'));
 stored.history=[{id:'crash',path:f.items[0].path,at:new Date().toISOString(),mode:'scheduled',status:'pending',message:'pending',bytes:2048}];
 await fs.writeFile(file,JSON.stringify(stored));await f.reopen();f.advance(day);await f.request('tick');
 assert.equal(f.calls(),0);assert.equal((await f.request('status') as any).history[0].status,'unknown');
});
