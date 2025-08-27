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

  CREATE TABLE IF NOT EXISTS aks_issues_cache (
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

interface AKSIssuesCache {
  data: AKSIssue[];
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

function loadAKSIssuesCache(): AKSIssuesCache | null {
  const stmt = db.prepare('SELECT data, timestamp, last_updated FROM aks_issues_cache WHERE id = 1');
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

function saveAKSIssuesCache(data: AKSIssue[]): void {
  const timestamp = Date.now();
  const lastUpdated = new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO aks_issues_cache (id, data, timestamp, last_updated) 
    VALUES (1, ?, ?, ?)
  `);
  stmt.run(JSON.stringify(data), timestamp, lastUpdated);
  console.log('Saved AKS issues data to SQLite cache');
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

interface AKSIssue {
  id: string;
  title: string;
  url: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  labels: Array<{
    name: string;
    color: string;
  }>;
  assignees: Array<{
    login: string;
    name: string | null;
    avatarUrl: string;
  }>;
  state: string;
  comments: number;
  commentsData?: {
    totalCount: number;
    pageInfo?: {
      hasNextPage: boolean;
      endCursor: string;
    };
    nodes: Array<{
      id: string;
      createdAt: string;
      body: string;
      author: {
        login: string;
        name: string | null;
      };
      url: string;
    }>;
  };
  lastComment?: {
    createdAt: string;
    author: {
      login: string;
      name: string | null;
    };
  } | null;
  needsResponse?: boolean;
  aiSummary?: {
    currentStatus: string;
    nextSteps: string;
    analysis: {
      isKnownIssue: boolean;
      isExpectedBehaviour: boolean;
      shouldClose: boolean;
    };
  } | null;
}

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
  extractedEta?: {
    date: string;
    author: string;
    commentText: string;
    url: string;
  } | null;
  lastComment?: {
    createdAt: string;
    author: {
      login: string;
      name: string | null;
    };
  } | null;
  needsResponse?: boolean;
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

// Function to fetch all comments for an issue if it has more than 100
async function fetchAllComments(issueId: string, initialComments: any[], hasNextPage: boolean, endCursor: string): Promise<any[]> {
  if (!hasNextPage) return initialComments;
  
  let allComments = [...initialComments];
  let cursor = endCursor;
  let hasMore = hasNextPage;
  
  while (hasMore) {
    try {
      const query = `
        query($issueId: ID!, $cursor: String) {
          node(id: $issueId) {
            ... on Issue {
              comments(first: 100, after: $cursor) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  id
                  createdAt
                  body
                  author {
                    login
                    ... on User {
                      name
                    }
                  }
                  url
                }
              }
            }
          }
        }
      `;
      
      const response: any = await graphqlWithAuth(query, { issueId, cursor });
      const commentsData = response.node.comments;
      
      allComments.push(...commentsData.nodes);
      hasMore = commentsData.pageInfo.hasNextPage;
      cursor = commentsData.pageInfo.endCursor;
      
      console.log(`Fetched additional ${commentsData.nodes.length} comments for issue. Total: ${allComments.length}`);
      
      // Add small delay to avoid overwhelming GitHub API
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error('Error fetching additional comments:', error);
      break;
    }
  }
  
  return allComments;
}

// Function to extract ETA from Microsoft assignees' comments using OpenAI
async function extractEtaFromComments(comments: any[], assigneeLogins: string[], title: string): Promise<{
  date: string;
  author: string;
  commentText: string;
  url: string;
} | null> {
  if (!comments || comments.length === 0) return null;
  
  // Filter comments from Microsoft assignees only
  const msComments = comments.filter(comment => 
    comment.author && 
    comment.body && 
    comment.body.trim().length > 0 &&
    assigneeLogins.includes(comment.author.login)
  );
  
  if (msComments.length === 0) return null;
  
  // Create cache key using title + comment count + total length
  const totalLength = msComments.reduce((sum, comment) => sum + comment.body.length, 0);
  const cacheKey = `eta_${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}_${msComments.length}_${totalLength}`;
  
  // Check cache first
  const cached = loadAICache(cacheKey);
  if (cached && isCacheValid(cached)) {
    if (cached.failed) {
      const oneMinute = 60 * 1000;
      if (Date.now() - cached.timestamp < oneMinute) {
        console.log(`Recent ETA extraction failure for: ${title.substring(0, 50)}... (will retry later)`);
        return null;
      }
      console.log(`Retrying failed ETA extraction for: ${title.substring(0, 50)}...`);
    } else {
      console.log(`ETA cache hit for: ${title.substring(0, 50)}...`);
      if (cached.result) {
        try {
          return JSON.parse(cached.result);
        } catch {
          return null;
        }
      }
      return null;
    }
  }
  
  try {
    // Combine all comment bodies from Microsoft assignees
    const combinedComments = msComments
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((comment, index) => `Comment ${index + 1} by ${comment.author.name || comment.author.login} (${comment.createdAt}):\n${comment.body}`)
      .join('\n\n---\n\n');
    
    const prompt = `You are analyzing Azure AKS roadmap issue comments to extract the most recent ETA/timeline from Microsoft team members.

Task: Find the LATEST/MOST RECENT estimated timeline or delivery date mentioned by Microsoft team members in these comments.

Look for:
- Specific dates (e.g., "March 2024", "Q2 2024", "by end of year")
- Relative timeframes (e.g., "next quarter", "later this year", "in a few months")
- Release stages with timing (e.g., "preview in Q1", "GA in summer")
- Target dates, delivery estimates, expected timelines

Issue Title: ${title}

Microsoft Team Comments (newest first):
${combinedComments}

Instructions:
- Only extract information about when the feature will be available to customers
- Return the MOST RECENT timeline mentioned (prefer newer comments over older ones)
- If multiple timelines are mentioned in the same comment, prefer the most specific one
- Return "None" if no timeline is mentioned
- Respond with ONLY a JSON object in this exact format:
{"date": "extracted date or None", "text": "the specific sentence/phrase containing the date or None"}

Examples:
{"date": "Q2 2024", "text": "We're targeting Q2 2024 for general availability"}
{"date": "None", "text": "None"}

JSON Response:`;

    console.log(`ETA extraction via OpenAI for: ${title.substring(0, 50)}... (${msComments.length} comments)`);
    const response = await openai.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that extracts timeline information from technical discussions. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 200,
      temperature: 0.1
    });

    const result = response.choices[0]?.message?.content?.trim();
    
    if (!result) {
      saveAICache(cacheKey, null, false);
      return null;
    }
    
    try {
      // Remove markdown code blocks if present
      let cleanResult = result.trim();
      if (cleanResult.startsWith('```json')) {
        cleanResult = cleanResult.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResult.startsWith('```')) {
        cleanResult = cleanResult.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      const parsed = JSON.parse(cleanResult);
      
      if (!parsed.date || parsed.date === 'None' || !parsed.text || parsed.text === 'None') {
        saveAICache(cacheKey, null, false);
        return null;
      }
      
      // Find the comment that contains this text to get the author and URL
      const sourceComment = msComments.find(comment => 
        comment.body.toLowerCase().includes(parsed.text.toLowerCase()) ||
        parsed.text.toLowerCase().includes(comment.body.substring(0, 100).toLowerCase())
      );
      
      const finalResult = {
        date: parsed.date,
        author: sourceComment ? (sourceComment.author.name || sourceComment.author.login) : 'Microsoft Team',
        commentText: parsed.text,
        url: sourceComment ? sourceComment.url : msComments[0]?.url || '#'
      };
      
      // Save successful result to cache
      saveAICache(cacheKey, JSON.stringify(finalResult), false);
      
      return finalResult;
    } catch (parseError) {
      console.error('Failed to parse ETA extraction result:', parseError, 'Result:', result);
      saveAICache(cacheKey, null, true);
      return null;
    }
  } catch (error) {
    console.error('ETA extraction failed:', error);
    saveAICache(cacheKey, null, true);
    return null;
  }
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

    // Fetch all pages (with reasonable limit)
    let pageCount = 0;
    const MAX_PAGES = 50; // Prevent excessive data fetching
    while (hasNextPage && pageCount < MAX_PAGES) {
      pageCount++;
      sendProgress(`Fetching GitHub data (page ${pageCount})`, pageCount * 10, 100);
      const query = `
        query($cursor: String) {
          organization(login: "Azure") {
            projectV2(number: 685) {
              id
              title
              items(first: 50, after: $cursor) {
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
                      comments(first: 5) {
                        pageInfo {
                          hasNextPage
                          endCursor
                        }
                        nodes {
                          id
                          createdAt
                          body
                          author {
                            login
                            ... on User {
                              name
                            }
                          }
                          url
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
      
      if (!response?.organization?.projectV2) {
        throw new Error('Failed to fetch project data from GitHub API');
      }
      
      const projectData = response.organization.projectV2;
      const items = projectData.items;
      
      allItems.push(...items.nodes);
      hasNextPage = items.pageInfo.hasNextPage;
      cursor = items.pageInfo.endCursor;
    }
    
    console.log(`Total items fetched: ${allItems.length}`);
    sendProgress('Processing items for AI extraction', 0, allItems.length);

    const validItems = allItems.filter((item: any) => item.content);
    
    console.log(`Processing ${validItems.length} valid items for AI extraction...`);
    
    const roadmapItems: RoadmapItem[] = [];
    const CONCURRENCY_LIMIT = 8; // Process 8 items in parallel
    
    // Process items in batches
    for (let i = 0; i < validItems.length; i += CONCURRENCY_LIMIT) {
      const batch = validItems.slice(i, i + CONCURRENCY_LIMIT);
      const batchPromises = batch.map(async (item: any, batchIndex: number) => {
        const globalIndex = i + batchIndex;
        const issue = item.content;
        
        sendProgress(`Processing AI extraction (${globalIndex + 1}/${validItems.length})`, globalIndex + 1, validItems.length);
        
        if (!issue || !issue.title) {
          console.log(`Skipping item ${globalIndex + 1}/${validItems.length} with no title:`, JSON.stringify(item, null, 2));
          return null;
        }
        
        console.log(`Processing ${globalIndex + 1}/${validItems.length}: ${issue.title}`);
        
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
        
        // Fetch all comments if there are more than 100
        let allComments = issue.comments.nodes;
        if (issue.comments.pageInfo.hasNextPage) {
          console.log(`Issue ${issue.title} has more than 100 comments, fetching all...`);
          allComments = await fetchAllComments(issue.id, issue.comments.nodes, issue.comments.pageInfo.hasNextPage, issue.comments.pageInfo.endCursor);
        }
        
        // Extract ETA from Microsoft assignees' comments
        const allAssigneeLogins = issue.assignees.nodes.map((assignee: any) => assignee.login);
        const extractedEta = await extractEtaFromComments(allComments, allAssigneeLogins, issue.title);
        
        // Get last comment info (sort all comments by date)
        const sortedComments = allComments
          .filter((comment: any) => comment.author)
          .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        
        const lastComment = sortedComments.length > 0 ? {
          createdAt: sortedComments[0].createdAt,
          author: {
            login: sortedComments[0].author.login,
            name: sortedComments[0].author.name || null
          }
        } : null;
        
        // Determine if needs response from team
        const needsResponse = lastComment ? !allAssigneeLogins.includes(lastComment.author.login) : false;
        
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
          extractedDate,
          extractedEta,
          lastComment,
          needsResponse
        };
        
        return roadmapItem;
      });
      
      // Wait for all items in the batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Add valid results to roadmapItems
      batchResults.forEach(item => {
        if (item) roadmapItems.push(item);
      });
      
      console.log(`Completed batch ${Math.floor(i / CONCURRENCY_LIMIT) + 1}/${Math.ceil(validItems.length / CONCURRENCY_LIMIT)}, processed ${roadmapItems.length}/${validItems.length} items`);
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

// Function to analyze issue with AI for summary and classification
async function analyzeIssueWithAI(title: string, body: string, comments: any[]): Promise<{
  currentStatus: string;
  nextSteps: string;
  analysis: {
    isKnownIssue: boolean;
    isExpectedBehaviour: boolean;
    shouldClose: boolean;
  };
} | null> {
  if (!body || body.trim().length === 0) return null;
  
  const cacheKey = `analysis_${title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30)}_${body.length}_${comments.length}`;
  const cached = loadAICache(cacheKey);
  
  if (cached && isCacheValid(cached)) {
    if (cached.failed) {
      const oneMinute = 60 * 1000;
      if (Date.now() - cached.timestamp < oneMinute) {
        console.log(`Recent analysis failure for: ${title.substring(0, 50)}... (will retry later)`);
        return null;
      }
      console.log(`Retrying failed analysis for: ${title.substring(0, 50)}...`);
    } else {
      console.log(`Analysis cache hit for: ${title.substring(0, 50)}...`);
      if (cached.result) {
        try {
          return JSON.parse(cached.result);
        } catch {
          return null;
        }
      }
      return null;
    }
  }
  
  try {
    // Prepare comments text (limit to recent comments to avoid token limit)
    const recentComments = comments
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)
      .map((comment, index) => `Comment ${index + 1} by ${comment.author?.login || 'Unknown'} (${comment.createdAt}):\n${comment.body}`)
      .join('\n\n---\n\n');

    const prompt = `You are analyzing Azure AKS GitHub issues to provide helpful insights. Please analyze this issue and provide:

1. Current Status: A brief 1-paragraph summary of what's happening with this issue
2. Next Steps: A brief 1-paragraph summary of what should happen next
3. Analysis: Three true/false determinations:
   - Is this a known issue? (true if it's a commonly reported problem or duplicate)
   - Is this expected behaviour? (true if this is working as designed, not a bug)
   - Should we close this issue? (true if it appears resolved, duplicate, or not actionable)

Issue Title: ${title}

Issue Body:
${body}

Recent Comments:
${recentComments}

Please respond with ONLY a JSON object in this exact format:
{
  "currentStatus": "Brief paragraph about current status",
  "nextSteps": "Brief paragraph about next steps",
  "analysis": {
    "isKnownIssue": false,
    "isExpectedBehaviour": false,
    "shouldClose": false
  }
}`;

    console.log(`AI analysis for: ${title.substring(0, 50)}...`);
    const response = await openai.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME!,
      messages: [
        {
          role: 'system',
          content: 'You are a helpful assistant that analyzes GitHub issues. Always respond with valid JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 500,
      temperature: 0.1
    });

    const result = response.choices[0]?.message?.content?.trim();
    
    if (!result) {
      saveAICache(cacheKey, null, false);
      return null;
    }
    
    try {
      // Remove markdown code blocks if present
      let cleanResult = result.trim();
      if (cleanResult.startsWith('```json')) {
        cleanResult = cleanResult.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanResult.startsWith('```')) {
        cleanResult = cleanResult.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      const parsed = JSON.parse(cleanResult);
      
      if (!parsed.currentStatus || !parsed.nextSteps || !parsed.analysis) {
        saveAICache(cacheKey, null, false);
        return null;
      }
      
      // Save successful result to cache
      saveAICache(cacheKey, JSON.stringify(parsed), false);
      
      return parsed;
    } catch (parseError) {
      console.error('Failed to parse analysis result:', parseError, 'Result:', result);
      saveAICache(cacheKey, null, true);
      return null;
    }
  } catch (error) {
    console.error('Issue analysis failed:', error);
    saveAICache(cacheKey, null, true);
    return null;
  }
}

// Function to fetch all open issues from Azure/AKS repository
async function fetchAKSOpenIssues(): Promise<AKSIssue[]> {
  const issues: AKSIssue[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  let pageCount = 0;
  const MAX_PAGES = 20; // Limit to first ~1000 issues

  while (hasNextPage && pageCount < MAX_PAGES) {
    pageCount++;
    console.log(`Fetching AKS issues page ${pageCount}...`);
    
    const query = `
      query($cursor: String) {
        repository(owner: "Azure", name: "AKS") {
          issues(first: 50, after: $cursor, states: OPEN) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              title
              url
              body
              createdAt
              updatedAt
              state
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
              comments(first: 10) {
                totalCount
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  id
                  createdAt
                  body
                  author {
                    login
                    ... on User {
                      name
                    }
                  }
                  url
                }
              }
            }
          }
        }
      }
    `;

    try {
      const response: any = await graphqlWithAuth(query, { cursor });
      
      if (!response?.repository?.issues) {
        throw new Error('Failed to fetch issues from Azure/AKS repository');
      }
      
      const issuesData = response.repository.issues;
      const fetchedIssues = issuesData.nodes.map((issue: any) => ({
        id: issue.id,
        title: issue.title,
        url: issue.url,
        body: issue.body || '',
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        state: issue.state,
        labels: issue.labels.nodes.map((label: any) => ({
          name: label.name,
          color: label.color
        })),
        assignees: issue.assignees.nodes.map((assignee: any) => ({
          login: assignee.login,
          name: assignee.name,
          avatarUrl: assignee.avatarUrl
        })),
        comments: issue.comments.totalCount,
        commentsData: issue.comments, // Preserve the full comments structure for processing
        aiSummary: null // Will be populated by AI analysis
      }));
      
      issues.push(...fetchedIssues);
      hasNextPage = issuesData.pageInfo.hasNextPage;
      cursor = issuesData.pageInfo.endCursor;
      
      console.log(`Fetched ${fetchedIssues.length} issues (total: ${issues.length})`);
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
      console.error('Error fetching AKS issues:', error);
      break;
    }
  }
  
  return issues;
}

// Function to get roadmap issue IDs to filter them out
async function getRoadmapIssueIds(): Promise<Set<string>> {
  try {
    const query = `
      query {
        organization(login: "Azure") {
          projectV2(number: 685) {
            items(first: 100) {
              nodes {
                content {
                  ... on Issue {
                    id
                    url
                  }
                }
              }
            }
          }
        }
      }
    `;
    
    const response: any = await graphqlWithAuth(query);
    const roadmapItems = response?.organization?.projectV2?.items?.nodes || [];
    
    const issueIds = new Set<string>();
    roadmapItems.forEach((item: any) => {
      if (item.content?.id) {
        issueIds.add(item.content.id);
      }
    });
    
    console.log(`Found ${issueIds.size} roadmap issue IDs to filter out`);
    return issueIds;
  } catch (error) {
    console.error('Error fetching roadmap issue IDs:', error);
    return new Set();
  }
}

app.get('/api/aks-issues', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    
    // Check AKS issues cache first (unless force refresh)
    if (!forceRefresh) {
      const cachedData = loadAKSIssuesCache();
      if (cachedData) {
        console.log('Serving AKS issues data from cache');
        return res.json(cachedData.data);
      }
    }
    
    console.log(forceRefresh ? 'Force refresh requested for AKS issues, fetching fresh data...' : 'AKS issues cache miss, fetching fresh data...');
    
    sendProgress('Fetching roadmap issue IDs to filter', 0, 100);
    
    // Get roadmap issue IDs to filter out
    const roadmapIssueIds = await getRoadmapIssueIds();
    
    sendProgress('Fetching AKS open issues', 10, 100);
    
    // Fetch all AKS open issues
    const allIssues = await fetchAKSOpenIssues();
    
    sendProgress('Filtering out roadmap issues', 30, 100);
    
    // Filter out roadmap issues
    const filteredIssues = allIssues.filter(issue => !roadmapIssueIds.has(issue.id));
    
    console.log(`Filtered out ${allIssues.length - filteredIssues.length} roadmap issues, processing ${filteredIssues.length} remaining issues`);
    
    sendProgress('Starting AI analysis', 35, 100);
    
    // Process AI analysis in batches
    const CONCURRENCY_LIMIT = 5; // Process 5 issues in parallel
    const processedIssues: AKSIssue[] = [];
    const totalIssues = filteredIssues.length;
    
    for (let i = 0; i < filteredIssues.length; i += CONCURRENCY_LIMIT) {
      const batch = filteredIssues.slice(i, i + CONCURRENCY_LIMIT);
      const batchPromises = batch.map(async (issue, batchIndex) => {
        const globalIndex = i + batchIndex;
        
        // Update progress for each issue processed
        const progressPercent = Math.round(35 + ((globalIndex / totalIssues) * 60)); // 35% to 95%
        sendProgress(`Analyzing issue ${globalIndex + 1}/${totalIssues}: ${issue.title.substring(0, 40)}...`, progressPercent, 100);
        
        console.log(`Processing AI analysis for issue ${globalIndex + 1}/${filteredIssues.length}: ${issue.title.substring(0, 50)}...`);
        
        // Fetch all comments if there are more than 10
        let allComments = issue.commentsData?.nodes || [];
        if (issue.commentsData?.pageInfo?.hasNextPage && issue.commentsData.nodes && issue.commentsData.pageInfo.endCursor) {
          console.log(`Issue ${issue.title} has more than 10 comments, fetching all...`);
          allComments = await fetchAllComments(issue.id, issue.commentsData.nodes, issue.commentsData.pageInfo.hasNextPage, issue.commentsData.pageInfo.endCursor);
        }
        
        // Get last comment info (sort all comments by date)
        const sortedComments = allComments
          .filter((comment: any) => comment.author)
          .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        
        const lastComment = sortedComments.length > 0 ? {
          createdAt: sortedComments[0].createdAt,
          author: {
            login: sortedComments[0].author.login,
            name: sortedComments[0].author.name || null
          }
        } : null;
        
        // Determine if needs response from team (if last comment is not from an assignee)
        const allAssigneeLogins = issue.assignees.map((assignee: any) => assignee.login);
        const needsResponse = lastComment ? !allAssigneeLogins.includes(lastComment.author.login) : false;
        
        // Use recent comments for AI analysis (limit to 10 most recent for performance)
        const recentComments = sortedComments.slice(0, 10);
        const aiSummary = await analyzeIssueWithAI(issue.title, issue.body, recentComments);
        
        const { commentsData, ...cleanIssue } = issue;
        return {
          ...cleanIssue,
          lastComment,
          needsResponse,
          aiSummary
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      processedIssues.push(...batchResults);
      
      const batchNumber = Math.floor(i / CONCURRENCY_LIMIT) + 1;
      const totalBatches = Math.ceil(filteredIssues.length / CONCURRENCY_LIMIT);
      console.log(`Completed batch ${batchNumber}/${totalBatches}`);
      
      // Add delay between batches to avoid overwhelming the AI service
      if (i + CONCURRENCY_LIMIT < filteredIssues.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    sendProgress('Saving to cache', 95, 100);
    
    // Save the processed data to AKS issues cache
    saveAKSIssuesCache(processedIssues);
    
    console.log(`Completed processing ${processedIssues.length} AKS issues`);
    
    sendProgress('Complete', 100, 100);
    
    res.json(processedIssues);
  } catch (error) {
    console.error('Error fetching AKS issues:', error);
    res.status(500).json({ error: 'Failed to fetch AKS issues' });
  }
});

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