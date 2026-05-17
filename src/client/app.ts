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
  // x_dm panel
  xAuthStatus: $('xAuthStatus'),
  xLinkBtn: $<HTMLButtonElement>('xLinkBtn'),
  xUnlinkBtn: $<HTMLButtonElement>('xUnlinkBtn'),
  xLang: $<HTMLSelectElement>('xLang'),
  xBiz: $<HTMLSelectElement>('xBiz'),
  xVariantCount: $<HTMLSelectElement>('xVariantCount'),
  xProspectTarget: $<HTMLSelectElement>('xProspectTarget'),
  xLocation: $<HTMLSelectElement>('xLocation'),
  xAutoBtn: $<HTMLButtonElement>('xAutoBtn'),
  xRandomBtn: $<HTMLButtonElement>('xRandomBtn'),
  xFindBtn: $<HTMLButtonElement>('xFindBtn'),
  xGenDMBtn: $<HTMLButtonElement>('xGenDMBtn'),
  xAutoProgress: $('xAutoProgress'),
  xAutoStepLabel: $('xAutoStepLabel'),
  xAutoStepDetail: $('xAutoStepDetail'),
  xAutoCostSummary: $('xAutoCostSummary'),
  xProspectsCard: $('xProspectsCard'),
  xProspectsCount: $('xProspectsCount'),
  xProspectsStats: $('xProspectsStats'),
  xProspectsList: $('xProspectsList'),
  xBusinessCard: $('xBusinessCard'),
  xName: $('xName'),
  xType: $('xType'),
  xTicket: $('xTicket'),
  xPitch: $('xPitch'),
  xSegment: $('xSegment'),
  xPain: $('xPain'),
  xBioKeywords: $('xBioKeywords'),
  xBioKwAdd: $<HTMLInputElement>('xBioKwAdd'),
  xBioKwAddBtn: $<HTMLButtonElement>('xBioKwAddBtn'),
  xTopics: $('xTopics'),
  xTopicAdd: $<HTMLInputElement>('xTopicAdd'),
  xTopicAddBtn: $<HTMLButtonElement>('xTopicAddBtn'),
  xDMCard: $('xDMCard'),
  xDMTemplate: $('xDMTemplate'),
  xDMRationale: $('xDMRationale'),
  xDMCombos: $('xDMCombos'),
  xVariantsCount: $('xVariantsCount'),
  xVariantsList: $('xVariantsList'),
  xSendCard: $('xSendCard'),
  xHandles: $<HTMLTextAreaElement>('xHandles'),
  xSendBtn: $<HTMLButtonElement>('xSendBtn'),
  xSendStatus: $('xSendStatus'),
  xSendStatusText: $('xSendStatusText'),
  xSendResults: $('xSendResults'),
  xSendResultsList: $('xSendResultsList'),
  // TikTok inline on Video UGC card
  ugcPostTikTokBtn: $<HTMLButtonElement>('ugcPostTikTokBtn'),
  ugcTikTokInline: $('ugcTikTokInline'),
  // TikTok panel
  ttAuthStatus: $('ttAuthStatus'),
  ttLinkBtn: $<HTMLButtonElement>('ttLinkBtn'),
  ttUnlinkBtn: $<HTMLButtonElement>('ttUnlinkBtn'),
  ttVideoUri: $<HTMLInputElement>('ttVideoUri'),
  ttMode: $<HTMLSelectElement>('ttMode'),
  ttPrivacy: $<HTMLSelectElement>('ttPrivacy'),
  ttCaption: $<HTMLTextAreaElement>('ttCaption'),
  ttPostBtn: $<HTMLButtonElement>('ttPostBtn'),
  ttStatus: $('ttStatus'),
  ttStatusText: $('ttStatusText'),
  ttResult: $('ttResult'),
  ttResultBody: $('ttResultBody'),
  // Source toggle: post a Veo URI vs upload a local file
  ttSourceVeoBtn: $<HTMLButtonElement>('ttSourceVeoBtn'),
  ttSourceFileBtn: $<HTMLButtonElement>('ttSourceFileBtn'),
  ttSourceVeoPanel: $('ttSourceVeoPanel'),
  ttSourceFilePanel: $('ttSourceFilePanel'),
  ttFileInput: $<HTMLInputElement>('ttFileInput'),
  ttFileInfo: $('ttFileInfo'),
};

/** Which video source the TikTok panel is currently using. */
type TikTokSource = 'veo' | 'file';
let tiktokSource: TikTokSource = 'veo';

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

// X DM state
interface XOutreachBusiness {
  name: string;
  type: string;
  pitch: string;
  icp: {
    segment: string;
    xBioKeywords: string[];
    xTopics: string[];
    pain: string;
    estimatedTicket: string;
  };
}
interface GeneratedXDM {
  template: string;
  rationale: string;
  variants: string[];
  totalCombos: number;
}
interface XStatusResp {
  linked: boolean;
  username?: string;
  userId?: string;
  expiresAt?: number;
  scopes?: string[];
}
interface DMResult {
  handle: string;
  status: 'sent' | 'likely_sent' | 'failed';
  variantUsed?: string;
  dmEventId?: string;
  error?: string;
  chatUrl?: string;
  failureKind?: 'lookup_not_found' | 'lookup_other' | 'x_refused' | 'x_other';
}
interface SendXDMsCost {
  userLookupCalls: number;
  dmSendCalls: number;
  dmSendSuccesses: number;
  costUsdEstimate: number;
}
interface SendXDMsOutput {
  results: DMResult[];
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  stoppedEarly: boolean;
  cost: SendXDMsCost;
}
interface XProspect {
  handle: string;
  userId: string;
  name?: string;
  bio?: string;
  verified?: boolean;
  followersCount?: number;
  recentTweet?: string;
  openDmsHint: boolean;
  score: number;
}
interface FindXProspectsAttempt {
  iteration: number;
  terms: string[];
  maxItems: number;
  returned: number;
  bioMatched: number;
  droppedProtected: number;
  droppedNonEnglish: number;
  droppedClosedDms: number;
  costUsdActual?: number;
  actorRunId?: string;
}
interface FindXProspectsOutput {
  prospects: XProspect[];
  query: string;
  stats: {
    usersReturned: number;
    bioMatched: number;
    droppedProtected: number;
    droppedNonEnglish: number;
    droppedClosedDms: number;
    target: number;
    done: boolean;
    iterations: number;
    attempts: FindXProspectsAttempt[];
    costUsdActual?: number;
    actorRunIds: string[];
    searchError?: string;
  };
}
/** Last Veo videoUri generated in the UGC panel — pre-fills the TikTok form. */
let lastGeneratedVeoUri: string | null = null;
/** Business + video script captured when the UGC video was generated. Used
 *  to auto-generate a TikTok caption + hashtags after the video is done. */
let lastUgcBusiness: Business | null = null;
let lastUgcVideoScript: VideoScript | null = null;
/** TikTok caption auto-generated right after the UGC video completes. */
let lastTikTokCaption: { caption: string; captionBody: string; hashtags: string[] } | null = null;

let currentXBusiness: XOutreachBusiness | null = null;
let currentXProspects: XProspect[] = [];
let currentXDM: GeneratedXDM | null = null;

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
          // Surface to TikTok panel: URI + auto-generated caption from the business.
          lastGeneratedVeoUri = data.videoUri;
          lastUgcBusiness = currentBusiness;
          lastUgcVideoScript = currentVideo;
          if (els.ttVideoUri) els.ttVideoUri.value = data.videoUri;
          // Fire-and-forget caption generation. Don't block the user — the
          // caption will be ready by the time they navigate to TikTok panel.
          void autoGenerateTikTokCaption();
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

// ---------- X DM pipeline ----------

async function refreshXAuthStatus() {
  try {
    const status = await apiGet<XStatusResp>('/api/auth/x/status');
    if (status.linked) {
      els.xAuthStatus.innerHTML = `<span class="x-linked-badge">linked</span>Connecté en tant que <strong>@${escapeHtml(status.username ?? '?')}</strong>`;
      els.xLinkBtn.classList.add('hidden');
      els.xUnlinkBtn.classList.remove('hidden');
    } else {
      els.xAuthStatus.innerHTML = `<span class="muted">Aucun compte X linké.</span>`;
      els.xLinkBtn.classList.remove('hidden');
      els.xUnlinkBtn.classList.add('hidden');
    }
  } catch (e) {
    els.xAuthStatus.innerHTML = `<span class="muted">Statut X : erreur (${escapeHtml((e as Error).message)})</span>`;
  }
}

function xLogin() {
  // Open OAuth in a popup so the user lands back here on success.
  const w = window.open('/api/auth/x/login', 'x-oauth', 'width=720,height=720');
  if (!w) {
    // popup blocked — fall back to full redirect
    window.location.href = '/api/auth/x/login';
    return;
  }
  // The callback page postMessages window.opener — listen for it
  window.addEventListener('message', function once(ev) {
    if (ev.data?.type === 'x_linked') {
      window.removeEventListener('message', once);
      refreshXAuthStatus();
    }
  });
  // Also poll a few times in case postMessage was blocked
  let polls = 0;
  const poller = window.setInterval(async () => {
    polls++;
    if (polls > 20) {
      clearInterval(poller);
      return;
    }
    const status = await apiGet<XStatusResp>('/api/auth/x/status').catch(() => null);
    if (status?.linked) {
      clearInterval(poller);
      refreshXAuthStatus();
    }
  }, 1500);
}

async function xLogout() {
  try {
    await apiPost('/api/auth/x/logout', {});
    refreshXAuthStatus();
  } catch (e) {
    showError((e as Error).message);
  }
}

/**
 * Render an array of strings as removable chips, in-place on `el`.
 * Clicking the × button removes the item from the underlying array AND re-renders.
 * The array is mutated by reference — that's intentional so the caller's state stays sync.
 */
function renderEditableTags(el: HTMLElement, items: string[]) {
  el.innerHTML = '';
  for (let i = 0; i < items.length; i++) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = items[i]!;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tag-remove';
    x.setAttribute('aria-label', `Remove ${items[i]}`);
    x.textContent = '×';
    x.addEventListener('click', () => {
      items.splice(i, 1);
      renderEditableTags(el, items);
    });
    tag.appendChild(x);
    el.appendChild(tag);
  }
}

function addTagFromInput(input: HTMLInputElement, items: string[], el: HTMLElement) {
  const value = input.value.trim();
  if (!value) return;
  // Dedupe (case-insensitive)
  const exists = items.some((x) => x.toLowerCase() === value.toLowerCase());
  if (!exists) {
    items.push(value);
    renderEditableTags(el, items);
  }
  input.value = '';
  input.focus();
}

async function xRandomBusiness() {
  clearError();
  currentXBusiness = null;
  currentXProspects = [];
  currentXDM = null;
  els.xBusinessCard.classList.add('hidden');
  els.xProspectsCard.classList.add('hidden');
  els.xDMCard.classList.add('hidden');
  els.xSendCard.classList.add('hidden');
  els.xFindBtn.disabled = true;
  els.xGenDMBtn.disabled = true;
  els.xSendBtn.disabled = true;
  els.xRandomBtn.disabled = true;
  resetSkillsStatus();
  const original = els.xRandomBtn.textContent;
  els.xRandomBtn.textContent = '⏳ Génération…';

  try {
    const language = els.xLang.value as Language;
    const languageName = LANG_NAMES[language];
    const businessType = els.xBiz.value || undefined;

    currentXBusiness = await runSkill<
      { businessType?: string; languageName: string },
      XOutreachBusiness
    >('create_x_outreach_business', { businessType, languageName });
    renderXBusiness(currentXBusiness);
    els.xBusinessCard.classList.remove('hidden');
    // After business → next step is Find prospects (not Generate DM directly)
    els.xFindBtn.disabled = false;
  } catch (e) {
    showError((e as Error).message);
  } finally {
    els.xRandomBtn.disabled = false;
    els.xRandomBtn.textContent = original;
  }
}

function renderXBusiness(b: XOutreachBusiness) {
  els.xName.textContent = b.name;
  els.xType.textContent = b.type;
  els.xTicket.textContent = b.icp.estimatedTicket;
  els.xPitch.textContent = b.pitch;
  els.xSegment.textContent = b.icp.segment;
  els.xPain.textContent = b.icp.pain;
  renderEditableTags(els.xBioKeywords, b.icp.xBioKeywords);
  renderEditableTags(els.xTopics, b.icp.xTopics);
}

async function xFindProspects() {
  if (!currentXBusiness) return;
  clearError();
  currentXProspects = [];
  currentXDM = null;
  els.xProspectsCard.classList.add('hidden');
  els.xDMCard.classList.add('hidden');
  els.xSendCard.classList.add('hidden');
  els.xFindBtn.disabled = true;
  els.xGenDMBtn.disabled = true;
  const original = els.xFindBtn.textContent;
  els.xFindBtn.textContent = '🔎 Recherche X…';

  try {
    const target = Number(els.xProspectTarget.value) || 10;
    const out = await runSkill<
      { bioKeywords: string[]; topics?: string[]; target: number },
      FindXProspectsOutput
    >('find_x_prospects', {
      bioKeywords: currentXBusiness.icp.xBioKeywords,
      topics: currentXBusiness.icp.xTopics,
      target,
    });
    currentXProspects = out.prospects;
    renderXProspects(out);
    els.xGenDMBtn.disabled = currentXProspects.length === 0;
  } catch (e) {
    showError((e as Error).message);
  } finally {
    els.xFindBtn.disabled = false;
    els.xFindBtn.textContent = original;
  }
}

function renderXProspects(out: FindXProspectsOutput) {
  const s = out.stats;
  els.xProspectsCount.textContent = `(${out.prospects.length})`;
  const doneBadge = s.done
    ? '<span class="badge-done">✓ target atteint</span>'
    : `<span class="badge-warn">⚠️ ${out.prospects.length}/${s.target}</span>`;

  const errorBlock = s.searchError
    ? `<div class="error" style="margin:8px 0;padding:10px 12px"><strong>Apify a renvoyé une erreur :</strong><br><code>${escapeHtml(s.searchError)}</code></div>`
    : '';

  const runLinks = s.actorRunIds.length
    ? s.actorRunIds
        .map(
          (id, i) =>
            `<a class="muted" href="https://console.apify.com/actors/runs/${id}" target="_blank" rel="noopener noreferrer">run #${i + 1} (${id.slice(0, 8)}…)</a>`,
        )
        .join(' · ')
    : '';
  const costLine = s.costUsdActual !== undefined
    ? `💰 Coût total Apify <strong>$${s.costUsdActual.toFixed(4)}</strong>`
    : '💰 Coût en cours de calcul…';

  const attemptsTable = s.attempts.length
    ? `<details style="margin-top:6px"><summary class="muted small">📊 Détail par itération (${s.iterations})</summary>
        <table class="attempts-table" style="margin-top:6px;font-size:12px;border-collapse:collapse">
          <thead><tr style="text-align:left;color:var(--muted)">
            <th style="padding:2px 8px">#</th>
            <th style="padding:2px 8px">Query</th>
            <th style="padding:2px 8px">maxItems</th>
            <th style="padding:2px 8px">Profils</th>
            <th style="padding:2px 8px">Bio ✓</th>
            <th style="padding:2px 8px">$</th>
          </tr></thead>
          <tbody>
            ${s.attempts
              .map(
                (a) => `<tr>
                  <td style="padding:2px 8px">${a.iteration}</td>
                  <td style="padding:2px 8px"><code>${escapeHtml(a.terms.join(' OR '))}</code></td>
                  <td style="padding:2px 8px">${a.maxItems}</td>
                  <td style="padding:2px 8px">${a.returned}</td>
                  <td style="padding:2px 8px">${a.bioMatched}</td>
                  <td style="padding:2px 8px">${a.costUsdActual !== undefined ? '$' + a.costUsdActual.toFixed(4) : '—'}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </details>`
    : '';

  els.xProspectsStats.innerHTML = `
    ${errorBlock}
    <div><strong>${s.usersReturned}</strong> profils scrapés (${s.iterations} itération${s.iterations > 1 ? 's' : ''}) → <strong>${s.bioMatched}</strong> matchent (bio/handle/nom)${s.droppedProtected > 0 ? ` → <strong>${s.droppedProtected}</strong> privés` : ''}${s.droppedNonEnglish > 0 ? ` → <strong>${s.droppedNonEnglish}</strong> non-anglais` : ''}${s.droppedClosedDms > 0 ? ` → <strong>${s.droppedClosedDms}</strong> DMs fermés probables` : ''} → <strong>${out.prospects.length}/${s.target}</strong> DM-ables retournés</div>
    <div>${costLine}${runLinks ? ' · ' + runLinks : ''}</div>
    <div class="muted small">searchTerms initiaux : <code>${escapeHtml(out.query)}</code></div>
    <div>${doneBadge}</div>
    ${attemptsTable}
  `;
  els.xProspectsList.innerHTML = '';
  if (out.prospects.length === 0) {
    const msg = s.searchError
      ? `Apify a échoué après ${s.iterations} itération${s.iterations > 1 ? 's' : ''} — voir le message ci-dessus.`
      : s.usersReturned === 0
        ? "Apify n'a retourné aucun profil. Keywords trop niches ? Élargis et relance."
        : "Aucun profil ne matche tes keywords (bio/handle/nom). Édite-les (synonymes, variantes) et relance.";
    els.xProspectsList.innerHTML = `<p class="muted">${msg}</p>`;
  } else {
    for (const p of out.prospects) {
      const div = document.createElement('div');
      div.className = 'prospect';
      const verifiedBadge = p.verified ? '<span class="tag" style="color:var(--accent)">verified</span>' : '';
      const openBadge = p.openDmsHint
        ? '<span class="tag" style="color:var(--success);border-color:var(--success)">📩 open DMs hint</span>'
        : '';
      const followers = p.followersCount !== undefined
        ? `<span class="muted small">${formatFollowers(p.followersCount)} followers</span>`
        : '';
      div.innerHTML = `
        <div class="prospect-head">
          <div class="prospect-name">
            <a href="https://x.com/${escapeAttr(p.handle)}" target="_blank" rel="noopener noreferrer">@${escapeHtml(p.handle)}</a>
            ${p.name ? ` <span class="muted">— ${escapeHtml(p.name)}</span>` : ''}
          </div>
          <div class="prospect-rating">score ${p.score}</div>
        </div>
        <div class="prospect-contact">${openBadge}${verifiedBadge}${followers}</div>
        ${p.bio ? `<p class="prospect-summary" style="font-style:normal;color:var(--text)">${escapeHtml(p.bio)}</p>` : ''}
        ${p.recentTweet ? `<p class="prospect-summary">« ${escapeHtml(p.recentTweet.slice(0, 200))}${p.recentTweet.length > 200 ? '…' : ''} »</p>` : ''}
      `;
      els.xProspectsList.appendChild(div);
    }
  }
  els.xProspectsCard.classList.remove('hidden');
}

function formatFollowers(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

async function xGenerateDM() {
  if (!currentXBusiness) return;
  clearError();
  els.xDMCard.classList.add('hidden');
  els.xSendCard.classList.add('hidden');
  els.xGenDMBtn.disabled = true;
  const original = els.xGenDMBtn.textContent;
  els.xGenDMBtn.textContent = '⏳ Écriture…';

  try {
    const language = els.xLang.value as Language;
    const languageName = LANG_NAMES[language];
    const variantCount = Number(els.xVariantCount.value) || 6;

    currentXDM = await runSkill<
      { business: XOutreachBusiness; languageName: string; variantCount: number },
      GeneratedXDM
    >('generate_x_dm', { business: currentXBusiness, languageName, variantCount });

    renderXDM(currentXDM);
    // Auto-populate handles textarea from the prospects we already found.
    // User can still edit before sending.
    if (currentXProspects.length > 0) {
      els.xHandles.value = currentXProspects
        .slice(0, 10)
        .map((p) => `@${p.handle}`)
        .join('\n');
    }
    els.xSendCard.classList.remove('hidden');
    els.xSendBtn.disabled = false;
  } catch (e) {
    showError((e as Error).message);
  } finally {
    els.xGenDMBtn.disabled = false;
    els.xGenDMBtn.textContent = original;
  }
}

function renderXDM(dm: GeneratedXDM) {
  els.xDMTemplate.innerHTML = highlightSpintax(dm.template);
  els.xDMRationale.textContent = dm.rationale;
  els.xDMCombos.textContent = `${dm.totalCombos} combinaisons possibles · ${dm.variants.length} variantes uniques générées`;
  els.xVariantsCount.textContent = `(${dm.variants.length})`;
  els.xVariantsList.innerHTML = dm.variants
    .map((v) => `<li>${escapeHtml(v)}</li>`)
    .join('');
  els.xDMCard.classList.remove('hidden');
}

function highlightSpintax(template: string): string {
  const escaped = escapeHtml(template);
  // Wrap `{a/b/c}` groups in a styled span. Only groups with `/` are real spintax.
  return escaped.replace(/\{([^{}]*\/[^{}]*)\}/g, (_, inner) => {
    return `<span class="spintax-group">{${inner}}</span>`;
  });
}

async function xSendDMs() {
  if (!currentXDM) return;
  const handlesRaw = els.xHandles.value;
  const handles = handlesRaw
    .split(/[\s,;]+/)
    .map((h) => h.trim().replace(/^@/, ''))
    .filter((h) => h.length > 0);
  if (handles.length === 0) {
    showError('Aucun handle à contacter — colle des @handles dans la zone de texte.');
    return;
  }
  if (handles.length > 10) {
    showError(`Max 10 handles par run (cap dur). Tu en as ${handles.length}.`);
    return;
  }
  clearError();
  els.xSendBtn.disabled = true;
  els.xSendStatus.classList.remove('hidden');
  els.xSendResults.classList.add('hidden');
  els.xSendStatusText.textContent = `Envoi de ${handles.length} DMs (délai 5-12s randomisé)…`;

  try {
    const out = await sendDMsLive({
      template: currentXDM.template,
      handles,
      variants: currentXDM.variants,
    });
    renderSendResults(out);
  } catch (e) {
    showError((e as Error).message);
  } finally {
    els.xSendBtn.disabled = false;
    els.xSendStatus.classList.add('hidden');
  }
}

// ---------- Live send via SSE ----------

interface SendDmsLiveInput {
  template: string;
  handles: string[];
  variants: string[];
  delayMinMs?: number;
  delayMaxMs?: number;
  targetSuccesses?: number;
  /** Optional candidate metadata, used to render rich rows (name/followers/bio). */
  candidates?: Array<{
    handle: string;
    name?: string;
    bio?: string;
    followersCount?: number;
    verified?: boolean;
    score?: number;
  }>;
}

interface SendProgressStart { kind: 'start'; total: number; targetSuccesses: number; variants: string[]; delayMinMs: number; delayMaxMs: number }
interface SendProgressAttempt { kind: 'attempt'; index: number; handle: string; variant: string }
interface SendProgressResult { kind: 'result'; index: number; result: SendXDMsOutput['results'][number] }
interface SendProgressDelay { kind: 'delay'; ms: number; nextHandle: string }
interface SendProgressSkipped { kind: 'skipped'; index: number; handle: string; reason: 'target_reached' }
interface SendProgressDone { kind: 'done'; final: SendXDMsOutput }
type SendProgressEvent =
  | SendProgressStart
  | SendProgressAttempt
  | SendProgressResult
  | SendProgressDelay
  | SendProgressSkipped
  | SendProgressDone;

/**
 * Streams the send via SSE. Each event re-renders the in-progress results
 * card so the user sees each handle flip from "sending…" to ✓/✗ live.
 */
async function sendDMsLive(
  input: SendDmsLiveInput,
  onEvent?: (e: SendProgressEvent) => void,
): Promise<SendXDMsOutput> {
  // Seed results card with placeholders so the user sees the queue immediately.
  // If candidates metadata is provided, render rich rows with name/followers/bio.
  const richCandidates =
    input.candidates && input.candidates.length === input.handles.length
      ? input.candidates
      : input.handles.map((h) => ({ handle: h }));
  initLiveResults(richCandidates);
  els.xSendResults.classList.remove('hidden');

  // Don't send the `candidates` field to the server — only the skill schema fields.
  const { candidates: _omit, ...body } = input;
  void _omit;
  const res = await fetch('/api/x-dm/send-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`send-stream HTTP ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let final: SendXDMsOutput | undefined;

  const handleEvent = (eventName: string, dataJson: string) => {
    let data: SendProgressEvent;
    try { data = JSON.parse(dataJson); } catch { return; }
    if (eventName === 'error') {
      throw new Error((data as unknown as { error: string }).error ?? 'stream error');
    }
    onEvent?.(data);
    switch (data.kind) {
      case 'attempt':
        updateLiveRow(data.index, 'sending', data.handle, data.variant);
        break;
      case 'result':
        updateLiveRowFromResult(data.index, data.result);
        break;
      case 'delay':
        break;
      case 'skipped':
        updateLiveRowSkipped(data.index);
        break;
      case 'done':
        final = data.final;
        break;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are separated by blank lines.
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      if (!raw.trim() || raw.startsWith(':')) continue; // comment / heartbeat
      let eventName = 'message';
      const dataLines: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event: ')) eventName = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
      }
      if (dataLines.length) handleEvent(eventName, dataLines.join('\n'));
    }
  }

  if (!final) throw new Error('Stream closed without a final result');
  return final;
}

function initLiveResults(
  candidates: Array<{
    handle: string;
    name?: string;
    bio?: string;
    followersCount?: number;
    verified?: boolean;
    score?: number;
  }>,
) {
  els.xSendResultsList.innerHTML = `
    <p class="muted small" id="xLiveProgressLine">⏳ 0 envoyés · 0 échoués · ${candidates.length} en attente</p>
    ${candidates
      .map((c, i) => {
        const verifiedBadge = c.verified ? '<span class="tag" style="color:var(--accent);font-size:11px">verified</span>' : '';
        const followers = c.followersCount !== undefined
          ? `<span class="muted small">${formatFollowers(c.followersCount)} followers</span>`
          : '';
        const scoreBadge = c.score !== undefined
          ? `<span class="muted small">score ${c.score}</span>`
          : '';
        const bio = c.bio
          ? `<div class="muted small" style="margin-top:4px;line-height:1.35">${escapeHtml(c.bio.slice(0, 180))}${c.bio.length > 180 ? '…' : ''}</div>`
          : '';
        return `
        <div class="send-result-rich" id="xLiveRow-${i}" style="border-bottom:1px solid var(--border);padding:10px 12px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1;min-width:0">
              <a class="send-result-handle" href="https://x.com/${escapeAttr(c.handle)}" target="_blank" rel="noopener noreferrer" style="font-weight:700">@${escapeHtml(c.handle)}</a>
              ${c.name ? `<span class="muted" style="font-size:13px">— ${escapeHtml(c.name)}</span>` : ''}
              ${verifiedBadge}
              ${followers}
              ${scoreBadge}
            </div>
            <span class="send-result-status-pending" id="xLiveStatus-${i}" style="font-weight:600">⋯ en attente</span>
          </div>
          ${bio}
          <div class="muted small" id="xLiveDetail-${i}" style="margin-top:6px;font-style:italic"></div>
        </div>`;
      })
      .join('')}
  `;
}

function updateLiveRow(index: number, state: 'sending', handle: string, variant: string) {
  const statusEl = document.getElementById(`xLiveStatus-${index}`);
  const detailEl = document.getElementById(`xLiveDetail-${index}`);
  if (statusEl) {
    statusEl.className = 'send-result-status-pending';
    statusEl.textContent = state === 'sending' ? '⏳ envoi…' : state;
  }
  if (detailEl) detailEl.textContent = variant.length > 100 ? variant.slice(0, 100) + '…' : variant;
  void handle;
}

/** Marks a candidate as "not attempted" because target successes was reached. */
function updateLiveRowSkipped(index: number) {
  const statusEl = document.getElementById(`xLiveStatus-${index}`);
  const detailEl = document.getElementById(`xLiveDetail-${index}`);
  if (statusEl) {
    statusEl.className = 'send-result-status-pending';
    statusEl.textContent = '⊘ skip (cible atteinte)';
  }
  if (detailEl) detailEl.textContent = '';
}

function updateLiveRowFromResult(index: number, result: SendXDMsOutput['results'][number]) {
  // eslint-disable-next-line no-console
  console.log(`[sse] result #${index} @${result.handle}: ${result.status}`);
  const statusEl = document.getElementById(`xLiveStatus-${index}`);
  const detailEl = document.getElementById(`xLiveDetail-${index}`);
  const progressLine = document.getElementById('xLiveProgressLine');
  if (statusEl) {
    statusEl.className = `send-result-status-${result.status === 'failed' ? 'failed' : 'sent'}`;
    if (result.status === 'sent') {
      statusEl.textContent = '✓ envoyé';
    } else if (result.status === 'likely_sent') {
      statusEl.textContent = '✓ envoyé (vérifié)';
    } else {
      const kind = result.failureKind;
      const label =
        kind === 'x_refused' ? '✗ X a refusé' :
        kind === 'lookup_not_found' ? '❓ user introuvable' :
        kind === 'lookup_other' ? '⚠️ lookup échec' :
        '✗ échoué';
      statusEl.textContent = label;
    }
  }
  if (detailEl) {
    // Build detail HTML: variant or error, plus a "vérifier" link to the X chat
    // so the user can always manually confirm what landed.
    const text = result.status === 'failed'
      ? (result.error ?? 'unknown error')
      : (result.variantUsed ?? '');
    const trimmed = text.length > 140 ? text.slice(0, 140) + '…' : text;
    const chatLink = result.chatUrl
      ? ` · <a href="${result.chatUrl}" target="_blank" rel="noopener noreferrer" class="muted small">vérifier sur X ↗</a>`
      : '';
    detailEl.innerHTML = `${escapeHtml(trimmed)}${chatLink}`;
  }
  // Recount across the rendered rows.
  if (progressLine) {
    const sent = document.querySelectorAll('.send-result-status-sent').length;
    const failed = document.querySelectorAll('.send-result-status-failed').length;
    const total = document.querySelectorAll('[id^="xLiveRow-"]').length;
    progressLine.textContent = `✓ ${sent} envoyés · ✗ ${failed} échoués · ⏳ ${Math.max(0, total - sent - failed)} en attente`;
  }
}

function renderSendResults(
  out: SendXDMsOutput,
  candidatesByHandle?: Map<string, XProspect>,
) {
  const rows = out.results
    .map((r) => {
      const c = candidatesByHandle?.get(r.handle.toLowerCase());
      const verifiedBadge = c?.verified ? '<span class="tag" style="color:var(--accent);font-size:11px">verified</span>' : '';
      const followers = c?.followersCount !== undefined
        ? `<span class="muted small">${formatFollowers(c.followersCount)} followers</span>` : '';
      const bio = c?.bio
        ? `<div class="muted small" style="margin-top:4px;line-height:1.35">${escapeHtml(c.bio.slice(0, 180))}${c.bio.length > 180 ? '…' : ''}</div>`
        : '';
      let statusLabel: string;
      let statusClass: string;
      if (r.status === 'sent') {
        statusLabel = '✓ envoyé';
        statusClass = 'send-result-status-sent';
      } else if (r.status === 'likely_sent') {
        statusLabel = '✓ envoyé (vérifié)';
        statusClass = 'send-result-status-sent';
      } else {
        const kind = r.failureKind;
        statusLabel =
          kind === 'x_refused' ? '✗ X a refusé' :
          kind === 'lookup_not_found' ? '❓ user introuvable' :
          kind === 'lookup_other' ? '⚠️ lookup échec' :
          '✗ échoué';
        statusClass = 'send-result-status-failed';
      }
      const detailText = r.status === 'failed'
        ? (r.error ?? 'unknown error')
        : (r.variantUsed ?? '');
      const trimmed = detailText.length > 180 ? detailText.slice(0, 180) + '…' : detailText;
      const chatLink = r.chatUrl
        ? ` · <a href="${r.chatUrl}" target="_blank" rel="noopener noreferrer" class="muted small">vérifier sur X ↗</a>`
        : '';
      return `
        <div class="send-result-rich" style="border-bottom:1px solid var(--border);padding:10px 12px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1;min-width:0">
              <a class="send-result-handle" href="https://x.com/${escapeAttr(r.handle)}" target="_blank" rel="noopener noreferrer" style="font-weight:700">@${escapeHtml(r.handle)}</a>
              ${c?.name ? `<span class="muted" style="font-size:13px">— ${escapeHtml(c.name)}</span>` : ''}
              ${verifiedBadge}
              ${followers}
            </div>
            <span class="${statusClass}" style="font-weight:600">${statusLabel}</span>
          </div>
          ${bio}
          <div class="muted small" style="margin-top:6px;font-style:italic">${escapeHtml(trimmed)}${chatLink}</div>
        </div>
      `;
    })
    .join('');
  els.xSendResultsList.innerHTML = `
    <p class="muted small">
      <strong>${out.sentCount}</strong> envoyés · <strong>${out.failedCount}</strong> échoués
      · 💰 Total <strong>$${out.cost.costUsdEstimate.toFixed(4)}</strong>
      <span class="muted">(${out.cost.userLookupCalls} lookup × $0.010 + ${out.cost.dmSendCalls} send × $0.015)</span>
    </p>
    ${rows}
  `;
  els.xSendResults.classList.remove('hidden');
}

// ---------- Auto pipeline ----------

/**
 * One-button orchestrator: random business → find prospects → generate DM →
 * send DMs (live). Each step renders its output into its own card as soon as
 * data arrives; the auto-progress banner shows which step is running.
 */
async function xAutoPipeline() {
  clearError();

  // Hide downstream cards + reset state so the pipeline always starts clean.
  els.xBusinessCard.classList.add('hidden');
  els.xProspectsCard.classList.add('hidden');
  els.xDMCard.classList.add('hidden');
  els.xSendCard.classList.add('hidden');
  els.xAutoCostSummary.textContent = '';
  currentXBusiness = null;
  currentXProspects = [];
  currentXDM = null;

  // Lock all manual buttons while auto is running.
  els.xAutoBtn.disabled = true;
  els.xRandomBtn.disabled = true;
  els.xFindBtn.disabled = true;
  els.xGenDMBtn.disabled = true;
  els.xSendBtn.disabled = true;
  const autoOriginal = els.xAutoBtn.textContent;
  els.xAutoBtn.textContent = '⏳ Pipeline en cours…';
  els.xAutoProgress.classList.remove('hidden');

  const setStep = (label: string, detail = '') => {
    els.xAutoStepLabel.textContent = label;
    els.xAutoStepDetail.textContent = detail;
  };
  // Track cost across all steps.
  let apifyCost = 0;
  let xApiCost = 0;
  const refreshCost = () => {
    const total = apifyCost + xApiCost;
    els.xAutoCostSummary.innerHTML =
      `💰 Coût cumulé : <strong>$${total.toFixed(4)}</strong> ` +
      `<span class="muted">(Apify $${apifyCost.toFixed(4)} + X API $${xApiCost.toFixed(4)})</span>`;
  };

  try {
    // ----- Step 1 : random business -----
    setStep('🎲 Étape 1/4 — Génération du business…', "Claude Opus 4.7 invente un business X-outreachable avec ICP + bio keywords.");
    const language = els.xLang.value as Language;
    const languageName = LANG_NAMES[language];
    const businessType = els.xBiz.value || undefined;
    currentXBusiness = await runSkill<
      { businessType?: string; languageName: string },
      XOutreachBusiness
    >('create_x_outreach_business', { businessType, languageName });
    renderXBusiness(currentXBusiness);
    els.xBusinessCard.classList.remove('hidden');

    // ----- Step 2 : generate DM template (needed before send to verify opens) -----
    const target = Number(els.xProspectTarget.value) || 10;
    setStep(
      `✍️ Étape 2/4 — Génération du DM Spintax…`,
      `Claude Opus 4.7 écrit un template + ${els.xVariantCount.value} variantes uniques.`,
    );
    const variantCount = Number(els.xVariantCount.value) || 6;
    currentXDM = await runSkill<
      { business: XOutreachBusiness; languageName: string; variantCount: number },
      GeneratedXDM
    >('generate_x_dm', { business: currentXBusiness, languageName, variantCount });
    renderXDM(currentXDM);

    // ----- Step 3+4 : find candidates → verify by sending → top-up loop -----
    // The only reliable signal for "DMs open" is to actually attempt the send.
    // So we over-fetch (target × 3), send with stop-at-target-successes, and
    // if not enough successes after that batch, fetch more candidates excluding
    // already-tried handles and continue.
    const verifiedOpens: XProspect[] = []; // profiles whose DM actually went through
    const allSendResults: SendXDMsOutput['results'] = []; // every attempt for audit
    const triedHandles = new Set<string>(); // case-insensitive, prevents re-fetching
    const keywordBatches: string[][] = [[...currentXBusiness.icp.xBioKeywords]];
    const locationPreset = (els.xLocation.value as 'usa' | 'worldwide') ?? 'usa';
    const MAX_TOP_UP_ROUNDS = 5;
    const candidatesByHandle = new Map<string, XProspect>(); // for re-rendering

    els.xSendCard.classList.remove('hidden');

    for (let round = 0; round < MAX_TOP_UP_ROUNDS; round++) {
      if (verifiedOpens.length >= target) break;
      const needed = target - verifiedOpens.length;
      // Overshoot ×4 because typical close-DM rate is 60-70%. We trade Apify
      // cost (~$0.016/round) for far fewer top-up rounds.
      const overshoot = Math.min(30, Math.max(needed * 4, 15));

      // (a) Find candidates
      const keywordsThisRound = keywordBatches[round] ?? [];
      if (keywordsThisRound.length === 0) break;
      const roundLabel = round === 0 ? 'initial' : `top-up ${round}`;
      setStep(
        `🔍 Étape 3/4 — Recherche candidats (${roundLabel}) — ${verifiedOpens.length}/${target} DM-és…`,
        `Cherche ${overshoot} candidats avec keywords: ${keywordsThisRound.join(', ')}`,
      );
      const findOut = await runSkill<
        {
          bioKeywords: string[];
          topics?: string[];
          target: number;
          locationPreset: 'usa' | 'worldwide';
          openDmFilter: 'strict' | 'off';
          excludeHandles: string[];
        },
        FindXProspectsOutput
      >('find_x_prospects', {
        bioKeywords: keywordsThisRound,
        topics: round === 0 ? currentXBusiness.icp.xTopics : undefined,
        target: overshoot,
        locationPreset,
        // CRITICAL: turn OFF the heuristic open-DM filter. The strict filter
        // was dropping 95% of candidates (3 found in 10 min). The actual
        // verification happens at send time — we attempt, 403s are skipped,
        // we keep going until target successes.
        openDmFilter: 'off',
        excludeHandles: Array.from(triedHandles),
      });
      apifyCost += findOut.stats.costUsdActual ?? 0;
      refreshCost();

      const newCandidates = findOut.prospects.filter(
        (p) => !triedHandles.has(p.handle.toLowerCase()),
      );

      // If find returned nothing new, expand keywords and try again
      if (newCandidates.length === 0) {
        if (round + 1 >= MAX_TOP_UP_ROUNDS) break;
        setStep(
          `🧠 Étape 3/4 — Expansion keywords (round ${round + 1})…`,
          `${verifiedOpens.length}/${target} DM-és. Aucun nouveau candidat trouvé, Claude génère de nouveaux angles.`,
        );
        const expansion = await runSkill<
          {
            business: typeof currentXBusiness;
            triedKeywords: string[];
            countNeeded: number;
            locationPreset: 'usa' | 'worldwide';
          },
          { keywords: string[]; rationale: string }
        >('expand_x_keywords', {
          business: currentXBusiness,
          triedKeywords: keywordBatches.flat(),
          countNeeded: 8,
          locationPreset,
        });
        if (expansion.keywords.length === 0) break;
        keywordBatches.push(expansion.keywords);
        continue;
      }

      // Track candidates for display + mark as tried.
      for (const p of newCandidates) {
        candidatesByHandle.set(p.handle.toLowerCase(), p);
        triedHandles.add(p.handle.toLowerCase());
      }

      // (b) Verify-by-send: try each candidate, stop when we have `needed` more successes.
      const handlesToTry = newCandidates.map((p) => p.handle);
      // Populate the manual textarea with the candidates being attempted so
      // the user can see who's being contacted at a glance.
      els.xHandles.value = handlesToTry.map((h) => `@${h}`).join('\n');
      setStep(
        `📨 Étape 4/4 — Vérification + envoi (${roundLabel}) — ${verifiedOpens.length}/${target}…`,
        `Tente ${handlesToTry.length} candidats. S'arrête à ${needed} envois réussis. Délai 5-12s humain.`,
      );
      els.xSendStatus.classList.remove('hidden');
      els.xSendStatusText.textContent = `Round ${round + 1}: ${handlesToTry.length} candidats, cible ${needed} succès…`;

      const sendOut = await sendDMsLive({
        template: currentXDM.template,
        handles: handlesToTry,
        variants: currentXDM.variants,
        targetSuccesses: needed,
        candidates: newCandidates.map((p) => ({
          handle: p.handle,
          name: p.name,
          bio: p.bio,
          followersCount: p.followersCount,
          verified: p.verified,
          score: p.score,
        })),
      });
      xApiCost += sendOut.cost.costUsdEstimate ?? 0;
      refreshCost();
      els.xSendStatus.classList.add('hidden');

      // Merge results — count both 'sent' and 'likely_sent' (X returned an
      // error code but the post-send verify confirmed the DM landed).
      for (const r of sendOut.results) {
        allSendResults.push(r);
        if (r.status === 'sent' || r.status === 'likely_sent') {
          const c = candidatesByHandle.get(r.handle.toLowerCase());
          if (c && !verifiedOpens.find((p) => p.handle.toLowerCase() === c.handle.toLowerCase())) {
            verifiedOpens.push(c);
          }
        }
      }

      // Re-render the prospects panel with ONLY verified opens — this is what
      // the user sees as "the prospects". The auto pipeline guarantees only
      // these have DMs open (we just proved it by sending).
      renderXProspects({
        prospects: verifiedOpens,
        query: findOut.query,
        stats: {
          ...findOut.stats,
          target,
          done: verifiedOpens.length >= target,
        },
      });
      els.xProspectsCard.classList.remove('hidden');

      // If we still need more, expand keywords for the next round
      if (verifiedOpens.length < target && round + 1 < MAX_TOP_UP_ROUNDS) {
        if (!keywordBatches[round + 1]) {
          setStep(
            `🧠 Top-up — Expansion keywords pour round ${round + 2}…`,
            `${verifiedOpens.length}/${target} DM-és. Génère de nouveaux angles.`,
          );
          const expansion = await runSkill<
            {
              business: typeof currentXBusiness;
              triedKeywords: string[];
              countNeeded: number;
              locationPreset: 'usa' | 'worldwide';
            },
            { keywords: string[]; rationale: string }
          >('expand_x_keywords', {
            business: currentXBusiness,
            triedKeywords: keywordBatches.flat(),
            countNeeded: 8,
            locationPreset,
          });
          if (expansion.keywords.length === 0) break;
          keywordBatches.push(expansion.keywords);
        }
      }
    }

    currentXProspects = verifiedOpens;

    // Render the full audit log of all sends (including the 🔒 fermés) in the
    // send results card. This is the transparency layer — user sees how many
    // candidates we actually had to attempt to get target verified opens.
    const aggregateSendOut: SendXDMsOutput = {
      results: allSendResults,
      sentCount: allSendResults.filter((r) => r.status === 'sent' || r.status === 'likely_sent').length,
      failedCount: allSendResults.filter((r) => r.status === 'failed').length,
      skippedCount: 0,
      stoppedEarly: false,
      cost: {
        userLookupCalls: allSendResults.length,
        dmSendCalls: allSendResults.length,
        dmSendSuccesses: allSendResults.filter((r) => r.status === 'sent' || r.status === 'likely_sent').length,
        costUsdEstimate: xApiCost,
      },
    };
    renderSendResults(aggregateSendOut, candidatesByHandle);

    const finalLabel = verifiedOpens.length >= target
      ? `✓ Pipeline terminé — ${verifiedOpens.length}/${target} DMs vérifiés envoyés`
      : `⚠️ Pipeline terminé — ${verifiedOpens.length}/${target} DMs vérifiés (pool de candidats épuisé)`;
    setStep(
      finalLabel,
      `Total candidats tentés : ${allSendResults.length}. Taux de succès : ${
        allSendResults.length > 0
          ? Math.round((100 * verifiedOpens.length) / allSendResults.length)
          : 0
      }%. Affichage uniquement des profils dont le DM est bien passé.`,
    );
  } catch (e) {
    showError(`Pipeline auto interrompu : ${(e as Error).message}`);
    setStep('✗ Pipeline interrompu', (e as Error).message);
  } finally {
    els.xAutoBtn.disabled = false;
    els.xRandomBtn.disabled = false;
    els.xFindBtn.disabled = !currentXBusiness;
    els.xGenDMBtn.disabled = currentXProspects.length === 0;
    els.xSendBtn.disabled = !currentXDM;
    els.xAutoBtn.textContent = autoOriginal;
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
els.xLinkBtn.addEventListener('click', xLogin);
els.xUnlinkBtn.addEventListener('click', xLogout);
els.xAutoBtn.addEventListener('click', xAutoPipeline);
els.xRandomBtn.addEventListener('click', xRandomBusiness);
els.xFindBtn.addEventListener('click', xFindProspects);
els.xGenDMBtn.addEventListener('click', xGenerateDM);
els.xSendBtn.addEventListener('click', xSendDMs);

// ---------- TikTok ----------

interface TikTokStatusResp {
  linked: boolean;
  displayName?: string;
  openId?: string;
  scopes?: string[];
}

interface PostTikTokVideoOutput {
  publishId: string;
  status: 'inbox_delivered' | 'published' | 'failed' | 'pending';
  failReason?: string;
  publicPostId?: string;
  videoSizeBytes: number;
  fellBackToInbox?: boolean;
  fallbackReason?: string;
}

async function refreshTikTokAuthStatus() {
  try {
    const status = await apiGet<TikTokStatusResp>('/api/auth/tiktok/status');
    if (status.linked) {
      els.ttAuthStatus.innerHTML = `<span class="x-linked-badge" style="background:rgba(43,212,160,0.15)">linked</span> Connecté en tant que <strong>${escapeHtml(status.displayName ?? status.openId ?? '?')}</strong>`;
      els.ttLinkBtn.classList.add('hidden');
      els.ttUnlinkBtn.classList.remove('hidden');
      els.ttPostBtn.disabled = false;
    } else {
      els.ttAuthStatus.innerHTML = `<span class="muted">Aucun compte TikTok linké.</span>`;
      els.ttLinkBtn.classList.remove('hidden');
      els.ttUnlinkBtn.classList.add('hidden');
      els.ttPostBtn.disabled = true;
    }
  } catch (e) {
    els.ttAuthStatus.innerHTML = `<span class="muted">Statut TikTok : erreur (${escapeHtml((e as Error).message)})</span>`;
  }
}

function tiktokLogin() {
  const w = window.open('/api/auth/tiktok/login', 'tiktok-oauth', 'width=720,height=720');
  if (!w) {
    window.location.href = '/api/auth/tiktok/login';
    return;
  }
  window.addEventListener('message', function once(ev) {
    if (ev.data?.type === 'tiktok_linked') {
      window.removeEventListener('message', once);
      refreshTikTokAuthStatus();
    }
  });
  let polls = 0;
  const poller = window.setInterval(async () => {
    polls++;
    if (polls > 20) { clearInterval(poller); return; }
    const s = await apiGet<TikTokStatusResp>('/api/auth/tiktok/status').catch(() => null);
    if (s?.linked) {
      clearInterval(poller);
      refreshTikTokAuthStatus();
    }
  }, 1500);
}

async function tiktokLogout() {
  try {
    await apiPost('/api/auth/tiktok/logout', {});
    refreshTikTokAuthStatus();
  } catch (e) {
    showError((e as Error).message);
  }
}

async function tiktokPost() {
  clearError();
  const mode = (els.ttMode.value as 'inbox' | 'direct') ?? 'direct';
  const privacy = (els.ttPrivacy.value as 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY') ?? 'SELF_ONLY';
  const caption = els.ttCaption.value.trim() || undefined;

  if (tiktokSource === 'file') {
    const file = els.ttFileInput.files?.[0];
    if (!file) {
      showError("Sélectionne un fichier vidéo à uploader.");
      return;
    }
    if (file.size > 64 * 1024 * 1024) {
      showError(`Fichier trop gros (${(file.size / 1_000_000).toFixed(1)} MB). Cap TikTok = 64 MB.`);
      return;
    }
    await tiktokPostFromFile(file, { mode, privacy, caption });
  } else {
    const videoUri = els.ttVideoUri.value.trim();
    if (!videoUri) {
      showError("Aucun videoUri à poster. Génère une vidéo Veo, ou bascule sur 'Upload fichier'.");
      return;
    }
    await tiktokPostFromVeoUri(videoUri, { mode, privacy, caption });
  }
}

interface TikTokPostParams {
  mode: 'inbox' | 'direct';
  privacy: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY';
  caption?: string;
}

async function tiktokPostFromVeoUri(videoUri: string, p: TikTokPostParams) {
  els.ttPostBtn.disabled = true;
  const original = els.ttPostBtn.textContent;
  els.ttPostBtn.textContent = '⏳ Upload…';
  els.ttStatus.classList.remove('hidden');
  els.ttResult.classList.add('hidden');
  els.ttStatusText.textContent = 'Upload de la vidéo Veo vers TikTok (download + PUT + poll)…';
  try {
    const out = await runSkill<
      {
        videoUri: string;
        caption?: string;
        mode: 'inbox' | 'direct';
        privacyLevel: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'SELF_ONLY';
      },
      PostTikTokVideoOutput
    >('post_tiktok_video', {
      videoUri,
      caption: p.caption,
      mode: p.mode,
      privacyLevel: p.privacy,
    });
    renderTikTokResult(out);
  } catch (e) {
    showError(`TikTok post failed: ${(e as Error).message}`);
  } finally {
    els.ttStatus.classList.add('hidden');
    els.ttPostBtn.disabled = false;
    els.ttPostBtn.textContent = original;
  }
}

async function tiktokPostFromFile(file: File, p: TikTokPostParams) {
  els.ttPostBtn.disabled = true;
  const original = els.ttPostBtn.textContent;
  els.ttPostBtn.textContent = '⏳ Upload fichier…';
  els.ttStatus.classList.remove('hidden');
  els.ttResult.classList.add('hidden');
  els.ttStatusText.textContent = `Upload du fichier (${(file.size / 1_000_000).toFixed(1)} MB) vers TikTok…`;

  try {
    // Caption goes in a header — base64-encoded to safely carry newlines/emoji.
    const captionB64 = p.caption
      ? btoa(unescape(encodeURIComponent(p.caption)))
      : '';
    const buf = await file.arrayBuffer();
    const res = await fetch('/api/tiktok/upload-and-post', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'video/mp4',
        'X-TikTok-Mode': p.mode,
        'X-TikTok-Privacy': p.privacy,
        ...(captionB64 ? { 'X-TikTok-Caption': captionB64 } : {}),
      },
      body: buf,
    });
    const body = (await res.json()) as PostTikTokVideoOutput & { error?: string };
    if (!res.ok) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    renderTikTokResult(body);
  } catch (e) {
    showError(`TikTok upload failed: ${(e as Error).message}`);
  } finally {
    els.ttStatus.classList.add('hidden');
    els.ttPostBtn.disabled = false;
    els.ttPostBtn.textContent = original;
  }
}

function renderTikTokResult(out: PostTikTokVideoOutput) {
  const statusBadge =
    out.status === 'published'
      ? '<span class="x-linked-badge" style="background:rgba(43,212,160,0.15)">✓ publié</span>'
      : out.status === 'inbox_delivered'
        ? '<span class="x-linked-badge" style="background:rgba(124,92,255,0.15)">📥 dans drafts TikTok</span>'
        : out.status === 'pending'
          ? '<span class="x-linked-badge" style="background:rgba(255,200,0,0.15)">⏳ traitement TikTok en cours</span>'
          : '<span class="x-linked-badge" style="background:rgba(255,80,80,0.15)">✗ échec</span>';
  const sizeStr = `${(out.videoSizeBytes / 1_000_000).toFixed(2)} MB`;
  const postUrl = out.publicPostId
    ? `<p>Lien post : <a href="https://www.tiktok.com/video/${escapeAttr(out.publicPostId)}" target="_blank" rel="noopener noreferrer">tiktok.com/video/${escapeHtml(out.publicPostId)}</a></p>`
    : '';
  const failBlock = out.failReason
    ? `<p class="muted small">Raison : <code>${escapeHtml(out.failReason)}</code></p>`
    : '';
  const inboxHint = out.status === 'inbox_delivered'
    ? '<p class="muted small">💡 Ouvre l\'app TikTok sur ton téléphone, va dans les drafts, ajoute caption/sound/hashtags et publie.</p>'
    : '';
  els.ttResultBody.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      ${statusBadge}
      <span class="muted small">publishId : <code>${escapeHtml(out.publishId)}</code></span>
      <span class="muted small">taille : ${sizeStr}</span>
    </div>
    ${postUrl}
    ${failBlock}
    ${inboxHint}
  `;
  els.ttResult.classList.remove('hidden');
}

els.ttLinkBtn.addEventListener('click', tiktokLogin);
els.ttUnlinkBtn.addEventListener('click', tiktokLogout);
els.ttPostBtn.addEventListener('click', tiktokPost);
refreshTikTokAuthStatus();

// Source toggle (Veo URI ↔ file upload)
function setTikTokSource(src: TikTokSource) {
  tiktokSource = src;
  const veoActive = src === 'veo';
  els.ttSourceVeoPanel.classList.toggle('hidden', !veoActive);
  els.ttSourceFilePanel.classList.toggle('hidden', veoActive);
  els.ttSourceVeoBtn.classList.toggle('tt-source-active', veoActive);
  els.ttSourceFileBtn.classList.toggle('tt-source-active', !veoActive);
}
els.ttSourceVeoBtn.addEventListener('click', () => setTikTokSource('veo'));
els.ttSourceFileBtn.addEventListener('click', () => setTikTokSource('file'));

// Show selected file info (name + size) so the user can confirm before posting.
els.ttFileInput.addEventListener('change', () => {
  const file = els.ttFileInput.files?.[0];
  if (!file) {
    els.ttFileInfo.classList.add('hidden');
    return;
  }
  const sizeMb = (file.size / 1_000_000).toFixed(2);
  const tooBig = file.size > 64 * 1024 * 1024;
  els.ttFileInfo.innerHTML = tooBig
    ? `<span style="color:var(--danger)">⚠️ ${escapeHtml(file.name)} — ${sizeMb} MB (dépasse le cap TikTok 64 MB)</span>`
    : `✓ ${escapeHtml(file.name)} · ${sizeMb} MB · ${escapeHtml(file.type || 'video/mp4')}`;
  els.ttFileInfo.classList.remove('hidden');
});


/**
 * Auto-generates a TikTok caption + hashtags from the UGC business + script
 * right after a video finishes rendering. Fires-and-forgets; the result is
 * cached in `lastTikTokCaption` and pushed into the TikTok panel form.
 */
async function autoGenerateTikTokCaption() {
  if (!lastUgcBusiness) return;
  // Compose the spoken script + concept as input for the caption generator.
  const videoScript = lastUgcVideoScript
    ? [lastUgcVideoScript.hook, lastUgcVideoScript.spokenLine, lastUgcVideoScript.concept]
        .filter(Boolean).join('\n')
    : undefined;
  // Show a small hint that we're generating in the UGC inline area too.
  els.ugcTikTokInline.classList.remove('hidden');
  els.ugcTikTokInline.textContent = '🤖 Génération auto de la caption + hashtags TikTok…';
  try {
    const out = await runSkill<
      { business: Business; videoScript?: string; languageName: string; maxHashtags: number },
      { caption: string; captionBody: string; hashtags: string[]; rationale: string }
    >('generate_tiktok_caption', {
      business: lastUgcBusiness,
      videoScript,
      languageName: 'English',
      maxHashtags: 5,
    });
    lastTikTokCaption = {
      caption: out.caption,
      captionBody: out.captionBody,
      hashtags: out.hashtags,
    };
    // Push into the TikTok panel
    els.ttCaption.value = out.caption;
    els.ttMode.value = 'direct';
    els.ttPrivacy.value = 'SELF_ONLY';
    els.ugcTikTokInline.innerHTML = `✓ Caption auto-générée (${out.hashtags.length} hashtags). Clique <strong>🎵 Post to TikTok</strong> pour poster direct.`;
  } catch (e) {
    els.ugcTikTokInline.innerHTML = `<span class="muted">Caption auto-gen failed: ${escapeHtml((e as Error).message)} — tu peux quand même poster, juste sans caption pré-remplie.</span>`;
  }
}

/**
 * Inline "Post to TikTok" on the Video UGC card. Pulls the most-recently
 * generated Veo URI, posts straight to the TikTok inbox of the linked user.
 * Sandbox-friendly defaults: mode='inbox', no caption (user finalizes in app).
 */
els.ugcPostTikTokBtn.addEventListener('click', async () => {
  if (!lastGeneratedVeoUri) {
    showError("Aucune vidéo UGC à poster. Génère-en une d'abord avec le bouton Generate.");
    return;
  }
  // Check linked first — if not, point user to the TikTok panel.
  try {
    const status = await apiGet<TikTokStatusResp>('/api/auth/tiktok/status');
    if (!status.linked) {
      els.ugcTikTokInline.classList.remove('hidden');
      els.ugcTikTokInline.innerHTML =
        '⚠️ Aucun compte TikTok lié. Va dans le panneau <strong>TikTok</strong> (sidebar) → <em>Link TikTok account</em>, puis reviens cliquer ici.';
      return;
    }
  } catch (e) {
    showError(`TikTok status check failed: ${(e as Error).message}`);
    return;
  }

  clearError();
  els.ugcPostTikTokBtn.disabled = true;
  const original = els.ugcPostTikTokBtn.textContent;
  els.ugcPostTikTokBtn.textContent = '⏳ Upload + post direct…';
  els.ugcTikTokInline.classList.remove('hidden');
  els.ugcTikTokInline.innerHTML = '⏳ Download Veo + upload TikTok + direct post… (30s à 2min)';

  try {
    // Direct post with auto-generated caption (sandbox forces SELF_ONLY).
    const caption = lastTikTokCaption?.caption ?? els.ttCaption.value.trim() ?? undefined;
    const out = await runSkill<
      { videoUri: string; caption?: string; mode: 'direct'; privacyLevel: 'SELF_ONLY' },
      PostTikTokVideoOutput
    >('post_tiktok_video', {
      videoUri: lastGeneratedVeoUri,
      caption,
      mode: 'direct',
      privacyLevel: 'SELF_ONLY',
    });
    const statusBadge =
      out.status === 'published' ? '✓ publié direct'
      : out.status === 'inbox_delivered'
        ? (out.fellBackToInbox
            ? '📥 fallback auto inbox (sandbox + compte non privé)'
            : '📥 dans tes drafts TikTok')
      : out.status === 'pending' ? '⏳ traitement TikTok en cours'
      : '✗ échec';
    const fallbackHint = out.fellBackToInbox
      ? `<p class="muted small" style="margin-top:6px">⚠️ TikTok sandbox refuse direct post tant que l'app n'est pas auditée OU que ton compte n'est pas privé. On a re-tenté en inbox automatiquement — la vidéo est dans tes drafts. Ouvre l'app TikTok → Drafts → ajoute caption/sound → publie.<br><span class="muted">Pour avoir direct post tout de suite : passe ton compte en privé (Settings → Privacy → Private account). Pour public + auto : attends l'audit.</span></p>`
      : (out.status === 'inbox_delivered'
          ? `<p class="muted small" style="margin-top:6px">💡 Ouvre l'app TikTok → Drafts → finalise + publie.</p>`
          : '');
    const linkBlock = out.publicPostId
      ? ` · <a href="https://www.tiktok.com/video/${escapeAttr(out.publicPostId)}" target="_blank" rel="noopener noreferrer">voir sur TikTok ↗</a>`
      : '';
    const captionPreview = caption
      ? `<details style="margin-top:6px"><summary class="muted small">📝 caption postée</summary><pre style="white-space:pre-wrap;font-size:12px;margin:6px 0">${escapeHtml(caption)}</pre></details>`
      : '';
    const failBlock = out.failReason ? ` <code>${escapeHtml(out.failReason)}</code>` : '';
    els.ugcTikTokInline.innerHTML = `<strong>${statusBadge}</strong> · publishId <code>${escapeHtml(out.publishId)}</code>${linkBlock}${failBlock}${captionPreview}${fallbackHint}`;
  } catch (e) {
    els.ugcTikTokInline.innerHTML = `<span style="color:var(--danger)">✗ ${escapeHtml((e as Error).message)}</span>`;
  } finally {
    els.ugcPostTikTokBtn.disabled = false;
    els.ugcPostTikTokBtn.textContent = original;
  }
});

// Editable tag lists — keywords + topics
function wireTagAdder(input: HTMLInputElement, button: HTMLButtonElement, listEl: HTMLElement, getItems: () => string[] | null) {
  const add = () => {
    const items = getItems();
    if (!items) return;
    addTagFromInput(input, items, listEl);
  };
  button.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });
}
wireTagAdder(els.xBioKwAdd, els.xBioKwAddBtn, els.xBioKeywords, () => currentXBusiness?.icp.xBioKeywords ?? null);
wireTagAdder(els.xTopicAdd, els.xTopicAddBtn, els.xTopics, () => currentXBusiness?.icp.xTopics ?? null);

init()
  .then(() => refreshXAuthStatus())
  .catch((e) => showError((e as Error).message));
