export interface Agent {
  id: string;
  name: string;
  model: string;
  persona: string;
  isMuted: boolean;
  avatar?: string;
  apiBaseUrl?: string;
  apiKey?: string;
}

export interface Message {
  id: string;
  historyIndex?: number;
  speaker: string;
  model: string;
  content: string;
  timestamp: number;
  isThinking?: boolean;
  thinkContent?: string;
  ragUsed?: boolean;
  ragQuery?: string;
  metadata?: {
    thinkingDuration?: number;
    totalDuration?: number;
    totalTokens?: number | string;
  };
}

export interface GlobalSettings {
  apiBaseUrl: string;
  apiKey: string;
  summaryModel: string;
  summaryPrompt: string;
  summaryTrigger: number;
  promptMode: boolean;
  gameRule: string;
  maxRounds: number;
  isRandomTurn: boolean;
  isTurnAware: boolean;
  showModelInfo: boolean;
  ragEnabled: boolean;
  searchModel: string;
}

export type GameState = 'IDLE' | 'READY' | 'SPEAKING' | 'PAUSED' | 'FINISHED';
