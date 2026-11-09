/**
 * Vetwise household simulator.
 *
 * The browser is only a view. Every answer it shows came back from a real
 * JSON-RPC `tools/call` against `/mcp`; the token picker switches the scopes
 * that call is allowed to use, and the traffic panel is the server's own log of
 * those calls. No verdict, threshold or citation is computed here.
 */

const $ = (selector) => document.querySelector(selector);

const VERDICT_LABEL = {
  emergency: 'Emergency',
  call_vet: 'Call your vet',
  monitor: 'Monitor',
  no_known_toxicity: 'Below threshold',
  unverified: 'Unverified',
};

const TOOL_HOT = new Set(['assess_toxin_exposure', 'apply_record_change', 'log_care_event', 'alert_caregiver']);

const els = {
  clock: $('#clock'),
  clockNote: $('#clock-note'),
  demoReset: $('#demo-reset'),
  token: $('#token-select'),
  tokenInput: $('#token-input'),
  mute: $('#mute'),
  muteIcon: $('#mute-icon'),
  pets: $('#pets'),
  petsPill: $('#pets-pill'),
  householdNote: $('#household-note'),
  tonight: $('#tonight'),
  tonightPill: $('#tonight-pill'),
  prnWrap: $('#prn-wrap'),
  prn: $('#prn'),
  callList: $('#call-list'),
  orb: $('#orb'),
  badge: $('#agent-badge'),
  scopes: $('#scope-chips'),
  transcript: $('#transcript'),
  suggestions: $('#suggestions'),
  composer: $('#composer'),
  input: $('#message'),
  send: $('#send'),
  mic: $('#mic'),
  assessment: $('#assessment'),
  verdictPill: $('#verdict-pill'),
  exposures: $('#exposures'),
  exposureCount: $('#exposure-count'),
  traffic: $('#traffic'),
  trafficCount: $('#traffic-count'),
  toast: $('#toast'),
};

const ui = {
  token: localStorage.getItem('vetwise-token') || 'maya-owner-demo-token',
  sessionId: newSessionId(),
  voice: localStorage.getItem('vetwise-voice') !== 'off',
  busy: false,
  lastAssessment: null,
  latest: null,
};

/* --------------------------------------------------------------- utilities */

function newSessionId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const clockFormat = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

function isoTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : clockFormat.format(date);
}

/** `HH:MM` in the household's local wall clock — timezone-independent. */
function hhmmTime(value) {
  if (!value) return '';
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return clockFormat.format(date);
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function fixed(value, decimals = 2) {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return '';
  return String(round(value, decimals));
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

function personName(people, id) {
  return people.find((person) => person.id === id)?.name ?? id;
}

let toastTimer;
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${ui.token}`,
      ...(options.headers ?? {}),
    },
  });
  return response;
}

// Monotonic counters so a slow reply for an older token cannot land after a
// newer one and repaint the header with the wrong identity.
let identityEpoch = 0;
let stateEpoch = 0;

/* ------------------------------------------------------------------- voice */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

function speak(text) {
  if (!ui.voice || !('speechSynthesis' in window)) return;
  const clean = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(clean.slice(0, 320));
  utterance.lang = 'en-US';
  utterance.rate = 1.02;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function applyVoice() {
  els.mute.setAttribute('aria-pressed', String(ui.voice));
  els.muteIcon.textContent = ui.voice ? '🔊' : '🔇';
  els.mute.title = ui.voice ? 'Spoken replies are on' : 'Spoken replies are off';
  if (!ui.voice && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}

function stopListening() {
  els.mic.classList.remove('listening');
  els.orb.classList.remove('listening');
}

function setupRecognition() {
  if (!SpeechRecognition) {
    els.mic.addEventListener('click', () => toast('This browser has no speech input. Type instead.'));
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.addEventListener('result', (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (transcript) send(transcript);
  });
  recognition.addEventListener('end', stopListening);
  recognition.addEventListener('error', (event) => {
    stopListening();
    toast(event.error === 'not-allowed' ? 'Microphone permission was declined.' : 'I did not catch that.');
  });

  els.mic.addEventListener('click', () => {
    if (els.mic.classList.contains('listening')) {
      recognition.stop();
      return;
    }
    try {
      recognition.start();
      els.mic.classList.add('listening');
      els.orb.classList.add('listening');
    } catch {
      stopListening();
    }
  });
}

/* ---------------------------------------------------------------- transcript */

function appendTurn(role, content, options = {}) {
  const isUser = role === 'user';
  const avatar = el('div', { class: 'avatar', text: isUser ? 'You' : 'VW' });
  const bubble = el('div', { class: 'bubble' });

  if (options.thinking) {
    bubble.append(
      el(
        'div',
        { class: 'thinking-dots', 'aria-label': 'Working' },
        el('i'),
        el('i'),
        el('i'),
      ),
    );
  } else {
    bubble.append(el('p', { text: content }));
    if (options.steps?.length) bubble.append(stepsRow(options.steps));
    if (options.assessment) bubble.append(assessmentCard(options.assessment, { panel: false }));
    if (options.pending) bubble.append(confirmRow(options.pending));
  }

  const turn = el('div', { class: `turn ${isUser ? 'user' : 'assistant'}` }, avatar, bubble);
  els.transcript.append(turn);
  els.transcript.scrollTop = els.transcript.scrollHeight;
  return turn;
}

function stepsRow(steps) {
  const row = el('div', { class: 'steps' });
  for (const step of steps) {
    const classes = ['chip', step.ok ? 'ok' : 'err'];
    if (step.ok && TOOL_HOT.has(step.tool)) classes.push('hot');
    row.append(
      el('span', {
        class: classes.join(' '),
        text: `${step.ok ? '→' : '✕'} ${step.tool}`,
        title: (step.text || '').slice(0, 600),
      }),
    );
  }
  return row;
}

function confirmRow(pending) {
  const row = el('div', { class: 'confirm-row' });
  row.append(
    el('button', { type: 'button', text: 'Yes, apply it', onclick: () => send('yes') }),
    el('button', {
      type: 'button',
      class: 'decline',
      text: 'Not now',
      onclick: () => send('no'),
    }),
    el('span', { class: 'card-note', text: pending.summary ?? '' }),
  );
  return row;
}

function pickAssessment(steps = []) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.tool === 'assess_toxin_exposure' && step.ok && step.structured?.verdict) return step.structured;
  }
  return null;
}

/* ---------------------------------------------------------------- assessment */

function doseScale(assessment) {
  const bands = assessment.scale;
  if (!Array.isArray(bands) || bands.length === 0 || assessment.dosePerKg === undefined) return null;

  const ceiling = Math.max(bands[bands.length - 1].at * 1.35, assessment.dosePerKg * 1.1, 1);
  const scaleStep = ceiling >= 50 ? 10 : ceiling >= 10 ? 5 : ceiling >= 2 ? 1 : 0.5;
  const end = Math.ceil(ceiling / scaleStep) * scaleStep;
  const track = el('div', { class: 'scale-track' });
  bands.forEach((band, index) => {
    const next = bands[index + 1]?.at ?? end;
    const width = Math.max(0, ((next - band.at) / end) * 100);
    const segment = el('span', { class: `scale-seg ${band.verdict}` });
    segment.style.width = `${width}%`;
    track.append(segment);
  });

  const marker = el('span', { class: 'scale-marker' });
  marker.style.left = `${Math.min(100, Math.max(0, (assessment.dosePerKg / end) * 100))}%`;

  const labels = el('div', { class: 'scale-labels' });
  labels.append(el('span', { text: '0' }));
  for (const band of bands.slice(1)) labels.append(el('span', { text: String(band.at) }));
  labels.append(el('span', { text: fixed(end, end < 10 ? 1 : 0) }));

  return el('div', { class: 'scale' }, el('div', { class: 'scale-wrap' }, track, marker), labels);
}

function evidenceBlock(assessment) {
  const findings = assessment.findings ?? [];
  const finding =
    findings.find((entry) => entry.evidence?.quote && entry.evidence?.publisher) ??
    findings.find((entry) => entry.evidence?.quote);
  if (!finding) return null;

  const evidence = finding.evidence;
  const block = el('blockquote', { text: `“${evidence.quote}”` });
  const source = el('p', { class: 'source-line' });
  const citation = [evidence.publisher, evidence.title].filter(Boolean).join(', ');
  if (evidence.url) {
    source.append(document.createTextNode(`${citation || 'Source'} — `), el('a', { href: evidence.url, target: '_blank', rel: 'noreferrer', text: evidence.url.replace(/^https?:\/\//, '') }));
  } else {
    source.append(document.createTextNode(citation || 'Source'));
  }
  if (evidence.accessed) source.append(document.createTextNode(` · accessed ${evidence.accessed}`));
  return el('div', {}, block, source);
}

function contactRow(assessment) {
  const row = el('div', { class: 'contact-row' });
  const add = (label, clinic) => {
    if (!clinic) return;
    row.append(
      el(
        'span',
        { class: 'contact', title: clinic.name },
        document.createTextNode(`${label}: `),
        el('strong', { text: clinic.phone }),
      ),
    );
  };
  add('ER', assessment.contacts?.emergency);
  add('Vet', assessment.contacts?.primary);
  add('Poison', assessment.contacts?.poisonControl);
  return row.childElementCount > 0 ? row : null;
}

function factsRow(assessment) {
  const facts = [];
  if (assessment.amount?.normalised) facts.push(assessment.amount.normalised);
  else if (assessment.amount) facts.push(`${fixed(assessment.amount.value)} ${assessment.amount.unit}`);
  if (assessment.pet?.weightKg !== undefined) facts.push(`${assessment.pet.weightKg} kg`);
  if (assessment.toxin?.product) facts.push(assessment.toxin.product);
  if (assessment.toxin?.category) facts.push(String(assessment.toxin.category).replaceAll('_', ' '));
  if (assessment.checkedAt) facts.push(isoTime(assessment.checkedAt));
  const row = el('div', { class: 'assessment-facts' });
  for (const fact of facts) row.append(el('span', { class: 'fact', text: fact }));
  return row;
}

function handoffText(assessment) {
  const lines = [
    `Vetwise handoff — ${assessment.pet?.name ?? 'pet'} (${assessment.pet?.species ?? 'unknown species'}${assessment.pet?.weightKg !== undefined ? `, ${assessment.pet.weightKg} kg` : ''})`,
    `Assessed: ${isoTime(assessment.checkedAt)}`,
    `Exposure: ${assessment.toxin?.name ?? 'unknown'}${assessment.toxin?.product ? ` — ${assessment.toxin.product}` : ''}${assessment.amount?.normalised ? `, ${assessment.amount.normalised}` : ''}`,
    `Verdict: ${VERDICT_LABEL[assessment.verdict] ?? assessment.verdict}`,
    assessment.dosePerKg !== undefined ? `Dose: ${fixed(assessment.dosePerKg, 2)} ${assessment.doseUnit ?? ''}` : '',
    assessment.threshold ? `Band: ${assessment.threshold.label} (starts ${assessment.threshold.at})` : '',
    `Summary: ${assessment.summary}`,
    assessment.signs?.length ? `Signs: ${assessment.signs.join(', ')}` : '',
    assessment.contacts?.primary ? `Primary vet: ${assessment.contacts.primary.name} ${assessment.contacts.primary.phone}` : '',
    assessment.contacts?.emergency ? `Emergency: ${assessment.contacts.emergency.name} ${assessment.contacts.emergency.phone}` : '',
    assessment.contacts?.poisonControl ? `Poison control: ${assessment.contacts.poisonControl.name} ${assessment.contacts.poisonControl.phone}` : '',
    '',
    'Vetwise does not advise treatment or inducing vomiting.',
  ];
  return lines.filter(Boolean).join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.append(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  }
}

function assessmentCard(assessment, options = {}) {
  const card = el('div', { class: `verdict-card ${assessment.verdict}` });
  card.append(
    el(
      'div',
      { class: 'verdict-top' },
      el('span', { class: 'verdict-label', text: 'Vetwise verdict' }),
      el('span', { class: 'verdict-tag', text: VERDICT_LABEL[assessment.verdict] ?? assessment.verdict }),
    ),
  );

  const body = el('div', { class: 'verdict-body' });
  body.append(el('h4', { class: 'verdict-headline', text: assessment.headline }));
  if (assessment.summary) body.append(el('p', { class: 'verdict-sub', text: assessment.summary }));

  if (options.panel) body.append(factsRow(assessment));

  if (assessment.dosePerKg !== undefined) {
    body.append(
      el(
        'div',
        { class: 'dose-math' },
        el('strong', { text: fixed(assessment.dosePerKg, 2) }),
        el('span', {
          text: `${assessment.doseUnit ?? ''}${assessment.pet?.weightKg !== undefined ? ` · ${fixed(assessment.amount?.value)} ${assessment.amount?.unit ?? ''} in a ${assessment.pet.weightKg} kg ${assessment.pet.species ?? 'pet'}` : ''}`,
        }),
      ),
    );
  }

  const scale = doseScale(assessment);
  if (scale) body.append(scale);

  if (assessment.threshold?.detail) body.append(el('p', { class: 'verdict-detail', text: assessment.threshold.detail }));
  if (assessment.escalation?.reason) body.append(el('p', { class: 'verdict-detail', text: `Escalated: ${assessment.escalation.reason}` }));

  const evidence = evidenceBlock(assessment);
  if (evidence) body.append(evidence);

  if (assessment.signs?.length) {
    body.append(el('p', { class: 'assessment-signs' }, el('strong', { text: 'Watch for: ' }), document.createTextNode(assessment.signs.join(', '))));
  }

  const contacts = contactRow(assessment);
  if (contacts) body.append(contacts);

  if (options.panel) {
    if (assessment.firstAid?.length) {
      body.append(detailsBlock('First steps on the record', assessment.firstAid));
    }
    const notes = [...(assessment.assumptions ?? []), ...(assessment.limitations ?? [])];
    if (notes.length) body.append(detailsBlock('Assumptions and limits', notes));
  }

  body.append(
    el('button', {
      type: 'button',
      class: 'handoff',
      text: 'Copy vet handoff',
      onclick: async () => {
        const copied = await copyText(handoffText(assessment));
        toast(copied ? 'Vet handoff copied to the clipboard.' : 'Select the assessment and copy it manually.');
      },
    }),
  );

  card.append(body);
  return card;
}

function detailsBlock(summary, lines) {
  return el(
    'details',
    {},
    el('summary', { text: summary }),
    el('ul', {}, ...lines.map((line) => el('li', { text: line }))),
  );
}

function renderAssessmentPanel(assessment) {
  ui.latest = assessment;
  els.verdictPill.className = `verdict-pill ${assessment.verdict}`;
  els.verdictPill.textContent = VERDICT_LABEL[assessment.verdict] ?? assessment.verdict;
  els.assessment.replaceChildren(assessmentCard(assessment, { panel: true }));
}

/* ------------------------------------------------------------------- state */

function renderPets(state) {
  const people = state.people ?? [];
  els.pets.replaceChildren();
  els.petsPill.textContent = `${state.pets?.length ?? 0} pets`;
  els.householdNote.textContent = state.household?.name ?? '';

  for (const pet of state.pets ?? []) {
    const conditions = pet.conditions?.length ? pet.conditions.join(' · ') : 'No conditions on file';
    els.pets.append(
      el(
        'li',
        { class: 'pet' },
        el('div', { class: 'pet-avatar', text: pet.name.charAt(0) }),
        el(
          'div',
          { class: 'pet-main' },
          el('div', { class: 'pet-name' }, pet.name, el('small', { text: pet.species === 'cat' ? 'cat' : 'dog' })),
          el('div', { class: 'pet-meta', text: `${pet.breed} · ${pet.weightKg} kg · ${pet.ageYears}y` }),
          el('div', { class: 'pet-conditions', text: conditions }),
        ),
      ),
    );
  }

  if (people.length === 0) return;
}

function renderTonight(state) {
  const care = state.care;
  if (!care) return;
  const people = state.people ?? [];

  const pending = care.due + care.missed;
  els.tonightPill.textContent = pending > 0 ? `${pending} due` : care.upcoming > 0 ? `${care.upcoming} upcoming` : 'done';

  els.tonight.replaceChildren();
  const slots = (care.slots ?? []).slice().sort((a, b) => {
    if (a.scheduledTime !== b.scheduledTime) return a.scheduledTime.localeCompare(b.scheduledTime);
    return a.petName.localeCompare(b.petName);
  });

  for (const slot of slots) {
    const sub = `${slot.doseLabel}${slot.strength ? ` · ${slot.strength}` : ''}${slot.recordedBy ? ` · logged by ${personName(people, slot.recordedBy).split(' ')[0]}` : ''}`;
    els.tonight.append(
      el(
        'li',
        { class: `dose ${slot.status}` },
        el('span', { class: 'dot' }),
        el(
          'div',
          { class: 'dose-text' },
          el('div', { class: 'dose-name', text: `${slot.petName} — ${slot.medicationName}` }),
          el('div', { class: 'dose-sub', text: sub }),
        ),
        el('span', { class: 'dose-when', text: slot.status === 'taken' ? '✓ taken' : hhmmTime(slot.scheduledTime) }),
      ),
    );
  }

  const prn = care.prn ?? [];
  els.prnWrap.hidden = prn.length === 0;
  els.prn.replaceChildren();
  for (const item of prn) {
    els.prn.append(
      el(
        'li',
        {},
        el('strong', { text: `${item.petName} · ${item.medicationName}${item.strength ? ` ${item.strength}` : ''}` }),
        el('span', { text: ` — ${item.doseLabel}. ${item.instructions}` }),
      ),
    );
  }
}

function renderCalls(state) {
  const kindLabel = { emergency: 'Emergency · 24/7', primary: 'Primary vet', poison_control: 'Poison control · 24/7' };
  const kindClass = { emergency: 'emergency', primary: '', poison_control: 'poison' };
  const order = { emergency: 0, primary: 1, poison_control: 2 };
  const clinics = (state.clinics ?? []).slice().sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3));

  els.callList.replaceChildren();
  for (const clinic of clinics) {
    const phone = el('a', { class: 'call-phone', href: `tel:${clinic.phone.replace(/[^\d+]/g, '')}` }, clinic.phone, el('small', { text: clinic.hours ?? '' }));
    els.callList.append(
      el(
        'li',
        { class: `call ${kindClass[clinic.kind] ?? ''}` },
        el('div', { class: 'call-kind', text: kindLabel[clinic.kind] ?? clinic.kind }),
        el('div', { class: 'call-name', text: clinic.name }),
        phone,
      ),
    );
  }
}

function renderExposures(state) {
  const exposures = state.exposures ?? [];
  const pets = state.pets ?? [];
  els.exposureCount.textContent = String(exposures.length);
  els.exposures.replaceChildren();

  if (exposures.length === 0) {
    els.exposures.append(el('li', { class: 'empty', text: 'No exposures logged yet.' }));
    return;
  }

  for (const exposure of exposures.slice(0, 12)) {
    const pet = pets.find((entry) => entry.id === exposure.petId)?.name ?? exposure.petId;
    const meta = [
      VERDICT_LABEL[exposure.verdict] ?? exposure.verdict,
      exposure.product,
      exposure.dosePerKg !== undefined ? `${fixed(exposure.dosePerKg, 2)} ${exposure.doseUnit ?? ''}` : '',
    ]
      .filter(Boolean)
      .join(' · ');

    els.exposures.append(
      el(
        'li',
        { class: `exposure ${exposure.verdict}` },
        el('span', { class: 'ex-dot' }),
        el(
          'div',
          { class: 'ex-main' },
          el('div', { class: 'ex-name', text: `${exposure.toxinName} — ${pet}` }),
          el('div', { class: 'ex-meta', text: meta }),
        ),
        el('span', { class: 'ex-when', text: isoTime(exposure.reportedAt) }),
      ),
    );
  }
}

function renderTraffic(state) {
  const traffic = (state.traffic ?? []).slice(-14).reverse();
  els.trafficCount.textContent = String(state.traffic?.length ?? 0);
  els.traffic.replaceChildren();

  if (traffic.length === 0) {
    els.traffic.append(el('li', { class: 'empty', text: 'No calls yet.' }));
    return;
  }

  for (const entry of traffic) {
    const target = entry.tool || entry.resource || entry.prompt || '';
    const method = el('span', { class: 't-method', text: entry.method });
    els.traffic.append(
      el(
        'li',
        { title: `${entry.at} · client ${entry.clientId ?? '—'} · HTTP ${entry.status}` },
        method,
        el('span', { class: `t-tool${TOOL_HOT.has(target) ? ' t-hot' : ''}`, text: target }),
        el('span', { class: `t-ms${entry.status >= 400 ? ' t-bad' : ''}`, text: `${entry.durationMs}ms` }),
      ),
    );
  }
}

/** Public demos reseed on a timer; say so, so a visitor's edits vanishing is no surprise. */
let latestDemoReset;

/**
 * Caches reset status and updates the notice using wall time. Hides it when
 * status is absent; missing, invalid, or elapsed deadlines show an overdue or
 * unknown status. Future deadlines are rounded up to whole minutes.
 */
function renderDemoReset(demo) {
  latestDemoReset = demo;
  if (!demo) {
    els.demoReset.hidden = true;
    return;
  }
  const remaining = Date.parse(demo.nextResetAt) - Date.now();
  const minutes = Math.ceil(remaining / 60_000);
  els.demoReset.textContent =
    !Number.isFinite(remaining) || remaining <= 0
      ? 'Public demo · reset overdue or status unknown'
      : minutes <= 1 ? 'Public demo · resets in under a minute' : `Public demo · resets in ${minutes} min`;
  els.demoReset.title = `Shared demo household. Every change is wiped every ${demo.resetMinutes} minutes.`;
  els.demoReset.hidden = false;
}

/** Renders household panels, the narrative clock, demo reset status, and agent details. */
function renderState(state) {
  renderPets(state);
  renderTonight(state);
  renderCalls(state);
  renderExposures(state);
  renderTraffic(state);

  if (state.care?.asOf) {
    els.clock.textContent = isoTime(state.care.asOf);
    const date = new Date(state.care.asOf);
    const weekday = Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    els.clockNote.textContent = weekday ? `${weekday} · demo` : 'demo clock';
  }

  renderDemoReset(state.demo);

  if (state.agent) {
    els.badge.textContent =
      state.agent.mode === 'bedrock'
        ? `bedrock planner · ${state.agent.model}`
        : 'scripted planner · MCP tools/call';
    els.badge.title = `${state.agent.mode} (${state.agent.model})`;
  }
}

async function refreshState() {
  const epoch = ++stateEpoch;
  const response = await api('/api/state').catch(() => null);
  if (!response || epoch !== stateEpoch) return null;
  if (response.status === 401) {
    els.badge.textContent = 'token rejected';
    return null;
  }
  if (!response.ok) return null;
  const state = await response.json();
  if (epoch !== stateEpoch) return null;
  renderState(state);
  return state;
}

/* -------------------------------------------------------------- identity */

function renderScopes(scopes) {
  const all = ['vetwise.read', 'vetwise.log', 'vetwise.write', 'vetwise.notify'];
  els.scopes.replaceChildren();
  for (const scope of all) {
    const on = scopes.includes(scope);
    els.scopes.append(el('span', { class: `scope ${on ? 'on' : 'off'}`, text: scope, title: on ? 'granted' : 'not granted' }));
  }
}

function welcome(who) {
  els.transcript.replaceChildren();
  const label = who?.label ?? els.token.selectedOptions[0]?.textContent ?? 'this household';
  const role = who?.clientId ?? '';
  const scopeLine =
    role === 'noah'
      ? 'You have read, log and notify access. Medication changes need Maya.'
      : 'You have read, log, record-change and alert access.';
  const first = appendTurn(
    'assistant',
    `I’m Vetwise. Signed in as ${label}. ${scopeLine} Ask me what’s due, what a pet got into, or tell me a dose was given.`,
  );
  const bubble = first.querySelector('.bubble');
  bubble.append(el('div', { class: 'steps' }, el('span', { class: 'chip', text: 'household record · 2 pets' })));
}

async function loadIdentity({ reset = false } = {}) {
  const epoch = ++identityEpoch;
  const token = ui.token;
  localStorage.setItem('vetwise-token', token);
  const response = await api('/api/whoami').catch(() => null);
  // Switching tokens while a request is in flight must not let the old identity
  // land last: `welcome()` clears the transcript, so a stale reply would wipe the
  // new greeting and show the wrong scopes.
  if (epoch !== identityEpoch || token !== ui.token) return;
  const who = response?.ok ? await response.json() : null;
  if (epoch !== identityEpoch || token !== ui.token) return;
  renderScopes(who?.scopes ?? []);
  if (reset) {
    ui.sessionId = newSessionId();
    ui.latest = null;
    els.verdictPill.className = 'verdict-pill';
    els.verdictPill.textContent = '—';
    els.assessment.replaceChildren(
      el('p', {
        class: 'empty',
        text: 'No exposure assessed yet. Ask what a pet ate, and the verdict, dose math and cited evidence land here.',
      }),
    );
    welcome(who);
  }
}

/* ---------------------------------------------------------------- sending */

async function send(raw) {
  const message = String(raw ?? '').trim();
  if (!message || ui.busy) return;

  appendTurn('user', message);
  const thinking = appendTurn('assistant', '', { thinking: true });
  ui.busy = true;
  els.send.disabled = true;
  els.orb.classList.add('thinking');
  els.input.value = '';

  try {
    const response = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId: ui.sessionId, message }),
    });

    const data = await response.json().catch(() => ({}));
    thinking.remove();

    if (!response.ok) {
      appendTurn('assistant', data.reply ?? 'The household record could not be reached. Try again in a moment.');
      if (response.status === 401) toast('That token was rejected.');
      return;
    }

    const assessment = pickAssessment(data.steps);
    const turn = appendTurn('assistant', data.reply, {
      steps: data.steps ?? [],
      assessment,
      pending: data.pendingConfirmation,
    });
    // The sitter token cannot write by design. When that is the reason for the
    // refusal, offer the one action that fixes it instead of a dead end.
    if (ui.token === 'noah-sitter-demo-token' && /missing the vetwise\.write scope/.test(String(data.reply))) {
      const bubble = turn.querySelector('.bubble');
      bubble?.append(
        el('button', {
          class: 'scope-switch',
          type: 'button',
          text: 'Switch to Maya Chen — owner',
          onclick: async () => {
            els.token.value = 'maya-owner-demo-token';
            els.tokenInput.hidden = true;
            await adoptToken('maya-owner-demo-token');
            toast('Now signed in as Maya Chen — owner. Ask again.');
          },
        }),
      );
    }
    if (assessment) renderAssessmentPanel(assessment);
    speak(data.reply);
    await refreshState();
  } catch (error) {
    thinking.remove();
    appendTurn('assistant', 'I could not reach the Vetwise service. Try again in a moment.');
    toast('Network error — is the server running?');
  } finally {
    ui.busy = false;
    els.send.disabled = false;
    els.orb.classList.remove('thinking');
  }
}

/* ----------------------------------------------------------------- wiring */

els.suggestions.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-say]');
  if (!button) return;
  send(button.dataset.say);
});

els.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  send(els.input.value);
});

els.mute.addEventListener('click', () => {
  ui.voice = !ui.voice;
  localStorage.setItem('vetwise-voice', ui.voice ? 'on' : 'off');
  applyVoice();
  if (ui.voice) toast('Spoken replies on.');
});

const DEMO_TOKENS = new Set(['maya-owner-demo-token', 'noah-sitter-demo-token']);

/** Apply a bearer token, persist it for the next visit, and reload the identity. */
async function adoptToken(token) {
  const value = String(token ?? '').trim();
  if (!value) return;
  ui.token = value;
  localStorage.setItem('vetwise-token', value);
  await loadIdentity({ reset: true });
  await refreshState();
}

els.token.addEventListener('change', async () => {
  if (els.token.value === '__custom') {
    els.tokenInput.hidden = false;
    els.tokenInput.value = DEMO_TOKENS.has(ui.token) ? '' : ui.token;
    els.tokenInput.focus();
    return;
  }
  els.tokenInput.hidden = true;
  await adoptToken(els.token.value);
});

els.tokenInput.addEventListener('change', async () => {
  const value = els.tokenInput.value.trim();
  if (!value) {
    // Cancelled: fall back to the demo identity that was in use.
    els.tokenInput.hidden = true;
    els.token.value = DEMO_TOKENS.has(ui.token) ? ui.token : 'maya-owner-demo-token';
    return;
  }
  await adoptToken(value);
});

els.tokenInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    els.tokenInput.blur();
  }
  if (event.key === 'Escape') {
    els.tokenInput.hidden = true;
    els.token.value = DEMO_TOKENS.has(ui.token) ? ui.token : 'maya-owner-demo-token';
  }
});

/**
 * Initializes identity, voice controls, and state, then starts a one-second reset
 * countdown refresh and a 20-second state poll while idle. Initialization errors
 * propagate, preventing the polling timers from being installed.
 */
async function boot() {
  if (DEMO_TOKENS.has(ui.token)) {
    els.token.value = ui.token;
  } else {
    // A token generated outside demo mode: keep it, and expose it in the input
    // so it can be replaced without clearing storage by hand.
    els.token.value = '__custom';
    els.tokenInput.hidden = false;
    els.tokenInput.value = ui.token;
  }
  applyVoice();
  setupRecognition();
  await loadIdentity({ reset: true });
  await refreshState();
  setInterval(() => renderDemoReset(latestDemoReset), 1_000);
  setInterval(() => {
    if (!ui.busy) void refreshState();
  }, 20_000);
}

void boot();
