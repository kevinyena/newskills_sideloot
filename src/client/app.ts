import type {
  SerializedSection,
  SerializedSkill,
  Business,
  VideoScript,
  Language,
  AspectRatio,
} from '../types.js';

// ---------- DOM helpers ----------
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} introuvable`);
  return el as T;
}

const els = {
  sectionsNav: $('sectionsNav'),
  skillsFlow: $('skillsFlow'),
  sectionTitle: $('sectionTitle'),
  sectionDesc: $('sectionDesc'),
  lang: $<HTMLSelectElement>('lang'),
  aspect: $<HTMLSelectElement>('aspect'),
  biz: $<HTMLSelectElement>('biz'),
  randomBtn: $<HTMLButtonElement>('randomBtn'),
  genVideoBtn: $<HTMLButtonElement>('genVideoBtn'),
  ideaCard: $('ideaCard'),
  videoCard: $('videoCard'),
  errorBox: $('errorBox'),
  bizName: $('bizName'),
  bizType: $('bizType'),
  bizPitch: $('bizPitch'),
  bizTarget: $('bizTarget'),
  vHook: $('vHook'),
  vConcept: $('vConcept'),
  vSpoken: $('vSpoken'),
  vPrompt: $('vPrompt'),
  videoStatus: $('videoStatus'),
  statusText: $('statusText'),
  elapsed: $('elapsed'),
  videoPlayer: $<HTMLVideoElement>('videoPlayer'),
  videoActions: $('videoActions'),
  downloadBtn: $<HTMLAnchorElement>('downloadBtn'),
  audioHint: $('audioHint'),
  promptModal: $('promptModal'),
  modalKicker: $('modalKicker'),
  modalTitle: $('modalTitle'),
  modalDesc: $('modalDesc'),
  modalPrompt: $('modalPrompt'),
  modalMeta: $('modalMeta'),
};

const LANG_NAMES: Record<Language, string> = {
  fr: 'français', en: 'anglais', es: 'espagnol',
  de: 'allemand', it: 'italien', pt: 'portugais',
};

const BUSINESS_TYPES = [
  'agence', 'SaaS', 'newsletter', 'infoproduct',
  'app mobile', 'marketplace', 'coaching', 'communauté payante',
];

// ---------- State ----------
let SECTIONS: SerializedSection[] = [];
let ACTIVE_SECTION = '';
let currentBusiness: Business | null = null;
let currentVideo: VideoScript | null = null;
let currentVeoPrompt: string | null = null;
let pollTimer: number | null = null;
let startedAt = 0;

// ---------- API client ----------
async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function runSkill<TInput, TOutput>(name: string, input: TInput): Promise<TOutput> {
  setSkillStatus(name, 'running');
  try {
    const data = await apiPost<{ output: TOutput }>(`/api/skills/${name}/run`, input);
    setSkillStatus(name, 'done');
    return data.output;
  } catch (e) {
    setSkillStatus(name, 'failed');
    throw e;
  }
}

// ---------- Init ----------
async function init() {
  SECTIONS = await apiGet<SerializedSection[]>('/api/skills');
  // Default to the first section (sections are pre-sorted by `order` server-side).
  if (SECTIONS.length === 0) {
    showError('Aucune skill enregistrée.');
    return;
  }
  ACTIVE_SECTION = SECTIONS[0]!.id;
  renderSidebar();
  selectSection(ACTIVE_SECTION);
}

function renderSidebar() {
  els.sectionsNav.innerHTML = '';
  for (const section of SECTIONS) {
    const btn = document.createElement('button');
    btn.className = 'skill-item' + (section.id === ACTIVE_SECTION ? ' active' : '');
    btn.dataset.section = section.id;
    btn.innerHTML = `<span class="skill-icon">${section.icon}</span><span class="skill-label">${section.name}</span>`;
    btn.addEventListener('click', () => selectSection(section.id));
    els.sectionsNav.appendChild(btn);
  }
}

function selectSection(id: string) {
  ACTIVE_SECTION = id;
  document.querySelectorAll<HTMLElement>('.skill-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.section === id),
  );
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) return;
  els.sectionTitle.textContent = section.name;
  els.sectionDesc.textContent = `Pipeline de ${section.skills.length} skills. Clique sur une chip pour voir son prompt.`;
  renderSkillsFlow(section);
}

function renderSkillsFlow(section: SerializedSection) {
  els.skillsFlow.innerHTML = '';
  for (const skill of section.skills) {
    const chip = document.createElement('div');
    chip.className = 'skill-chip';
    chip.dataset.skillId = skill.name;
    chip.innerHTML = `
      <span class="chip-type">${skill.type}</span>
      <div class="chip-head">
        <span class="chip-order">${skill.order}</span>
        <span>${skill.displayName}</span>
        <span class="chip-status">idle</span>
      </div>
      <div class="chip-desc">${skill.description}</div>
    `;
    chip.addEventListener('click', () => openPromptModal(skill));
    els.skillsFlow.appendChild(chip);
  }
}

// ---------- Modal ----------
function openPromptModal(skill: SerializedSkill) {
  els.modalKicker.textContent = `${skill.category} · ${skill.name}`;
  els.modalTitle.textContent = skill.displayName;
  els.modalDesc.textContent = skill.description;

  els.modalMeta.innerHTML = '';
  const addTag = (label: string) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = label;
    els.modalMeta.appendChild(tag);
  };
  addTag(`type: ${skill.type}`);
  if (skill.model) addTag(`model: ${skill.model}`);
  if (skill.endpoint) addTag(`endpoint: ${skill.endpoint}`);
  addTag(`order: ${skill.order}`);
  addTag(`category: ${skill.category}`);

  const inputs = describeSchema(skill.inputSchema);
  if (inputs.length) addTag(`inputs: ${inputs.join(', ')}`);

  els.modalPrompt.textContent =
    skill.prompt ??
    `(Cette skill est de type "api" et n'utilise pas de prompt LLM — elle appelle directement ${skill.endpoint ?? "l'API distante"}.)`;

  els.promptModal.classList.remove('hidden');
}

function describeSchema(schema: unknown): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as { properties?: Record<string, unknown> };
  return Object.keys(s.properties ?? {});
}

function closeModal() {
  els.promptModal.classList.add('hidden');
}

document.querySelectorAll<HTMLElement>('[data-close]').forEach((el) =>
  el.addEventListener('click', closeModal),
);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());

// ---------- Skill state UI ----------
type SkillStatus = 'idle' | 'running' | 'done' | 'failed';

function setSkillStatus(skillName: string, status: SkillStatus) {
  const chip = document.querySelector<HTMLElement>(`.skill-chip[data-skill-id="${skillName}"]`);
  if (!chip) return;
  chip.classList.remove('running', 'done', 'failed');
  if (status !== 'idle') chip.classList.add(status);
  const lbl = chip.querySelector('.chip-status');
  if (lbl) lbl.textContent = status;
}

function resetSkillsStatus() {
  document.querySelectorAll<HTMLElement>('.skill-chip').forEach((chip) => {
    chip.classList.remove('running', 'done', 'failed');
    const lbl = chip.querySelector('.chip-status');
    if (lbl) lbl.textContent = 'idle';
  });
}

// ---------- Error / video reset ----------
function showError(msg: string) {
  els.errorBox.textContent = msg;
  els.errorBox.classList.remove('hidden');
}

function clearError() {
  els.errorBox.classList.add('hidden');
  els.errorBox.textContent = '';
}

function resetVideoCard() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  els.videoCard.classList.add('hidden');
  els.videoPlayer.classList.add('hidden');
  els.videoPlayer.removeAttribute('src');
  els.videoActions.classList.add('hidden');
  els.audioHint.classList.add('hidden');
  els.videoStatus.classList.remove('hidden');
}

// ---------- Pipeline: idea ----------
async function generateIdea() {
  clearError();
  resetVideoCard();
  resetSkillsStatus();
  currentBusiness = null;
  currentVideo = null;
  currentVeoPrompt = null;
  els.ideaCard.classList.add('hidden');
  els.genVideoBtn.disabled = true;
  els.randomBtn.disabled = true;
  const original = els.randomBtn.textContent;
  els.randomBtn.textContent = '⏳ Génération…';

  try {
    const language = els.lang.value as Language;
    const languageName = LANG_NAMES[language];
    const businessType =
      els.biz.value || BUSINESS_TYPES[Math.floor(Math.random() * BUSINESS_TYPES.length)]!;

    // Skill 1
    currentBusiness = await runSkill<{ businessType: string; languageName: string }, Business>(
      'create_business_idea',
      { businessType, languageName },
    );

    // Skill 2
    currentVideo = await runSkill<
      { business: Business; languageName: string },
      VideoScript
    >('generate_video_script', { business: currentBusiness, languageName });

    // Skill 3
    const adapted = await runSkill<
      { business: Business; video: VideoScript; languageName: string },
      { veoPrompt: string }
    >('adapt_to_veo_prompt', {
      business: currentBusiness,
      video: currentVideo,
      languageName,
    });
    currentVeoPrompt = adapted.veoPrompt;

    // Render
    els.bizName.textContent = currentBusiness?.name ?? '—';
    els.bizType.textContent = currentBusiness?.type ?? '';
    els.bizPitch.textContent = currentBusiness?.pitch ?? '';
    els.bizTarget.textContent = currentBusiness?.target ?? '';
    els.vHook.textContent = currentVideo?.hook ?? '';
    els.vConcept.textContent = currentVideo?.concept ?? '';
    els.vSpoken.textContent = currentVideo?.spokenLine ? `« ${currentVideo.spokenLine} »` : '';
    els.vPrompt.textContent = currentVeoPrompt ?? '';
    els.ideaCard.classList.remove('hidden');
    els.genVideoBtn.disabled = false;
  } catch (e) {
    showError((e as Error).message);
  } finally {
    els.randomBtn.disabled = false;
    els.randomBtn.textContent = original;
  }
}

// ---------- Pipeline: video ----------
async function generateVideo() {
  if (!currentVeoPrompt) return;
  clearError();
  resetVideoCard();
  els.videoCard.classList.remove('hidden');
  els.genVideoBtn.disabled = true;
  startedAt = Date.now();

  try {
    setSkillStatus('generate_veo_video', 'running');
    const aspectRatio = els.aspect.value as AspectRatio;
    const { operationName } = await apiPost<{ operationName: string }>('/api/veo/start', {
      prompt: currentVeoPrompt,
      aspectRatio,
    });
    pollOperation(operationName);
  } catch (e) {
    setSkillStatus('generate_veo_video', 'failed');
    showError((e as Error).message);
    els.videoCard.classList.add('hidden');
    els.genVideoBtn.disabled = false;
  }
}

interface VeoStatus {
  done: boolean;
  videoUri: string | null;
  raw?: unknown;
}

function pollOperation(name: string) {
  const tick = async () => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    els.elapsed.textContent = `(${elapsed}s)`;
    els.statusText.textContent =
      elapsed < 30 ? 'Génération en cours…'
      : elapsed < 90 ? 'Rendu vidéo… (1-3 min)'
      : 'Finalisation…';

    try {
      const data = await apiGet<VeoStatus>(`/api/veo/status?name=${encodeURIComponent(name)}`);
      if (data.done) {
        if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
        if (!data.videoUri) {
          setSkillStatus('generate_veo_video', 'failed');
          showError('Opération terminée mais aucune vidéo retournée.\n' + JSON.stringify(data.raw ?? {}, null, 2));
          els.videoCard.classList.add('hidden');
        } else {
          setSkillStatus('generate_veo_video', 'done');
          const proxied = `/api/veo/proxy?uri=${encodeURIComponent(data.videoUri)}`;
          els.videoStatus.classList.add('hidden');
          els.videoPlayer.muted = false;
          els.videoPlayer.volume = 1;
          els.videoPlayer.src = proxied;
          els.videoPlayer.classList.remove('hidden');
          els.audioHint.classList.remove('hidden');
          els.downloadBtn.href = proxied;
          els.videoActions.classList.remove('hidden');
        }
        els.genVideoBtn.disabled = false;
      }
    } catch (e) {
      if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
      setSkillStatus('generate_veo_video', 'failed');
      showError((e as Error).message);
      els.genVideoBtn.disabled = false;
    }
  };
  tick();
  pollTimer = window.setInterval(tick, 10000);
}

els.randomBtn.addEventListener('click', generateIdea);
els.genVideoBtn.addEventListener('click', generateVideo);

init().catch((e) => showError((e as Error).message));
