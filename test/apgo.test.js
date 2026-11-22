import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as ap from '../lib/ap-state.js';
import { rewriteAssembly, rewriteSections, stripIdentity } from '../lib/prompt.js';
import { statusView } from '../lib/views.js';

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apgo-test-'));

test('读 agent-purge 原生 state.json：分家 override 优先于全局', () => {
  const state = {
    v: 1, persona: 'global', default: { mode: 'replace' },
    armed: { dsh: ['install'] },
    overrides: { dsh: { persona: 'dsh-only', mode: 'append' } },
  };
  const c = ap.resolveConfigured(state);
  assert.equal(c.persona, 'dsh-only');
  assert.equal(c.mode, 'append');
  assert.equal(c.personaFrom, 'override');
  fs.writeFileSync(path.join(home(), 'x'), '');
});

test('激活语义：未装 install 通道、全局 off、profile 排除都会挡住', () => {
  const base = { persona: 'p', default: { mode: 'replace' }, armed: { dsh: ['install'] } };
  assert.equal(ap.resolveActivation(base).on, true);
  assert.equal(ap.resolveActivation({ ...base, armed: {} }).blockedBy, 'not-enabled');
  assert.equal(ap.resolveActivation({ ...base, default: { mode: 'off' } }).blockedBy, 'global-pause');
  assert.equal(ap.resolveActivation({ ...base, dshProfiles: ['desktop'] }).blockedBy, 'profile-off');
  assert.equal(ap.resolveActivation({ ...base, dshProfiles: ['web'] }).on, true);
});

test('首次 seed 出中性人设并可切换人设/模式/开关，写回原生字段', async () => {
  const root = home();
  await ap.ensureInitial(root);
  let st = await ap.readState(root);
  assert.equal(st.persona, 'neutral');
  assert.deepEqual(st.armed.dsh, ['install']);
  await fs.promises.writeFile(ap.personaFile(root, 'concise'), '---\ndescription: 简洁\n---\n用中文。\n');
  await ap.setPersona(root, 'concise');
  await ap.setMode(root, 'append');
  await ap.setEnabled(root, false);
  st = await ap.readState(root);
  assert.equal(st.persona, 'concise');
  assert.equal(st.default.mode, 'append');
  assert.equal(st.armed.dsh, undefined);
  assert.equal(await ap.personaBody(root, 'concise'), '用中文。');
  await assert.rejects(() => ap.setPersona(root, 'missing'));
});

test('注入语义对齐 agent-purge：strict 只剩人设、replace 置顶剥身份、append 追加、off 原样', () => {
  const asm = { sections: [{ name: 'harness:identity', text: 'You are Claude, an AI assistant.' }, { name: 'tools', text: 'Tools here.' }], contexts: ['c'], tools: ['t'] };
  const strict = rewriteAssembly(asm, 'P', 'strict');
  assert.deepEqual(strict.sections.map((s) => s.name), ['apgo-persona']);
  const replace = rewriteAssembly(asm, 'P', 'replace');
  assert.equal(replace.sections[0].name, 'apgo-persona');
  assert.ok(!replace.sections.some((s) => /You are Claude/.test(s.text || '')));
  assert.deepEqual(replace.tools, ['t']);
  const append = rewriteAssembly(asm, 'P', 'append');
  assert.equal(append.sections.at(-1).name, 'apgo-persona');
  assert.deepEqual(rewriteAssembly(asm, 'P', 'off'), asm);
  assert.equal(stripIdentity('你是 DeepSeek 的助手\n保留这行'), '保留这行');
});

test('apply 在假宿主上注册命令、工具与原生面板，不注册审批 hook', async () => {
  const { apply } = await import('../lib/index.js');
  const reg = { commands: [], tools: [], slots: {}, hooks: [] };
  const ctx = {
    get: (n) => (n === 'commands' ? { register: (c) => reg.commands.push(c) } : null),
    tools: { register: (t) => reg.tools.push(t) },
    systemPrompt: { section: () => {}, assemble: async (a) => a },
    on: (name) => { reg.hooks.push(name); },
    effect: (fn) => { reg.dispose = fn(); },
    inject: (names, cb) => { if (names.includes('dshGo')) cb({ dshGo: { on: (id) => { reg.slots[id] = 1; }, strip: (id) => { reg.slots[id] = 1; }, panel: (id) => { reg.slots[id] = 1; } } }); },
  };
  await apply(ctx);
  assert.equal(reg.commands.length, 1);
  assert.deepEqual(reg.tools.map((t) => t.name), ['agentpurge_status', 'agentpurge_use']);
  assert.ok(reg.slots['apgo.main']);
  assert.ok(!reg.hooks.includes('approval/request'));
  reg.dispose?.();
});

test('状态视图只用 dsh-go 稳定组件', () => {
  const v = statusView({ active: true, mode: 'replace', persona: 'p', personas: [{ id: 'p' }] });
  assert.equal(v.type, 'stack');
  assert.ok(v.children.some((c) => c.type === 'list'));
  assert.ok(Buffer.byteLength(JSON.stringify(v), 'utf8') < 32 * 1024);
});
