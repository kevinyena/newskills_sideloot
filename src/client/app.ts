import { marked } from 'marked';
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

const LANG_NAMES: Record<Language, string> = {
  fr: 'français', en: 'anglais', es: 'espagnol',
  de: 'allemand', it: 'italien', pt: 'portugais',
};

const BUSINESS_TYPES = [
  'agence', 'SaaS', 'newsletter', 'infoproduct',
  'app mobile', 'marketplace', 'coaching', 'communauté payante',
];

/**
 * Topics rotated client-side when "Random" is selected on the newsletter panel.
 * Opus 4.7 has no temperature knob, so randomization at the input layer is the
 * most reliable way to get variety in topics across consecutive clicks.
 */
const RANDOM_NEWSLETTER_TOPICS = [
  // Foot
  'PSG', 'Real Madrid', 'FC Barcelone', 'Manchester United', 'Liverpool FC',
  'Arsenal FC', 'Bayern Munich', 'Olympique de Marseille', 'OL', 'Champions League',
  'Ligue 1', 'Premier League', 'Liga', 'Serie A', 'Bundesliga', 'mercato foot',
  // Autres sports
  'Formule 1', 'MotoGP', 'NBA', 'NBA Draft', 'NFL', 'MLB', 'UFC', 'boxe',
  'tennis ATP', 'tennis WTA', 'Roland-Garros', 'cyclisme', 'Tour de France',
  'rugby XV de France', 'rugby Top 14', 'F1 Academy', 'World Rallye Championship',
  // Tech
  'AI / Machine Learning', 'LLMs et agents IA', 'crypto', 'Bitcoin',
  'Ethereum', 'NFT et art numérique', 'hardware Apple', 'écosystème Android',
  'SaaS B2B', 'fintech', 'robotique', 'open source', 'cybersécurité',
  'voitures électriques', 'Tesla', 'startups françaises',
  // Culture
  'cinéma indé', 'cinéma français', 'séries Netflix', 'séries HBO',
  'rap FR', 'K-pop', 'anime japonais', 'gaming AAA', 'gaming indé',
  'retrogaming', 'esports League of Legends', 'esports CS2', 'Twitch streaming',
  'BD franco-belge', 'manga seinen',
  // Business
  'VC et startups', 'levées de fonds', 'M&A français', 'immobilier parisien',
  'marchés financiers', 'side hustles', 'creator economy', 'newsletters payantes',
  // Lifestyle / autres
  'gastronomie étoilée', 'café spécialité', 'vins naturels', 'vélo gravel',
  'running ultra-trail', 'hiking et bivouac', 'géopolitique', 'climat',
  'urbanisme et architecture', 'IA et éthique', 'philosophie contemporaine',
];

function pickRandom<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// ---------- Global elements ----------
const els = {
  sectionsNav: $('sectionsNav'),
  skillsFlow: $('skillsFlow'),
  sectionTitle: $('sectionTitle'),
  sectionDesc: $('sectionDesc'),
  errorBox: $('errorBox'),
  // modal
  promptModal: $('promptModal'),
  modalKicker: $('modalKicker'),
  modalTitle: $('modalTitle'),
  modalDesc: $('modalDesc'),
  modalPrompt: $('modalPrompt'),
  modalMeta: $('modalMeta'),
  // ugc panel
  ugcLang: $<HTMLSelectElement>('ugcLang'),
  ugcAspect: $<HTMLSelectElement>('ugcAspect'),
  ugcBiz: $<HTMLSelectElement>('ugcBiz'),
  ugcRandomBtn: $<HTMLButtonElement>('ugcRandomBtn'),
  ugcGenVideoBtn: $<HTMLButtonElement>('ugcGenVideoBtn'),
  ugcIdeaCard: $('ugcIdeaCard'),
  ugcVideoCard: $('ugcVideoCard'),
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
  // newsletter panel
  nlLang: $<HTMLSelectElement>('nlLang'),
  nlTopic: $<HTMLSelectElement>('nlTopic'),
  nlRandomBtn: $<HTMLButtonElement>('nlRandomBtn'),
  nlGenBtn: $<HTMLButtonElement>('nlGenBtn'),
  nlConceptCard: $('nlConceptCard'),
  nlEditionCard: $('nlEditionCard'),
  nlName: $('nlName'),
  nlTopicTag: $('nlTopicTag'),
  nlFreqTag: $('nlFreqTag'),
  nlAudience: $('nlAudience'),
  nlAngle: $('nlAngle'),
  nlGenStatus: $('nlGenStatus'),
  nlStatusText: $('nlStatusText'),
  nlElapsed: $('nlElapsed'),
  nlEdition: $('nlEdition'),
};

// ---------- State ----------
let SECTIONS: SerializedSection[] = [];
let ACTIVE_SECTION = '';

// UGC state
let currentBusiness: Business | null = null;
let currentVideo: VideoScript | null = null;
let currentVeoPrompt: string | null = null;
let pollTimer: number | null = null;
let videoStartedAt = 0;

// Newsletter state
interface NewsletterConcept {
  topic: string;
  name: string;
  audience: string;
  angle: string;
  frequency: string;
}
interface NewsletterSection {
  heading: string;
  body: string;
  sources?: string[];
}
interface NewsletterEdition {
  title: string;
  subject: string;
  intro: string;
  sections: NewsletterSection[];
  outro: string;
  publishedAt: string;
}
let currentConcept: NewsletterConcept | null = null;
let nlElapsedTimer: number | null = null;

// ---------- API ----------
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
  // Toggle visibility of panels by data-panel match
  document.querySelectorAll<HTMLElement>('.skill-panel').forEach((p) => {
    p.classList.toggle('hidden', p.dataset.panel !== id);
  });

  const section = SECTIONS.find((s) => s.id === id);
  if (!section) return;
  els.sectionTitle.textContent = section.name;
  els.sectionDesc.textContent = `Pipeline de ${section.skills.length} skills. Clique sur une chip pour voir son prompt.`;
  renderSkillsFlow(section);
  clearError();
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

function closeModal() { els.promptModal.classList.add('hidden'); }
document.querySelectorAll<HTMLElement>('[data-close]').forEach((el) =>
  el.addEventListener('click', closeModal),
);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());

// ---------- Skill chip status ----------
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

// ---------- Error ----------
function showError(msg: string) { els.errorBox.textContent = msg; els.errorBox.classList.remove('hidden'); }
function clearError() { els.errorBox.classList.add('hidden'); els.errorBox.textContent = ''; }

// ---------- UGC pipeline ----------
function resetUgcVideoCard() {
  if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
  els.ugcVideoCard.classList.add('hidden');
  els.videoPlayer.classList.add('hidden');
  els.videoPlayer.removeAttribute('src');
  els.videoActions.classList.add('hidden');
  els.audioHint.classList.add('hidden');
  els.videoStatus.classList.remove('hidden');
}

async function ugcGenerateIdea() {
  clearError();
  resetUgcVideoCard();
  resetSkillsStatus();
  currentBusiness = null;
  currentVideo = null;
  currentVeoPrompt = null;
  els.ugcIdeaCard.classList.add('hidden');
  els.ugcGenVideoBtn.disabled = true;
  els.ugcRandomBtn.disabled = true;
  const original = els.ugcRandomBtn.textContent;
  els.ugcRandomBtn.textContent = '⏳ Génération…';

  try {
    const language = els.ugcLang.value as Language;
    const languageName = LANG_NAMES[language];
    const businessType =
      els.ugcBiz.value || BUSINESS_TYPES[Math.floor(Math.random() * BUSINESS_TYPES.length)]!;

    currentBusiness = await runSkill<{ businessType: string; languageName: string }, Business>(
      'create_business_idea', { businessType, languageName },
    );
    currentVideo = await runSkill<{ business: Business; languageName: string }, VideoScript>(
      'generate_video_script', { business: currentBusiness, languageName },
    );
    const adapted = await runSkill<
      { business: Business; video: VideoScript; languageName: string },
      { veoPrompt: string }
    >('adapt_to_veo_prompt', { business: currentBusiness, video: currentVideo, languageName });
    currentVeoPrompt = adapted.veoPrompt;

    els.bizName.textContent = currentBusiness.name;
    els.bizType.textContent = currentBusiness.type;
    els.bizPitch.textContent = currentBusiness.pitch;
    els.bizTarget.textContent = currentBusiness.target;
    els.vHook.textContent = currentVideo.hook;
    els.vConcept.textContent = currentVideo.concept;
    els.vSpoken.textContent = `« ${currentVideo.spokenLine} »`;
    els.vPrompt.textContent = currentVeoPrompt;
    els.ugcIdeaCard.classList.remove('hidden');
    els.ugcGenVideoBtn.disabled = false;
  } catch (e) {
    showError((e as Error).message);
  } finally {
    els.ugcRandomBtn.disabled = false;
    els.ugcRandomBtn.textContent = original;
  }
}

async function ugcGenerateVideo() {
  if (!currentVeoPrompt) return;
  clearError();
  resetUgcVideoCard();
  els.ugcVideoCard.classList.remove('hidden');
  els.ugcGenVideoBtn.disabled = true;
  videoStartedAt = Date.now();

  try {
    setSkillStatus('generate_veo_video', 'running');
    const aspectRatio = els.ugcAspect.value as AspectRatio;
    const { operationName } = await apiPost<{ operationName: string }>('/api/veo/start', {
      prompt: currentVeoPrompt, aspectRatio,
    });
    pollVeoOperation(operationName);
  } catch (e) {
    setSkillStatus('generate_veo_video', 'failed');
    showError((e as Error).message);
    els.ugcVideoCard.classList.add('hidden');
    els.ugcGenVideoBtn.disabled = false;
  }
}

interface VeoStatus { done: boolean; videoUri: string | null; raw?: unknown }
function pollVeoOperation(name: string) {
  const tick = async () => {
    const elapsed = Math.floor((Date.now() - videoStartedAt) / 1000);
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
          els.ugcVideoCard.classList.add('hidden');
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
        els.ugcGenVideoBtn.disabled = false;
      }
    } catch (e) {
      if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
      setSkillStatus('generate_veo_video', 'failed');
      showError((e as Error).message);
      els.ugcGenVideoBtn.disabled = false;
    }
  };
  tick();
  pollTimer = window.setInterval(tick, 10000);
}

// ---------- Newsletter pipeline ----------
function resetNewsletterEditionCard() {
  if (nlElapsedTimer !== null) { clearInterval(nlElapsedTimer); nlElapsedTimer = null; }
  els.nlEditionCard.classList.add('hidden');
  els.nlEdition.classList.add('hidden');
  els.nlEdition.innerHTML = '';
  els.nlGenStatus.classList.remove('hidden');
}

async function newsletterPickTopic() {
  clearError();
  resetNewsletterEditionCard();
  resetSkillsStatus();
  currentConcept = null;
  els.nlConceptCard.classList.add('hidden');
  els.nlGenBtn.disabled = true;
  els.nlRandomBtn.disabled = true;
  const original = els.nlRandomBtn.textContent;
  els.nlRandomBtn.textContent = '⏳ Génération…';

  try {
    const language = els.nlLang.value as Language;
    const languageName = LANG_NAMES[language];
    // When the user picks "Random", rotate client-side across a big list.
    // Opus 4.7 (no temperature) tends to converge on the same answer if we
    // ask the LLM to pick at random — feeding it a concrete topic each time
    // is the most reliable way to get variety.
    const topicValue = els.nlTopic.value || pickRandom(RANDOM_NEWSLETTER_TOPICS);

    currentConcept = await runSkill<
      { topic: string; languageName: string },
      NewsletterConcept
    >('pick_newsletter_topic', { topic: topicValue, languageName });

    els.nlName.textContent = currentConcept.name;
    els.nlTopicTag.textContent = currentConcept.topic;
    els.nlFreqTag.textContent = currentConcept.frequency;
    els.nlAudience.textContent = currentConcept.audience;
    els.nlAngle.textContent = currentConcept.angle;
    els.nlConceptCard.classList.remove('hidden');
    els.nlGenBtn.disabled = false;
  } catch (e) {
    showError((e as Error).message);
  } finally {
    els.nlRandomBtn.disabled = false;
    els.nlRandomBtn.textContent = original;
  }
}

async function newsletterGenerateEdition() {
  if (!currentConcept) return;
  clearError();
  resetNewsletterEditionCard();
  els.nlEditionCard.classList.remove('hidden');
  els.nlGenBtn.disabled = true;
  const startedAt = Date.now();

  // Live elapsed counter
  nlElapsedTimer = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    els.nlElapsed.textContent = `(${elapsed}s)`;
    els.nlStatusText.textContent =
      elapsed < 15 ? 'Recherche web…'
      : elapsed < 45 ? 'Synthèse des sources…'
      : elapsed < 90 ? 'Rédaction de l\'édition…'
      : 'Finalisation…';
  }, 1000);

  try {
    setSkillStatus('generate_newsletter', 'running');
    const language = els.nlLang.value as Language;
    const languageName = LANG_NAMES[language];
    const edition = await runSkill<
      { concept: NewsletterConcept; languageName: string },
      NewsletterEdition
    >('generate_newsletter', { concept: currentConcept, languageName });
    setSkillStatus('generate_newsletter', 'done');
    renderNewsletter(edition);
  } catch (e) {
    setSkillStatus('generate_newsletter', 'failed');
    showError((e as Error).message);
  } finally {
    if (nlElapsedTimer !== null) { clearInterval(nlElapsedTimer); nlElapsedTimer = null; }
    els.nlGenStatus.classList.add('hidden');
    els.nlGenBtn.disabled = false;
  }
}

function renderNewsletter(edition: NewsletterEdition) {
  if (!currentConcept) return;
  const sectionsHtml = edition.sections
    .map((sec) => {
      const sourcesHtml = sec.sources?.length
        ? `<div class="nl-sources"><strong>Sources :</strong> ${sec.sources
            .map((u) => `<a href="${escapeAttr(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u)}</a>`)
            .join(' · ')}</div>`
        : '';
      return `
        <section class="nl-section">
          <h2>${escapeHtml(sec.heading)}</h2>
          ${marked.parse(sec.body)}
          ${sourcesHtml}
        </section>
      `;
    })
    .join('');

  const published = formatDate(edition.publishedAt);
  els.nlEdition.innerHTML = `
    <div class="nl-subject">📨 ${escapeHtml(edition.subject)}</div>
    <h1 class="nl-title">${escapeHtml(edition.title)}</h1>
    <div class="nl-meta">${escapeHtml(currentConcept.name)} · ${escapeHtml(currentConcept.frequency)} · ${published}</div>
    <div class="nl-intro">${marked.parse(edition.intro)}</div>
    ${sectionsHtml}
    <div class="nl-outro">${marked.parse(edition.outro)}</div>
  `;
  els.nlEdition.classList.remove('hidden');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
function formatDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); }
  catch { return iso; }
}

// ---------- Wiring ----------
els.ugcRandomBtn.addEventListener('click', ugcGenerateIdea);
els.ugcGenVideoBtn.addEventListener('click', ugcGenerateVideo);
els.nlRandomBtn.addEventListener('click', newsletterPickTopic);
els.nlGenBtn.addEventListener('click', newsletterGenerateEdition);

init().catch((e) => showError((e as Error).message));
