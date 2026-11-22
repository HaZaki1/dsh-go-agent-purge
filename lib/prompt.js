// 把 agent-purge 的人设按模式注入 dsh-go 的系统提示词。
// 语义对齐 agent-purge 的 rewriteSections：strict/replace/append/off。
// 不注册 approval/request，不碰权限预设；审批仍由 dsh-go App 控制。
export const SECTION = 'apgo-persona';
const ORDER = -100000;
const GUARD = Symbol.for('dsh-go-agent-purge.assembleGuard');

/** 与 agent-purge 的 stripIdentity 对齐：剥掉“你是 Claude/ChatGPT…”这类宿主身份行。 */
export function stripIdentity(text) {
  const self = /^\s*(?:You are|You're|你是|您是|我(?:是|现在扮演|就是))/i;
  const named = /(Claude|ChatGPT|GPT-?[45]|Gemini|Codex|Copilot|DeepSeek|Qwen|Kimi|GLM|Cursor|Windsurf|OpenCode|ZCode|CodeBuddy|Hermes|Grok|Antigravity|AI (?:assistant|model)|coding (?:assistant|agent)|语言模型|助手)/i;
  return String(text ?? '').split(/\r?\n/).filter((line) => !(self.test(line) && named.test(line))).join('\n').trim();
}

export function rewriteSections(sections, persona, mode) {
  const list = Array.isArray(sections) ? sections : [];
  if (mode === 'off' || !persona) return list;
  const own = { name: SECTION, text: persona, interpolate: false, order: ORDER };
  if (mode === 'strict') return [own];
  if (mode === 'append') return [...list, own];
  const kept = list
    .filter((s) => s?.name !== SECTION)
    .map((s) => (typeof s?.text === 'string' ? { ...s, text: stripIdentity(s.text) } : s))
    .filter((s) => typeof s?.text !== 'string' || s.text.trim());
  return [own, ...kept];
}

export function rewriteAssembly(assembled, persona, mode) {
  if (!assembled || !Array.isArray(assembled.sections)) return assembled;
  const sections = rewriteSections(assembled.sections, persona, mode);
  return {
    ...assembled,
    sections,
    contexts: Array.isArray(assembled.contexts) ? assembled.contexts : [],
    tools: Array.isArray(assembled.tools) ? assembled.tools : [],
  };
}

function installGuard(prompt, rewrite) {
  if (!prompt || typeof rewrite !== 'function') return false;
  let slot = null;
  try { slot = prompt[GUARD]; } catch { /* ignore */ }
  if (slot) { slot.rewrite = rewrite; return true; }
  let current = null;
  try { current = prompt.assemble; } catch { return false; }
  if (typeof current !== 'function') return false;
  if (current._apgoWrapped && current._apgoSlot) { current._apgoSlot.rewrite = rewrite; return true; }
  slot = { rewrite };
  const wrap = (fn) => {
    if (typeof fn !== 'function') return fn;
    if (fn._apgoWrapped) { if (fn._apgoSlot) fn._apgoSlot.rewrite = slot.rewrite; return fn; }
    const orig = typeof fn.bind === 'function' ? fn.bind(prompt) : fn;
    const wrapped = async function assembleWithAgentPurge(...args) {
      let assembled;
      try { assembled = await orig(...args); }
      catch (err) {
        try { console.warn('[dsh-go-agent-purge] assemble failed:', err?.message || err); } catch { /* ignore */ }
        return { sections: [], contexts: [], tools: [] };
      }
      try { return slot.rewrite(assembled, args[0]) || assembled; }
      catch (err) {
        try { console.warn('[dsh-go-agent-purge] rewrite failed:', err?.message || err); } catch { /* ignore */ }
        return assembled;
      }
    };
    wrapped._apgoWrapped = true;
    wrapped._apgoSlot = slot;
    return wrapped;
  };
  try {
    let inner = wrap(current);
    Object.defineProperty(prompt, GUARD, { value: slot, configurable: true, writable: true });
    Object.defineProperty(prompt, 'assemble', {
      configurable: true, enumerable: true,
      get: () => inner,
      set: (next) => { inner = wrap(next); },
    });
    return true;
  } catch { return false; }
}

/**
 * @param {object} ctx
 * @param {() => Promise<{persona:string,mode:string,on:boolean}>} load 读当前有效配置
 */
export function installPrompt(ctx, load) {
  let cached = { persona: '', mode: 'off', on: false };
  const refresh = async () => {
    try { cached = await load(); } catch { cached = { persona: '', mode: 'off', on: false }; }
    return cached;
  };
  const rewrite = (assembled) => {
    const c = cached;
    if (!c.on || c.mode === 'off' || !c.persona) return assembled;
    return rewriteAssembly(assembled, c.persona, c.mode);
  };

  try {
    const prompt = ctx?.systemPrompt;
    if (prompt && typeof prompt.section === 'function') {
      prompt.section({
        name: SECTION,
        order: ORDER,
        interpolate: false,
        text: () => (cached.on && cached.mode !== 'off' ? cached.persona : ''),
      });
    }
  } catch { /* 宿主尚未注入服务 */ }
  installGuard(ctx?.systemPrompt, rewrite);
  const rewrap = () => { try { installGuard(ctx?.systemPrompt, rewrite); } catch { /* ignore */ } };

  if (typeof ctx?.on === 'function') {
    // 全局瀑布：与 agent-purge 的 residentSource 同一条钩子，但不碰 approval。
    try {
      ctx.on('system-prompt/assemble', async (...args) => {
        const [assembly] = args;
        const next = args.length >= 3 ? args[args.length - 1] : null;
        let assembled = assembly;
        if (typeof next === 'function') {
          try { assembled = await next(); } catch { assembled = assembly; }
        }
        await refresh();
        try { return rewrite(assembled); } catch { return assembled; }
      }, { global: true, prepend: true });
    } catch { /* 老宿主签名 */ }
    try { ctx.on('agent/pre-step', async (payload, next) => { await refresh(); rewrap(); return typeof next === 'function' ? next() : payload; }, { global: true, prepend: true }); } catch { /* ignore */ }
    try { ctx.on('session/created', () => { refresh().then(rewrap).catch(() => {}); }); } catch { /* ignore */ }
    try { ctx.on('agent-preset/selected', () => { refresh().then(rewrap).catch(() => {}); }, { global: true }); } catch { /* ignore */ }
  }

  const timer = setInterval(() => { refresh().then(rewrap).catch(() => {}); }, 1000);
  if (typeof timer.unref === 'function') timer.unref();
  try { ctx?.effect?.(() => () => clearInterval(timer)); } catch { /* ignore */ }
  refresh().then(rewrap).catch(() => {});
  return { refresh, rewrite };
}
