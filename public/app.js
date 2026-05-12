const $ = (id) => document.getElementById(id);

const els = {
  sectionsNav: $('sectionsNav'),
  skillsFlow: $('skillsFlow'),
  sectionTitle: $('sectionTitle'),
  sectionDesc: $('sectionDesc'),
  lang: $('lang'),
  aspect: $('aspect'),
  biz: $('biz'),
  randomBtn: $('randomBtn'),
  genVideoBtn: $('genVideoBtn'),
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
  videoPlayer: $('videoPlayer'),
  videoActions: $('videoActions'),
  downloadBtn: $('downloadBtn'),
  audioHint: $('audioHint'),
  promptModal: $('promptModal'),
  modalKicker: $('modalKicker'),
  modalTitle: $('modalTitle'),
  modalDesc: $('modalDesc'),
  modalPrompt: $('modalPrompt'),
  modalMeta: $('modalMeta'),
};

let REGISTRY = [];
let ACTIVE_SECTION = 'ai-ugc';
let currentBusiness = null;
let currentVideo = null;
let currentVeoPrompt = null;
let pollTimer = null;
let startedAt = null;

// ---------- Init ----------
async function init() {
  const res = await fetch('/api/skills');
  REGISTRY = await res.json();
  renderSidebar();
  selectSection(ACTIVE_SECTION);
}

function renderSidebar() {
  els.sectionsNav.innerHTML = '';
  for (const section of REGISTRY) {
    const btn = document.createElement('button');
    btn.className = 'skill-item' + (section.id === ACTIVE_SECTION ? ' active' : '');
    btn.dataset.section = section.id;
    btn.innerHTML = `<span class="skill-icon">${section.icon || '✨'}</span><span class="skill-label">${section.name}</span>`;
    btn.addEventListener('click', () => selectSection(section.id));
    els.sectionsNav.appendChild(btn);
  }
}

function selectSection(id) {
  ACTIVE_SECTION = id;
  document.querySelectorAll('.skill-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.section === id)
  );
  const section = REGISTRY.find((s) => s.id === id);
  if (!section) return;
  els.sectionTitle.textContent = section.name;
  els.sectionDesc.textContent = section.description || '';
  renderSkillsFlow(section);
}

function renderSkillsFlow(section) {
  els.skillsFlow.innerHTML = '';
  for (const skill of section.skills) {
    const chip = document.createElement('div');
    chip.className = 'skill-chip';
    chip.dataset.skillId = skill.id;
    chip.innerHTML = `
      <span class="chip-type">${skill.type}</span>
      <div class="chip-head">
        <span class="chip-order">${skill.order}</span>
        <span>${skill.name}</span>
        <span class="chip-status">idle</span>
      </div>
      <div class="chip-desc">${skill.description}</div>
    `;
    chip.addEventListener('click', () => openPromptModal(section, skill));
    els.skillsFlow.appendChild(chip);
  }
}

// ---------- Modal ----------
function openPromptModal(section, skill) {
  els.modalKicker.textContent = `${section.name} · Skill ${skill.order}`;
  els.modalTitle.textContent = skill.name;
  els.modalDesc.textContent = skill.description || '';

  els.modalMeta.innerHTML = '';
  const addTag = (label) => {
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
    ? skill.prompt
    : '(Cette skill est de type "api" et n\'utilise pas de prompt LLM — elle appelle directement l\'API ' + (skill.endpoint || '') + '.)';

  els.promptModal.classList.remove('hidden');
}

function closeModal() { els.promptModal.classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());

// ---------- Skill state UI ----------
function setSkillStatus(skillId, status) {
  const chip = document.querySelector(`.skill-chip[data-skill-id="${skillId}"]`);
  if (!chip) return;
  chip.classList.remove('running', 'done', 'failed');
  if (status === 'running' || status === 'done' || status === 'failed') chip.classList.add(status);
  const lbl = chip.querySelector('.chip-status');
  if (lbl) lbl.textContent = status;
}

function resetSkillsStatus() {
  document.querySelectorAll('.skill-chip').forEach((chip) => {
    chip.classList.remove('running', 'done', 'failed');
    const lbl = chip.querySelector('.chip-status');
    if (lbl) lbl.textContent = 'idle';
  });
}

// ---------- Error / video reset ----------
function showError(msg) {
  els.errorBox.textContent = msg;
  els.errorBox.classList.remove('hidden');
}
function clearError() { els.errorBox.classList.add('hidden'); els.errorBox.textContent = ''; }

function resetVideoCard() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  els.videoCard.classList.add('hidden');
  els.videoPlayer.classList.add('hidden');
  els.videoPlayer.removeAttribute('src');
  els.videoActions.classList.add('hidden');
  els.audioHint.classList.add('hidden');
  els.videoStatus.classList.remove('hidden');
}

// ---------- Skill runners ----------
async function runSkill(sectionId, skillId, body) {
  setSkillStatus(skillId, 'running');
  const res = await fetch(`/api/skills/${sectionId}/${skillId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    setSkillStatus(skillId, 'failed');
    throw new Error(data.error || `${skillId} a échoué`);
  }
  setSkillStatus(skillId, 'done');
  return data;
}

// ---------- Pipeline: create idea + script + adapt ----------
async function generateIdea() {
  clearError();
  resetVideoCard();
  resetSkillsStatus();
  currentBusiness = null; currentVideo = null; currentVeoPrompt = null;
  els.ideaCard.classList.add('hidden');
  els.genVideoBtn.disabled = true;
  els.randomBtn.disabled = true;
  const original = els.randomBtn.textContent;
  els.randomBtn.textContent = '⏳ Génération…';

  try {
    // Skill 1
    const s1 = await runSkill('ai-ugc', 'create-business-idea', {
      language: els.lang.value,
      businessType: els.biz.value || undefined,
    });
    currentBusiness = s1.business;

    // Skill 2
    const s2 = await runSkill('ai-ugc', 'generate-video-script', {
      business: currentBusiness,
      language: els.lang.value,
    });
    currentVideo = s2.video;

    // Skill 3
    const s3 = await runSkill('ai-ugc', 'adapt-to-veo-prompt', {
      business: currentBusiness,
      video: currentVideo,
      language: els.lang.value,
    });
    currentVeoPrompt = s3.veoPrompt;

    // Render
    els.bizName.textContent = currentBusiness?.name || '—';
    els.bizType.textContent = currentBusiness?.type || '';
    els.bizPitch.textContent = currentBusiness?.pitch || '';
    els.bizTarget.textContent = currentBusiness?.target || '';
    els.vHook.textContent = currentVideo?.hook || '';
    els.vConcept.textContent = currentVideo?.concept || '';
    els.vSpoken.textContent = currentVideo?.spokenLine ? `« ${currentVideo.spokenLine} »` : '';
    els.vPrompt.textContent = currentVeoPrompt || '';
    els.ideaCard.classList.remove('hidden');
    els.genVideoBtn.disabled = false;
  } catch (e) {
    showError(e.message);
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
    const out = await runSkill('ai-ugc', 'generate-video', {
      veoPrompt: currentVeoPrompt,
      aspectRatio: els.aspect.value,
    });
    pollOperation(out.operationName);
  } catch (e) {
    showError(e.message);
    els.videoCard.classList.add('hidden');
    els.genVideoBtn.disabled = false;
  }
}

function pollOperation(name) {
  const tick = async () => {
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    els.elapsed.textContent = `(${elapsed}s)`;
    els.statusText.textContent =
      elapsed < 30 ? 'Génération en cours…'
      : elapsed < 90 ? 'Rendu vidéo… (1-3 min)'
      : 'Finalisation…';

    try {
      const res = await fetch(`/api/video-status?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'erreur polling');

      if (data.done) {
        clearInterval(pollTimer);
        pollTimer = null;
        if (!data.videoUri) {
          showError('Opération terminée mais aucune vidéo retournée.\n' + JSON.stringify(data.raw || {}, null, 2));
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
      clearInterval(pollTimer);
      pollTimer = null;
      showError(e.message);
      els.genVideoBtn.disabled = false;
    }
  };
  tick();
  pollTimer = setInterval(tick, 10000);
}

els.randomBtn.addEventListener('click', generateIdea);
els.genVideoBtn.addEventListener('click', generateVideo);

init();
