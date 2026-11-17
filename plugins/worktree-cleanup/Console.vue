<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { host } from '@delivery/plugin-sdk/browser';
import type { CleanupSnapshot, CleanupPolicy } from './application';
const state = ref<CleanupSnapshot>(), query = ref(''), filter = ref('all'), selected = ref<string[]>([]), tab = ref('workspaces');
const busy = ref(false), error = ref(''), notice = ref(''), preview = ref<any>(), dialog = ref<HTMLDialogElement>(), consent = ref(false);
const policy = ref<CleanupPolicy>({ enabled: false, idleDays: 7, intervalHours: 24 });
const rows = computed(() => (state.value?.items || []).filter(item => (!query.value || `${item.path} ${item.branch} ${item.sessions.map(s => s.title).join(' ')}`.toLowerCase().includes(query.value.toLowerCase())) && (filter.value === 'all' || (filter.value === 'eligible' ? item.eligible : !item.eligible))));
const totalBytes = computed(() => (state.value?.items || []).reduce((sum, item) => sum + (item.bytes || 0), 0));
const eligibleBytes = computed(() => (state.value?.items || []).filter(item => item.eligible).reduce((sum, item) => sum + (item.bytes || 0), 0));
function bytes(value: number | null) { if (value === null) return '未能统计'; if (value < 1024) return `${value} B`; const n = Math.floor(Math.log(value) / Math.log(1024)); return `${(value / 1024 ** n).toFixed(1)} ${['B', 'KB', 'MB', 'GB', 'TB'][n]}`; }
const time = (value?: string) => value ? new Date(value).toLocaleString() : '—';
const name = (value: string) => value.split('/').filter(Boolean).at(-1);
const statusLabel = { pending: '进行中', deleted: '已清理', blocked: '已阻止', unknown: '待核对' };
async function run(action: () => Promise<void>) { if (busy.value) return; busy.value = true; error.value = ''; notice.value = ''; try { await action(); } catch (e: any) { error.value = e.message || '操作失败'; } finally { busy.value = false; } }
function assign(value: CleanupSnapshot) { state.value = value; policy.value = { ...value.policy }; selected.value = selected.value.filter(p => value.items.some(i => i.path === p && i.eligible)); }
async function scan() { await run(async () => { selected.value = []; assign(await host.request('scan')); }); }
async function prepare() { await run(async () => { preview.value = await host.request('preview', { paths: selected.value }); consent.value = false; dialog.value?.showModal(); }); }
async function clean() { await run(async () => { const result = await host.request('clean', { token: preview.value.token, confirmed: true }); assign(result.snapshot); dialog.value?.close(); selected.value = []; tab.value = 'history'; notice.value = `本次已处理 ${result.results.length} 个工作区，请核对各项结果。`; }); }
const policyDialog = ref<HTMLDialogElement>(), policyConsent = ref(false);
function preparePolicy() { policyConsent.value = false; policyDialog.value?.showModal(); }
async function savePolicy() { await run(async () => { assign(await host.request('policy', { policy: { ...policy.value }, revision: state.value!.revision, confirmed: true })); policyDialog.value?.close(); notice.value = state.value!.policy.enabled ? '周期清理已启用，到期时重新扫描并检查，不立即执行。' : '周期清理已关闭。'; }); }
let unsubscribe: (() => void) | undefined;
onMounted(async () => { await run(async () => { await host.theme.get(); unsubscribe = host.theme.subscribe(() => {}); assign(await host.request('status')); assign(await host.request('scan')); }); });
onUnmounted(() => unsubscribe?.());
</script>
<template>
 <main class="console cleanup">
  <div class="toolbar"><nav class="tabs" aria-label="清理功能"><button :class="{active:tab==='workspaces'}" @click="tab='workspaces'">会话工作区</button><button :class="{active:tab==='policy'}" @click="tab='policy'">定时清理</button><button :class="{active:tab==='history'}" @click="tab='history'">清理记录</button></nav><button class="refresh" :disabled="busy" @click="scan">{{busy?'处理中…':'重新扫描'}}</button></div>
  <p v-if="error" class="error" role="alert">{{error}}</p><p v-if="notice" role="status">{{notice}}</p>
  <p class="muted intro">仅显示当前工作台会话实际关联的 Git worktree。主仓库、未提交改动、忽略文件和正在使用的工作区受保护。<br>按磁盘分配空间统计，包含会话关联的外部 worktree；与设置中的本机数据文件大小统计范围不同。</p>
  <template v-if="state">
   <section v-if="tab==='workspaces'">
    <div class="stats"><div class="card"><span>会话工作区</span><strong>{{state.items.length}} <small>个</small></strong></div><div class="card"><span>worktree 磁盘占用</span><strong>{{bytes(totalBytes)}}</strong></div><div class="card"><span>可清理占用</span><strong>{{bytes(eligibleBytes)}}</strong></div><div class="card"><span>周期清理</span><strong>{{state.policy.enabled?'已启用':'未启用'}}</strong></div></div>
    <div class="toolbar filters"><input v-model="query" aria-label="搜索工作区或会话" placeholder="搜索会话名称、路径或分支"><span class="select-field"><select v-model="filter" aria-label="清理状态"><option value="all">全部工作区</option><option value="eligible">可清理</option><option value="protected">受保护</option></select></span><button :disabled="busy||!state.access.cleanup" @click="selected=rows.filter(i=>i.eligible).slice(0,100).map(i=>i.path)">选择可清理项</button><button class="primary" :disabled="busy||!selected.length||!state.access.cleanup" @click="prepare">预览清理（{{selected.length}}）</button></div>
    <p v-if="!state.access.cleanup" class="muted">未授予清理权限，当前为只读模式。可在插件中心的权限设置中开启。</p>
    <div class="card scroll listing"><table v-if="rows.length"><thead><tr><th>选择</th><th>工作区 / 会话</th><th>分支</th><th>占用</th><th>最后使用</th><th>状态</th></tr></thead><tbody><tr v-for="row in rows" :key="row.path"><td><input v-model="selected" :value="row.path" type="checkbox" :disabled="busy||!row.eligible||!state.access.cleanup" :aria-label="'选择 '+row.path"></td><td class="workspace"><strong>{{name(row.path)}}</strong><div class="path">{{row.path}}</div><details><summary>{{row.sessions.length}} 个关联会话</summary><p v-for="session in row.sessions" :key="session.id">{{session.title || session.id}}<br><small class="muted">{{time(session.updatedAt)}}</small></p></details><span class="badge">{{row.managed?'宿主管理':'外部会话工作区'}}</span></td><td>{{row.branch||'分离 HEAD'}}</td><td class="nowrap">{{bytes(row.bytes)}}</td><td>{{time(row.lastUsedAt)}}</td><td><span :class="['badge',row.eligible?'available':'']">{{row.eligible?'可清理':'受保护'}}</span><p class="muted reason">{{row.reason}}</p></td></tr></tbody></table><p v-else class="empty">{{busy?'正在扫描…':query||filter!=='all'?'没有匹配的工作区':'没有发现会话关联的 worktree'}}</p></div>
    <p class="muted">最近扫描：{{time(state.scannedAt)}}。清理前会再次检查目录身份、占用与 Git 状态。</p>
   </section>
   <section v-else-if="tab==='policy'" class="card policy stack">
    <h3>周期清理策略</h3><p class="muted">仅自动处理宿主管理、满足闲置天数且安全检查通过的会话 worktree。需要工作台持续运行；停用插件或撤回权限即停止后续执行，不影响其他服务。</p>
    <label class="checkbox-field">启用周期清理<input v-model="policy.enabled" type="checkbox" :disabled="busy||(!state.access.background||!state.access.cleanup)&&!state.policy.enabled"></label>
    <div class="grid"><label>闲置至少（天）<input v-model.number="policy.idleDays" type="number" min="1" max="365" :disabled="busy"></label><label>执行间隔（小时）<input v-model.number="policy.intervalHours" type="number" min="1" max="168" :disabled="busy"></label></div>
    <p>下次执行：{{time(state.nextRunAt)}}</p><p v-if="!state.access.background||!state.access.cleanup" class="muted">周期清理需要「后台任务」和「工作区清理」授权；缺少授权时不会执行。</p>
    <footer><button class="primary" :disabled="busy" @click="preparePolicy">预览并保存策略</button></footer>
   </section>
   <section v-else class="card scroll"><table v-if="state.history.length"><thead><tr><th>时间</th><th>工作区</th><th>方式</th><th>结果</th></tr></thead><tbody><tr v-for="item in state.history" :key="item.id"><td>{{time(item.at)}}</td><td class="path">{{item.path}}</td><td>{{item.mode==='manual'?'手动':'定时'}}</td><td><span class="badge">{{statusLabel[item.status]}}</span><p>{{item.message}}</p></td></tr></tbody></table><p v-else class="empty">暂无清理记录</p><p class="muted">保留最近 200 条记录。结果待核对的路径不会自动重试，请先重新扫描、检查实际状态。</p></section>
  </template>
  <dialog ref="dialog" @cancel="preview=undefined"><h2>确认清理会话工作区</h2><p>{{preview?.message}}</p><ul><li v-for="item in preview?.items" :key="item.path" class="path">{{item.path}} · {{bytes(item.bytes)}}</li></ul><label class="checkbox-field">已核对以上目录，允许清理这些副本<input v-model="consent" type="checkbox"></label><footer><button :disabled="busy" @click="dialog?.close();preview=undefined">取消</button><button class="primary" :disabled="busy||!consent" @click="clean">{{busy?'正在清理…':'确认清理'}}</button></footer></dialog>
  <dialog ref="policyDialog"><h2>确认周期清理策略</h2><p>{{policy.enabled?`每 ${policy.intervalHours} 小时扫描一次，清理闲置至少 ${policy.idleDays} 天的宿主管理会话 worktree。`:'关闭周期清理，不再自动清理工作区。'}}</p><p>保留分支和会话记录，不删除主仓库，不丢弃未提交或忽略文件。第一次执行将在一个完整间隔后进行。</p><label class="checkbox-field">确认保存此策略<input v-model="policyConsent" type="checkbox"></label><footer><button :disabled="busy" @click="policyDialog?.close()">取消</button><button class="primary" :disabled="busy||!policyConsent" @click="savePolicy">保存策略</button></footer></dialog>
 </main>
</template>
