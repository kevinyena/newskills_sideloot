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
 * 100 newsletter topics with strong audience potential — passionate niches,
 * proven readership, broad enough for Claude to find a fresh angle each call.
 *
 * Rationale: Opus 4.7 has no `temperature` knob, so randomization at the input
 * layer is the most reliable lever for variety. When the user picks "Random",
 * the client rolls one of these 100 and ships it to `pick_newsletter_topic`,
 * which then runs its seed-driven facet-rotation prompt to vary the angle.
 */
const RANDOM_NEWSLETTER_TOPICS = [
  // ----- Foot — clubs (16) -----
  'PSG',
  'Real Madrid',
  'FC Barcelone',
  'Manchester United',
  'Liverpool FC',
  'Arsenal FC',
  'Chelsea FC',
  'Manchester City',
  'Bayern Munich',
  'Borussia Dortmund',
  'Juventus',
  'AC Milan',
  'Inter Milan',
  'Olympique de Marseille',
  'Olympique Lyonnais',
  'AS Monaco',
  // ----- Foot — compétitions & thèmes (8) -----
  'Champions League',
  'Premier League',
  'Liga',
  'Serie A',
  'Bundesliga',
  'Ligue 1',
  'mercato foot',
  'Equipe de France',
  // ----- Motorsport (5) -----
  'Formule 1',
  'F1 Academy',
  'MotoGP',
  '24 Heures du Mans / endurance',
  'Rallye WRC',
  // ----- Cyclisme & endurance (3) -----
  'Tour de France / cyclisme pro',
  'Triathlon longue distance',
  'Ultra-trail (UTMB)',
  // ----- Sports US (5) -----
  'NBA',
  'NBA Draft prospects',
  'NFL',
  'MLB',
  'NHL',
  // ----- Tennis & raquette (3) -----
  'tennis ATP',
  'tennis WTA',
  'padel',
  // ----- Combat (3) -----
  'UFC / MMA',
  'boxe pro',
  'jiu-jitsu brésilien',
  // ----- Rugby (2) -----
  'rugby Top 14',
  'rugby XV de France',
  // ----- Esports (3) -----
  'esports League of Legends',
  'esports Counter-Strike 2',
  'esports Valorant',
  // ----- Tech — IA & dev (5) -----
  'AI / LLMs et agents IA',
  'open source — projets émergents',
  'robotique humanoïde',
  'computer vision',
  'quantum computing',
  // ----- Tech — crypto (3) -----
  'Bitcoin et macro crypto',
  'Ethereum et DeFi',
  'NFT et art numérique',
  // ----- Tech — produits (5) -----
  'hardware Apple',
  'écosystème Android (Pixel, Galaxy)',
  'voitures électriques / Tesla',
  'drones civils',
  'wearables / santé connectée',
  // ----- Tech — infra & sécurité (3) -----
  'cybersécurité offensive',
  'cloud / DevOps',
  'SaaS B2B',
  // ----- Tech — émergent (2) -----
  'biotech / longévité',
  'climatech / cleantech',
  // ----- Culture — image (5) -----
  'cinéma indé (Cannes, Sundance)',
  'cinéma français',
  'séries Netflix',
  'séries HBO / prestige',
  'documentaires',
  // ----- Culture — Japon (2) -----
  'anime japonais',
  'manga seinen',
  // ----- Culture — BD (2) -----
  'BD franco-belge contemporaine',
  'comics US (Marvel, DC, indé)',
  // ----- Musique (5) -----
  'rap FR',
  'hip-hop US',
  'K-pop',
  'musique électronique / clubs',
  'jazz contemporain',
  // ----- Gaming (3) -----
  'gaming AAA — sorties',
  'gaming indé (Steam Next Fest)',
  'retrogaming',
  // ----- Business — VC & finance (5) -----
  'VC / startups françaises',
  'VC US — early stage',
  'marchés financiers / actions',
  'M&A / Private Equity',
  'immobilier (Paris, Lyon)',
  // ----- Business — solopreneurs (3) -----
  'side hustles / freelance',
  'creator economy',
  'personal finance / FIRE',
  // ----- Lifestyle — food (4) -----
  'gastronomie étoilée',
  'café spécialité',
  'vins naturels',
  'whisky / spiritueux',
  // ----- Lifestyle — outdoor (3) -----
  'vélo gravel',
  'surf / mer',
  'ski / freeride',
  // ----- Société (2) -----
  'géopolitique',
  'climat',
];
// sanity check: should be exactly 100 items
// (kept inline so it's obvious when editing the list)
if (RANDOM_NEWSLETTER_TOPICS.length !== 100) {
  console.warn(`RANDOM_NEWSLETTER_TOPICS has ${RANDOM_NEWSLETTER_TOPICS.length} items, expected 100`);
}

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
  // prospection panel
  prLang: $<HTMLSelectElement>('prLang'),
  prBiz: $<HTMLSelectElement>('prBiz'),
  prRandomBtn: $<HTMLButtonElement>('prRandomBtn'),
  prStrategyBtn: $<HTMLButtonElement>('prStrategyBtn'),
  prBusinessCard: $('prBusinessCard'),
  prStrategyCard: $('prStrategyCard'),
  prName: $('prName'),
  prType: $('prType'),
  prTicket: $('prTicket'),
  prPitch: $('prPitch'),
  prSegment: $('prSegment'),
  prGeo: $('prGeo'),
  prSize: $('prSize'),
  prPain: $('prPain'),
  prStrategyStatus: $('prStrategyStatus'),
  prStatusText: $('prStatusText'),
  prElapsed: $('prElapsed'),
  prStrategy: $('prStrategy'),
  prPrimaryStrategy: $('prPrimaryStrategy'),
  prChannels: $('prChannels'),
  prFirstWeek: $('prFirstWeek'),
  // maps grounding panel
  mgLang: $<HTMLSelectElement>('mgLang'),
  mgCity: $<HTMLSelectElement>('mgCity'),
  mgLimit: $<HTMLSelectElement>('mgLimit'),
  mgRandomBtn: $<HTMLButtonElement>('mgRandomBtn'),
  mgFetchBtn: $<HTMLButtonElement>('mgFetchBtn'),
  mgBusinessCard: $('mgBusinessCard'),
  mgProspectsCard: $('mgProspectsCard'),
  mgName: $('mgName'),
  mgType: $('mgType'),
  mgTicket: $('mgTicket'),
  mgPitch: $('mgPitch'),
  mgSegment: $('mgSegment'),
  mgMapsQuery: $('mgMapsQuery'),
  mgCityTarget: $('mgCityTarget'),
  mgSize: $('mgSize'),
  mgPain: $('mgPain'),
  mgFetchStatus: $('mgFetchStatus'),
  mgStatusText: $('mgStatusText'),
  mgElapsed: $('mgElapsed'),
  mgProspects: $('mgProspects'),
  mgProspectsCount: $('mgProspectsCount'),
  mgGroundedMeta: $('mgGroundedMeta'),
  mgProspectsList: $('mgProspectsList'),
  mgEmailHint: $('mgEmailHint'),
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

// Prospection state
interface ProspectableBusiness {
  name: string;
  type: string;
  pitch: string;
  icp: {
    segment: string;
    geo: string;
    sizeRange: string;
    pain: string;
    estimatedTicket: string;
  };
}
interface ProspectionChannel {
  name: string;
  percentage: number;
  rationale: string;
  tooling?: string;
  icpFit: string;
}
interface ProspectionStrategy {
  primaryStrategy: string;
  channels: ProspectionChannel[];
  firstWeek: string;
}
let currentProspectBusiness: ProspectableBusiness | null = null;
let prElapsedTimer: number | null = null;

// Maps Grounding state
interface LocalBusiness {
  name: string;
  type: string;
  pitch: string;
  icp: {
    segment: string;
    mapsQuery: string;
    city: string;
    sizeRange: string;
    pain: string;
    estimatedTicket: string;
  };
}
interface ProspectSocials {
  instagram?: string[];
  facebook?: string[];
  linkedin?: string[];
  youtube?: string[];
  tiktok?: string[];
  twitter?: string[];
  pinterest?: string[];
}
interface MapsProspect {
  name: string;
  address?: string;
  phone?: string;
  phonesFromWebsite?: string[];
  website?: string;
  emails?: string[];
  socials?: ProspectSocials;
  rating?: number;
  reviewsCount?: number;
  category?: string;
  googleMapsUri?: string;
  placeId?: string;
  summary?: string;
}
interface ApifyStats {
  rawCount: number;
  withWebsite: number;
  withEmails: number;
  target: number;
  done: boolean;
  costUsdEstimate: number;
  costUsdActual?: number;
  actorRunId?: string;
}
interface FetchMapsProspectsOutput {
  prospects: MapsProspect[];
  stats: ApifyStats;
}
let currentLocalBusiness: LocalBusiness | null = null;
let mgElapsedTimer: number | null = null;

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

// ---------- Prospection pipeline ----------
function resetProspectionStrategyCard() {
  if (prElapsedTimer !== null) { clearInterval(prElapsedTimer); prElapsedTimer = null; }
  els.prStrategyCard.classList.add('hidden');
  els.prStrategy.classList.add('hidden');
  els.prStrategyStatus.classList.remove('hidden');
  els.prChannels.innerHTML = '';
}

async function prospectionRandomBusiness() {
  clearError();
  resetProspectionStrategyCard();
  resetSkillsStatus();
  currentProspectBusiness = null;
  els.prBusinessCard.classList.add('hidden');
  els.prStrategyBtn.disabled = true;
  els.prRandomBtn.disabled = true;
  const original = els.prRandomBtn.textContent;
  els.prRandomBtn.textContent = '⏳ Génération…';

  try {
    const language = els.prLang.value as Language;
    const languageName = LANG_NAMES[language];
    const businessType = els.prBiz.value || undefined;

    currentProspectBusiness = await runSkill<
      { businessType?: string; languageName: string },
      ProspectableBusiness
    >('create_prospectable_business', { businessType, languageName });

    els.prName.textContent = currentProspectBusiness.name;
    els.prType.textContent = currentProspectBusiness.type;
    els.prTicket.textContent = currentProspectBusiness.icp.estimatedTicket;
    els.prPitch.textContent = currentProspectBusiness.pitch;
    els.prSegment.textContent = currentProspectBusiness.icp.segment;
    els.prGeo.textContent = currentProspectBusiness.icp.geo;
    els.prSize.textContent = currentProspectBusiness.icp.sizeRange;
    els.prPain.textContent = currentProspectBusiness.icp.pain;
    els.prBusinessCard.classList.remove('hidden');
    els.prStrategyBtn.disabled = false;
  } catch (e) {
    showError((e as Error).message);
  } finally {
    els.prRandomBtn.disabled = false;
    els.prRandomBtn.textContent = original;
  }
}

async function prospectionGenerateStrategy() {
  if (!currentProspectBusiness) return;
  clearError();
  resetProspectionStrategyCard();
  els.prStrategyCard.classList.remove('hidden');
  els.prStrategyBtn.disabled = true;
  const startedAt = Date.now();

  prElapsedTimer = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    els.prElapsed.textContent = `(${elapsed}s)`;
    els.prStatusText.textContent =
      elapsed < 15 ? 'Analyse de l\'ICP…'
      : elapsed < 30 ? 'Arbitrage des canaux…'
      : 'Finalisation…';
  }, 1000);

  try {
    setSkillStatus('choose_prospection', 'running');
    const language = els.prLang.value as Language;
    const languageName = LANG_NAMES[language];
    const strategy = await runSkill<
      { business: ProspectableBusiness; languageName: string },
      ProspectionStrategy
    >('choose_prospection', { business: currentProspectBusiness, languageName });
    setSkillStatus('choose_prospection', 'done');
    renderProspectionStrategy(strategy);
  } catch (e) {
    setSkillStatus('choose_prospection', 'failed');
    showError((e as Error).message);
  } finally {
    if (prElapsedTimer !== null) { clearInterval(prElapsedTimer); prElapsedTimer = null; }
    els.prStrategyStatus.classList.add('hidden');
    els.prStrategyBtn.disabled = false;
  }
}

function renderProspectionStrategy(strategy: ProspectionStrategy) {
  els.prPrimaryStrategy.textContent = strategy.primaryStrategy;
  els.prFirstWeek.textContent = strategy.firstWeek;

  els.prChannels.innerHTML = '';
  for (const channel of strategy.channels) {
    const div = document.createElement('div');
    div.className = 'channel';
    const toolingLine = channel.tooling
      ? `<span><strong>Outils :</strong> ${escapeHtml(channel.tooling)}</span>`
      : '';
    div.innerHTML = `
      <div class="channel-head">
        <span class="channel-name">${escapeHtml(channel.name)}</span>
        <span class="channel-pct">${channel.percentage}%</span>
      </div>
      <div class="channel-bar">
        <div class="channel-bar-fill" style="width: ${Math.max(0, Math.min(100, channel.percentage))}%"></div>
      </div>
      <p class="channel-rationale">${escapeHtml(channel.rationale)}</p>
      <div class="channel-meta">
        <span><strong>ICP fit :</strong> ${escapeHtml(channel.icpFit)}</span>
        ${toolingLine}
      </div>
    `;
    els.prChannels.appendChild(div);
  }
  els.prStrategy.classList.remove('hidden');
}

// ---------- Maps Grounding pipeline ----------
function resetMapsProspectsCard() {
  if (mgElapsedTimer !== null) { clearInterval(mgElapsedTimer); mgElapsedTimer = null; }
  els.mgProspectsCard.classList.add('hidden');
  els.mgProspects.classList.add('hidden');
  els.mgFetchStatus.classList.remove('hidden');
  els.mgProspectsList.innerHTML = '';
  els.mgGroundedMeta.innerHTML = '';
}

async function mapsGroundingRandomBusiness() {
  clearError();
  resetMapsProspectsCard();
  resetSkillsStatus();
  currentLocalBusiness = null;
  els.mgBusinessCard.classList.add('hidden');
  els.mgFetchBtn.disabled = true;
  els.mgRandomBtn.disabled = true;
  const original = els.mgRandomBtn.textContent;
  els.mgRandomBtn.textContent = '⏳ Génération…';

  try {
    const language = els.mgLang.value as Language;
    const languageName = LANG_NAMES[language];
    const defaultCity = els.mgCity.value;

    currentLocalBusiness = await runSkill<
      { defaultCity: string; languageName: string },
      LocalBusiness
    >('create_local_business', { defaultCity, languageName });

    els.mgName.textContent = currentLocalBusiness.name;
    els.mgType.textContent = currentLocalBusiness.type;
    els.mgTicket.textContent = currentLocalBusiness.icp.estimatedTicket;
    els.mgPitch.textContent = currentLocalBusiness.pitch;
    els.mgSegment.textContent = currentLocalBusiness.icp.segment;
    els.mgMapsQuery.textContent = currentLocalBusiness.icp.mapsQuery;
    els.mgCityTarget.textContent = currentLocalBusiness.icp.city;
    els.mgSize.textContent = currentLocalBusiness.icp.sizeRange;
    els.mgPain.textContent = currentLocalBusiness.icp.pain;
    els.mgBusinessCard.classList.remove('hidden');
    els.mgFetchBtn.disabled = false;
  } catch (e) {
    showError((e as Error).message);
  } finally {
    els.mgRandomBtn.disabled = false;
    els.mgRandomBtn.textContent = original;
  }
}

async function mapsGroundingFetchProspects() {
  if (!currentLocalBusiness) return;
  clearError();
  resetMapsProspectsCard();
  els.mgProspectsCard.classList.remove('hidden');
  els.mgFetchBtn.disabled = true;
  const startedAt = Date.now();

  mgElapsedTimer = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    els.mgElapsed.textContent = `(${elapsed}s)`;
    els.mgStatusText.textContent =
      elapsed < 10 ? 'Apify : recherche des places sur Google Maps…'
      : elapsed < 30 ? 'Apify : filtrage has-website + enrichissement contacts…'
      : elapsed < 60 ? 'Apify : scraping des sites pour les emails…'
      : elapsed < 120 ? 'Apify : finalisation (peut prendre quelques minutes)…'
      : 'Apify : finalisation…';
  }, 1000);

  try {
    setSkillStatus('fetch_maps_prospects', 'running');
    const limit = Number(els.mgLimit.value) || 15;
    const city = els.mgCity.value || currentLocalBusiness.icp.city;
    const language = els.mgLang.value as Language;
    const out = await runSkill<
      { mapsQuery: string; city: string; limit: number; language: string },
      FetchMapsProspectsOutput
    >('fetch_maps_prospects', {
      mapsQuery: currentLocalBusiness.icp.mapsQuery,
      city,
      limit,
      language,
    });
    setSkillStatus('fetch_maps_prospects', 'done');
    renderMapsProspects(out);
  } catch (e) {
    setSkillStatus('fetch_maps_prospects', 'failed');
    showError((e as Error).message);
  } finally {
    if (mgElapsedTimer !== null) { clearInterval(mgElapsedTimer); mgElapsedTimer = null; }
    els.mgFetchStatus.classList.add('hidden');
    els.mgFetchBtn.disabled = false;
  }
}

function renderMapsProspects(out: FetchMapsProspectsOutput) {
  els.mgProspectsCount.textContent = `(${out.prospects.length})`;

  let pipelineHtml = '';
  if (out.stats) {
    const s = out.stats;
    const sourceBadge = '<span class="grounded-badge">Apify · compass/google-maps-scraper</span>';
    const doneBadge = s.done
      ? '<span class="badge-done">✓ target atteint</span>'
      : `<span class="badge-warn">⚠️ ${s.withEmails}/${s.target} — il manque ${s.target - s.withEmails} emails</span>`;
    const runLink = s.actorRunId
      ? `<a class="muted" href="https://console.apify.com/actors/runs/${s.actorRunId}" target="_blank" rel="noopener noreferrer">run ${s.actorRunId.slice(0, 10)}…</a>`
      : '';

    pipelineHtml = `
      <div class="pipeline-stats">
        <div class="pipeline-line">${sourceBadge}</div>
        <div class="pipeline-line"><strong>${s.rawCount}</strong> places scrapées → <strong>${s.withWebsite}</strong> avec website → <strong>${s.withEmails}/${s.target}</strong> avec email</div>
        <div class="pipeline-line">${
          s.costUsdActual !== undefined
            ? `💰 Coût réel Apify <strong>$${s.costUsdActual.toFixed(4)}</strong> <span class="muted">(estimé $${s.costUsdEstimate.toFixed(4)})</span>`
            : `💰 Coût estimé <strong>$${s.costUsdEstimate.toFixed(4)}</strong>`
        } · ${runLink}</div>
        <div class="pipeline-line">${doneBadge}</div>
      </div>
    `;
  }
  els.mgGroundedMeta.innerHTML = pipelineHtml;

  els.mgProspectsList.innerHTML = '';
  if (out.prospects.length === 0) {
    els.mgProspectsList.innerHTML = '<p class="muted">Aucun prospect retourné.</p>';
  } else {
    for (const p of out.prospects) {
      const div = document.createElement('div');
      div.className = 'prospect';
      const ratingHtml = p.rating
        ? `<div class="prospect-rating"><span class="rating-star">★</span> ${p.rating.toFixed(1)}${
            p.reviewsCount ? ` (${p.reviewsCount})` : ''
          }</div>`
        : '';
      const contactBits: string[] = [];
      if (p.phone) {
        contactBits.push(
          `📞 <a href="tel:${escapeAttr(p.phone)}">${escapeHtml(p.phone)}</a>`,
        );
      } else {
        contactBits.push('<span class="prospect-empty">tél inconnu</span>');
      }
      if (p.website) {
        contactBits.push(
          `🌐 <a href="${escapeAttr(p.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shortUrl(p.website))}</a>`,
        );
      }
      if (p.googleMapsUri) {
        contactBits.push(
          `🗺 <a href="${escapeAttr(p.googleMapsUri)}" target="_blank" rel="noopener noreferrer">Maps</a>`,
        );
      }
      const emailsHtml =
        p.emails && p.emails.length > 0
          ? `<div class="prospect-emails">${p.emails
              .map(
                (e) =>
                  `✉️ <a href="mailto:${escapeAttr(e)}">${escapeHtml(e)}</a>`,
              )
              .join('')}</div>`
          : '<div class="prospect-emails prospect-emails-empty">✉️ aucun email trouvé sur le site</div>';
      const socialsHtml = renderSocials(p.socials);
      const categoryHtml = p.category
        ? `<div class="prospect-category"><span class="tag">${escapeHtml(p.category)}</span></div>`
        : '';
      div.innerHTML = `
        <div class="prospect-head">
          <div class="prospect-name">${escapeHtml(p.name)}</div>
          ${ratingHtml}
        </div>
        ${p.address ? `<div class="prospect-address">📍 ${escapeHtml(p.address)}</div>` : ''}
        ${categoryHtml}
        <div class="prospect-contact">${contactBits.join('')}</div>
        ${emailsHtml}
        ${socialsHtml}
        ${p.summary ? `<div class="prospect-summary">${escapeHtml(p.summary)}</div>` : ''}
      `;
      els.mgProspectsList.appendChild(div);
    }
  }
  els.mgProspects.classList.remove('hidden');
}

function renderSocials(s: ProspectSocials | undefined): string {
  if (!s) return '';
  const entries: Array<[string, string[] | undefined, string]> = [
    ['IG', s.instagram, '📷'],
    ['FB', s.facebook, '📘'],
    ['LinkedIn', s.linkedin, '💼'],
    ['TikTok', s.tiktok, '🎵'],
    ['YT', s.youtube, '▶️'],
    ['X', s.twitter, '𝕏'],
  ];
  const links: string[] = [];
  for (const [label, arr, emoji] of entries) {
    if (!arr || arr.length === 0) continue;
    const url = arr[0]!;
    links.push(
      `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(url)}">${emoji} ${escapeHtml(label)}</a>`,
    );
  }
  return links.length ? `<div class="prospect-socials">${links.join('')}</div>` : '';
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u);
    return url.host.replace(/^www\./, '') + (url.pathname === '/' ? '' : url.pathname);
  } catch {
    return u;
  }
}

// ---------- Wiring ----------
els.ugcRandomBtn.addEventListener('click', ugcGenerateIdea);
els.ugcGenVideoBtn.addEventListener('click', ugcGenerateVideo);
els.nlRandomBtn.addEventListener('click', newsletterPickTopic);
els.nlGenBtn.addEventListener('click', newsletterGenerateEdition);
els.prRandomBtn.addEventListener('click', prospectionRandomBusiness);
els.prStrategyBtn.addEventListener('click', prospectionGenerateStrategy);
els.mgRandomBtn.addEventListener('click', mapsGroundingRandomBusiness);
els.mgFetchBtn.addEventListener('click', mapsGroundingFetchProspects);

init().catch((e) => showError((e as Error).message));
