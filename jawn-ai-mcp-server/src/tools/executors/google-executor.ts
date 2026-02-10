/**
 * Google Tool Executor
 * Executes Gmail, Drive, and Docs API calls using OAuth tokens
 */

import axios from 'axios';

import { ExecutorContext } from '../executor.js';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DOCS_API_BASE = 'https://docs.googleapis.com/v1';

/**
 * Execute a Google tool
 */
export async function executeGoogleTool(
  toolName: string,
  input: any,
  context: ExecutorContext
): Promise<any> {
  const headers = {
    Authorization: `Bearer ${context.accessToken}`
  };

  // Gmail tools
  if (toolName.startsWith('gmail_')) {
    switch (toolName) {
      case 'gmail_search':
        return gmailSearch(headers, input);
      case 'gmail_get_message':
        return gmailGetMessage(headers, input);
      case 'gmail_get_thread':
        return gmailGetThread(headers, input);
      case 'gmail_send':
        return gmailSend(headers, input);
      case 'gmail_reply':
        return gmailReply(headers, input);
    }
  }

  // Drive tools
  if (toolName.startsWith('drive_')) {
    switch (toolName) {
      case 'drive_search':
        return driveSearch(headers, input);
      case 'drive_get_file':
        return driveGetFile(headers, input);
      case 'drive_list_folder':
        return driveListFolder(headers, input);
    }
  }

  // Docs tools
  if (toolName.startsWith('docs_')) {
    switch (toolName) {
      case 'docs_get_content':
        return docsGetContent(headers, input);
      case 'docs_get_document':
        return docsGetDocument(headers, input);
    }
  }

  throw new Error(`Unknown Google tool: ${toolName}`);
}

// ============================================================
// Gmail Tools
// ============================================================

async function gmailSearch(headers: any, input: any): Promise<any> {
  const { query, maxResults = 10, labelIds } = input;

  const params: any = {
    q: query,
    maxResults: Math.min(maxResults, 50)
  };
  if (labelIds) params.labelIds = labelIds.join(',');

  const response = await axios.get(`${GMAIL_API_BASE}/users/me/messages`, {
    headers,
    params
  });

  if (!response.data.messages || response.data.messages.length === 0) {
    return { messages: [], total: 0 };
  }

  // Fetch message details in parallel
  const messageDetails = await Promise.all(
    response.data.messages.slice(0, maxResults).map((m: any) =>
      axios.get(`${GMAIL_API_BASE}/users/me/messages/${m.id}`, {
        headers,
        params: { format: 'metadata', metadataHeaders: ['Subject', 'From', 'To', 'Date'] }
      }).then(r => r.data)
    )
  );

  return {
    total: response.data.resultSizeEstimate,
    messages: messageDetails.map(formatMessageMetadata)
  };
}

async function gmailGetMessage(headers: any, input: any): Promise<any> {
  const { messageId, format = 'full' } = input;

  const response = await axios.get(`${GMAIL_API_BASE}/users/me/messages/${messageId}`, {
    headers,
    params: { format }
  });

  return formatMessageFull(response.data);
}

async function gmailGetThread(headers: any, input: any): Promise<any> {
  const { threadId } = input;

  const response = await axios.get(`${GMAIL_API_BASE}/users/me/threads/${threadId}`, {
    headers,
    params: { format: 'full' }
  });

  return {
    threadId: response.data.id,
    messages: response.data.messages.map(formatMessageFull)
  };
}

async function gmailSend(headers: any, input: any): Promise<any> {
  const { to, subject, body, cc, isHtml = false } = input;

  const boundary = 'boundary_' + Date.now();
  const contentType = isHtml ? 'text/html' : 'text/plain';

  const email = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${subject}`,
    `Content-Type: ${contentType}; charset=utf-8`,
    '',
    body
  ].filter(Boolean).join('\r\n');

  const encodedEmail = Buffer.from(email).toString('base64url');

  const response = await axios.post(
    `${GMAIL_API_BASE}/users/me/messages/send`,
    { raw: encodedEmail },
    { headers: { ...headers, 'Content-Type': 'application/json' } }
  );

  return {
    success: true,
    messageId: response.data.id,
    threadId: response.data.threadId,
    message: `Email sent to ${to}`
  };
}

async function gmailReply(headers: any, input: any): Promise<any> {
  const { threadId, body, replyAll = false } = input;

  // Get the thread to find the original message
  const threadResponse = await axios.get(`${GMAIL_API_BASE}/users/me/threads/${threadId}`, {
    headers,
    params: { format: 'metadata', metadataHeaders: ['Subject', 'From', 'To', 'Message-ID'] }
  });

  const lastMessage = threadResponse.data.messages[threadResponse.data.messages.length - 1];
  const headerMap = new Map<string, string>(
    lastMessage.payload.headers.map((h: any) => [h.name.toLowerCase(), h.value])
  );

  const to = headerMap.get('from') || '';
  const subject = (headerMap.get('subject') || '') as string;
  const messageId = headerMap.get('message-id') || '';

  const email = [
    `To: ${to}`,
    `Subject: Re: ${subject.replace(/^Re: /i, '')}`,
    `In-Reply-To: ${messageId}`,
    `References: ${messageId}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body
  ].join('\r\n');

  const encodedEmail = Buffer.from(email).toString('base64url');

  const response = await axios.post(
    `${GMAIL_API_BASE}/users/me/messages/send`,
    { raw: encodedEmail, threadId },
    { headers: { ...headers, 'Content-Type': 'application/json' } }
  );

  return {
    success: true,
    messageId: response.data.id,
    threadId: response.data.threadId,
    message: `Reply sent to ${to}`
  };
}

// ============================================================
// Drive Tools
// ============================================================

async function driveSearch(headers: any, input: any): Promise<any> {
  const { query, mimeType, maxResults = 10 } = input;

  // Build Drive query
  let q = `name contains '${query}' or fullText contains '${query}'`;
  if (mimeType) q += ` and mimeType='${mimeType}'`;
  q += ' and trashed=false';

  const response = await axios.get(`${DRIVE_API_BASE}/files`, {
    headers,
    params: {
      q,
      pageSize: Math.min(maxResults, 100),
      fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink,owners)',
      orderBy: 'modifiedTime desc'
    }
  });

  return {
    files: response.data.files.map((f: any) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      modified: f.modifiedTime,
      size: f.size ? parseInt(f.size) : null,
      url: f.webViewLink,
      owner: f.owners?.[0]?.displayName
    }))
  };
}

async function driveGetFile(headers: any, input: any): Promise<any> {
  const { fileId } = input;

  const response = await axios.get(`${DRIVE_API_BASE}/files/${fileId}`, {
    headers,
    params: {
      fields: 'id,name,mimeType,modifiedTime,createdTime,size,webViewLink,description,owners,shared'
    }
  });

  const f = response.data;
  return {
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    description: f.description,
    created: f.createdTime,
    modified: f.modifiedTime,
    size: f.size ? parseInt(f.size) : null,
    url: f.webViewLink,
    owner: f.owners?.[0]?.displayName,
    shared: f.shared
  };
}

async function driveListFolder(headers: any, input: any): Promise<any> {
  const { folderId, maxResults = 50 } = input;

  const q = folderId === 'root'
    ? "'root' in parents and trashed=false"
    : `'${folderId}' in parents and trashed=false`;

  const response = await axios.get(`${DRIVE_API_BASE}/files`, {
    headers,
    params: {
      q,
      pageSize: Math.min(maxResults, 100),
      fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
      orderBy: 'folder,name'
    }
  });

  return {
    folderId,
    files: response.data.files.map((f: any) => ({
      id: f.id,
      name: f.name,
      type: f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : 'file',
      mimeType: f.mimeType,
      modified: f.modifiedTime,
      size: f.size ? parseInt(f.size) : null,
      url: f.webViewLink
    }))
  };
}

// ============================================================
// Docs Tools
// ============================================================

async function docsGetContent(headers: any, input: any): Promise<any> {
  const { documentId } = input;

  const response = await axios.get(`${DOCS_API_BASE}/documents/${documentId}`, { headers });

  const doc = response.data;
  const text = extractDocumentText(doc.body.content);

  return {
    documentId: doc.documentId,
    title: doc.title,
    content: text
  };
}

async function docsGetDocument(headers: any, input: any): Promise<any> {
  const { documentId } = input;

  const response = await axios.get(`${DOCS_API_BASE}/documents/${documentId}`, { headers });

  const doc = response.data;

  return {
    documentId: doc.documentId,
    title: doc.title,
    structure: extractDocumentStructure(doc.body.content)
  };
}

// ============================================================
// Formatters
// ============================================================

function formatMessageMetadata(msg: any): any {
  const headers = new Map(
    msg.payload.headers.map((h: any) => [h.name.toLowerCase(), h.value])
  );

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: headers.get('from'),
    to: headers.get('to'),
    subject: headers.get('subject'),
    date: headers.get('date'),
    snippet: msg.snippet,
    labels: msg.labelIds
  };
}

function formatMessageFull(msg: any): any {
  const headers = new Map(
    msg.payload.headers.map((h: any) => [h.name.toLowerCase(), h.value])
  );

  let body = '';
  if (msg.payload.body?.data) {
    body = Buffer.from(msg.payload.body.data, 'base64').toString('utf-8');
  } else if (msg.payload.parts) {
    // Find text/plain part
    const textPart = msg.payload.parts.find(
      (p: any) => p.mimeType === 'text/plain' && p.body?.data
    );
    if (textPart) {
      body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    from: headers.get('from'),
    to: headers.get('to'),
    cc: headers.get('cc'),
    subject: headers.get('subject'),
    date: headers.get('date'),
    body: body.length > 5000 ? body.substring(0, 5000) + '\n... (truncated)' : body,
    labels: msg.labelIds,
    hasAttachments: msg.payload.parts?.some((p: any) => p.filename)
  };
}

function extractDocumentText(content: any[]): string {
  const parts: string[] = [];

  for (const element of content) {
    if (element.paragraph) {
      const text = element.paragraph.elements
        ?.map((e: any) => e.textRun?.content || '')
        .join('') || '';
      parts.push(text);
    } else if (element.table) {
      // Simple table extraction
      for (const row of element.table.tableRows || []) {
        const cells = row.tableCells
          ?.map((cell: any) =>
            cell.content?.map((c: any) =>
              c.paragraph?.elements?.map((e: any) => e.textRun?.content || '').join('')
            ).join('')
          )
          .join(' | ');
        if (cells) parts.push(cells);
      }
    }
  }

  return parts.join('');
}

function extractDocumentStructure(content: any[]): any[] {
  const structure: any[] = [];

  for (const element of content) {
    if (element.paragraph) {
      const style = element.paragraph.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';
      const text = element.paragraph.elements
        ?.map((e: any) => e.textRun?.content || '')
        .join('')
        .trim();

      if (text) {
        structure.push({
          type: style.includes('HEADING') ? 'heading' : 'paragraph',
          level: style.includes('HEADING') ? parseInt(style.replace('HEADING_', '')) : null,
          text
        });
      }
    } else if (element.table) {
      structure.push({
        type: 'table',
        rows: element.table.rows,
        columns: element.table.columns
      });
    } else if (element.sectionBreak) {
      structure.push({ type: 'section_break' });
    }
  }

  return structure;
}
