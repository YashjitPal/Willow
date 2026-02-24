import { AgentId, ChatroomMessage } from './types';

type WaitResolver = {
  resolve: (msgs: ChatroomMessage[]) => void;
  timer: ReturnType<typeof setTimeout>;
};

const MAX_MESSAGES = 200;

export class Chatroom {
  private messages: ChatroomMessage[] = [];
  private waiters: Map<AgentId, WaitResolver[]> = new Map();
  private onMessageCallback?: (msg: ChatroomMessage) => void;
  // Index messages by recipient for O(1) lookup instead of O(n) filter
  private messagesByRecipient: Map<AgentId | 'all', ChatroomMessage[]> = new Map();

  /** Register a callback that fires every time a message is sent */
  onMessage(cb: (msg: ChatroomMessage) => void): void {
    this.onMessageCallback = cb;
  }

  /** Send a message from one agent to another (or broadcast to 'all') */
  send(from: AgentId, to: AgentId | 'all', content: string): void {
    const msg: ChatroomMessage = {
      id: `${from}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from,
      to,
      content,
      timestamp: Date.now(),
    };
    this.messages.push(msg);

    // Index by recipient
    if (!this.messagesByRecipient.has(to)) {
      this.messagesByRecipient.set(to, []);
    }
    this.messagesByRecipient.get(to)!.push(msg);

    // Trim if messages exceed limit
    if (this.messages.length > MAX_MESSAGES) {
      const trimCount = this.messages.length - MAX_MESSAGES;
      this.messages.splice(0, trimCount);
      // Rebuild index after trim
      this.rebuildIndex();
    }

    // Notify the UI via callback
    this.onMessageCallback?.(msg);

    if (to === 'all') {
      // Notify all waiting agents except sender
      for (const [agentId] of this.waiters) {
        if (agentId !== from) {
          this.resolveWaiters(agentId);
        }
      }
    } else {
      this.resolveWaiters(to);
    }
  }

  /** Wait for messages addressed to this agent. Resolves when a message arrives or timeout. */
  waitForMessages(agentId: AgentId, timeoutMs: number = 60_000): Promise<ChatroomMessage[]> {
    return new Promise((resolve) => {
      // Check if there are already unread messages
      const unread = this.getUnreadFor(agentId);
      if (unread.length > 0) {
        resolve(unread);
        return;
      }

      const timer = setTimeout(() => {
        this.removeWaiter(agentId, waiter);
        resolve([]); // Timeout — no messages
      }, Math.min(timeoutMs, 60_000));

      const waiter: WaitResolver = {
        resolve: (msgs) => {
          clearTimeout(timer);
          resolve(msgs);
        },
        timer,
      };

      if (!this.waiters.has(agentId)) {
        this.waiters.set(agentId, []);
      }
      this.waiters.get(agentId)!.push(waiter);
    });
  }

  /** Get all messages for an agent (addressed to them or broadcast, excluding self) */
  getMessagesFor(agentId: AgentId): ChatroomMessage[] {
    const direct = this.messagesByRecipient.get(agentId) || [];
    const broadcasts = (this.messagesByRecipient.get('all') || []).filter(m => m.from !== agentId);
    // Merge and sort by timestamp
    return [...direct, ...broadcasts].sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Get messages newer than a given timestamp for an agent */
  getMessagesSince(agentId: AgentId, sinceTimestamp: number): ChatroomMessage[] {
    const direct = this.messagesByRecipient.get(agentId) || [];
    const broadcasts = (this.messagesByRecipient.get('all') || []).filter(m => m.from !== agentId);
    return [...direct, ...broadcasts]
      .filter(m => m.timestamp > sinceTimestamp)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Get full log for debugging/display */
  getFullLog(): ChatroomMessage[] {
    return [...this.messages];
  }

  private getUnreadFor(agentId: AgentId): ChatroomMessage[] {
    return this.getMessagesFor(agentId);
  }

  private resolveWaiters(agentId: AgentId): void {
    const agentWaiters = this.waiters.get(agentId);
    if (!agentWaiters || agentWaiters.length === 0) return;

    const msgs = this.getMessagesFor(agentId);
    for (const waiter of agentWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(msgs);
    }
    this.waiters.set(agentId, []);
  }

  private removeWaiter(agentId: AgentId, waiter: WaitResolver): void {
    const agentWaiters = this.waiters.get(agentId);
    if (!agentWaiters) return;
    const idx = agentWaiters.indexOf(waiter);
    if (idx !== -1) agentWaiters.splice(idx, 1);
  }

  private rebuildIndex(): void {
    this.messagesByRecipient.clear();
    for (const msg of this.messages) {
      if (!this.messagesByRecipient.has(msg.to)) {
        this.messagesByRecipient.set(msg.to, []);
      }
      this.messagesByRecipient.get(msg.to)!.push(msg);
    }
  }
}
