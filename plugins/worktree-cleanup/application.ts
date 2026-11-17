import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { PluginApplicationHost, PluginWorkspaceUsage, PluginWorkspacePreview } from '@delivery/plugin-sdk/server';

const policySchema = z.object({ enabled: z.boolean(), idleDays: z.number().int().min(1).max(365), intervalHours: z.number().int().min(1).max(168) }).strict();
const entrySchema = z.object({ id: z.string(), path: z.string(), at: z.string(), mode: z.enum(['manual', 'scheduled']), status: z.enum(['pending', 'deleted', 'blocked', 'unknown']), message: z.string(), bytes: z.number().nullable() }).strict();
const savedSchema = z.object({ version: z.literal(1), policy: policySchema, nextRunAt: z.string().optional(), history: z.array(entrySchema).max(200), heldPaths: z.array(z.string()).default([]) }).strict();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type CleanupPolicy = z.infer<typeof policySchema>;
export type CleanupHistory = z.infer<typeof entrySchema>;
export type CleanupSnapshot = {
  policy: CleanupPolicy; revision: string; nextRunAt?: string; history: CleanupHistory[];
  items: PluginWorkspaceUsage[]; scannedAt: string; error: string;
  access: { read: boolean; cleanup: boolean; background: boolean };
};

export async function createPlugin(host: PluginApplicationHost, now = Date.now) {
  if (!host.workspaces) throw new Error('请升级宿主至支持 SDK 2.2.0 的版本并重启工作台');
  const file = path.join(host.dataDirectory, 'cleanup.json');
  await fs.mkdir(host.dataDirectory, { recursive: true, mode: 0o700 });
  let saved: z.infer<typeof savedSchema>;
  try { saved = savedSchema.parse(JSON.parse(await fs.readFile(file, 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('插件清理配置读取失败，请保留数据并检查；未执行清理');
    saved = { version: 1, policy: { enabled: false, idleDays: 7, intervalHours: 24 }, history: [], heldPaths: [] };
  }
  let items: PluginWorkspaceUsage[] = [], scannedAt = '', error = '', closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const previews = new Map<string, { expires: number; items: (PluginWorkspacePreview & { bytes: number | null })[] }>();
  async function persist(next = saved) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, file); saved = next; }
    finally { await fs.rm(temporary, { force: true }); }
  }
  // A crash or IPC timeout never implies that deletion did not happen. Do not replay it.
  if (saved.history.some(item => item.status === 'pending')) await persist({ ...saved, heldPaths: [...new Set([...saved.heldPaths, ...saved.history.filter(item => item.status === 'pending').map(item => item.path)])], history: saved.history.map(item => item.status === 'pending' ? { ...item, status: 'unknown', message: '上次操作中断，结果待核对；请重新扫描，不自动重放' } : item) });
  const active = () => { if (closed) throw new Error('插件正在停止'); };
  async function snapshot(): Promise<CleanupSnapshot> {
    return { ...structuredClone(saved), revision: digest(saved.policy), items: structuredClone(items), scannedAt, error, access: await host.workspaces.access() };
  }
  async function scan() {
    active(); error = ''; previews.clear();
    try { const found = await host.workspaces.list(); active(); items = found; scannedAt = new Date(now()).toISOString(); }
    catch (cause) { items = []; scannedAt = ''; error = cause instanceof Error ? cause.message : '扫描失败'; throw cause; }
  }
  async function remove(selected: PluginWorkspacePreview & { bytes: number | null }, mode: 'manual' | 'scheduled', idleBefore?: number) {
    active();
    const id = randomUUID();
    const record: CleanupHistory = { id, path: selected.path, at: new Date(now()).toISOString(), mode, status: 'pending', message: '操作进行中；中断时需核对结果', bytes: selected.bytes };
    await persist({ ...saved, history: [record, ...saved.history].slice(0, 200) });
    let result: CleanupHistory;
    try {
      active();
      await host.workspaces.remove({ path: selected.path, revision: selected.revision, confirmName: path.basename(selected.path), ...(idleBefore === undefined ? {} : { idleBefore }) });
      result = { ...record, status: 'deleted', message: '已回收 worktree，保留 Git 分支和会话记录' };
      items = items.filter(item => item.path !== selected.path);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '清理失败';
      const uncertain = /超时|待核对|停止|断开|关闭/.test(message);
      result = { ...record, status: uncertain ? 'unknown' : 'blocked', message };
      items = items.map(item => item.path === selected.path ? { ...item, eligible: false, reason: message } : item);
    }
    await persist({ ...saved, heldPaths: result.status === 'unknown' ? [...new Set([...saved.heldPaths, selected.path])] : result.status === 'deleted' ? saved.heldPaths.filter(p => p !== selected.path) : saved.heldPaths, history: saved.history.map(item => item.id === id ? result : item) });
    return result;
  }
  async function request(method: string, raw: unknown) {
    active();
    if (method === 'status') return snapshot();
    if (method === 'scan') { await scan(); return snapshot(); }
    if (method === 'preview') {
      const input = z.object({ paths: z.array(z.string().min(1).max(2000)).min(1).max(100) }).strict().parse(raw);
      if (new Set(input.paths).size !== input.paths.length) throw new Error('清理列表不能重复');
      if (!(await host.workspaces.access()).cleanup) throw new Error('未授予工作区清理权限，仍可查看占用');
      const selected: (PluginWorkspacePreview & { bytes: number | null })[] = [];
      for (const folder of input.paths) {
        const item = items.find(item => item.path === folder);
        if (!item?.eligible) throw new Error('请重新扫描并选择可清理的会话 worktree');
        const preview = await host.workspaces.preview(folder);
        if (!preview.eligible) throw new Error(preview.reason || '工作区不可清理');
        selected.push({ ...preview, bytes: item.bytes });
      }
      for (const [token, preview] of previews) if (preview.expires <= now()) previews.delete(token);
      if (previews.size >= 20) previews.delete(previews.keys().next().value!);
      const token = randomUUID(); previews.set(token, { expires: now() + 300_000, items: selected });
      return { token, items: selected, message: '只删除选中且通过执行前复核的 worktree。保留 Git 分支及会话记录；未提交或忽略文件不会被强制丢弃。' };
    }
    if (method === 'clean') {
      const input = z.object({ token: z.uuid(), confirmed: z.literal(true) }).strict().parse(raw);
      const preview = previews.get(input.token); previews.delete(input.token);
      if (!preview || preview.expires <= now()) throw new Error('清理预览已过期或使用，请重新预览');
      const results = [];
      for (const item of preview.items) { active(); const result = await remove(item, 'manual'); results.push(result); if (result.status === 'unknown') break; }
      return { results, snapshot: await snapshot() };
    }
    if (method === 'policy') {
      const input = z.object({ policy: policySchema, revision: z.string(), confirmed: z.literal(true) }).strict().parse(raw);
      if (input.revision !== digest(saved.policy)) throw new Error('清理策略已变化，请刷新后保存');
      const access = await host.workspaces.access();
      if (input.policy.enabled && (!access.cleanup || !access.background)) throw new Error('启用周期清理需要工作区清理与后台任务授权');
      await persist({ ...saved, policy: input.policy, nextRunAt: input.policy.enabled ? new Date(now() + input.policy.intervalHours * 3600000).toISOString() : undefined });
      return snapshot();
    }
    if (method === 'tick') {
      const access = await host.workspaces.access();
      if (!saved.policy.enabled || !access.read || !access.cleanup || !access.background || (saved.nextRunAt && Date.parse(saved.nextRunAt) > now())) return;
      // Save the next run before acting, so restart never repeats a timed-out batch.
      await persist({ ...saved, nextRunAt: new Date(now() + saved.policy.intervalHours * 3600000).toISOString() });
      const idleBefore = now() - saved.policy.idleDays * 86400000;
      await scan();
      const uncertain = new Set([...saved.heldPaths, ...saved.history.filter(item => ['pending', 'unknown'].includes(item.status)).map(item => item.path)]);
      const selected = items.filter(item => item.eligible && item.managed && item.lastUsedAt && Date.parse(item.lastUsedAt) <= idleBefore && !uncertain.has(item.path)).slice(0, 100);
      for (const item of selected) {
        active();
        const preview = await host.workspaces.preview(item.path);
        if (!preview.eligible) continue;
        if ((await remove({ ...preview, bytes: item.bytes }, 'scheduled', idleBefore)).status === 'unknown') break;
      }
      return;
    }
    throw new Error('不支持的清理操作');
  }
  return {
    request(method: string, input?: unknown) {
      const task = queue.then(() => request(method, input)); queue = task.catch(() => {}); return task;
    },
    async close() { closed = true; previews.clear(); await queue; },
  };
}
