import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPlugin } from '../plugins/alert-hub/application.js';
const config = { endpoint: 'https://hub.example', command: '/test/mcp', username: 'demo', password: 'fake-secret' };
function mock() {
 const calls: any[] = []; let closed = 0;
 const client = { listTools: async () => [{ name: 'get_me', annotations: {readOnlyHint:true}, inputSchema:{} }, {name:'ack_case',annotations:{readOnlyHint:true},inputSchema:{}}], callTool: async (name: string,args: unknown) => { calls.push({name,args}); return {structuredContent:{ok:true}}; }, close: async () => {closed++} };
 const plugin = createPlugin({dataDirectory:'',workspaceDirectory:'',configuration:config,mcp:{connect:async options => {assert.equal(options.env?.ALERT_HUB_MCP_PASSWORD,config.password);return client}}});
 return { plugin,calls,client,closed:()=>closed };
}
test('MCP configuration, audited reads and single-use argument-bound write confirmation',async()=>{
 const {plugin,calls,closed}=mock();
 assert.equal((await plugin.request('status')).configured,true);
 assert.equal(JSON.stringify(await plugin.request('status')).includes(config.password),false);
 await plugin.request('read',{name:'get_me'});assert.equal(calls.length,1);
 await assert.rejects(plugin.request('read',{name:'ack_case',arguments:{id:'c1'}}),/预览/);
 const input={name:'ack_case',arguments:{id:'c1'}};
 const preview=await plugin.request('prepare',input);assert.equal(calls.length,1);
 await assert.rejects(plugin.request('commit',{...preview,arguments:{id:'c2'}}),/确认/);
 await assert.rejects(plugin.request('commit',preview),/确认/);
 const fresh=await plugin.request('prepare',input);await plugin.request('commit',fresh);assert.equal(calls.length,2);
 await assert.rejects(plugin.request('commit',fresh),/确认/);
 await plugin.close();assert.equal(closed(),1);
});
test('missing config blocks connection; MCP errors are shown and credentials redacted',async()=>{
 const empty=createPlugin({configuration:{},mcp:{connect:async()=>{throw Error('must not connect')}},dataDirectory:'',workspaceDirectory:''});
 await assert.rejects(empty.request('tools'),/配置/);
 const {plugin,client}=mock(); client.callTool=async()=>({isError:true,content:[{type:'text',text:'server message fake-secret'}]}) as any;
 await assert.rejects(plugin.request('read',{name:'get_me'}),e=>e instanceof Error && e.message==='server message [已隐藏]');
});
