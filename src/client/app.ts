import type {
  Section,
  Skill,
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

// ---------- State ----------
let REGISTRY: Section[] = [];
let ACTIVE_SECTION = 'ai-ugc';
let currentBusiness: Business | null = null;
let currentVideo: VideoScript | null = null;
let currentVeoPrompt: string | null = null;
let pollTimer: number | null = null;
let startedAt = 0;

// ---------- API client ----------
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function runSkill<T>(sectionId: string, skillId: string, body: unknown): Promise<T> {
  setSkillStatus(skillId, 'running');
  try {
    const data = await api<T>(`/api/skills/${sectionId}/${skillId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setSkillStatus(skillId, 'done');
    return data;
  } catch (e) {
    setSkillStatus(skillId, 'failed');
    throw e;
  }
}

// ---------- Init ----------
async function init() {
  REGISTRY = await api<Section[]>('/api/skills');
  renderSidebar();
  selectSection(ACTIVE_SECTION);
}

function renderSidebar() {
  els.sectionsNav.innerHTML = '';
  for (const section of REGISTRY) {
    const btn = document.createElement('button');
    btn.className = 'skill-item' + (section.id === ACTIVE_SECTION ? ' active' : '');
    btn.dataset.section = section.id;
    btn.innerHTML = `<span class="skill-icon">${section.icon ?? '✨'}</span><span class="skill-label">${section.name}</span>`;
    btn.addEventListener('click', () => selectSection(section.id));
    els.sectionsNav.appendChild(btn);
  }
}

function selectSection(id: string) {
  ACTIVE_SECTION = id;
  document.querySelectorAll<HTMLElement>('.skill-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.section === id),
  );
  const section = REGISTRY.find((s) => s.id === id);
  if (!section) return;
  els.sectionTitle.textContent = section.name;
  els.sectionDesc.textContent = section.description ?? '';
  renderSkillsFlow(section);
}

function renderSkillsFlow(section: Section) {
  els.skillsFlow.innerHTML = '';
  for (const skill of section.skills) {
    const chip = document.createElement('div');
    chip.className = 'skill-chip';
    chip.dataset.skillId = skill.id;
    chip.innerHTML = `
      <span class="chip-type">${skill.type}</span>
      <div class="chip-head">
        <span class="chip-order">${skill.order ?? ''}</span>
        <span>${skill.name}</span>
        <span class="chip-status">idle</span>
      </div>
      <div class="chip-desc">${skill.description ?? ''}</div>
    `;
    chip.addEventListener('click', () => openPromptModal(section, skill));
    els.skillsFlow.appendChild(chip);
  }
}

// ---------- Modal ----------
function openPromptModal(section: Section, skill: Skill) {
  els.modalKicker.textContent = `${section.name} · Skill ${skill.order ?? ''}`;
  els.modalTitle.textContent = skill.name;
  els.modalDesc.textContent = skill.description ?? '';

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
  if (skill.inputs) addTag(`inputs: ${skill.inputs.join(', ')}`);
  if (skill.outputs) addTag(`outputs: ${skill.outputs.join(', ')}`);

  els.modalPrompt.textContent = skill.prompt
    ?? `(Cette skill est de type "api" et n'utilise pas de prompt LLM — elle appelle directement l'API ${skill.endpoint ?? ''}.)`;

  els.promptModal.classList.remove('hidden');
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

function setSkillStatus(skillId: string, status: SkillStatus) {
  const chip = document.querySelector<HTMLElement>(`.skill-chip[data-skill-id="${skillId}"]`);
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
    const businessType = els.biz.value || undefined;

    const s1 = await runSkill<{ business: Business }>(
      'ai-ugc', 'create-business-idea',
      { language, businessType },
    );
    currentBusiness = s1.business;

    const s2 = await runSkill<{ video: VideoScript }>(
      'ai-ugc', 'generate-video-script',
      { business: currentBusiness, language },
    );
    currentVideo = s2.video;

    const s3 = await runSkill<{ veoPrompt: string }>(
      'ai-ugc', 'adapt-to-veo-prompt',
      { business: currentBusiness, video: currentVideo, language },
    );
    currentVeoPrompt = s3.veoPrompt;

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
    const aspectRatio = els.aspect.value as AspectRatio;
    const out = await runSkill<{ operationName: string }>(
      'ai-ugc', 'generate-video',
      { veoPrompt: currentVeoPrompt, aspectRatio },
    );
    pollOperation(out.operationName);
  } catch (e) {
    showError((e as Error).message);
    els.videoCard.classList.add('hidden');
    els.genVideoBtn.disabled = false;
  }
}

interface VideoStatus {
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
      const data = await api<VideoStatus>(`/api/video-status?name=${encodeURIComponent(name)}`);
      if (data.done) {
        if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
        if (!data.videoUri) {
          showError('Opération terminée mais aucune vidéo retournée.\n' + JSON.stringify(data.raw ?? {}, null, 2));
          els.videoCard.classList.add('hidden');
        } else {
          const proxied = `/api/video-proxy?uri=${encodeURIComponent(data.videoUri)}`;
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
