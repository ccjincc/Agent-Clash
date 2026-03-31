import React from 'react';
import Sidebar from '@/components/sidebar/Sidebar';
import ChatArea from '@/components/chat/ChatArea';

export default function Home() {
  return (
    <div
      className="flex h-screen w-full overflow-hidden font-sans antialiased"
      style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)' }}
    >
      <Sidebar />
      <ChatArea />
    </div>
  );
}
