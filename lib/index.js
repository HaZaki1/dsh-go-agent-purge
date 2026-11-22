import * as ap from './ap-state.js';
import { installPrompt } from './prompt.js';
import { resultView, statusView, toolCard } from './views.js';

export const name = 'dsh-go-agent-purge';
export const inject = ['systemPrompt', 'tools'];

const MODES = ['strict', 'replace', 'append', 'off'];

function sendText(text, ok = true) {
  return { kind: ok ? 'success' : 'error', text: String(text || '') };
}

async function statusLines(st) {
  return [
    'agent-purge · dsh-go 执行端',
    `数据目录: ${st.root}`,
    `profile: ${st.profile} · 注入: ${st.active ? '开' : '关'} · 模式: ${st.mode}`,
    `生效人设: ${st.persona || '-'}${st.personaFrom === 'override' ? '（分家覆盖）' : ''}`,
    `人设: ${st.personas.map((p) => p.id).join(', ') || '(空)'}`,
    st.blockedBy ? `未生效原因: ${st.blockedBy}` : '',
  ].filter(Boolean).join('\n');
}

export async function apply(ctx) {
  const root = ap.dataHome();
  await ap.ensureInitial(root);

  let cache = await ap.status(root);
  const refreshCache = async () => {
    try { cache = await ap.status(root); } catch { /* keep last good */ }
    return cache;
  };
  await refreshCache();

  const controller = installPrompt(ctx, async () => {
    const st = await refreshCache();
    const state = await ap.readState(root);
    const act = ap.resolveActivation(state);
    if (!act.on || act.mode === 'off' || !act.persona) return { persona: '', mode: 'off', on: false };
    return { persona: await ap.personaBody(root, act.persona), mode: act.mode, on: true };
  });
  const refreshPrompt = async () => { await controller.refresh(); await refreshCache(); };

  const cacheTimer = setInterval(() => { refreshCache().catch(() => {}); }, 5000);
  if (typeof cacheTimer.unref === 'function') cacheTimer.unref();
  ctx?.effect?.(() => () => clearInterval(cacheTimer));

  const commands = ctx.get?.('commands') || null;
  if (commands?.register) {
    commands.register({
      name: 'agentpurge',
      description: 'agent-purge 手机执行端：status | list | use <id> | mode <strict|replace|append|off> | on | off | help',
      input: { hint: 'status | list | use <id> | mode <mode> | on | off' },
      handler: async (invocation) => {
        const args = String(invocation?.rawInput || '').trim().split(/\s+/).filter(Boolean);
        const sub = (args[0] || 'status').toLowerCase();
        if (sub === 'status' || sub === 's') return sendText(await statusLines(await refreshCache()));
        if (sub === 'list' || sub === 'ls') {
          const st = await refreshCache();
          return sendText(st.personas.map((p) => `${p.id === st.persona ? '▶' : '·'} ${p.id}${p.description ? ` — ${p.description}` : ''}`).join('\n') || '(暂无)');
        }
        if (sub === 'use' || sub === 'u') {
          if (!args[1]) return sendText('用法: /agentpurge use <人设 id>', false);
          try { await ap.setPersona(root, args[1]); await refreshPrompt(); return sendText(`✓ 已切换到 ${args[1]}；下一轮生效。`); }
          catch (e) { return sendText(`失败: ${e.message}`, false); }
        }
        if (sub === 'mode' || sub === 'm') {
          if (!MODES.includes(args[1])) return sendText('用法: /agentpurge mode strict|replace|append|off', false);
          await ap.setMode(root, args[1]); await refreshPrompt(); return sendText(`✓ 模式 ${args[1]}。`);
        }
        if (sub === 'on' || sub === 'off') {
          await ap.setEnabled(root, sub === 'on'); await refreshPrompt(); return sendText(`✓ 注入已${sub === 'on' ? '开启' : '关闭'}。`);
        }
        return sendText('用法：/agentpurge status | list | use <id> | mode <strict|replace|append|off> | on | off');
      },
    });
  }

  if (ctx?.tools?.register) {
    const schema = { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } };
    const render = (_a, v) => [{ type: 'text', text: String(v?.text || '') }];
    ctx.tools.register({
      name: 'agentpurge_status',
      description: '查看 agent-purge 在 dsh-go 上的注入状态：人设、模式、数据目录。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
      output: { schema, render, presentationMeta: toolCard((_a, v) => statusView(cache)) },
      execute: async () => ({ text: await statusLines(await refreshCache()) }),
    });
    ctx.tools.register({
      name: 'agentpurge_use',
      description: '切换 agent-purge 当前生效的人设。',
      parameters: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' } }, required: ['id'] },
      output: { schema, render, presentationMeta: toolCard((a, v) => resultView('切换人设', [`${a.id} → ${v.text}`])) },
      execute: async (args) => {
        try { await ap.setPersona(root, args.id); await refreshPrompt(); return { text: `已切换到 ${args.id}` }; }
        catch (e) { return { text: `失败: ${e.message}` }; }
      },
    });
  }

  ctx.inject(['dshGo'], (host) => {
    const dsh = host.dshGo;
    if (!dsh) return;

    dsh.on('apgo.status', () => ({ open: 'panel:apgo.main', toast: 'agent-purge 状态' }));
    dsh.on('apgo.persona', () => ({ open: 'panel:apgo.main' }));
    dsh.on('apgo.copy', async () => {
      const state = await ap.readState(root);
      const act = ap.resolveActivation(state);
      const body = act.on ? await ap.personaBody(root, act.persona) : '';
      return { copy: body.slice(0, 8000), toast: '已复制当前人设' };
    });

    dsh.strip('apgo.strip', (_scope, emit) => {
      const push = () => emit({ text: `人设 ${String(cache.persona || '-').slice(0, 16)}` });
      push();
      const timer = setInterval(push, 5000);
      if (typeof timer.unref === 'function') timer.unref();
      return () => clearInterval(timer);
    });

    dsh.panel('apgo.main', {
      view: () => statusView(cache),
      data: (_scope, emit) => { emit({ active: cache.active, persona: cache.persona }); return () => {}; },
      actions: {
        usePersona: async (_scope, event) => {
          const id = String(event?.value?.id || '');
          try { await ap.setPersona(root, id); await refreshPrompt(); return { refresh: 'apgo.main', toast: `已切换到 ${id}` }; }
          catch (e) { return { toast: String(e.message || e).slice(0, 40) }; }
        },
        cycleMode: async () => {
          const next = MODES[(MODES.indexOf(cache.mode) + 1) % MODES.length];
          await ap.setMode(root, next); await refreshPrompt(); return { refresh: 'apgo.main', toast: `模式 ${next}` };
        },
        refresh: async () => { await refreshPrompt(); return { refresh: 'apgo.main' }; },
        copy: async () => {
          const state = await ap.readState(root);
          const act = ap.resolveActivation(state);
          const body = act.on ? await ap.personaBody(root, act.persona) : '';
          return { copy: body.slice(0, 8000), toast: '已复制当前人设' };
        },
      },
    });
  });
}

export default { name, inject, apply };
