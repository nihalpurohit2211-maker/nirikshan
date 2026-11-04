/* pages_ask.js — Workstream C: the #/ask chat page.
 *
 * The page owns no numbers and no verdicts: every figure in a bubble is what
 * POST /api/ask served, and that answer is composed by `backend/ask.py` from the
 * rules engine. The citation chips are the point of the page — a doc chip opens
 * the excerpt line it quoted, and a case/node chip navigates, so an officer can
 * always get from a sentence to the record behind it.
 *
 * The integrator owns the #/ask route entry, the floating button, the case-page
 * "Explain this case" link (#/ask?case=<id>) and these two tags:
 *   <link rel="stylesheet" href="ask.css">   <script src="pages_ask.js">
 * This file only defines NIRI.pages.ask and must load after components.js.
 * The transcript lives in NIRI.state.ask — memory only, so it survives a route
 * change and dies with the tab.
 */
window.NIRI = window.NIRI || {};

(function (NIRI) {
  'use strict';

  var el = NIRI.el, api = NIRI.api;

  var SUGGESTIONS = [
    'Why is Ward 3 unsafe?',
    'Which standard covers turbidity?',
    'Which branch is running out of chlorine?',
    'What should the officer do first?'
  ];
  var PREFILL = 'Explain this case';
  var LOADING = 'reading the standards...';
  var DISCLAIMER = 'Automated findings support human judgment. They are not official'
                 + ' regulatory decisions.';

  function store() {
    NIRI.state = NIRI.state || {};
    var st = NIRI.state.ask;
    if (!st || !Array.isArray(st.messages)) {
      st = NIRI.state.ask = { messages: [], draft: '', waiting: false, error: null,
                              caseId: null, prefilledFor: null };
    }
    return st;
  }

  /* ------------------------------------------------------------------ citations */
  /* <details> makes the chip its own disclosure: the quote is one click away and
     the transcript never needs a side panel. */
  function docChip(cite) {
    var file = String(cite.doc || 'excerpt').split('/').pop();
    return el('details', { class: 'ask-cite ask-cite-doc' }, [
      el('summary', { text: file + ':' + cite.line,
                      title: cite.doc + ', line ' + cite.line }),
      el('blockquote', { class: 'ask-quote', text: cite.quote }),
      el('div', { class: 'ask-src', text: cite.doc + ' · line ' + cite.line })
    ]);
  }

  function goChip(cite) {
    return el('button', { class: 'ask-cite ask-cite-go', text: cite.id,
                          title: 'open ' + cite.href,
                          on: { click: function () { location.hash = cite.href; } } });
  }

  function chip(cite) {
    if (!cite) return null;
    if (cite.kind === 'doc') return docChip(cite);
    if (cite.kind === 'case' || cite.kind === 'node') return goChip(cite);
    return el('span', { class: 'ask-cite', text: cite.id || cite.doc || cite.kind });
  }

  /* ------------------------------------------------------------ reasoning trace */
  /* The steps are served, not invented here: each one is a record of work the
     engine did. The panel is a disclosure so the answer stays the headline. */
  function reasoningPanel(msg) {
    if (!msg.reasoning || !msg.reasoning.length) return null;
    var body = el('div', { class: 'ask-steps' });
    msg.reasoning.forEach(function (step, i) {
      body.appendChild(el('div', { class: 'ask-step', style: '--i:' + i }, [
        el('span', { class: 'ask-step-n', text: String(step.n) }),
        el('div', { class: 'ask-step-main' }, [
          el('div', { class: 'ask-step-head' }, [
            el('strong', { text: step.title }),
            el('code', { class: 'ask-step-tool', text: step.tool })
          ]),
          el('p', { class: 'ask-step-detail', text: step.detail })
        ])
      ]));
    });
    var ev = msg.evidence || {};
    return el('details', { class: 'ask-reason', open: msg.fresh ? '' : null }, [
      el('summary', {}, [
        el('span', { class: 'ask-reason-dot' }),
        el('span', { text: 'Reasoning · ' + msg.reasoning.length + ' steps' }),
        el('span', { class: 'ask-reason-meta', text: (msg.elapsed_ms || 0) + ' ms · '
          + (ev.values || 0) + ' values · ' + (ev.docs || 0) + ' docs · '
          + (ev.records || 0) + ' records' })
      ]),
      body
    ]);
  }

  function followupChips(msg) {
    if (!msg.fresh || !msg.followups || !msg.followups.length) return null;
    var row = el('div', { class: 'ask-followups' });
    row.appendChild(el('span', { class: 'ask-followups-label', text: 'ask next' }));
    msg.followups.forEach(function (q) {
      row.appendChild(el('button', { class: 'ask-chip ask-chip-sm', text: q,
        on: { click: function () { var st = store(); st.draft = q; send(); } } }));
    });
    return row;
  }

  /* -------------------------------------------------------------------- bubbles */
  function userRow(text) {
    return el('div', { class: 'ask-row ask-row-user' },
      [el('div', { class: 'ask-bubble ask-bubble-user', text: text })]);
  }

  function assistantRow(msg) {
    var bubble = el('div', { class: 'ask-bubble ask-bubble-ai' });
    if (msg.pending) {
      bubble.appendChild(NIRI.loading(LOADING));
      return el('div', { class: 'ask-row ask-row-ai' },
                [el('div', { class: 'ask-who', text: 'Nirikshan' }), bubble]);
    }
    /* One paragraph per served line — the backend already breaks the answer into
       sentences, so nothing here re-reads or re-formats a number. */
    String(msg.text || '').split('\n').forEach(function (line) {
      bubble.appendChild(el('p', { class: 'ask-line' + (/^-\s/.test(line)
                                             ? ' ask-line-item' : ''), text: line }));
    });
    var panel = reasoningPanel(msg);
    if (panel) bubble.appendChild(panel);
    var foot = el('div', { class: 'ask-foot' }, [
      el('span', { class: 'ask-provider ask-provider-' + (msg.provider || 'offline'),
                   text: msg.provider === 'online' ? 'online' : 'offline',
                   title: msg.provider === 'online'
                          ? 'wording rewritten by the configured provider; every'
                            + ' number was checked against the engine values'
                          : 'worded offline from the engine; no provider was called' })
    ]);
    (msg.citations || []).forEach(function (cite) {
      var node = chip(cite);
      if (node) foot.appendChild(node);
    });
    bubble.appendChild(foot);
    var next = followupChips(msg);
    if (next) bubble.appendChild(next);
    return el('div', { class: 'ask-row ask-row-ai' },
              [el('div', { class: 'ask-who', text: 'Nirikshan' }), bubble]);
  }

  /* --------------------------------------------------------------------- paint */
  function paint() {
    var st = store(), host = st.host;
    if (!host) return;
    var wasFocused = document.activeElement === st.box;
    NIRI.clear(host);

    if (st.caseId) {
      host.appendChild(el('div', { class: 'ask-context' }, [
        el('span', { class: 'ask-context-label', text: 'Case ' + st.caseId }),
        el('a', { class: 'ask-context-link', href: '#/cases/' + st.caseId,
                  text: 'open the case' })]));
    }

    if (!st.messages.length) {
      host.appendChild(el('div', { class: 'ask-hero' }, [
        el('div', {}, [
          el('p', { class: 'ask-eyebrow', text: 'Evidence assistant · demo' }),
          el('h2', { text: 'Every answer points back to a record.' }),
          el('p', { class: 'ask-lede' },
            'Ask about a ward, a standard, a forecast or what to do first. The words '
            + 'are drafted here; the number, band and verdict inside them come from '
            + 'the rules engine and from the served readings.')
        ]),
        el('div', { class: 'ask-sources' }, ['readings', 'standards', 'cases', 'nodes']
          .map(function (t) { return el('span', { class: 'ask-source', text: t }); }))
      ]));
    }

    var thread = el('div', { class: 'ask-thread' });
    if (!st.messages.length) {
      thread.appendChild(el('p', { class: 'ask-empty', text: 'Try one of these —' }));
      thread.appendChild(el('div', { class: 'ask-chips' }, SUGGESTIONS.map(function (q) {
        return el('button', { class: 'ask-chip', text: q, on: { click: function () {
          st.draft = q;
          send();
        } } });
      })));
    } else {
      st.messages.forEach(function (msg) {
        thread.appendChild(msg.role === 'user' ? userRow(msg.text) : assistantRow(msg));
      });
    }
    host.appendChild(thread);

    if (st.error) {
      host.appendChild(el('div', { class: 'ask-error', role: 'alert', text: st.error }));
    }

    st.box = el('textarea', {
      class: 'ask-input', rows: '2', 'aria-label': 'Ask a question',
      placeholder: st.waiting ? LOADING : 'Ask about a ward, a standard or a case...',
      disabled: st.waiting ? true : null, text: st.draft,
      on: {
        input: function () { st.draft = st.box.value; },
        keydown: function (ev) {
          if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            send();
          }
        }
      }
    });
    host.appendChild(el('div', { class: 'ask-composer' }, [
      st.box,
      el('button', { class: 'ask-send', text: 'Send', disabled: st.waiting ? true : null,
                     on: { click: send } })
    ]));
    host.appendChild(el('div', { class: 'ask-composer-foot' }, [
      el('span', { class: 'ask-hint', text: 'Enter sends · Shift+Enter adds a line' }),
      el('span', { class: 'ask-disclaimer', text: DISCLAIMER })
    ]));

    if (wasFocused) st.box.focus();
    if (st.messages.length) {
      try { thread.scrollIntoView({ block: 'end' }); } catch (e) { /* older browsers */ }
    }
  }

  /* --------------------------------------------------------------------- send */
  function send() {
    var st = store();
    var question = (st.draft || '').trim();
    if (!question || st.waiting) return;
    var pending = { role: 'ai', pending: true };
    st.messages.push({ role: 'user', text: question }, pending);
    st.draft = '';
    st.error = null;
    st.waiting = true;
    paint();

    /* The last few turns travel with the question so a follow-up can inherit
       its scope ("and Ward 4?"); the server re-reads every number regardless. */
    var history = st.messages.filter(function (m) {
      return m.text && !m.pending;
    }).slice(-6).map(function (m) {
      return { role: m.role === 'ai' ? 'assistant' : 'user', text: m.text };
    });
    var body = { question: question, history: history };
    if (st.caseId) body.case_id = st.caseId;
    api.post('/api/ask', body).then(function (out) {
      pending.pending = false;
      pending.text = out && out.answer ? out.answer
                                       : 'the server sent no answer for that';
      pending.provider = (out && out.provider) || 'offline';
      pending.citations = (out && out.citations) || [];
      pending.reasoning = (out && out.reasoning) || [];
      pending.evidence = (out && out.evidence) || {};
      pending.followups = (out && out.followups) || [];
      pending.elapsed_ms = out && out.elapsed_ms;
      pending.intent = out && out.intent;
      pending.fresh = true;
    }, function (err) {
      /* A failed turn leaves the transcript intact: drop the empty assistant
         bubble, put the question back in the composer and show the server's words. */
      var at = st.messages.indexOf(pending);
      if (at >= 0) st.messages.splice(at, 1);
      var last = st.messages[st.messages.length - 1];
      if (last && last.role === 'user' && last.text === question) st.messages.pop();
      st.draft = question;
      st.error = (err && err.detail) || 'the ask endpoint did not answer';
    }).then(function () {
      st.waiting = false;
      paint();
    });
  }

  NIRI.pages = NIRI.pages || {};
  NIRI.pages.ask = {
    title: 'Ask Nirikshan',
    sub: 'a question answered from the served readings, the standards excerpt and'
       + ' the cases the rules engine already opened',
    render: function (host, params) {
      params = params || {};
      var st = store();
      st.caseId = params.case || params.case_id || null;
      st.host = host;
      if (st.caseId && st.prefilledFor !== st.caseId) {
        /* #/ask?case=<id> from a case page: prefill the composer, never auto-send —
           the officer still chooses the question. */
        st.prefilledFor = st.caseId;
        if (!st.draft && !st.waiting) st.draft = PREFILL;
      }
      st.box = null;
      paint();
    }
  };
}(window.NIRI));
