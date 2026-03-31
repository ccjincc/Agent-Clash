import { apiGet, apiRequest, streamRequest, StreamEvent } from '@/lib/api';
import { useAppStore } from '@/store';
import { Message } from '@/types';

let activeAbort: AbortController | null = null;

function uid() {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  return c?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stripThink(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export async function initGame() {
  const { settings, agents, clearMessages, setGameState, setCurrentRound } = useAppStore.getState();
  clearMessages();
  setGameState('IDLE');
  setCurrentRound(0);

  const payload = {
    topic: settings.gameRule,
    rounds: settings.maxRounds,
    agents: agents.map((a) => ({
      name: a.name,
      model: a.model,
      persona: a.persona,
      is_muted: a.isMuted,
      api_key: a.apiKey,
      api_base_url: a.apiBaseUrl,
    })),
    is_random_turn: settings.isRandomTurn,
    is_turn_aware: settings.isTurnAware,
    rag_enabled: settings.ragEnabled,
    search_model: settings.searchModel,
    summary_model: settings.summaryModel,
    summary_prompt: settings.summaryPrompt,
    summary_trigger: settings.summaryTrigger,
    prompt_mode: settings.promptMode,
    model_info_enabled: settings.showModelInfo,
    api_key: settings.apiKey || undefined,
    base_url: settings.apiBaseUrl || undefined,
  };

  const res = await apiRequest<{ status: string } & Record<string, unknown>>('/api/init', payload);
  if (res.status === 'initialized') {
    setGameState('READY');
    setCurrentRound(1);
  }
  return res;
}

export async function sendUserMessage(content: string) {
  const { addMessage, updateMessage } = useAppStore.getState();
  const userMsg: Message = {
    id: uid(),
    speaker: 'User',
    model: 'Human',
    content,
    timestamp: Date.now(),
  };
  addMessage(userMsg);

  const res = await apiRequest<{
    status: string;
    trigger_reply?: string[] | null;
    message?: { history_index?: number } | null;
    history_index?: number;
  }>('/api/send', { content });

  const idx = res.message?.history_index ?? res.history_index;
  if (typeof idx === 'number') {
    updateMessage(userMsg.id, { historyIndex: idx });
  }
  return res;
}

export async function listSessions() {
  return apiGet<{ sessions: Array<{ id: string; title: string; last_message_id: number }> }>('/api/sessions');
}

export async function createSession() {
  return apiRequest<{ id: string }>('/api/sessions/new', {});
}

export async function deleteSession(sessionId: string) {
  return apiRequest<{ status: string }>('/api/sessions/delete', { id: sessionId });
}

export async function stopGeneration() {
  activeAbort?.abort();
  activeAbort = null;
  await apiRequest('/api/stop');
}

export async function streamNextTurn(signal?: AbortSignal) {
  const { setIsGenerating, setGameState, addMessage, updateMessage, settings, setCurrentRound, setStreamingMessageId } = useAppStore.getState();
  setIsGenerating(true);
  setGameState('SPEAKING');
  setStreamingMessageId(null);

  const controller = signal ? null : new AbortController();
  if (controller) activeAbort = controller;
  const effectiveSignal = signal || controller?.signal;

  let currentId: string | null = null;
  let full = '';
  let meta: Message['metadata'] | undefined;
  let ragUsed = false;
  let ragQuery: string | undefined;

  const parseMetadata = (obj?: Record<string, unknown>): Message['metadata'] | undefined => {
    if (!obj) return undefined;
    const thinking = obj['thinking_duration'];
    const total = obj['total_duration'];
    const tokens = obj['total_tokens'];
    return {
      thinkingDuration: typeof thinking === 'number' ? thinking : undefined,
      totalDuration: typeof total === 'number' ? total : undefined,
      totalTokens: typeof tokens === 'number' || typeof tokens === 'string' ? tokens : undefined,
    };
  };

  const getStr = (evt: StreamEvent, key: string) => {
    const v = (evt as unknown as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : undefined;
  };
  const getNum = (evt: StreamEvent, key: string) => {
    const v = (evt as unknown as Record<string, unknown>)[key];
    return typeof v === 'number' ? v : undefined;
  };
  const getObj = (evt: StreamEvent, key: string) => {
    const v = (evt as unknown as Record<string, unknown>)[key];
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  };

  const onEvent = (evt: StreamEvent) => {
    const type = getStr(evt, 'type');
    const status = getStr(evt, 'status');
    const kind = type || status;

    if (type === 'ongoing' || status === 'ongoing') {
      const id = uid();
      currentId = id;
      full = '';
      ragUsed = false;
      ragQuery = undefined;
      setStreamingMessageId(id);
      const round = getNum(evt, 'round');
      if (typeof round === 'number') setCurrentRound(round);
      addMessage({
        id,
        historyIndex: getNum(evt, 'history_index'),
        speaker: getStr(evt, 'speaker') || 'Agent',
        model: getStr(evt, 'model') || '',
        content: '',
        timestamp: Date.now(),
      });
      return;
    }

    if (type === 'rag') {
      ragUsed = true;
      ragQuery = getStr(evt, 'query') || ragQuery;
      if (currentId) updateMessage(currentId, { ragUsed: true, ragQuery });
      return;
    }

    if (type === 'chunk' && currentId) {
      const chunk = getStr(evt, 'content') || '';
      full += chunk;
      updateMessage(currentId, { content: settings.showModelInfo ? full : full });
      return;
    }

    if (type === 'done') {
      meta = parseMetadata(getObj(evt, 'metadata'));
      if (currentId && meta) updateMessage(currentId, { metadata: meta });
      if (currentId && ragUsed) updateMessage(currentId, { ragUsed: true, ragQuery });
      setStreamingMessageId(null);
      return;
    }

    if (kind === 'error') {
      setStreamingMessageId(null);
      addMessage({
        id: uid(),
        speaker: 'System',
        model: 'Error',
        content: getStr(evt, 'message') || 'Unknown error',
        timestamp: Date.now(),
      });
    }
  };

  const isAbortError = (err: unknown) => {
    if (!err || typeof err !== 'object') return false;
    const name = (err as { name?: string }).name;
    return name === 'AbortError';
  };

  try {
    await streamRequest('/api/next', undefined, onEvent, effectiveSignal);
  } catch (err) {
    if (!isAbortError(err)) {
      addMessage({
        id: uid(),
        speaker: 'System',
        model: 'Error',
        content: err instanceof Error ? err.message : '请求失败',
        timestamp: Date.now(),
      });
    }
  } finally {
    if (controller && activeAbort === controller) activeAbort = null;
    setIsGenerating(false);
    setGameState('READY');
    setStreamingMessageId(null);
  }
}

export async function streamReply(agentName: string, signal?: AbortSignal) {
  const { setIsGenerating, setGameState, addMessage, updateMessage, setCurrentRound, setStreamingMessageId } = useAppStore.getState();
  setIsGenerating(true);
  setGameState('SPEAKING');
  setStreamingMessageId(null);

  const controller = signal ? null : new AbortController();
  if (controller) activeAbort = controller;
  const effectiveSignal = signal || controller?.signal;

  let currentId: string | null = null;
  let full = '';
  let meta: Message['metadata'] | undefined;
  let ragUsed = false;
  let ragQuery: string | undefined;

  const parseMetadata = (obj?: Record<string, unknown>): Message['metadata'] | undefined => {
    if (!obj) return undefined;
    const thinking = obj['thinking_duration'];
    const total = obj['total_duration'];
    const tokens = obj['total_tokens'];
    return {
      thinkingDuration: typeof thinking === 'number' ? thinking : undefined,
      totalDuration: typeof total === 'number' ? total : undefined,
      totalTokens: typeof tokens === 'number' || typeof tokens === 'string' ? tokens : undefined,
    };
  };

  const getObj = (evt: StreamEvent, key: string) => {
    const v = (evt as unknown as Record<string, unknown>)[key];
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  };

  const getStr = (evt: StreamEvent, key: string) => {
    const v = (evt as unknown as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : undefined;
  };
  const getNum = (evt: StreamEvent, key: string) => {
    const v = (evt as unknown as Record<string, unknown>)[key];
    return typeof v === 'number' ? v : undefined;
  };

  const onEvent = (evt: StreamEvent) => {
    const type = getStr(evt, 'type');
    const status = getStr(evt, 'status');
    const kind = type || status;
    if (type === 'ongoing' || status === 'ongoing') {
      const id = uid();
      currentId = id;
      full = '';
      ragUsed = false;
      ragQuery = undefined;
      setStreamingMessageId(id);
      const round = getNum(evt, 'round');
      if (typeof round === 'number') setCurrentRound(round);
      addMessage({
        id,
        historyIndex: getNum(evt, 'history_index'),
        speaker: getStr(evt, 'speaker') || agentName,
        model: getStr(evt, 'model') || '',
        content: '',
        timestamp: Date.now(),
      });
      return;
    }

    if (type === 'rag') {
      ragUsed = true;
      ragQuery = getStr(evt, 'query') || ragQuery;
      if (currentId) updateMessage(currentId, { ragUsed: true, ragQuery });
      return;
    }

    if (type === 'chunk' && currentId) {
      full += getStr(evt, 'content') || '';
      updateMessage(currentId, { content: full });
      return;
    }

    if (type === 'done') {
      meta = parseMetadata(getObj(evt, 'metadata'));
      if (currentId && meta) updateMessage(currentId, { metadata: meta });
      if (currentId && ragUsed) updateMessage(currentId, { ragUsed: true, ragQuery });
      setStreamingMessageId(null);
      return;
    }

    if (kind === 'error') {
      setStreamingMessageId(null);
      addMessage({
        id: uid(),
        speaker: 'System',
        model: 'Error',
        content: getStr(evt, 'message') || 'Unknown error',
        timestamp: Date.now(),
      });
    }
  };

  const isAbortError = (err: unknown) => {
    if (!err || typeof err !== 'object') return false;
    const name = (err as { name?: string }).name;
    return name === 'AbortError';
  };

  try {
    await streamRequest('/api/reply', { agent: agentName }, onEvent, effectiveSignal);
  } catch (err) {
    if (!isAbortError(err)) {
      addMessage({
        id: uid(),
        speaker: 'System',
        model: 'Error',
        content: err instanceof Error ? err.message : '请求失败',
        timestamp: Date.now(),
      });
    }
  } finally {
    if (controller && activeAbort === controller) activeAbort = null;
    setIsGenerating(false);
    setGameState('READY');
    setStreamingMessageId(null);
  }
}

export function getVisibleContentForTextModels(content: string) {
  return stripThink(content);
}

export async function syncStateFromBackend() {
  const { setMessages, setCurrentRound, setGameState, updateSettings, setAgents, settings } = useAppStore.getState();
  const state = await apiGet<{
    round: number;
    max_rounds: number;
    state: string;
    topic?: string;
    is_random_turn?: boolean;
    is_turn_aware?: boolean;
    rag_enabled?: boolean;
    search_model?: string | null;
    summary_model?: string | null;
    summary_trigger?: number | null;
    summary_prompt?: string | null;
    prompt_mode?: boolean | null;
    model_info_enabled?: boolean | null;
    agents?: Array<{ name: string; model: string; persona: string; is_muted: boolean; avatar?: string | null }>;
    history: Array<{
      speaker: string;
      model: string;
      content: string;
      metadata?: Record<string, unknown> | null;
    }>;
  }>('/api/state');

  const { apiKey, apiBaseUrl } = settings;
  updateSettings({
    apiKey,
    apiBaseUrl,
    maxRounds: typeof state.max_rounds === 'number' ? state.max_rounds : settings.maxRounds,
    isRandomTurn: Boolean(state.is_random_turn),
    isTurnAware: state.is_turn_aware !== undefined ? Boolean(state.is_turn_aware) : settings.isTurnAware,
    ragEnabled: state.rag_enabled !== undefined ? Boolean(state.rag_enabled) : settings.ragEnabled,
    searchModel: typeof state.search_model === 'string' ? state.search_model : settings.searchModel,
    summaryModel: typeof state.summary_model === 'string' ? state.summary_model : settings.summaryModel,
    summaryTrigger: typeof state.summary_trigger === 'number' ? state.summary_trigger : settings.summaryTrigger,
    summaryPrompt: typeof state.summary_prompt === 'string' ? state.summary_prompt : settings.summaryPrompt,
    promptMode: state.prompt_mode !== undefined ? Boolean(state.prompt_mode) : settings.promptMode,
    showModelInfo: state.model_info_enabled !== undefined ? Boolean(state.model_info_enabled) : settings.showModelInfo,
  });

  if (Array.isArray(state.agents) && state.agents.length > 0) {
    setAgents(
      state.agents.map((a, idx) => ({
        id: `${Date.now()}-${idx}-${Math.random().toString(16).slice(2)}`,
        name: a.name,
        model: a.model,
        persona: a.persona,
        isMuted: Boolean(a.is_muted),
        avatar: a.avatar || undefined,
      }))
    );
  }

  const messages: Message[] = (state.history || []).map((m, idx) => ({
    id: uid(),
    historyIndex: idx,
    speaker: m.speaker,
    model: m.model,
    content: m.content,
    metadata: (() => {
      if (!m.metadata) return undefined;
      const thinking = m.metadata['thinking_duration'];
      const total = m.metadata['total_duration'];
      const tokens = m.metadata['total_tokens'];
      return {
        thinkingDuration: typeof thinking === 'number' ? thinking : undefined,
        totalDuration: typeof total === 'number' ? total : undefined,
        totalTokens: typeof tokens === 'number' || typeof tokens === 'string' ? tokens : undefined,
      };
    })(),
    timestamp: Date.now(),
  }));
  setMessages(messages);
  setCurrentRound(state.round || 0);
  const s = state.state || 'IDLE';
  if (s === 'ONGOING') setGameState('READY');
  else if (s === 'FINISHED') setGameState('FINISHED');
  else if (s === 'SPEAKING') setGameState('SPEAKING');
  else if (s === 'PAUSED') setGameState('PAUSED');
  else setGameState('IDLE');
}

export async function fetchModels(apiKey: string, baseUrl: string) {
  const res = await apiRequest<{ status: string; models?: string[] }>('/api/models', { api_key: apiKey, base_url: baseUrl });
  return res;
}

export async function editMessage(historyIndex: number, content: string) {
  const res = await apiRequest<{ status: string; message?: string }>('/api/edit', { index: historyIndex, content });
  return res;
}

export async function deleteMessage(historyIndex: number) {
  const res = await apiRequest<{ status: string; message?: string }>('/api/delete', { index: historyIndex });
  return res;
}
