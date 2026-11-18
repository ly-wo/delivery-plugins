<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { host } from '@delivery/plugin-sdk-browser/browser';
import type { BrowserConnectionStatus } from './types';
const state=ref<BrowserConnectionStatus>(),busy=ref(false),error=ref('');
const openingGuide=ref(false),installationError=ref('');
async function openInstallationGuide(){
 if(openingGuide.value)return;openingGuide.value=true;installationError.value='';
 try{await host.request('open-installation-guide',{confirmed:true});}
 catch(e){if(!disposed)installationError.value=e instanceof Error?e.message:'打开安装说明失败';}
 finally{if(!disposed)openingGuide.value=false;}
}
const dialog=ref<HTMLDialogElement>(),pending=ref<'connect'|'disconnect'|'open-settings'>('connect');
let version=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined,unsubscribe:(()=>void)|undefined;
const verified=computed(()=>state.value?.phase==='connected'&&state.value.connectionVerified&&!error.value);
const label=computed(()=>error.value?'状态待核对':verified.value?'已连接':state.value?({unavailable:'Chrome 不可用',setup_required:'等待开启远程调试',ready:'可以连接',connecting:'等待 Chrome 授权',connected:'连接待核验',reconnecting:'等待恢复',error:'连接失败'}[state.value.phase]):'读取状态');
const canConnect=computed(()=>!!state.value&&state.value.chromeAvailable&&state.value.phase!=='unavailable'&&!['connecting','reconnecting'].includes(state.value.phase));
function schedule(){clearTimeout(timer);if(disposed||document.hidden)return;const phase=state.value?.phase;if(error.value||['connecting','reconnecting','connected'].includes(phase||''))timer=setTimeout(()=>void refresh(),phase==='connected'?10000:2500);}
async function refresh(){if(busy.value||disposed)return;const current=++version;try{const result=await host.request<BrowserConnectionStatus>('status');if(disposed||current!==version)return;state.value=result;error.value='';}catch(e){if(!disposed&&current===version)error.value=e instanceof Error?e.message:'读取失败';}finally{if(!disposed&&current===version)schedule();}}
function prepare(action:typeof pending.value){pending.value=action;dialog.value?.showModal();}
async function confirm(){if(busy.value)return;busy.value=true;error.value='';const current=++version;clearTimeout(timer);dialog.value?.close();try{const result=await host.request<BrowserConnectionStatus>(pending.value,{confirmed:true});if(!disposed&&current===version)state.value=result;}catch(e){if(!disposed&&current===version)error.value=e instanceof Error?e.message:'操作失败';}finally{if(!disposed){busy.value=false;schedule();}}}
function visible(){if(document.hidden){version++;clearTimeout(timer);}else void refresh();}
onMounted(async()=>{document.addEventListener('visibilitychange',visible);try{await host.theme.get();if(!disposed)unsubscribe=host.theme.subscribe(()=>{});}catch{/* 旧宿主仍可通过兼容主题变量显示。 */}if(!disposed)await refresh();});
onUnmounted(()=>{disposed=true;version++;clearTimeout(timer);unsubscribe?.();document.removeEventListener('visibilitychange',visible);});
</script>
<template>
 <main class="chrome-console">
  <div class="toolbar"><strong>浏览器连接</strong><span class="badge" :class="{success:verified}">{{label}}</span><button class="refresh" :disabled="busy" @click="refresh">刷新状态</button></div>
  <p v-if="error" class="error" role="alert">{{error}}</p>
  <section class="card">
   <div class="summary"><span class="chrome-mark" aria-hidden="true">◎</span><div><h2>日常 Chrome <small>可选能力</small></h2><p>{{state?.message||'正在读取本机 Chrome 状态…'}}</p></div></div>
   <p v-if="state?.toolAvailable===false" class="notice">未安装 agent-browser，仅影响依赖它的网页自动操作；普通会话、代码任务与接口功能仍可使用，也不影响连接 Chrome。 <a class="installation-link" href="https://agent-browser.dev/installation" target="_blank" rel="noopener noreferrer" :aria-disabled="openingGuide" @click.prevent="openInstallationGuide">{{openingGuide?'正在打开…':'安装 agent-browser ↗'}}</a><span v-if="installationError" class="error" role="alert"> {{installationError}}</span></p>
   <div class="actions"><button :disabled="busy||!state?.chromeAvailable" @click="prepare('open-settings')">打开 Chrome 设置</button><button class="primary" :disabled="busy||!canConnect" @click="prepare('connect')">{{verified?'重新检测':'连接 Chrome'}}</button><button v-if="verified||['connecting','reconnecting'].includes(state?.phase||'')" :disabled="busy" @click="prepare('disconnect')">断开连接</button></div>
   <p v-if="state?.phase==='connecting'">请在 Chrome 弹出的授权窗口中选择允许；只有握手验证通过后才显示已连接。</p>
   <p class="muted">{{state?.browserVersion||'尚未验证浏览器版本'}} · 最近检测：{{state?.checkedAt?new Date(state.checkedAt).toLocaleTimeString():'—'}}</p>
  </section>
  <section class="card guide"><h3>使用方式</h3><ol><li>打开日常 Chrome 的远程调试设置，按浏览器提示开启。</li><li>点击“连接 Chrome”，在 Chrome 中明确允许连接。</li><li>确认已连接后，再开始需要网页操作的 AI 任务。目标网站登录与业务验证需分别核对。</li></ol><p class="muted">不会启动独立浏览器配置或复制登录态。隐藏菜单或关闭页面不等于断开；停用、移除插件会关闭插件自己的通道，不退出 Chrome。宿主重启后需重新打开插件并连接。</p></section>
  <dialog ref="dialog" aria-labelledby="chrome-confirm-title"><h3 id="chrome-confirm-title">{{pending==='disconnect'?'断开浏览器连接':pending==='open-settings'?'打开 Chrome 设置':'连接日常 Chrome'}}</h3><p>{{pending==='disconnect'?'将停止本插件的浏览器连接，正在使用该通道的任务可能中断。不会关闭 Chrome。':pending==='open-settings'?'将打开本机 Chrome 的远程调试设置，不会自动修改设置或授权。':'连接后，获准使用此通道的 AI 任务可以操作日常 Chrome 的页面，包括已登录网站。请在 Chrome 中核对授权；插件不会代你确认。'}}</p><div class="actions"><button @click="dialog?.close()">取消</button><button class="primary" :disabled="busy" @click="confirm">确认</button></div></dialog>
 </main>
</template>
