export function toolCard(build) {
  return (args, value) => {
    try {
      const view = build(args, value);
      if (!view) return {};
      const json = JSON.stringify(view);
      if (!json || Buffer.byteLength(json, 'utf8') > 8 * 1024) return {};
      return { 'dsh-go/view': JSON.parse(json) };
    } catch { return {}; }
  };
}

export function statusView(st) {
  return {
    type: 'stack',
    title: 'agent-purge · 状态',
    children: [
      { type: 'text', text: '一套人设，多端共用。这里读的是 agent-purge 的数据目录；管理端在电脑或本机终端。' },
      { type: 'row', children: [
        { type: 'metric', label: '注入', value: st.active ? '开' : '关', tone: st.active ? 'good' : 'warn' },
        { type: 'metric', label: '模式', value: String(st.mode || '-') },
      ] },
      { type: 'keyValue', items: [
        ['生效人设', String(st.persona || '-')],
        ['来源', st.personaFrom === 'override' ? '分家覆盖' : '全局'],
        ['profile', String(st.profile || '-')],
        ['人设数', String(st.personas?.length || 0)],
        ['正文长度', String(st.bodyLength || 0)],
        ['状态文件', String(st.stateFile || '')],
        ...(st.blockedBy ? [['未生效原因', String(st.blockedBy)]] : []),
      ] },
      { type: 'text', text: '点人设即可切换；注入从下一轮生效。' },
      { type: 'list', items: (st.personas || []).slice(0, 12).map((p) => ({
        title: p.id,
        subtitle: p.description || `${p.size} B`,
        trailing: p.id === st.persona ? '生效' : '',
        action: { id: 'usePersona', args: { id: p.id } },
      })) },
      { type: 'actions', items: [
        { label: '切模式', action: 'cycleMode' },
        { label: '刷新', action: 'refresh' },
        { label: '复制', action: 'copy' },
      ] },
      { type: 'callout', tone: 'info', text: '本插件不放行工具审批、不改权限；确认仍由 dsh-go App 控制。' },
    ],
  };
}

export function resultView(title, lines) {
  return {
    type: 'stack',
    title: String(title),
    children: [{ type: 'text', text: (Array.isArray(lines) ? lines : [String(lines || '')]).join('\n').slice(0, 1800) }],
  };
}
