import { z } from 'zod'
import { figureSchema } from './news-figure-schema.js'

export const Pillar = z.enum(['macro', 'politics', 'business', 'tech'])
export const Topics = {
  macro: ['rates', 'growth', 'dollar', 'recession'],
  politics: ['france', 'europe', 'gulf', 'east-asia', 'sahel', 'americas'],
  business: ['north-america', 'europe', 'china', 'india', 'gulf', 'latin-america', 'compute', 'finance', 'industrial', 'consumer', 'health', 'energy', 'other'],
  tech: ['research', 'models', 'infrastructure', 'applications', 'adoption'],
} as const
// Expose the actual IDs in JSON Schema, not just a runtime-only refinement.
// Agents otherwise see a plain string and have to discover invalid tags by retrying.
export const TopicIds = Object.entries(Topics).flatMap(([pillar,keys])=>keys.map(key=>`${pillar}:${key}`))
export const Topic = z.enum(TopicIds as [string,...string[]])
export const ModelName = z.string().regex(/^gpt-[a-z0-9.-]{1,80}$/)
export const SafeUrl = z.url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password }, 'Public HTTPS URL required')
export const Source = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,80}$/), name: z.string().min(1).max(160),
  family: z.enum(['news', 'opinion', 'research', 'markets']),
  recommendation: z.enum(['start', 'reserve', 'hold']),
  homepage: SafeUrl, endpoint: SafeUrl.nullable(), adapter: z.enum(['feed', 'search', 'pending']),
  pillars: z.array(Pillar).min(1).max(4), enabled: z.boolean(),
  processing: z.enum(['metadata', 'feed-text']), rightsNote: z.string().max(4000),
  rightsUrl: SafeUrl.nullable(), cadenceMinutes: z.number().int().min(15).max(10080),
}).strict().superRefine((source, ctx) => {
  if (source.enabled && (source.recommendation === 'hold' || source.adapter === 'pending' || (source.adapter === 'feed' && !source.endpoint))) ctx.addIssue({ code: 'custom', message: 'Resolve access and adapter gates before enabling' })
  if (source.processing === 'feed-text' && (!source.rightsUrl || source.rightsNote.length < 20)) ctx.addIssue({ code: 'custom', message: 'Record the basis for text processing first' })
})
export const Settings = z.object({
  charter: z.string().min(100).max(60000), priorities: z.string().max(12000),
  mainModel: ModelName, helperModel: ModelName, researchModel: ModelName,
  // Existing desks retain their research-model reviewer until the owner changes it.
  reviewModel: ModelName.optional(),
  targetUsd: z.number().min(0).max(100), softUsd: z.number().min(0).max(100), hardUsd: z.number().min(0).max(100),
  dailyStoryTarget: z.number().int().min(0).max(12).describe('Soft target for total deeper stories, not a quota or a per-category allocation. Quality determines the final count and mix; zero permits digest-only editions.'), wordsPerStory: z.number().int().min(50).max(800),
  searchEnabled: z.boolean().default(true),
  schedule: z.object({ enabled:z.boolean(), hour:z.number().int().min(0).max(23), minute:z.number().int().min(0).max(59), timezone:z.string().max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true}catch{return false}},'Unknown time zone') }).strict().default({enabled:false,hour:7,minute:0,timezone:'America/New_York'}),
}).strict().refine(s => s.targetUsd <= s.softUsd && s.softUsd <= s.hardUsd, 'Budget thresholds must be ordered')

// Read historical settings and immutable run snapshots without rewriting them.
// New API writes use Settings directly, so agents see only the current contract.
export function readStoredSettings(input: unknown) {
  if (input && typeof input === 'object' && !Array.isArray(input) && 'storiesPerPillar' in input) {
    const { storiesPerPillar, ...rest } = input as Record<string, unknown>
    const oldTarget = z.number().int().min(0).max(3).parse(storiesPerPillar)
    return Settings.parse({ ...rest, dailyStoryTarget: rest.dailyStoryTarget ?? oldTarget * 4 })
  }
  return Settings.parse(input)
}
export const Citation = z.object({ itemId: z.uuid(), locator: z.string().min(3).max(1500), researchId:z.uuid().nullable().default(null) }).strict()
// The editor composes figures as data, never executable HTML, SVG or JavaScript.
// Optional fields preserve the hashes of already reviewed/published editions.
export const StoryFigure = figureSchema({ citations:z.array(Citation).min(1).max(6) })
export const Story = z.object({
  id: z.string().min(1).max(80), pillar: Pillar, title: z.string().min(5).max(220),
  body: z.string().min(30).max(10000), citations: z.array(Citation).min(1).max(8),
  visuals: z.array(StoryFigure).max(4).optional(),
}).strict().superRefine((story, ctx) => {
  const figures = story.visuals || [], paragraphs = story.body.trim().split(/\n\s*\n/).length
  if (new Set(figures.map(v => v.id)).size !== figures.length) ctx.addIssue({ code: 'custom', message: 'Duplicate figure IDs' })
  if (figures.some(v => v.afterParagraph > paragraphs)) ctx.addIssue({ code: 'custom', message: 'Figure must follow an existing paragraph' })
})
export const Headline = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,80}$/), pillar: Pillar,
  title: z.string().min(5).max(180), body: z.string().min(40).max(1200),
  // Event time, not retrieval time. Background must say so in the reader's text.
  eventDate: z.iso.date(), citations: z.array(Citation).min(1).max(4),
}).strict()
export const LibraryEntry = z.object({ itemId: z.uuid(), topics: z.array(Topic).min(1).max(12), annotation: z.string().min(10).max(1500) }).strict()
export const Draft = z.object({
  date: z.iso.date(), cutoff: z.iso.datetime(), stories: z.array(Story).max(12),
  headlines: z.array(Headline).max(12).optional(),
  library: z.array(LibraryEntry).max(40), coverageGaps: z.array(z.string().max(1000)).max(20),
  rejected: z.array(z.object({ itemId: z.uuid(), reason: z.string().max(600) }).strict()).max(50),
  marketPlacements: z.array(z.object({marketId:z.uuid(),topic:Topic,reason:z.string().min(5).max(600)}).strict()).max(12).default([]),
}).strict().superRefine((d, ctx) => {
  if (new Set(d.stories.map(s => s.id)).size !== d.stories.length) ctx.addIssue({ code: 'custom', message: 'Duplicate story IDs' })
  const ids = [...d.stories, ...(d.headlines || [])].map(s => s.id)
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Story and headline IDs must be distinct' })
  if (d.headlines?.some(s => s.eventDate > d.cutoff.slice(0,10))) ctx.addIssue({ code: 'custom', message: 'Headline event date exceeds the cutoff' })
  if (new Set(d.library.map(s => s.itemId)).size !== d.library.length) ctx.addIssue({ code: 'custom', message: 'Duplicate library items' })
  if (new Set(d.marketPlacements.map(s => s.marketId)).size !== d.marketPlacements.length) ctx.addIssue({ code: 'custom', message: 'Duplicate market placements' })
})
export type SourceConfig = z.infer<typeof Source>
export type EditorialSettings = z.infer<typeof Settings>
export type DraftContent = z.infer<typeof Draft>
export function editorialClaims(content: DraftContent) {
  return [...content.stories.map(s => ({ id:s.id, citations:s.citations })),
    ...(content.headlines || []).map(s => ({ id:s.id, citations:s.citations })),
    ...content.stories.flatMap(s => (s.visuals || []).map(v => ({ id:`${s.id}/${v.id}`, citations:v.citations })))]
}
// The executor returns a receipt for durable private content, not another copy
// of the edition that could diverge from the reviewed text or be truncated.
export const DraftReceipt = z.object({ contentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
