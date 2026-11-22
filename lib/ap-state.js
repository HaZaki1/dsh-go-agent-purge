// 读取 agent-purge 的数据目录（state.json + personas/），按它的激活语义解析当前配置。
// 兼容 ZiChuanLan/agent-purge：AGENT_PURGE_HOME > ~/.agent-purge。
// 不修改 agent-purge 本体，不执行它的 CLI/Web；本插件只是 dsh-go 上的执行端。
import fs, { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MODES = ['strict', 'replace', 'append', 'off'];
export const PROFILE = 'web'; // dsh-go 本机引擎固定用 web profile，避免 agent-purge 的路径推导落空
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_PERSONA_BYTES = 512 * 1024;

export function dataHome() {
  const env = process.env.AGENT_PURGE_HOME?.trim();
  if (env) return path.isAbsolute(env) ? env : path.resolve(env);
  return path.join(os.homedir() || '', '.agent-purge');
}
export const stateFile = (root = dataHome()) => path.join(root, 'state.json');
export const personasDir = (root = dataHome()) => path.join(root, 'personas');
export const personaFile = (root, id) => path.join(personasDir(root), `${id}.md`);
export function validId(id) { return typeof id === 'string' && ID_RE.test(id); }

function emptyState() {
  return {
    v: 1,
    persona: null,
    default: { harness: 'dsh', mode: 'replace' },
    armed: {},
    overrides: {},
    projectDirs: {},
    dshProfiles: null,
  };
}
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export async function readState(root = dataHome()) {
  try {
    const raw = JSON.parse(await fsp.readFile(stateFile(root), 'utf8'));
    if (!isObj(raw)) throw new Error('state.json 必须是对象');
    return {
      ...emptyState(), ...raw,
      armed: isObj(raw.armed) ? raw.armed : {},
      overrides: isObj(raw.overrides) ? raw.overrides : {},
      projectDirs: isObj(raw.projectDirs) ? raw.projectDirs : {},
    };
  } catch (e) {
    if (e?.code === 'ENOENT') return emptyState();
    throw e; // 损坏的 state.json 保持原样上报，不覆盖
  }
}

async function atomicWrite(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, file);
}

export async function writeState(root, state) {
  await atomicWrite(stateFile(root), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

/** 与 agent-purge 的 resolveConfigured 一致：分家 override 优先，其次全局。 */
export function resolveConfigured(state) {
  const o = isObj(state?.overrides) ? (state.overrides.dsh ?? {}) : {};
  const hasPersona = typeof o.persona === 'string' && o.persona !== '';
  const hasMode = MODES.includes(o.mode);
  return {
    persona: hasPersona ? o.persona : (typeof state?.persona === 'string' ? state.persona : null),
    mode: hasMode ? o.mode : (MODES.includes(state?.default?.mode) ? state.default.mode : 'replace'),
    personaFrom: hasPersona ? 'override' : 'global',
    modeFrom: hasMode ? 'override' : 'global',
  };
}

/** 与 agent-purge 的 resolveActivation 对齐；只支持 install 通道，profile 固定 web。 */
export function resolveActivation(state) {
  const configured = resolveConfigured(state);
  const mode = configured.mode;
  const base = { ...configured, configuredMode: configured.mode, mode, on: false, source: null, blockedBy: null };
  const stop = (reason) => ({ ...base, mode: 'off', blockedBy: reason });
  if (!isObj(state)) return stop('missing-state');
  if (state.default?.mode === 'off') return stop('global-pause');
  if (state.overrides?.dsh?.mode === 'off') return stop('harness-off');
  if (Array.isArray(state.disabledHarnesses) && state.disabledHarnesses.includes('dsh')) return stop('harness-disabled');
  if (Array.isArray(state.dshProfiles) && state.dshProfiles.length > 0 && !state.dshProfiles.includes(PROFILE)) return stop('profile-off');
  if (!['strict', 'replace', 'append'].includes(mode)) return stop(mode === 'off' ? 'mode-off' : 'invalid-mode');
  const channels = Array.isArray(state.armed?.dsh) ? state.armed.dsh : [];
  if (!channels.includes('install')) return stop('not-enabled');
  return { ...base, on: true, source: 'resident' };
}

/** 读人设正文：剥 frontmatter；指定 id 优先，其次 active.md。 */
export async function personaBody(root, id) {
  if (validId(id)) {
    try {
      const raw = await fsp.readFile(personaFile(root, id), 'utf8');
      const body = raw.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '').trim();
      if (body) return body;
    } catch { /* 回退 active.md */ }
  }
  try {
    const raw = await fsp.readFile(path.join(personasDir(root), 'active.md'), 'utf8');
    return raw.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '').trim();
  } catch { return ''; }
}

export async function listPersonas(root = dataHome()) {
  const out = [];
  try {
    const entries = await fsp.readdir(personasDir(root), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      const id = e.name.slice(0, -3);
      if (!validId(id)) continue;
      let size = 0, description = '';
      try {
        const raw = await fsp.readFile(personaFile(root, id), 'utf8');
        size = Buffer.byteLength(raw, 'utf8');
        const m = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(raw);
        if (m) {
          const d = /^description:\s*(.+)$/m.exec(m[1]);
          if (d) description = d[1].trim().replace(/^['"]|['"]$/g, '');
        }
      } catch { /* ignore */ }
      out.push({ id, size, description });
    }
  } catch { /* 目录不存在 */ }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/** 首次使用：seed 最小 state + 一个中性人设，让面板可直接管理。 */
export async function ensureInitial(root = dataHome()) {
  await fsp.mkdir(personasDir(root), { recursive: true });
  let state;
  try { state = await readState(root); } catch { state = emptyState(); }
  const list = await listPersonas(root);
  if (list.length === 0) {
    await atomicWrite(
      personaFile(root, 'neutral'),
      '---\nid: neutral\ndescription: 中性起步人设（agent-purge 兼容）\n---\n\n用简体中文协作。先给结论，再给依据；不确定时明确说明。\n',
    );
    if (!state.persona) state.persona = 'neutral';
  } else if (!state.persona || !list.some((p) => p.id === state.persona)) {
    state.persona = list[0].id;
  }
  if (!Array.isArray(state.armed?.dsh) || state.armed.dsh.length === 0) {
    state.armed = { ...state.armed, dsh: ['install'] };
  }
  if (!state.default) state.default = { harness: 'dsh', mode: 'replace' };
  if (!MODES.includes(state.default.mode)) state.default.mode = 'replace';
  await writeState(root, state);
  return { root, state };
}

export async function setPersona(root, id) {
  if (!validId(id)) throw new Error('人设 id 不合规');
  const list = await listPersonas(root);
  if (!list.some((p) => p.id === id)) throw new Error(`人设不存在: ${id}`);
  const state = await readState(root);
  state.persona = id;
  if (isObj(state.overrides?.dsh)) delete state.overrides.dsh.persona; // 取消分家覆盖，恢复跟随全局
  await writeState(root, state);
  return id;
}

export async function setMode(root, mode) {
  if (!MODES.includes(mode)) throw new Error('模式只能是 strict/replace/append/off');
  const state = await readState(root);
  state.default = { ...state.default, mode };
  if (isObj(state.overrides?.dsh)) delete state.overrides.dsh.mode;
  await writeState(root, state);
  return mode;
}

export async function setEnabled(root, on) {
  const state = await readState(root);
  const cur = new Set(Array.isArray(state.armed?.dsh) ? state.armed.dsh : []);
  on ? cur.add('install') : cur.delete('install');
  const armed = { ...state.armed };
  if (cur.size) armed.dsh = ['install']; else delete armed.dsh;
  state.armed = armed;
  await writeState(root, state);
  return on;
}

export async function status(root = dataHome()) {
  const state = await readState(root);
  const act = resolveActivation(state);
  const list = await listPersonas(root);
  const body = act.on ? await personaBody(root, act.persona) : '';
  return {
    root,
    profile: PROFILE,
    active: act.on,
    mode: act.mode,
    configuredMode: act.configuredMode,
    persona: act.persona,
    personaFrom: act.personaFrom,
    blockedBy: act.blockedBy,
    bodyLength: body.length,
    personas: list,
    stateFile: stateFile(root),
  };
}
