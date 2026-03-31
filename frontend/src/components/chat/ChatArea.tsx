'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Bot, Paperclip, Send, Square, Pencil, Trash2, Copy, Check } from 'lucide-react';
import { useAppStore } from '@/store';
import { deleteMessage, editMessage, sendUserMessage, stopGeneration, streamReply, syncStateFromBackend } from '@/lib/game';
import Image from 'next/image';
import type { Message } from '@/types';

type Attachment = {
  id: string;
  name: string;
  kind: 'image' | 'text';
  data?: string;
  progress: number;
};

function uid() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = typeof crypto !== 'undefined' ? crypto : null;
  return c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function splitThink(content: string) {
  const openTag = '<think>';
  const closeTag = '</think>';
  const openIdx = content.indexOf(openTag);
  if (openIdx < 0) return { think: '', rest: content, isThinking: false };
  const closeIdx = content.indexOf(closeTag, openIdx + openTag.length);
  if (closeIdx < 0) {
    const rest = content.slice(0, openIdx).trimEnd();
    const think = content.slice(openIdx + openTag.length);
    return { think: think.trimStart(), rest, isThinking: true };
  }

  const think = content.slice(openIdx + openTag.length, closeIdx).trim();
  const rest = (content.slice(0, openIdx) + content.slice(closeIdx + closeTag.length)).trim();
  return { think, rest, isThinking: false };
}

function parseJsonMsg(content: string) {
  if (!content.startsWith('JSON_MSG:')) return null;
  try {
    const parts = JSON.parse(content.slice(9)) as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    if (!Array.isArray(parts)) return null;
    return parts;
  } catch {
    return null;
  }
}

function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = text;
  let key = 0;

  const patterns: Array<{
    type: 'code' | 'link' | 'bold' | 'italic';
    re: RegExp;
  }> = [
    { type: 'code', re: /`([^`]+)`/ },
    { type: 'link', re: /\[([^\]]+)\]\(([^)]+)\)/ },
    { type: 'bold', re: /\*\*([^*]+)\*\*/ },
    { type: 'italic', re: /\*([^*]+)\*/ },
  ];

  while (rest.length > 0) {
    let best: { type: string; match: RegExpExecArray; index: number } | null = null;
    for (const p of patterns) {
      const m = p.re.exec(rest);
      if (!m) continue;
      const idx = m.index ?? 0;
      if (!best || idx < best.index) best = { type: p.type, match: m, index: idx };
    }

    if (!best) {
      nodes.push(rest);
      break;
    }

    if (best.index > 0) {
      nodes.push(rest.slice(0, best.index));
      rest = rest.slice(best.index);
    }

    const m = best.match;
    if (best.type === 'code') {
      nodes.push(
        <code key={`c-${key++}`} className="px-1 py-0.5 rounded-md text-[12px]" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--foreground)' }}>
          {m[1]}
        </code>
      );
      rest = rest.slice(m[0].length);
      continue;
    }
    if (best.type === 'link') {
      const label = m[1];
      const href = m[2];
      nodes.push(
        <a
          key={`a-${key++}`}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
          style={{ color: 'var(--accent)' }}
        >
          {label}
        </a>
      );
      rest = rest.slice(m[0].length);
      continue;
    }
    if (best.type === 'bold') {
      nodes.push(
        <strong key={`b-${key++}`} style={{ color: 'var(--foreground)' }}>
          {m[1]}
        </strong>
      );
      rest = rest.slice(m[0].length);
      continue;
    }
    if (best.type === 'italic') {
      nodes.push(
        <em key={`i-${key++}`} style={{ color: 'var(--foreground)' }}>
          {m[1]}
        </em>
      );
      rest = rest.slice(m[0].length);
      continue;
    }
  }

  return nodes;
}

type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'quote'; lines: string[] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'code'; lang?: string; code: string }
  | { type: 'para'; lines: string[] };

function parseMarkdownBlocks(input: string): MdBlock[] {
  const text = (input || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const blocks: MdBlock[] = [];

  let inCode = false;
  let codeLang: string | undefined;
  let codeLines: string[] = [];

  let para: string[] = [];
  let quote: string[] = [];
  let ul: string[] = [];
  let ol: string[] = [];

  const flushPara = () => {
    if (para.length > 0) blocks.push({ type: 'para', lines: para });
    para = [];
  };
  const flushQuote = () => {
    if (quote.length > 0) blocks.push({ type: 'quote', lines: quote });
    quote = [];
  };
  const flushUl = () => {
    if (ul.length > 0) blocks.push({ type: 'ul', items: ul });
    ul = [];
  };
  const flushOl = () => {
    if (ol.length > 0) blocks.push({ type: 'ol', items: ol });
    ol = [];
  };

  for (const line of lines) {
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence) {
      if (!inCode) {
        flushPara();
        flushQuote();
        flushUl();
        flushOl();
        inCode = true;
        codeLang = fence[1] || undefined;
        codeLines = [];
      } else {
        blocks.push({ type: 'code', lang: codeLang, code: codeLines.join('\n') });
        inCode = false;
        codeLang = undefined;
        codeLines = [];
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushPara();
      flushQuote();
      flushUl();
      flushOl();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushPara();
      flushQuote();
      flushUl();
      flushOl();
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, text: heading[2] });
      continue;
    }

    const q = line.match(/^>\s?(.*)$/);
    if (q) {
      flushPara();
      flushUl();
      flushOl();
      quote.push(q[1]);
      continue;
    }

    const olm = line.match(/^\s*\d+\.\s+(.*)$/);
    if (olm) {
      flushPara();
      flushQuote();
      flushUl();
      ol.push(olm[1]);
      continue;
    }

    const ulm = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulm) {
      flushPara();
      flushQuote();
      flushOl();
      ul.push(ulm[1]);
      continue;
    }

    para.push(line);
  }

  if (inCode) blocks.push({ type: 'code', lang: codeLang, code: codeLines.join('\n') });
  flushPara();
  flushQuote();
  flushUl();
  flushOl();
  return blocks;
}

const MarkdownView = React.memo(function MarkdownView({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          const cls =
            b.level === 1 ? 'text-lg font-bold' :
            b.level === 2 ? 'text-base font-bold' :
            'text-sm font-bold';
          const Tag = (b.level === 1 ? 'h1' : b.level === 2 ? 'h2' : b.level === 3 ? 'h3' : b.level === 4 ? 'h4' : b.level === 5 ? 'h5' : 'h6') as keyof React.JSX.IntrinsicElements;
          return (
            <Tag key={i} className={cls} style={{ color: 'var(--foreground)' }}>
              {renderInline(b.text)}
            </Tag>
          );
        }
        if (b.type === 'quote') {
          return (
            <blockquote key={i} className="pl-3 border-l-4 whitespace-pre-wrap text-sm leading-relaxed" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
              {b.lines.join('\n')}
            </blockquote>
          );
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1 text-sm" style={{ color: 'var(--foreground)' }}>
              {b.items.map((it, idx) => <li key={idx}>{renderInline(it)}</li>)}
            </ul>
          );
        }
        if (b.type === 'ol') {
          return (
            <ol key={i} className="list-decimal pl-5 space-y-1 text-sm" style={{ color: 'var(--foreground)' }}>
              {b.items.map((it, idx) => <li key={idx}>{renderInline(it)}</li>)}
            </ol>
          );
        }
        if (b.type === 'code') {
          return (
            <pre key={i} className="p-3 rounded-xl overflow-x-auto border text-[12px]" style={{ backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border)', color: 'var(--foreground)' }}>
              <code>{b.code}</code>
            </pre>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--foreground)' }}>
            {renderInline(b.lines.join('\n'))}
          </p>
        );
      })}
    </div>
  );
});

const MessageRow = React.memo(function MessageRow({
  msg,
  agentByName,
  showModelInfo,
  streamingMessageId,
  onCopy,
  onStartEdit,
  onDelete,
}: {
  msg: Message;
  agentByName: Map<string, { avatar?: string }>;
  showModelInfo: boolean;
  streamingMessageId: string | null;
  onCopy: (text: string) => void;
  onStartEdit: (id: string, current: string) => void;
  onDelete: (historyIndex: number) => void;
}) {
  const isUser = msg.speaker === 'User';
  const isSystem = msg.speaker === 'System';
  const agent = agentByName.get(msg.speaker.trim());
  const src = agent?.avatar;
  const fallback = (msg.speaker || '').slice(0, 1).toUpperCase();

  const { think, rest, isThinking } = useMemo(() => splitThink(msg.content), [msg.content]);
  const meta = msg.metadata;
  const parts = useMemo(() => parseJsonMsg(rest), [rest]);
  const isStreaming = streamingMessageId === msg.id;

  const textToCopy = useMemo(() => {
    if (!parts) return rest;
    return parts
      .filter((p) => p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text!)
      .join('\n\n');
  }, [parts, rest]);

  const renderedBody = useMemo(() => {
    if (parts) {
      return (
        <div className="space-y-3">
          {parts
            .filter((p) => p.type === 'text' && typeof p.text === 'string')
            .map((p, i) => (
              <div key={`t-${i}`} className="space-y-2">
                {isStreaming ? (
                  <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--foreground)' }}>
                    {p.text}
                  </div>
                ) : (
                  <MarkdownView text={p.text!} />
                )}
              </div>
            ))}
          <div className="flex flex-wrap gap-2">
            {parts
              .filter((p) => p.type === 'image_url' && p.image_url?.url)
              .map((p, i) => (
                <Image
                  key={`i-${i}`}
                  src={p.image_url!.url}
                  alt="uploaded"
                  width={220}
                  height={180}
                  className="max-w-[220px] max-h-[180px] rounded-xl border border-slate-200 shadow-sm object-cover"
                  style={{ borderColor: 'var(--border)' }}
                  unoptimized
                />
              ))}
          </div>
        </div>
      );
    }

    if (isStreaming) {
      return (
        <div className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--foreground)' }}>
          {rest}
        </div>
      );
    }

    return <MarkdownView text={rest} />;
  }, [isStreaming, parts, rest]);

  return (
    <div className={`flex flex-col space-y-1.5 ${isUser ? 'ml-auto w-full max-w-[560px] items-end' : 'mr-auto w-full max-w-4xl'}`}>
      <div className={`mb-1 px-1 w-full ${isUser ? '' : ''}`}>
        {isUser ? (
          <div className="w-full flex items-center justify-between gap-2">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                className="p-1.5 rounded-lg transition-colors transition-transform active:scale-95 hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-dim)' }}
                onClick={() => onCopy(textToCopy)}
                title="复制"
              >
                <Copy className="w-4 h-4" />
              </button>
              {typeof msg.historyIndex === 'number' ? (
                <>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg transition-colors transition-transform active:scale-95 hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-dim)' }}
                    onClick={() => onStartEdit(msg.id, splitThink(msg.content).rest || msg.content)}
                    title="编辑"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg transition-colors transition-transform active:scale-95 hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-dim)' }}
                    onClick={() => onDelete(msg.historyIndex!)}
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-[11px] px-2 py-0.5 rounded-md border font-medium tracking-wide"
                style={{ color: 'var(--text-dim)', backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border)' }}
              >
                {msg.model}
              </span>
              <span className="font-bold text-sm" style={{ color: 'var(--foreground)' }}>
                {msg.speaker}
              </span>
              <div
                className="w-7 h-7 rounded-full overflow-hidden border flex items-center justify-center"
                style={{ backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                title={msg.speaker}
              >
                {src ? (
                  <Image src={src} alt="avatar" width={28} height={28} className="w-full h-full object-cover block" unoptimized />
                ) : (
                  <span className="text-xs font-bold">{fallback || '🤖'}</span>
                )}
              </div>
            </div>
          </div>
        ) : isSystem ? (
          <div className="w-full flex items-center justify-between gap-2">
            <div className="text-xs font-semibold" style={{ color: 'var(--text-dim)' }}>
              系统提示
            </div>
            <button
              type="button"
              className="p-1.5 rounded-lg transition-colors transition-transform active:scale-95 hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-dim)' }}
              onClick={() => onCopy(textToCopy)}
              title="复制"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div
              className="w-7 h-7 rounded-full overflow-hidden border flex items-center justify-center"
              style={{ backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              title={msg.speaker}
            >
              {src ? (
                <Image src={src} alt="avatar" width={28} height={28} className="w-full h-full object-cover block" unoptimized />
              ) : (
                <span className="text-xs font-bold">{fallback || '🤖'}</span>
              )}
            </div>
            <span className="font-bold text-sm" style={{ color: 'var(--foreground)' }}>
              {msg.speaker}
            </span>
            <span
              className="text-[11px] px-2 py-0.5 rounded-md border font-medium tracking-wide"
              style={{ color: 'var(--text-dim)', backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border)' }}
            >
              {msg.model}
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                className="p-1.5 rounded-lg transition-colors transition-transform active:scale-95 hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-dim)' }}
                onClick={() => onCopy(textToCopy)}
                title="复制"
              >
                <Copy className="w-4 h-4" />
              </button>
              {typeof msg.historyIndex === 'number' ? (
                <>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg transition-colors transition-transform active:scale-95 hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-dim)' }}
                    onClick={() => onStartEdit(msg.id, splitThink(msg.content).rest || msg.content)}
                    title="编辑"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 rounded-lg transition-colors transition-transform active:scale-95 hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-dim)' }}
                    onClick={() => onDelete(msg.historyIndex!)}
                    title="删除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
      <div
        className={`p-5 rounded-2xl border shadow-[0_2px_8px_rgba(0,0,0,0.04)] leading-relaxed max-w-none hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-shadow w-full ${
          isUser ? 'rounded-tr-sm' : 'rounded-tl-sm'
        }`}
        style={{
          backgroundColor: isUser ? 'var(--bg-hover)' : isSystem ? 'var(--bg-hover)' : 'var(--bg-panel)',
          borderColor: 'var(--border)',
          color: isSystem ? 'var(--text-dim)' : 'var(--foreground)',
        }}
      >
        <div className="space-y-3">
          {think ? (
            <details
              className="border rounded-xl p-3"
              style={{ backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border)' }}
              open={isThinking}
            >
              <summary className="cursor-pointer text-sm font-semibold" style={{ color: 'var(--text-dim)' }}>
                {isThinking
                  ? '思考中…'
                  : typeof meta?.thinkingDuration === 'number'
                    ? `已完成思考，耗时 ${meta.thinkingDuration.toFixed(2)}s`
                    : '思考过程'}
              </summary>
              <div
                className="mt-2 whitespace-pre-wrap text-sm leading-relaxed max-h-56 overflow-y-auto pr-1 overscroll-contain"
                style={{ color: 'var(--text-dim)' }}
              >
                {think}
              </div>
            </details>
          ) : null}

          {renderedBody}

          {(showModelInfo && meta) || msg.ragUsed ? (
            <div className="pt-2 border-t text-xs flex flex-wrap gap-x-4 gap-y-1" style={{ borderColor: 'var(--border)', color: 'var(--text-dim)' }}>
              {msg.ragUsed ? <div>已调用记忆检索</div> : null}
              {typeof meta?.thinkingDuration === 'number' ? <div>思考耗时: {meta.thinkingDuration.toFixed(2)}s</div> : null}
              {typeof meta?.totalDuration === 'number' ? <div>总耗时: {meta.totalDuration.toFixed(2)}s</div> : null}
              {meta?.totalTokens !== undefined ? <div>Tokens: {String(meta.totalTokens)}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

export default function ChatArea() {
  const { messages, gameState, currentRound, settings, isGenerating, agents, streamingMessageId } = useAppStore();
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [toastText, setToastText] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [isMentionOpen, setIsMentionOpen] = useState(false);
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);

  const isUploading = useMemo(() => attachments.some((a) => a.progress < 100), [attachments]);
  const mentionTargets = useMemo(() => agents.filter((a) => !a.isMuted).map((a) => a.name), [agents]);
  const agentByName = useMemo(() => new Map(agents.map((a) => [a.name.trim(), a])), [agents]);

  const handleSend = async () => {
    if (gameState === 'SPEAKING') {
      await stopGeneration();
      return;
    }
    const text = inputValue.trim();
    if ((!text && attachments.length === 0) || isGenerating || isUploading) return;

    let combinedText = text;
    const textFiles = attachments.filter((a) => a.kind === 'text' && a.data);
    if (textFiles.length > 0) {
      combinedText += '\n\n【用户上传的参考文件】';
      for (const f of textFiles) {
        combinedText += `\n\n--- 文件名: ${f.name} ---\n${f.data}\n--- 结束 ---`;
      }
    }

    let finalContent = combinedText;
    const images = attachments.filter((a) => a.kind === 'image' && a.data);
    if (images.length > 0) {
      const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [{ type: 'text', text: combinedText }];
      for (const img of images) {
        parts.push({ type: 'image_url', image_url: { url: img.data! } });
      }
      finalContent = 'JSON_MSG:' + JSON.stringify(parts);
    }

    setInputValue('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    const res = await sendUserMessage(finalContent);
    setAttachments([]);
    const targets = res.trigger_reply || [];
    for (const agentName of targets) {
      await streamReply(agentName);
    }
  };

  const onPickFiles = () => fileInputRef.current?.click();

  const onFilesSelected: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    const MAX_SIZE_MB = 20;
    const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
    const MAX_FILES = 5;

    if (attachments.length + files.length > MAX_FILES) return;

    for (const file of files) {
      if (file.size > MAX_SIZE_BYTES) continue;

      const isImage = file.type.startsWith('image/');
      const att: Attachment = { id: uid(), name: file.name, kind: isImage ? 'image' : 'text', progress: 0 };
      setAttachments((prev) => [...prev, att]);

      const reader = new FileReader();
      reader.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        const pct = Math.round((evt.loaded / evt.total) * 100);
        setAttachments((prev) => prev.map((a) => (a.id === att.id ? { ...a, progress: Math.min(pct, 99) } : a)));
      };
      reader.onload = () => {
        const data = typeof reader.result === 'string' ? reader.result : '';
        setAttachments((prev) => prev.map((a) => (a.id === att.id ? { ...a, data, progress: 100 } : a)));
      };

      if (isImage) reader.readAsDataURL(file);
      else reader.readAsText(file);
    }
  };

  const handleStartEdit = useCallback((id: string, current: string) => {
    setEditingId(id);
    setEditingText(current);
  }, []);

  const handleSaveEdit = async (id: string) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg || typeof msg.historyIndex !== 'number') {
      setEditingId(null);
      setEditingText('');
      return;
    }
    await editMessage(msg.historyIndex, editingText);
    setEditingId(null);
    setEditingText('');
    await syncStateFromBackend();
  };

  const handleDelete = useCallback((historyIndex: number) => {
    setConfirmDeleteIndex(historyIndex);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (typeof confirmDeleteIndex !== 'number') return;
    const idx = confirmDeleteIndex;
    setConfirmDeleteIndex(null);
    await deleteMessage(idx);
    await syncStateFromBackend();
  }, [confirmDeleteIndex]);

  const handleCopy = useCallback(async (text: string) => {
    const value = text || '';
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const el = document.createElement('textarea');
        el.value = value;
        el.style.position = 'fixed';
        el.style.left = '-9999px';
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      setToastText('已复制到剪贴板');
      toastTimerRef.current = window.setTimeout(() => setToastText(null), 1600);
    } catch {}
  }, []);

  const updateStickiness = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const threshold = 80;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < threshold;
  }, []);

  const scrollToBottomIfNeeded = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  const scrollKey = useMemo(() => {
    const last = messages[messages.length - 1];
    return `${messages.length}-${last?.id || ''}-${(last?.content || '').length}-${streamingMessageId || ''}`;
  }, [messages, streamingMessageId]);

  useEffect(() => {
    scrollToBottomIfNeeded();
  }, [scrollKey, scrollToBottomIfNeeded]);

  return (
    <div className="flex-1 flex flex-col h-full relative transition-colors" style={{ backgroundColor: 'var(--background)' }}>
      {confirmDeleteIndex !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <div className="w-full max-w-sm rounded-2xl border shadow-xl" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
            <div className="p-5 space-y-2">
              <div className="text-base font-bold" style={{ color: 'var(--foreground)' }}>
                确认删除这条消息？
              </div>
              <div className="text-sm" style={{ color: 'var(--text-dim)' }}>
                删除后无法恢复（仅删除当前会话中的该条记录）。
              </div>
            </div>
            <div className="px-5 pb-5 flex justify-end gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-xl border font-semibold hover:bg-[var(--bg-hover)]"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                onClick={() => setConfirmDeleteIndex(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-xl font-semibold text-white bg-red-600 hover:bg-red-700"
                onClick={() => void confirmDelete()}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div
        className={`fixed left-1/2 -translate-x-1/2 z-50 transition-all duration-200 ${
          toastText ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
        }`}
        style={{ top: '5rem' }}
      >
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-lg"
          style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'rgba(34,197,94,0.55)', color: 'var(--foreground)' }}
        >
          <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(34,197,94,0.15)' }}>
            <Check className="w-4 h-4" style={{ color: '#22c55e' }} />
          </div>
          <div className="text-sm font-semibold">{toastText || ''}</div>
        </div>
      </div>
      
      {/* Top Status Bar */}
      <header
        className="h-16 border-b flex items-center justify-between px-6 backdrop-blur-md z-10 shadow-sm"
        style={{ borderColor: 'var(--border)', backgroundColor: 'color-mix(in srgb, var(--bg-panel) 82%, transparent)' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-hover)' }}>
            <div className={`w-2.5 h-2.5 rounded-full shadow-sm ${
              gameState === 'IDLE' ? 'bg-slate-400' :
              gameState === 'READY' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
              gameState === 'SPEAKING' ? 'bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'bg-amber-500'
            }`} />
            <span className="text-sm font-bold tracking-wide" style={{ color: 'var(--text-dim)' }}>{gameState}</span>
          </div>
        </div>
        <div className="text-sm font-medium px-3 py-1.5 rounded-full border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-hover)', color: 'var(--text-dim)' }}>
          Round: <span className="font-bold ml-1" style={{ color: 'var(--foreground)' }}>{currentRound}/{settings.maxRounds}</span>
        </div>
      </header>

      {/* Messages Area */}
      <div
        ref={messagesScrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6"
        onScroll={updateStickiness}
      >
        {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center space-y-4" style={{ color: 'var(--text-dim)' }}>
            <div className="w-16 h-16 rounded-full flex items-center justify-center shadow-inner border" style={{ backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border)' }}>
              <Bot className="w-8 h-8" style={{ color: 'var(--text-dim)' }} />
            </div>
            <p className="text-sm font-medium">竞技场已就绪。点击左侧“初始化对局”开始。</p>
          </div>
        ) : (
          messages.map((msg) =>
            editingId === msg.id ? (
              <div key={msg.id} className="flex flex-col max-w-4xl w-full mr-auto space-y-1.5">
                <div className="p-5 rounded-2xl rounded-tl-sm border" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                  <div className="space-y-3">
                    <textarea
                      className="w-full border rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 min-h-[120px]"
                      style={{ backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        className="px-4 py-2 rounded-xl border font-semibold"
                        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)', color: 'var(--foreground)' }}
                        onClick={() => {
                          setEditingId(null);
                          setEditingText('');
                        }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                        onClick={() => void handleSaveEdit(msg.id)}
                      >
                        保存
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <MessageRow
                key={msg.id}
                msg={msg}
                agentByName={agentByName}
                showModelInfo={settings.showModelInfo}
                streamingMessageId={streamingMessageId}
                onCopy={(text) => void handleCopy(text)}
                onStartEdit={handleStartEdit}
                onDelete={(historyIndex) => void handleDelete(historyIndex)}
              />
            )
          )
        )}
      </div>

      {/* Input Area */}
      <div className="p-4 border-t shadow-[0_-4px_20px_rgba(0,0,0,0.03)] z-10" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)' }}>
        {attachments.length > 0 && (
          <div className="max-w-4xl mx-auto mb-3 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className="relative overflow-hidden border rounded-xl px-3 py-2 text-xs flex items-center gap-2"
                style={{ backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              >
                <span className="font-semibold">{a.kind === 'image' ? '🖼️' : '📄'}</span>
                <span className="max-w-[220px] truncate" title={a.name}>{a.name}</span>
                <button
                  type="button"
                  className="ml-1 hover:opacity-90"
                  style={{ color: 'var(--text-dim)' }}
                  onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                  disabled={a.progress < 100}
                  title="移除"
                >
                  ✕
                </button>
                {a.progress < 100 && (
                  <div className="absolute left-0 bottom-0 h-0.5 bg-blue-500" style={{ width: `${a.progress}%` }} />
                )}
              </div>
            ))}
          </div>
        )}
        <div className="max-w-4xl mx-auto relative flex items-end gap-2 border rounded-2xl p-2.5 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/10 transition-all"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-hover)' }}
        >
          
          <div className="flex items-center gap-1 pb-1">
            <button
              type="button"
              className="p-2 rounded-xl transition-colors"
              style={{ color: 'var(--text-dim)' }}
              title="@智能体"
              onClick={() => setIsMentionOpen((v) => !v)}
            >
              <AtSign className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={onPickFiles}
              className="p-2 rounded-xl transition-colors"
              style={{ color: 'var(--text-dim)' }}
              title="添加附件"
            >
              <Paperclip className="w-5 h-5" />
            </button>
          </div>
          {isMentionOpen && (
            <div className="absolute left-3 bottom-[64px] w-56 border rounded-2xl shadow-xl overflow-hidden z-20" style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}>
              <div className="px-3 py-2 text-xs font-bold border-b" style={{ color: 'var(--text-dim)', backgroundColor: 'var(--bg-hover)', borderColor: 'var(--border)' }}>
                选择要艾特的智能体
              </div>
              <div className="max-h-56 overflow-y-auto">
                {mentionTargets.length === 0 ? (
                  <div className="px-3 py-3 text-sm" style={{ color: 'var(--text-dim)' }}>暂无可用智能体</div>
                ) : (
                  mentionTargets.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm transition-colors hover:opacity-90"
                      style={{ color: 'var(--foreground)' }}
                      onClick={() => {
                        const token = `@${name} `;
                        setInputValue((prev) => (prev ? `${prev}\n${token}` : token));
                        setIsMentionOpen(false);
                        requestAnimationFrame(() => textareaRef.current?.focus());
                      }}
                    >
                      @{name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.txt,.md,.csv,.json,.py,.js,.ts,.tsx,.html,.css"
            className="hidden"
            onChange={onFilesSelected}
          />

          <textarea
            ref={textareaRef}
            className="flex-1 bg-transparent border-0 focus:ring-0 resize-none p-2 max-h-40 min-h-[44px] font-medium leading-relaxed"
            style={{ color: 'var(--foreground)' }}
            rows={1}
            placeholder="发送消息或输入 '@' 艾特指定智能体强制回复..."
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            onFocus={() => setIsMentionOpen(false)}
          />

          <div className="pb-1 pr-1">
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={(gameState !== 'SPEAKING' && !inputValue.trim() && attachments.length === 0) || isGenerating || isUploading}
              className={`p-2.5 rounded-xl flex items-center justify-center transition-all ${
                gameState === 'SPEAKING' || inputValue.trim() || attachments.length > 0
                  ? 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white shadow-[0_2px_10px_rgba(37,99,235,0.2)] hover:shadow-[0_4px_15px_rgba(37,99,235,0.3)] hover:-translate-y-0.5'
                  : 'bg-[var(--border)] cursor-not-allowed'
              } disabled:opacity-50 disabled:hover:translate-y-0`}
            >
              {gameState === 'SPEAKING' ? (
                <Square className="w-5 h-5 fill-current" />
              ) : (
                <Send className="w-5 h-5 ml-0.5" />
              )}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
