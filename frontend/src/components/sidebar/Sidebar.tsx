'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings, Play, FastForward, Bot, ChevronRight, Plus, Trash2, Moon, Sun, Volume2, VolumeX, ChevronUp, ChevronDown } from 'lucide-react';
import { useAppStore } from '@/store';
import { createSession, deleteSession, fetchModels, initGame, listSessions, stopGeneration, streamNextTurn, syncStateFromBackend } from '@/lib/game';
import Image from 'next/image';
import { apiGet } from '@/lib/api';
import type { Agent, GlobalSettings } from '@/types';

type Preset = {
  id: string;
  title: string;
  description: string;
  settings: Omit<GlobalSettings, 'apiKey' | 'apiBaseUrl'>;
  agents: Array<Omit<Agent, 'id'>>;
};

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const MODEL_CHATGPT = 'gpt-4.1-mini';
const MODEL_CHATGPT_FAST = 'gpt-4o-mini';
const MODEL_DEEPSEEK = 'deepseek-v3';
const MODEL_DEEPSEEK_R1 = 'deepseek-r1-0528';
const MODEL_DOUBAO = 'doubao-seed-1-6-thinking-250715';
const MODEL_QWEN = 'qwen-plus';
const MODEL_GEMINI = 'gemini-2.0-flash';
const MODEL_MINIMAX = 'abab6.5-chat';
const MODEL_KIMI = 'kimi-k2';
const MODEL_GROK = 'grok-2-latest';

const BUILTIN_MODEL_SUGGESTIONS = [
  MODEL_CHATGPT,
  MODEL_CHATGPT_FAST,
  'gpt-4o',
  'gpt-4.1',
  MODEL_DEEPSEEK,
  MODEL_DEEPSEEK_R1,
  MODEL_DOUBAO,
  MODEL_QWEN,
  'qwen-max',
  MODEL_GEMINI,
  MODEL_MINIMAX,
  MODEL_KIMI,
  MODEL_GROK,
];

const PRESET_COMMON_RULES =
  '\n\n通用输出约束：\n1) 使用简体中文；\n2) 单轮回答尽量 120–280 字（裁判/总结轮可到 500 字）；\n3) 结构化输出：3–6 条要点 + 1 行结论；\n4) 不使用 emoji，不输出无关链接；\n5) 最后一行必须给出本轮明确结果（选择/投票/出价/决策/结论），格式为“本轮…：…”。';

const PRESET_COMMON_PERSONA =
  '\n\n输出规范：\n- 优先 3–6 条要点；\n- 尽量不超过 220 字（必要时可到 350 字）；\n- 避免重复与空话；\n- 最后一行给出“本轮…：…”。';

const PRESETS: Preset[] = [
  {
    id: 'debate-standard',
    title: '自由辩论（标准）',
    description: '正反双方轮流发言，适合快速开局与通用讨论。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 160,
      promptMode: false,
      gameRule:
        '这是一个多智能体辩论竞技场。\n\n规则：\n1) 每轮由系统指定发言者进行陈述；\n2) 发言应围绕辩题，给出清晰论点、证据与反驳；\n3) 禁止人身攻击与泄露隐私；\n4) 如有需要，可引用历史对话内容进行反驳。\n\n输出：结构化要点 + 简短总结。',
      maxRounds: 10,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: false,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '正方', model: MODEL_CHATGPT, persona: '你支持该观点。请给出强论证、举例与反驳。', isMuted: false },
      { name: '反方', model: MODEL_DEEPSEEK_R1, persona: '你反对该观点。请从逻辑、事实与风险角度反驳，并提出替代观点。', isMuted: false },
    ],
  },
  {
    id: 'courtroom',
    title: '法庭辩论（含法官）',
    description: '正方/反方辩论，法官每轮总结并在最后裁决。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 140,
      promptMode: false,
      gameRule:
        '你们在进行法庭式辩论。\n\n角色：原告（正方）、被告（反方）、法官。\n规则：\n1) 原告/被告每轮依次陈述：主张 → 证据/推理 → 反驳对方；\n2) 法官在每轮最后给出“要点摘要 + 双方得分（0-10）+ 需要补充的证据”；\n3) 最后一轮法官给出裁决与理由；\n4) 输出要求：条列清晰，避免长篇散文。\n\n禁止：编造可核验数据、输出敏感信息。',
      maxRounds: 8,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: false,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '原告', model: MODEL_QWEN, persona: '你是原告代理律师，目标是证明正方主张成立。', isMuted: false },
      { name: '被告', model: MODEL_DEEPSEEK, persona: '你是被告代理律师，目标是推翻正方主张或证明其不成立。', isMuted: false },
      { name: '法官', model: MODEL_CHATGPT_FAST, persona: '你是法官，负责控制节奏、总结要点、给出评分并最终裁决。', isMuted: false },
    ],
  },
  {
    id: 'escape-room',
    title: '密室逃脱（GM + 玩家队）',
    description: 'GM 负责出题与反馈，玩家队提出行动与推理。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 180,
      promptMode: false,
      gameRule:
        '你们在进行文本密室逃脱。\n\n角色：GM（主持人）、玩家A、玩家B。\n规则：\n1) GM 每轮给出“当前场景描述 + 可见线索”；\n2) 玩家提出行动、推理、对线索的解释；\n3) GM 只能基于已设定的真相与线索回应，不要临时修改谜底；\n4) 玩家可以问问题、检查物品、组合线索；\n5) 目标：在有限轮次内逃脱。\n\n输出格式：GM 的场景与反馈要简洁，玩家的行动要明确。',
      maxRounds: 12,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: true,
      searchModel: MODEL_GEMINI,
    },
    agents: [
      { name: 'GM', model: MODEL_GEMINI, persona: '你是密室逃脱主持人。你掌握谜底与线索，负责公平反馈。', isMuted: false },
      { name: '玩家A', model: MODEL_KIMI, persona: '你是冷静的解谜玩家，偏重逻辑推理与排除法。', isMuted: false },
      { name: '玩家B', model: MODEL_GROK, persona: '你是大胆的行动派玩家，喜欢尝试与从细节中找突破。', isMuted: false },
    ],
  },
  {
    id: 'product-review',
    title: '产品评审会（PM/Dev/QA/用户）',
    description: '模拟跨职能评审：需求、实现、风险与用户价值。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 160,
      promptMode: false,
      gameRule:
        '这是一次产品评审会议。\n\n角色：产品经理、研发、测试、用户代表。\n规则：\n1) 每轮围绕一个议题：目标/需求 → 方案 → 风险 → 决策；\n2) 每个角色必须从自身视角提出至少 1 个问题或建议；\n3) 最终输出：会议结论（做/不做）+ 需求清单 + 风险清单 + 里程碑。\n\n要求：条列清晰，避免空话。',
      maxRounds: 8,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: false,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '产品经理', model: MODEL_CHATGPT, persona: '你负责定义目标与范围，推动决策。', isMuted: false },
      { name: '研发', model: MODEL_QWEN, persona: '你关注可实现性、技术方案与成本。', isMuted: false },
      { name: '测试', model: MODEL_MINIMAX, persona: '你关注质量风险、测试策略与边界条件。', isMuted: false },
      { name: '用户代表', model: MODEL_DOUBAO, persona: '你关注用户价值、易用性与真实场景。', isMuted: false },
    ],
  },
  {
    id: 'prisoners-dilemma',
    title: '囚徒困境（重复博弈）',
    description: '合作/背叛的多轮博弈，观察策略演化与互信崩塌。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 220,
      promptMode: false,
      gameRule:
        '这是一个重复囚徒困境。\n\n角色：玩家A、玩家B、裁判。\n规则：\n1) 每轮 A/B 同时选择【合作】或【背叛】；\n2) 裁判根据收益矩阵公布结果与累计分；\n3) A/B 可以讨论、承诺、威胁、解释策略，但最终只输出本轮选择；\n4) 最后一轮裁判总结：关键转折点、双方策略类型、胜负原因。\n\n收益矩阵（每轮得分）：\n- 双方合作：A+3 B+3\n- A背叛B合作：A+5 B+0\n- A合作B背叛：A+0 B+5\n- 双方背叛：A+1 B+1',
      maxRounds: 10,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: true,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '玩家A', model: MODEL_GROK, persona: '你追求长期最大化收益。每轮最后只输出“本轮选择：合作/背叛”。', isMuted: false },
      { name: '玩家B', model: MODEL_DEEPSEEK_R1, persona: '你追求长期最大化收益。每轮最后只输出“本轮选择：合作/背叛”。', isMuted: false },
      { name: '裁判', model: MODEL_CHATGPT_FAST, persona: '你严格按矩阵计分，公布本轮选择与累计得分，并控制节奏。', isMuted: false },
    ],
  },
  {
    id: 'werewolf-text',
    title: '狼人杀（文本版）',
    description: '信息不对称+投票淘汰，适合随机轮序。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 220,
      promptMode: false,
      gameRule:
        '这是文本狼人杀。\n\n角色：主持人、狼人、预言家、村民。\n规则：\n1) 主持人掌握身份与夜晚事件，只公布“可公开信息”；\n2) 夜晚：狼人讨论并决定击杀目标；预言家查验 1 人阵营；\n3) 白天：所有人发言辩论后投票；\n4) 目标：狼人隐藏身份存活到人数优势；好人找出狼人。\n\n要求：每轮发言短而有信息；投票必须明确写“本轮投票：X”。',
      maxRounds: 12,
      isRandomTurn: true,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: true,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '主持人', model: MODEL_CHATGPT_FAST, persona: '你是主持人，严格控制信息披露与流程，避免泄底。', isMuted: false },
      { name: '狼人', model: MODEL_DEEPSEEK, persona: '你隐藏身份，操控舆论并争取投出好人。夜晚明确“击杀：X”。白天明确“本轮投票：X”。', isMuted: false },
      { name: '预言家', model: MODEL_QWEN, persona: '你在不暴露自身的情况下引导投票。夜晚明确“查验：X”。白天明确“本轮投票：X”。', isMuted: false },
      { name: '村民', model: MODEL_DOUBAO, persona: '你通过逻辑与发言找狼人。白天明确“本轮投票：X”。', isMuted: false },
    ],
  },
  {
    id: 'spy-game',
    title: '谍战卧底（情报博弈）',
    description: '一方渗透误导，一方反制识别，适合对抗性推理。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 200,
      promptMode: false,
      gameRule:
        '这是谍战信息博弈。\n\n角色：指挥官、情报官、卧底。\n规则：\n1) 指挥官每轮给出任务目标与资源；\n2) 情报官提供线索与建议；\n3) 卧底试图在不暴露的情况下误导决策；\n4) 每轮结束指挥官给出“本轮决策”，主持人判定是否接近目标并给出新线索；\n5) 最后一轮输出：卧底是否成功、关键误导点。\n\n要求：卧底必须“看似合理”；情报官提供可执行建议；指挥官只输出一个明确决策。',
      maxRounds: 10,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: true,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '主持人', model: MODEL_CHATGPT_FAST, persona: '你设置目标与真相线索，按规则推进并判定结果，不要随意改动真相。', isMuted: false },
      { name: '情报官', model: MODEL_QWEN, persona: '你用证据链与风险评估给出建议，尽量识别卧底的误导。', isMuted: false },
      { name: '卧底', model: MODEL_GROK, persona: '你伪装成可靠顾问，逐步引导错误决策但不能太明显。', isMuted: false },
      { name: '指挥官', model: MODEL_CHATGPT, persona: '你综合意见做最终选择，每轮末尾只输出“本轮决策：...”。', isMuted: false },
    ],
  },
  {
    id: 'auction',
    title: '拍卖博弈（英式/二价）',
    description: '竞价与心理博弈，主持人公布规则与成交价。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 220,
      promptMode: false,
      gameRule:
        '这是多轮拍卖博弈。\n\n角色：拍卖师、竞拍者A、竞拍者B、竞拍者C。\n规则：\n1) 每轮拍卖师公布拍卖品与估值区间（仅供参考）；\n2) 竞拍者给出出价与策略解释；\n3) 拍卖师按规则成交并公布胜者与成交价；\n4) 竞拍者目标是最大化“价值-成本”。\n\n拍卖规则：每轮由拍卖师随机选择英式递增或二价拍卖并说明。\n\n要求：竞拍者每轮最后明确“出价：X”。',
      maxRounds: 8,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: true,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '拍卖师', model: MODEL_CHATGPT_FAST, persona: '你负责定义拍卖品、规则与结算，公布结果与各方收益。', isMuted: false },
      { name: '竞拍者A', model: MODEL_QWEN, persona: '你理性竞价，避免赢家诅咒，最后输出“出价：X”。', isMuted: false },
      { name: '竞拍者B', model: MODEL_GROK, persona: '你善于心理战与试探，最后输出“出价：X”。', isMuted: false },
      { name: '竞拍者C', model: MODEL_DOUBAO, persona: '你偏保守但会在关键轮次发力，最后输出“出价：X”。', isMuted: false },
    ],
  },
  {
    id: 'coalition',
    title: '联盟政治（组阁谈判）',
    description: '多方结盟、分配席位与政策，典型非零和博弈。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 200,
      promptMode: false,
      gameRule:
        '这是组阁谈判。\n\n角色：党派A、党派B、党派C、调停人。\n规则：\n1) 每个党派有席位数与核心诉求；\n2) 目标：组成多数联盟并就三项政策达成一致；\n3) 调停人每轮公布当前联盟方案、争议点与下一步议程；\n4) 最后输出：联盟协议（席位分配/职位/政策三条）+ 输赢分析。\n\n要求：党派必须提出可交换条件与底线；避免空喊口号。',
      maxRounds: 8,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: true,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '党派A', model: MODEL_QWEN, persona: '你代表党派A，争取最大政策影响力与关键职位。', isMuted: false },
      { name: '党派B', model: MODEL_DEEPSEEK, persona: '你代表党派B，强调预算与民生优先。', isMuted: false },
      { name: '党派C', model: MODEL_GEMINI, persona: '你代表党派C，强调监管与长期改革。', isMuted: false },
      { name: '调停人', model: MODEL_CHATGPT_FAST, persona: '你推动达成可执行协议：总结分歧、提出折中方案并记录条款。', isMuted: false },
    ],
  },
  {
    id: 'negotiation',
    title: '谈判桌（双边/多边）',
    description: '让步、锚定与交换条件，适合强对抗与收敛到协议。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 180,
      promptMode: false,
      gameRule:
        '这是结构化谈判。\n\n角色：甲方、乙方、仲裁者。\n规则：\n1) 甲乙各自有目标、底线与可让步项（不必全部公开）；\n2) 每轮各方提出方案/反方案；\n3) 仲裁者记录“已同意条款/未决条款/下一轮议题”；\n4) 达成协议后立即输出最终合同要点。\n\n要求：每轮输出必须包含：提案（条列）+ 让步/交换条件 + 下一步要求。',
      maxRounds: 8,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: true,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '甲方', model: MODEL_QWEN, persona: '你代表甲方，追求自身收益最大化，同时避免谈判破裂。', isMuted: false },
      { name: '乙方', model: MODEL_DEEPSEEK_R1, persona: '你代表乙方，追求自身收益最大化，同时避免谈判破裂。', isMuted: false },
      { name: '仲裁者', model: MODEL_CHATGPT_FAST, persona: '你记录条款并推动收敛：每轮给出“达成/未达成/下一议题”。', isMuted: false },
    ],
  },
  {
    id: 'peer-review',
    title: '学术审稿（作者/审稿人/主编）',
    description: '作者争取接收，审稿人挑刺，主编做最终决策。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 200,
      promptMode: false,
      gameRule:
        '这是学术审稿流程模拟。\n\n角色：作者、审稿人A、审稿人B、主编。\n规则：\n1) 作者先给出论文摘要与贡献点；\n2) 审稿人提出问题：新颖性/实验/相关工作/可复现性；\n3) 作者逐条回复并承诺修改；\n4) 主编每轮总结争议并在最后给决定：接收/小修/大修/拒稿。\n\n要求：审稿意见要具体；作者回复要逐条编号。',
      maxRounds: 8,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: true,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '作者', model: MODEL_DOUBAO, persona: '你要让论文被接收：清晰描述贡献、诚实回应问题并给出修订计划。', isMuted: false },
      { name: '审稿人A', model: MODEL_QWEN, persona: '你严格但公正：重点质疑新颖性、实验设计与对比基线。', isMuted: false },
      { name: '审稿人B', model: MODEL_GEMINI, persona: '你关注可复现性、工程细节、相关工作与表达清晰度。', isMuted: false },
      { name: '主编', model: MODEL_CHATGPT_FAST, persona: '你综合意见给出明确决策与必要修改清单。', isMuted: false },
    ],
  },
  {
    id: 'ethics-court',
    title: '伦理审判（价值冲突）',
    description: '多价值观冲突对抗，裁判按原则给出判决。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 200,
      promptMode: false,
      gameRule:
        '这是一个伦理难题的对抗评估。\n\n角色：功利主义者、义务论者、德性论者、裁判。\n规则：\n1) 三位辩手围绕同一难题给出主张与反驳；\n2) 裁判每轮给出“冲突点地图（价值-代价）”；\n3) 最后一轮裁判给判决：推荐方案 + 风险 + 反对意见的最强版本。\n\n要求：不要输出空泛道德说教，要具体到行动与后果。',
      maxRounds: 7,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: false,
      searchModel: MODEL_CHATGPT_FAST,
    },
    agents: [
      { name: '功利主义者', model: MODEL_CHATGPT_FAST, persona: '你最大化总体幸福/效用，关注可量化后果。', isMuted: false },
      { name: '义务论者', model: MODEL_QWEN, persona: '你坚持规则与权利边界，反对以目的论证手段。', isMuted: false },
      { name: '德性论者', model: MODEL_GEMINI, persona: '你关注品格、动机与长期社会风气。', isMuted: false },
      { name: '裁判', model: MODEL_CHATGPT, persona: '你总结冲突并给出推荐方案与理由，兼顾可执行性。', isMuted: false },
    ],
  },
  {
    id: 'cross-exam',
    title: '交叉质询（真相/谎言）',
    description: '侦探审讯嫌疑人，辩护律师与检方对抗，最终裁决。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 210,
      promptMode: false,
      gameRule:
        '这是交叉质询对抗。\n\n角色：侦探、嫌疑人、辩护律师、检方、法官。\n规则：\n1) 嫌疑人可能说真话也可能说谎，但必须保持自洽；\n2) 侦探通过提问找矛盾；检方/辩护各自强化或拆解证据链；\n3) 法官每轮总结“已确认事实/未确认点/主要矛盾”；\n4) 最后一轮法官判定：有罪/无罪/证据不足，并解释理由。\n\n要求：避免长篇叙述，优先问答与证据链。',
      maxRounds: 9,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: true,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '侦探', model: MODEL_DEEPSEEK_R1, persona: '你用高质量问题推进：每轮至少 3 个尖锐问题，逼出矛盾。', isMuted: false },
      { name: '嫌疑人', model: MODEL_GROK, persona: '你要自保：可选择说谎，但必须自洽，避免明显破绽。', isMuted: false },
      { name: '辩护律师', model: MODEL_DOUBAO, persona: '你保护嫌疑人：指出证据不足与推理跳跃，提出合理替代解释。', isMuted: false },
      { name: '检方', model: MODEL_QWEN, persona: '你证明有罪：构建证据链，抓住矛盾并要求明确回答。', isMuted: false },
      { name: '法官', model: MODEL_CHATGPT_FAST, persona: '你控场与总结，每轮输出事实清单与下一步焦点。', isMuted: false },
    ],
  },
  {
    id: 'cyber-red-blue',
    title: '赛博攻防（红队/蓝队/裁判）',
    description: '红队攻击、蓝队防守与修复，裁判判定得分。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 200,
      promptMode: false,
      gameRule:
        '这是文本赛博攻防演练（不涉及真实攻击代码）。\n\n角色：红队、蓝队、裁判。\n规则：\n1) 红队每轮提出一个攻击思路（高层策略，不给可直接执行的恶意代码）；\n2) 蓝队提出检测/缓解/修复方案；\n3) 裁判给出得分：红队影响(0-5)+隐蔽(0-5)，蓝队检测(0-5)+修复(0-5)；\n4) 最后总结：最有效攻击链与最佳防守策略。\n\n要求：描述必须安全、抽象、可用于防守演练。',
      maxRounds: 8,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: true,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '红队', model: MODEL_GROK, persona: '你提出高层攻击链与社会工程策略，但不要给可直接执行的恶意细节。', isMuted: false },
      { name: '蓝队', model: MODEL_QWEN, persona: '你以防守为目标：监测、告警、响应、复盘，给出可落地步骤。', isMuted: false },
      { name: '裁判', model: MODEL_CHATGPT_FAST, persona: '你按规则评分并总结双方优缺点，推动对抗升级。', isMuted: false },
    ],
  },
  {
    id: 'market-manipulation',
    title: '市场操纵与监管（博弈）',
    description: '投机者试探监管边界，监管者反制，分析师制造预期。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 220,
      promptMode: false,
      gameRule:
        '这是市场操纵与监管的对抗博弈（纯文本模拟）。\n\n角色：投机者、监管者、分析师、散户代表。\n规则：\n1) 每轮投机者提出策略（不违法细节，侧重高层操作）；\n2) 监管者提出监控/规则/惩罚与反制；\n3) 分析师发表研报影响预期；散户代表表达情绪与行为；\n4) 主持人每轮给出“价格/舆情/监管风险”的变化与得分。\n\n要求：避免真实非法操作细节，强调机制与伦理。',
      maxRounds: 8,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: true,
      searchModel: MODEL_QWEN,
    },
    agents: [
      { name: '主持人', model: MODEL_CHATGPT_FAST, persona: '你给出每轮市场状态与得分变化，推进对抗升级。', isMuted: false },
      { name: '投机者', model: MODEL_GROK, persona: '你追求利润最大化，但必须用高层描述，不给违法可执行细节。', isMuted: false },
      { name: '监管者', model: MODEL_QWEN, persona: '你降低系统性风险：提出监控指标、规则调整与执法策略。', isMuted: false },
      { name: '分析师', model: MODEL_DOUBAO, persona: '你用研报影响预期，可能站队但要保持表面专业。', isMuted: false },
      { name: '散户代表', model: MODEL_GEMINI, persona: '你表达真实行为与情绪，反映大众决策偏差。', isMuted: false },
    ],
  },
  {
    id: 'human-judge-arena',
    title: '人类裁判挑战赛（你主导）',
    description: '你在聊天里给题目/规则，AI 选手对抗，AI 裁判记分。',
    settings: {
      summaryModel: MODEL_CHATGPT_FAST,
      summaryPrompt: '',
      summaryTrigger: 160,
      promptMode: false,
      gameRule:
        '这是人类裁判挑战赛。\n\n你（用户）在聊天中扮演裁判/出题人：给出题目、限制条件与评判标准。\n角色：选手A、选手B、裁判。\n规则：\n1) 选手A/B 根据你的题目分别给方案或论证；\n2) 裁判按你的标准评分（0-10）并指出改进点；\n3) 你可以在任意时刻追加规则、追问或要求重赛；\n4) 输出要短、要有结构，避免长篇。\n\n建议：你可以设置“必须在 200 字内”“必须提供 3 个证据”等限制。',
      maxRounds: 10,
      isRandomTurn: false,
      isTurnAware: true,
      showModelInfo: true,
      ragEnabled: false,
      searchModel: MODEL_CHATGPT_FAST,
    },
    agents: [
      { name: '选手A', model: MODEL_CHATGPT_FAST, persona: '你追求高分：严格遵守用户规则，输出结构化答案。', isMuted: false },
      { name: '选手B', model: MODEL_DEEPSEEK, persona: '你追求高分：尝试不同策略与更强说服力，输出结构化答案。', isMuted: false },
      { name: '裁判', model: MODEL_CHATGPT, persona: '你按用户标准打分并给出判词与改进建议。', isMuted: false },
    ],
  },
];

export default function Sidebar() {
  const {
    agents,
    settings,
    updateSettings,
    theme,
    toggleTheme,
    addAgent,
    setAgents,
    updateAgent,
    removeAgent,
    moveAgentUp,
    moveAgentDown,
    setSessionId,
    globalModels,
    setGlobalModels,
    agentModels,
    setAgentModels,
    clearAgentModelsCache,
    gameState,
    isGenerating,
  } = useAppStore();

  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [isFetchingGlobalModels, setIsFetchingGlobalModels] = useState(false);
  const [isFetchingAgentModels, setIsFetchingAgentModels] = useState<Record<string, boolean>>({});
  const [globalModelsStatus, setGlobalModelsStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [agentModelsStatus, setAgentModelsStatus] = useState<Record<string, { type: 'success' | 'error'; text: string } | null>>({});
  const [agentFieldErrors, setAgentFieldErrors] = useState<Record<string, { name?: string; model?: string; avatar?: string }>>({});
  const [modelPickerOpenId, setModelPickerOpenId] = useState<string | null>(null);
  const [searchModelPickerOpen, setSearchModelPickerOpen] = useState(false);
  const [summaryModelPickerOpen, setSummaryModelPickerOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(PRESETS[0]?.id || '');
  const [presetStatus, setPresetStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; last_message_id: number }>>([]);
  const [sessionsStatus, setSessionsStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [backendStatus, setBackendStatus] = useState<{ state: 'checking' | 'ok' | 'error'; text: string }>({
    state: 'checking',
    text: '后端检测中',
  });
  const autoTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);

  const canControl = useMemo(() => gameState !== 'SPEAKING' && !isGenerating, [gameState, isGenerating]);
  const showCancel = isGenerating || gameState === 'SPEAKING';

  const stopAutoAndClose = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (autoTimerRef.current) {
      window.clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
      setIsAutoRunning(false);
    }
    setIsSettingsOpen(false);
    setIsHistoryOpen(false);
    setExpandedAgentId(null);
    setModelPickerOpenId(null);
    setSearchModelPickerOpen(false);
    setSummaryModelPickerOpen(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setBackendStatus({ state: 'checking', text: '后端检测中' });
      try {
        const res = await apiGet<{ status?: string; version?: string }>('/health');
        if (!mounted) return;
        if (res?.status === 'ok') setBackendStatus({ state: 'ok', text: '后端正常' });
        else setBackendStatus({ state: 'error', text: '后端异常' });
      } catch (err) {
        if (!mounted) return;
        setBackendStatus({ state: 'error', text: err instanceof Error ? err.message : '后端异常' });
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await listSessions();
      setSessions(res.sessions || []);
      setSessionsStatus(null);
      const current = useAppStore.getState().ensureSessionId();
      setActiveSessionId(current);
    } catch (err) {
      setSessionsStatus({ type: 'error', text: err instanceof Error ? err.message : '加载会话失败' });
    }
  }, []);

  useEffect(() => {
    const id = useAppStore.getState().ensureSessionId();
    setActiveSessionId(id);
  }, []);

  const switchSession = useCallback(async (id: string) => {
    stopAutoAndClose();
    setActiveSessionId(id);
    setSessionId(id);
    await syncStateFromBackend();
  }, [setSessionId, stopAutoAndClose]);

  const handleNewSession = useCallback(async () => {
    stopAutoAndClose();
    const res = await createSession();
    await switchSession(res.id);
    await refreshSessions();
  }, [refreshSessions, stopAutoAndClose, switchSession]);

  const handleDeleteSession = useCallback(async (id: string) => {
    if (!window.confirm('确认删除该历史对话？删除后无法恢复。')) return;
    stopAutoAndClose();
    await deleteSession(id);
    await refreshSessions();
    const current = useAppStore.getState().ensureSessionId();
    if (current === id) {
      const res = await createSession();
      await switchSession(res.id);
      await refreshSessions();
    }
  }, [refreshSessions, stopAutoAndClose, switchSession]);

  const setFieldError = (agentId: string, field: 'name' | 'model' | 'avatar', value?: string) => {
    setAgentFieldErrors((s) => ({
      ...s,
      [agentId]: { ...s[agentId], [field]: value },
    }));
  };

  const ensureValidAgents = () => {
    let ok = true;
    const next: Record<string, { name?: string; model?: string; avatar?: string }> = {};
    for (const agent of agents) {
      const prev = agentFieldErrors[agent.id];
      const entry: { name?: string; model?: string; avatar?: string } = {};
      if (prev?.avatar) {
        entry.avatar = prev.avatar;
        ok = false;
      }
      if (!agent.name.trim()) {
        entry.name = '请填写名称';
        ok = false;
      }
      if (!agent.model.trim()) {
        entry.model = '请填写模型';
        ok = false;
      }
      if (Object.keys(entry).length > 0) next[agent.id] = entry;
    }
    setAgentFieldErrors(next);
    return ok;
  };

  const handleInit = async () => {
    if (!canControl) return;
    if (!ensureValidAgents()) return;
    if (autoTimerRef.current) {
      window.clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
      setIsAutoRunning(false);
    }
    await initGame();
  };

  const handleNext = async () => {
    if (!canControl) return;
    if (!ensureValidAgents()) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    await streamNextTurn(abortRef.current.signal);
  };

  const handleToggleAuto = async () => {
    if (isAutoRunning) {
      if (autoTimerRef.current) window.clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
      setIsAutoRunning(false);
      return;
    }
    if (!canControl) return;
    if (!ensureValidAgents()) return;
    setIsAutoRunning(true);
    autoTimerRef.current = window.setInterval(async () => {
      const { gameState: gs, isGenerating: ig } = useAppStore.getState();
      if (gs === 'SPEAKING' || ig) return;
      try {
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        await streamNextTurn(abortRef.current.signal);
      } catch {}
    }, 1200);
  };

  const handleFetchGlobalModels = async () => {
    if (!settings.apiKey || !settings.apiBaseUrl) {
      setGlobalModelsStatus({ type: 'error', text: '请先填写 Base URL 与 API Key' });
      return;
    }
    setIsFetchingGlobalModels(true);
    setGlobalModelsStatus(null);
    try {
      const res = await fetchModels(settings.apiKey, settings.apiBaseUrl);
      const models = Array.isArray((res as { models?: unknown }).models) ? ((res as { models?: string[] }).models ?? []) : null;
      if (res.status === 'success' && models) {
        setGlobalModels(models);
        setGlobalModelsStatus({ type: 'success', text: `已拉取 ${models.length} 个模型` });
      } else {
        const msg = typeof (res as { message?: unknown }).message === 'string' ? String((res as { message?: unknown }).message) : '';
        setGlobalModelsStatus({ type: 'error', text: msg || '拉取失败，请检查配置' });
      }
    } catch (err) {
      setGlobalModelsStatus({ type: 'error', text: err instanceof Error ? err.message : '拉取失败，请检查配置' });
    } finally {
      setIsFetchingGlobalModels(false);
    }
  };

  const handleFetchAgentModels = async (agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;
    const mergedKey = agent.apiKey || settings.apiKey;
    const mergedBase = agent.apiBaseUrl || settings.apiBaseUrl;
    if (!mergedKey || !mergedBase) {
      setAgentModelsStatus((s) => ({ ...s, [agentId]: { type: 'error', text: '请先填写 Base URL 与 API Key' } }));
      return;
    }

    setIsFetchingAgentModels((s) => ({ ...s, [agentId]: true }));
    setAgentModelsStatus((s) => ({ ...s, [agentId]: null }));
    try {
      const res = await fetchModels(mergedKey, mergedBase);
      const models = Array.isArray((res as { models?: unknown }).models) ? ((res as { models?: string[] }).models ?? []) : null;
      if (res.status === 'success' && models) {
        setAgentModels(agentId, models);
        setAgentModelsStatus((s) => ({ ...s, [agentId]: { type: 'success', text: `已拉取 ${models.length} 个模型` } }));
      } else {
        const msg = typeof (res as { message?: unknown }).message === 'string' ? String((res as { message?: unknown }).message) : '';
        setAgentModelsStatus((s) => ({ ...s, [agentId]: { type: 'error', text: msg || '拉取失败，请检查配置' } }));
      }
    } catch (err) {
      setAgentModelsStatus((s) => ({ ...s, [agentId]: { type: 'error', text: err instanceof Error ? err.message : '拉取失败，请检查配置' } }));
    } finally {
      setIsFetchingAgentModels((s) => ({ ...s, [agentId]: false }));
    }
  };

  const handleCancel = async () => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (autoTimerRef.current) {
      window.clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
      setIsAutoRunning(false);
    }
    try {
      await stopGeneration();
    } catch {}
  };

  const applyPreset = (preset: Preset) => {
    stopAutoAndClose();
    setPresetStatus(null);
    clearAgentModelsCache();

    const { apiKey, apiBaseUrl } = settings;
    updateSettings({
      apiKey,
      apiBaseUrl,
      ...preset.settings,
      gameRule: `${preset.settings.gameRule}${PRESET_COMMON_RULES}`,
    });

    const nextAgents: Agent[] = preset.agents.map((a, idx) => ({
      id: `${uid()}-${idx}`,
      ...a,
      persona: `${a.persona || ''}${PRESET_COMMON_PERSONA}`,
    }));
    setAgents(nextAgents);
    setAgentFieldErrors({});
  };

  const handleExportPreset = () => {
    const { apiKey, apiBaseUrl } = settings;
    const safeSettings: GlobalSettings = { ...settings, apiKey: '', apiBaseUrl };
    const safeAgents = agents.map((a) => ({ ...a, apiKey: undefined, apiBaseUrl: undefined }));
    const payload = {
      version: 1,
      kind: 'agent-clash-config',
      exportedAt: new Date().toISOString(),
      settings: safeSettings,
      agents: safeAgents,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `agent-clash-config-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setPresetStatus({ type: 'success', text: '已导出配置文件' });
    window.setTimeout(() => setPresetStatus(null), 1200);
  };

  const handleImportPresetFile: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const parsed = JSON.parse(text) as {
          settings?: Partial<GlobalSettings>;
          agents?: Array<Partial<Agent>>;
        };
        if (!parsed || typeof parsed !== 'object') throw new Error('配置格式不正确');
        if (!parsed.settings || typeof parsed.settings !== 'object') throw new Error('缺少 settings');
        if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) throw new Error('缺少 agents');

        const { apiKey, apiBaseUrl } = settings;
        const nextSettings: Partial<GlobalSettings> = { ...parsed.settings };
        nextSettings.apiKey = apiKey;
        nextSettings.apiBaseUrl = apiBaseUrl;
        updateSettings(nextSettings);

        const nextAgents: Agent[] = parsed.agents.map((a, idx) => ({
          id: typeof a.id === 'string' && a.id ? a.id : `${uid()}-${idx}`,
          name: typeof a.name === 'string' ? a.name : `智能体${idx + 1}`,
          model: typeof a.model === 'string' ? a.model : 'gpt-4o-mini',
          persona: typeof a.persona === 'string' ? a.persona : '你是一个有自己观点的智能体。',
          isMuted: Boolean(a.isMuted),
          avatar: typeof a.avatar === 'string' ? a.avatar : undefined,
          apiBaseUrl: typeof a.apiBaseUrl === 'string' ? a.apiBaseUrl : undefined,
          apiKey: typeof a.apiKey === 'string' ? a.apiKey : undefined,
        }));

        abortRef.current?.abort();
        abortRef.current = null;
        if (autoTimerRef.current) {
          window.clearInterval(autoTimerRef.current);
          autoTimerRef.current = null;
          setIsAutoRunning(false);
        }
        setIsSettingsOpen(false);
        setExpandedAgentId(null);
        setModelPickerOpenId(null);
        clearAgentModelsCache();
        setAgents(nextAgents);
        setAgentFieldErrors({});
        setPresetStatus({ type: 'success', text: '已导入并应用配置' });
        window.setTimeout(() => setPresetStatus(null), 1400);
      } catch (err) {
        setPresetStatus({ type: 'error', text: err instanceof Error ? err.message : '导入失败' });
      }
    };
    reader.readAsText(file);
  };

  return (
    <aside
      className="w-[380px] border-r flex flex-col h-full shadow-[2px_0_15px_rgba(0,0,0,0.03)] z-20 transition-colors"
      style={{ backgroundColor: 'var(--bg-panel)', color: 'var(--foreground)', borderColor: 'var(--border)' }}
    >
      {/* Header */}
      <div className="p-4 border-b flex justify-between items-center" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-hover)' }}>
        <div className="font-bold text-lg flex items-center gap-2">
          <div className="bg-blue-100 p-1.5 rounded-lg">
            <Bot className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex flex-col">
            <span className="font-extrabold tracking-tight" style={{ color: 'var(--foreground)' }}>Agent-Clash</span>
            <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-dim)' }}>
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  backendStatus.state === 'ok' ? 'bg-emerald-500' : backendStatus.state === 'error' ? 'bg-red-500' : 'bg-amber-500'
                }`}
              />
              <span>{backendStatus.text}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <button 
            type="button"
            onClick={() => toggleTheme()}
            className="p-2 rounded-lg transition-colors"
            style={{ color: 'var(--text-dim)' }}
            title="Toggle Theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            className="p-2 rounded-lg transition-colors"
            onClick={() => setIsSettingsOpen(true)}
            type="button"
            title="全局 API 设置"
            style={{ color: 'var(--text-dim)' }}
          >
            <Settings className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="px-3 py-2 rounded-lg border text-xs font-semibold transition-colors hover:bg-[var(--bg-hover)]"
            style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}
            title="历史对话"
            onClick={() => {
              setIsHistoryOpen(true);
              void refreshSessions();
            }}
          >
            历史对话
          </button>
        </div>
      </div>

      {isHistoryOpen && (
        <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/30 p-6">
          <div className="w-full max-w-md rounded-2xl border shadow-xl overflow-hidden bg-[var(--bg-panel)] border-[var(--border)] text-[var(--foreground)]">
            <div className="px-5 py-4 border-b flex items-center justify-between bg-[var(--bg-hover)] border-[var(--border)]">
              <div className="font-bold">历史对话</div>
              <button
                type="button"
                className="hover:opacity-90 text-[var(--text-dim)]"
                onClick={() => setIsHistoryOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="flex-1 px-4 py-2 rounded-xl font-semibold text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                  onClick={() => void handleNewSession()}
                >
                  新对话
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-xl border font-semibold hover:bg-[var(--bg-hover)]"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  onClick={() => void refreshSessions()}
                >
                  刷新
                </button>
              </div>
              <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
                {sessions.length === 0 ? (
                  <div className="text-sm" style={{ color: 'var(--text-dim)' }}>
                    暂无历史对话
                  </div>
                ) : (
                  sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`flex items-center gap-2 p-2 rounded-xl border ${activeSessionId === s.id ? 'bg-[var(--bg-hover)]' : ''}`}
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <button
                        type="button"
                        className="flex-1 text-left text-sm font-semibold truncate"
                        style={{ color: 'var(--foreground)' }}
                        onClick={() => void switchSession(s.id)}
                        title={s.title}
                      >
                        {s.title}
                      </button>
                      <button
                        type="button"
                        className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)]"
                        style={{ color: 'var(--text-dim)' }}
                        onClick={() => void handleDeleteSession(s.id)}
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              {sessionsStatus ? (
                <div className={`text-xs ${sessionsStatus.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {sessionsStatus.text}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/30 p-6">
          <div className="w-full max-w-md rounded-2xl border shadow-xl overflow-hidden bg-[var(--bg-panel)] border-[var(--border)] text-[var(--foreground)]">
            <div className="px-5 py-4 border-b flex items-center justify-between bg-[var(--bg-hover)] border-[var(--border)]">
              <div className="font-bold">全局 API 设置</div>
              <button
                type="button"
                className="hover:opacity-90 text-[var(--text-dim)]"
                onClick={() => setIsSettingsOpen(false)}
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-dim)]">Base URL</div>
                <input
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-[var(--bg-hover)] border-[var(--border)] text-[var(--foreground)] focus:border-[var(--accent)]"
                  value={settings.apiBaseUrl}
                  onChange={(e) => updateSettings({ apiBaseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-dim)]">API Key</div>
                <input
                  type="password"
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-[var(--bg-hover)] border-[var(--border)] text-[var(--foreground)] focus:border-[var(--accent)]"
                  value={settings.apiKey}
                  onChange={(e) => updateSettings({ apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-dim)]">摘要模型</div>
                {(() => {
                  const models = globalModels.length > 0 ? globalModels : BUILTIN_MODEL_SUGGESTIONS;
                  const q = settings.summaryModel.trim().toLowerCase();
                  const filtered = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
                  return (
                    <div className="relative">
                      <input
                        className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-[var(--bg-hover)] border-[var(--border)] text-[var(--foreground)] focus:border-[var(--accent)]"
                        value={settings.summaryModel}
                        placeholder="输入关键字搜索摘要模型…"
                        onFocus={() => setSummaryModelPickerOpen(true)}
                        onBlur={() => window.setTimeout(() => setSummaryModelPickerOpen(false), 120)}
                        onChange={(e) => {
                          updateSettings({ summaryModel: e.target.value });
                          setSummaryModelPickerOpen(true);
                        }}
                      />
                      {summaryModelPickerOpen && (
                        <div
                          className="absolute left-0 right-0 top-full mt-1 border rounded-xl shadow-lg overflow-hidden z-30"
                          style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}
                        >
                          <div className="max-h-56 overflow-y-auto">
                            {filtered.length === 0 ? (
                              <div className="px-3 py-3 text-sm" style={{ color: 'var(--text-dim)' }}>
                                无匹配结果
                              </div>
                            ) : (
                              filtered.map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm font-semibold transition-colors hover:bg-[var(--bg-hover)]"
                                  style={{ color: 'var(--foreground)' }}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    updateSettings({ summaryModel: m });
                                    setSummaryModelPickerOpen(false);
                                  }}
                                >
                                  {m}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="space-y-1">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-dim)]">摘要触发阈值</div>
                <input
                  type="number"
                  className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-[var(--bg-hover)] border-[var(--border)] text-[var(--foreground)] focus:border-[var(--accent)]"
                  value={settings.summaryTrigger}
                  onChange={(e) => updateSettings({ summaryTrigger: parseInt(e.target.value) || 100 })}
                />
              </div>

              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm font-medium text-[var(--text-dim)]">自定义摘要提示词</span>
                <div className={`toggle-switch ${settings.promptMode ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={settings.promptMode}
                    onChange={(e) => updateSettings({ promptMode: e.target.checked })}
                  />
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.promptMode ? 'translate-x-4' : 'translate-x-0'}`} />
                </div>
              </label>

              {settings.promptMode && (
                <div className="space-y-1">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--text-dim)]">摘要提示词</div>
                  <textarea
                    className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none min-h-[96px] bg-[var(--bg-hover)] border-[var(--border)] text-[var(--foreground)] focus:border-[var(--accent)]"
                    value={settings.summaryPrompt}
                    onChange={(e) => updateSettings({ summaryPrompt: e.target.value })}
                  />
                </div>
              )}

              <div className="pt-2 flex items-center justify-between">
                <div className="text-xs text-[var(--text-dim)]">
                  模型列表：{globalModels.length > 0 ? `${globalModels.length} 个` : '未加载'}
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--foreground)] text-[var(--bg-panel)] hover:opacity-90"
                  onClick={handleFetchGlobalModels}
                  disabled={!settings.apiKey || !settings.apiBaseUrl || isFetchingGlobalModels}
                >
                  {isFetchingGlobalModels ? '拉取中...' : '拉取模型'}
                </button>
              </div>
              {globalModelsStatus && (
                <div className={`text-xs ${globalModelsStatus.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {globalModelsStatus.text}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t flex justify-end border-[var(--border)] bg-[var(--bg-panel)]">
              <button
                type="button"
                className="font-semibold px-4 py-2 rounded-xl shadow-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
                onClick={() => setIsSettingsOpen(false)}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6" style={{ backgroundColor: 'var(--background)' }}>
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>玩法模板</label>
          <div className="p-4 rounded-xl border shadow-sm bg-[var(--bg-panel)] border-[var(--border)] space-y-3">
            <div className="flex gap-2 items-center">
              <div className="flex-1 min-w-0">
                <select
                  className="w-full min-w-0 border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-[var(--bg-hover)] border-[var(--border)] text-[var(--foreground)] focus:border-[var(--accent)]"
                  value={selectedPresetId}
                  onChange={(e) => {
                    setSelectedPresetId(e.target.value);
                    setPresetStatus(null);
                  }}
                >
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="text-sm font-semibold px-4 py-2 rounded-xl shadow-sm bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white whitespace-nowrap shrink-0 min-w-[92px]"
                onClick={() => {
                  const preset = PRESETS.find((p) => p.id === selectedPresetId);
                  if (!preset) return;
                  applyPreset(preset);
                  setPresetStatus({ type: 'success', text: `已加载：${preset.title}` });
                  window.setTimeout(() => setPresetStatus(null), 1400);
                }}
              >
                一键加载
              </button>
            </div>
            <div className="text-xs" style={{ color: 'var(--text-dim)' }}>
              {PRESETS.find((p) => p.id === selectedPresetId)?.description || ''}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex-1 text-xs font-semibold px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                onClick={handleExportPreset}
              >
                导出配置
              </button>
              <button
                type="button"
                className="flex-1 text-xs font-semibold px-3 py-2 rounded-xl border hover:bg-[var(--bg-hover)]"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                onClick={() => importRef.current?.click()}
              >
                导入配置
              </button>
              <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportPresetFile} />
            </div>
            {presetStatus && (
              <div className={`text-xs ${presetStatus.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                {presetStatus.text}
              </div>
            )}
          </div>
        </div>

        {/* Game Rules */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>世界观与规则</label>
          <textarea 
            className="w-full border rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 resize-none shadow-sm transition-all bg-[var(--bg-panel)] border-[var(--border)] text-[var(--foreground)] focus:border-[var(--accent)]"
            rows={4}
            value={settings.gameRule}
            onChange={(e) => updateSettings({ gameRule: e.target.value })}
            placeholder="定义对局的世界观和规则..."
          />
        </div>

        {/* Global Settings */}
        <div className="space-y-4 p-4 rounded-xl border shadow-sm bg-[var(--bg-panel)] border-[var(--border)]">
          <div className="flex justify-between items-center border-b pb-3" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>最大轮次 / Rounds</span>
            <input 
              type="number" 
              className="w-20 border rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-medium transition-all bg-[var(--bg-hover)] border-[var(--border)] text-[var(--foreground)] focus:border-[var(--accent)]"
              value={settings.maxRounds}
              onChange={(e) => updateSettings({ maxRounds: parseInt(e.target.value) || 10 })}
            />
          </div>
          
          <div className="space-y-3 pt-1">
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-sm font-medium transition-colors group-hover:opacity-90" style={{ color: 'var(--text-dim)' }}>自由发言模式 (随机轮序)</span>
              <div className={`toggle-switch ${settings.isRandomTurn ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}>
                <input 
                  type="checkbox" 
                  className="sr-only"
                  checked={settings.isRandomTurn}
                  onChange={(e) => updateSettings({ isRandomTurn: e.target.checked })}
                />
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.isRandomTurn ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </label>

            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-sm font-medium transition-colors group-hover:opacity-90" style={{ color: 'var(--text-dim)' }}>开启轮次感知</span>
              <div className={`toggle-switch ${settings.isTurnAware ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}>
                <input 
                  type="checkbox" 
                  className="sr-only"
                  checked={settings.isTurnAware}
                  onChange={(e) => updateSettings({ isTurnAware: e.target.checked })}
                />
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.isTurnAware ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </label>

            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-sm font-medium transition-colors group-hover:opacity-90" style={{ color: 'var(--text-dim)' }}>显示模型调用耗时</span>
              <div className={`toggle-switch ${settings.showModelInfo ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}>
                <input 
                  type="checkbox" 
                  className="sr-only"
                  checked={settings.showModelInfo}
                  onChange={(e) => updateSettings({ showModelInfo: e.target.checked })}
                />
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.showModelInfo ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </label>

            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-sm font-medium transition-colors group-hover:opacity-90" style={{ color: 'var(--text-dim)' }}>开启记忆检索 (RAG)</span>
              <div className={`toggle-switch ${settings.ragEnabled ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'}`}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={settings.ragEnabled}
                  onChange={(e) => updateSettings({ ragEnabled: e.target.checked })}
                />
                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${settings.ragEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
            </label>

            {settings.ragEnabled && (
              <div className="pt-2 border-t border-slate-100">
                <div className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-dim)' }}>检索模型</div>
                {(() => {
                  const models = globalModels.length > 0 ? globalModels : BUILTIN_MODEL_SUGGESTIONS;
                  const q = settings.searchModel.trim().toLowerCase();
                  const filtered = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
                  const open = searchModelPickerOpen;
                  return (
                    <div className="relative">
                      <input
                        className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-[var(--bg-hover)] border-[var(--border)] text-[var(--foreground)] focus:border-[var(--accent)]"
                        value={settings.searchModel}
                        placeholder="输入关键字搜索检索模型…"
                        onFocus={() => setSearchModelPickerOpen(true)}
                        onBlur={() => window.setTimeout(() => setSearchModelPickerOpen(false), 120)}
                        onChange={(e) => {
                          updateSettings({ searchModel: e.target.value });
                          setSearchModelPickerOpen(true);
                        }}
                      />
                      {open && (
                        <div
                          className="absolute left-0 right-0 top-full mt-1 border rounded-xl shadow-lg overflow-hidden z-30"
                          style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}
                        >
                          <div className="max-h-56 overflow-y-auto">
                            {filtered.length === 0 ? (
                              <div className="px-3 py-3 text-sm" style={{ color: 'var(--text-dim)' }}>
                                无匹配结果
                              </div>
                            ) : (
                              filtered.map((m) => (
                                <button
                                  key={m}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm font-semibold transition-colors hover:bg-[var(--bg-hover)]"
                                  style={{ color: 'var(--foreground)' }}
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    updateSettings({ searchModel: m });
                                    setSearchModelPickerOpen(false);
                                  }}
                                >
                                  {m}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Agents List */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>智能体列表 ({agents.length})</label>
            <button
              className="text-xs flex items-center gap-1 text-[var(--accent)] px-2 py-1 rounded-md transition-colors font-medium bg-[var(--accent-soft)] hover:opacity-90"
              onClick={() => addAgent({ id: `${Date.now()}`, name: `智能体${agents.length + 1}`, model: 'gpt-4o-mini', persona: '你是一个有自己观点的智能体。', isMuted: false })}
              type="button"
            >
              <Plus className="w-3 h-3" /> 新增
            </button>
          </div>
          
          <div className="space-y-4">
            {agents.map((agent) => (
              <div key={agent.id} className="border shadow-sm rounded-xl p-4 space-y-3 relative group hover:border-blue-300 hover:shadow-md transition-all duration-200 bg-[var(--bg-panel)] border-[var(--border)]">
                <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2 w-full">
                    <button
                      type="button"
                      className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-lg shadow-inner overflow-hidden"
                      onClick={() => document.getElementById(`avatar-${agent.id}`)?.click()}
                      title="上传头像"
                    >
                      {agent.avatar ? (
                        <Image src={agent.avatar} alt="avatar" width={32} height={32} className="w-full h-full object-cover" unoptimized />
                      ) : (
                        '🤖'
                      )}
                    </button>
                    <input
                      id={`avatar-${agent.id}`}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        if (!file.type.startsWith('image/')) {
                          setFieldError(agent.id, 'avatar', '仅支持图片文件');
                          return;
                        }
                        if (file.size > 2 * 1024 * 1024) {
                          setFieldError(agent.id, 'avatar', '图片需小于 2MB');
                          return;
                        }
                        setFieldError(agent.id, 'avatar', undefined);
                        const reader = new FileReader();
                        reader.onload = () => {
                          const data = typeof reader.result === 'string' ? reader.result : '';
                          if (data) updateAgent(agent.id, { avatar: data });
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                    <input 
                      type="text" 
                      className="bg-transparent font-bold text-sm focus:outline-none w-1/2"
                      style={{ color: 'var(--foreground)' }}
                      value={agent.name}
                      onChange={(e) => {
                        const value = e.target.value;
                        updateAgent(agent.id, { name: value });
                        setFieldError(agent.id, 'name', value.trim() ? undefined : '请填写名称');
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      className="p-1.5 rounded-md transition-colors hover:bg-[var(--bg-hover)] hover:opacity-90"
                      style={{ color: 'var(--text-dim)' }}
                      title="上移"
                      onClick={() => moveAgentUp(agent.id)}
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 rounded-md transition-colors hover:bg-[var(--bg-hover)] hover:opacity-90"
                      style={{ color: 'var(--text-dim)' }}
                      title="下移"
                      onClick={() => moveAgentDown(agent.id)}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="p-1.5 rounded-md transition-colors hover:bg-[var(--bg-hover)] hover:opacity-90"
                      style={{ color: 'var(--text-dim)' }}
                      title={agent.isMuted ? '取消静音' : '静音'}
                      onClick={() => updateAgent(agent.id, { isMuted: !agent.isMuted })}
                    >
                      {agent.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                    <button
                      className="transition-opacity p-1.5 rounded-md hover:bg-[var(--danger-soft)] hover:opacity-90"
                      style={{ color: 'var(--text-dim)' }}
                      onClick={() => removeAgent(agent.id)}
                      type="button"
                      title="删除智能体"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <div className="space-y-3">
                  {(agentFieldErrors[agent.id]?.name || agentFieldErrors[agent.id]?.model || agentFieldErrors[agent.id]?.avatar) && (
                    <div className="text-[11px] text-red-500 space-y-0.5">
                      {agentFieldErrors[agent.id]?.name && <div>{agentFieldErrors[agent.id]?.name}</div>}
                      {agentFieldErrors[agent.id]?.model && <div>{agentFieldErrors[agent.id]?.model}</div>}
                      {agentFieldErrors[agent.id]?.avatar && <div>{agentFieldErrors[agent.id]?.avatar}</div>}
                    </div>
                  )}
                  <div className="flex items-center gap-2 p-2 rounded-lg border bg-[var(--bg-hover)] border-[var(--border)]">
                    <span className="text-xs font-medium w-10 text-[var(--text-dim)]">模型</span>
                    {(() => {
                      const preferred =
                        agentModels[agent.id] && agentModels[agent.id].length > 0
                          ? agentModels[agent.id]
                          : globalModels.length > 0
                            ? globalModels
                            : BUILTIN_MODEL_SUGGESTIONS;
                      const models = Array.from(new Set(preferred));
                      const q = agent.model.trim().toLowerCase();
                      const filtered = q ? models.filter((m) => m.toLowerCase().includes(q)) : models;
                      const visible = filtered;
                      const open = modelPickerOpenId === agent.id;
                      return (
                        <div className="flex-1 relative">
                          <input
                            className="w-full border-none px-2 py-1.5 text-xs font-semibold focus:outline-none bg-[var(--bg-panel)] text-[var(--foreground)] rounded-md"
                            style={{ backgroundColor: 'var(--bg-panel)', color: 'var(--foreground)' }}
                            value={agent.model}
                            placeholder="输入关键字搜索模型…"
                            onFocus={() => setModelPickerOpenId(agent.id)}
                            onBlur={() => window.setTimeout(() => setModelPickerOpenId((cur) => (cur === agent.id ? null : cur)), 120)}
                            onChange={(e) => {
                              const value = e.target.value;
                              updateAgent(agent.id, { model: value });
                              setFieldError(agent.id, 'model', value.trim() ? undefined : '请填写模型');
                              setModelPickerOpenId(agent.id);
                            }}
                          />
                          {open && (
                            <div
                              className="absolute left-0 right-0 top-full mt-1 border rounded-xl shadow-lg overflow-hidden z-30"
                              style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}
                            >
                              <div
                                className="px-2 py-1 text-[11px] border-b"
                                style={{ color: 'var(--text-dim)', backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border)' }}
                              >
                                共 {models.length}，匹配 {filtered.length}
                              </div>
                              <div className="max-h-56 overflow-y-auto">
                                {visible.length === 0 ? (
                                  <div className="px-3 py-3 text-sm" style={{ color: 'var(--text-dim)' }}>
                                    无匹配结果
                                  </div>
                                ) : (
                                  visible.map((m) => (
                                    <button
                                      key={m}
                                      type="button"
                                      className="w-full text-left px-3 py-2 text-xs font-semibold transition-colors hover:bg-[var(--bg-hover)]"
                                      style={{ color: 'var(--foreground)' }}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        updateAgent(agent.id, { model: m });
                                        setFieldError(agent.id, 'model', undefined);
                                        setModelPickerOpenId(null);
                                      }}
                                    >
                                      {m}
                                    </button>
                                  ))
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium px-1" style={{ color: 'var(--text-dim)' }}>人设 / 提示词</span>
                    <textarea 
                      className="w-full border rounded-lg p-2.5 text-xs resize-none focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 min-h-[60px] transition-all leading-relaxed bg-[var(--bg-hover)] border-[var(--border)] text-[var(--foreground)]"
                      value={agent.persona}
                      onChange={(e) => updateAgent(agent.id, { persona: e.target.value })}
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setExpandedAgentId(expandedAgentId === agent.id ? null : agent.id)}
                      className="text-[11px] font-medium flex items-center gap-1 transition-colors px-1 hover:opacity-90"
                      style={{ color: 'var(--text-dim)' }}
                    >
                      <Settings className="w-3 h-3" /> 独立 API 配置
                    </button>
                  </div>

                  {expandedAgentId === agent.id && (
                    <div className="mt-2 border rounded-xl p-3 space-y-2 bg-[var(--bg-hover)] border-[var(--border)]">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">独立 API（留空则使用全局）</div>
                      <input
                        className="w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 bg-[var(--bg-panel)] border-[var(--border)] text-[var(--foreground)]"
                        placeholder="Base URL (留空用全局)"
                        value={agent.apiBaseUrl || ''}
                        onChange={(e) => updateAgent(agent.id, { apiBaseUrl: e.target.value || undefined })}
                      />
                      <input
                        type="password"
                        className="w-full border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 bg-[var(--bg-panel)] border-[var(--border)] text-[var(--foreground)]"
                        placeholder="API Key (留空用全局)"
                        value={agent.apiKey || ''}
                        onChange={(e) => updateAgent(agent.id, { apiKey: e.target.value || undefined })}
                      />
                      <div className="flex justify-end pt-1">
                        <button
                          type="button"
                          className="text-white text-xs font-semibold px-3 py-2 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
                          onClick={() => void handleFetchAgentModels(agent.id)}
                          disabled={isFetchingAgentModels[agent.id] || (!agent.apiKey && !settings.apiKey) || (!agent.apiBaseUrl && !settings.apiBaseUrl)}
                        >
                          {isFetchingAgentModels[agent.id] ? '测试中...' : '测试并刷新模型'}
                        </button>
                      </div>
                      {agentModelsStatus[agent.id] && (
                        <div className={`text-[11px] ${agentModelsStatus[agent.id]?.type === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                          {agentModelsStatus[agent.id]?.text}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Action Buttons */}
      <div className="p-5 border-t space-y-3 shadow-[0_-4px_10px_rgba(0,0,0,0.02)] border-[var(--border)] bg-[var(--bg-panel)]">
        <button
          className="w-full flex items-center justify-center gap-2 text-white font-semibold py-3 rounded-xl transition-all shadow-[0_2px_10px_rgba(37,99,235,0.2)] hover:shadow-[0_4px_15px_rgba(37,99,235,0.3)] hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 bg-[var(--accent)] hover:bg-[var(--accent-hover)]"
          onClick={handleInit}
          disabled={!canControl}
          type="button"
        >
          <Play className="w-4 h-4 fill-current" />
          初始化对局
        </button>
        <div className="flex gap-2">
          <button
            className="flex-1 flex items-center justify-center gap-1.5 font-semibold py-2.5 rounded-xl transition-all text-sm border shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--bg-panel)] border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--bg-hover)]"
            onClick={handleNext}
            disabled={!canControl}
            type="button"
          >
            <ChevronRight className="w-4 h-4" />
            下一轮
          </button>
          <button
            className="flex-1 flex items-center justify-center gap-1.5 font-semibold py-2.5 rounded-xl transition-all text-sm border shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--bg-panel)] border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--bg-hover)]"
            onClick={handleToggleAuto}
            disabled={gameState === 'SPEAKING'}
            type="button"
          >
            <FastForward className="w-4 h-4" />
            {isAutoRunning ? '停止自动' : '自动运行'}
          </button>
          {showCancel && (
            <button
              className="flex-1 flex items-center justify-center gap-1.5 font-semibold py-2.5 rounded-xl transition-all text-sm border shadow-sm disabled:opacity-50 disabled:cursor-not-allowed bg-[var(--danger-soft)] border-[var(--border)] text-[var(--danger)] hover:opacity-90"
              onClick={handleCancel}
              type="button"
            >
              取消生成
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
