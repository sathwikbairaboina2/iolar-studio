'use client';
import { Button } from 'antd';
import type { Post } from '@/lib/schema';

// Stub — full AI revise drawer lands with the AI integration task.
export default function AiDrawer({
  onOpen,
}: {
  slug: string;
  post: Post;
  slideIndex: number;
  open: boolean;
  prefill: string;
  onOpen: () => void;
  onClose: () => void;
  onApplied: (p: Post) => void | Promise<void>;
}) {
  return (
    <Button
      type="primary"
      onClick={onOpen}
      style={{
        position: 'fixed', right: 24, bottom: 24, borderRadius: 24,
        background: 'linear-gradient(135deg,#7c5cff,#3ec5ff)',
        boxShadow: '0 6px 20px rgba(124,92,255,.5)',
      }}
    >
      ✦ Revise with AI
    </Button>
  );
}
