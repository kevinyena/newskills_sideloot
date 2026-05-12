# AI Skills Hub

Interface modulaire de skills IA pour agents — **skills implémentées en TypeScript**, structurées pour être directement portables vers `apps/core_app/worker/src/skills/` (Mintery) ou tout autre runtime d'agent qui suit le pattern `BaseSkill`.

**Stack** : TypeScript (backend `tsx` + frontend bundlé via `esbuild`), Express, **Claude Opus 4.7** (skills LLM), **Veo 3.1** (génération vidéo).

## Architecture des skills

```
src/skills/
├── BaseSkill.ts                                ← interface compat Mintery (clonée)
├── runtime/
│   ├── anthropic.ts                            ← wrapper Claude (Opus 4.7, adaptive thinking, structured outputs)
│   ├── veo.ts                                  ← wrapper Veo 3.1 (start/poll/proxy + blocking helper)
│   └── render.ts                               ← interpolation {{var}} dans les prompts
├── video_ugc/                                  ← 1 catégorie = 1 section dans l'UI
│   ├── CreateBusinessIdeaSkill.ts              ← skill 1 (llm)
│   ├── GenerateVideoScriptSkill.ts             ← skill 2 (llm)
│   ├── AdaptToVeoPromptSkill.ts                ← skill 3 (llm)
│   └── GenerateVeoVideoSkill.ts                ← skill 4 (api)
└── index.ts                                    ← registry + sectioning dynamique par category
```

**Une catégorie = un dossier = une section dans l'UI.** Pour ajouter une nouvelle catégorie (ex: `email_outreach/`, `seo/`), il suffit de créer le dossier, y poser les classes, et d'ajouter une ligne dans `CATEGORY_DISPLAY` de `index.ts` pour son nom + icône + ordre dans la sidebar.

## Pattern de skill (compat Mintery)

Chaque skill est une classe TypeScript qui implémente `BaseSkill<TInput, TOutput>` :

```ts
export interface BaseSkill<TInput, TOutput> {
  name: string;                       // ID technique (snake_case)
  description: string;                // visible LLM + UI
  schema: z.ZodTypeAny;               // validation des inputs
  execute(input: TInput, ctx?: SkillContext): Promise<TOutput>;

  // Métadonnées UI optionnelles (ignorées par Mintery) :
  displayName?: string;
  category?: string;                  // 'creative', 'media', …
  order?: number;
  type?: 'llm' | 'api';
  model?: string;
  prompt?: string;                    // template visible dans l'UI
  endpoint?: string;
}
```

Les 4 champs requis (`name`, `description`, `schema`, `execute`) **correspondent 1:1** à l'interface `BaseSkill` de Mintery (`apps/core_app/worker/src/skills/BaseSkill.ts`). Migration future = `cp -r src/skills/creative apps/core_app/worker/src/skills/marketing/`.

### Exemple — `CreateBusinessIdeaSkill.ts`

```ts
const InputSchema = z.object({ businessType: z.string(), languageName: z.string() });
const OutputSchema = z.object({ name: z.string(), type: z.string(), pitch: z.string(), target: z.string() });

const PROMPT = `# RÔLE\nTu es le meilleur CMO du monde...`;

export class CreateBusinessIdeaSkill implements BaseSkill<Input, Business> {
  name = 'create_business_idea';
  description = '…';
  schema = InputSchema;

  category = 'video_ugc';
  order = 1;
  type = 'llm' as const;
  model = 'claude-opus-4-7';
  prompt = PROMPT;

  async execute(input, _ctx) {
    return callClaude({
      userMessage: renderTemplate(this.prompt, input),
      schema: OutputSchema,
      effort: 'high',
    });
  }
}
```

## Skills enregistrées

| # | Skill (technical name) | Type | Modèle | Rôle |
|---|---|---|---|---|
| 1 | `create_business_idea` | llm | claude-opus-4-7 | Génère une idée business viable et différenciante |
| 2 | `generate_video_script` | llm | claude-opus-4-7 | Conçoit un concept UGC viral (hook, concept, réplique) |
| 3 | `adapt_to_veo_prompt` | llm | claude-opus-4-7 | Transforme le script en prompt Veo 3.1 photoréaliste |
| 4 | `generate_veo_video` | api | veo-3.1-generate-preview | Génère la vidéo finale 8s avec audio synchronisé |

## API

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/skills` | Retourne `SerializedSection[]` (sections + skills + prompts + schémas JSON) |
| `POST` | `/api/skills/:name/run` | Runner générique. Valide via `skill.schema` puis appelle `skill.execute()`. Retourne `{ output }` |
| `POST` | `/api/veo/start` | Démarre une génération Veo, retourne `{ operationName }` |
| `GET` | `/api/veo/status?name=…` | Poll d'une opération Veo |
| `GET` | `/api/veo/proxy?uri=…` | Proxy authentifié pour télécharger la vidéo |

Les endpoints Veo split (`/start` + `/status` + `/proxy`) servent l'UI interactive avec progression live. Les agents Mintery utiliseront plutôt `GenerateVeoVideoSkill.execute()` qui bloque jusqu'à completion.

## Ajouter une skill

1. Crée `src/skills/<category>/MaSkill.ts` (classe implémentant `BaseSkill`)
2. Définis `InputSchema` (Zod) + `OutputSchema` (Zod)
3. Implémente `execute(input, ctx?)`
4. Ajoute l'instance dans `ALL_SKILLS` de `src/skills/index.ts`
5. Si c'est une nouvelle catégorie, ajoute une ligne dans `CATEGORY_DISPLAY`
6. Restart — la skill apparaît automatiquement dans l'UI

Le serveur ne change jamais — c'est un thin host par-dessus le registry.

## Migration vers Mintery

```bash
# Dans Mintery (branche pre-prd, architecture, etc.)
cp -r path/to/newskills_sideloot/src/skills/video_ugc  apps/core_app/worker/src/skills/video_ugc/
cp    path/to/newskills_sideloot/src/skills/runtime/anthropic.ts  apps/core_app/worker/src/lib/
cp    path/to/newskills_sideloot/src/skills/runtime/veo.ts        apps/core_app/worker/src/lib/
```

Les classes n'ont **aucune dépendance** vers ce repo — elles importent uniquement `BaseSkill`, `z`, et leurs runtimes. Mintery a déjà `BaseSkill`, donc les imports `../BaseSkill.js` sont juste à rediriger vers son chemin local.

## Installation

```bash
npm install
cp .env.example .env   # remplir ANTHROPIC_API_KEY + GEMINI_API_KEY
npm start              # build client + run server
# ou
npm run dev            # watch mode (tsx watch + esbuild --watch)
```

Ouvre http://localhost:3000

## Scripts

| Script | Rôle |
|---|---|
| `npm start` | Build le client puis lance le serveur (`tsx`) |
| `npm run dev` | Mode watch : `tsx watch` + `esbuild --watch` en parallèle |
| `npm run build:client` | Bundle `src/client/app.ts` → `public/app.js` |
| `npm run typecheck` | `tsc --noEmit` |

## Pré-requis

- **Node.js 18+** (pour `fetch` natif)
- **Clé API Anthropic** — utilisée par les 3 skills LLM. https://console.anthropic.com/settings/keys
- **Clé API Google AI** avec **facturation activée** — utilisée par `generate_veo_video` (Veo 3.1 inaccessible sur le tier gratuit). https://aistudio.google.com/apikey
