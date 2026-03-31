import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Agent, GlobalSettings, GameState, Message } from '../types';

interface AppState {
  sessionId: string;
  ensureSessionId: () => string;
  setSessionId: (sessionId: string) => void;

  globalModels: string[];
  setGlobalModels: (models: string[]) => void;
  agentModels: Record<string, string[]>;
  setAgentModels: (agentId: string, models: string[]) => void;
  clearModelCaches: () => void;
  clearAgentModelsCache: () => void;

  streamingMessageId: string | null;
  setStreamingMessageId: (id: string | null) => void;

  // Settings
  settings: GlobalSettings;
  updateSettings: (settings: Partial<GlobalSettings>) => void;
  
  // Agents
  agents: Agent[];
  addAgent: (agent: Agent) => void;
  setAgents: (agents: Agent[]) => void;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  removeAgent: (id: string) => void;
  moveAgentUp: (id: string) => void;
  moveAgentDown: (id: string) => void;
  
  // Game State
  gameState: GameState;
  setGameState: (state: GameState) => void;
  currentRound: number;
  setCurrentRound: (round: number) => void;
  isGenerating: boolean;
  setIsGenerating: (isGenerating: boolean) => void;
  
  // Chat History
  messages: Message[];
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setMessages: (messages: Message[]) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  
  // Theme
  theme: 'light' | 'dark';
  toggleTheme: () => void;
}

const defaultSettings: GlobalSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  summaryModel: 'gpt-4o-mini',
  summaryPrompt: '',
  summaryTrigger: 100,
  promptMode: false,
  gameRule: '这是一场自由辩论。',
  maxRounds: 10,
  isRandomTurn: false,
  isTurnAware: true,
  showModelInfo: false,
  ragEnabled: false,
  searchModel: 'gpt-4o-mini',
};

const defaultAgents: Agent[] = [
  { id: '1', name: '正方', model: 'gpt-4o', persona: '你支持该观点。', isMuted: false },
  { id: '2', name: '反方', model: 'gpt-4o', persona: '你反对该观点。', isMuted: false },
];

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sessionId: '',
      ensureSessionId: () => {
        if (typeof window === 'undefined') return '';
        const key = 'ai_arena_session';
        let id = window.sessionStorage.getItem(key) || '';
        if (!id) {
          id = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
          window.sessionStorage.setItem(key, id);
        }
        set({ sessionId: id });
        return id;
      },
      setSessionId: (sessionId) => {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem('ai_arena_session', sessionId);
        }
        set({ sessionId });
      },

      globalModels: [],
      setGlobalModels: (globalModels) => set({ globalModels }),
      agentModels: {},
      setAgentModels: (agentId, models) =>
        set((state) => ({ agentModels: { ...state.agentModels, [agentId]: models } })),
      clearModelCaches: () => set({ globalModels: [], agentModels: {} }),
      clearAgentModelsCache: () => set({ agentModels: {} }),

      streamingMessageId: null,
      setStreamingMessageId: (streamingMessageId) => set({ streamingMessageId }),

      settings: defaultSettings,
      updateSettings: (newSettings) => set((state) => ({ settings: { ...state.settings, ...newSettings } })),
      
      agents: defaultAgents,
      addAgent: (agent) => set((state) => ({ agents: [...state.agents, agent] })),
      setAgents: (agents) => set({ agents }),
      updateAgent: (id, updates) => set((state) => ({
        agents: state.agents.map((a) => a.id === id ? { ...a, ...updates } : a)
      })),
      removeAgent: (id) => set((state) => ({ agents: state.agents.filter((a) => a.id !== id) })),
      moveAgentUp: (id) =>
        set((state) => {
          const idx = state.agents.findIndex((a) => a.id === id);
          if (idx <= 0) return {};
          const next = [...state.agents];
          const tmp = next[idx - 1];
          next[idx - 1] = next[idx];
          next[idx] = tmp;
          return { agents: next };
        }),
      moveAgentDown: (id) =>
        set((state) => {
          const idx = state.agents.findIndex((a) => a.id === id);
          if (idx < 0 || idx >= state.agents.length - 1) return {};
          const next = [...state.agents];
          const tmp = next[idx + 1];
          next[idx + 1] = next[idx];
          next[idx] = tmp;
          return { agents: next };
        }),
      
      gameState: 'IDLE',
      setGameState: (gameState) => set({ gameState }),
      currentRound: 0,
      setCurrentRound: (currentRound) => set({ currentRound }),
      isGenerating: false,
      setIsGenerating: (isGenerating) => set({ isGenerating }),
      
      messages: [],
      addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
      updateMessage: (id, updates) => set((state) => ({
        messages: state.messages.map((m) => m.id === id ? { ...m, ...updates } : m)
      })),
      setMessages: (messages) => set({ messages }),
      removeMessage: (id) => set((state) => ({ messages: state.messages.filter((m) => m.id !== id) })),
      clearMessages: () => set({ messages: [] }),
      
      theme: 'dark',
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
    }),
    {
      name: 'agent-clash-storage',
      partialize: (state) => ({ 
        sessionId: state.sessionId,
        settings: state.settings, 
        agents: state.agents,
        globalModels: state.globalModels,
        agentModels: state.agentModels,
        theme: state.theme 
      }), // 只持久化这些字段，不持久化聊天记录
    }
  )
);
