import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import os from 'node:os';
import { z } from 'zod';
import type { PluginApplicationHost, PluginInvocationContext } from '@delivery/plugin-sdk-browser/server';
import { createBrowserConnection, type BrowserConnectionOptions } from './connection';

/** No host-private paths or credentials. Chrome only exposes its public DevToolsActivePort. */
export async function createPlugin(host: PluginApplicationHost, options: Partial<BrowserConnectionOptions> & {openInstallationGuide?: () => Promise<void>} = {}) {
  const connection = createBrowserConnection({ rootDirectory: host.dataDirectory, homeDirectory: os.userInfo().homedir, ...options });
  const openInstallationGuide=options.openInstallationGuide || (async () => {
    if ((options.platform || process.platform) !== 'darwin') throw new Error('请在浏览器打开 https://agent-browser.dev/installation');
    await promisify(execFile)('open', ['https://agent-browser.dev/installation'], {timeout:10000});
  });
  let server: http.Server | undefined, port = 0, closed = false;
  const active = () => { if (closed) throw new Error('插件已停用'); };
  async function session() {
    active();
    const status = await connection.status();
    if (!status.connectionVerified) return { endpoint: null, verified: false };
    if (!server) {
      const own = http.createServer((_request,response) => { response.writeHead(404); response.end(); });
      server = own;
      own.on('upgrade',(request,socket,head) => connection.upgrade(request,socket,head,port));
      await new Promise<void>((resolve,reject) => {
        own.once('error',reject);
        own.listen(0,'127.0.0.1',() => { own.off('error',reject); resolve(); });
      });
      active();
      port = (own.address() as {port:number}).port;
    }
    const endpoint = await connection.taskEndpoint(port);
    active();
    return { endpoint: endpoint || null, verified: !!endpoint };
  }
  return {
    async request(method: string, input?: unknown, context?: PluginInvocationContext) {
      active();
      if (method === 'status' || method === 'browser/status') return connection.status();
      if (method === 'browser/session') {
        // Only a host-controlled request may receive the loopback capability URL.
        if (context?.source !== 'host') throw new Error('浏览器会话仅供宿主授权的任务调用');
        return session();
      }
      z.object({confirmed:z.literal(true)}).strict().parse(input);
      if (method === 'open-installation-guide') {await openInstallationGuide();return {opened:true};}
      if (method === 'connect') return connection.connect();
      if (method === 'open-settings') return connection.openSettings();
      if (method === 'disconnect') return connection.disconnect();
      throw new Error('插件不支持此操作');
    },
    async close() {
      if (closed) return;
      closed = true;
      await connection.disconnect();
      if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));
    },
  };
}
