import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { graphql } from '@octokit/graphql';
import OpenAI from 'openai';
import Database from 'better-sqlite3';
import path from 'path';

dotenv.config();

const DB_PATH = path.join(process.cwd(), 'cache.db');
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds for AI timeline cache
const GITHUB_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds for GitHub data

// Initialize SQLite database
const db = new Database(DB_PATH);

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_timeline_cache (
    cache_key TEXT PRIMARY KEY,
    result TEXT,
    timestamp INTEGER,
    failed INTEGER DEFAULT 0
  );
  
  CREATE TABLE IF NOT EXISTS github_cache (
    id INTEGER PRIMARY KEY,
    data TEXT,
    timestamp INTEGER,
    last_updated TEXT
  );
`);

interface CacheEntry {
  result: string | null;
  timestamp: number;
  failed?: boolean;
}

interface GitHubCache {
  data: RoadmapItem[];
  timestamp: number;
  lastUpdated: string;
}

// SQLite cache functions
function loadAICache(cacheKey: string): CacheEntry | null {
  const stmt = db.prepare('SELECT result, timestamp, failed FROM ai_timeline_cache WHERE cache_key = ?');
  const row = stmt.get(cacheKey) as { result: string | null; timestamp: number; failed: number } | undefined;
  
  if (row) {
    return {
      result: row.result,
      timestamp: row.timestamp,
      failed: row.failed === 1
    };
  }
  return null;
}

function saveAICache(cacheKey: string, result: string | null, failed: boolean = false): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO ai_timeline_cache (cache_key, result, timestamp, failed) 
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(cacheKey, result, Date.now(), failed ? 1 : 0);
}

function loadGitHubCache(): GitHubCache | null {
  const stmt = db.prepare('SELECT data, timestamp, last_updated FROM github_cache WHERE id = 1');
  const row = stmt.get() as { data: string; timestamp: number; last_updated: string } | undefined;
  
  if (row && (Date.now() - row.timestamp < GITHUB_CACHE_DURATION)) {
    return {
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
      lastUpdated: row.last_updated
    };
  }
  return null;
}

function saveGitHubCache(data: RoadmapItem[]): void {
  const timestamp = Date.now();
  const lastUpdated = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO github_cache (id, data, timestamp, last_updated) 
    VALUES (1, ?, ?, ?)
  `);
  stmt.run(JSON.stringify(data), timestamp, lastUpdated);
  console.log('Saved GitHub data to SQLite cache');
}

// Get cache key for an issue
function getCacheKey(title: string, body: string): string {
  // Use a simple hash of title + body length to create a unique key
  return `${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}_${body.length}`;
}

// Check if cache entry is still valid
function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_DURATION;
}

const app = express();
const port = process.env.PORT ? parseInt(process.env.PORT) : 3001;

app.use(cors());
app.use(express.json());

// Serve static files from the dist/client directory (built React app)
app.use(express.static(path.join(process.cwd(), 'dist', 'client')));

const graphqlWithAuth = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
});

// Initialize Azure OpenAI client
const openai = new OpenAI({
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT_NAME}`,
  defaultQuery: { 'api-version': '2024-07-01-preview' },
  defaultHeaders: {
    'api-key': process.env.AZURE_OPENAI_API_KEY!,
  },
});

interface RoadmapItem {
  id: string;
  title: string;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  lastEditedAt: string | null;
  status: string;
  labels: Array<{
    name: string;
    color: string;
  }>;
  assignees: Array<{
    login: string;
    name: string | null;
    avatarUrl: string;
  }>;
  extractedDate: string | null;
}

// Function to extract availability dates from issue body using AI with caching and retry
async function extractAvailabilityDateWithAI(body: string, title: string): Promise<string | null> {
  if (!body || body.trim().length === 0) return null;
  
  const cacheKey = getCacheKey(title, body);
  const cached = loadAICache(cacheKey);
  
  // Check cache first - if it's a valid success or recent failure (< 1 minute), use it
  if (cached && isCacheValid(cached)) {
    if (cached.failed) {
      // Check if it's been at least 1 minute since the failure
      const oneMinute = 60 * 1000;
      if (Date.now() - cached.timestamp < oneMinute) {
        console.log(`Recent failure for: ${title.substring(0, 50)}... (will retry later)`);
        return 'OpenAI extraction failed';
      }
      // More than 1 minute has passed, try again
      console.log(`Retrying failed extraction for: ${title.substring(0, 50)}...`);
    } else {
      console.log(`Cache hit for: ${title.substring(0, 50)}...`);
      return cached.result;
    }
  }
  
  try {
    const prompt = `You are analyzing Azure AKS roadmap items to extract customer timeline information.

Task: Extract any dates or timeframes when this feature will be available to customers from the issue body text below.

Look for:
- Specific dates (e.g., "March 2024", "Q2 2024")
- Relative timeframes (e.g., "next quarter", "later this year")
- Release stages with timing (e.g., "preview in Q1", "GA in summer")
- Any customer-facing availability information

Issue Title: ${title}

Issue Body:
${body}

Instructions:
- Only extract information about when the feature will be available to customers
- Return the most specific timeline mentioned
- If multiple timelines are mentioned, prefer the most recent/final availability date
- Return "None" if no customer timeline is mentioned
- Keep your response concise (max 50 characters)

Timeline:`;

    console.log(`AI extraction for: ${title.substring(0, 50)}...`);
    const response = await openai.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that extracts timeline information from technical roadmap documents. Be precise and concise.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 100,
      temperature: 0.1
    });

    const result = response.choices[0]?.message?.content?.trim();
    
    const finalResult = (!result || result.toLowerCase() === 'none' || result.toLowerCase().includes('no timeline')) ? null : result;
    
    // Save successful result to cache
    saveAICache(cacheKey, finalResult, false);
    
    return finalResult;
  } catch (error) {
    console.error('AI extraction failed:', error);
    
    // Mark as failed in cache for retry later
    saveAICache(cacheKey, null, true);
    
    return 'OpenAI extraction failed';
  }
}

// Fallback function using simple pattern matching
function extractAvailabilityDateFallback(body: string): string | null {
  const datePatterns = [
    /(?:available|released?|launching?|ga|general availability|preview).*?(?:in|by|on|during)\s*(q[1-4]\s*\d{4}|[a-z]+\s*\d{4}|\d{4})/gi,
    /(?:q[1-4]\s*\d{4}|[a-z]+\s*\d{4}|\d{4}).*?(?:availability|release|launch|ga)/gi,
    /target.*?(?:q[1-4]\s*\d{4}|[a-z]+\s*\d{4}|\d{4})/gi,
    /planned.*?(?:q[1-4]\s*\d{4}|[a-z]+\s*\d{4}|\d{4})/gi
  ];

  for (const pattern of datePatterns) {
    const matches = body.match(pattern);
    if (matches) {
      return matches[0];
    }
  }

  return null;
}

// Add progress tracking endpoint
app.get('/api/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  // Store the response object for progress updates
  progressClients.add(res);
  
  // Clean up on client disconnect
  req.on('close', () => {
    progressClients.delete(res);
  });
});

// Progress tracking
const progressClients = new Set<any>();
let currentProgress = { step: '', current: 0, total: 0 };

function sendProgress(step: string, current: number, total: number) {
  currentProgress = { step, current, total };
  const data = JSON.stringify(currentProgress);
  
  progressClients.forEach(client => {
    try {
      client.write(`data: ${data}\n\n`);
    } catch (error) {
      progressClients.delete(client);
    }
  });
}
app.get('/api/cache-info', (req, res) => {
  try {
    const githubCache = loadGitHubCache();
    
    if (githubCache) {
      res.json({
        lastUpdated: githubCache.lastUpdated,
        isCached: true
      });
    } else {
      res.json({
        lastUpdated: null,
        isCached: false
      });
    }
  } catch (error) {
    console.error('Error getting cache info:', error);
    res.status(500).json({ error: 'Failed to get cache info' });
  }
});

app.get('/api/roadmap', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    
    // Check GitHub cache first (unless force refresh)
    if (!forceRefresh) {
      const cachedData = loadGitHubCache();
      if (cachedData) {
        console.log('Serving GitHub data from cache');
        return res.json(cachedData.data);
      }
    }
    
    console.log(forceRefresh ? 'Force refresh requested, fetching fresh data...' : 'GitHub cache miss, fetching fresh data...');
    
    sendProgress('Fetching GitHub data', 0, 100);
    
    let allItems: any[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    // Fetch all pages
    let pageCount = 0;
    while (hasNextPage) {
      pageCount++;
      sendProgress(`Fetching GitHub data (page ${pageCount})`, pageCount * 10, 100);
      const query = `
        query($cursor: String) {
          organization(login: "Azure") {
            projectV2(number: 685) {
              id
              title
              items(first: 100, after: $cursor) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  id
                  content {
                    ... on Issue {
                      id
                      title
                      url
                      body
                      createdAt
                      updatedAt
                      lastEditedAt
                      labels(first: 20) {
                        nodes {
                          name
                          color
                        }
                      }
                      assignees(first: 10) {
                        nodes {
                          login
                          name
                          avatarUrl
                        }
                      }
                    }
                  }
                  fieldValues(first: 20) {
                    nodes {
                      ... on ProjectV2ItemFieldSingleSelectValue {
                        name
                        optionId
                        field {
                          ... on ProjectV2SingleSelectField {
                            name
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const response: any = await graphqlWithAuth(query, { cursor });
      
      const projectData = response.organization.projectV2;
      const items = projectData.items;
      
      allItems.push(...items.nodes);
      hasNextPage = items.pageInfo.hasNextPage;
      cursor = items.pageInfo.endCursor;
    }
    
    console.log(`Total items fetched: ${allItems.length}`);
    sendProgress('Processing items for AI extraction', 0, allItems.length);

    const roadmapItems: RoadmapItem[] = [];
    const validItems = allItems.filter((item: any) => item.content);
    
    console.log(`Processing ${validItems.length} valid items for AI extraction...`);
    
    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i];
      const issue = item.content;
      
      sendProgress(`Processing AI extraction (${i + 1}/${validItems.length})`, i + 1, validItems.length);
      
      if (!issue || !issue.title) {
        console.log(`Skipping item ${i + 1}/${validItems.length} with no title:`, JSON.stringify(item, null, 2));
        continue;
      }
      
      console.log(`Processing ${i + 1}/${validItems.length}: ${issue.title}`);
      
      // Find status field
      const statusField = item.fieldValues.nodes.find(
        (field: any) => field.field?.name === 'Status'
      );
      
      // Use AI extraction with caching and retry system
      const extractedDate = await extractAvailabilityDateWithAI(issue.body || '', issue.title);
      
      // If extraction failed, add to retry queue
      if (extractedDate === 'OpenAI extraction failed') {
        addToRetryQueue(issue.title, issue.body || '');
      }
      
      const roadmapItem: RoadmapItem = {
        id: issue.id,
        title: issue.title,
        url: issue.url,
        body: issue.body,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        lastEditedAt: issue.lastEditedAt,
        status: statusField?.name || 'Unknown',
        labels: issue.labels.nodes.map((label: any) => ({
          name: label.name,
          color: label.color
        })),
        assignees: issue.assignees.nodes.map((assignee: any) => ({
          login: assignee.login,
          name: assignee.name,
          avatarUrl: assignee.avatarUrl
        })),
        extractedDate
      };
      
      roadmapItems.push(roadmapItem);
      
      // Add a small delay to avoid overwhelming the API and show progress
      if (i % 10 === 0 && i > 0) {
        console.log(`Processed ${i}/${validItems.length} items...`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`Completed processing ${roadmapItems.length} items with AI extraction.`);
    sendProgress('Saving to cache', roadmapItems.length, roadmapItems.length);

    // Save the processed data to GitHub cache
    saveGitHubCache(roadmapItems);
    
    sendProgress('Complete', roadmapItems.length, roadmapItems.length);

    res.json(roadmapItems);
  } catch (error) {
    console.error('Error fetching roadmap:', error);
    res.status(500).json({ error: 'Failed to fetch roadmap data' });
  }
});

// Background retry system for failed AI extractions
async function retryFailedExtractions() {
  const stmt = db.prepare(`
    SELECT cache_key, result, timestamp 
    FROM ai_timeline_cache 
    WHERE failed = 1 AND timestamp <= ?
  `);
  
  const oneMinuteAgo = Date.now() - (60 * 1000);
  const failedItems = stmt.all(oneMinuteAgo) as Array<{cache_key: string, result: string | null, timestamp: number}>;
  
  if (failedItems.length > 0) {
    console.log(`Found ${failedItems.length} failed AI extractions to retry...`);
    
    // Process one failed item at a time to avoid overwhelming the API
    for (const item of failedItems.slice(0, 5)) { // Limit to 5 retries per minute
      try {
        console.log(`Background retry for cache key: ${item.cache_key.substring(0, 50)}...`);
        
        // Extract title and body from cache key (simple approach)
        const parts = item.cache_key.split('_');
        if (parts.length >= 2) {
          const title = parts[0].replace(/_/g, ' ');
          const body = ''; // We don't have the body in the key, but we can try anyway
          await extractAvailabilityDateWithAI(body, title);
        }
        
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between retries
      } catch (error) {
        console.error(`Background retry failed for ${item.cache_key}:`, error);
      }
    }
  }
}

// Store failed items for background retry (better approach)
let failedExtractionQueue: Array<{title: string, body: string}> = [];

// Modified function to add items to retry queue
function addToRetryQueue(title: string, body: string) {
  failedExtractionQueue.push({title, body});
}

// Background retry worker
async function processRetryQueue() {
  if (failedExtractionQueue.length === 0) return;
  
  console.log(`Processing ${failedExtractionQueue.length} items in retry queue...`);
  
  // Process up to 3 items per minute to avoid rate limits
  const itemsToProcess = failedExtractionQueue.splice(0, 3);
  
  for (const item of itemsToProcess) {
    try {
      console.log(`Background retry for: ${item.title.substring(0, 50)}...`);
      const result = await extractAvailabilityDateWithAI(item.body, item.title);
      
      if (result === 'OpenAI extraction failed') {
        // Add back to queue for another retry
        failedExtractionQueue.push(item);
      } else {
        console.log(`Successfully retried: ${item.title.substring(0, 50)}... -> ${result || 'No timeline found'}`);
      }
      
      // Wait 5 seconds between retries
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error(`Retry failed for ${item.title}:`, error);
      // Add back to queue for another retry
      failedExtractionQueue.push(item);
    }
  }
}

// Start background retry process - runs every minute
setInterval(processRetryQueue, 60 * 1000);

// Catch-all handler: send back React's index.html file for any non-API routes
app.get('*', (req, res) => {
  // Don't serve index.html for API routes or static assets
  if (req.path.startsWith('/api/') || req.path.startsWith('/assets/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(process.cwd(), 'dist', 'client', 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});