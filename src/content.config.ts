import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const uscisQuarterlyStats = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/uscisQuarterlyStats" }),
  schema: z.object({
    formType: z.string(),        // e.g. "I-485"
    formName: z.string(),        // e.g. "Adjustment of Status"
    category: z.string().optional(),
    fiscalYear: z.number(),
    quarter: z.number(),         // 1-4
    receipts: z.number().optional(),
    approved: z.number().optional(),
    denied: z.number().optional(),
    completions: z.number().optional(),
    pending: z.number().optional(),
    processingTimeMonths: z.number().nullable().optional(),
    approvalRate: z.number().nullable().optional(),
    denialRate: z.number().nullable().optional(),
    rfeRate: z.number().optional(),   // % of cases issued a Request for Evidence
    subtypes: z.array(z.object({
      subtypeName: z.string(),
      receipts: z.number().optional(),
      approved: z.number().optional(),
      denied: z.number().optional(),
      completions: z.number().optional(),
      pending: z.number().optional(),
      processingTimeMonths: z.number().nullable().optional(),
    })).optional(),
    dataSource: z.string().optional(),
    reportUrl: z.string().optional(),
    sourceUrl: z.string(),        // the exact USCIS XLSX this came from
    lastUpdated: z.string(),     // ISO date
    staleSince: z.string().optional(),
  }),
});

const visaBulletin = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/visaBulletin" }),
  schema: z.object({
    month: z.string(),
    category: z.string(),
    country: z.string(),
    finalActionDate: z.string().nullable(),
    dateForFiling: z.string().nullable(),
    dataSource: z.string().default('seed'),
    staleSince: z.string().optional(),
  }),
});

// Per-form USCIS processing times (mirrors egov.uscis.gov/processing-times API shape)
const caseTypeSchema = z.object({
  caseType: z.string(),
  minMonths: z.number(),
  maxMonths: z.number(),
  serviceRequestDate: z.string().nullable(),
  history: z.array(z.object({
    period: z.string(),      // "2026-05"
    min: z.number(),
    max: z.number(),
  })).default([]),
});

const serviceCenterSchema = z.object({
  name: z.string(),
  slug: z.string(),
  code: z.string(),
  cases: z.array(caseTypeSchema),
});

const processingTimes = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/processingTimes" }),
  schema: z.object({
    visaSlug: z.string(),          // URL key, e.g. "h1b-visa"
    visaLabel: z.string(),         // e.g. "H-1B Visa"
    formType: z.string(),          // e.g. "I-129"
    formName: z.string(),
    category: z.enum(['work-visas', 'green-card', 'student', 'dependent', 'citizenship', 'other']),
    seoTitle: z.string(),
    seoDesc: z.string(),
    lastUpdated: z.string(),
    dataSource: z.string().default('seed'),
    staleSince: z.string().optional(),
    sourceUrl: z.string().optional(),
    servicecenters: z.array(serviceCenterSchema),
    relatedPages: z.array(z.string()).default([]),
    seoText: z.string().default(''),
    faqs: z.array(z.object({ q: z.string(), a: z.string() })).default([]),
  }),
});

// State Dept appointment wait times by country
const appointmentWaitTimes = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/appointmentWaitTimes" }),
  schema: z.object({
    country: z.string(),
    slug: z.string(),
    countryCode: z.string(),
    lastUpdated: z.string(),
    dataSource: z.string().default('seed'),
    staleSince: z.string().optional(),
    sourceUrl: z.string().optional(),
    consulates: z.array(z.object({
      name: z.string(),
      waitTimeB1B2: z.number().nullable(),
      waitTimeStudent: z.number().nullable(),
      waitTimeOther: z.number().nullable(),
      waitTimePetition: z.number().nullable().optional(),
      waitTimeCrewTransit: z.number().nullable().optional(),
      hasEmergencyAppointments: z.boolean().default(false),
      notes: z.string().default(''),
      history: z.array(z.object({
        period: z.string(),
        waitTimeB1B2: z.number().nullable(),
      })).default([]),
    })),
  }),
});

const blog = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishDate: z.string(),
    author: z.string().default('US Visa Tracker Team'),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    image: z.string().optional(),
  }),
});

const lca = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/lca" }),
  schema: z.object({
    employerName: z.string(),
    slug: z.string(),
    totalLCAs: z.number(),
    approvalRate: z.number(),
    avgWage: z.number(),
    medianWage: z.number(),
    topTitles: z.array(z.object({
      title: z.string(),
      count: z.number(),
      avgWage: z.number(),
      socCode: z.string(),
    })),
    topStates: z.array(z.object({ state: z.string(), count: z.number() })),
    wageLevelDist: z.object({ L1: z.number(), L2: z.number(), L3: z.number(), L4: z.number() }),
    fiscalYear: z.number(),
    grade: z.string(),   // A, B, C, D, F
    lastUpdated: z.string(),
  }),
});

export const collections = { uscisQuarterlyStats, visaBulletin, processingTimes, appointmentWaitTimes, blog, lca };
