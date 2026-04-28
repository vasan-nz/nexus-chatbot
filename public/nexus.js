/**
 * NEXUS Chatbot — Vanilla ES2022+
 * All UI logic for the NEXUS chatbot widget.
 * Injected into manickavasan.com via a <script defer> tag.
 */
(function () {
  'use strict';

  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  /**
   * Derive the API base URL from this script's own src attribute.
   * Works cross-domain: the script is hosted on the Vercel deployment but
   * runs in the context of the portfolio page.
   */
  // document.currentScript is null for defer scripts; querySelector is the real mechanism.
  const scriptEl = document.querySelector('script[src*="nexus.js"]');
  const API_BASE = scriptEl ? new URL(scriptEl.src).origin : '';
  const API_URL  = `${API_BASE}/api/chat`;

  const CHIPS = ["What's his stack?", 'Is he available?', 'Show me his projects'];

  /** SVG arc circumference: 2 * Math.PI * r(8) ≈ 50.27 */
  const ARC_CIRCUMFERENCE = 50.27;

  class NexusChatbot {
    #isOpen           = false;
    #history          = [];
    #isStreaming      = false;
    #chipsHidden      = false;
    #lastUserMessage    = null;
    #touchStartY        = 0;
    #boundDocClick      = null;
    #timestampInterval  = null;

    constructor() {
      this.#injectDOM();
      this.#bindEvents();
      this.#startTimestampUpdater();
    }

    /** Build and inject all DOM elements into document.body */
    #injectDOM() {
      this.launcher = document.createElement('button');
      this.launcher.id = 'nx-launcher';
      this.launcher.setAttribute('aria-label', 'Open NEXUS AI assistant');
      this.launcher.setAttribute('aria-expanded', 'false');
      this.launcher.textContent = 'NEXUS ✦';

      this.panel = document.createElement('div');
      this.panel.id = 'nx-panel';
      this.panel.classList.add('nx-hidden');
      this.panel.setAttribute('role', 'dialog');
      this.panel.setAttribute('aria-modal', 'true');
      this.panel.setAttribute('aria-label', 'NEXUS AI assistant');

      this.panel.innerHTML = `
        <div id="nx-drag-handle" aria-hidden="true">
          <div class="nx-drag-bar"></div>
        </div>
        <div id="nx-header">
          <div class="nx-header-left">
            <div class="nx-status-dot" aria-hidden="true"></div>
            <div>
              <div class="nx-title">NEXUS</div>
              <div class="nx-subtitle">Ask me about Vasan</div>
            </div>
          </div>
          <button id="nx-close-btn" aria-label="Close NEXUS">&#x2715;</button>
        </div>
        <div id="nx-chips" role="group" aria-label="Suggested questions">
          ${CHIPS.map(c => `<button class="nx-chip">${c}</button>`).join('')}
        </div>
        <div id="nx-messages" role="log" aria-live="polite" aria-label="Conversation">
          ${this.#emptyStateHTML()}
        </div>
        <div id="nx-input-area">
          <textarea
            id="nx-textarea"
            placeholder="Ask about Vasan…"
            rows="1"
            maxlength="200"
            aria-label="Your message"
          ></textarea>
          <div class="nx-input-controls">
            <button id="nx-send-btn" aria-label="Send">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
            <svg id="nx-char-arc" viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="8" fill="none"
                stroke="rgba(255,255,255,0.08)" stroke-width="2"/>
              <circle id="nx-char-progress" cx="10" cy="10" r="8"
                fill="none" stroke="#646cff" stroke-width="2"
                stroke-linecap="round"
                stroke-dasharray="${ARC_CIRCUMFERENCE}"
                stroke-dashoffset="${ARC_CIRCUMFERENCE}"
                transform="rotate(-90 10 10)"/>
            </svg>
          </div>
        </div>
      `;

      document.body.appendChild(this.launcher);
      document.body.appendChild(this.panel);

      this.$messages     = this.panel.querySelector('#nx-messages');
      this.$textarea     = this.panel.querySelector('#nx-textarea');
      this.$sendBtn      = this.panel.querySelector('#nx-send-btn');
      this.$chips        = this.panel.querySelector('#nx-chips');
      this.$charArc      = this.panel.querySelector('#nx-char-arc');
      this.$charProgress = this.panel.querySelector('#nx-char-progress');
    }

    /** @returns {string} Empty state HTML */
    #emptyStateHTML() {
      return `
        <div class="nx-empty-state" aria-hidden="true">
          <div class="nx-avatar"></div>
          <div class="nx-empty-title">Hi, I'm NEXUS</div>
          <div class="nx-empty-sub">Vasan's personal AI. Ask me anything about him.</div>
        </div>
      `;
    }

    /** Attach all DOM event listeners */
    #bindEvents() {
      this.launcher.addEventListener('click', () => this.toggle());

      this.panel.querySelector('#nx-close-btn')
        .addEventListener('click', () => this.close());

      this.$textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.#submit();
        }
      });

      this.$textarea.addEventListener('input', () => {
        this.#autoResize();
        this.#updateCharArc();
      });

      this.$sendBtn.addEventListener('click', () => this.#submit());

      this.$chips.querySelectorAll('.nx-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          this.$textarea.value = chip.textContent;
          this.#submit();
        });
      });

      // Mobile swipe-down-to-close on drag handle
      const handle = this.panel.querySelector('#nx-drag-handle');
      handle.addEventListener('touchstart', (e) => {
        this.#touchStartY = e.touches[0].clientY;
      }, { passive: true });
      handle.addEventListener('touchend', (e) => {
        const delta = e.changedTouches[0].clientY - this.#touchStartY;
        if (delta > 60) this.close();
      }, { passive: true });

      // Click outside panel closes it
      this.#boundDocClick = (e) => {
        if (
          this.#isOpen &&
          !this.panel.contains(e.target) &&
          e.target !== this.launcher
        ) {
          this.close();
        }
      };
      document.addEventListener('click', this.#boundDocClick);
    }

    /** Toggle open/close */
    toggle() {
      this.#isOpen ? this.close() : this.open();
    }

    /** Open the chat panel */
    open() {
      this.#isOpen = true;
      this.panel.classList.remove('nx-hidden');
      this.launcher.setAttribute('aria-expanded', 'true');

      // Re-trigger spring animation each open
      this.panel.style.animation = 'none';
      void this.panel.offsetWidth; // force reflow
      this.panel.style.animation = '';

      requestAnimationFrame(() => {
        setTimeout(() => this.$textarea.focus(), 350);
      });
    }

    /** Close the chat panel */
    close() {
      this.#isOpen = false;
      this.panel.classList.add('nx-hidden');
      this.launcher.setAttribute('aria-expanded', 'false');
    }

    /** Auto-resize textarea to fit content, capped at 100px */
    #autoResize() {
      this.$textarea.style.height = 'auto';
      this.$textarea.style.height = `${Math.min(this.$textarea.scrollHeight, 100)}px`;
    }

    /** Update SVG arc to reflect character usage (0–200) */
    #updateCharArc() {
      const len = this.$textarea.value.length;
      const ratio = len / 200;
      const offset = ARC_CIRCUMFERENCE - ratio * ARC_CIRCUMFERENCE;
      this.$charProgress.style.strokeDashoffset = offset;

      if (len > 180) {
        this.$charProgress.style.stroke = '#ef4444';
      } else if (len > 150) {
        this.$charProgress.style.stroke = '#f59e0b';
      } else {
        this.$charProgress.style.stroke = '#646cff';
      }

      // Show arc only after user starts typing
      this.$charArc.classList.toggle('nx-visible', len > 0);
    }

    /** Remove the empty-state placeholder on first message */
    #removeEmptyState() {
      this.$messages.querySelector('.nx-empty-state')?.remove();
    }

    /** Hide suggestion chips after first interaction */
    #hideChips() {
      if (!this.#chipsHidden) {
        this.#chipsHidden = true;
        this.$chips.classList.add('nx-hidden');
      }
    }

    /**
     * Append a message bubble to the conversation.
     * @param {'bot'|'user'|'error'} role
     * @param {string} [text='']
     * @returns {HTMLElement} The inner `.nx-bubble` element
     */
    #appendMessage(role, text = '') {
      this.#removeEmptyState();

      const wrap = document.createElement('div');
      wrap.classList.add('nx-message', `nx-${role}`);

      const bubble = document.createElement('div');
      bubble.classList.add('nx-bubble');
      bubble.textContent = text;

      const ts = document.createElement('div');
      ts.classList.add('nx-timestamp');
      ts.dataset.time = String(Date.now());
      ts.textContent = 'just now';

      wrap.appendChild(bubble);
      wrap.appendChild(ts);

      if (role === 'error') {
        const retry = document.createElement('button');
        retry.classList.add('nx-retry-btn');
        retry.textContent = '↺ Retry';
        retry.addEventListener('click', () => {
          wrap.remove();
          if (this.#lastUserMessage) {
            this.$textarea.value = this.#lastUserMessage;
            this.#submit();
          }
        });
        wrap.appendChild(retry);
      }

      this.$messages.appendChild(wrap);
      this.#scrollToBottom();

      // Trigger barely-visible arrival ripple on the panel
      this.panel.classList.remove('nx-arrived');
      void this.panel.offsetWidth; // force reflow to restart animation
      this.panel.classList.add('nx-arrived');
      setTimeout(() => this.panel.classList.remove('nx-arrived'), 600);

      return bubble;
    }

    /** Show animated three-dot typing indicator */
    #showTyping() {
      const el = document.createElement('div');
      el.id = 'nx-typing';
      el.classList.add('nx-typing-indicator');
      el.innerHTML = `
        <div class="nx-typing-dot"></div>
        <div class="nx-typing-dot"></div>
        <div class="nx-typing-dot"></div>
      `;
      this.$messages.appendChild(el);
      this.#scrollToBottom();
      return el;
    }

    /** Scroll messages list to the bottom */
    #scrollToBottom() {
      this.$messages.scrollTop = this.$messages.scrollHeight;
    }

    /**
     * Update all timestamps in the conversation relative to now.
     * Runs on a 30-second interval.
     */
    #startTimestampUpdater() {
      this.#timestampInterval = setInterval(() => {
        this.$messages?.querySelectorAll('.nx-timestamp[data-time]').forEach((el) => {
          const elapsed = Date.now() - parseInt(el.dataset.time, 10);
          if (elapsed < 60_000) {
            el.textContent = 'just now';
          } else if (elapsed < 3_600_000) {
            el.textContent = `${Math.floor(elapsed / 60_000)} min ago`;
          } else {
            el.textContent = `${Math.floor(elapsed / 3_600_000)}h ago`;
          }
        });
      }, 30_000);
    }

    /** Remove global listeners and clear timers (for SPA teardown). */
    destroy() {
      document.removeEventListener('click', this.#boundDocClick);
      clearInterval(this.#timestampInterval);
      this.launcher.remove();
      this.panel.remove();
    }

    /** Read textarea, validate, then fire the streaming request */
    async #submit() {
      const text = this.$textarea.value.trim();
      if (!text || this.#isStreaming) return;

      this.#isStreaming     = true;
      this.#lastUserMessage = text;
      this.$sendBtn.disabled = true;
      this.$textarea.value   = '';
      this.$textarea.style.height = 'auto';
      this.#updateCharArc();
      this.#hideChips();

      this.#appendMessage('user', text);
      const typingEl = this.#showTyping();
      this.panel.classList.add('nx-typing');

      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            history: this.#history.slice(-6)
          })
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
          throw new Error(body.error?.message || `Request failed with status ${res.status}`);
        }

        typingEl.remove();
        const botBubble = this.#appendMessage('bot', '');
        let fullText = '';

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer    = '';
        let streamDone = false;

        while (true) {
          if (streamDone) break;
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') { streamDone = true; break; }
            if (payload === '[ERROR]') throw new Error('The AI stream encountered an error. Please try again.');

            try {
              const { token } = JSON.parse(payload);
              if (token) {
                fullText += token;
                botBubble.textContent = fullText;
                this.#scrollToBottom();
              }
            } catch {
              // Skip malformed SSE chunks
            }
          }
        }

        // Keep last 12 messages (6 turns) in history
        this.#history.push(
          { role: 'user',      content: text },
          { role: 'assistant', content: fullText }
        );
        if (this.#history.length > 12) {
          this.#history = this.#history.slice(-12);
        }

      } catch (err) {
        typingEl.remove();

        // Clean up any empty bot bubble created before the error
        this.$messages.querySelectorAll('.nx-bot .nx-bubble').forEach((b) => {
          if (!b.textContent.trim()) b.closest('.nx-message')?.remove();
        });

        this.#appendMessage('error', err.message || 'Something went wrong. Please try again.');
        if (isDev) console.error('[NEXUS]', err);

      } finally {
        this.#isStreaming      = false;
        this.$sendBtn.disabled = false;
        this.panel.classList.remove('nx-typing');
        this.$textarea.focus();
      }
    }
  }

  // Boot when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new NexusChatbot());
  } else {
    new NexusChatbot();
  }

})();
