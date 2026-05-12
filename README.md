# AI Skills Hub

Interface modulaire de skills IA pour agents, structurée par section. Chaque skill est un dossier autonome avec son prompt et ses métadonnées, chargé dynamiquement par le serveur.

## Structure des skills

```
skills/
├── loader.js                  Charge récursivement le registre depuis le filesystem
└── <section-id>/              Une section = un groupe de skills (ex: ai-ugc)
    ├── section.json           Métadonnées de la section
    └── <NN-skill-id>/         Un dossier = une skill
        ├── meta.json          Métadonnées (type, model, inputs, outputs)
        └── prompt.md          Prompt template (LLM skills uniquement)
```

### Format `section.json`

```json
{
  "id": "ai-ugc",
  "name": "AI UGC",
  "icon": "🎬",
  "description": "...",
  "order": 1
}
```

### Format `meta.json`

```json
{
  "id": "create-business-idea",
  "order": 1,
  "name": "Create Business Idea",
  "description": "...",
  "type": "llm",
  "model": "gemini-2.5-flash",
  "inputs": ["language", "businessType"],
  "outputs": ["business"]
}
```

- `type: "llm"` → requiert un `prompt.md` adjacent. Le serveur substitue les variables `{{var}}` du template.
- `type: "api"` → pas de prompt, appelle directement une API tierce (Veo, etc.).

### Format `prompt.md`

Markdown libre, avec interpolation de variables via `{{nomVariable}}`. Les objets sont auto-sérialisés en JSON par le loader.

## Sections actuelles

### 🎬 AI UGC

Pipeline de création UGC viral, du concept business à la vidéo générée par Veo 3.1.

| # | Skill | Type | Rôle |
|---|-------|------|------|
| 1 | Create Business Idea | `llm` (Gemini 2.5 Flash) | Génère une idée de business viable et différenciante |
| 2 | Generate Video Script | `llm` (Gemini 2.5 Flash) | Conçoit un concept vidéo UGC viral (hook, concept, réplique) |
| 3 | Adapt Script to Veo Prompt | `llm` (Gemini 2.5 Flash) | Transforme le script en prompt Veo 3.1 photoréaliste avec dialogue audible |
| 4 | Generate Video (Veo 3.1) | `api` (`veo-3.1-generate-preview`) | Appelle Veo 3.1, génère la vidéo finale 8s avec audio synchronisé |

## API

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `GET` | `/api/skills` | Retourne le registre complet (sections + skills + prompts) |
| `POST` | `/api/reload-skills` | Recharge le registre depuis le filesystem |
| `POST` | `/api/skills/:section/:skill/run` | Exécute une skill avec les inputs en body JSON |
| `GET` | `/api/video-status?name=...` | Poll d'une opération Veo en cours |
| `GET` | `/api/video-proxy?uri=...` | Proxy authentifié pour télécharger la vidéo générée |

## Installation

```bash
npm install
cp .env.example .env   # puis remplir GEMINI_API_KEY
npm start
```

Ouvre http://localhost:3000

## Pré-requis

- **Node.js 18+** (pour `fetch` natif)
- **Clé API Google AI** avec **facturation activée** — Veo 3.1 n'est pas accessible sur le tier gratuit. Obtenir une clé : https://aistudio.google.com/apikey

## Ajouter une nouvelle skill

1. Crée le dossier `skills/<section>/<NN-skill-id>/`
2. Ajoute `meta.json` (et `prompt.md` si LLM)
3. Si la skill nécessite une logique custom (API tierce, transformation), ajoute le handler dans `server.js`
4. `POST /api/reload-skills` ou redémarre le serveur

Pour une **nouvelle section**, crée `skills/<section-id>/section.json` puis ajoute les skills dedans.
